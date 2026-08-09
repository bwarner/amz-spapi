import {
  DeleteObjectsCommand,
  S3Client,
  type ObjectIdentifier,
} from '@aws-sdk/client-s3';
import type { ObjectRef, ObjectStore } from '@amz-spapi/data-rights';

/**
 * S3 deletion for the purge.
 *
 * Lives here rather than in `@amz-spapi/data-rights` so the library stays free
 * of an AWS dependency, and so a caller has to supply one deliberately — a
 * purge that silently skipped the bytes because no store was configured would
 * be the worst possible way to fail.
 *
 * Credentials are left to the default chain: an SSO profile locally, the
 * instance or OIDC role anywhere else. The CLI never carries a key.
 */

/** `DeleteObjects` accepts at most 1000 keys per call. */
const BATCH = 1000;

export function createS3ObjectStore(): ObjectStore {
  const client = new S3Client({
    region: process.env['AWS_REGION'] || 'us-east-1',
  });

  return {
    async deleteObjects(refs: ObjectRef[]) {
      // Objects can span buckets in principle — the reference carries one per
      // row — so group rather than assuming a single configured bucket.
      const byBucket = new Map<string, ObjectIdentifier[]>();
      for (const ref of refs) {
        const keys = byBucket.get(ref.bucket) ?? [];
        keys.push({ Key: ref.key });
        byBucket.set(ref.bucket, keys);
      }

      let deleted = 0;
      const failed: ObjectRef[] = [];

      for (const [bucket, keys] of byBucket) {
        for (let i = 0; i < keys.length; i += BATCH) {
          const chunk = keys.slice(i, i + BATCH);
          try {
            const result = await client.send(
              new DeleteObjectsCommand({
                Bucket: bucket,
                // `Quiet: false` so S3 reports what it deleted. Quiet mode
                // returns only errors, which makes a successful-looking empty
                // response indistinguishable from having deleted nothing.
                Delete: { Objects: chunk, Quiet: false },
              })
            );
            deleted += result.Deleted?.length ?? 0;
            for (const error of result.Errors ?? []) {
              if (error.Key) failed.push({ bucket, key: error.Key });
            }
          } catch {
            // A whole batch failed — the request never landed. Every key in it
            // is unaccounted for and must be reported as such rather than
            // quietly dropped from the tally.
            for (const key of chunk) {
              if (key.Key) failed.push({ bucket, key: key.Key });
            }
          }
        }
      }

      return { deleted, failed };
    },
  };
}
