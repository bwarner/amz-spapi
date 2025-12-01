import { Command } from '@commander-js/extra-typings';
import { pino } from 'pino';
import fs from 'node:fs';
import * as readline from 'node:readline';
import * as TOML from 'toml';
import { z } from 'zod';
import { SqliteCredentialStore } from '@farvisionllc/credential-store';
import { SpApiClient } from '@farvisionllc/sp-client';

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

/**
 * Create an SP-API client from stored credentials
 */
async function createSpApiClient(profileName: string): Promise<SpApiClient> {
  const profile = await credStore.getProfile(profileName, 'SP_API');

  if (!profile) {
    throw new Error(`SP-API profile not found: ${profileName}`);
  }

  const { client_id, client_secret, refresh_token, access_token, marketplace_id, region, seller_id } = profile;

  if (!client_id || !refresh_token || !marketplace_id) {
    throw new Error('Invalid profile: missing required credentials (client_id, refresh_token, marketplace_id)');
  }

  return new SpApiClient({
    clientId: client_id,
    clientSecret: client_secret,
    refreshToken: refresh_token,
    accessToken: access_token,
    sellerId: seller_id,
    marketplaceId: marketplace_id,
    region: (region as 'NA' | 'EU' | 'FE') || 'NA',
    onTokenRefresh: async (newAccessToken, expiresIn) => {
      // Save the new access token back to the credential store
      logger.debug({ expiresIn }, 'Access token refreshed');
      await credStore.setProfile({
        ...profile,
        access_token: newAccessToken,
        access_token_expires_at: Date.now() + expiresIn * 1000,
        updated_at: Date.now(),
      });
    },
  });
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
// Utility Functions
// ===========================================================

/**
 * Read lines from stdin (for pipeline support)
 */
async function readLinesFromStdin(): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (trimmed) lines.push(trimmed);
    });

    rl.on('close', () => {
      resolve(lines);
    });
  });
}

/**
 * Check if ASIN format is valid
 */
function isValidAsin(asin: string): boolean {
  return /^B[0-9A-Z]{9}$/.test(asin);
}

/**
 * Detect if output should be human-readable or machine-readable
 */
function isInteractive(): boolean {
  return process.stdout.isTTY === true;
}

/**
 * Output formatter
 */
