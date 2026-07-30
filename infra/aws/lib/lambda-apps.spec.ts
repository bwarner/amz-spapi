import { discoverLambdaApps, parseLambdaMetadata } from './lambda-apps.js';

/**
 * The point of these is that a mistake in a project.json stops the synth rather
 * than deploying a function as the wrong kind of artefact — which would look
 * like a working deploy and fail at the first invocation.
 */

describe('parseLambdaMetadata', () => {
  const valid = {
    name: 'lambda-health',
    metadata: {
      lambda: {
        packaging: 'zip',
        handler: 'main.handler',
        description: 'Health check',
        timeoutSeconds: 10,
        memoryMb: 256,
      },
    },
  };

  it('reads a complete declaration', () => {
    const parsed = parseLambdaMetadata('health', valid);

    expect(parsed?.projectName).toBe('lambda-health');
    expect(parsed?.metadata).toMatchObject({
      packaging: 'zip',
      handler: 'main.handler',
      timeoutSeconds: 10,
      memoryMb: 256,
    });
  });

  it('treats a directory with no lambda block as not a Lambda', () => {
    // A shared fixture or helper folder is allowed to live here.
    expect(
      parseLambdaMetadata('helpers', { name: 'helpers', metadata: {} })
    ).toBeUndefined();
    expect(parseLambdaMetadata('helpers', { name: 'helpers' })).toBeUndefined();
  });

  it('rejects an unknown packaging rather than guessing', () => {
    expect(() =>
      parseLambdaMetadata('health', {
        name: 'lambda-health',
        metadata: {
          lambda: { packaging: 'container', handler: 'main.handler' },
        },
      })
    ).toThrow(/packaging must be one of zip \| image/);
  });

  it('rejects a handler that is not file.export', () => {
    expect(() =>
      parseLambdaMetadata('health', {
        name: 'lambda-health',
        metadata: { lambda: { packaging: 'zip', handler: 'main' } },
      })
    ).toThrow(/handler must look like "file\.export"/);
  });

  it('rejects nonsense sizing rather than deploying a default', () => {
    for (const bad of [0, -1, 'lots']) {
      expect(() =>
        parseLambdaMetadata('health', {
          name: 'lambda-health',
          metadata: {
            lambda: {
              packaging: 'zip',
              handler: 'main.handler',
              memoryMb: bad,
            },
          },
        })
      ).toThrow(/memoryMb must be a positive number/);
    }
  });

  it('names the file to fix in every error', () => {
    expect(() =>
      parseLambdaMetadata('health', {
        name: 'lambda-health',
        metadata: { lambda: { packaging: 'nope', handler: 'main.handler' } },
      })
    ).toThrow(/apps\/lambdas\/health\/project\.json/);
  });
});

describe('discoverLambdaApps', () => {
  it('finds the health app in this workspace, with its paths resolved', () => {
    const apps = discoverLambdaApps(process.cwd().replace(/\/infra\/aws$/, ''));

    const health = apps.find((app) => app.name === 'health');
    expect(health).toBeDefined();
    expect(health?.packaging).toBe('zip');
    expect(health?.projectName).toBe('lambda-health');
    expect(health?.distPath).toBe('dist/apps/lambdas/health');
    expect(health?.appPath).toBe('apps/lambdas/health');
  });

  it('returns a stable order, so a synthesised diff means a real change', () => {
    const root = process.cwd().replace(/\/infra\/aws$/, '');
    const names = discoverLambdaApps(root).map((app) => app.name);

    expect(names).toEqual([...names].sort());
  });

  it('returns nothing when there is no lambdas directory', () => {
    expect(discoverLambdaApps('/tmp/definitely-not-a-workspace')).toEqual([]);
  });
});
