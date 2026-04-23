import { auth0 } from '../../../../lib/auth0';

type SourceCheckStatus = 'accessible' | 'warning' | 'blocked' | 'invalid';

const AUTH_HINTS = [
  'sign in',
  'sign-in',
  'log in',
  'login',
  'create account',
  'subscribe',
  'subscription',
  'paywall',
  'captcha',
  'verify you are human',
  'access denied',
];

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.startsWith('local.') ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function classifyStatus(status: number): {
  status: SourceCheckStatus;
  message: string;
} {
  if (status === 401 || status === 403) {
    return {
      status: 'blocked',
      message:
        'This source appears to require authentication or blocks access.',
    };
  }

  if (status === 402 || status === 451) {
    return {
      status: 'warning',
      message:
        'This source may be gated, paywalled, or unavailable in this region.',
    };
  }

  if (status >= 400) {
    return {
      status: 'warning',
      message: `This source returned HTTP ${status}. It may not be usable for extraction.`,
    };
  }

  return {
    status: 'accessible',
    message: 'Source appears reachable.',
  };
}

async function readSmallBody(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (
    !contentType.includes('text/html') &&
    !contentType.includes('text/plain')
  ) {
    return '';
  }

  const text = await response.text();
  return text.slice(0, 20_000).toLowerCase();
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let url: URL;
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== 'string') {
      throw new Error('URL is required');
    }
    url = new URL(body.url);
  } catch {
    return Response.json(
      {
        status: 'invalid',
        message: 'Enter a valid source URL.',
      },
      { status: 400 }
    );
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    isPrivateHost(url.hostname)
  ) {
    return Response.json(
      {
        status: 'invalid',
        message: 'Only public http(s) source URLs can be checked.',
      },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SellAvantSourceChecker/1.0; +https://sellavant.com)',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Range: 'bytes=0-20000',
      },
    });

    const classified = classifyStatus(response.status);
    if (classified.status !== 'accessible') {
      return Response.json({
        ...classified,
        httpStatus: response.status,
        finalUrl: response.url,
      });
    }

    const finalUrl = new URL(response.url);
    const bodyText = await readSmallBody(response);
    const matchedHint = AUTH_HINTS.find((hint) => bodyText.includes(hint));
    const redirectedToAuth =
      finalUrl.pathname.toLowerCase().includes('login') ||
      finalUrl.pathname.toLowerCase().includes('signin') ||
      finalUrl.hostname.toLowerCase().includes('auth');

    if (matchedHint || redirectedToAuth) {
      return Response.json({
        status: 'warning',
        message:
          'This source may be gated by login, subscription, captcha, or anti-bot checks.',
        httpStatus: response.status,
        finalUrl: response.url,
      });
    }

    return Response.json({
      status: 'accessible',
      message: 'Source appears reachable.',
      httpStatus: response.status,
      finalUrl: response.url,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Timed out while checking this source.'
        : 'Could not verify this source. It may block automated access.';

    return Response.json({
      status: 'warning',
      message,
    });
  }
}