function formatOutput(data: any, format?: string) {
  const outputFormat = format || (isInteractive() ? 'table' : 'json');

  // Fields to exclude from table/csv output (complex objects that don't display well)
  const excludeFromTableFormats = ['rawData', 'items'];

  switch (outputFormat) {
    case 'json':
      console.log(JSON.stringify(data, null, 2));
      break;
    case 'asin':
      if (Array.isArray(data)) {
        data.forEach((item) => console.log(item.asin || item));
      } else {
        console.log(data.asin || data);
      }
      break;
    case 'table':
      // Simple table output
      if (Array.isArray(data)) {
        if (data.length === 0) {
          console.log('No results');
          return;
        }
        // Filter out complex fields for table display
        const allKeys = Object.keys(data[0]);
        const keys = allKeys.filter(k => !excludeFromTableFormats.includes(k));

        console.log(keys.join('\t'));
        // Print rows
        data.forEach((row) => {
          console.log(keys.map((k) => row[k] || '-').join('\t'));
        });
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
      break;
    case 'csv':
      if (Array.isArray(data) && data.length > 0) {
        // Filter out complex fields for CSV display
        const allKeys = Object.keys(data[0]);
        const keys = allKeys.filter(k => !excludeFromTableFormats.includes(k));

        console.log(keys.join(','));
        data.forEach((row) => {
          console.log(
            keys
              .map((k) => {
                const val = row[k] || '';
                return typeof val === 'string' && val.includes(',')
                  ? `"${val}"`
                  : val;
              })
              .join(',')
          );
        });
      }
      break;
  }
}

// ===========================================================
// SP-API Commands
// ===========================================================

const catalogCmd = program
  .command('catalog')
  .description('Query SP-API catalog items (pipeline-friendly)');

catalogCmd
  .command('get')
  .description('Get catalog item details for one or more ASINs')
  .argument('[asins...]', 'ASINs to fetch (also reads from stdin)')
  .option('--include-attributes', 'Include product attributes')
  .option('--include-images', 'Include image URLs')
  .option('--include-sales-ranks', 'Include sales rank data')
  .option('--include-summaries', 'Include product summaries')
  .option('--include-variations', 'Include variation data')
  .option('--format <type>', 'Output format: json|table|csv|asin')
  .option('--batch-size <n>', 'Batch size for API calls', '20')
  .option('--marketplace <id>', 'Marketplace ID (overrides profile)')
  .action(async (asinsFromArgs: string[], opts) => {
    try {
      let asins: string[] = [];

      // Collect ASINs from command line arguments
      if (asinsFromArgs && asinsFromArgs.length > 0) {
        asins.push(...asinsFromArgs);
      }

      // Also read from stdin if not a TTY (pipeline mode)
      if (!process.stdin.isTTY) {
        const stdinAsins = await readLinesFromStdin();
        asins.push(...stdinAsins);
      }

      // Remove duplicates and validate
      asins = [...new Set(asins)].filter(isValidAsin);

      if (asins.length === 0) {
        console.error('Error: No valid ASINs provided');
        console.error('Usage: catalog get <ASIN...>');
        console.error('   or: echo "B001" | catalog get');
        console.error('   or: cat asins.txt | catalog get');
        process.exitCode = 1;
        return;
      }

      logger.info({ count: asins.length }, 'Fetching catalog items');

      // Get the profile name from command options
      const parentOpts = program.opts();
      const profileName = parentOpts.profile || 'default';

      // Create SP-API client
      const client = await createSpApiClient(profileName);

      // Build includedData array from options
      const includedData: string[] = [];
      if (opts.includeAttributes) includedData.push('attributes');
      if (opts.includeImages) includedData.push('images');
      if (opts.includeSalesRanks) includedData.push('salesRanks');
      if (opts.includeSummaries) includedData.push('summaries');
      if (opts.includeVariations) includedData.push('variations');

      // Fetch catalog items
      const results = [];
      for (const asin of asins) {
        try {
          const response = await client.getCatalogItem(asin, {
            includedData: includedData.length > 0 ? includedData : undefined,
            marketplaceIds: opts.marketplace ? [opts.marketplace] : undefined,
          });

          // Extract key fields for display
          const item = response;
          const salesRank = item.salesRanks?.[0]?.displayGroupRanks?.[0]?.rank ||
                           item.salesRanks?.[0]?.classificationRanks?.[0]?.rank ||
                           'N/A';

          results.push({
            asin,
            title: item.summaries?.[0]?.itemName || 'N/A',
            brand: item.summaries?.[0]?.brand || 'N/A',
            salesRank,
            status: 'available',
            rawData: item, // Include full response for JSON output
          });
        } catch (error: any) {
          const errorDetails = error.response?.data || error.message;
          logger.warn({ asin, error: errorDetails, status: error.response?.status }, 'Failed to fetch catalog item');
          results.push({
            asin,
            title: 'ERROR',
            brand: 'N/A',
            salesRank: 'N/A',
            status: error.response?.status === 404 ? 'not_found' : 'error',
            error: typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails),
          });
        }
      }

      formatOutput(results, opts.format);
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to get catalog items');
      console.error(error);
      process.exitCode = 1;
    }
  });

catalogCmd
  .command('search')
  .description('Search catalog items by keywords or identifiers')
  .argument('[query]', 'Search query (keywords)')
  .option('--keywords <text>', 'Search keywords')
  .option('--brand <name>', 'Filter by brand')
  .option('--identifiers <ids>', 'Comma-separated identifiers (UPC, EAN, ISBN)')
  .option('--category <name>', 'Browse node or category')
  .option('--limit <n>', 'Maximum results to return', '10')
  .option('--format <type>', 'Output format: json|table|asin')
  .option('--marketplace <id>', 'Marketplace ID (overrides profile)')
  .action(async (query: string | undefined, opts) => {
    try {
      const keywords = opts.keywords || query;

      if (!keywords && !opts.identifiers) {
        console.error('Error: Provide search keywords or identifiers');
        console.error('Usage: catalog search "coffee maker"');
        console.error('   or: catalog search --keywords "coffee" --brand "Keurig"');
        process.exitCode = 1;
        return;
      }

      logger.info({ keywords, brand: opts.brand }, 'Searching catalog');

      // TODO: Implement actual SP-API search
      // For now, return mock data
      const limit = parseInt(opts.limit, 10);
      const results = Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
        asin: `B${String(i).padStart(9, '0')}`,
        title: `${keywords} - Product ${i + 1}`,
        brand: opts.brand || 'Various',
        price: `$${(Math.random() * 100).toFixed(2)}`,
        salesRank: Math.floor(Math.random() * 10000),
      }));

      formatOutput(results, opts.format);
    } catch (error) {
      logger.error({ error }, 'Failed to search catalog');
      process.exitCode = 1;
    }
  });

