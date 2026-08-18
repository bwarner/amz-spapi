import type { BackwardNegative, Graduation } from '@farvisionllc/models';
import type { GraduationProposal } from './keyword-harvest.js';
import {
  getGraduation,
  listDueNegatives,
  recordGraduation,
  settleGraduation,
  type StoredGraduation,
} from './funnel-store.js';

/**
 * Applying what a harvest proposed (#147).
 *
 * `planHarvest` decides; nothing here decides anything. This is the half that
 * touches the live ad account, and every rule it follows exists because of a
 * way the two halves of a graduation can come apart.
 *
 * A graduation is TWO obligations separated in time: create the keyword
 * downstream now, and cut the term from upstream once the destination has
 * proved it delivers. Doing both at once is the failure the overlap window
 * exists to prevent — traffic gaps rather than transfers, because a proven
 * source was switched off in favour of an unproven destination.
 *
 * So the dangerous outcome is not an error. It is a keyword created downstream
 * with its upstream negative never applied: the seller is bidding against
 * themselves, their own CPC rises, attribution splits, and nothing says so.
 * Every result type here keeps that state nameable.
 */

/** The write surface an apply needs. Narrowed so tests need no HTTP. */
export type HarvestWriteClient = {
  createKeywords(
    keywords: Array<{
      campaignId: string;
      adGroupId: string;
      keywordText: string;
      matchType: 'EXACT' | 'PHRASE' | 'BROAD';
      bid?: number;
    }>
  ): Promise<{
    success: Array<Record<string, unknown>>;
    error: Array<Record<string, unknown>>;
  }>;
  createNegativeKeywords(
    negativeKeywords: Array<{
      campaignId: string;
      adGroupId: string;
      keywordText: string;
      matchType: 'NEGATIVE_EXACT' | 'NEGATIVE_PHRASE' | 'NEGATIVE_BROAD';
    }>
  ): Promise<{
    success: Array<Record<string, unknown>>;
    error: Array<Record<string, unknown>>;
  }>;
};

export class HarvestApplyError extends Error {}

/** Amazon's per-item 207 error, as a sentence rather than JSON. */
function describeItemError(entry: Record<string, unknown> | undefined): string {
  if (!entry) return 'Amazon returned neither a result nor an error.';
  const inner = entry['errors'];
  if (Array.isArray(inner) && inner.length > 0) {
    const messages = inner
      .map((e) => {
        const o = e as Record<string, unknown>;
        return [o['errorType'], o['message']].filter(Boolean).join(': ');
      })
      .filter(Boolean);
    if (messages.length) return messages.join('; ');
  }
  return typeof entry['message'] === 'string'
    ? entry['message']
    : JSON.stringify(entry);
}

const MATCH_TYPE = {
  broad: 'BROAD',
  phrase: 'PHRASE',
  exact: 'EXACT',
} as const;

const DAY_MS = 86_400_000;

export type ApplyGraduationParams = {
  client: HarvestWriteClient;
  userId: string;
  funnelId: string;
  profileId: string;
  proposal: GraduationProposal;
  /** Injected so the due date is testable. */
  now?: number;
};

export type ApplyGraduationResult =
  | { applied: true; graduation: Graduation; keywordId: string }
  | { applied: false; reason: string; graduation?: Graduation }
  /** Already done. Not a failure, and must not create a second keyword. */
  | { applied: 'already'; graduation: Graduation };

/**
 * Create the downstream keyword and record the graduation.
 *
 * ## The order is the correctness argument
 *
 * The record is written BEFORE Amazon is called, and that is not the obvious
 * order. Creating first and recording after is the ordering that loses data: a
 * crash between the two leaves a keyword live in the account with nothing
 * pointing at it, so the seller is paying for a keyword no report explains, and
 * the next run — finding no graduation — creates it a second time.
 *
 * Recording first leaves the opposite failure, which is the survivable one: a
 * graduation in `proposed` with no `keywordId`. That is visible, it is what the
 * idempotency check below reads, and it costs nothing until resolved.
 *
 * The graduation id is derived by the planner from the normalised term and the
 * edge, so a retry recomputes the same id and lands on the same record.
 */
