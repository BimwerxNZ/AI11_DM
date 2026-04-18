import { NextResponse } from 'next/server';

import { designMateErrorResponse, DesignMateServiceError, getDesignMateThreadConversation } from '~/modules/designmate/server/designmate.server';
import { DESIGNMATE_APP_TOKEN_HEADER } from '~/modules/designmate/threads';
import { env } from '~/server/env.server';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ threadId: string }> }) {
  try {
    assertDesignMateAppToken(request);
    const { threadId } = await context.params;
    const conversation = await getDesignMateThreadConversation(threadId);
    return NextResponse.json({ ok: true, threadId, conversation });
  } catch (error) {
    const response = designMateErrorResponse(error);
    const status = error instanceof DesignMateServiceError ? error.status : 500;
    return NextResponse.json(response, { status });
  }
}

function assertDesignMateAppToken(request: Request): void {
  const expectedToken = env.DESIGNMATE_APP_TOKEN?.trim();
  if (!expectedToken)
    throw new DesignMateServiceError(503, 'designmate_token_not_configured', 'DesignMate desktop API authentication is not configured. Set DESIGNMATE_APP_TOKEN.');

  const headerToken = request.headers.get(DESIGNMATE_APP_TOKEN_HEADER)
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    || '';

  if (headerToken !== expectedToken)
    throw new DesignMateServiceError(401, 'designmate_invalid_token', 'The DesignMate desktop API token is missing or invalid.');
}
