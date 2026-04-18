import type { DConversation } from '~/common/stores/chat/chat.conversation';
import type { SystemPurposeId } from '~/modules/designmate/personas';

export const DESIGNMATE_APP_TOKEN_HEADER = 'x-designmate-app-token';
export const DESIGNMATE_SERVER_CONVERSATION_PREFIX = 'designmate-server:';
export const DESIGNMATE_ASSET_PATH_PREFIX = '/api/designmate/assets/';

export function designMateServerConversationId(threadId: string): string {
  return `${DESIGNMATE_SERVER_CONVERSATION_PREFIX}${threadId}`;
}

export function toDesignMateServerConversation(conversation: DConversation, threadId: string): DConversation {
  return {
    ...conversation,
    id: designMateServerConversationId(threadId),
    threadSource: 'designmate-server',
    serverThreadId: threadId,
    _abortController: null,
  };
}

export type DesignMateThreadSummary = {
  threadId: string;
  title: string;
  created: number;
  updated: number;
  systemPurposeId: SystemPurposeId;
  lastMessageText: string | null;
};