export async function applyGraduation(
  params: ApplyGraduationParams
): Promise<ApplyGraduationResult> {
  const { client, userId, proposal } = params;
  const now = params.now ?? Date.now();

  const existing = await getGraduation(userId, proposal.graduationId);
  if (existing?.graduation.keywordId) {
    // Idempotent: the keyword exists. Re-creating it would be a duplicate in
    // the same ad group, which Amazon accepts and which splits the term's data.
    return { applied: 'already', graduation: existing.graduation };
  }

  const graduation: Graduation = {
    graduationId: proposal.graduationId,
    funnelId: params.funnelId,
    profileId: params.profileId,
    term: proposal.term,
    variants: proposal.variants,
    fromNodeId: proposal.from.nodeId,
    toNodeId: proposal.to.nodeId,
    fromCampaignId: proposal.from.campaignId,
    fromAdGroupId: proposal.from.adGroupId,
    toCampaignId: proposal.to.campaignId,
    toAdGroupId: proposal.to.adGroupId,
    fromRole: proposal.from.role,
    toRole: proposal.to.role,
    matchType: proposal.matchType,
    keywordId: null,
    bid: proposal.bid,
    sourceCpc: proposal.sourceCpc,
    evidence: proposal.evidence,
    productScopeChecked: proposal.productScopeChecked,
    /**
     * Scheduled, not applied. The negative becomes proposable when the overlap
     * closes AND the destination has delivered — see `dueNegativeDecisions`.
     * Written now so that an obligation which is never met is visible as an
     * overdue row rather than as nothing at all.
     */
    negatives: [
      {
        campaignId: proposal.from.campaignId,
        adGroupId: proposal.from.adGroupId,
        matchType: 'negativeExact',
        negativeKeywordId: null,
        state: 'scheduled',
        dueAt: now + proposal.overlapDays * DAY_MS,
      },
    ],
    state: 'proposed',
    proposedAt: now,
  };

  const written = await recordGraduation({ userId, graduation });
  // A record without a keywordId is a resumable attempt, so reuse it rather
  // than treating the collision as a conflict.
  const record: StoredGraduation = written.stored
    ? written.record
    : written.existing;

  let result;
  try {
    result = await client.createKeywords([
      {
        campaignId: proposal.to.campaignId,
        adGroupId: proposal.to.adGroupId,
        keywordText: proposal.term,
        matchType: MATCH_TYPE[proposal.matchType],
        // The observed CPC, carried from the source. A default bid is the most
        // common cause of "it did worse after I moved it".
        bid: proposal.bid,
      },
    ]);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'Keyword creation failed.';
    const failed = await settleGraduation({
      userId,
      graduationId: proposal.graduationId,
      state: 'failed',
      note: reason,
    });
    return { applied: false, reason, graduation: failed.graduation };
  }

  const keywordId = result.success[0]?.['keywordId'];
  if (typeof keywordId !== 'string') {
    const reason = describeItemError(result.error[0]);
    const failed = await settleGraduation({
      userId,
      graduationId: proposal.graduationId,
      state: 'failed',
      note: reason,
    });
    // The scheduled negative stays on the failed record deliberately. Its state
    // is what a later reconciliation reads to see that nothing was cut for a
    // graduation that never happened.
    return { applied: false, reason, graduation: failed.graduation };
  }

  const settled = await settleGraduation({
    userId,
    graduationId: proposal.graduationId,
    keywordId,
    state: 'applied',
  });
  void record;
  return { applied: true, graduation: settled.graduation, keywordId };
}

/**
 * Whether the destination keyword is actually serving.
 *
 * Supplied by the caller rather than fetched here, because the numbers come
 * from stored report rows and this module does not query. `impressions` is the
 * signal: a keyword with clicks obviously delivers, but one with impressions
 * and no clicks is delivering and losing the click, which is a bid or creative
 * problem rather than a delivery failure — and cutting the source would not fix
 * it.
 */
