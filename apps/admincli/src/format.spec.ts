import { describe, expect, it } from 'vitest';
import { cell, renderTable } from './format';

/**
 * Admin CLI output.
 *
 * This is the tool reached for when the product has locked everybody out, so
 * its output being readable and machine-parseable is not cosmetic — it is the
 * whole interface. The cases below cover the two ways it has gone wrong:
 * timestamps rendered as raw integers, and columns dropped because only the
 * first row was consulted for the header.
 */

describe('cell', () => {
  it('renders an epoch-millisecond timestamp as an ISO date', () => {
    // Stored as a number throughout the identity collections; unreadable raw.
    expect(cell(1786227194263)).toBe('2026-08-08T22:13:14.263Z');
  });

  it('leaves ordinary numbers alone', () => {
    // A member count must not be mistaken for a date.
    expect(cell(0)).toBe('0');
    expect(cell(7)).toBe('7');
    expect(cell(1_000_000)).toBe('1000000');
  });

  it('renders null and undefined as empty, not as the words', () => {
    // `invitedBy` is null for an owner; printing "null" in a column reads as
    // though somebody named null did the inviting.
    expect(cell(null)).toBe('');
    expect(cell(undefined)).toBe('');
  });

  it('json-encodes nested values', () => {
    expect(cell({ a: 1 })).toBe('{"a":1}');
  });

  it('renders false rather than dropping it', () => {
    // `matchesOwnerList: false` is the single most important field in the
    // `check` output — an empty cell there would invert its meaning.
    expect(cell(false)).toBe('false');
  });
});

describe('renderTable', () => {
  it('says so when there is nothing', () => {
    expect(renderTable([])).toBe('(none)');
  });

  it('includes a column that only some rows have', () => {
    // Invitations carry `acceptedAt` only once accepted. Taking the header from
    // the first row alone would hide it for the whole listing.
    const table = renderTable([
      { id: 'a', status: 'pending' },
      { id: 'b', status: 'accepted', acceptedAt: 1786227194263 },
    ]);

    expect(table).toContain('acceptedAt');
    expect(table).toContain('2026-08-08T22:13:14.263Z');
  });

  it('aligns columns to the widest value', () => {
    const [header, , first] = renderTable([
      { role: 'owner' },
      { role: 'member' },
    ]).split('\n');

    // 'member' (6) is wider than the header 'role' (4), so the header pads.
    expect(header).toBe('role');
    expect(first).toBe('owner');
  });

  it('accepts a single object as well as a list', () => {
    expect(renderTable({ role: 'owner' })).toContain('owner');
  });
});
