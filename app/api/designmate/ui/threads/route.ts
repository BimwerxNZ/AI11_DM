import { NextResponse } from 'next/server';

import { DesignMateServiceError, designMateErrorResponse, listDesignMateUiConversations } from '~/modules/designmate/server/designmate.server';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const conversations = await listDesignMateUiConversations();
    return NextResponse.json({ ok: true, conversations });
  } catch (error) {
    const response = designMateErrorResponse(error);
    const status = error instanceof DesignMateServiceError ? error.status : 500;
    return NextResponse.json(response, { status });
  }
}
