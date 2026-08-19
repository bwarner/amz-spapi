import { describe, expect, it } from 'vitest';
import {
  AMAZON_INFORMATION_MAX_DAYS,
  retentionDays,
  retentionSeconds,
  retentionSecondsFromEnv,
} from './retention.js';

/**
 * The retention ceiling. Every case here is a way the cap gets exceeded without
 * anyone noticing — which is the only way it ever would be.
 */

describe('retentionDays', () => {
  it('caps at the policy ceiling, however long the caller asks for', () => {
    // The report store asked for 730 days, for a real reason: rows are evidence
    // for reimbursement claims and Amazon's filing windows are long. The reason
    // is good and the ceiling still wins.
    expect(retentionDays(730)).toBe(AMAZON_INFORMATION_MAX_DAYS);
    expect(retentionDays(10_000)).toBe(AMAZON_INFORMATION_MAX_DAYS);
  });

  it('honours a SHORTER request, which is the point of asking', () => {
    expect(retentionDays(90)).toBe(90);
  });

  it('treats an unreadable request as unset, not as zero', () => {
    // A misspelled env var reaches here as NaN. Reading that as zero would set
    // an expiry of now on every write and delete the data as it was stored.
    expect(retentionDays(Number('not-a-number'))).toBe(
      AMAZON_INFORMATION_MAX_DAYS
    );
    expect(retentionDays(undefined)).toBe(AMAZON_INFORMATION_MAX_DAYS);
    expect(retentionDays(0)).toBe(AMAZON_INFORMATION_MAX_DAYS);
    expect(retentionDays(-30)).toBe(AMAZON_INFORMATION_MAX_DAYS);
  });

  it('is 18 months, the figure the Data Protection Policy names', () => {
    expect(AMAZON_INFORMATION_MAX_DAYS).toBe(548);
  });
});

describe('retentionSeconds', () => {
  it('converts to the unit every storage call takes', () => {
    expect(retentionSeconds(1)).toBe(86_400);
    expect(retentionSeconds()).toBe(AMAZON_INFORMATION_MAX_DAYS * 86_400);
  });
});

describe('retentionSecondsFromEnv', () => {
  it('clamps what an environment variable asks for', () => {
    process.env['TEST_RETENTION_DAYS'] = '730';
    expect(retentionSecondsFromEnv('TEST_RETENTION_DAYS')).toBe(
      AMAZON_INFORMATION_MAX_DAYS * 86_400
    );
    process.env['TEST_RETENTION_DAYS'] = '30';
    expect(retentionSecondsFromEnv('TEST_RETENTION_DAYS')).toBe(30 * 86_400);
    delete process.env['TEST_RETENTION_DAYS'];
    expect(retentionSecondsFromEnv('TEST_RETENTION_DAYS')).toBe(
      AMAZON_INFORMATION_MAX_DAYS * 86_400
    );
  });
});
