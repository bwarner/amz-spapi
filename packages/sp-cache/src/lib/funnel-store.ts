/**
 * Funnels and the graduations that have crossed them (#147).
 *
 * Two collections rather than the one the issue sketched. `ads.funnels` was to
 * hold `graduations: [...]` inline, and that shape breaks on both axes that
 * matter here:
 *
 * - **Growth.** A funnel accrues graduations for as long as it runs. Embedding
 *   them makes the funnel document grow without bound, and every edge edit then
 *   rewrites years of history to change one threshold.
 * - **Concurrency.** A graduation is touched twice, days apart — once when the
 *   keyword is created, once when the backward negative comes due. Two writers
 *   on one document means the later one can silently drop the earlier one's
 *   `keywordId`, which is the single field the whole design calls load-bearing.
 *
 * Separate documents also make the id do real work: `graduationId` is
 * deterministic on (funnel, edge, term family), so it IS the idempotency key. A
 * retried run computes the same key, finds the document, and proposes nothing —
 * rather than creating a second keyword for a term that already graduated.
 */

import {
  collectionName,
  executeQuery,
  getDocument as getCouchbaseDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import {
  FunnelSchema,
  GraduationSchema,
  type BackwardNegative,
  type Funnel,
  type Graduation,
  type GraduationState,
} from '@farvisionllc/models';

/** Seam for tests: ESM exports are read-only and cannot be monkey-patched. */
export const funnelStorage = {
  executeQuery,
  upsertDocument,
  getDocument: getCouchbaseDocument,
};

const SCOPE = 'ads';
const FUNNELS = 'funnels';
const GRADUATIONS = 'graduations';

export class FunnelStoreError extends Error {}

export type StoredFunnel = {
  /** `${userId}::${funnelId}` — the Couchbase key, ownership included. */
  key: string;
  userId: string;
  funnel: Funnel;
  storedAt: number;
  updatedAt: number;
};

export type StoredGraduation = {
  /** `${userId}::${graduationId}` — deterministic, and the idempotency key. */
  key: string;
  userId: string;
  graduation: Graduation;
  storedAt: number;
  updatedAt: number;
};

function funnelKey(userId: string, funnelId: string): string {
  return `${userId}::${funnelId}`;
}

function graduationKey(userId: string, graduationId: string): string {
  return `${userId}::${graduationId}`;
}

/**
 * Store a funnel, or replace the one already there.
 *
 * Validated on the way in: a funnel with an edge pointing at a node that does
 * not exist would not fail until a harvest ran against it, days later and
 * somewhere else entirely.
 */
export async function storeFunnel(params: {
  userId: string;
  funnel: Funnel;
}): Promise<StoredFunnel> {
  const { userId } = params;
  if (!userId) throw new FunnelStoreError('A funnel needs an owner.');

  const funnel = FunnelSchema.parse(params.funnel);
  assertEdgesResolve(funnel);

  const key = funnelKey(userId, funnel.funnelId);
  const existing = await funnelStorage.getDocument<StoredFunnel>(
    SCOPE,
    FUNNELS,
    key
  );

  const now = Date.now();
  const record: StoredFunnel = {
    key,
    userId,
    funnel,
    storedAt: existing?.storedAt ?? now,
    updatedAt: now,
  };
  await funnelStorage.upsertDocument(SCOPE, FUNNELS, key, record);
  return record;
}

/**
 * Every edge must join two nodes that exist, and no node may feed itself.
 *
 * A self-edge is not a harmless no-op: it would propose graduating a term into
 * the very ad group whose delivery produced the evidence, then schedule a
 * negative for that same term in the same ad group — creating and blocking one
 * keyword in a single run.
 */
function assertEdgesResolve(funnel: Funnel): void {
  const ids = new Set(funnel.nodes.map((node) => node.nodeId));
  if (ids.size !== funnel.nodes.length) {
    throw new FunnelStoreError('Two nodes share a nodeId.');
  }
  for (const edge of funnel.edges) {
    if (!ids.has(edge.from)) {
      throw new FunnelStoreError(`Edge source ${edge.from} is not a node.`);
    }
    if (!ids.has(edge.to)) {
      throw new FunnelStoreError(`Edge target ${edge.to} is not a node.`);
    }
    if (edge.from === edge.to) {
      throw new FunnelStoreError(`Edge ${edge.from} feeds itself.`);
    }
  }
}

export async function getFunnel(
  userId: string,
  funnelId: string
): Promise<StoredFunnel | null> {
  const record = await funnelStorage.getDocument<StoredFunnel>(
    SCOPE,
    FUNNELS,
    funnelKey(userId, funnelId)
  );
  // Ownership is checked here rather than trusted from the key, so a guessed
  // id cannot read another seller's funnel.
  if (!record || record.userId !== userId) return null;
  return record;
}

export async function listFunnels(params: {
  userId: string;
  profileId?: string;
  limit?: number;
}): Promise<StoredFunnel[]> {
  if (!params.userId) throw new FunnelStoreError('A listing needs a user.');

  const conditions = ['f.`userId` = $userId'];
  const parameters: Record<string, unknown> = { userId: params.userId };
  if (params.profileId) {
    conditions.push('f.`funnel`.`profileId` = $profileId');
    parameters['profileId'] = params.profileId;
  }

  const { rows } = await funnelStorage.executeQuery<StoredFunnel>(
    SCOPE,
    `SELECT RAW f FROM \`${collectionName(SCOPE, FUNNELS)}\` f
     WHERE ${conditions.join(' AND ')}
     ORDER BY f.\`funnel\`.\`name\`
     LIMIT $limit`,
    { parameters: { ...parameters, limit: params.limit ?? 100 } }
  );
  return rows;
}

/**
 * Write a graduation for the first time, refusing if one already exists.
 *
 * The refusal is the point. `graduationId` is deterministic, so a second call
 * for the same term over the same edge means either a retry or two runs racing
 * — and in both cases the correct outcome is to keep the first record, not to
 * overwrite the evidence and bid that an earlier decision was actually made on.
 *
 * NOT atomic against a concurrent writer: the read and the write are separate
 * calls, so two runs starting together can both see nothing. Harvests are
 * scheduled and human-approved rather than concurrent, and the downstream
 * create is what actually costs money, so this is a guard against retries
 * rather than a lock. `insertDocument` would close the gap and is the change to
 * make if harvests ever run in parallel.
 */
export async function recordGraduation(params: {
  userId: string;
  graduation: Graduation;
}): Promise<
  | { stored: true; record: StoredGraduation }
  | { stored: false; existing: StoredGraduation }
> {
  const { userId } = params;
  if (!userId) throw new FunnelStoreError('A graduation needs an owner.');

  const graduation = GraduationSchema.parse(params.graduation);
  const key = graduationKey(userId, graduation.graduationId);
  const existing = await funnelStorage.getDocument<StoredGraduation>(
    SCOPE,
    GRADUATIONS,
    key
  );
  if (existing && existing.userId === userId) {
    return { stored: false, existing };
  }

  const now = Date.now();
  const record: StoredGraduation = {
    key,
    userId,
    graduation,
    storedAt: now,
    updatedAt: now,
  };
  await funnelStorage.upsertDocument(SCOPE, GRADUATIONS, key, record);
  return { stored: true, record };
}

export async function getGraduation(
  userId: string,
  graduationId: string
): Promise<StoredGraduation | null> {
  const record = await funnelStorage.getDocument<StoredGraduation>(
    SCOPE,
    GRADUATIONS,
    graduationKey(userId, graduationId)
  );
  if (!record || record.userId !== userId) return null;
  return record;
}

/**
 * Record what became of a graduation once it was applied.
 *
 * `keywordId` is written here and never rewritten: it is how the graduation is
 * later measured and how the delivery gate decides whether the source may be
 * cut. A second apply that produced a different keyword is a duplicate to
 * investigate, not a value to overwrite — so it is refused rather than merged.
 */
export async function settleGraduation(params: {
  userId: string;
  graduationId: string;
  keywordId?: string;
  state?: GraduationState;
  negatives?: BackwardNegative[];
  note?: string;
}): Promise<StoredGraduation> {
  const existing = await getGraduation(params.userId, params.graduationId);
  if (!existing) {
    throw new FunnelStoreError(`No graduation ${params.graduationId}.`);
  }

  const current = existing.graduation.keywordId;
  if (params.keywordId && current && current !== params.keywordId) {
    throw new FunnelStoreError(
      `Graduation ${params.graduationId} already created keyword ${current}; ` +
        `refusing to replace it with ${params.keywordId}. Two keywords for one ` +
        'graduation means a duplicate downstream — investigate rather than overwrite.'
    );
  }

  const graduation = GraduationSchema.parse({
    ...existing.graduation,
    keywordId: params.keywordId ?? current,
    state: params.state ?? existing.graduation.state,
    negatives: params.negatives ?? existing.graduation.negatives,
    note: params.note ?? existing.graduation.note,
    appliedAt:
      params.state === 'applied'
        ? existing.graduation.appliedAt ?? Date.now()
        : existing.graduation.appliedAt,
  });

  const record: StoredGraduation = {
    ...existing,
    graduation,
    updatedAt: Date.now(),
  };
  await funnelStorage.upsertDocument(SCOPE, GRADUATIONS, record.key, record);
  return record;
}

export type ListGraduationsFilters = {
  userId: string;
  funnelId?: string;
  state?: GraduationState;
  limit?: number;
};

/** One seller's graduations, newest decision first. */
export async function listGraduations(
  filters: ListGraduationsFilters
): Promise<StoredGraduation[]> {
  if (!filters.userId) throw new FunnelStoreError('A listing needs a user.');

  const conditions = ['g.`userId` = $userId'];
  const parameters: Record<string, unknown> = { userId: filters.userId };
  if (filters.funnelId) {
    conditions.push('g.`graduation`.`funnelId` = $funnelId');
    parameters['funnelId'] = filters.funnelId;
  }
  if (filters.state) {
    conditions.push('g.`graduation`.`state` = $state');
    parameters['state'] = filters.state;
  }

  const { rows } = await funnelStorage.executeQuery<StoredGraduation>(
    SCOPE,
    `SELECT RAW g FROM \`${collectionName(SCOPE, GRADUATIONS)}\` g
     WHERE ${conditions.join(' AND ')}
     ORDER BY g.\`graduation\`.\`proposedAt\` DESC
     LIMIT $limit`,
    { parameters: { ...parameters, limit: filters.limit ?? 200 } }
  );
  return rows;
}

/**
 * Backward negatives whose overlap window has closed and which nobody applied.
 *
 * This query IS the self-competition detector the design asks for. A negative
 * that came due and was never applied means the seller is still bidding against
 * themselves on a term they graduated weeks ago — invisible in every Amazon
 * report, because to Amazon these are simply two unrelated campaigns.
 *
 * Returns the whole graduation rather than the negative alone: acting on one
 * needs the destination keyword too, since the negative must not be applied
 * until the destination is actually serving.
 */
export async function listDueNegatives(params: {
  userId: string;
  /** Epoch ms. Passed in rather than read from a clock, so tests are honest. */
  now: number;
  funnelId?: string;
  limit?: number;
}): Promise<StoredGraduation[]> {
  if (!params.userId) throw new FunnelStoreError('A listing needs a user.');

  const conditions = [
    'g.`userId` = $userId',
    // Only an APPLIED graduation can owe a negative: nothing downstream is
    // serving yet for one that is merely proposed, so cutting the source would
    // strand the term with no keyword anywhere.
    "g.`graduation`.`state` = 'applied'",
    'ANY n IN g.`graduation`.`negatives` ' +
      "SATISFIES n.`state` = 'scheduled' AND n.`dueAt` <= $now END",
  ];
  const parameters: Record<string, unknown> = {
    userId: params.userId,
    now: params.now,
  };
  if (params.funnelId) {
    conditions.push('g.`graduation`.`funnelId` = $funnelId');
    parameters['funnelId'] = params.funnelId;
  }

  const { rows } = await funnelStorage.executeQuery<StoredGraduation>(
    SCOPE,
    `SELECT RAW g FROM \`${collectionName(SCOPE, GRADUATIONS)}\` g
     WHERE ${conditions.join(' AND ')}
     ORDER BY g.\`graduation\`.\`proposedAt\`
     LIMIT $limit`,
    { parameters: { ...parameters, limit: params.limit ?? 100 } }
  );
  return rows;
}
