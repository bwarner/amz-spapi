import { Command } from '@commander-js/extra-typings';
import { pino } from 'pino';
import fs from 'node:fs';
import * as TOML from 'toml';
import { z } from 'zod';
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

// Config file schema (SP-API only)
const SpApiConfigSchema = z.object({
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  marketplace_id: z.string().optional(),
  region: z.enum(['NA', 'EU', 'FE']).optional(),
  profile_name: z.string().optional(),
  seller_id: z.string().optional(),
});

const ConfigFileSchema = z.object({
  sp_api: SpApiConfigSchema.optional(),
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
  .name('spcli')
  .description('Amazon Selling Partner API CLI (Self-Authorization)')
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
  .description('Manage stored SP-API credentials');

credsCmd
  .command('list')
  .description('List all stored SP-API credential profiles')
  .action(async () => {
    try {
      const profiles = await credStore.listProfiles('SP_API');
      const defaultProfile = await credStore.getDefaultProfile('SP_API');

      if (profiles.length === 0) {
        console.log('No SP-API credential profiles found. Use "credentials add" to create one.');
        return;
      }

      console.log('\nStored SP-API Credential Profiles:');
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
  .description('Show details of an SP-API credential profile')
  .argument('[profile-name]', 'Profile name (defaults to default profile)')
  .action(async (profileName?: string) => {
    try {
      const name = profileName || (await credStore.getDefaultProfile('SP_API'));
      if (!name) {
        logger.error('No profile specified and no default profile set');
        process.exitCode = 1;
        return;
      }

      const profile = await credStore.getProfile(name, 'SP_API');
      if (!profile) {
        logger.error({ profileName: name }, 'Profile not found');
        process.exitCode = 1;
        return;
      }

      console.log('\nSP-API Profile Details:');
      console.log(`  Name: ${profile.profile_name}`);
      console.log(`  Client ID: ${profile.client_id}`);
      console.log(`  Marketplace: ${profile.marketplace_id}`);
      console.log(`  Region: ${profile.region}`);
      if (profile.seller_id) {
        console.log(`  Seller ID: ${profile.seller_id}`);
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
  .description('Add SP-API credentials from Amazon Seller Central (self-authorization)')
  .requiredOption('--refresh-token <token>', 'Refresh Token from Seller Central')
  .option('--client-id <id>', 'LWA Client ID (overrides config)')
  .option('--client-secret <secret>', 'LWA Client Secret (overrides config)')
  .option('--marketplace-id <id>', 'Amazon marketplace ID (overrides config)')
  .option('--profile-name <name>', 'Name for credential profile (overrides config)', 'default')
  .option('--region <region>', 'Region: NA, EU, or FE (overrides config)')
  .option('--seller-id <id>', 'Seller ID (overrides config)')
  .action(async (opts, cmd) => {
    try {
      // Load config file
      const globalOpts = cmd.parent?.parent?.opts() as { config?: string } | undefined;
      const configPath = globalOpts?.config || 'config.toml';
      const config = loadConfig(configPath);

      const apiConfig = config?.sp_api || {};

      // Merge config with command-line options (CLI takes precedence)
      const clientId = opts.clientId || apiConfig.client_id;
      const clientSecret = opts.clientSecret || apiConfig.client_secret;
      const marketplaceId = opts.marketplaceId || apiConfig.marketplace_id;
      const region = (opts.region || apiConfig.region || 'NA') as 'NA' | 'EU' | 'FE';
      const profileName = opts.profileName === 'default' && apiConfig.profile_name
        ? apiConfig.profile_name
        : opts.profileName;
      const sellerId = opts.sellerId || apiConfig.seller_id;

      // Validate required fields
      if (!clientId || !clientSecret || !marketplaceId) {
        logger.error(
          'Missing required configuration. Provide via config file or command-line options.'
        );
        logger.info('Required: --client-id, --client-secret, --marketplace-id');
        logger.info(`Or add [sp_api] section to ${configPath}`);
        process.exitCode = 1;
        return;
      }

      const now = Date.now();
      await credStore.setProfile({
        profile_name: profileName,
        api_type: 'SP_API',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: opts.refreshToken,
        marketplace_id: marketplaceId,
        region,
        ...(sellerId && { seller_id: sellerId }),
        created_at: now,
        updated_at: now,
      });

      // Set as default if it's the only profile or named 'default'
      const profiles = await credStore.listProfiles('SP_API');
      if (profiles.length === 1 || profileName === 'default') {
        await credStore.setDefaultProfile(profileName, 'SP_API');
      }

      console.log(`\n✓ SP-API credentials added successfully!`);
      console.log(`  Profile: ${profileName}`);
      console.log(`  Marketplace: ${marketplaceId}`);
      if (sellerId) {
        console.log(`  Seller ID: ${sellerId}`);
      }
      console.log('');

      logger.info({ profileName }, 'SP-API credentials stored');
    } catch (error) {
      logger.error({ error }, 'Failed to add credentials');
      process.exitCode = 1;
    }
  });

credsCmd
  .command('delete')
  .description('Delete an SP-API credential profile')
  .argument('<profile-name>', 'Profile name to delete')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (profileName, opts) => {
    try {
      if (!opts.yes) {
        console.log(`Are you sure you want to delete profile "${profileName}"? (y/N)`);
        // In a real implementation, you'd want to use a proper prompt library
        // For now, we'll just proceed
      }

      await credStore.deleteProfile(profileName, 'SP_API');
      logger.info({ profileName }, 'Profile deleted successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to delete profile');
      process.exitCode = 1;
    }
  });

credsCmd
  .command('set-default')
  .description('Set the default SP-API credential profile')
  .argument('<profile-name>', 'Profile name to set as default')
  .action(async (profileName) => {
    try {
      await credStore.setDefaultProfile(profileName, 'SP_API');
      logger.info({ profileName }, 'Default profile updated');
    } catch (error) {
      logger.error({ error }, 'Failed to set default profile');
      process.exitCode = 1;
    }
  });

// ===========================================================
// SP-API Commands (placeholder for future implementation)
// ===========================================================

program
  .command('catalog')
  .description('Query catalog items')
  .action(async () => {
    logger.info('Catalog command - to be implemented');
    console.log('This will query SP-API catalog items');
  });

program
  .command('orders')
  .description('Query orders')
  .action(async () => {
    logger.info('Orders command - to be implemented');
    console.log('This will query SP-API orders');
  });

// Parse and execute
program.parse(process.argv);
