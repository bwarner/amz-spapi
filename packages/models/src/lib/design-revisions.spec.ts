import { describe, expect, it } from 'vitest';
import {
  addRevision,
  currentRevision,
  DesignError,
  draftRevisions,
  promoteRevision,
  revisionCurrentAt,
  supersededRevisions,
  validateDesign,
  type Design,
  type DesignRevision,
} from './design-revisions.js';

const T = {
  v1: 1_700_000_000_000,
  v2: 1_700_000_100_000,
  v3: 1_700_000_200_000,
  promote2: 1_700_000_300_000,
  promote3: 1_700_000_400_000,
};

const rev = (id: string, createdAt: number): DesignRevision => ({
  revisionId: id,
  assetId: `asset_${id}`,
  fileName: `${id}.ai`,
  mimeType: 'application/illustrator',
  createdAt,
});

const base: Design = {
  designId: 'design_bag250',
  sellerId: 'SELLER1',
  name: 'Geisha Washed 250g bag',
  kind: 'bag',
  skus: ['FB-COF-GEI-250'],
  revisions: [rev('v1', T.v1)],
  currentRevisionId: 'v1',
  createdAt: T.v1,
  updatedAt: T.v1,
};

describe('addRevision', () => {
  it('appends without promoting', () => {
    // Uploading a draft is not a decision to print it. Conflating the two means
    // a fourth draft silently replaces the artwork at the printer.
    const withDraft = addRevision(base, rev('v2', T.v2));
    expect(withDraft.revisions).toHaveLength(2);
    expect(withDraft.currentRevisionId).toBe('v1');
    expect(draftRevisions(withDraft).map((r) => r.revisionId)).toEqual(['v2']);
  });

  it('refuses a duplicate revision id', () => {
    expect(() => addRevision(base, rev('v1', T.v2))).toThrow(DesignError);
  });

  it('never removes anything', () => {
    let design = base;
    for (const [id, at] of [
      ['v2', T.v2],
      ['v3', T.v3],
    ] as const) {
      design = addRevision(design, rev(id, at));
    }
    design = promoteRevision(design, 'v3', T.promote3);
    expect(design.revisions.map((r) => r.revisionId)).toEqual([
      'v1',
      'v2',
      'v3',
    ]);
  });
});

describe('promoteRevision', () => {
  it('supersedes the outgoing revision and records when', () => {
    const design = promoteRevision(
      addRevision(base, rev('v2', T.v2)),
      'v2',
      T.promote2
    );
    expect(design.currentRevisionId).toBe('v2');
    expect(
      design.revisions.find((r) => r.revisionId === 'v1')?.supersededAt
    ).toBe(T.promote2);
    expect(currentRevision(design)?.revisionId).toBe('v2');
    expect(currentRevision(design)?.supersededAt).toBeUndefined();
  });

  it('cannot produce two current revisions', () => {
    // Structural, not enforced: currentRevisionId is one scalar. This test
    // exists to pin that the representation stays that way.
    const design = promoteRevision(
      addRevision(base, rev('v2', T.v2)),
      'v2',
      T.promote2
    );
    expect(typeof design.currentRevisionId).toBe('string');
    expect(validateDesign(design)).toEqual([]);
  });

  it('refuses a revision that is not on the design', () => {
    expect(() => promoteRevision(base, 'nope', T.promote2)).toThrow(
      DesignError
    );
  });

  it('is a no-op when the revision is already current', () => {
    expect(promoteRevision(base, 'v1', T.promote2)).toBe(base);
  });

  it('clears the supersession stamp when rolling back to an older revision', () => {
    // Reverting to v1 must not leave v1 marked as superseded, or it would read
    // as both current and retired.
    let design = promoteRevision(
      addRevision(base, rev('v2', T.v2)),
      'v2',
      T.promote2
    );
    design = promoteRevision(design, 'v1', T.promote3);
    expect(design.currentRevisionId).toBe('v1');
    expect(
      design.revisions.find((r) => r.revisionId === 'v1')?.supersededAt
    ).toBeUndefined();
    expect(
      design.revisions.find((r) => r.revisionId === 'v2')?.supersededAt
    ).toBe(T.promote3);
    expect(validateDesign(design)).toEqual([]);
  });
});

describe('revisionCurrentAt', () => {
  it('answers what was being printed at a past moment', () => {
    // The question a design history exists for. It is how units returned as one
    // product were identified as another.
    let design = addRevision(base, rev('v2', T.v2));
    design = promoteRevision(design, 'v2', T.promote2);

    expect(revisionCurrentAt(design, T.v1 + 1)?.revisionId).toBe('v1');
    expect(revisionCurrentAt(design, T.promote2 + 1)?.revisionId).toBe('v2');
  });

  it('returns nothing before any revision existed', () => {
    expect(revisionCurrentAt(base, T.v1 - 1)).toBeUndefined();
  });
});

describe('supersededRevisions', () => {
  it('lists retired revisions, most recent first', () => {
    let design = addRevision(base, rev('v2', T.v2));
    design = addRevision(design, rev('v3', T.v3));
    design = promoteRevision(design, 'v2', T.promote2);
    design = promoteRevision(design, 'v3', T.promote3);
    expect(supersededRevisions(design).map((r) => r.revisionId)).toEqual([
      'v2',
      'v1',
    ]);
  });
});

describe('validateDesign', () => {
  it('reports a currentRevisionId that names nothing', () => {
    expect(validateDesign({ ...base, currentRevisionId: 'ghost' })).toContain(
      'currentRevisionId ghost names a revision that is not on this design'
    );
  });

  it('reports a current revision that is also superseded', () => {
    const design: Design = {
      ...base,
      revisions: [{ ...rev('v1', T.v1), supersededAt: T.promote2 }],
    };
    expect(validateDesign(design)).toContain(
      'the current revision is also marked superseded'
    );
  });

  it('reports duplicate revision ids', () => {
    const design: Design = {
      ...base,
      revisions: [rev('v1', T.v1), rev('v1', T.v2)],
    };
    expect(validateDesign(design)).toContain(
      'two revisions share a revisionId'
    );
  });

  it('reports revisions stored out of order', () => {
    const design: Design = {
      ...base,
      revisions: [rev('v2', T.v2), rev('v1', T.v1)],
      currentRevisionId: 'v1',
    };
    expect(validateDesign(design)).toContain(
      'revisions are not stored oldest first'
    );
  });

  it('passes a well-formed design', () => {
    expect(validateDesign(base)).toEqual([]);
  });
});
