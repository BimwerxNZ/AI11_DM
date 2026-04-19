import * as z from 'zod/v4';

import type { AixAPIChatGenerate_Request } from '~/modules/aix/server/api/aix.wiretypes';
import { aixChatGenerateContent_DMessage_orThrow, aixCreateChatGenerateContext } from '~/modules/aix/client/aix.client';
import { aixCGR_FromSimpleText } from '~/modules/aix/client/aix.client.chatGenerateRequest';
import { aixFunctionCallTool, aixRequireSingleFunctionCallInvocation } from '~/modules/aix/client/aix.client.fromSimpleFunction';

import { getDomainModelIdOrThrow } from '~/common/stores/llms/store-llms';


const CALCPAD_DESKTOP_HOST_NAME = 'designMateDesktopHost';
const DEFAULT_CALCPAD_REPAIR_ATTEMPTS = 3;

const CALCPAD_REPAIR_TOOL = {
  name: 'repair_calcpad_code',
  description: 'Repairs Calcpad source code so it renders without errors while preserving the engineering intent.',
  inputSchema: z.object({
    corrected_code: z.string().describe('The full corrected Calcpad source code only, with no markdown fences.'),
    repair_summary: z.string().describe('A short summary of the repair.').optional(),
  }),
} as const;

const CALCPAD_REPAIR_SYSTEM_MESSAGE = `
You repair Calcpad / DesignPad engineering worksheets.

Your task is to fix syntax and definition errors so the worksheet renders successfully while preserving the original calculation intent, report structure, and engineering meaning.

Important Calcpad rules:
- Plain report text and HTML snippets belong in quoted comment lines using single or double quotes.
- Variables and functions must be defined before use.
- Conditional flow uses #if / #else if / #else / #end if.
- Iteration uses #repeat, #for, or #while and ends with #loop.
- Calcpad is units-aware, so numeric literals may include units such as mm, m, kN, MPa, and kNm.
- HTML, CSS, SVG, and JS are allowed inside quoted output text when needed for presentation.
- Keep repairs minimal and do not add TODOs, placeholders, or explanatory prose.
- Return the corrected Calcpad source only through the function call.
`.trim();

const CALCPAD_PREVIEW_STYLE = `
html, body {
  width: 100% !important;
  max-width: none !important;
  min-height: 100% !important;
  margin: 0 !important;
}
body {
  box-sizing: border-box;
  padding: 1rem 1.25rem 1.5rem !important;
}
body > * {
  max-width: none !important;
}
table {
  max-width: 100%;
}
`.trim();

export interface DesignMateDesktopHost {
  renderCalcpad: (code: string) => Promise<unknown>;
}

export interface DesignMateDesktopCalcpadRenderSuccess {
  ok: true;
  html: string;
  baseUrl?: string | null;
  code?: string | null;
}

export interface DesignMateDesktopCalcpadRenderError {
  ok: false;
  error: string;
  code?: string | null;
  details?: string | null;
}

export type DesignMateDesktopCalcpadRenderResult =
  | DesignMateDesktopCalcpadRenderSuccess
  | DesignMateDesktopCalcpadRenderError;

export interface DesignMateCalcpadAutoRenderResult {
  html: string;
  finalCode: string;
  repairCount: number;
  repairSummary: string | null;
}

declare global {
  interface Window {
    CefSharp?: {
      BindObjectAsync?: (...objectNames: string[]) => Promise<void>;
    };
    designMateDesktopHost?: DesignMateDesktopHost;
  }
}

let desktopHostPromise: Promise<DesignMateDesktopHost | null> | null = null;


export function canUseDesktopCalcpadRender(): boolean {
  if (typeof window === 'undefined')
    return false;

  return !!window.designMateDesktopHost?.renderCalcpad || !!window.CefSharp?.BindObjectAsync;
}


export async function renderCalcpadCodeWithAutoFix(initialCode: string, maxRepairAttempts: number = DEFAULT_CALCPAD_REPAIR_ATTEMPTS): Promise<DesignMateCalcpadAutoRenderResult> {
  let workingCode = initialCode;
  if (!workingCode.trim())
    throw new Error('No Calcpad code was available to render.');

  let repairSummary: string | null = null;

  for (let repairCount = 0; repairCount <= maxRepairAttempts; repairCount++) {
    const renderResult = await requestDesktopCalcpadRender(workingCode);
    if (renderResult.ok) {
      return {
        html: prepareCalcpadPreviewHtml(renderResult.html, renderResult.baseUrl ?? null),
        finalCode: workingCode,
        repairCount,
        repairSummary,
      };
    }

    const renderError = renderResult.error?.trim() || 'Calcpad render failed.';
    if (renderResult.code !== 'calcpad_compile_error' || repairCount >= maxRepairAttempts)
      throw new Error(renderResult.details ? `${renderError}\n${renderResult.details}` : renderError);

    const repair = await repairCalcpadCodeOrThrow(workingCode, renderError, repairCount);
    const nextCode = repair.correctedCode.trim();
    if (!nextCode || nextCode === workingCode.trim())
      throw new Error(renderError);

    workingCode = nextCode;
    repairSummary = repair.repairSummary;
  }

  throw new Error('Calcpad render failed after repeated repair attempts.');
}


