import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Initialize the Auth0 client for v4
export const auth0 = new Auth0Client({
  // Configuration is loaded from environment variables automatically
  // Required env vars: AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET, APP_BASE_URL
  appBaseUrl: process.env.APP_BASE_URL || 'https://local.sellavant.com:9443',
  authorizationParameters: {
    scope: process.env.AUTH0_SCOPE || 'openid profile email',
    audience: process.env.AUTH0_AUDIENCE,
  }
});
