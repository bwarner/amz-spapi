import express, { type Request, type Response } from 'express';
import open from 'open';
import type { Server } from 'http';
import {
  AmazonOAuthFlow,
  SqliteCredentialStore,
  type AmazonApiType,
} from '@farvisionllc/credential-store';

export interface OAuthServerConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  marketplaceId: string;
  region?: 'NA' | 'EU' | 'FE';
  apiType: AmazonApiType;
  profileName: string;
  sellerId?: string;
  advertiserProfileId?: string;
  port?: number;
}

export interface OAuthServerResult {
  success: boolean;
  profileName?: string;
  error?: string;
}

/**
 * Start an OAuth server that handles the full OAuth flow:
 * 1. Starts Express server on localhost
 * 2. Opens browser to authorization URL
 * 3. Receives callback with authorization code
 * 4. Exchanges code for tokens
 * 5. Stores credentials in local SQLite database
 * 6. Shuts down server automatically
 *
 * @param config OAuth server configuration
 * @returns Promise that resolves with success/failure result
 */
export async function startOAuthServer(
  config: OAuthServerConfig
): Promise<OAuthServerResult> {
  const app = express();
  const port = config.port || 3000;
  let server: Server | null = null;
  const credentialStore = new SqliteCredentialStore();

  return new Promise((resolve) => {
    const cleanup = (result: OAuthServerResult) => {
      if (server) {
        server.close(() => {
          console.log('OAuth server stopped');
        });
      }
      resolve(result);
    };

    const oauthFlow = new AmazonOAuthFlow({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });

    // Health check endpoint
    app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', message: 'OAuth server is running' });
    });

    // OAuth callback endpoint
    app.get('/oauth/callback', async (req: Request, res: Response) => {
      try {
        const { code, state, error, error_description } = req.query;

        if (error) {
          const errorMsg = `OAuth error: ${error} - ${error_description || 'Unknown error'}`;
          console.error(errorMsg);
          res.send(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>OAuth Error</title>
                <style>
                  body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
                  .error { background: #fee; border: 1px solid #c33; padding: 20px; border-radius: 8px; }
                  h1 { color: #c33; }
                  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
                </style>
              </head>
              <body>
                <div class="error">
                  <h1>Authorization Failed</h1>
                  <p><strong>Error:</strong> ${error}</p>
                  <p>${error_description || 'Unknown error occurred'}</p>
                  <p>You can close this window and try again.</p>
                </div>
              </body>
            </html>
          `);
          cleanup({ success: false, error: errorMsg });
          return;
        }

        if (!code || typeof code !== 'string') {
          const errorMsg = 'Missing authorization code';
          console.error(errorMsg);
          res.status(400).send(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>OAuth Error</title>
                <style>
                  body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
                  .error { background: #fee; border: 1px solid #c33; padding: 20px; border-radius: 8px; }
                  h1 { color: #c33; }
                </style>
              </head>
              <body>
                <div class="error">
                  <h1>Invalid Request</h1>
                  <p>Missing authorization code in callback.</p>
                  <p>You can close this window and try again.</p>
                </div>
              </body>
            </html>
          `);
          cleanup({ success: false, error: errorMsg });
          return;
        }

        if (!state || typeof state !== 'string') {
          const errorMsg = 'Missing state parameter (CSRF protection)';
          console.error(errorMsg);
          res.status(400).send(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>OAuth Error</title>
                <style>
                  body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
                  .error { background: #fee; border: 1px solid #c33; padding: 20px; border-radius: 8px; }
                  h1 { color: #c33; }
                </style>
              </head>
              <body>
                <div class="error">
                  <h1>Security Error</h1>
                  <p>Missing state parameter. This could be a security issue.</p>
                  <p>You can close this window and try again.</p>
                </div>
              </body>
            </html>
          `);
          cleanup({ success: false, error: errorMsg });
          return;
        }

        console.log('Exchanging authorization code for tokens...');
        // Parse state to get the API type
        const parsedState = oauthFlow.parseState(state);
        const tokens = await oauthFlow.exchangeCodeForTokens(code, parsedState.apiType);
        console.log('Successfully obtained tokens');

        // Store the credentials
        const now = Date.now();
        await credentialStore.setProfile({
          profile_name: config.profileName,
          api_type: config.apiType,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          access_token_expires_at: now + tokens.expires_in * 1000,
          marketplace_id: config.marketplaceId,
          region: config.region,
          seller_id: config.sellerId,
          advertiser_profile_id: config.advertiserProfileId,
          created_at: now,
          updated_at: now,
        });

        // Set as default profile
        await credentialStore.setDefaultProfile(
          config.profileName,
          config.apiType
        );

        console.log(`Credentials stored successfully for profile: ${config.profileName}`);

        res.send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Authorization Successful</title>
              <style>
                body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
                .success { background: #efe; border: 1px solid #3c3; padding: 20px; border-radius: 8px; }
                h1 { color: #3c3; }
                code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
                .info { margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 6px; }
                .info-item { margin: 8px 0; }
                .info-label { font-weight: 600; }
              </style>
            </head>
            <body>
              <div class="success">
                <h1>✓ Authorization Successful!</h1>
                <p>Your Amazon ${config.apiType === 'SP_API' ? 'Selling Partner' : 'Advertising'} API credentials have been saved.</p>
                <div class="info">
                  <div class="info-item">
                    <span class="info-label">Profile:</span> <code>${config.profileName}</code>
                  </div>
                  <div class="info-item">
                    <span class="info-label">API Type:</span> <code>${config.apiType}</code>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Marketplace:</span> <code>${config.marketplaceId}</code>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Region:</span> <code>${config.region || 'NA'}</code>
                  </div>
                </div>
                <p><strong>You can now close this window and return to the terminal.</strong></p>
                <p style="color: #666; font-size: 0.9em; margin-top: 30px;">
                  This window will automatically close in a few seconds...
                </p>
              </div>
              <script>
                setTimeout(() => window.close(), 3000);
              </script>
            </body>
          </html>
        `);

        cleanup({ success: true, profileName: config.profileName });
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : 'Unknown error occurred';
        console.error('OAuth callback error:', err);
        res.status(500).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>OAuth Error</title>
              <style>
                body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
                .error { background: #fee; border: 1px solid #c33; padding: 20px; border-radius: 8px; }
                h1 { color: #c33; }
                pre { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; }
              </style>
            </head>
            <body>
              <div class="error">
                <h1>Authorization Error</h1>
                <p>An error occurred while processing the authorization:</p>
                <pre>${errorMsg}</pre>
                <p>You can close this window and try again.</p>
              </div>
            </body>
          </html>
        `);
        cleanup({ success: false, error: errorMsg });
      }
    });

    // Start the server
    server = app.listen(port, async () => {
      console.log(`OAuth server listening on http://localhost:${port}`);

      // Generate authorization URL and open browser
      const { authUrl, state } = oauthFlow.generateAuthUrl(
        config.apiType,
        config.profileName
      );

      console.log('\nOpening browser for authorization...');
      console.log(`If the browser doesn't open automatically, visit:`);
      console.log(`  ${authUrl}\n`);
      console.log(`State parameter: ${state}\n`);
      console.log('Waiting for authorization callback...\n');

      try {
        await open(authUrl);
      } catch (err) {
        console.error('Failed to auto-open browser:', err);
        console.log('Please manually open the URL above in your browser.');
      }
    });

    // Handle server errors
    server.on('error', (err) => {
      console.error('Server error:', err);
      cleanup({ success: false, error: err.message });
    });
  });
}
