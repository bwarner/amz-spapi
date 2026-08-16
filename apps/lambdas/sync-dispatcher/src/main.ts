import { Logger } from '@aws-lambda-powertools/logger';
import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { executeQuery } from '@amz-spapi/couchbase-utils';
import type { SyncDomain } from '@amz-spapi/sp-sync';
import { useSecretsManagerConnection } from '@amz-spapi/aws-secrets';

/**
 * Scheduled fan-out (#36, ADR-0009).
 *
 * EventBridge Scheduler invokes this; it enumerates connected sellers and puts
 * one message per seller × domain on the queue. It does no SP-API work itself
 * and holds no seller credentials — that separation is the point. A dispatcher
 * that also fetched would inherit every worker's timeout and every seller's
 * rate limit, and one slow account would starve the rest.
 */

const logger = new Logger({ serviceName: 'sync-dispatcher' });
/**
 * Take the whole Couchbase connection from Secrets Manager.
 *
 * At module scope so it runs once during init and the login is cached for the
 * container's life. A Lambda environment variable is not a secret — it is
 * written into the CloudFormation template and returned by
 * `GetFunctionConfiguration`. See `@amz-spapi/aws-secrets`.
 */
useSecretsManagerConnection();

const metrics = new Metrics({
  namespace: 'SellerOps',
  serviceName: 'sync-dispatcher',
});

// The queue URL is not a secret — it is an ARN-shaped identifier, useless
// without IAM. Unlike a client secret, an env var is the right home for it.
const QUEUE_URL = process.env['SYNC_QUEUE_URL'];
const sqs = new SQSClient({});

/** Every domain fanned out per run. Order is irrelevant; the queue reorders. */
const DOMAINS: SyncDomain[] = [
  'finances',
  'settlements',
  'inbound-shipments',
  'inventory-snapshot',
];

/**
 * A seller whose credentials have failed this many times running is skipped.
 *
 * Not deleted and not disabled — skipped, and still visible in the cursor with
 * its error. A revoked authorization otherwise burns a queue message per domain
 * per run forever, and the DLQ fills with the same failure rather than with
 * anything worth reading.
 */
const FAILURE_SHED_THRESHOLD = 10;

export type SyncMessage = {
  userId: string;
  sellerId: string;
  marketplaceId: string;
  domain: SyncDomain;
  /**
   * The connection to mint from (#152).
   *
   * Carried on the message because it is part of the credential document key
   * and the worker cannot derive it: a seller may hold several SP-API profiles,
   * and only this query knows which row produced this message.
   */
  profileName: string;
  /** Stamped by the dispatcher so a worker can measure queue latency. */
  dispatchedAt: string;
};

type SellerRow = {
  user_id: string;
  seller_id: string;
  marketplace_id: string;
  profile_name: string;
};

/**
 * Sellers eligible for a sync run.
 *
 * Only SP_API profiles carrying a `seller_id`: that id is what report and
 * finance data is keyed by, and a profile without one cannot have its results
 * stored anywhere sensible (#70).
 *
 * **Eligibility is `encrypted_secrets`, not `refresh_token`.** Before #55 the
 * token sat in the document in the clear; it is now KMS ciphertext under
 * `encrypted_secrets`, with `has_refresh_token` recording what the ciphertext
 * contains. Filtering on the old field is not merely outdated — it matches
 * nothing, so the dispatcher enqueues zero messages and the run reports success
 * having done nothing at all. That is the exact silent-zero this query has to
 * avoid, which is why the condition names both the ciphertext and the flag.
 *
 * A document from before #55 carries no `has_refresh_token`. Absent is treated
 * as eligible rather than excluded: guessing `false` would silently drop a
 * working connection, while attempting it fails visibly on the cursor and sheds
 * after ten runs. Only an explicit `false` — connected, but with no refresh
 * token to mint from — is excluded.
 *
 * ONE row per user × seller, deliberately. `cursorKey` is
 * `userId::sellerId::domain` with no marketplace in it, so two messages for one
 * seller's two marketplaces would share a cursor and each would advance it past
 * the other's unsynced windows. `MIN` picks the same profile every run rather
 * than an arbitrary one, which matters because the alternative is a seller whose
 * synced marketplace changes between nights. Syncing a seller's *other*
 * marketplaces needs the cursor to carry one, and that is a separate change.
 */
