import { STAGES, type StageConfig } from '../config/stages.js';
import { createAuth0Authorizer, issuerUrl } from './auth0-authorizer.js';

const stage = (overrides: Partial<StageConfig>): StageConfig => ({
  ...STAGES.dev,
  ...overrides,
});

describe('issuerUrl', () => {
  it('appends the trailing slash Auth0 puts in the iss claim', () => {
    // Without it, API Gateway compares "https://t.auth0.com" against the
    // token's "https://t.auth0.com/" and rejects every request — a
    // one-character difference that looks like a broken tenant.
    expect(issuerUrl('sellavant-dev.us.auth0.com')).toBe(
      'https://sellavant-dev.us.auth0.com/'
    );
  });

  it('adds the scheme when the domain is given bare', () => {
    // AUTH0_DOMAIN conventionally has no scheme, so this is the common input.
    expect(issuerUrl('tenant.auth0.com')).toBe('https://tenant.auth0.com/');
  });

  it('leaves an already-complete issuer alone', () => {
    expect(issuerUrl('https://tenant.auth0.com/')).toBe(
      'https://tenant.auth0.com/'
    );
  });

  it('does not double the slash on a scheme-qualified domain', () => {
    expect(issuerUrl('https://tenant.auth0.com')).toBe(
      'https://tenant.auth0.com/'
    );
  });
});

describe('createAuth0Authorizer', () => {
  it('builds an authorizer when the stage has both settings', () => {
    expect(createAuth0Authorizer(STAGES.dev)).toBeDefined();
  });

  it('builds nothing for a stage with neither, so it can deploy unwired', () => {
    const unwired = stage({ auth0Domain: undefined, auth0Audience: undefined });

    expect(createAuth0Authorizer(unwired)).toBeUndefined();
  });

  it('refuses a domain with no audience rather than deploying open', () => {
    // The dangerous half-configuration: it reads as configured and is not.
    const partial = stage({
      auth0Domain: 'tenant.auth0.com',
      auth0Audience: undefined,
    });

    expect(() => createAuth0Authorizer(partial)).toThrowError(
      /only one of auth0Domain \/ auth0Audience/
    );
  });

  it('refuses an audience with no domain', () => {
    const partial = stage({
      auth0Domain: undefined,
      auth0Audience: 'https://api.example.com',
    });

    expect(() => createAuth0Authorizer(partial)).toThrowError(
      /only one of auth0Domain \/ auth0Audience/
    );
  });

  it('names the environment variables that fix a half-configuration', () => {
    const partial = stage({
      stageName: 'staging',
      auth0Domain: 'tenant.auth0.com',
      auth0Audience: undefined,
    });

    expect(() => createAuth0Authorizer(partial)).toThrowError(
      /SELLAVANT_STAGING_AUTH0_DOMAIN/
    );
  });
});
