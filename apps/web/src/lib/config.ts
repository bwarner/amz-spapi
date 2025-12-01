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
      audience: process.env.AUTH0_AUDIENCE
    },

    // Stripe configuration
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY,
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      webhookSecret: process.env.STRIPE_ENDPOINT_SECRET,
      mvsProductId: process.env.STRIPE_MVS_PRODUCT_ID,
      mvsPriceId: process.env.STRIPE_MVS_PRICE_ID
    },

    // Feature flags
    features: {
      stripeEnabled: !!process.env.STRIPE_SECRET_KEY
    }
  };
}
