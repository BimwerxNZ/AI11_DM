import type { Prisma } from '@prisma/client';

import type { DConversation } from '~/common/stores/chat/chat.conversation';
import { conversationTitle, createDConversation } from '~/common/stores/chat/chat.conversation';
import { createDMessageFromFragments, createDMessageTextContent, messageFragmentsReduceText } from '~/common/stores/chat/chat.message';
import { createErrorContentFragment, createTextContentFragment, isAttachmentFragment, isContentFragment, isDocPart, isImageRefPart, isTextContentFragment, type DMessageAttachmentFragment, type DMessageContentFragment, type DMessageFragment } from '~/common/stores/chat/chat.fragments';
import { convert_Base64DataURL_To_Base64WithMimeType } from '~/common/util/blobUtils';
import { agiId } from '~/common/util/idUtils';

import type { AixAPI_Access, AixAPI_Model, AixAPIChatGenerate_Request, AixMessages_ChatMessage, AixMessages_ModelMessage, AixMessages_SystemMessage, AixMessages_UserMessage, AixParts_InlineImagePart } from '~/modules/aix/server/api/aix.wiretypes';
import { createChatGenerateDispatch } from '~/modules/aix/server/dispatch/chatGenerate/chatGenerate.dispatch';
import { _createDebugConfig } from '~/modules/aix/server/dispatch/chatGenerate/chatGenerate.debug';
import { executeChatGenerateWithContinuation } from '~/modules/aix/server/dispatch/chatGenerate/chatGenerate.continuation';
import type { DesignMateChatRequest, DesignMateChatResponse, DesignMateImageInput } from '~/modules/designmate/apiSchemas';
import { DesignMateFeatures } from '~/modules/designmate/config';
import { DESIGNMATE_ASSET_PATH_PREFIX, type DesignMateThreadSummary, toDesignMateServerConversation } from '~/modules/designmate/threads';
import { PromptVariableRegistry } from '~/modules/persona/pmix/pmix.parameters';
import { env } from '~/server/env.server';
import { prismaDb } from '~/server/prisma/prismaDb';
import { SystemPurposes, defaultSystemPurposeId, type SystemPurposeId } from '~/modules/designmate/personas';


type DesignMateServiceConfig = {
  access: AixAPI_Access;
  model: AixAPI_Model;
  modelLabel: string;
};

type PrismaDesignMateThreadRow = {
  id: string;
  externalThreadId: string;
  systemPurposeId: string;
  title: string;
  lastMessageText: string | null;
  clientMetadata: unknown;
  conversationJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export class DesignMateServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly threadId?: string,
    readonly conversation?: DConversation,
  ) {
    super(message);
  }
}

export function designMateErrorResponse(error: unknown): DesignMateChatResponse {
  if (error instanceof DesignMateServiceError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
      ...(error.threadId ? { threadId: error.threadId } : {}),
      ...(error.conversation ? { conversation: error.conversation } : {}),
    };
  }

  return {
    ok: false,
    error: {
      code: 'designmate_internal_error',
      message: error instanceof Error ? error.message : 'Unexpected DesignMate server error.',
    },
  };
}

export function isDesignMateStorageAvailable(): boolean {
  return !!(DesignMateFeatures.serverThreads && env.POSTGRES_PRISMA_URL && env.POSTGRES_URL_NON_POOLING);
}

