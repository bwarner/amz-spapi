import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';
import { fileURLToPath } from 'node:url';

// The workspace is ESM, where `__filename` does not exist — the scaffolded
// config referenced it and so could never load.
const currentFile = fileURLToPath(import.meta.url);

/**
 * The dev server this project actually runs on.
 *
 * HTTPS on 9443, reached through the local proxy — see
 * `project_local_dev_proxy`. The scaffolded default was plain HTTP on 3000,
 * which nothing here serves.
 */
const baseURL = process.env['BASE_URL'] || 'https://local.sellavant.com:9443';

export default defineConfig({
  ...nxE2EPreset(currentFile, { testDir: './src' }),
  use: {
    baseURL,
    // The local certificate is self-signed; curl needs -k for the same reason.
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  webServer: {
    // Was `web:start`, which is not a target this project has — the targets are
    // build / serve / export / test / analyze / lint, so the scaffolded config
    // could never have started anything.
    //
    // NX_DAEMON=false because the daemon recycling kills `nx serve` with a bare
    // "Cancelled"; see `project_nx_daemon_serve_trap`.
    command: 'NX_DAEMON=false npx nx run web:serve',
    url: baseURL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
    // A cold Next dev start compiles on first request.
    timeout: 180_000,
    cwd: workspaceRoot,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Firefox and WebKit are off by default. The gallery exists to be looked
    // at, and three renderings of the same fixture is three times the images
    // for one question. Re-enable when there is a cross-browser bug worth
    // chasing.
  ],
});