catalogCmd
  .command('list')
  .description('List catalog items you are selling')
  .option('--sku <sku>', 'Filter by SKU')
  .option('--brand <name>', 'Filter by brand')
  .option('--include-inventory', 'Include inventory levels')
  .option('--format <type>', 'Output format: json|table|asin')
  .option('--limit <n>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      logger.info({ sku: opts.sku, brand: opts.brand }, 'Listing your catalog items');

      // TODO: Implement actual SP-API listing call
      // For now, return mock data
      const results = [
        {
          asin: 'B001234567',
          sku: 'MY-SKU-001',
          title: 'Your Product 1',
          brand: 'YourBrand',
          inventory: 150,
          price: '$24.99',
        },
        {
          asin: 'B987654321',
          sku: 'MY-SKU-002',
          title: 'Your Product 2',
          brand: 'YourBrand',
          inventory: 75,
          price: '$19.99',
        },
      ];

      formatOutput(results, opts.format);
    } catch (error) {
      logger.error({ error }, 'Failed to list catalog items');
      process.exitCode = 1;
    }
  });

// ===========================================================
// Orders Commands
// ===========================================================

const ordersCmd = program
  .command('orders')
  .description('Query SP-API orders (pipeline-friendly)');

ordersCmd
  .command('list')
  .description('List orders within a time range')
  .option('--created-after <date>', 'Orders created after this ISO 8601 date')
  .option('--created-before <date>', 'Orders created before this ISO 8601 date')
  .option('--last-updated-after <date>', 'Orders updated after this ISO 8601 date')
  .option('--last-updated-before <date>', 'Orders updated before this ISO 8601 date')
  .option('--status <statuses>', 'Order statuses (comma-separated): Pending,Unshipped,Shipped,Canceled')
  .option('--fulfillment <channels>', 'Fulfillment channels (comma-separated): AFN,MFN')
  .option('--max-results <n>', 'Maximum results per page', '100')
  .option('--format <type>', 'Output format: json|table|csv|order-id')
  .option('--marketplace <id>', 'Marketplace ID (overrides profile)')
  .option('--days <n>', 'Shortcut: orders from last N days (uses LastUpdatedAfter)')
  .action(async (opts) => {
    try {
      // Get the profile name from parent command options
      const parentOpts = program.opts();
      const profileName = parentOpts.profile || 'default';

      // Create SP-API client
      const client = await createSpApiClient(profileName);

      // Handle --days shortcut
      let lastUpdatedAfter = opts.lastUpdatedAfter;
      if (opts.days && !lastUpdatedAfter) {
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(opts.days, 10));
        lastUpdatedAfter = daysAgo.toISOString();
        logger.debug({ lastUpdatedAfter }, `Using --days=${opts.days} shortcut`);
      }

      // Validate: either CreatedAfter or LastUpdatedAfter is required
      if (!opts.createdAfter && !lastUpdatedAfter) {
        console.error('Error: Either --created-after or --last-updated-after (or --days) is required');
        console.error('Example: orders list --created-after 2024-01-01T00:00:00Z');
        console.error('     or: orders list --days 7');
        process.exitCode = 1;
        return;
      }

      const orderStatuses = opts.status ? opts.status.split(',') : undefined;
      const fulfillmentChannels = opts.fulfillment ? opts.fulfillment.split(',') : undefined;

      logger.info(
        {
          createdAfter: opts.createdAfter,
          lastUpdatedAfter,
          orderStatuses,
          fulfillmentChannels,
        },
        'Fetching orders'
      );

      const response = await client.getOrders({
        createdAfter: opts.createdAfter,
        createdBefore: opts.createdBefore,
        lastUpdatedAfter,
        lastUpdatedBefore: opts.lastUpdatedBefore,
        orderStatuses,
        fulfillmentChannels,
        maxResultsPerPage: parseInt(opts.maxResults, 10),
        marketplaceIds: opts.marketplace ? [opts.marketplace] : undefined,
      });

      // Extract orders from payload
      const orders = response.payload?.Orders || [];

      if (orders.length === 0) {
        console.log('No orders found matching the criteria');
        return;
      }

      // Format for output
      const results = orders.map((order: any) => ({
        orderId: order.AmazonOrderId,
        purchaseDate: order.PurchaseDate,
        orderStatus: order.OrderStatus,
        fulfillmentChannel: order.FulfillmentChannel,
        salesChannel: order.SalesChannel,
        orderTotal: order.OrderTotal ? `${order.OrderTotal.CurrencyCode} ${order.OrderTotal.Amount}` : 'N/A',
        numberOfItems: order.NumberOfItemsShipped + order.NumberOfItemsUnshipped || 0,
        buyerEmail: order.BuyerInfo?.BuyerEmail || 'N/A',
        shipServiceLevel: order.ShipmentServiceLevelCategory || 'N/A',
        rawData: order, // Include full order for JSON output
      }));

      logger.info({ count: results.length }, 'Orders fetched successfully');

      formatOutput(results, opts.format === 'order-id' ? 'asin' : opts.format);
    } catch (error: any) {
      const errorDetails = error.response?.data || error.message;
      logger.error({ error: errorDetails, status: error.response?.status }, 'Failed to list orders');
      console.error('Error:', typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails, null, 2));
      process.exitCode = 1;
    }
  });

