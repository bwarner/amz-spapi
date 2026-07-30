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
