import * as z from 'zod/v4';

import type { AixAPIChatGenerate_Request } from '~/modules/aix/server/api/aix.wiretypes';
import { AixClientFunctionCallToolDefinition, aixFunctionCallTool, aixRequireSingleFunctionCallInvocation } from '~/modules/aix/client/aix.client.fromSimpleFunction';
import { aixCGR_ChatSequence_FromDMessagesOrThrow, aixCGR_SystemMessageText } from '~/modules/aix/client/aix.client.chatGenerateRequest';
import { aixChatGenerateContent_DMessage_orThrow, aixCreateChatGenerateContext } from '~/modules/aix/client/aix.client';

import { addSnackbar } from '~/common/components/snackbar/useSnackbarsStore';
import { ConversationsManager } from '~/common/chat-overlay/ConversationsManager';
import { createDMessageTextContent, type DMessage, messageFragmentsReduceText } from '~/common/stores/chat/chat.message';
import { createErrorContentFragment, createPlaceholderVoidFragment, createTextContentFragment } from '~/common/stores/chat/chat.fragments';
import { getDomainModelIdOrThrow } from '~/common/stores/llms/store-llms';
import { marshallWrapText } from '~/common/stores/chat/chat.tokens';
import { processPromptTemplate } from '~/common/util/promptUtils';
import { useChatStore } from '~/common/stores/chat/store-chats';


/*const suggestUserFollowUpFn: VChatFunctionIn = {
  name: 'suggest_user_prompt',
  description: 'Surprises the user with a thought-provoking question/prompt/contrarian idea',
  parameters: {
    type: 'object',
    properties: {
      question_as_user: {
        type: 'string',
        description: 'The concise and insightful question that we propose the user should ask, designed to provoke deep thought and stimulate conversation',
      },
      title: {
        type: 'string',
        description: 'Very brief title, e.g., Meaning of Life',
      },
    },
    required: ['question_as_user', 'title'],
  },
};*/


// NOTE: also see the definition of the fixups in `src/modules/aifn/agicodefixup/agiFixupCode.ts`
interface DumbToolTBD {
  sys: string;
  usr: string;
  fun: AixClientFunctionCallToolDefinition,
}

interface AutoChatFollowUpContext {
  assistantMessage: DMessage;
  assistantMessageId: string;
  assistantMessageText: string;
  cHandler: ReturnType<typeof ConversationsManager.getHandler>;
  codeLlmId: string;
  conversationId: string;
  personaSystemPrompt: string;
  userMessage: DMessage;
}


function _getSystemMessage(tool: DumbToolTBD, variables: Record<string, string>, templateName: string): AixAPIChatGenerate_Request['systemMessage'] {
  return aixCGR_SystemMessageText(processPromptTemplate(tool.sys, { ...variables, functionName: tool.fun.name }, templateName));
}

function _createTextOnlyFollowUpMessages(userMessage: DMessage, assistantMessage: DMessage, reminderText: string): DMessage[] {
  const messages: DMessage[] = [];

  const userText = messageFragmentsReduceText(userMessage.fragments).trim();
  if (userText)
    messages.push(createDMessageTextContent('user', userText));

  const assistantText = messageFragmentsReduceText(assistantMessage.fragments).trim();
  if (assistantText)
    messages.push(createDMessageTextContent('assistant', assistantText));

  messages.push(createDMessageTextContent('user', reminderText));
  return messages;
}

function _isExpiredToolCallHistoryError(error: unknown): boolean {
  const message = `${(error as any)?.message || error || ''}`;
  return message.includes('No tool output found for function call');
}

function _handleExpiredFollowUpError(cHandler: ReturnType<typeof ConversationsManager.getHandler>, assistantMessageId: string, fragmentId: string, followUpName: string): boolean {
  cHandler.messageFragmentDelete(assistantMessageId, fragmentId, false, false);
  addSnackbar({
    key: `chat-followup-${followUpName}-fallback`,
    message: `${followUpName} skipped for this older tool-generated reply.`,
    type: 'issue',
    overrides: { autoHideDuration: 5000 },
  });
  return true;
}

