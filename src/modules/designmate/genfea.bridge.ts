import type { SystemPurposeId } from '../../data';

import type { AttachmentCreationOptions, AttachmentDraftSource } from '~/common/attachment-drafts/attachment.types';
import type { DConversationId } from '~/common/stores/chat/chat.conversation';
import type { DMessageId } from '~/common/stores/chat/chat.message';
import { createTextContentFragment, type DMessageAttachmentFragment, type DMessageContentFragment } from '~/common/stores/chat/chat.fragments';
import { convert_Base64DataURL_To_Base64WithMimeType, convert_Base64WithMimeType_To_Blob } from '~/common/util/blobUtils';


export type DesignMateGenFEASendKind =
  | 'prime-model'
  | 'prime-results'
  | 'screenshot';

export interface DesignMateGenFEABridgeStatus {
  ready: boolean;
  activeConversationId: DConversationId | null;
  activePersonaId: SystemPurposeId | null;
}

export interface DesignMateGenFEASendPayload {
  kind: DesignMateGenFEASendKind;
  text?: string;
  imageDataUrl?: string;
  imageFilename?: string;
}

export interface DesignMateGenFEASendSuccess {
  ok: true;
  conversationId: DConversationId;
  userMessageId: DMessageId;
}

export interface DesignMateGenFEASendError {
  ok: false;
  code: string;
  message: string;
}

export type DesignMateGenFEASendResult =
  | DesignMateGenFEASendSuccess
  | DesignMateGenFEASendError;

export interface DesignMateGenFEABridge {
  getStatus: () => DesignMateGenFEABridgeStatus;
  send: (payload: DesignMateGenFEASendPayload) => Promise<DesignMateGenFEASendResult>;
}

export interface DesignMateGenFEABridgePreparedSendNow {
  mode: 'send-now';
  fragments: (DMessageContentFragment | DMessageAttachmentFragment)[];
  suggestedTitle: string | null;
}

export interface DesignMateGenFEABridgePreparedStageAttachment {
  mode: 'stage-attachment';
  attachmentSource: AttachmentDraftSource;
  attachmentOptions: AttachmentCreationOptions;
  suggestedTitle: string | null;
}

export type DesignMateGenFEABridgePreparedPayload =
  | DesignMateGenFEABridgePreparedSendNow
  | DesignMateGenFEABridgePreparedStageAttachment;

declare global {
  interface Window {
    DesignMateGenFEA?: DesignMateGenFEABridge;
  }
}

const DEFAULT_SCREENSHOT_FILENAME = 'genfea-screenshot.png';
const PROJECT_TITLE_MAX_LENGTH = 120;


export async function prepareDesignMateGenFEABridgePayload(payload: DesignMateGenFEASendPayload): Promise<DesignMateGenFEABridgePreparedPayload> {
  switch (payload.kind) {
    case 'prime-model':
    case 'prime-results': {
      const text = payload.text?.trim();
      if (!text)
        throw new Error('GenFEA text payload was empty.');

      return {
        mode: 'send-now',
        fragments: [createTextContentFragment(text)],
        suggestedTitle: extractDesignMateGenFEAProjectTitle(payload.kind, text),
      };
    }

    case 'screenshot': {
      const imageDataUrl = payload.imageDataUrl?.trim();
      if (!imageDataUrl)
        throw new Error('GenFEA screenshot payload is missing image data.');

      const { base64Data, mimeType } = convert_Base64DataURL_To_Base64WithMimeType(imageDataUrl, 'designmate-genfea-screenshot');
      const imageFilename = payload.imageFilename?.trim() || DEFAULT_SCREENSHOT_FILENAME;
      const imageBlob = await convert_Base64WithMimeType_To_Blob(base64Data, mimeType, 'designmate-genfea-screenshot');
      const imageFile = new File([imageBlob], imageFilename, { type: mimeType }) as any;

      return {
        mode: 'stage-attachment',
        attachmentSource: {
          media: 'file',
          origin: 'screencapture',
          fileWithHandle: imageFile,
          refPath: imageFilename,
        },
        attachmentOptions: {
          hintAddImages: false,
        },
        suggestedTitle: null,
      };
    }
  }
}


export function extractDesignMateGenFEAProjectTitle(kind: Extract<DesignMateGenFEASendKind, 'prime-model' | 'prime-results'>, text: string): string | null {
  const trimmedText = text.trim();
  if (!trimmedText)
    return null;

  const patterns = kind === 'prime-results'
    ? [/(?:^|\r?\n)\s*([^\r\n]+?)\s+Structural Analysis Summary report \(GenFEA\):/i]
    : [/(?:^|\r?\n)\s*GenFEA Structural Analysis model input for:\s*([^\r\n]+)/i];

  for (const pattern of patterns) {
    const match = trimmedText.match(pattern);
    const candidate = sanitizeProjectTitle(match?.[1] ?? null);
    if (candidate)
      return candidate;
  }

  return null;
}


function sanitizeProjectTitle(projectTitle: string | null): string | null {
  if (!projectTitle)
    return null;

  const normalizedTitle = projectTitle
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,\-]+|[\s:;,\-]+$/g, '')
    .trim();

  if (!normalizedTitle)
    return null;

  return normalizedTitle.length > PROJECT_TITLE_MAX_LENGTH
    ? normalizedTitle.slice(0, PROJECT_TITLE_MAX_LENGTH).trimEnd()
    : normalizedTitle;
}