function prepareCalcpadPreviewHtml(html: string, baseUrl: string | null): string {
  const htmlString = String(html || '');
  const previewHtml = injectCalcpadPreviewStyle(htmlString);
  if (!baseUrl)
    return previewHtml;

  const normalizedBaseUrl = `${baseUrl}`.trim().replace(/\/+$/, '') + '/';

  if (/<html[\s>]/i.test(previewHtml)) {
    if (/<base\s/i.test(previewHtml))
      return previewHtml;

    if (/<head(\s[^>]*)?>/i.test(previewHtml))
      return previewHtml.replace(/<head(\s[^>]*)?>/i, match => `${match}<base href="${normalizedBaseUrl}">`);
  }

  return `<!doctype html><html><head><base href="${normalizedBaseUrl}"><style id="designmate-calcpad-preview">${CALCPAD_PREVIEW_STYLE}</style></head><body>${previewHtml}</body></html>`;
}


function injectCalcpadPreviewStyle(html: string): string {
  if (!html.trim())
    return html;

  if (html.includes('id="designmate-calcpad-preview"') || html.includes("id='designmate-calcpad-preview'"))
    return html;

  const previewStyleTag = `<style id="designmate-calcpad-preview">${CALCPAD_PREVIEW_STYLE}</style>`;

  if (/<\/head>/i.test(html))
    return html.replace(/<\/head>/i, `${previewStyleTag}</head>`);

  if (/<head(\s[^>]*)?>/i.test(html))
    return html.replace(/<head(\s[^>]*)?>/i, match => `${match}${previewStyleTag}`);

  if (/<html[\s>]/i.test(html))
    return html.replace(/<html(\s[^>]*)?>/i, match => `${match}<head>${previewStyleTag}</head>`);

  return `<!doctype html><html><head>${previewStyleTag}</head><body>${html}</body></html>`;
}


async function requestDesktopCalcpadRender(code: string): Promise<DesignMateDesktopCalcpadRenderResult> {
  if (!code.trim()) {
    return {
      ok: false,
      code: 'calcpad_empty_code',
      error: 'No Calcpad code was provided to the local renderer.',
    };
  }

  const desktopHost = await getDesignMateDesktopHost();
  if (!desktopHost?.renderCalcpad) {
    return {
      ok: false,
      code: 'calcpad_bridge_unavailable',
      error: 'Calcpad rendering is only available inside the BIMWERX desktop host right now.',
    };
  }

  try {
    const rawResult = await desktopHost.renderCalcpad(code);
    return parseDesktopCalcpadRenderResult(rawResult);
  } catch (error: any) {
    const errorDetails = describeDesktopHostError(error);
    return {
      ok: false,
      code: 'calcpad_transport_error',
      error: errorDetails || 'The desktop host could not render this Calcpad code.',
      details: errorDetails || null,
    };
  }
}


async function getDesignMateDesktopHost(): Promise<DesignMateDesktopHost | null> {
  if (typeof window === 'undefined')
    return null;

  if (window.designMateDesktopHost?.renderCalcpad)
    return window.designMateDesktopHost;

  if (!desktopHostPromise) {
    desktopHostPromise = (async () => {
      try {
        if (window.CefSharp?.BindObjectAsync)
          await window.CefSharp.BindObjectAsync(CALCPAD_DESKTOP_HOST_NAME);
      } catch {
        // Keep this quiet; the caller will surface a friendly message when needed.
      }

      return window.designMateDesktopHost?.renderCalcpad
        ? window.designMateDesktopHost
        : null;
    })();
  }

  const host = await desktopHostPromise;
  if (!host)
    desktopHostPromise = null;

  return host;
}


