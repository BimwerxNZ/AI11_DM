import type { DConversation, DConversationId } from '~/common/stores/chat/chat.conversation';
import type { DMessageFragment } from '~/common/stores/chat/chat.fragments';
import { getConversation, useChatStore } from '~/common/stores/chat/store-chats';
import { messageFragmentsReduceText } from '~/common/stores/chat/chat.message';
import { getImageAsset } from '~/common/stores/blob/dblobs-portability';
import { isContentOrAttachmentFragment, isImageRefPart, isZyncAssetImageReferencePart } from '~/common/stores/chat/chat.fragments';
import type { DesignMateChatResponse, DesignMateUiThreadsResponse } from '~/modules/designmate/apiSchemas';
import { DesignMateFeatures } from '~/modules/designmate/config';

export class DesignMateClientResponseError extends Error {
  constructor(message: string, readonly responseJson?: DesignMateChatResponse) {
    super(message);
  }
}

export async function fetchDesignMateServerThreads(): Promise<DesignMateUiThreadsResponse> {
  const response = await fetch('/api/designmate/ui/threads', {
    method: 'GET',
    cache: 'no-store',
  });

  const json = await response.json() as DesignMateUiThreadsResponse;
  if (!response.ok)
    throw new DesignMateClientResponseError(json.ok ? 'Unable to load DesignMate threads.' : json.error.message);

  return json;
}

export async function continueDesignMateServerConversation(conversationId: DConversationId, signal?: AbortSignal): Promise<Extract<DesignMateChatResponse, { ok: true }>> {
  const conversation = getConversation(conversationId);
  if (!conversation?.serverThreadId)
    throw new Error('This conversation is not linked to a DesignMate server thread.');

  const lastMessage = conversation.messages[conversation.messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user')
    throw new Error('The DesignMate server conversation has no pending user turn to send.');

  const lastMessageFragments = lastMessage.fragments.filter(isContentOrAttachmentFragment);
  const images = await extractLastUserMessageImages(lastMessageFragments);
  const prompt = messageFragmentsReduceText(lastMessage.fragments, '\n\n', true);

  const response = await fetch('/api/designmate/ui/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      threadId: conversation.serverThreadId,
      prompt,
      images,
      personaId: conversation.systemPurposeId,
      client: {
        source: 'designmate-browser',
      },
    }),
    signal,
  });

  const json = await response.json() as DesignMateChatResponse;
  if (!response.ok || !json.ok)
    throw new DesignMateClientResponseError(json.ok ? 'DesignMate could not continue the server thread.' : json.error.message, json);

  return json;
}

export function upsertDesignMateServerConversation(conversation: DConversation): void {
  useChatStore.getState().upsertConversation(conversation);
}

export function shouldEnableDesignMateServerThreads(): boolean {
  return !!DesignMateFeatures.serverThreads;
}

async function extractLastUserMessageImages(fragments: DMessageFragment[]) {
  const images: {
    base64?: string;
    mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
    altText?: string;
    url?: string;
  }[] = [];

  for (const fragment of fragments) {
    if (!isContentOrAttachmentFragment(fragment))
      continue;

    const part = fragment.part;

    if (isImageRefPart(part)) {
      if (part.dataRef.reftype === 'url') {
        images.push({
          url: part.dataRef.url,
          ...(part.altText ? { altText: part.altText } : {}),
        });
      } else {
        const asset = await getImageAsset(part.dataRef.dblobAssetId);
        if (!asset) continue;

        images.push({
          base64: asset.data.base64,
          mimeType: normalizeBrowserImageMime(asset.data.mimeType || part.dataRef.mimeType),
          ...(part.altText ? { altText: part.altText } : {}),
        });
      }
      continue;
    }

    if (isZyncAssetImageReferencePart(part) && part._legacyImageRefPart) {
      const legacy = part._legacyImageRefPart;
      const asset = await getImageAsset(legacy.dataRef.dblobAssetId);
      if (!asset) continue;

      images.push({
        base64: asset.data.base64,
        mimeType: normalizeBrowserImageMime(asset.data.mimeType || legacy.dataRef.mimeType),
        ...(legacy.altText ? { altText: legacy.altText } : {}),
      });
    }
  }

  return images;
}

function normalizeBrowserImageMime(mimeType: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp')
    return mimeType;
  return 'image/png';
}
