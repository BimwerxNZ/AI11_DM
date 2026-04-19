import type { SystemPurposeId } from '../../data';

import { imageDataToImageAttachmentFragmentViaDBlob } from '~/common/attachment-drafts/attachment.dblobs';
import type { AttachmentDraftSource } from '~/common/attachment-drafts/attachment.types';
import type { DConversationId } from '~/common/stores/chat/chat.conversation';
import type { DMessageId } from '~/common/stores/chat/chat.message';
import { createTextContentFragment, type DMessageAttachmentFragment, type DMessageContentFragment } from '~/common/stores/chat/chat.fragments';
import { convert_Base64DataURL_To_Base64WithMimeType } from '~/common/util/blobUtils';


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

declare global {
  interface Window {
    DesignMateGenFEA?: DesignMateGenFEABridge;
  }
}

const GENFEA_SCREENSHOT_PROMPT = 'Review this structural screenshot in the current context.';
const DEFAULT_SCREENSHOT_FILENAME = 'genfea-screenshot.png';


export async function buildDesignMateGenFEABridgeFragments(payload: DesignMateGenFEASendPayload): Promise<(DMessageContentFragment | DMessageAttachmentFragment)[]> {
  switch (payload.kind) {
    case 'prime-model':
    case 'prime-results': {
      const text = payload.text?.trim();
      if (!text)
        throw new Error('GenFEA text payload was empty.');

      return [createTextContentFragment(text)];
    }

    case 'screenshot': {
      const imageDataUrl = payload.imageDataUrl?.trim();
      if (!imageDataUrl)
        throw new Error('GenFEA screenshot payload is missing image data.');

      const { base64Data, mimeType } = convert_Base64DataURL_To_Base64WithMimeType(imageDataUrl, 'designmate-genfea-screenshot');
      const imageFilename = payload.imageFilename?.trim() || DEFAULT_SCREENSHOT_FILENAME;
      const attachmentTitle = imageFilename.replace(/\.[^.]+$/, '') || 'GenFEA Screenshot';

      // We only need lightweight source metadata here so the resulting local attachment
      // behaves like a native chat image without routing through server-backed threads.
      const source = {
        media: 'file',
        origin: 'screencapture',
        fileWithHandle: new File([], imageFilename, { type: mimeType }) as any,
        refPath: imageFilename,
      } as AttachmentDraftSource;

      const imageAttachment = await imageDataToImageAttachmentFragmentViaDBlob(
        mimeType,
        base64Data,
        source,
        attachmentTitle,
        'Sent from GenFEA',
        false,
        false,
      );

      if (!imageAttachment)
        throw new Error('DesignMate could not prepare the screenshot attachment.');

      return [
        createTextContentFragment(GENFEA_SCREENSHOT_PROMPT),
        imageAttachment,
      ];
    }
  }
}
