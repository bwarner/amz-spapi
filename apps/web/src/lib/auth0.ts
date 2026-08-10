import { Auth0Client } from '@auth0/nextjs-auth0/server';
import { appBaseUrl } from './config';

/**
 * Auth0 for v4. Env vars: AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET,
 * AUTH0_SECRET, and the base URL below.
 *
 * `appBaseUrl()` rather than `process.env.APP_BASE_URL` directly, because the
 * fallback matters. This used to default to `https://local.sellavant.com:9443`,
 * so a deployment with no APP_BASE_URL — every preview that is not the staging
 * branch — built its callback and route URLs against LOCALHOST while being
 * served from a vercel.app host. The visible symptom is `/auth/login`
 * redirecting to itself forever, which looks like a routing bug and is not.
 *
 * The helper falls back to `VERCEL_URL`, so a preview describes itself
 * correctly. It is also portless, which the local proxy requires — a port in
 * the callback breaks it.
 */
export const auth0 = new Auth0Client({
  appBaseUrl: appBaseUrl(),
  authorizationParameters: {
    scope: process.env.AUTH0_SCOPE || 'openid profile email',
    audience: process.env.AUTH0_AUDIENCE,
  },
});