function _getAutoChatFollowUpContext(conversationId: string, assistantMessageId: string): AutoChatFollowUpContext | null {
  const { conversations } = useChatStore.getState();
  const conversation = conversations.find(c => c.id === conversationId) ?? null;
  if (!conversation || conversation.messages.length < 2)
    return null;

  let codeLlmId;
  try {
    codeLlmId = getDomainModelIdOrThrow(['codeApply'], true, false, 'chat-followups');
  } catch (error) {
    console.log(`autoSuggestions: ${error}`);
    return null;
  }

  const assistantMessageIndex = conversation.messages.findIndex(m => m.id === assistantMessageId);
  if (assistantMessageIndex < 2)
    return null;

  const systemMessage = conversation.messages[0];
  const userMessage = conversation.messages[assistantMessageIndex - 1];
  const assistantMessage = conversation.messages[assistantMessageIndex];

  if (!(systemMessage?.role === 'system') || !(userMessage?.role === 'user') || !(assistantMessage?.role === 'assistant'))
    return null;

  return {
    assistantMessage,
    assistantMessageId,
    assistantMessageText: messageFragmentsReduceText(assistantMessage.fragments),
    cHandler: ConversationsManager.getHandler(conversationId),
    codeLlmId,
    conversationId,
    personaSystemPrompt: messageFragmentsReduceText(systemMessage.fragments),
    userMessage,
  };
}

async function _runAutoChatFollowUpHTMLUI(context: AutoChatFollowUpContext): Promise<void> {
  const {
    assistantMessage,
    assistantMessageId,
    assistantMessageText,
    cHandler,
    codeLlmId,
    conversationId,
    personaSystemPrompt,
    userMessage,
  } = context;

  if (['<html', '<HTML', '<Html'].some(s => assistantMessageText.includes(s)))
    return;

  const placeholderFragment = createPlaceholderVoidFragment('Auto-UI ...');
  cHandler.messageFragmentAppend(assistantMessageId, placeholderFragment, false, false);

  const systemMessage = _getSystemMessage(uiTool, { personaSystemPrompt }, 'chat-followup-htmlui_system');
  const reminderText = processPromptTemplate(uiTool.usr, { functionName: uiTool.fun.name }, 'chat-followup-htmlui_reminder');
  const chatSequence = await aixCGR_ChatSequence_FromDMessagesOrThrow(
    _createTextOnlyFollowUpMessages(userMessage, assistantMessage, reminderText),
  );

  aixChatGenerateContent_DMessage_orThrow(
    codeLlmId,
    { systemMessage, chatSequence, tools: [aixFunctionCallTool(uiTool.fun)], toolsPolicy: { type: 'any' } },
    aixCreateChatGenerateContext('chat-followup-htmlui', conversationId),
    false,
    { abortSignal: 'NON_ABORTABLE' },
  ).then(({ fragments }) => {

    const { argsObject } = aixRequireSingleFunctionCallInvocation(fragments, uiTool.fun.name, false, 'chat-followup-htmlui');
    const { html, file_name } = uiTool.fun.inputSchema.parse(argsObject);
    if (html && file_name) {

      const htmlUI = html.trim();
      if (!['<!DOCTYPE', '<!doctype', '<html', '<HTML', '<Html'].some(s => htmlUI.includes(s))) {
        console.log(`autoSuggestions: invalid generated HTML: ${htmlUI.slice(0, 20)}...`);
        throw new Error('Invalid HTML');
      }

      const fileName = (file_name || 'ui').trim().replace(/[^a-zA-Z0-9-]/g, '') + '.html';
      const codeBlock = marshallWrapText(htmlUI, fileName, 'markdown-code');
      const fragment = createTextContentFragment(codeBlock);
      cHandler.messageFragmentReplace(assistantMessageId, placeholderFragment.fId, fragment, false);
      return;
    }

    cHandler.messageFragmentDelete(assistantMessageId, placeholderFragment.fId, false, false);
  }).catch(error => {
    if (_isExpiredToolCallHistoryError(error) && _handleExpiredFollowUpError(cHandler, assistantMessageId, placeholderFragment.fId, 'Auto-UI'))
      return;
    cHandler.messageFragmentReplace(assistantMessageId, placeholderFragment.fId, createErrorContentFragment(`Auto-UI generation issue: ${error?.message || error}`), false);
  });
}

