import {
  startOAuthServer,
  type OAuthServerConfig,
  type AmazonApiType,
} from '@farvisionllc/oauth';

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const config: OAuthServerConfig = {
    clientId: process.env.CLIENT_ID || '',
    clientSecret: process.env.CLIENT_SECRET || '',
    redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/oauth/callback',
    marketplaceId: process.env.MARKETPLACE_ID || 'ATVPDKIKX0DER',
    region: (process.env.REGION as 'NA' | 'EU' | 'FE') || 'NA',
    apiType: (process.env.API_TYPE as AmazonApiType) || 'ADS_API',
    profileName: process.env.PROFILE_NAME || 'default',
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  };

  if (!config.clientId || !config.clientSecret) {
    console.error('Error: CLIENT_ID and CLIENT_SECRET environment variables are required');
    process.exit(1);
  }

  startOAuthServer(config)
    .then((result) => {
      if (result.success) {
        console.log('\n✓ OAuth flow completed successfully!');
        console.log(`Profile "${result.profileName}" is ready to use.\n`);
        process.exit(0);
      } else {
        console.error('\n✗ OAuth flow failed:', result.error);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('\n✗ Unexpected error:', err);
      process.exit(1);
    });
}
