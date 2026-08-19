import type { NextRequest } from 'next/server';
import { auth0 } from './lib/auth0';
import { capturePromo } from './lib/promo';

export async function middleware(request: NextRequest) {
  const response = await auth0.middleware(request);
  // After Auth0, so the cookie lands on whatever response it produced —
  // including the redirect to the hosted login page, which is precisely the
  // navigation that would otherwise lose `?promo=`.
  return capturePromo(request, response);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     * - brand/ (public brand assets)
     *
     * brand/ is excluded for the same reason favicon.ico is: it is public by
     * definition and fetched by machines outside our control — partner OAuth
     * consoles and email image proxies. Running it through auth turns every
     * logo fetch into a function invocation instead of a cached static hit,
     * and couples the logo's availability to Auth0 being reachable.
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|brand/).*)',
  ],
};