export async function autoChatFollowUpHTMLUI(conversationId: string, assistantMessageId: string): Promise<void> {
  const context = _getAutoChatFollowUpContext(conversationId, assistantMessageId);
  if (!context)
    return;

  await _runAutoChatFollowUpHTMLUI(context);
}


// Auto-Calc / DesignPad

const designPadTool = {
  sys: `You are a helpful AI assistant skilled in creating DesignPad engineering worksheets. Analyze the conversation and user persona below to determine if a DesignPad script would complement or enhance the user's understanding.

**Rating System**
Rate the script's usefulness (1-5): 1. Misleading, unnecessary, or duplicate, 2. Not a fit or trivial, 3. Potentially useful, 4. Very useful, 5. Essential

Only if the rating is 3, 4, or 5, generate the DesignPad script. Otherwise leave the script empty and STOP.

**Assistant Personality Type**
{{personaSystemPrompt}}

**Instructions**
Analyze the following short exchange and call the function {{functionName}} with the DesignPad script only if the score is 3, 4, or 5.

Please follow these requirements:
- Generate valid DesignPad syntax only.
- Define variables before use.
- Keep units attached where appropriate, such as mm, m, kN, MPa, and kNm.
- Use quoted report lines for prose, headings, HTML snippets, and layout text.
- Use DesignPad control directives exactly when needed: #if / #else if / #else / #end if and #repeat, #for, or #while ending with #loop.
- Preserve the engineering intent of the assistant answer.
- Prefer clear, reusable worksheets with headings, assumptions, inputs, calculations, and result summaries.
- Do not wrap the script in markdown fences.
- Do not add explanatory prose outside the DesignPad script.`,
  usr: 'Analyze the conversation and call {{functionName}} to evaluate whether a DesignPad worksheet would help, then generate it if sufficiently useful.',
  fun: {
    name: 'generate_designpad_script',
    description: 'Generates a DesignPad worksheet from the conversation when it would be useful to the user.',
    inputSchema: z.object({
      possible_calc_requirements: z.string().describe('Short summary of the DesignPad worksheet intent and structure.'),
      rating_short_reason: z.string().describe('A short reason for whether the worksheet would be useful.'),
      rating_number: z.number().describe('The usefulness of the worksheet on a scale from 1 to 5. If 1 or 2, do not proceed and STOP.'),
      designpad_script: z.string().describe('The full DesignPad source code only, with no markdown fences.').optional(),
    }),
  },
} satisfies DumbToolTBD;

