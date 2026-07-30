/**
 * Packaging designs and their revisions.
 *
 * A design is a thing that gets printed — this 250g bag, this shipping carton.
 * A revision is one version of its artwork. Sellers iterate: three drafts of a
 * bag, then a fourth that goes to the printer, and the question "what did we
 * actually print in June" has to stay answerable afterwards.
 *
 * `currentRevisionId` is a single scalar on the design, so "exactly one current
 * revision" is not a rule that could be violated and then checked for — a field
 * cannot hold two values. That is deliberate: the alternative, a `current` flag
 * on each revision, makes two-current a representable state, and anything
 * representable eventually happens.
 *
 * Revisions are only ever appended. Superseding one records when it stopped
 * being current; it never removes it. A design's history is evidence — it is
 * how the units Amazon returned as one product were identified as another.
 */

/** What kind of thing is being printed. */
export type DesignKind =
  | 'bag'
  | 'carton'
  | 'label'
  | 'insert'
  | 'shipper'
  | 'other';

export type DesignRevision = {
  revisionId: string;
  /** The stored file. A printer must be able to get the exact bytes back. */
  assetId: string;
  fileName: string;
  mimeType: string;
  /** What the seller called this draft, e.g. "v3 darker gold". */
  label?: string;
  createdAt: number;
  /**
   * When this revision stopped being current. Absent means it either is current
   * or was never promoted — `currentRevisionId` is what distinguishes those.
   */
  supersededAt?: number;
};

export type Design = {
  designId: string;
  sellerId: string;
  /** Human name, e.g. "Geisha Washed 250g bag". */
  name: string;
  kind: DesignKind;
  /** Seller SKUs this design is printed for. A bag can serve several. */
  skus: string[];
  /** Append-only, oldest first. */
  revisions: DesignRevision[];
  /**
   * The revision at the printer. Absent until one is promoted: uploading a
   * draft must not silently change what is being printed.
   */
  currentRevisionId?: string;
  createdAt: number;
  updatedAt: number;
};

export class DesignError extends Error {}

export function currentRevision(design: Design): DesignRevision | undefined {
  if (!design.currentRevisionId) return undefined;
  return design.revisions.find(
    (revision) => revision.revisionId === design.currentRevisionId
  );
}

/** Revisions that were once current, most recently superseded first. */
export function supersededRevisions(design: Design): DesignRevision[] {
  return design.revisions
    .filter((revision) => revision.supersededAt != null)
    .sort((a, b) => (b.supersededAt ?? 0) - (a.supersededAt ?? 0));
}

/** Drafts that have never been promoted. */
export function draftRevisions(design: Design): DesignRevision[] {
  return design.revisions.filter(
    (revision) =>
      revision.supersededAt == null &&
      revision.revisionId !== design.currentRevisionId
  );
}

/**
 * Append a revision. Does NOT promote it.
 *
 * Uploading a draft is not a decision to print it, and conflating the two would
 * mean a fourth draft silently replaced the artwork at the printer.
 */
export function addRevision(design: Design, revision: DesignRevision): Design {
  if (design.revisions.some((r) => r.revisionId === revision.revisionId)) {
    throw new DesignError(
      `Revision ${revision.revisionId} is already on design ${design.designId}.`
    );
  }
  return {
    ...design,
    revisions: [...design.revisions, revision],
    updatedAt: revision.createdAt,
  };
}

/**
 * Make a revision the current one, superseding whatever was current.
 *
 * `at` is passed in rather than read from the clock so the result is a pure
 * function of its inputs and can be tested without freezing time.
 */
export function promoteRevision(
  design: Design,
  revisionId: string,
  at: number
): Design {
  const target = design.revisions.find((r) => r.revisionId === revisionId);
  if (!target) {
    throw new DesignError(
      `Revision ${revisionId} is not on design ${design.designId}, so it cannot be promoted.`
    );
  }
  if (design.currentRevisionId === revisionId) return design;

  return {
    ...design,
    revisions: design.revisions.map((revision) => {
      // Stamp the outgoing current revision, and clear any stamp on the
      // incoming one so promoting an older revision back is not recorded as
      // that revision having been superseded.
      if (revision.revisionId === design.currentRevisionId) {
        return { ...revision, supersededAt: at };
      }
      if (revision.revisionId === revisionId) {
        const { supersededAt: _dropped, ...rest } = revision;
        return rest;
      }
      return revision;
    }),
    currentRevisionId: revisionId,
    updatedAt: at,
  };
}

/**
 * Which revision was current at a point in time.
 *
 * Answers "what did we print in June", which is the question a design history
 * exists for. Returns undefined when nothing had been promoted yet.
 */
export function revisionCurrentAt(
  design: Design,
  at: number
): DesignRevision | undefined {
  // A revision was current at `at` if it was promoted by then and had not yet
  // been superseded. Promotion time is not stored directly, so it is derived:
  // the current revision covers from the last supersession onwards.
  const candidates = design.revisions.filter(
    (revision) => revision.createdAt <= at
  );

  const stillCurrent = candidates.find(
    (revision) =>
      revision.revisionId === design.currentRevisionId &&
      revision.supersededAt == null
  );
  const supersededAfter = candidates
    .filter((r) => r.supersededAt != null && (r.supersededAt as number) > at)
    .sort((a, b) => (a.supersededAt ?? 0) - (b.supersededAt ?? 0));

  // The earliest revision superseded after `at` was the one in force then. If
  // none was, the design's current revision was already in force.
  return supersededAfter[0] ?? stillCurrent;
}

/**
 * Invariants that must hold for a stored design.
 *
 * Returns problems rather than throwing, so a malformed document read back from
 * storage can be reported instead of crashing a page.
 */
export function validateDesign(design: Design): string[] {
  const problems: string[] = [];

  const ids = design.revisions.map((r) => r.revisionId);
  if (new Set(ids).size !== ids.length) {
    problems.push('two revisions share a revisionId');
  }

  if (design.currentRevisionId && !currentRevision(design)) {
    problems.push(
      `currentRevisionId ${design.currentRevisionId} names a revision that is not on this design`
    );
  }

  const current = currentRevision(design);
  if (current?.supersededAt != null) {
    problems.push('the current revision is also marked superseded');
  }

  const ordered = [...design.revisions].sort(
    (a, b) => a.createdAt - b.createdAt
  );
  if (ordered.some((r, i) => r.revisionId !== design.revisions[i].revisionId)) {
    problems.push('revisions are not stored oldest first');
  }

  return problems;
}
