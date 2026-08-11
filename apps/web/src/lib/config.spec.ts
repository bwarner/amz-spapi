import { afterEach, describe, expect, it } from 'vitest';
import { appBaseUrl } from './config';

/**
 * The base URL a third party sends the browser back to.
 *
 * Worth testing despite being four lines, because every way it can be wrong is
 * invisible in this repository and only shows up as a failed sign-in on a
 * deployment: the URL still resolves, it is simply not the one anybody
 * registered. The precedence IS the behaviour.
 */

const KEYS = ['APP_BASE_URL', 'VERCEL_BRANCH_URL', 'VERCEL_URL'] as const;
const saved = new Map<string, string | undefined>();

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

describe('appBaseUrl', () => {
  it('prefers the configured value over anything Vercel supplies', () => {
    setEnv({
      APP_BASE_URL: 'https://staging.sellavant.com',
      VERCEL_BRANCH_URL: 'sellavant-git-staging-team.vercel.app',
      VERCEL_URL: 'sellavant-4izyez8zc-team.vercel.app',
    });

    expect(appBaseUrl()).toBe('https://staging.sellavant.com');
  });

  it('drops a trailing slash, which would double up in every joined path', () => {
    setEnv({ APP_BASE_URL: 'https://staging.sellavant.com/' });

    expect(appBaseUrl()).toBe('https://staging.sellavant.com');
  });

  it('keeps a configured URL portless', () => {
    // Locally a proxy maps 443 to the dev server. Appending the dev port here
    // would produce a callback Auth0 redirects to and nothing serves.
    setEnv({ APP_BASE_URL: 'https://local.sellavant.com' });

    expect(appBaseUrl()).toBe('https://local.sellavant.com');
  });

  it('uses the branch URL, not the per-deployment URL, on a preview', () => {
    // The whole point. VERCEL_URL is new on every push, so a callback built
    // from it can never be registered with Auth0 or Stripe in advance.
    setEnv({
      VERCEL_BRANCH_URL: 'sellavant-git-staging-team.vercel.app',
      VERCEL_URL: 'sellavant-4izyez8zc-team.vercel.app',
    });

    expect(appBaseUrl()).toBe('https://sellavant-git-staging-team.vercel.app');
  });

  it('falls back to the deployment URL when there is no branch URL', () => {
    setEnv({ VERCEL_URL: 'sellavant-4izyez8zc-team.vercel.app' });

    expect(appBaseUrl()).toBe('https://sellavant-4izyez8zc-team.vercel.app');
  });

  it('falls back to the local host when nothing is set', () => {
    setEnv({});

    expect(appBaseUrl()).toBe('https://local.sellavant.com');
  });
});
