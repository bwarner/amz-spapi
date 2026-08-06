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
   * Which Vercel deployment may assume this stage's AWS role (#11).
   *
   * All three values end up inside the role's trust policy, so they are the
   * boundary rather than decoration: `teamSlug` selects the OIDC issuer, and
   * `projectName` plus `environment` pin the subject to one deployment target.
   * Absent means the stage grants Vercel no AWS access at all.
   */
  vercel?: {
    teamSlug: string;
    projectName: string;
    environment: 'production' | 'preview';
  };
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
   * Where this stage's Couchbase connection is kept, for Lambdas that read it
   * (#55, [ADR-0010](../../docs/adr/0010-lambdas-reach-couchbase-over-the-data-api.md)).
   *
   * Just a pointer. The host, bucket, scope and login all live inside the
   * secret as one unit, because they change together: a rebuilt cluster has a
   * new hostname AND new users, so splitting them across a template and a
   * secret would leave a window where a function holds one with the other. One
   * secret write moves a whole environment, with no deploy.
   *
   * The cost, accepted deliberately: the bucket and scope are no longer visible
   * in a `cdk diff`. That is tolerable only because ADR-0005 gives each scope
   * its own database user, so a wrong scope fails closed with `access denied`
   * rather than silently reading another environment's data.
   *
   * CDK references the secret by NAME and never holds its contents — creating
   * it would mean either a generated value that is wrong, or the real password
   * in the template. Created out of band by `scripts/couchbase-secret.sh`.
   *
   * Absent means the stage has no Couchbase. Any Lambda declaring
   * `couchbase: true` then fails synth rather than deploying broken.
   */
  couchbase?: {
    /**
     * The Secrets Manager secret holding this environment's whole connection:
     * `{"dataApiUrl","bucket","scope","username","password"}`. Created out of
     * band by `scripts/couchbase-secret.sh` — CDK references it by name and
     * never holds its contents.
     */
    secretName: string;
  };
  /**
   * Where this stage's LWA application credentials are kept (#55).
   *
   * `{"spApiClientId","spApiClientSecret","adsClientId","adsClientSecret"}` in
   * one secret, because the two LWA applications are registered and rotated
   * together, and a stage holding one but not the other would fail at the first
   * token refresh rather than at deploy.
   *
   * These are OUR application's credentials, not a seller's. They mint access
   * tokens from every connected seller's refresh token, which is why they are
   * not an environment variable on either side: a Lambda env var is returned by
   * `GetFunctionConfiguration` to anyone with read access on the function, and
   * in Vercel they were readable in a dashboard.
   *
   * Created out of band by `scripts/amazon-oauth-secret.sh`. Absent means the
   * stage cannot mint tokens; any Lambda declaring
   * `metadata.lambda.amazonCredentials` then fails synth rather than deploying
   * broken.
   */
  amazonOauth?: {
    secretName: string;
  };
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

/**
 * SellAvant's own account. Dev and staging both live here.
 *
 * Staging shares it deliberately: every resource is already named
 * `<app>-<stage>-…`, so the two stages cannot collide, and a second account
 * buys isolation nothing yet depends on. Moving staging out later is a change
 * to one constant.
 */
const SELLAVANT_DEV_ACCOUNT_ID = '853583158600';

/**
 * SellAvant's production account, in the SellAvant OU alongside dev.
 *
 * Not the Organizations management account (132664187310), which is where this
 * used to point, and not SSG's `ssg-prod` (260820062117) — that is a different
 * product in the same organisation.
 */
const SELLAVANT_PROD_ACCOUNT_ID = '108248327073';
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
    // Preview deployments only. Production belongs to the prod stage, in the
    // production account — a dev-account role that trusted Vercel production
    // would let a preview-grade environment decrypt live seller credentials.
    vercel: {
      teamSlug: 'bfwarnergmailcoms-projects',
      projectName: 'sellavant',
      environment: 'preview',
    },
    auth0Domain: envAuth0('dev', 'DOMAIN') || 'sellavant-dev.us.auth0.com',
    auth0Audience: envAuth0('dev', 'AUDIENCE') || 'https://local.sellavant.com',
    alarmEmail: process.env.SELLAVANT_DEV_ALARM_EMAIL,
    couchbase: { secretName: 'sellavant-dev-couchbase' },
    amazonOauth: { secretName: 'sellavant-dev-amazon-oauth' },
  },
  staging: {
    stageName: 'staging',
    // Same account as dev, by decision. Resource names carry the stage, so the
    // two never collide.
    account: envAccount('staging', SELLAVANT_DEV_ACCOUNT_ID),
    region: envRegion('staging'),
    appName: 'sellavant',
    mediaBucketBaseName: 'sellavant-media-assets',
    allowedOrigins: ['https://staging.sellavant.com'],
    retainAssets: true,
    noncurrentObjectExpirationDays: 60,
    auth0Domain: envAuth0('staging', 'DOMAIN'),
    auth0Audience: envAuth0('staging', 'AUDIENCE'),
    alarmEmail: process.env.SELLAVANT_STAGING_ALARM_EMAIL,
    couchbase: { secretName: 'sellavant-staging-couchbase' },
    amazonOauth: { secretName: 'sellavant-staging-amazon-oauth' },
  },
  prod: {
    stageName: 'prod',
    account: envAccount('prod', SELLAVANT_PROD_ACCOUNT_ID),
    region: envRegion('prod'),
    appName: 'sellavant',
    mediaBucketBaseName: 'sellavant-media-assets',
    allowedOrigins: ['https://sellavant.com', 'https://www.sellavant.com'],
    retainAssets: true,
    noncurrentObjectExpirationDays: 90,
    vercel: {
      teamSlug: 'bfwarnergmailcoms-projects',
      projectName: 'sellavant',
      environment: 'production',
    },
    auth0Domain: envAuth0('prod', 'DOMAIN'),
    auth0Audience: envAuth0('prod', 'AUDIENCE'),
    alarmEmail: process.env.SELLAVANT_PROD_ALARM_EMAIL,
    // `couchbase` and `amazonOauth` are deliberately absent, and prod
    // therefore FAILS SYNTH while any Lambda declares `couchbase: true`. That
    // is the intended state, not an oversight.
    //
    // The `prod` scope in the `SellAvantProd` bucket does exist, with its
    // collections. What does not exist is either Secrets Manager secret —
    // `sellavant-prod-couchbase` or `sellavant-prod-amazon-oauth`.
    //
    // Naming them here before they exist would be worse than the current
    // failure: `fromSecretNameV2` resolves by name and checks nothing at synth,
    // so prod would deploy clean and every request would fail at runtime
    // against a secret that was never created. A synth failure names the
    // problem; a runtime one names a missing secret three layers down.
    //
    // To enable prod: create both secrets (`scripts/couchbase-secret.sh prod`,
    // `scripts/amazon-oauth-secret.sh prod`), converge the scope
    // (`couchbase-ddl.ts --env prod --apply`, which as of #55 adds
    // `credentials_locks`), then add both blocks here.
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
