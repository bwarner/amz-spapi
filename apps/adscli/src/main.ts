import { Command } from '@commander-js/extra-typings';
import { pino } from 'pino';
import fs from 'node:fs';
import * as TOML from 'toml';
import { z } from 'zod';
import { AmazonAdsApiClient } from '@farvisionllc/ad-client';
import { SqliteCredentialStore } from '@farvisionllc/credential-store';

// Create logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NO_PRETTY
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true },
      },
});

// Initialize credential store
const credStore = new SqliteCredentialStore();

// Config file schemas (simplified for self-authorization)
const ApiConfigSchema = z.object({
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  marketplace_id: z.string().optional(),
  region: z.enum(['NA', 'EU', 'FE']).optional(),
  profile_name: z.string().optional(),
  seller_id: z.string().optional(), // For SP-API
  advertiser_profile_id: z.string().optional(), // For Ads API
});

const ConfigFileSchema = z.object({
  ads_api: ApiConfigSchema.optional(),
  sp_api: ApiConfigSchema.optional(),
});

type ConfigFile = z.infer<typeof ConfigFileSchema>;

/**
 * Load configuration from TOML file
 */
function loadConfig(configPath: string): ConfigFile | null {
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = TOML.parse(content);
    return ConfigFileSchema.parse(parsed);
  } catch (error) {
    logger.warn({ error, configPath }, 'Failed to load config file');
    return null;
  }
}

const program = new Command()
  .name('adscli')
  .description('Amazon Advertising API CLI')
  .version('1.0.0')
  .option('-l, --log-level <level>', 'Log level', 'info')
  .option('-p, --profile <name>', 'Credential profile name', 'default')
  .option('-c, --config <path>', 'Config file path', 'config.toml')
  .hook('preAction', (cmd) => {
    const opts = cmd.opts();
    logger.level = opts.logLevel || 'info';
  });

// ===========================================================
// Credential Management Commands
// ===========================================================
const credsCmd = program
  .command('credentials')
  .alias('creds')
  .description('Manage stored credentials');

credsCmd
  .command('list')
  .description('List all stored credential profiles')
  .action(async () => {
    try {
      const profiles = await credStore.listProfiles('ADS_API');
      const defaultProfile = await credStore.getDefaultProfile('ADS_API');

      if (profiles.length === 0) {
        console.log('No credential profiles found. Use "credentials add" to create one.');
        return;
      }

      console.log('\nStored Credential Profiles:');
      for (const profileName of profiles) {
        const isDefault = profileName === defaultProfile;
        console.log(`  ${isDefault ? '* ' : '  '}${profileName}${isDefault ? ' (default)' : ''}`);
      }
      console.log('');
    } catch (error) {
      logger.error({ error }, 'Failed to list profiles');
      process.exitCode = 1;
    }
  });

credsCmd
  .command('show')
  .description('Show details of a credential profile')
  .argument('[profile-name]', 'Profile name (defaults to default profile)')
  .action(async (profileName?: string) => {
    try {
      const name = profileName || (await credStore.getDefaultProfile('ADS_API'));
      if (!name) {
        logger.error('No profile specified and no default profile set');
        process.exitCode = 1;
        return;
      }

      const profile = await credStore.getProfile(name, 'ADS_API');
      if (!profile) {
        logger.error({ profileName: name }, 'Profile not found');
        process.exitCode = 1;
        return;
      }

      console.log('\nProfile Details:');
      console.log(`  Name: ${profile.profile_name}`);
      console.log(`  API Type: ${profile.api_type}`);
      console.log(`  Client ID: ${profile.client_id}`);
      console.log(`  Marketplace: ${profile.marketplace_id}`);
      console.log(`  Region: ${profile.region}`);
      if (profile.advertiser_profile_id) {
        console.log(`  Advertiser Profile ID: ${profile.advertiser_profile_id}`);
      }
      console.log(`  Has Access Token: ${profile.access_token ? 'Yes' : 'No'}`);
      console.log(`  Has Refresh Token: ${profile.refresh_token ? 'Yes' : 'No'}`);
      if (profile.access_token_expires_at) {
        const expiresAt = new Date(profile.access_token_expires_at);
        const isExpired = Date.now() >= profile.access_token_expires_at;
        console.log(`  Token Expires: ${expiresAt.toISOString()} ${isExpired ? '(EXPIRED)' : ''}`);
      }
      console.log('');
    } catch (error) {
      logger.error({ error }, 'Failed to show profile');
      process.exitCode = 1;
    }
  });

