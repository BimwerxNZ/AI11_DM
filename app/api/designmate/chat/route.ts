import { NextResponse } from 'next/server';

import { DesignMateChatRequest_schema } from '~/modules/designmate/apiSchemas';
import { designMateErrorResponse, DesignMateServiceError, executeDesignMateChat } from '~/modules/designmate/server/designmate.server';
import { DESIGNMATE_APP_TOKEN_HEADER } from '~/modules/designmate/threads';
import { env } from '~/server/env.server';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertDesignMateAppToken(request);
    const payload = DesignMateChatRequest_schema.parse(await request.json());
    const response = await executeDesignMateChat(payload, { signal: request.signal });
    return NextResponse.json(response);
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
