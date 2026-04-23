import { HeadBucketCommand } from '@aws-sdk/client-s3';
import {
  createAssetS3Client,
  getAssetBucket,
} from '../../../../../lib/media-assets';

export async function GET() {
  try {
    const bucket = getAssetBucket();
    await createAssetS3Client().send(
      new HeadBucketCommand({
        Bucket: bucket,
      })
    );

    return Response.json({
      ok: true,
      bucket,
      region: process.env['AWS_REGION'] || 'us-east-1',
    });
  } catch (error) {
    const message = errorMessage(error);

    return Response.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Media asset health check failed.';
  }

  const details = error as Error & {
    Code?: string;
    code?: string;
    name?: string;
    $metadata?: {
      httpStatusCode?: number;
      requestId?: string;
    };
  };

  return [
    details.name,
    details.Code || details.code,
    details.message,
    details.$metadata?.httpStatusCode
      ? `HTTP ${details.$metadata.httpStatusCode}`
      : undefined,
  ]
    .filter(Boolean)
    .join(': ');
}
