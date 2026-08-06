import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverLambdaApps } from './lambda-apps.js';

/**
 * Every built Lambda bundle must actually load, in a real Node process.
 *
 * This exists because of a failure that **every other check passed**. esbuild
 * emits ESM; `@aws-sdk/client-secrets-manager` resolves to its CJS build, whose
 * `require("node:https")` became esbuild's `__require2` shim — which throws:
 *
 *   Error: Dynamic require of "node:https" is not supported
 *       at node_modules/@smithy/node-http-handler/dist-cjs/index.js
 *
 * It is an **init-time** failure, so the function never runs a line of its own
 * code. Lint, typecheck, unit tests, `cdk synth` and `cdk deploy` were all
 * green; the bundle was built, uploaded and reported as deployed. Only an
 * invocation revealed it — and `sync-dispatcher` and `sync-worker` had carried
 * the same defect since #36, unnoticed, because nothing had ever invoked them.
 *
 * ## Why a child process, and not just `await import(...)`
 *
 * The first version of this file did `await import(artefact)` directly and
 * **passed against a deliberately broken bundle**. Vitest runs through Vite's
 * SSR transform, which rewrites CJS interop and resolves the very `require`
 * that fails under Node's own ESM loader. Verified both ways against the same
 * broken artefact: plain `node` crashed, vitest reported success.
 *
 * So the assertion has to be made by the runtime that will actually run it.
 * `node --input-type=module` is the closest thing to Lambda's loader available
 * here; anything running inside this process tests Vite, not Lambda.
 */

const workspaceRoot = process.cwd().replace(/\/infra\/aws$/, '');
const apps = discoverLambdaApps(workspaceRoot);

/**
 * Zip apps only. An image artefact is a Docker build context whose entry point
 * is resolved inside the container, so there is no `main.js` to import here.
 */
const zipApps = apps.filter((app) => app.packaging === 'zip');

/** Load the bundle in a real Node ESM process; returns stderr on failure. */
function loadInNode(artefact: string, exportName: string): string | null {
  try {
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(artefact)});
         if (typeof m[${JSON.stringify(exportName)}] !== 'function') {
           throw new Error('no ${exportName} export');
         }`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30_000 }
    );
    return null;
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
    return stderr || String(error);
  }
}

describe('built Lambda bundles load under Node', () => {
  it('found some Lambda apps to check', () => {
    // Guards the guard: a discovery change returning nothing would make every
    // assertion below vacuously pass.
    expect(zipApps.length).toBeGreaterThan(0);
  });

  for (const app of zipApps) {
    const artefact = join(workspaceRoot, app.distPath, 'main.js');
    const [, exportName] = app.handler.split('.');

    it.skipIf(!existsSync(artefact))(
      `${app.name} initialises and exports ${app.handler}`,
      () => {
        const failure = loadInNode(artefact, exportName);

        // The message matters as much as the assertion: "Dynamic require of X
        // is not supported" means a dependency resolved to CJS and the
        // esbuild target needs its `createRequire` banner.
        expect(failure, `${app.name} bundle failed to load:\n${failure}`).toBe(
          null
        );
      }
    );
  }
});
