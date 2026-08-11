/**
 * Where this deployment is reachable, for URLs a third party will send a
 * browser back to.
 *
 * Every caller hands the result to somebody else — Auth0 as `redirect_uri`,
 * Stripe as a checkout return URL — and those third parties will only send a
 * browser to a URL that was registered in advance. So the requirement is not
 * merely "a URL that resolves"; it is a url that is the SAME on the next
 * deploy, because a URL nobody can register in advance is a URL that has to be
 * re-registered after every push.
 *
 * `APP_BASE_URL` first, because it is the one value that is deliberately
 * correct: it is what Auth0 already redirects to, and locally it is PORTLESS on
 * purpose — a proxy maps 443 to the dev server, so "fixing" it by appending a
 * port breaks the callback.
 *
 * Then `VERCEL_BRANCH_URL`, not `VERCEL_URL`. Both exist on every deployment
 * and the difference is exactly the one that matters here:
 *
 *   VERCEL_URL         sellavant-4izyez8zc-<team>.vercel.app   ← new every push
 *   VERCEL_BRANCH_URL  sellavant-git-<branch>-<team>.vercel.app ← stable
 *
 * Preferring `VERCEL_URL` meant a preview asked Auth0 to call back on a host
 * that had never existed before that build. The observed failure was a sign-up
 * that reached Auth0, got a valid code, and was then handed to a URL nobody had
 * allowed — or, once allowed, to a host that was gone by the next deployment.
 * The branch URL is registrable once and keeps working.
 *
 * Still distinct from `getBaseUrl()` below, which prefers `VERCEL_URL` because
 * it is for a deployment talking about ITSELF. That is the right answer for
 * "which build am I", and the wrong one for "where do I send the user back to".
 */
export function appBaseUrl(): string {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.VERCEL_BRANCH_URL) {
    return `https://${process.env.VERCEL_BRANCH_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'https://local.sellavant.com';
}

// Dynamic URL detection for different environments
function getBaseUrl() {
  // Vercel automatically sets VERCEL_URL for all deployments
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  // Next.js public Vercel URL (alternative)
  if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
  }

  // Explicit URL override
  if (process.env.NEXT_PUBLIC_URL) {
    return process.env.NEXT_PUBLIC_URL;
  }

  // Local development default
  return 'http://localhost:3000';
}

function getApiUrl() {
  // Explicit API URL override
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  // Default to base URL with /api path
  return `${getBaseUrl()}/api`;
}

export function getConfig() {
  return {
    baseUrl: getBaseUrl(),
    apiUrl: getApiUrl(),

    // Server-side API URL for Lambda/API Gateway calls
    serverApiUrl: process.env.SERVER_API_URL || getApiUrl(),

    // Auth configuration
    auth: {
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      secret: process.env.AUTH0_SECRET,
      audience: process.env.AUTH0_AUDIENCE,
    },

    // Stripe configuration
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY,
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      webhookSecret: process.env.STRIPE_ENDPOINT_SECRET,
      mvsProductId: process.env.STRIPE_MVS_PRODUCT_ID,
      mvsPriceId: process.env.STRIPE_MVS_PRICE_ID,
    },

    // Feature flags
    features: {
      stripeEnabled: !!process.env.STRIPE_SECRET_KEY,
    },
  };
}
