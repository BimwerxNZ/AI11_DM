import * as React from 'react';

import { useChatStore } from '~/common/stores/chat/store-chats';
import { fetchDesignMateServerThreads, shouldEnableDesignMateServerThreads } from '~/modules/designmate/client/designmate.client';

export function useDesignMateServerThreadsSync(): void {
  React.useEffect(() => {
    if (!shouldEnableDesignMateServerThreads())
      return;

    let cancelled = false;

    const syncThreads = async () => {
      try {
        const response = await fetchDesignMateServerThreads();
        if (cancelled || !response.ok)
          return;

        const { conversations } = useChatStore.getState();
        const existingById = new Map(conversations.map(conversation => [conversation.id, conversation]));

        for (const conversation of response.conversations) {
          const existing = existingById.get(conversation.id);
          const sameUpdated = existing?.updated === conversation.updated;
          const sameMessageCount = existing?.messages.length === conversation.messages.length;
          if (!existing || !sameUpdated || !sameMessageCount)
            useChatStore.getState().upsertConversation(conversation);
        }
      } catch {
        // Server-backed threads are optional in browser mode.
      }
    };

    void syncThreads();

    return () => {
      cancelled = true;
    };
  }, []);
}
