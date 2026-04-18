import * as z from 'zod/v4';

import type { DConversation } from '~/common/stores/chat/chat.conversation';
import type { DesignMateThreadSummary } from '~/modules/designmate/threads';
import type { SystemPurposeId } from '~/modules/designmate/personas';

const designMatePersonaId_schema = z.custom<SystemPurposeId>((value) => typeof value === 'string' && value.length > 0);

export const DesignMateImageInput_schema = z.object({
  base64: z.string().optional(),
  dataUrl: z.string().optional(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  altText: z.string().trim().max(512).optional(),
  filename: z.string().trim().max(512).optional(),
  url: z.string().trim().optional(),
}).refine(input => !!(input.dataUrl || input.url || (input.base64 && input.mimeType)), {
  message: 'Each image requires dataUrl, url, or base64 + mimeType.',
});

export const DesignMateChatRequest_schema = z.object({
  threadId: z.string().trim().min(1),
  prompt: z.string(),
  images: z.array(DesignMateImageInput_schema).max(12).optional(),
  personaId: designMatePersonaId_schema.optional(),
  client: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).refine(input => input.prompt.trim().length > 0 || !!input.images?.length, {
  message: 'A prompt or at least one image is required.',
});

export type DesignMateImageInput = z.infer<typeof DesignMateImageInput_schema>;
export type DesignMateChatRequest = z.infer<typeof DesignMateChatRequest_schema>;

export type DesignMateChatSuccess = {
  ok: true;
  threadId: string;
  conversation: DConversation;
  userMessageId: string;
  assistantMessageId: string;
  assistantText: string;
  updatedAt: number;
};

export type DesignMateApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  threadId?: string;
  conversation?: DConversation;
};

export type DesignMateChatResponse = DesignMateChatSuccess | DesignMateApiError;

export type DesignMateThreadListResponse =
  | { ok: true; threads: DesignMateThreadSummary[]; }
  | DesignMateApiError;

export type DesignMateUiThreadsResponse =
  | { ok: true; conversations: DConversation[]; }
  | DesignMateApiError;
