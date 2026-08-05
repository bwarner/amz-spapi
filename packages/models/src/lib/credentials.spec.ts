import { describe, expect, it } from 'vitest';
import {
  credentialDocKey,
  defaultProfileDocKey,
  toPublicProfile,
  type StoredCredentialProfile,
} from './credentials.js';

/**
 * The credential boundary (#55).
 *
 * `toPublicProfile` decides what leaves the credential service. Everything
 * else in this slice is plumbing; this is the part where a mistake puts a
 * seller's refresh token in an HTTP response.
 */

const stored: StoredCredentialProfile = {
  profile_name: 'default',
  api_type: 'SP_API',
  user_id: 'auth0|abc',
  client_id: 'amzn1.application-oa2-client.public',
  marketplace_id: 'ATVPDKIKX0DER',
  region: 'NA',
  seller_id: 'A2HXBWIE3KMLKV',
  created_at: 1,
  updated_at: 2,
  encrypted_secrets: 'kms:ciphertext-blob',
};

describe('what may cross the boundary', () => {
  it('never returns the encrypted blob', () => {
    // Ciphertext the browser cannot read is still the material. There is no
    // reason for it to travel, so it does not.
    const output = toPublicProfile(stored, { hasRefreshToken: true });

    expect(output).not.toHaveProperty('encrypted_secrets');
    expect(JSON.stringify(output)).not.toContain('ciphertext-blob');
  });

  it('drops a secret that storage grew later', () => {
    // The reason this parses rather than spreads. A deny-list would let any
    // new field ride along into a response, and nothing would report it —
    // the leak is silent by construction.
    const withNewSecret = {
      ...stored,
      refresh_token: 'Atzr|SECRET',
      access_token: 'Atza|SECRET',
      client_secret: 'amzn1.oa2-cs.SECRET',
      some_future_secret: 'SECRET',
    } as unknown as StoredCredentialProfile;

    const serialised = JSON.stringify(
      toPublicProfile(withNewSecret, { hasRefreshToken: true })
    );

    expect(serialised).not.toContain('SECRET');
  });

  it('reports whether a refresh token is held, not what it is', () => {
    // Callers need to know a connection is usable. That is a boolean.
    expect(toPublicProfile(stored, { hasRefreshToken: true })).toMatchObject({
      has_refresh_token: true,
    });
    expect(toPublicProfile(stored, { hasRefreshToken: false })).toMatchObject({
      has_refresh_token: false,
    });
  });

  it('keeps the metadata a caller actually needs', () => {
    // The other half of the property: stripping too much makes the service
    // useless and pushes callers back to the store they are being moved off.
    expect(toPublicProfile(stored, { hasRefreshToken: true })).toMatchObject({
      profile_name: 'default',
      api_type: 'SP_API',
      client_id: 'amzn1.application-oa2-client.public',
      marketplace_id: 'ATVPDKIKX0DER',
      seller_id: 'A2HXBWIE3KMLKV',
      region: 'NA',
    });
  });

  it('passes the access token expiry through, so a caller can pre-empt', () => {
    const output = toPublicProfile(
      { ...stored, access_token_expires_at: 1234 },
      { hasRefreshToken: true }
    );

    expect(output.access_token_expires_at).toBe(1234);
  });
});

describe('document keys', () => {
  it('is stable for a profile', () => {
    // Two runtimes derive this independently now. If it changes, one writes
    // documents the other cannot find — with no error on either side.
    expect(credentialDocKey('default', 'SP_API', 'auth0|abc')).toBe(
      'SP_API::auth0|abc::default'
    );
  });

  it('separates users', () => {
    expect(credentialDocKey('default', 'SP_API', 'auth0|a')).not.toBe(
      credentialDocKey('default', 'SP_API', 'auth0|b')
    );
  });

  it('separates the two APIs', () => {
    // The same seller holds distinct SP-API and Ads credentials under one
    // profile name; collapsing them would hand out the wrong one.
    expect(credentialDocKey('default', 'SP_API', 'u')).not.toBe(
      credentialDocKey('default', 'ADS_API', 'u')
    );
  });

  it('falls back to `default` for an absent user', () => {
    expect(credentialDocKey('p', 'SP_API')).toBe('SP_API::default::p');
    expect(defaultProfileDocKey('SP_API')).toBe('DEFAULT::SP_API::default');
  });

  it('does not collide with the default pointer', () => {
    expect(credentialDocKey('DEFAULT', 'SP_API', 'u')).not.toBe(
      defaultProfileDocKey('SP_API', 'u')
    );
  });
});
