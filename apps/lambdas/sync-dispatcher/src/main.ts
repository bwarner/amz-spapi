import { Logger } from '@aws-lambda-powertools/logger';
import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { executeQuery } from '@amz-spapi/couchbase-utils';
import type { SyncDomain } from '@amz-spapi/sp-sync';

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
  /** Stamped by the dispatcher so a worker can measure queue latency. */
  dispatchedAt: string;
};

type SellerRow = {
  user_id: string;
  seller_id: string;
  marketplace_id: string;
};

/**
 * Sellers eligible for a sync run.
 *
 * Only SP_API profiles carrying a `seller_id`: that id is what report and
 * finance data is keyed by, and a profile without one cannot have its results
 * stored anywhere sensible (#70).
 */
async function eligibleSellers(): Promise<SellerRow[]> {
  // Collections are flat per environment scope (`<domain>_<entity>`, ADR-0005)
  // and `executeQuery` asserts the prefix, so an unqualified `FROM profiles`
  // fails loudly here rather than resolving to nothing at runtime.
  const { rows } = await executeQuery<SellerRow>(
    'credentials',
    `SELECT DISTINCT user_id, seller_id, marketplace_id
       FROM credentials_profiles
      WHERE api_type = 'SP_API'
        AND seller_id IS NOT MISSING
        AND refresh_token IS NOT MISSING`,
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