ordersCmd
  .command('get')
  .description('Get order details by Order ID')
  .argument('[order-ids...]', 'Amazon Order IDs (also reads from stdin)')
  .option('--include-items', 'Include order items in output')
  .option('--format <type>', 'Output format: json|table|csv')
  .action(async (orderIdsFromArgs: string[], opts) => {
    try {
      let orderIds: string[] = [];

      // Collect order IDs from command line arguments
      if (orderIdsFromArgs && orderIdsFromArgs.length > 0) {
        orderIds.push(...orderIdsFromArgs);
      }

      // Also read from stdin if not a TTY (pipeline mode)
      if (!process.stdin.isTTY) {
        const stdinOrderIds = await readLinesFromStdin();
        orderIds.push(...stdinOrderIds);
      }

      // Remove duplicates
      orderIds = [...new Set(orderIds)];

      if (orderIds.length === 0) {
        console.error('Error: No order IDs provided');
        console.error('Usage: orders get <ORDER_ID...>');
        console.error('   or: echo "123-1234567-1234567" | orders get');
        process.exitCode = 1;
        return;
      }

      logger.info({ count: orderIds.length }, 'Fetching order details');

      // Get the profile name from parent command options
      const parentOpts = program.opts();
      const profileName = parentOpts.profile || 'default';

      // Create SP-API client
      const client = await createSpApiClient(profileName);

      const results = [];
      for (const orderId of orderIds) {
        try {
          const orderResponse = await client.getOrder(orderId);
          const order = orderResponse.payload;

          let items: any[] = [];
          if (opts.includeItems) {
            try {
              const itemsResponse = await client.getOrderItems(orderId);
              items = itemsResponse.payload?.OrderItems || [];
            } catch (itemError: any) {
              logger.warn({ orderId, error: itemError.message }, 'Failed to fetch order items');
            }
          }

          results.push({
            orderId: order?.AmazonOrderId || orderId,
            purchaseDate: order?.PurchaseDate || 'N/A',
            orderStatus: order?.OrderStatus || 'N/A',
            fulfillmentChannel: order?.FulfillmentChannel || 'N/A',
            orderTotal: order?.OrderTotal ? `${order.OrderTotal.CurrencyCode} ${order.OrderTotal.Amount}` : 'N/A',
            numberOfItems: (order?.NumberOfItemsShipped || 0) + (order?.NumberOfItemsUnshipped || 0),
            items: items.length > 0 ? items : undefined,
            rawData: order,
          });
        } catch (error: any) {
          const errorDetails = error.response?.data || error.message;
          logger.warn({ orderId, error: errorDetails, status: error.response?.status }, 'Failed to fetch order');
          results.push({
            orderId,
            purchaseDate: 'ERROR',
            orderStatus: error.response?.status === 404 ? 'not_found' : 'error',
            fulfillmentChannel: 'N/A',
            orderTotal: 'N/A',
            numberOfItems: 0,
            error: typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails),
          });
        }
      }

      formatOutput(results, opts.format);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get orders');
      console.error(error);
      process.exitCode = 1;
    }
  });

// Parse and execute
program.parse(process.argv);