async function _runAutoChatFollowUpDesignPad(context: AutoChatFollowUpContext): Promise<void> {
  const {
    assistantMessage,
    assistantMessageId,
    assistantMessageText,
    cHandler,
    codeLlmId,
    conversationId,
    personaSystemPrompt,
    userMessage,
  } = context;

  if (['```designpad', '```calcpad'].some(s => assistantMessageText.toLowerCase().includes(s)))
    return;

  const placeholderFragment = createPlaceholderVoidFragment('Auto-Calc ...');
  cHandler.messageFragmentAppend(assistantMessageId, placeholderFragment, false, false);

  const systemMessage = _getSystemMessage(designPadTool, { personaSystemPrompt }, 'chat-followup-designpad_system');
  const reminderText = processPromptTemplate(designPadTool.usr, { functionName: designPadTool.fun.name }, 'chat-followup-designpad_reminder');
  const chatSequence = await aixCGR_ChatSequence_FromDMessagesOrThrow(
    _createTextOnlyFollowUpMessages(userMessage, assistantMessage, reminderText),
  );

  aixChatGenerateContent_DMessage_orThrow(
    codeLlmId,
    { systemMessage, chatSequence, tools: [aixFunctionCallTool(designPadTool.fun)], toolsPolicy: { type: 'any' } },
    aixCreateChatGenerateContext('chat-followup-designpad', conversationId),
    false,
    { abortSignal: 'NON_ABORTABLE' },
  ).then(({ fragments }) => {

    const { argsObject } = aixRequireSingleFunctionCallInvocation(fragments, designPadTool.fun.name, false, 'chat-followup-designpad');
    const { designpad_script } = designPadTool.fun.inputSchema.parse(argsObject);
    if (designpad_script?.trim()) {
      const codeBlock = marshallWrapText(designpad_script.trim(), 'designpad', 'markdown-code');
      const fragment = createTextContentFragment(codeBlock);
      cHandler.messageFragmentReplace(assistantMessageId, placeholderFragment.fId, fragment, false);
      return;
    }

    cHandler.messageFragmentDelete(assistantMessageId, placeholderFragment.fId, false, false);
  }).catch(error => {
    if (_isExpiredToolCallHistoryError(error) && _handleExpiredFollowUpError(cHandler, assistantMessageId, placeholderFragment.fId, 'Auto-Calc'))
      return;
    cHandler.messageFragmentReplace(assistantMessageId, placeholderFragment.fId, createErrorContentFragment(`Auto-Calc generation issue: ${error?.message || error}`), false);
  });
}

export async function autoChatFollowUpDesignPad(conversationId: string, assistantMessageId: string): Promise<void> {
  const context = _getAutoChatFollowUpContext(conversationId, assistantMessageId);
  if (!context)
    return;

  await _runAutoChatFollowUpDesignPad(context);
}


// Auto-Diagram

const diagramsTool = {
  // variables: personaSystemPrompt, functionName
  sys: `You are an expert AI assistant skilled in creating diagrams. Analyze the conversation and user persona below to determine if a PlantUML diagram would complement or enhance the user's understanding.

Rate the diagram's usefulness (1-5): 1: Misleading, unnecessary or duplicate, 2: Not a fit or trivial, 3: Potentially useful to the user, 4: Very useful, 5: Essential.

Only if the rating is 4 or 5, include the diagram code, otherwise leave it empty and STOP.

---

# Assistant personality type:
{{personaSystemPrompt}}

---

# Instructions
Analyze the following short exchange and call the function {{functionName}} with the results of your analysis including code only if the score is 4 or 5.`,
  usr: 'Analyze the conversation and call {{functionName}} to assess diagram relevance and generate PlantUML if highly relevant.',
  fun: {
    name: 'draw_plantuml_diagram',
    description: 'Generates a PlantUML diagram or mindmap from the last message, if applicable, very useful to the user, and no other diagrams are present.',
    inputSchema: z.object({ // zod-4
      rating_short_reason: z.string().describe('A 4-10 words reason on whether the diagram would be desired by the user or not.'),
      rating_number: z.number().describe('The relevance of the diagram to the conversation, on a scale of 1 to 5 . If lower than 4, STOP.'),
      type: z.string().describe('The most suitable PlantUML diagram type: sequence, usecase, class, activity, component, state, object, deployment, timing, network, wireframe, gantt, wbs or mindmap.').optional(),
      code: z.string().describe('A valid PlantUML string (@startuml...@enduml) to be rendered as a diagram or mindmap (@startmindmap...@endmindmap), or empty. No external references allowed. Use one or more asterisks to indent and separate with spaces.').optional(),
    }),
  },
} satisfies DumbToolTBD;


// Auto-HTML-UI

const suggestUIFunctionName = 'generate_web_ui';

