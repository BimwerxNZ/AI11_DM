import { aixChatGenerateText_Simple } from '~/modules/aix/client/aix.client';

import { excludeSystemMessages } from '~/common/stores/chat/chat.conversation';
import { messageFragmentsReduceText } from '~/common/stores/chat/chat.message';
import { getConversation, useChatStore } from '~/common/stores/chat/store-chats';
import { getDomainModelIdOrThrow } from '~/common/stores/llms/store-llms';


interface AutoConversationTitleOptions {
  heuristicOnly?: boolean;
  silenceErrors?: boolean;
}


function _cleanupTitleCandidate(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`+/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^[-*#>\d\.\)\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _finalizeTitleCandidate(text: string): string | null {
  let candidate = _cleanupTitleCandidate(text);
  if (!candidate)
    return null;

  const labeledMatch = candidate.match(/\b(project title|project|job name|job|title)\s*:\s*(.+)$/i);
  if (labeledMatch?.[2])
    candidate = labeledMatch[2].trim();

  if (/^(hi|hello|hey|thanks|thank you|ok|okay|test|testing)[!.?]*$/i.test(candidate))
    return null;

  const words = candidate.split(/\s+/).filter(Boolean);
  if (!words.length)
    return null;

  candidate = words.slice(0, 8).join(' ');
  if (candidate.length > 64)
    candidate = candidate.slice(0, 64).trimEnd();

  candidate = candidate.replace(/[,:;.!?\-]+$/g, '').trim();
  return candidate || null;
}

function deriveFallbackConversationTitle(conversation: NonNullable<ReturnType<typeof getConversation>>): string | null {
  const messages = excludeSystemMessages(conversation.messages);

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'user')
      continue;

    const messageText = messageFragmentsReduceText(message.fragments).trim();
    if (!messageText)
      continue;

    for (const line of messageText.split('\n')) {
      const fallback = _finalizeTitleCandidate(line);
      if (fallback)
        return fallback;
    }

    const fallback = _finalizeTitleCandidate(messageText);
    if (fallback)
      return fallback;
  }

  return null;
}


/**
 * Creates the AI titles for conversations, by taking the last 5 first-lines and asking AI what's that about
 * @returns true if the title was actually replaced (for instance, it may not be needed)
 */
export async function autoConversationTitle(conversationId: string, forceReplace: boolean, options: AutoConversationTitleOptions = {}): Promise<boolean> {

  // only operate on valid conversations, without any title
  const conversation = getConversation(conversationId);
  if (!conversation || (!forceReplace && (conversation.autoTitle || conversation.userTitle)))
    return false;

  const { setAutoTitle, setUserTitle } = useChatStore.getState();
  const fallbackTitle = deriveFallbackConversationTitle(conversation);
  const applyFallbackTitle = () => {
    if (fallbackTitle) {
      setAutoTitle(conversationId, fallbackTitle);
      return true;
    }
    if (forceReplace)
      setAutoTitle(conversationId, '');
    return false;
  };

  if (forceReplace) {
    setUserTitle(conversationId, '');
    setAutoTitle(conversationId, '✏️...');
  }

  if (options.heuristicOnly)
    return applyFallbackTitle();

  // use valid fast model
  let autoTitleLlmId;
  try {
    autoTitleLlmId = getDomainModelIdOrThrow(['fastUtil'], false, false, 'conversation-titler');
  } catch (_error) {
    return applyFallbackTitle();
  }

  // first line of the last 5 messages
  const historyLines: string[] = excludeSystemMessages(conversation.messages).slice(-5).map(m => {
    const messageText = messageFragmentsReduceText(m.fragments);
    let text = messageText.split('\n')[0];
    text = text.length > 100 ? text.substring(0, 100) + '...' : text;
    text = `${m.role === 'user' ? 'You' : 'Assistant'}: ${text}`;
    return `- ${text}`;
  });


  try {

    // LLM chat-generate call
    let title = await aixChatGenerateText_Simple(
      autoTitleLlmId,
      'You are an AI conversation titles assistant who specializes in creating expressive yet few-words chat titles.',
      `Analyze the given short conversation (every line is truncated) and extract a concise chat title that summarizes the conversation in as little as a couple of words.
Only respond with the lowercase short title and nothing else.

\`\`\`
${historyLines.join('\n')}
\`\`\``,
      'chat-ai-title', conversationId,
    );

    // parse title
    title = title
      ?.trim()
      ?.replaceAll('"', '')
      ?.replace('Title: ', '')
      ?.replace('title: ', '');

    // data write
    if (title) {
      setAutoTitle(conversationId, title);
      return true;
    }

    return applyFallbackTitle();

  } catch (error: any) {
    // not critical at all
    if (!options.silenceErrors)
      console.debug('Auto-title fallback for conversation', conversationId, { error });
    return applyFallbackTitle();
  }
}