export async function listDesignMateThreadSummaries(): Promise<DesignMateThreadSummary[]> {
  assertDesignMateStorage();

  const rows = await prismaDb.designMateThread.findMany({
    orderBy: { updatedAt: 'desc' },
    select: {
      externalThreadId: true,
      title: true,
      systemPurposeId: true,
      lastMessageText: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map(row => ({
    threadId: row.externalThreadId,
    title: row.title,
    created: row.createdAt.getTime(),
    updated: row.updatedAt.getTime(),
    systemPurposeId: row.systemPurposeId as SystemPurposeId,
    lastMessageText: row.lastMessageText,
  }));
}

export async function listDesignMateUiConversations(): Promise<DConversation[]> {
  assertDesignMateStorage();

  const rows = await prismaDb.designMateThread.findMany({
    orderBy: { updatedAt: 'desc' },
  });

  return rows.map(row => toDesignMateServerConversation(parseStoredConversation(row), row.externalThreadId));
}

export async function getDesignMateThreadConversation(threadId: string): Promise<DConversation> {
  assertDesignMateStorage();

  const row = await prismaDb.designMateThread.findUnique({
    where: { externalThreadId: threadId },
  });

  if (!row)
    throw new DesignMateServiceError(404, 'designmate_thread_not_found', 'The requested DesignMate thread was not found.', threadId);

  return toDesignMateServerConversation(parseStoredConversation(row), row.externalThreadId);
}

export async function getDesignMateAsset(assetId: string) {
  assertDesignMateStorage();

  return prismaDb.designMateAsset.findUnique({
    where: { id: assetId },
  });
}

export async function executeDesignMateChat(
  request: DesignMateChatRequest,
  options?: {
    signal?: AbortSignal;
  },
): Promise<DesignMateChatResponse> {
  assertDesignMateStorage();
  const config = getDesignMateServiceConfig();

  const existing = await prismaDb.designMateThread.findUnique({
    where: { externalThreadId: request.threadId },
  });

  const personaId = request.personaId || (existing?.systemPurposeId as SystemPurposeId | undefined) || defaultSystemPurposeId;
  const conversation = existing
    ? parseStoredConversation(existing)
    : createFreshServerConversation(request.threadId, personaId);

  conversation.systemPurposeId = personaId;

  const userFragments = await persistIncomingImagesAsFragments(request.threadId, request.images || []);
  if (request.prompt.trim())
    userFragments.unshift(createTextContentFragment(request.prompt.trim()));

  const userMessage = createDMessageFromFragments('user', userFragments);
  conversation.messages = [...conversation.messages, userMessage];
  conversation.updated = Date.now();

  await saveDesignMateThread(request.threadId, conversation, request.client || null);

  try {
    const aixRequest = await buildDesignMateAixRequest(conversation, personaId);
    const result = await runDesignMateGeneration(aixRequest, config, request.threadId, options?.signal);

    const assistantMessage = result.assistantText.trim()
      ? createDMessageTextContent('assistant', result.assistantText.trim())
      : createDMessageFromFragments('assistant', [createErrorContentFragment('DesignMate completed the request without returning any assistant text.')]);
    assistantMessage.generator = {
      mgt: 'named',
      name: result.modelLabel || config.modelLabel,
      ...(result.providerInfraLabel ? { providerInfraLabel: result.providerInfraLabel } : {}),
    };

    conversation.messages = [...conversation.messages, assistantMessage];
    conversation.updated = Date.now();

    const saved = await saveDesignMateThread(request.threadId, conversation, request.client || null);
    const syncedConversation = toDesignMateServerConversation(saved.conversationJson, request.threadId);

    return {
      ok: true,
      threadId: request.threadId,
      conversation: syncedConversation,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      assistantText: result.assistantText.trim(),
      updatedAt: syncedConversation.updated || Date.now(),
    };
  } catch (error) {
    const errorMessage = normalizeDesignMateErrorMessage(error);
    const assistantErrorMessage = createDMessageFromFragments('assistant', [createErrorContentFragment(errorMessage)]);
    assistantErrorMessage.generator = { mgt: 'named', name: 'issue' };

    conversation.messages = [...conversation.messages, assistantErrorMessage];
    conversation.updated = Date.now();

    const saved = await saveDesignMateThread(request.threadId, conversation, request.client || null);
    const syncedConversation = toDesignMateServerConversation(saved.conversationJson, request.threadId);

    throw new DesignMateServiceError(
      error instanceof DOMException && error.name === 'AbortError' ? 499 : 502,
      error instanceof DOMException && error.name === 'AbortError' ? 'designmate_request_aborted' : 'designmate_generation_failed',
      errorMessage,
      request.threadId,
      syncedConversation,
    );
  }
}

function assertDesignMateStorage(): void {
  if (!DesignMateFeatures.serverThreads)
    throw new DesignMateServiceError(404, 'designmate_server_threads_disabled', 'DesignMate server-backed threads are disabled in this deployment.');

  if (!isDesignMateStorageAvailable())
    throw new DesignMateServiceError(503, 'designmate_storage_unavailable', 'DesignMate server-backed thread storage is not configured. Add Postgres settings before using the desktop API.');
}

function getDesignMateServiceConfig(): DesignMateServiceConfig {
  const vendor = env.DESIGNMATE_API_VENDOR;
  const modelId = env.DESIGNMATE_API_MODEL?.trim();
  const reasoningEffort = env.DESIGNMATE_API_REASONING;

  if (!vendor || !modelId)
    throw new DesignMateServiceError(503, 'designmate_model_not_configured', 'DesignMate server chat is not configured. Set DESIGNMATE_API_VENDOR and DESIGNMATE_API_MODEL.');

  const access: AixAPI_Access =
    vendor === 'anthropic'
      ? { dialect: 'anthropic', anthropicKey: '', anthropicHost: null, heliconeKey: null }
      : vendor === 'gemini'
        ? { dialect: 'gemini', geminiKey: '', geminiHost: '', minSafetyLevel: 'HARM_BLOCK_THRESHOLD_UNSPECIFIED' }
        : { dialect: vendor, oaiKey: '', oaiOrg: '', oaiHost: '', heliKey: '' };

  const model: AixAPI_Model = {
    id: modelId,
    acceptsOutputs: ['text'],
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };

  return {
    access,
    model,
    modelLabel: modelId,
  };
}

function createFreshServerConversation(threadId: string, personaId: SystemPurposeId): DConversation {
  const conversation = createDConversation(personaId);
  conversation.id = `designmate-server:${threadId}`;
  conversation.threadSource = 'designmate-server';
  conversation.serverThreadId = threadId;
  return conversation;
}

function parseStoredConversation(row: Pick<PrismaDesignMateThreadRow, 'externalThreadId' | 'conversationJson'>): DConversation {
  const conversation = row.conversationJson as DConversation;

  if (!conversation || typeof conversation !== 'object')
    throw new DesignMateServiceError(500, 'designmate_thread_invalid', 'Stored DesignMate thread data is invalid.', row.externalThreadId);

  return {
    ...conversation,
    _abortController: null,
    threadSource: 'designmate-server',
    serverThreadId: row.externalThreadId,
  };
}

async function saveDesignMateThread(
  threadId: string,
  conversation: DConversation,
  clientMetadata: Record<string, string | number | boolean | null> | null,
): Promise<{
  conversationJson: DConversation;
}> {
  const storedConversation = stripTransientConversation(conversation);
  const title = conversationTitle(conversation, 'DesignMate Chat') || 'DesignMate Chat';
  const lastMessageText = [...storedConversation.messages].reverse()
    .map(message => messageFragmentsReduceText(message.fragments, '\n\n', false).trim())
    .find(Boolean) || null;

  const row = await prismaDb.designMateThread.upsert({
    where: { externalThreadId: threadId },
    create: {
      externalThreadId: threadId,
      systemPurposeId: storedConversation.systemPurposeId,
      title,
      lastMessageText,
      clientMetadata: toPrismaJsonValue(clientMetadata),
      conversationJson: storedConversation as unknown as Prisma.InputJsonValue,
    },
    update: {
      systemPurposeId: storedConversation.systemPurposeId,
      title,
      lastMessageText,
      clientMetadata: toPrismaJsonValue(clientMetadata),
      conversationJson: storedConversation as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    conversationJson: parseStoredConversation(row),
  };
}

function stripTransientConversation(conversation: DConversation): DConversation {
  return {
    ...conversation,
    _abortController: null,
    messages: conversation.messages.map(message => ({ ...message })),
  };
}

async function persistIncomingImagesAsFragments(threadId: string, images: DesignMateImageInput[]): Promise<DMessageContentFragment[]> {
  const fragments: DMessageContentFragment[] = [];

  for (const image of images) {
    const normalized = normalizeIncomingImage(image);
    if (normalized.url) {
      fragments.push({
        ft: 'content',
        fId: agiId('chat-dfragment'),
        part: {
          pt: 'image_ref',
          dataRef: {
            reftype: 'url',
            url: normalized.url,
          },
          ...(normalized.altText ? { altText: normalized.altText } : {}),
        },
      });
      continue;
    }

    if (!normalized.base64 || !normalized.mimeType || typeof normalized.bytesSize !== 'number')
      throw new DesignMateServiceError(400, 'designmate_invalid_image_input', 'The provided DesignMate image payload is incomplete.');

    const asset = await prismaDb.designMateAsset.create({
      data: {
        externalThreadId: threadId,
        mimeType: normalized.mimeType,
        base64Data: normalized.base64,
        bytesSize: normalized.bytesSize,
        altText: normalized.altText || null,
        sourceLabel: normalized.filename || null,
      },
    });

    fragments.push({
      ft: 'content',
      fId: agiId('chat-dfragment'),
      part: {
        pt: 'image_ref',
        dataRef: {
          reftype: 'url',
          url: `${DESIGNMATE_ASSET_PATH_PREFIX}${asset.id}`,
        },
        ...(normalized.altText ? { altText: normalized.altText } : {}),
      },
    });
  }

  return fragments;
}

function normalizeIncomingImage(image: DesignMateImageInput): {
  base64?: string;
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  bytesSize?: number;
  altText?: string;
  filename?: string;
  url?: string;
} {
  if (image.url) {
    const assetId = assetIdFromImageUrl(image.url);
    if (!assetId)
      throw new DesignMateServiceError(400, 'designmate_remote_image_input_unsupported', 'Only existing DesignMate asset URLs can be reused as image inputs.');

    return {
      url: image.url,
      ...(image.altText ? { altText: image.altText } : {}),
      ...(image.filename ? { filename: image.filename } : {}),
    };
  }

  if (image.dataUrl) {
    const { base64Data, mimeType } = convert_Base64DataURL_To_Base64WithMimeType(image.dataUrl, 'designmate-image-dataurl');
    return {
      base64: base64Data,
      mimeType: ensureSupportedImageMimeType(mimeType),
      bytesSize: Buffer.from(base64Data, 'base64').byteLength,
      ...(image.altText ? { altText: image.altText } : {}),
      ...(image.filename ? { filename: image.filename } : {}),
    };
  }

  if (image.base64 && image.mimeType) {
    return {
      base64: image.base64,
      mimeType: ensureSupportedImageMimeType(image.mimeType),
      bytesSize: Buffer.from(image.base64, 'base64').byteLength,
      ...(image.altText ? { altText: image.altText } : {}),
      ...(image.filename ? { filename: image.filename } : {}),
    };
  }

  throw new DesignMateServiceError(400, 'designmate_invalid_image_input', 'Each DesignMate image requires a data URL or base64 payload.');
}

function ensureSupportedImageMimeType(mimeType: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp')
    return mimeType;

  throw new DesignMateServiceError(400, 'designmate_unsupported_image_type', `Unsupported DesignMate image type: ${mimeType}`);
}

async function buildDesignMateAixRequest(conversation: DConversation, personaId: SystemPurposeId): Promise<AixAPIChatGenerate_Request> {
  const systemPromptTemplate = SystemPurposes[personaId]?.systemMessage || SystemPurposes[defaultSystemPurposeId].systemMessage;
  const systemMessage: AixMessages_SystemMessage = {
    parts: [
      {
        pt: 'text',
        text: renderPersonaPrompt(systemPromptTemplate),
      },
    ],
  };

  const chatSequence: AixMessages_ChatMessage[] = [];

  for (const message of conversation.messages) {
    if (message.role === 'system')
      continue;

    const chatFragments = message.fragments.filter(fragment => isContentFragment(fragment) || isAttachmentFragment(fragment));

    if (message.role === 'user') {
      const parts = await convertUserFragmentsToAixParts(chatFragments);
      if (parts.length)
        chatSequence.push({ role: 'user', parts });
      continue;
    }

    if (message.role === 'assistant') {
      const parts = await convertAssistantFragmentsToAixParts(chatFragments);
      if (parts.length)
        chatSequence.push({ role: 'model', parts });
    }
  }

  return {
    systemMessage,
    chatSequence,
  };
}

function renderPersonaPrompt(template: string): string {
  let mixed = template;

  for (const [variable, definition] of Object.entries(PromptVariableRegistry)) {
    const replacement = definition.replace({
      deviceBrowserLang: 'en-US',
      deviceIsDesktop: true,
      lowHourPrecision: true,
      fixupAutoSuggestHTMLUI: false,
    });

    if (definition.wholeLine && replacement === null) {
      mixed = mixed.replaceAll(new RegExp(`.*${variable}.*\n?`, 'g'), '');
      continue;
    }

    if (definition.pattern) {
      mixed = replacement === null
        ? mixed.replaceAll(definition.pattern, '')
        : mixed.replaceAll(definition.pattern, replacement);
      continue;
    }

    if (replacement !== null)
      mixed = mixed.replaceAll(variable, replacement);
  }

  mixed = mixed.replaceAll(/.*\{\{LLM\.Cutoff}}.*\n?/g, '');
  mixed = mixed.replace(/\n{3,}/g, '\n\n');
  return mixed.trim();
}

async function convertUserFragmentsToAixParts(fragments: DMessageFragment[]): Promise<AixMessages_UserMessage['parts']> {
  const parts: AixMessages_UserMessage['parts'] = [];

  for (const fragment of fragments) {
    if (isTextContentFragment(fragment)) {
      if (fragment.part.text.trim())
        parts.push({ pt: 'text', text: fragment.part.text });
      continue;
    }

    if (!isContentFragment(fragment) && !isAttachmentFragment(fragment))
      continue;

    const part = fragment.part;
    if (isImageRefPart(part)) {
      parts.push(await resolveImageRefToInlineImage(part));
      continue;
    }

    if (isDocPart(part)) {
      parts.push({
        pt: 'doc',
        vdt: part.vdt,
        ref: part.ref,
        l1Title: part.l1Title,
        data: part.data,
      });
      continue;
    }
  }

  return parts;
}

async function convertAssistantFragmentsToAixParts(fragments: DMessageFragment[]): Promise<AixMessages_ModelMessage['parts']> {
  const parts: AixMessages_ModelMessage['parts'] = [];

  for (const fragment of fragments) {
    if (!isContentFragment(fragment))
      continue;

    if (isTextContentFragment(fragment)) {
      if (fragment.part.text.trim())
        parts.push({ pt: 'text', text: fragment.part.text });
      continue;
    }

    if (isImageRefPart(fragment.part))
      parts.push(await resolveImageRefToInlineImage(fragment.part));
  }

  return parts;
}

async function resolveImageRefToInlineImage(
  part: Extract<DMessageContentFragment['part'] | DMessageAttachmentFragment['part'], { pt: 'image_ref' }>,
): Promise<AixParts_InlineImagePart> {
  if (part.dataRef.reftype !== 'url')
    throw new DesignMateServiceError(400, 'designmate_image_ref_unsupported', 'DesignMate server threads currently require URL-backed image references.');

  const assetId = assetIdFromImageUrl(part.dataRef.url);
  if (!assetId)
    throw new DesignMateServiceError(400, 'designmate_asset_url_invalid', 'DesignMate image references must point at stored DesignMate assets.');

  const asset = await prismaDb.designMateAsset.findUnique({
    where: { id: assetId },
  });

  if (!asset)
    throw new DesignMateServiceError(404, 'designmate_asset_not_found', `DesignMate asset ${assetId} was not found.`);

  return {
    pt: 'inline_image',
    mimeType: ensureSupportedImageMimeType(asset.mimeType),
    base64: asset.base64Data,
  };
}

function assetIdFromImageUrl(url: string): string | null {
  if (url.startsWith(DESIGNMATE_ASSET_PATH_PREFIX))
    return url.slice(DESIGNMATE_ASSET_PATH_PREFIX.length);

  try {
    const parsed = new URL(url);
    return parsed.pathname.startsWith(DESIGNMATE_ASSET_PATH_PREFIX)
      ? parsed.pathname.slice(DESIGNMATE_ASSET_PATH_PREFIX.length)
      : null;
  } catch {
    return null;
  }
}

async function runDesignMateGeneration(
  chatGenerate: AixAPIChatGenerate_Request,
  config: DesignMateServiceConfig,
  threadId: string,
  signal?: AbortSignal,
): Promise<{
  assistantText: string;
  modelLabel: string;
  providerInfraLabel?: string;
}> {
  const dispatchCreator = () => createChatGenerateDispatch(config.access, config.model, chatGenerate, false, false);
  const debugConfig = _createDebugConfig(config.access, undefined, 'conversation');

  let assistantText = '';
  let modelLabel = config.modelLabel;
  let providerInfraLabel: string | undefined;
  const abortSignal = signal ?? new AbortController().signal;

  for await (const particle of executeChatGenerateWithContinuation(dispatchCreator, false, abortSignal, debugConfig)) {
    if ('t' in particle) {
      assistantText += particle.t;
      continue;
    }

    if (!('cg' in particle))
      continue;

    if (particle.cg === 'set-model')
      modelLabel = particle.name;
    else if (particle.cg === 'set-provider-infra')
      providerInfraLabel = particle.label;
    else if (particle.cg === 'issue')
      throw new DesignMateServiceError(502, 'designmate_generation_failed', particle.issueText, threadId);
  }

  if (!assistantText.trim())
    throw new DesignMateServiceError(502, 'designmate_empty_response', 'DesignMate completed the request without returning any assistant text.', threadId);

  return {
    assistantText,
    modelLabel,
    ...(providerInfraLabel ? { providerInfraLabel } : {}),
  };
}

function normalizeDesignMateErrorMessage(error: unknown): string {
  if (error instanceof DesignMateServiceError)
    return error.message;

  if (error instanceof DOMException && error.name === 'AbortError')
    return 'The DesignMate request was cancelled.';

  return error instanceof Error
    ? error.message
    : 'DesignMate could not complete this request.';
}

function toPrismaJsonValue(
  value: Record<string, string | number | boolean | null> | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null)
    return null as unknown as Prisma.NullableJsonNullValueInput;

  return value as Prisma.InputJsonValue;
}
