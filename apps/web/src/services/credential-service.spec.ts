import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-service';
import { CredentialService } from './credential-service';

/**
 * The BFF's credential client (#55).
 *
 * The interesting behaviour is at the edges: a missing profile is an ordinary
 * answer, and the caller's identity is never something this sends.
 */

const OPTIONS = {
  apiUrl: 'https://api.example.com',
  accessToken: 'header.payload.signature',
};

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );

const profile = {
  profile_name: 'sp-ATVPDKIKX0DER-ms3x3t97',
  api_type: 'SP_API' as const,
  client_id: 'amzn1.application-oa2-client.public',
  marketplace_id: 'ATVPDKIKX0DER',
  created_at: 1,
  updated_at: 2,
  has_refresh_token: true,
  has_refresh_token_known: true,
};

describe('listing connections', () => {
  it('sends the access token as a bearer credential', async () => {
    const fetchImpl = respond(200, { profiles: [], defaults: {} });

    await new CredentialService({ ...OPTIONS, fetchImpl }).list();

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Bearer ${OPTIONS.accessToken}`);
  });

  it('never sends a user id', async () => {
    // The Lambda takes identity from the verified token. A user id in the URL
    // would be a parameter the caller controls, which is the whole thing this
    // design avoids — asserted here so it cannot be added casually.
    const fetchImpl = respond(200, { profiles: [], defaults: {} });

    await new CredentialService({ ...OPTIONS, fetchImpl }).list();

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.com/credentials');
  });

  it('passes an apiType filter through', async () => {
    const fetchImpl = respond(200, { profiles: [], defaults: {} });

    await new CredentialService({ ...OPTIONS, fetchImpl }).list('ADS_API');

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.example.com/credentials?apiType=ADS_API'
    );
  });

  it('returns the profiles and defaults', async () => {
    const fetchImpl = respond(200, {
      profiles: [profile],
      defaults: { SP_API: 'sp-default', ADS_API: null },
    });

    const listing = await new CredentialService({
      ...OPTIONS,
      fetchImpl,
    }).list();

    expect(listing.profiles).toHaveLength(1);
    expect(listing.defaults.SP_API).toBe('sp-default');
  });
});

describe('fetching one connection', () => {
  it('escapes the profile name into the path', async () => {
    // Profile names are generated and contain marketplace ids and slugs; one
    // with a slash would otherwise change which route is called.
    const fetchImpl = respond(200, profile);

    await new CredentialService({ ...OPTIONS, fetchImpl }).get(
      'SP_API',
      'a/b?c'
    );

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.example.com/credentials/SP_API/a%2Fb%3Fc'
    );
  });

  it('returns null for a profile that is not there', async () => {
    // "Do I have this connection" is a question with a legitimate no. Throwing
    // would push every caller into a try/catch to ask it.
    const fetchImpl = respond(404, { error: 'NotFound' });

    const result = await new CredentialService({ ...OPTIONS, fetchImpl }).get(
      'SP_API',
      'missing'
    );

    expect(result).toBeNull();
  });

  it('still throws on a real failure', async () => {
    // A 502 is not "no such profile" — swallowing it would show a seller with
    // connections as having none, which reads as data loss.
    const fetchImpl = respond(500, { error: 'boom' });

    await expect(
      new CredentialService({ ...OPTIONS, fetchImpl }).get('SP_API', 'p')
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('still throws when the token is rejected', async () => {
    const fetchImpl = respond(401, { message: 'Unauthorized' });

    await expect(
      new CredentialService({ ...OPTIONS, fetchImpl }).get('SP_API', 'p')
    ).rejects.toMatchObject({ status: 401 });
  });
});