export type DeliveryEvidence = {
  keywordId: string;
  impressions: number;
  clicks: number;
  /** The window these numbers cover, so a stale check is not mistaken for a dead keyword. */
  from: string;
  to: string;
};

/**
 * A negative that a graduation scheduled, ready to propose.
 *
 * Deliberately NOT a `NegativeProposal`. That type carries a whole `FunnelNode`
 * including its `advertisedProductIds`, because the planner uses product scope
 * to decide whether a term's evidence transfers between ad groups. A graduation
 * record does not store the source node's product list, and filling it with an
 * empty array to satisfy the type would be exactly the "unverified gate that
 * defaults to allowed" this design refuses elsewhere.
 *
 * A negative needs none of it: blocking a term upstream is not a claim about
 * which products it applies to.
 */
export type ScheduledNegative = {
  term: string;
  variants: string[];
  campaignId: string;
  adGroupId: string;
  matchType: 'negativeExact' | 'negativePhrase';
  /** The evidence that justified the graduation this negative completes. */
  evidence: Graduation['evidence'];
};

export type NegativeDecision =
  | {
      propose: true;
      graduationId: string;
      proposal: ScheduledNegative;
      negative: BackwardNegative;
      delivery: DeliveryEvidence;
    }
  | {
      propose: false;
      graduationId: string;
      term: string;
      reason: string;
      /** What a human can actually do about it. Never empty. */
      remedy: string[];
      delivery?: DeliveryEvidence;
    };

export type DueNegativeParams = {
  userId: string;
  profileId?: string;
  /** Keyed by the destination `keywordId`. Absent means "no rows", not zero. */
  delivery: Map<string, DeliveryEvidence>;
  now?: number;
};

/**
 * Which scheduled negatives may now be proposed — and which must not be.
 *
 * The overlap window closing is necessary and NOT sufficient. Before a term is
 * cut from the campaign that has been converting it, the destination must be
 * shown to deliver. Cutting a live source while the destination sits at zero
 * impressions is the one outcome that turns a graduation into lost sales, and
 * it is entirely preventable: the numbers are already stored.
 *
 * A destination that has not delivered produces a REFUSAL with remedies, not
 * silence. Going quiet would leave the seller with a funnel that stopped
 * halfway and no reason for it.
 */
export async function dueNegativeDecisions(
  params: DueNegativeParams
): Promise<NegativeDecision[]> {
  const now = params.now ?? Date.now();
  const due = await listDueNegatives({
    userId: params.userId,
    ...(params.profileId ? { profileId: params.profileId } : {}),
    now,
  });

  return due.map((record): NegativeDecision => {
    const g = record.graduation;
    const scheduled = g.negatives.find((n) => n.state === 'scheduled');

    if (!scheduled) {
      return {
        propose: false,
        graduationId: g.graduationId,
        term: g.term,
        reason: 'No scheduled negative remains on this graduation.',
        remedy: [
          'Nothing to do — it was already applied, skipped or cancelled.',
        ],
      };
    }

    if (!g.keywordId) {
      // Reachable when a graduation failed after its record was written. The
      // negative must never fire: there is no destination to move traffic to.
      return {
        propose: false,
        graduationId: g.graduationId,
        term: g.term,
        reason:
          `"${g.term}" has no destination keyword, so cutting it upstream ` +
          'would remove the traffic without replacing it.',
        remedy: [
          `Retry the graduation into ${g.toCampaignId}, or cancel it so the ` +
            'scheduled negative stops coming due.',
        ],
      };
    }

    const delivery = params.delivery.get(g.keywordId);

    if (!delivery) {
      // Absent rows are not zero impressions. Saying so is the difference
      // between "it is not serving" and "we cannot tell yet".
      return {
        propose: false,
        graduationId: g.graduationId,
        term: g.term,
        reason:
          `No stored performance rows cover the destination keyword for ` +
          `"${g.term}", so whether it is serving is unknown.`,
        remedy: [
          'Sync ads reports for the overlap window, then re-check.',
          'Extending the overlap costs a little self-competition; cutting on ' +
            'unknown delivery risks the traffic entirely.',
        ],
      };
    }

    if (delivery.impressions === 0) {
      return {
        propose: false,
        graduationId: g.graduationId,
        term: g.term,
        reason:
          `The destination keyword for "${g.term}" has served 0 impressions ` +
          `between ${delivery.from} and ${delivery.to}, so the source is still ` +
          'carrying this term.',
        remedy: [
          `Raise the bid above ${g.bid} — it was seeded from a source CPC of ` +
            `${g.sourceCpc}, and the destination's placement modifiers differ.`,
          `Check whether ${g.toCampaignId} is budget-capped; a capped campaign ` +
            'throttles delivery for every keyword in it.',
          'Or extend the overlap and re-check, which costs only mild ' +
            'self-competition.',
        ],
        delivery,
      };
    }

    return {
      propose: true,
      graduationId: g.graduationId,
      negative: scheduled,
      delivery,
      proposal: {
        term: g.term,
        variants: g.variants,
        campaignId: g.fromCampaignId,
        adGroupId: g.fromAdGroupId,
        matchType: scheduled.matchType,
        evidence: g.evidence,
      },
    };
  });
}

