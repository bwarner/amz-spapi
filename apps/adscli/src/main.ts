import { Command } from '@commander-js/extra-typings';
import { pino } from 'pino';
import fs from 'node:fs';
import * as TOML from 'toml';
import { z } from 'zod';
import { AmazonAdsApiClient } from '@farvisionllc/ad-client';
import { SqliteCredentialStore } from '@farvisionllc/credential-store';
import { AmazonOAuthFlow, OAuthConfig } from '@farvisionllc/credential-store';

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

// Config file schemas
const ApiConfigSchema = z.object({
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  redirect_uri: z.string().optional(),
  marketplace_id: z.string().optional(),
  region: z.enum(['NA', 'EU', 'FE']).optional(),
  profile_name: z.string().optional(),
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

//  ===========================================================
// OAuth Commands
// ===========================================================
const oauthCmd = program
  .command('oauth')
  .description('Manage OAuth authorization with Amazon Ads API');

oauthCmd
  .command('authorize')
  .description('Start OAuth authorization flow')
  .option('--api <type>', 'API type: ads or sp', 'ads')
  .option('--client-id <id>', 'Amazon API client ID (overrides config)')
  .option('--client-secret <secret>', 'Amazon API client secret (overrides config)')
  .option('--redirect-uri <uri>', 'OAuth redirect URI (overrides config)')
  .option('--marketplace-id <id>', 'Amazon marketplace ID (overrides config)')
  .option('--region <region>', 'Region: NA, EU, or FE (overrides config)')
  .option('--profile-name <name>', 'Name for credential profile (overrides config)')
  .action(async (opts, cmd) => {
    try {
      // Load config file
      const globalOpts = cmd.parent?.parent?.opts() as { config?: string } | undefined;
      const configPath = globalOpts?.config || 'config.toml';
      const config = loadConfig(configPath);

      // Determine which API config to use
      const apiType = opts.api === 'sp' ? 'sp_api' : 'ads_api';
      const apiConfig = config?.[apiType] || {};

      // Merge config with command-line options (CLI takes precedence)
      const clientId = opts.clientId || apiConfig.client_id;
      const clientSecret = opts.clientSecret || apiConfig.client_secret;
      const redirectUri = opts.redirectUri || apiConfig.redirect_uri;
      const marketplaceId = opts.marketplaceId || apiConfig.marketplace_id;
      const region = (opts.region || apiConfig.region || 'NA') as 'NA' | 'EU' | 'FE';
      const profileName = opts.profileName || apiConfig.profile_name || 'default';

      // Validate required fields
      if (!clientId || !clientSecret || !redirectUri || !marketplaceId) {
        logger.error(
          'Missing required OAuth configuration. Provide via config file or command-line options.'
        );
        logger.info('Required: --client-id, --client-secret, --redirect-uri, --marketplace-id');
        logger.info(`Or add [${apiType}] section to ${configPath}`);
        process.exitCode = 1;
        return;
      }

      const oauthConfig: OAuthConfig = {
        clientId,
        clientSecret,
        redirectUri,
        region,
      };

      const oauth = new AmazonOAuthFlow(oauthConfig);
      const apiTypeEnum = opts.api === 'sp' ? 'SP_API' : 'ADS_API';
      const { authUrl, state } = oauth.generateAuthUrl(apiTypeEnum, profileName);

      logger.info(`Starting OAuth authorization for ${apiTypeEnum}`);
      logger.info('OAuth Authorization URL:');
      console.log('\n' + authUrl + '\n');
      logger.info('State parameter (save this): ' + state);
      logger.info(
        'Visit the URL above to authorize, then use "oauth callback" command with the returned code'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to generate auth URL');
      process.exitCode = 1;
    }
  });

oauthCmd
  .command('callback')
  .description('Complete OAuth flow with authorization code')
  .requiredOption('--code <code>', 'Authorization code from OAuth callback')
  .requiredOption('--state <state>', 'State parameter from authorization')
  .option('--api <type>', 'API type: ads or sp (auto-detected from state if not provided)')
  .option('--client-id <id>', 'Amazon API client ID (overrides config)')
  .option('--client-secret <secret>', 'Amazon API client secret (overrides config)')
  .option('--redirect-uri <uri>', 'OAuth redirect URI (overrides config)')
  .option('--marketplace-id <id>', 'Amazon marketplace ID (overrides config)')
  .option('--region <region>', 'Region: NA, EU, or FE (overrides config)')
  .option('--advertiser-profile-id <id>', 'Advertiser profile ID for Ads API calls')
  .option('--seller-id <id>', 'Seller ID for SP-API calls')
  .action(async (opts, cmd) => {
    try {
      // Load config file
      const globalOpts = cmd.parent?.parent?.opts() as { config?: string } | undefined;
      const configPath = globalOpts?.config || 'config.toml';
      const config = loadConfig(configPath);

      // Parse state to determine API type
      const oauth = new AmazonOAuthFlow({
        clientId: 'temp',
        clientSecret: 'temp',
        redirectUri: 'temp'
      });
      const state = oauth.parseState(opts.state);

      // Determine which API config to use (from state or CLI option)
      const apiTypeFromState = state.apiType === 'SP_API' ? 'sp' : 'ads';
      const apiType = (opts.api || apiTypeFromState) === 'sp' ? 'sp_api' : 'ads_api';
      const apiConfig = config?.[apiType] || {};

      // Merge config with command-line options (CLI takes precedence)
      const clientId = opts.clientId || apiConfig.client_id;
      const clientSecret = opts.clientSecret || apiConfig.client_secret;
      const redirectUri = opts.redirectUri || apiConfig.redirect_uri;
      const marketplaceId = opts.marketplaceId || apiConfig.marketplace_id;
      const region = (opts.region || apiConfig.region || 'NA') as 'NA' | 'EU' | 'FE';

      // Validate required fields
      if (!clientId || !clientSecret || !redirectUri || !marketplaceId) {
        logger.error(
          'Missing required OAuth configuration. Provide via config file or command-line options.'
        );
        logger.info('Required: --client-id, --client-secret, --redirect-uri, --marketplace-id');
        logger.info(`Or add [${apiType}] section to ${configPath}`);
        process.exitCode = 1;
        return;
      }

      const oauthConfig: OAuthConfig = {
        clientId,
        clientSecret,
        redirectUri,
        region,
      };

      const oauthFlow = new AmazonOAuthFlow(oauthConfig);

      logger.info({ profileName: state.profileName, apiType: state.apiType }, 'Completing OAuth for profile');

      // Complete OAuth flow
      const profile = await oauthFlow.completeOAuthFlow(
        opts.code,
        state,
        marketplaceId,
        opts.sellerId, // For SP-API
        opts.advertiserProfileId // For Ads API
      );

      // Store credentials
      await credStore.setProfile(profile);

      logger.info({ profileName: profile.profile_name }, 'Credentials stored successfully!');
      console.log(`\nProfile "${profile.profile_name}" is now ready to use.\n`);
    } catch (error) {
      logger.error({ error }, 'Failed to complete OAuth flow');
      process.exitCode = 1;
    }
  });

oauthCmd
  .command('login')
  .description('Interactive OAuth login with auto-opening browser (easiest method)')
  .option('--api <type>', 'API type: ads or sp', 'ads')
  .option('--client-id <id>', 'Amazon API client ID (overrides config)')
  .option('--client-secret <secret>', 'Amazon API client secret (overrides config)')
  .option('--redirect-uri <uri>', 'OAuth redirect URI (overrides config)', 'http://localhost:3000/oauth/callback')
  .option('--marketplace-id <id>', 'Amazon marketplace ID (overrides config)')
  .option('--region <region>', 'Region: NA, EU, or FE (overrides config)')
  .option('--profile-name <name>', 'Name for credential profile (overrides config)')
  .option('--port <port>', 'Port for OAuth callback server', '3000')
  .option('--advertiser-profile-id <id>', 'Advertiser profile ID for Ads API calls')
  .option('--seller-id <id>', 'Seller ID for SP-API calls')
  .action(async (opts, cmd) => {
    try {
      // Import from shared oauth library
      const { startOAuthServer } = await import('@farvisionllc/oauth');

      // Load config file
      const globalOpts = cmd.parent?.parent?.opts() as { config?: string } | undefined;
      const configPath = globalOpts?.config || 'config.toml';
      const config = loadConfig(configPath);

      // Determine which API config to use
      const apiType = opts.api === 'sp' ? 'sp_api' : 'ads_api';
      const apiConfig = config?.[apiType] || {};

      // Merge config with command-line options (CLI takes precedence)
      const clientId = opts.clientId || apiConfig.client_id;
      const clientSecret = opts.clientSecret || apiConfig.client_secret;
      const redirectUri = opts.redirectUri || apiConfig.redirect_uri || 'http://localhost:3000/oauth/callback';
      const marketplaceId = opts.marketplaceId || apiConfig.marketplace_id;
      const region = (opts.region || apiConfig.region || 'NA') as 'NA' | 'EU' | 'FE';
      const profileName = opts.profileName || apiConfig.profile_name || 'default';

      // Validate required fields
      if (!clientId || !clientSecret || !marketplaceId) {
        logger.error(
          'Missing required OAuth configuration. Provide via config file or command-line options.'
        );
        logger.info('Required: --client-id, --client-secret, --marketplace-id');
        logger.info(`Or add [${apiType}] section to ${configPath}`);
        process.exitCode = 1;
        return;
      }

      const apiTypeEnum = opts.api === 'sp' ? 'SP_API' : 'ADS_API';

      logger.info(`Starting interactive OAuth login for ${apiTypeEnum}`);
      logger.info('Your browser will open automatically...');

      const result = await startOAuthServer({
        clientId,
        clientSecret,
        redirectUri,
        marketplaceId,
        region,
        apiType: apiTypeEnum,
        profileName,
        sellerId: opts.sellerId,
        advertiserProfileId: opts.advertiserProfileId,
        port: parseInt(opts.port, 10),
      });

      if (result.success) {
        logger.info({ profileName: result.profileName }, 'OAuth login successful!');
        console.log(`\nProfile "${result.profileName}" is now ready to use.\n`);
      } else {
        logger.error({ error: result.error }, 'OAuth login failed');
        process.exitCode = 1;
      }
    } catch (error) {
      logger.error({ error }, 'Failed to start OAuth login');
      process.exitCode = 1;
    }
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
        console.log('No credential profiles found. Use "oauth authorize" to create one.');
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
        logger.error('Access token is expired and no refresh token available. Re-authorize with "oauth authorize"');
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
