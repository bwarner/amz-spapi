import { SpApiClient } from '@farvisionllc/sp-client';
import {
  SYNC_JOBS,
  type SyncDomain,
  type SyncJobResult,
} from '@amz-spapi/sp-sync';

/**
 * Runs one sync job unit per SQS message (#36, ADR-0009).
 *
 * A thin adapter and nothing more: it decodes a message, builds a client,
 * calls the unit, and translates the outcome into what SQS understands. Every
 * decision about windows, cursors and idempotency lives in `sp-sync`, which is
 * what lets the same logic run from a test or a script unchanged.
 */

export type SqsRecord = {
  messageId: string;
  body: string;
  receiptHandle?: string;
};

export type SqsEvent = { Records: SqsRecord[] };

/**
 * SQS partial batch response.
 *
 * Reporting individual failures rather than throwing is the difference between
 * retrying one seller and retrying ten. Throwing fails the WHOLE batch, so nine
 * sellers whose sync already succeeded are redelivered — and every one of them
 * re-runs against Amazon, spending rate-limit budget to redo completed work.
 * This requires `reportBatchItemFailures` on the event source; without it the
 * response is ignored and the batch behaviour silently reverts.
 */
export type SqsBatchResponse = {
  batchItemFailures: Array<{ itemIdentifier: string }>;
};

type SyncMessage = {
  userId: string;
  sellerId: string;
  marketplaceId: string;
  domain: SyncDomain;
  dispatchedAt?: string;
};

/**
 * Credentials for one seller.
 *
 * Resolved per message rather than per invocation: a batch can hold several
 * sellers, and a client built once would carry the wrong account's refresh
 * token into the rest of the batch — which authenticates successfully and
 * returns another seller's data.
 */
async function clientFor(message: SyncMessage): Promise<SpApiClient> {
  const clientId = process.env['LWA_CLIENT_ID'];
  const clientSecret = process.env['LWA_CLIENT_SECRET'];
  const refreshToken = await resolveRefreshToken(message);

  if (!clientId || !clientSecret) {
    throw new Error('LWA_CLIENT_ID / LWA_CLIENT_SECRET are not configured');
  }
  return new SpApiClient({
    clientId,
    clientSecret,
    refreshToken,
    sellerId: message.sellerId,
    marketplaceId: message.marketplaceId,
  });
}

/**
 * The stored refresh token for this seller.
 *
 * Deliberately a seam rather than an inline Couchbase read: the credential
 * slice is moving behind its own service (#55), and decryption needs KMS with
 * the same encryption context the web app uses (#11). Until that lands this
 * throws rather than reading a half-configured store — a worker that silently
 * ran with no credentials would advance cursors over windows it never fetched,
 * which is the one failure the whole cursor design exists to prevent.
 */
async function resolveRefreshToken(message: SyncMessage): Promise<string> {
  throw new Error(
    `No credential source configured for seller ${message.sellerId}. ` +
      'The worker needs the credential slice (#55) and KMS decryption (#11) ' +
      'before it can run against a real account.'
  );
}

export async function handler(event: SqsEvent): Promise<SqsBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records ?? []) {
    try {
      const message = JSON.parse(record.body) as SyncMessage;
      const job = SYNC_JOBS[message.domain];
      if (!job) {
        // An unknown domain will never succeed, so retrying it until the
        // redrive policy gives up wastes every one of those attempts. Straight
        // to the DLQ, where it can be read.
        throw new Error(`Unknown sync domain: ${message.domain}`);
      }

      const result: SyncJobResult = await job({
        userId: message.userId,
        sellerId: message.sellerId,
        marketplaceId: message.marketplaceId,
        client: await clientFor(message),
        now: new Date(),
      });

      // `more` means the seller has further windows to walk. It is NOT an
      // error and must not be reported as a batch failure — the cursor advanced,
      // and the next scheduled run resumes from where this one stopped.
      // Redelivering instead would repeat the windows just completed.
      if (result.historyLost) {
        console.warn(
          JSON.stringify({
            message: 'sync cursor had fallen outside Amazon retention',
            sellerId: message.sellerId,
            domain: message.domain,
            note: 'the gap is permanent; no future run will fill it',
          })
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          message: 'sync job failed',
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