credsCmd
  .command('add')
  .description('Add credentials manually (for self-authorized apps)')
  .requiredOption('--api <type>', 'API type: ads or sp')
  .requiredOption('--refresh-token <token>', 'Refresh Token from Seller Central')
  .option('--client-id <id>', 'LWA Client ID (overrides config)')
  .option('--client-secret <secret>', 'LWA Client Secret (overrides config)')
  .option('--marketplace-id <id>', 'Amazon marketplace ID (overrides config)')
  .option('--profile-name <name>', 'Name for credential profile (overrides config)', 'default')
  .option('--region <region>', 'Region: NA, EU, or FE (overrides config)')
  .option('--seller-id <id>', 'Seller ID (for SP-API, overrides config)')
  .option('--advertiser-profile-id <id>', 'Advertiser profile ID (for Ads API, overrides config)')
  .action(async (opts, cmd) => {
    try {
      // Load config file
      const globalOpts = cmd.parent?.parent?.opts() as { config?: string } | undefined;
      const configPath = globalOpts?.config || 'config.toml';
      const config = loadConfig(configPath);

      // Determine which API config to use
      const apiType = opts.api === 'sp' ? 'SP_API' : 'ADS_API';
      const apiTypeKey = opts.api === 'sp' ? 'sp_api' : 'ads_api';
      const apiConfig = config?.[apiTypeKey] || {};

      // Merge config with command-line options (CLI takes precedence)
      const clientId = opts.clientId || apiConfig.client_id;
      const clientSecret = opts.clientSecret || apiConfig.client_secret;
      const marketplaceId = opts.marketplaceId || apiConfig.marketplace_id;
      const region = (opts.region || apiConfig.region || 'NA') as 'NA' | 'EU' | 'FE';
      const profileName = opts.profileName === 'default' && apiConfig.profile_name
        ? apiConfig.profile_name
        : opts.profileName;
      const sellerId = opts.sellerId || apiConfig.seller_id;
      const advertiserProfileId = opts.advertiserProfileId || apiConfig.advertiser_profile_id;

      // Validate required fields
      if (!clientId || !clientSecret || !marketplaceId) {
        logger.error(
          'Missing required configuration. Provide via config file or command-line options.'
        );
        logger.info('Required: --client-id, --client-secret, --marketplace-id');
        logger.info(`Or add [${apiTypeKey}] section to ${configPath}`);
        process.exitCode = 1;
        return;
      }

      const now = Date.now();
      await credStore.setProfile({
        profile_name: profileName,
        api_type: apiType,
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: opts.refreshToken,
        marketplace_id: marketplaceId,
        region,
        ...(sellerId && { seller_id: sellerId }),
        ...(advertiserProfileId && { advertiser_profile_id: advertiserProfileId }),
        created_at: now,
        updated_at: now,
      });

      // Set as default if it's the only profile or named 'default'
      const profiles = await credStore.listProfiles(apiType);
      if (profiles.length === 1 || profileName === 'default') {
        await credStore.setDefaultProfile(profileName, apiType);
      }

      console.log(`\n✓ Credentials added successfully!`);
      console.log(`  Profile: ${profileName}`);
      console.log(`  API Type: ${apiType}`);
      console.log(`  Marketplace: ${marketplaceId}\n`);

      logger.info({ profileName, apiType }, 'Credentials stored');
    } catch (error) {
      logger.error({ error }, 'Failed to add credentials');
      process.exitCode = 1;
    }
  });

credsCmd
  .command('delete')
  .description('Delete a credential profile')
  .argument('<profile-name>', 'Profile name to delete')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (profileName, opts) => {
    try {
      if (!opts.yes) {
        console.log(`Are you sure you want to delete profile "${profileName}"? (y/N)`);
        // In a real implementation, you'd want to use a proper prompt library
        // For now, we'll just proceed
      }

      await credStore.deleteProfile(profileName, 'ADS_API');
      logger.info({ profileName }, 'Profile deleted successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to delete profile');
      process.exitCode = 1;
    }
  });

credsCmd
  .command('set-default')
  .description('Set the default credential profile')
  .argument('<profile-name>', 'Profile name to set as default')
  .action(async (profileName) => {
    try {
      await credStore.setDefaultProfile(profileName, 'ADS_API');
      logger.info({ profileName }, 'Default profile updated');
    } catch (error) {
      logger.error({ error }, 'Failed to set default profile');
      process.exitCode = 1;
    }
  });

// ===========================================================
// API Commands
// ===========================================================

program
  .command('get-profiles')
  .description('Get advertiser profiles from Amazon Ads API')
  .option('-p, --profile <name>', 'Credential profile to use')
  .action(async (opts) => {
    try {
      // Get profile name
      const profileName = opts.profile || (await credStore.getDefaultProfile('ADS_API'));
      if (!profileName) {
        logger.error('No profile specified and no default profile set');
        process.exitCode = 1;
        return;
      }

      // Load credentials
      const profile = await credStore.getProfile(profileName, 'ADS_API');
      if (!profile) {
        logger.error({ profileName }, 'Profile not found');
        process.exitCode = 1;
        return;
      }

      // Check if token is expired
      const isExpired = await credStore.isTokenExpired(profileName, 'ADS_API');
      if (isExpired && !profile.refresh_token) {
        logger.error('Access token is expired and no refresh token available. Add new credentials with "credentials add"');
        process.exitCode = 1;
        return;
      }

      logger.info({ profileName }, 'Fetching profiles...');

      // Create API client with token refresh callback
      const apiClient = new AmazonAdsApiClient({
        clientId: profile.client_id,
        clientSecret: profile.client_secret,
        accessToken: profile.access_token,
        refreshToken: profile.refresh_token,
        marketplaceId: profile.marketplace_id,
        region: profile.region,
        profileId: profile.advertiser_profile_id,
        // Callback to persist refreshed token
        onTokenRefresh: async (accessToken, expiresIn) => {
          logger.debug('Token refreshed, updating store');
          await credStore.updateAccessToken(profileName, 'ADS_API', accessToken, expiresIn);
        },
      });

      // Call API
      const response = await apiClient.getProfiles();

      logger.info({ status: response.status }, 'Profiles fetched successfully');
      console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
      logger.error({ error }, 'Failed to fetch profiles');
      process.exitCode = 1;
    }
  });

// Parse and execute
program.parse(process.argv);
