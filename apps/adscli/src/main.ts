import fs from 'node:fs';
import { Command } from '@commander-js/extra-typings';
import { z } from 'zod';
import pino from 'pino';
import * as TOML from 'toml';
import { AmazonAdsApiClient } from '@farvisionllc/ad-client';

// Define schemas
const AppConfigSchema = z.object({
  adapi_client_id: z.string().min(1, 'Client ID is required'),
  adapi_client_secret: z.string().min(1, 'Client secret is required'),
  adapi_permission_scope: z.string().min(1, 'Permission scope is required'),
  adapi_access_token: z.string().min(1, 'Access token is required'),
  adapi_marketplace_id: z.string().min(1, 'Marketplace ID is required'),
});

const CLIOptionsSchema = z.object({
  logLevel: z.enum(['error', 'warn', 'info', 'debug', 'trace']),
  config: z.string().min(1, 'Config file path is required'),
});

// Infer types from schemas
type AppConfig = z.infer<typeof AppConfigSchema>;
type CLIOptions = z.infer<typeof CLIOptionsSchema>;

function createLogger(logLevel: string) {
  return pino.default({
    level: logLevel,
    transport: process.env.NO_PRETTY
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true },
        },
  });
}

// Type-safe config parser with validation
function parseConfig(configPath: string): AppConfig {
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const parsedConfig = TOML.parse(configContent);

    // Validate with Zod
    const validatedConfig = AppConfigSchema.parse(parsedConfig);
    return validatedConfig;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map(
        (err) => `${err.path.join('.')}: ${err.message}`
      );
      throw new Error(`Config validation failed:\n${errorMessages.join('\n')}`);
    }
    throw new Error(`Failed to parse config: ${error}`);
  }
}

let logger = createLogger('info');
let config: AppConfig | undefined;

const program = new Command()
  .option('-l, --log-level <logLevel>', 'Log level', 'info')
  .option('-c, --config <config>', 'Config file', 'config.toml')
  .hook('preAction', (cmd) => {
    const opts: CLIOptions = CLIOptionsSchema.parse(cmd.opts());
    logger.info({ opts }, 'Starting adscli with options');
    logger = createLogger(opts.logLevel);
    config = parseConfig(opts.config);
    const client = new AmazonAdsApiClient({
      clientId: config.adapi_client_id,
      clientSecret: config.adapi_client_secret,
      profileId: config.adapi_permission_scope,
      marketplaceId: config.adapi_marketplace_id,
    });
    client.getProfiles();
  });

program
  .command('list-campaigns')
  .description('List campaigns for the configured profile')
  .action(() => {
    // All actions now have access to both `logger` and the parsed `config` object
    logger.info({ config }, 'Listing campaigns...');
    // TODO: Call Amazon Ads API using details from `config`
  });

program
  .command('get-profiles')
  .description('Get profiles for the configured profile')
  .action(() => {
    // All actions now have access to both `logger` and the parsed `config` object
    logger.info({ config }, 'Listing campaigns...');
    // TODO: Call Amazon Ads API using details from `config`
  });
program.parse(process.argv);

const opts = program.opts();

logger.debug(opts, 'options parsed');
