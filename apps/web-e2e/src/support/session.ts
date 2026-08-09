import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { hkdf } from '@panva/hkdf';
import * as jose from 'jose';
import type { BrowserContext } from '@playwright/test';

/**
 * Mint an Auth0 session cookie, so the gate can be driven without a real
 * Auth0 tenant.
 *
 * ## Why forge the cookie rather than add a test hook
 *
 * The obvious alternative is a bypass in `lib/auth0.ts` — "if E2E_MOCK_SESSION
 * is set, return this user". That puts a credential-forging branch in
 * production code, where the only thing standing between it and a live
 * environment is an environment variable being unset. This does the same job
 * with nothing shipped: the app is completely unmodified and unaware, and a
 * test that can mint a session is a test that holds `AUTH0_SECRET`, which is
 * exactly the authority a session cookie is supposed to represent.
 *
 * ## The format
 *
 * Mirrors `@auth0/nextjs-auth0` v4's `encrypt()` in `dist/server/cookies.js`:
 * HKDF-SHA256 over the secret with an empty salt and the info string
 * `JWE CEK`, 32 bytes, then a JWE with `alg: dir` and `enc: A256GCM`.
 *
 * This couples the tests to an SDK internal, which is a real cost and worth
 * being honest about. The mitigation is that it fails loudly rather than
 * silently: a format change makes the cookie undecryptable, the app treats the
 * request as signed-out, and the specs fail on the redirect to login instead of
 * quietly passing.
 */

const COOKIE_NAME = '__session';
const ENCRYPTION_INFO = 'JWE CEK';

/**
 * `AUTH0_SECRET` as the running app sees it.
 *
 * Read from the env file rather than `process.env`, because the Playwright
 * process is not the Next.js process — Next loads `.env.local` itself, and
 * nothing exports it into the shell that started the test run.
 */
function auth0Secret(): string {
  const fromEnv = process.env['AUTH0_SECRET'];
  if (fromEnv) return fromEnv;

  // `workspaceRoot`, not `process.cwd()` — Playwright runs with the e2e
  // project as its working directory, so a relative join lands at
  // `apps/web-e2e/apps/web/.env.local`.
  const envPath = join(workspaceRoot, 'apps/web/.env.local');
  let contents: string;
  try {
    contents = readFileSync(envPath, 'utf8');
  } catch {
    throw new Error(
      `Could not read ${envPath} for AUTH0_SECRET. Set AUTH0_SECRET in the ` +
        'environment to run the authenticated e2e specs.'
    );
  }

  for (const line of contents.split('\n')) {
    const match = line.match(/^\s*AUTH0_SECRET\s*=\s*(.*)$/);
    if (!match) continue;
    // Values in this file are variously bare, single- or double-quoted.
    return match[1].trim().replace(/^['"]|['"]$/g, '');
  }

  throw new Error(`No AUTH0_SECRET found in ${envPath}.`);
}

export type MockUser = {
  sub: string;
  email?: string;
  name?: string;
};

/** The session payload shape the SDK stores and `getSession()` reads back. */
function sessionPayload(user: MockUser) {
  const now = Math.floor(Date.now() / 1000);
  return {
    user: {
      sub: user.sub,
      email: user.email,
      email_verified: true,
      name: user.name ?? user.email ?? user.sub,
    },
    tokenSet: {
      // No route under test exchanges this for anything; the private-API hop
      // has its own coverage. It exists because the shape requires it.
      accessToken: 'e2e-access-token',
      idToken: 'e2e-id-token',
      refreshToken: undefined,
      expiresAt: now + 3600,
    },
    internal: { sid: `e2e-${user.sub}`, createdAt: now },
  };
}

export async function mintSessionCookie(user: MockUser): Promise<string> {
  const key = await hkdf('sha256', auth0Secret(), '', ENCRYPTION_INFO, 32);
  return new jose.EncryptJWT(sessionPayload(user))
    .setProtectedHeader({ enc: 'A256GCM', alg: 'dir' })
    .setExpirationTime('1h')
    .encrypt(key);
}

/** Sign the browser context in as `user`. */
export async function signIn(
  context: BrowserContext,
  baseURL: string,
  user: MockUser
): Promise<void> {
  const { hostname } = new URL(baseURL);
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: await mintSessionCookie(user),
      domain: hostname,
      path: '/',
      httpOnly: true,
      secure: baseURL.startsWith('https'),
      sameSite: 'Lax',
    },
  ]);
}

/**
 * A subject that cannot be a member of anything.
 *
 * Randomised per call so the specs stay deterministic against the shared dev
 * scope without seeding or cleaning up: nothing has ever granted this subject
 * a membership, so the gate's answer does not depend on what else is in the
 * database.
 */
export function strangerSub(): string {
  return `auth0|e2e-stranger-${Math.random().toString(36).slice(2, 12)}`;
}
