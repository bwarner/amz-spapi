export type StageName = 'dev' | 'staging' | 'prod';

export type StageConfig = {
  stageName: StageName;
  account: string;
  region: string;
  appName: string;
  mediaBucketBaseName: string;
  allowedOrigins: string[];
  retainAssets: boolean;
  noncurrentObjectExpirationDays: number;
  /**
   * The Auth0 tenant that issues the access tokens the API accepts, and the
   * API identifier those tokens must be addressed to (#54).
   *
   * Neither is a secret: both appear in every token the browser already holds,
   * and API Gateway needs them at synth time to build the authorizer. Secrets
   * Manager is for the client secret, which the API never sees — validation is
   * signature-based against the tenant's public JWKS.
   *
   * A stage that omits these deploys its routes **unauthenticated**, which the
   * stack warns about loudly rather than failing on, so a stage can be stood up
   * before its Auth0 API exists.
   */
  auth0Domain?: string;
  auth0Audience?: string;
  /**
   * Where alarms are sent. Unset creates the topic and the alarms without a
   * subscription — they still record in the console, and an alarm nobody
   * subscribed to is more use than no alarm at all.
   */
  alarmEmail?: string;
  /**
   * 4xx in 5 minutes before the API's client-error alarm fires. A placeholder
   * until there is traffic to baseline against: 401s are ordinary, so this is
   * watching for the flood that means the authorizer itself is broken.
   */
  clientErrorAlarmThreshold?: number;
};

const MANAGEMENT_ACCOUNT_ID = '132664187310';
const SHARED_SERVICES_ACCOUNT_ID = '058264463518';
const SELLAVANT_DEV_ACCOUNT_ID = '853583158600';
const DEFAULT_REGION = 'us-east-1';

const envAccount = (name: StageName, fallback: string) =>
  process.env[`SELLAVANT_${name.toUpperCase()}_ACCOUNT_ID`] ||
  process.env.SELLAVANT_AWS_ACCOUNT_ID ||
  fallback;

const envRegion = (name: StageName) =>
  process.env[`SELLAVANT_${name.toUpperCase()}_REGION`] ||
  process.env.SELLAVANT_AWS_REGION ||
  process.env.CDK_DEFAULT_REGION ||
  DEFAULT_REGION;

/**
 * Auth0 settings, overridable per stage without a code change.
 *
 * Only dev has a committed fallback, because only dev's tenant is known here.
 * staging and prod read from the environment and are otherwise undefined, which
 * leaves their routes unauthenticated and loudly warned about — a wrong tenant
 * baked into a template would be worse, since it would look configured and
 * reject every real token.
 */
const envAuth0 = (name: StageName, key: 'DOMAIN' | 'AUDIENCE') =>
  process.env[`SELLAVANT_${name.toUpperCase()}_AUTH0_${key}`] ||
  process.env[`SELLAVANT_AUTH0_${key}`] ||
  undefined;

export const STAGES: Record<StageName, StageConfig> = {
  dev: {
    stageName: 'dev',
    account: envAccount('dev', SELLAVANT_DEV_ACCOUNT_ID),
    region: envRegion('dev'),
    appName: 'sellavant',
    mediaBucketBaseName: 'sellavant-media-assets',
    allowedOrigins: [
      'https://local.sellavant.com:9443',
      'https://localhost:9443',
      'http://localhost:3000',
    ],
    retainAssets: false,
    noncurrentObjectExpirationDays: 30,
    auth0Domain: envAuth0('dev', 'DOMAIN') || 'sellavant-dev.us.auth0.com',
    auth0Audience: envAuth0('dev', 'AUDIENCE') || 'https://local.sellavant.com',
    alarmEmail: process.env.SELLAVANT_DEV_ALARM_EMAIL,
  },
  staging: {
    stageName: 'staging',
    account: envAccount('staging', SHARED_SERVICES_ACCOUNT_ID),
    region: envRegion('staging'),
    appName: 'sellavant',
    mediaBucketBaseName: 'sellavant-media-assets',
    allowedOrigins: ['https://staging.sellavant.com'],
    retainAssets: true,
    noncurrentObjectExpirationDays: 60,
    auth0Domain: envAuth0('staging', 'DOMAIN'),
    auth0Audience: envAuth0('staging', 'AUDIENCE'),
    alarmEmail: process.env.SELLAVANT_STAGING_ALARM_EMAIL,
  },
  prod: {
    stageName: 'prod',
    account: envAccount('prod', MANAGEMENT_ACCOUNT_ID),
    region: envRegion('prod'),
    appName: 'sellavant',
    mediaBucketBaseName: 'sellavant-media-assets',
    allowedOrigins: ['https://sellavant.com', 'https://www.sellavant.com'],
    retainAssets: true,
    noncurrentObjectExpirationDays: 90,
    auth0Domain: envAuth0('prod', 'DOMAIN'),
    auth0Audience: envAuth0('prod', 'AUDIENCE'),
    alarmEmail: process.env.SELLAVANT_PROD_ALARM_EMAIL,
  },
};

export function getStageConfig(stageName: string | undefined): StageConfig {
  const normalized = (stageName || 'dev') as StageName;
  const config = STAGES[normalized];
  if (!config) {
    throw new Error(
      `Unknown stage "${stageName}". Expected one of: ${Object.keys(
        STAGES
      ).join(', ')}`
    );
  }
  return config;
}
