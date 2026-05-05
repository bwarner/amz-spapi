export type StageName = 'dev' | 'staging' | 'prod';

export type StageConfig = {
  stageName: StageName;
  account: string;
  region: string;
  appName: string;
  mediaBucketBaseName: string;
  allowedOrigins: string[];
  bedrock: {
    modelIds: string[];
    embeddingModelId: string;
    vercelOidcProviderArn?: string;
    vercelOidcSubject?: string;
    vercelOidcAudience?: string;
  };
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

const envOptional = (name: StageName, key: string) =>
  process.env[`SELLAVANT_${name.toUpperCase()}_${key}`] ||
  process.env[`SELLAVANT_${key}`];

const DEFAULT_BEDROCK_MODELS = [
  'us.anthropic.claude-sonnet-4-6',
  'us.anthropic.claude-haiku-4-5-20251001-v1:0',
];

const DEFAULT_BEDROCK_EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';

const bedrockConfig = (name: StageName): StageConfig['bedrock'] => ({
  modelIds: (
    envOptional(name, 'BEDROCK_MODEL_IDS') || DEFAULT_BEDROCK_MODELS.join(',')
  )
    .split(',')
    .map((modelId) => modelId.trim())
    .filter(Boolean),
  embeddingModelId:
    envOptional(name, 'BEDROCK_EMBEDDING_MODEL_ID') ||
    DEFAULT_BEDROCK_EMBEDDING_MODEL,
  vercelOidcProviderArn: envOptional(name, 'VERCEL_OIDC_PROVIDER_ARN'),
  vercelOidcSubject: envOptional(name, 'VERCEL_OIDC_SUBJECT'),
  vercelOidcAudience: envOptional(name, 'VERCEL_OIDC_AUDIENCE') || 'aws',
});

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
    bedrock: bedrockConfig('dev'),
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
    bedrock: bedrockConfig('staging'),
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
    bedrock: bedrockConfig('prod'),
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
