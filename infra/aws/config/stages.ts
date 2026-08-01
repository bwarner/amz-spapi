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