export const autoFollowUpUIMixin = `Do not generate code, unless via the \`${suggestUIFunctionName}\` function call, IF DEFINED`;

// noinspection HtmlRequiredTitleElement
const uiTool = {
  sys: `You are a helpful AI assistant skilled in creating user interfaces. Analyze the conversation and user persona below to determine if an HTML user interface would complement or enhance the user's understanding.

**Rating System**
Rate the UI's usefulness (1-5): 1. Misleading, unnecessary, or duplicate, 2. Not a fit or trivial, 3. Potentially useful or thought-provoking to the user, 4. Very useful, 5. Essential

Only if the rating is 3, 4, or 5, generate the HTML code. Ensure the generated output is visual, resilient, and engaging, with the emphasis on visual explanation rather than app-like controls.

**Assistant Personality Type**
{{personaSystemPrompt}}

**Instructions**
Analyze the following short exchange and call the function {{functionName}} with the HTML code only if the score is 3, 4, or 5.

Please follow closely the following requirements:
- **Generate Visual Outputs:** Prefer visual summaries, structural design dashboards, diagrams, load paths, member schedules, result summaries, comparison cards, annotated sketches, and markdown-like tables rendered as HTML. Favor presentation over interaction.
- **Code Quality and Resilience:** The single-file HTML, CSS, and JavaScript code must be correct and resilient, as there will be no opportunity to modify it after.
- **Include HTML Comments:** After the DOCTYPE, explain your brief concept choices and short implementation guidelines.
- **Frontend-Only Architecture:** The code should be self-contained, using HTML, CSS, and JavaScript only. External images are allowed. Must not require backend or environment setup.
- **Include Tailwind CSS:** Add \`<script src='https://cdn.tailwindcss.com/3.4.3'></script>\` in the \`<head>\` section.
- **Incorporate Trends:** Selectively use abstract gradients, color clashing, vintage minimalism, geometric shapes, or 3D bubble text where they enhance the UI's purpose and user experience.
- **Avoid Control-Heavy Interfaces:** Do not default to forms, text inputs, dropdowns, button bars, or fake apps unless they are essential to explain the result. For structural design tasks, prefer a read-first visual board.
- **Structural Design Bias:** When the topic is structural or engineering related, prioritize diagrams, tabulated results, callouts, section summaries, utilization highlights, assumptions, and clear status indicators.
- **Functional Requirements:** The output must solve the user's problem, communicate the answer visually at a glance, be visually impressive, and render correctly in isolation.`,
  usr: 'Analyze the conversation and call {{functionName}} to evaluate UI relevance and generate HTML code if sufficiently useful.',
  fun: {
    name: suggestUIFunctionName,
    description: 'Renders a visual HTML output when provided with a single concise HTML5 string (can include CSS and JS), if applicable and relevant.',
    inputSchema: z.object({ // zod-4
      possible_ui_requirements: z.string().describe('Brief (10 words) to medium length (40 words) requirements for the visual output. Include the main summaries, diagrams, tables, look, and layout.'),
      rating_short_reason: z.string().describe('A 4-10 word reason on whether the UI would be desired by the user or not.'),
      rating_number: z.number().describe('The relevance of the UI to the conversation, on a scale of 1 (does not add much value), 2 (superfluous), 3 (helps a lot in understanding), 4 (essential) to 5 (fundamental to the understanding). If 1 or 2, do not proceed and STOP.'),
      html: z.string().describe('A valid HTML string containing the visual output code. The code should be complete, with no dependencies, lower case, and include minimal inline CSS if needed. It should primarily present visual summaries, diagrams, and tables rather than control-heavy interaction.').optional(),
      file_name: z.string().describe('Short letters-and-dashes file name of the HTML without the .html extension.').optional(),
    }),
  },
} satisfies DumbToolTBD;


/**
 * Formulates proposals (based on 2 messages, at least) for:
 * - Diagrams: will process the message and append diagrams
 * - HTML UI: automatically append a HTML UI, if valuable
 * - [missing] follow-up questions
 * - [missing] prompts
 * - [missing] counterpoints
 */
