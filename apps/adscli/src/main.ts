import fs from 'node:fs';
import { Command } from '@commander-js/extra-typings';
import pino from 'pino';
import * as TOML from 'toml';

function createLogger(logLevel: string) {
  return pino({
    level: logLevel,
    transport: process.env.NO_PRETTY
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true },
        },
  });
}
let logger = createLogger('info');
type Config = {
  adapi_client_id: string;
  adapi_client_secret: string;
  adapi_permission_scope: string;
};
let config: Config | undefined;

const program = new Command()
  .option('-l, --log-level <logLevel>', 'Log level', 'info')
  .option('-c, --config <config>', 'Config file', 'config.toml')
  .hook('preAction', (cmd) => {
    const opts = cmd.opts();
    logger.info({ opts }, 'Starting adscli with options');
    logger = createLogger(opts.logLevel);

    config = TOML.parse(fs.readFileSync(opts.config, 'utf8'));
    logger.info(config);
  });

program
  .command('list-campaigns')
  .description('List campaigns for the configured profile')
  .action(() => {
    // All actions now have access to both `logger` and the parsed `config` object
    logger.info({ config }, 'Listing campaigns...');
    // TODO: Call Amazon Ads API using details from `config`
  });

program.parse(process.argv);

const opts = program.opts();

logger.debug(opts, 'options parsed');