export type ApplyNegativeParams = {
  client: HarvestWriteClient;
  userId: string;
  graduationId: string;
  now?: number;
};

export type ApplyNegativeResult =
  | { applied: true; negativeKeywordId: string; graduation: Graduation }
  | { applied: false; reason: string; graduation?: Graduation };

/**
 * Cut the graduated term from its source.
 *
 * Records the outcome on the graduation either way. A failure here is the
 * dangerous partial the module comment names — keyword created downstream,
 * source never cut — so `failed` is written with its reason rather than
 * thrown away, and that state is what makes self-competition visible instead
 * of silent.
 */
export async function applyBackwardNegative(
  params: ApplyNegativeParams
): Promise<ApplyNegativeResult> {
  const { client, userId, graduationId } = params;
  const now = params.now ?? Date.now();

  const record = await getGraduation(userId, graduationId);
  if (!record) throw new HarvestApplyError(`No graduation ${graduationId}.`);
  const g = record.graduation;

  const scheduled = g.negatives.find((n) => n.state === 'scheduled');
  if (!scheduled) {
    return {
      applied: false,
      reason: 'No scheduled negative remains on this graduation.',
      graduation: g,
    };
  }
  if (!g.keywordId) {
    return {
      applied: false,
      reason:
        'The destination keyword was never created, so cutting the source ' +
        'would remove this traffic without replacing it.',
      graduation: g,
    };
  }

  const settleNegative = async (
    patch: Partial<BackwardNegative>
  ): Promise<Graduation> => {
    const negatives = g.negatives.map((n) =>
      n === scheduled ? { ...n, ...patch } : n
    );
    const settled = await settleGraduation({
      userId,
      graduationId,
      negatives,
    });
    return settled.graduation;
  };

  let result;
  try {
    result = await client.createNegativeKeywords([
      {
        campaignId: scheduled.campaignId,
        adGroupId: scheduled.adGroupId,
        keywordText: g.term,
        matchType:
          scheduled.matchType === 'negativePhrase'
            ? 'NEGATIVE_PHRASE'
            : 'NEGATIVE_EXACT',
      },
    ]);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'Negative creation failed.';
    return {
      applied: false,
      reason,
      graduation: await settleNegative({ state: 'failed', note: reason }),
    };
  }

  const negativeKeywordId = result.success[0]?.['keywordId'];
  if (typeof negativeKeywordId !== 'string') {
    const reason = describeItemError(result.error[0]);
    return {
      applied: false,
      reason,
      graduation: await settleNegative({ state: 'failed', note: reason }),
    };
  }

  return {
    applied: true,
    negativeKeywordId,
    graduation: await settleNegative({
      state: 'applied',
      negativeKeywordId,
      appliedAt: now,
    }),
  };
}
