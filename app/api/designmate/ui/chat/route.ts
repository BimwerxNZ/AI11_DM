import { NextResponse } from 'next/server';

import { DesignMateChatRequest_schema } from '~/modules/designmate/apiSchemas';
import { designMateErrorResponse, DesignMateServiceError, executeDesignMateChat } from '~/modules/designmate/server/designmate.server';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = DesignMateChatRequest_schema.parse(await request.json());
    const response = await executeDesignMateChat(payload, { signal: request.signal });
    return NextResponse.json(response);
  } catch (error) {
    const response = designMateErrorResponse(error);
    const status = error instanceof DesignMateServiceError ? error.status : 500;
    return NextResponse.json(response, { status });
  }
}
