import { NextResponse } from 'next/server';

import { DesignMateServiceError, getDesignMateAsset } from '~/modules/designmate/server/designmate.server';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const { assetId } = await context.params;
    const asset = await getDesignMateAsset(assetId);
    if (!asset)
      throw new DesignMateServiceError(404, 'designmate_asset_not_found', 'The requested DesignMate asset was not found.');

    const bytes = Buffer.from(asset.base64Data, 'base64');
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Length': bytes.byteLength.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DesignMate asset lookup failed.';
    const status = error instanceof DesignMateServiceError ? error.status : 500;
    return new NextResponse(message, { status });
  }
}