export async function autoChatFollowUps(conversationId: string, assistantMessageId: string, suggestDiagrams: boolean, suggestHTMLUI: boolean, suggestQuestions: boolean) {

  const context = _getAutoChatFollowUpContext(conversationId, assistantMessageId);
  if (!context)
    return;

  const {
    assistantMessage,
    assistantMessageId: resolvedAssistantMessageId,
    assistantMessageText,
    cHandler,
    codeLlmId,
    conversationId: resolvedConversationId,
    personaSystemPrompt,
    userMessage,
  } = context;

  // Follow-up: Question
  if (suggestQuestions) {
    // ... TODO ...
  }

  // Follow-up: Auto-Diagrams if the assistant text does not contain @startuml / @startmindmap already
  if (suggestDiagrams && !['@startuml', '@startmindmap', '```plantuml', '```mermaid'].some(s => assistantMessageText.includes(s))) {

    // Placeholder for the diagram
    const placeholderFragment = createPlaceholderVoidFragment('Auto-Diagram ...');
    cHandler.messageFragmentAppend(assistantMessageId, placeholderFragment, false, false);

    // Instructions
    const systemMessage = _getSystemMessage(diagramsTool, { personaSystemPrompt }, 'chat-followup-diagram_system');
    const reminderText = processPromptTemplate(diagramsTool.usr, { functionName: diagramsTool.fun.name }, 'chat-followup-diagram_reminder');
    const chatSequence = await aixCGR_ChatSequence_FromDMessagesOrThrow(
      _createTextOnlyFollowUpMessages(userMessage, assistantMessage, reminderText),
    );

    // Strict call to a function
    aixChatGenerateContent_DMessage_orThrow(
      codeLlmId,
      { systemMessage, chatSequence, tools: [aixFunctionCallTool(diagramsTool.fun)], toolsPolicy: { type: 'any' } },
      aixCreateChatGenerateContext('chat-followup-diagram', resolvedConversationId),
      false,
      { abortSignal: 'NON_ABORTABLE' },
    ).then(({ fragments }) => {

      // extract the function call
      const { argsObject } = aixRequireSingleFunctionCallInvocation(fragments, diagramsTool.fun.name, false, 'chat-followup-diagram');
      const { code, type } = diagramsTool.fun.inputSchema.parse(argsObject);
      if (code && type) {

        // validate the code
        const plantUML = code.trim();
        if (!plantUML.startsWith('@start') || !(plantUML.endsWith('@enduml') || plantUML.endsWith('@endmindmap'))) {
          console.log(`autoSuggestions: invalid generated PlantUML: ${plantUML.slice(0, 20)}...`);
          throw new Error('Invalid PlantUML');
        }

        // PlantUML Text Content to replace the placeholder
        const fileName = `${type}.diagram`;
        const codeBlock = marshallWrapText(plantUML, /*'[Auto Diagram] ' +*/ fileName, 'markdown-code');
        const fragment = createTextContentFragment(codeBlock);
        cHandler.messageFragmentReplace(resolvedAssistantMessageId, placeholderFragment.fId, fragment, false);
        return;
      }

      // no diagram generated
      cHandler.messageFragmentDelete(resolvedAssistantMessageId, placeholderFragment.fId, false, false);
    }).catch(error => {
      if (_isExpiredToolCallHistoryError(error) && _handleExpiredFollowUpError(cHandler, resolvedAssistantMessageId, placeholderFragment.fId, 'Auto-Diagram'))
        return;
      cHandler.messageFragmentReplace(resolvedAssistantMessageId, placeholderFragment.fId, createErrorContentFragment(`Auto-Diagram generation issue: ${error?.message || error}`), false);
    });
  }

  // Follow-up: Auto-HTML-UI if the assistant text does not contain <html> already
  if (suggestHTMLUI)
    await _runAutoChatFollowUpHTMLUI(context);

}