async function eligibleSellers(): Promise<SellerRow[]> {
  // Collections are flat per environment scope (`<domain>_<entity>`, ADR-0005)
  // and `executeQuery` asserts the prefix, so an unqualified `FROM profiles`
  // fails loudly here rather than resolving to nothing at runtime.
  const { rows } = await executeQuery<SellerRow>(
    'credentials',
    `SELECT user_id,
            seller_id,
            MIN(marketplace_id) AS marketplace_id,
            MIN(profile_name) AS profile_name
       FROM credentials_profiles
      WHERE api_type = 'SP_API'
        AND seller_id IS NOT MISSING
        AND profile_name IS NOT MISSING
        AND \`deleted\` IS MISSING
        AND encrypted_secrets IS NOT MISSING
        AND (has_refresh_token IS MISSING OR has_refresh_token = TRUE)
      GROUP BY user_id, seller_id`,
    { readonly: true }
  );
  return rows;
}

/** Cursors that have failed enough times to stop enqueuing for. */
async function shedSellers(): Promise<Set<string>> {
  const { rows } = await executeQuery<{ sellerId: string; domain: string }>(
    'sync',
    `SELECT sellerId, domain FROM sync_cursors
      WHERE consecutiveFailures >= $threshold`,
    { parameters: { threshold: FAILURE_SHED_THRESHOLD }, readonly: true }
  );
  return new Set(rows.map((r) => `${r.sellerId}::${r.domain}`));
}

export async function handler(): Promise<{
  sellers: number;
  enqueued: number;
  shed: number;
}> {
  if (!QUEUE_URL) throw new Error('SYNC_QUEUE_URL is not set');

  const [sellers, shed] = await Promise.all([eligibleSellers(), shedSellers()]);

  const dispatchedAt = new Date().toISOString();
  const messages: SyncMessage[] = [];

  for (const seller of sellers) {
    for (const domain of DOMAINS) {
      if (shed.has(`${seller.seller_id}::${domain}`)) continue;
      messages.push({
        userId: seller.user_id,
        sellerId: seller.seller_id,
        marketplaceId: seller.marketplace_id,
        profileName: seller.profile_name,
        domain,
        dispatchedAt,
      });
    }
  }

  // SendMessageBatch caps at 10.
  for (let i = 0; i < messages.length; i += 10) {
    const batch = messages.slice(i, i + 10);
    await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: QUEUE_URL,
        Entries: batch.map((message, index) => ({
          Id: `${i + index}`,
          MessageBody: JSON.stringify(message),
          // Per SELLER, not per seller × domain. SP-API rate limits are per
          // account, so serialising a seller's whole run is the pacing
          // mechanism — different sellers still proceed in parallel.
          MessageGroupId: message.sellerId,
          // One message per seller × domain per scheduled run. Without this a
          // retried dispatcher invocation would double-enqueue everything, and
          // the workers would spend rate-limit budget re-fetching windows the
          // first copy had already advanced past.
          MessageDeduplicationId: `${message.sellerId}::${message.domain}::${dispatchedAt}`,
        })),
      })
    );
  }

  const summary = {
    sellers: sellers.length,
    enqueued: messages.length,
    shed: shed.size,
  };
  // One line per run, structured. Logs Insights can chart `enqueued` over time
  // straight from this, and a run that suddenly sheds everything is visible
  // without reading the queue.
  logger.info('sync fan-out complete', summary);

  /**
   * `SellersShed` is the one to watch.
   *
   * A shed seller x domain is an authorization that has failed ten runs
   * straight — almost always a revoked or expired connection. Nothing else
   * surfaces it: the sync stops enqueuing that work, so there are no errors, no
   * DLQ messages and no failing alarms. The seller simply stops receiving data
   * and the system reports itself perfectly healthy.
   *
   * `EligibleSellers` is here as its denominator. Shed alone cannot distinguish
   * "one of two hundred" from "all four".
   */
  metrics.addMetric('EligibleSellers', MetricUnit.Count, summary.sellers);
  metrics.addMetric('MessagesEnqueued', MetricUnit.Count, summary.enqueued);
  metrics.addMetric('SellersShed', MetricUnit.Count, summary.shed);
  metrics.publishStoredMetrics();

  return summary;
}
