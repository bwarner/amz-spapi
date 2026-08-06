import { Logger } from '@aws-lambda-powertools/logger';
import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';
import { SpApiClient } from '@farvisionllc/sp-client';
import {
  SYNC_JOBS,
  type SyncDomain,
  type SyncJobResult,
} from '@amz-spapi/sp-sync';
import { useSecretsManagerConnection } from '@amz-spapi/couchbase-secrets';

/**
 * Runs one sync job unit per SQS message (#36, ADR-0009).
 *
 * A thin adapter and nothing more: it decodes a message, builds a client,
 * calls the unit, and translates the outcome into what SQS understands. Every
 * decision about windows, cursors and idempotency lives in `sp-sync`, which is
 * what lets the same logic run from a test or a script unchanged.
 *
 * Logging is Powertools (CLAUDE.md §9), not `console`. CloudWatch does not
 * parse OTLP — it parses JSON, and Logs Insights queries it by field — so the
 * useful thing is structured output plus the Lambda context that lets a line be
 * traced back to one invocation. Powertools adds `function_request_id`, cold
 * start and the service name to every record, and correlates with X-Ray when
 * tracing is on. Emitting OTLP here would produce something CloudWatch stores
 * as opaque text; exporting real OTel traces is the ADOT layer, which is a
 * separate decision and not a logging format.
 */

const logger = new Logger({ serviceName: 'sync-worker' });
/**
 * Take the whole Couchbase connection from Secrets Manager.
 *
 * At module scope so it runs once during init and the login is cached for the
 * container's life. A Lambda environment variable is not a secret — it is
 * written into the CloudFormation template and returned by
 * `GetFunctionConfiguration`. See `@amz-spapi/couchbase-secrets`.
 */
useSecretsManagerConnection();

/**
 * Namespace per CLAUDE.md §9.
 *
 * Deliberately few. Lambda already emits invocations, duration, errors and
 * throttles, and SQS emits queue depth and message age — re-publishing any of
 * those costs money and tells nobody anything new. What infrastructure metrics
 * CANNOT see is the failure this system actually has: every invocation
 * succeeding while the data quietly goes stale or is lost for good.
 */
const metrics = new Metrics({
  namespace: 'SellerOps',
  serviceName: 'sync-worker',
});

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
  const credentials = await resolveCredentials(message);
  return new SpApiClient({
    ...credentials,
    sellerId: message.sellerId,
    marketplaceId: message.marketplaceId,
  });
}

/**
 * Everything needed to call SP-API as one seller.
 *
 * A seam, and deliberately NOT environment variables. A Lambda env var is not a
 * secret: it is written into the CloudFormation template, shown in the console,
 * and returned by `GetFunctionConfiguration` to anyone with read access on the
 * function. `LWA_CLIENT_SECRET` mints access tokens from every seller's refresh
 * token, so putting it there would widen the blast radius of read-only Lambda
 * access to every connected account.
 *
 * It belongs in Secrets Manager, fetched at runtime, with the refresh token
 * coming from the credential service (#55) — which exists so the plaintext
 * token never enters a general-purpose runtime at all.
 *
 * Until that lands this throws. A worker that silently ran without credentials
 * would advance cursors over windows it never fetched, which is the single
 * failure the whole cursor design exists to prevent.
 */
async function resolveCredentials(message: SyncMessage): Promise<{
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}> {
  throw new Error(
    `No credential source configured for seller ${message.sellerId}. ` +
      'The worker needs the credential service (#55), which reads the LWA ' +
      'secret from Secrets Manager rather than from the environment.'
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

      metrics.addDimension('domain', message.domain);

      /**
       * How far behind the cursor is, in seconds.
       *
       * THE metric for this system. Every job unit caps the windows it walks per
       * invocation, so a seller can succeed every single night and still fall
       * further behind — `more: true` forever, no errors, no DLQ messages, and a
       * finances cursor drifting toward the 180-day cliff where the data stops
       * existing. Nothing in Lambda or SQS metrics shows that; this does.
       */
      if (result.syncedThrough) {
        metrics.addMetric(
          'SyncLagSeconds',
          MetricUnit.Seconds,
          Math.max(
            0,
            (Date.now() - new Date(result.syncedThrough).getTime()) / 1000
          )
        );
      }
      metrics.addMetric(
        'RecordsWritten',
        MetricUnit.Count,
        result.recordsWritten
      );
      // Work left behind for the next run. Persistently above zero means the
      // per-invocation cap is too small for this seller's backlog.
      metrics.addMetric(
        'WindowsRemaining',
        MetricUnit.Count,
        result.more ? 1 : 0
      );

      // `more` means the seller has further windows to walk. It is NOT an
      // error and must not be reported as a batch failure — the cursor advanced,
      // and the next scheduled run resumes from where this one stopped.
      // Redelivering instead would repeat the windows just completed.
      if (result.historyLost) {
        // Permanent, unrecoverable data loss. Worth an alarm at any value above
        // zero — no future run fills the gap, so this is the one number here
        // that should wake somebody.
        metrics.addMetric('HistoryLost', MetricUnit.Count, 1);
        logger.warn('sync cursor had fallen outside Amazon retention', {
          sellerId: message.sellerId,
          domain: message.domain,
          note: 'the gap is permanent; no future run will fill it',
        });
      }
    } catch (error) {
      // The message id, because that is what the partial batch response names
      // and therefore what ties a log line to the record SQS will redeliver.
      logger.error('sync job failed', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  // Once per invocation, after the loop: EMF puts every metric added since the
  // last flush into one log record, so flushing inside the loop would emit a
  // record per message and multiply the cost of the batch.
  metrics.publishStoredMetrics();
  return { batchItemFailures };
}
