import {
  collectionName,
  executeQuery,
  getDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import { retentionSeconds } from '@amz-spapi/data-rights';
import type { ReportKind } from './report-registry.js';

/**
 * What the ads report sync has fetched, and what it is waiting on (#145).
 *
 * Two jobs, and both are the reason this is stored rather than derived:
 *
 * **1. A failed sync must not read as "you had no ads activity".** Downstream,
 * the harvest's coverage gate sees only whether rows exist for a window. Absent
 * rows because Amazon rate-limited us and absent rows because the seller ran no
 * ads are indistinguishable in the data itself — and the first is a bug to fix
 * while the second is a fact to report. The run record is what tells them
 * apart, and it is what the staleness line on the AdOps screen reads.
 *
 * **2. Window ownership, so an upload cannot double-count.** Row identity is
 * built from the RAW header names and cell values (`rowIdFor` in
 * report-ingest), which is deliberate — it means a change to our own
 * normalisation cannot re-import history. The consequence is that the same
 * data from two sources does not collide: the console export says
 * `customersearchterm` and `$278.25`, the API says `searchTerm` and `278.25`,
 * so dedup never fires and every row lands twice. A seller who uploads the
 * July export while this sync also holds July would see double the spend, with
 * both figures looking entirely plausible. Recording which windows the sync
 * owns lets the upload path say so instead of silently merging.
 *
 * Keyed on the ADVERTISER PROFILE, not the seller: ads profiles are their own
 * accounts (this seller has four — BR, US, MX, CA), they fail independently,
 * and one profile's rate limit must not look like another's outage.
 */

const SCOPE = 'sync';
const COLLECTION = 'ads_runs';

/** Seam for tests: money-adjacent bookkeeping must be verifiable offline. */
export const adsSyncStorage = { getDocument, upsertDocument, executeQuery };

/**
 * Where a report request has got to.
 *
 * `requested` is a real, durable state rather than a transient one: Amazon is
 * already generating (and billing for) the report, and `reportId` is the only
 * handle on it. Losing that handle means paying for work we then cannot
 * collect.
 */
export type AdsSyncStatus =
  | 'requested'
  | 'ingested'
  | 'failed'
  /** Amazon reported the report itself as FAILED — not our error to retry. */
  | 'rejected';

export type AdsSyncRun = {
  /** `${userId}::${profileId}::${kind}::${from}..${to}` */
  runId: string;
  userId: string;
  /** Advertiser profile id — the ads equivalent of a seller account. */
  profileId: string;
  kind: ReportKind;
  /** Inclusive window the report covers, ISO dates. */
  from: string;
  to: string;
  status: AdsSyncStatus;
  /** Amazon's handle on the generating report. Present from `requested` on. */
  reportId?: string;
  /** Rows actually stored, once ingested. */
  rowsNew?: number;
  rowsDuplicate?: number;
  /** Why it failed, in the words the seller will read. */
  error?: string;
  /** How many polls have been spent, so a stuck report can be given up on. */
  polls?: number;
  requestedAt: string;
  updatedAt: string;
};

/**
 * The kinds this sync fetches — the ads half of `ReportKind`.
 *
 * Declared here rather than in the registry because it is what the UPLOAD path
 * needs: "is this file one the ads sync might already hold?" is the question
 * that gates the overlap check, and the registry has no ads/SP distinction to
 * answer it with.
 */
export const ADS_REPORT_KINDS = [
  'search-term',
  'campaign-performance',
] as const;

export type AdsReportKind = (typeof ADS_REPORT_KINDS)[number];

export function isAdsReportKind(kind: ReportKind): kind is AdsReportKind {
  return (ADS_REPORT_KINDS as readonly ReportKind[]).includes(kind);
}

export class AdsSyncStoreError extends Error {}

export function adsRunId(params: {
  userId: string;
  profileId: string;
  kind: ReportKind;
  from: string;
  to: string;
}): string {
  return [
    params.userId,
    params.profileId,
    params.kind,
    `${params.from}..${params.to}`,
  ].join('::');
}

export async function readAdsRun(runId: string): Promise<AdsSyncRun | null> {
  return adsSyncStorage.getDocument<AdsSyncRun>(SCOPE, COLLECTION, runId);
}

/**
 * Record or update a run. Callers pass only what changed; `requestedAt` is set
 * once and never moved, so the age of a stuck request stays visible.
 */
export async function writeAdsRun(
  run: Omit<AdsSyncRun, 'runId' | 'requestedAt' | 'updatedAt'> &
    Partial<Pick<AdsSyncRun, 'requestedAt'>>
): Promise<AdsSyncRun> {
  const runId = adsRunId(run);
  const existing = await readAdsRun(runId);
  const now = new Date().toISOString();
  const record: AdsSyncRun = {
    ...existing,
    ...run,
    runId,
    requestedAt: existing?.requestedAt ?? run.requestedAt ?? now,
    updatedAt: now,
  };
  await adsSyncStorage.upsertDocument(
    SCOPE,
    COLLECTION,
    runId,
    record,
    // Amazon Information — the 18-month ceiling. Longer than the windows any
    // run describes, so window ownership is never lost while its rows live.
    retentionSeconds()
  );
  return record;
}

/**
 * Runs for a profile, newest first — the staleness answer.
 *
 * Backed by `idx_ads_runs_user_updated`; there is no primary index on this
 * cluster (ADR-0004), so the leading `userId` is required, not merely faster.
 * `profileId` narrows within it and is optional — the upload path has no
 * profile to narrow by, because a console export carries no profile column.
 */
export async function listAdsRuns(params: {
  userId: string;
  profileId?: string;
  kind?: ReportKind;
  limit?: number;
}): Promise<AdsSyncRun[]> {
  if (!params.userId) {
    throw new AdsSyncStoreError('Listing ads sync runs needs a user.');
  }
  const conditions = ['d.`userId` = $userId'];
  const parameters: Record<string, unknown> = {
    userId: params.userId,
    limit: params.limit ?? 50,
  };
  if (params.profileId) {
    conditions.push('d.`profileId` = $profileId');
    parameters['profileId'] = params.profileId;
  }
  if (params.kind) {
    conditions.push('d.`kind` = $kind');
    parameters['kind'] = params.kind;
  }

  const { rows } = await adsSyncStorage.executeQuery<AdsSyncRun>(
    SCOPE,
    `SELECT RAW d FROM \`${collectionName(SCOPE, COLLECTION)}\` AS d
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.\`updatedAt\` DESC
      LIMIT $limit`,
    { parameters, readonly: true }
  );
  return rows;
}

/** An ingested window, and which advertiser profile's sync holds it. */
export type AdsWindow = { from: string; to: string; profileId: string };

/**
 * Windows this sync has successfully ingested for a profile and kind.
 *
 * The overlap check the upload path needs. Only `ingested` runs count: a
 * `requested` run owns nothing yet, and a failed one owns nothing at all —
 * treating either as owned would block an upload that is the seller's only
 * way to get the data in.
 */
export async function ingestedAdsWindows(params: {
  userId: string;
  profileId?: string;
  kind: ReportKind;
}): Promise<AdsWindow[]> {
  const runs = await listAdsRuns({ ...params, limit: 200 });
  return runs
    .filter((run) => run.status === 'ingested')
    .map((run) => ({ from: run.from, to: run.to, profileId: run.profileId }));
}

/**
 * Whether an upload's window collides with one the sync already holds.
 *
 * Any overlap at all, not containment: half a synced window re-imported is
 * half the rows doubled, which is no better for being partial.
 */
export function overlapsIngestedWindow<W extends { from: string; to: string }>(
  windows: W[],
  candidate: { from: string; to: string }
): W | undefined {
  return windows.find(
    (window) => window.from <= candidate.to && candidate.from <= window.to
  );
}