function parseDesktopCalcpadRenderResult(rawResult: unknown): DesignMateDesktopCalcpadRenderResult {
  const normalizedResult = unwrapDesktopHostResult(rawResult);
  const parsedResult = parseDesktopHostResultValue(normalizedResult);

  if (parsedResult && typeof parsedResult === 'object' && (parsedResult as any).ok === true && typeof (parsedResult as any).html === 'string') {
    return {
      ok: true,
      html: (parsedResult as any).html,
      baseUrl: typeof (parsedResult as any).baseUrl === 'string' ? (parsedResult as any).baseUrl : null,
      code: typeof (parsedResult as any).code === 'string' ? (parsedResult as any).code : null,
    };
  }

  const errorMessage = parsedResult && typeof parsedResult === 'object' && typeof (parsedResult as any).error === 'string'
    ? (parsedResult as any).error
    : 'The desktop host returned an unreadable Calcpad render result.';

  return {
    ok: false,
    error: errorMessage,
    code: parsedResult && typeof parsedResult === 'object' && typeof (parsedResult as any).code === 'string' ? (parsedResult as any).code : null,
    details: parsedResult && typeof parsedResult === 'object' && typeof (parsedResult as any).details === 'string' ? (parsedResult as any).details : null,
  };
}


function unwrapDesktopHostResult(rawResult: unknown): unknown {
  let current = rawResult;

  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== 'object')
      break;

    const value = current as Record<string, any>;

    if (typeof value.result !== 'undefined') {
      current = value.result;
      continue;
    }
    if (typeof value.Result !== 'undefined') {
      current = value.Result;
      continue;
    }
    if (typeof value.response !== 'undefined') {
      current = value.response;
      continue;
    }
    if (typeof value.Response !== 'undefined') {
      current = value.Response;
      continue;
    }
    if (typeof value.returnValue !== 'undefined') {
      current = value.returnValue;
      continue;
    }
    if (typeof value.ReturnValue !== 'undefined') {
      current = value.ReturnValue;
      continue;
    }
    if (typeof value.value !== 'undefined') {
      current = value.value;
      continue;
    }
    if (typeof value.Value !== 'undefined') {
      current = value.Value;
      continue;
    }

    break;
  }

  return current;
}


function parseDesktopHostResultValue(rawResult: unknown): unknown {
  if (typeof rawResult !== 'string')
    return rawResult;

  const trimmed = rawResult.trim();
  if (!trimmed)
    return rawResult;

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))
    return JSON.parse(trimmed);

  if (/<(?:!doctype|html|head|body|div|section|table|svg)\b/i.test(trimmed))
    return { ok: true, html: rawResult };

  return rawResult;
}


function describeDesktopHostError(error: unknown): string | null {
  if (!error)
    return null;

  if (typeof error === 'string')
    return error;

  if (typeof error === 'object') {
    const errorRecord = error as Record<string, any>;

    if (typeof errorRecord.message === 'string' && errorRecord.message.trim())
      return errorRecord.message.trim();
    if (typeof errorRecord.error === 'string' && errorRecord.error.trim())
      return errorRecord.error.trim();
    if (typeof errorRecord.details === 'string' && errorRecord.details.trim())
      return errorRecord.details.trim();

    try {
      const serialized = JSON.stringify(errorRecord);
      if (serialized && serialized !== '{}')
        return serialized;
    } catch {
      // ignore and fall through
    }
  }

  try {
    const fallback = String(error);
    return fallback && fallback !== '[object Object]' ? fallback : null;
  } catch {
    return null;
  }
}


async function repairCalcpadCodeOrThrow(codeToRepair: string, renderError: string, repairCount: number): Promise<{ correctedCode: string; repairSummary: string | null }> {
  const llmId = getDomainModelIdOrThrow(['codeApply'], true, false, 'designmate-calcpad-repair');

  const userMessage = `
Repair this Calcpad worksheet so it renders successfully.

Attempt ${repairCount + 1}

Current Calcpad code:
\`\`\`calcpad
${codeToRepair}
\`\`\`

Calcpad render error:
${renderError}

Return only the corrected Calcpad code through the function call.
`.trim();

  const request: AixAPIChatGenerate_Request = {
    ...aixCGR_FromSimpleText(
      CALCPAD_REPAIR_SYSTEM_MESSAGE,
      [{ role: 'user', text: userMessage }],
    ),
    tools: [aixFunctionCallTool(CALCPAD_REPAIR_TOOL)],
    toolsPolicy: { type: 'function_call', function_call: { name: CALCPAD_REPAIR_TOOL.name } },
  };

  const { fragments } = await aixChatGenerateContent_DMessage_orThrow(
    llmId,
    request,
    aixCreateChatGenerateContext('fixup-code', '_DEV_'),
    false,
    { abortSignal: 'NON_ABORTABLE', llmOptionsOverride: { llmTemperature: 0 } },
  );

  const { argsObject } = aixRequireSingleFunctionCallInvocation(fragments, CALCPAD_REPAIR_TOOL.name, false, 'designmate-calcpad-repair');
  const parsedArgs = CALCPAD_REPAIR_TOOL.inputSchema.parse(argsObject);

  return {
    correctedCode: parsedArgs.corrected_code,
    repairSummary: parsedArgs.repair_summary?.trim() || null,
  };
}
