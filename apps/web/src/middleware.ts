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
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
