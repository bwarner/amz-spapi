import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Discovery of the workspace's Lambda apps (#53).
 *
 * Each Lambda is an Nx app under `apps/lambdas/<name>` that declares how it
 * wants to be packaged. The stack reads that declaration rather than carrying a
 * hand-written list: with twenty functions a list in the CDK file becomes the
 * thing that knows, and it drifts from the apps it claims to describe — which is
 * the failure ADR-0001 exists to stop repeating.
 *
 * Parsing is deliberately strict and loud. A typo in `packaging` should stop the
 * synth, not silently deploy a function as the wrong kind of artefact.
 */

export type LambdaPackaging = 'zip' | 'image';

export type LambdaAppMetadata = {
  packaging: LambdaPackaging;
  /** `file.export`, matching the built artefact. Always `main.handler` today. */
  handler: string;
  description?: string;
  timeoutSeconds?: number;
  memoryMb?: number;
  /**
   * API Gateway route keys this function answers, in the form `METHOD /path` —
   * the same string `HttpApi.addRoutes` consumes, so there is one
   * representation and nothing to translate. Absent means the function is not
   * HTTP-facing, which is the normal case for queue and event consumers.
   */
  routes?: string[];
  /**
   * Whether this function reads Couchbase (#55).
   *
   * Declared per app rather than derived from its `package.json`, because the
   * dependency is not always direct: `sync-worker` reaches Couchbase through
   * `@amz-spapi/sp-sync`, so derivation would mean walking the dependency graph
   * inside CDK and would be wrong in exactly the case that matters.
   *
   * It governs a grant, so the default of `false` is the safe one. The
   * Couchbase user's permissions are scope-wide (ADR-0005), meaning any
   * function holding this can read every collection in the environment —
   * including `credentials_profiles`. `health` and `me` must not have it.
   */
  couchbase?: boolean;
  /**
   * Whether this function unwraps and uses seller credentials (#55).
   *
   * Grants two things together, because neither is useful alone and holding
   * both is the definition of this capability: `kms:Decrypt` on the credentials
   * key, which turns a stored blob into a refresh token, and read on the Amazon
   * OAuth secret, whose client secret turns that refresh token into an access
   * token for the seller's account.
   *
   * This is the most dangerous grant in the workspace — it reaches every
   * connected seller — so it is declared per app, defaults to `false`, and
   * should stay on exactly one function. If a second one needs a token, it
   * should call this one.
   */
  amazonCredentials?: boolean;
};

export type LambdaApp = LambdaAppMetadata & {
  /** Nx project name, e.g. `lambda-health`. */
  projectName: string;
  /** Directory name under apps/lambdas, e.g. `health`. */
  name: string;
  /** Where `nx build` puts the artefact, relative to the workspace root. */
  distPath: string;
  /** Source directory, relative to the workspace root. */
  appPath: string;
};

const PACKAGING: readonly LambdaPackaging[] = ['zip', 'image'];

/** What API Gateway v2 accepts in a route key. `ANY` matches every method. */
const HTTP_METHODS = [
  'ANY',
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
];

/** `GET /orders/{orderId}` — method, one space, then an absolute path. */
const ROUTE_KEY = /^([A-Z]+) (\/\S*)$/;

function fail(name: string, problem: string): never {
  throw new Error(
    `Lambda app "${name}": ${problem}. Fix metadata.lambda in ` +
      `apps/lambdas/${name}/project.json — see apps/lambdas/README.md.`
  );
}

/**
 * Route keys, rejected loudly rather than half-understood.
 *
 * A path with no method would have to be given one by the API stack, and the
 * only honest default is "all of them" — which silently exposes DELETE on a
 * function whose author was thinking about GET.
 */
function parseRoutes(name: string, raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;

  if (!Array.isArray(raw) || raw.length === 0) {
    fail(
      name,
      'metadata.lambda.routes must be a non-empty array of route keys like ' +
        '["GET /health"]'
    );
  }

  const seen = new Set<string>();
  for (const route of raw) {
    if (typeof route !== 'string' || !ROUTE_KEY.test(route)) {
      fail(
        name,
        `metadata.lambda.routes entries must look like "GET /health", got ${JSON.stringify(
          route
        )}`
      );
    }
    const method = ROUTE_KEY.exec(route)![1];
    if (!HTTP_METHODS.includes(method)) {
      fail(
        name,
        `"${route}" uses method ${method}, which API Gateway does not accept. ` +
          `Use one of: ${HTTP_METHODS.join(', ')}`
      );
    }
    if (seen.has(route)) {
      fail(name, `metadata.lambda.routes lists "${route}" twice`);
    }
    seen.add(route);
  }

  return raw as string[];
}

/** Parse one project.json's `metadata.lambda` block. */
export function parseLambdaMetadata(
  name: string,
  projectJson: unknown
): { projectName: string; metadata: LambdaAppMetadata } | undefined {
  if (!projectJson || typeof projectJson !== 'object') {
    fail(name, 'project.json is not an object');
  }
  const project = projectJson as {
    name?: unknown;
    metadata?: { lambda?: unknown };
  };

  const raw = project.metadata?.lambda;
  // No declaration means "not a Lambda" — a shared fixture or helper directory
  // is allowed to live here without being deployed.
  if (raw === undefined) return undefined;

  if (!raw || typeof raw !== 'object') {
    fail(name, 'metadata.lambda must be an object');
  }
  const metadata = raw as Record<string, unknown>;

  const packaging = metadata['packaging'];
  if (
    typeof packaging !== 'string' ||
    !PACKAGING.includes(packaging as LambdaPackaging)
  ) {
    fail(
      name,
      `metadata.lambda.packaging must be one of ${PACKAGING.join(
        ' | '
      )}, got ${JSON.stringify(packaging)}`
    );
  }

  const handler = metadata['handler'];
  if (typeof handler !== 'string' || !handler.includes('.')) {
    fail(
      name,
      `metadata.lambda.handler must look like "file.export", got ${JSON.stringify(
        handler
      )}`
    );
  }

  if (typeof project.name !== 'string' || !project.name) {
    fail(name, 'project.json has no name');
  }

  const numberOrUndefined = (key: string): number | undefined => {
    const value = metadata[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      fail(name, `metadata.lambda.${key} must be a positive number`);
    }
    return value;
  };

  // Strict rather than truthy, because these govern IAM grants. `"false"` and
  // `"no"` are both truthy strings, and either would silently widen access —
  // to every collection in the environment, or to every seller's credentials.
  const flag = (key: 'couchbase' | 'amazonCredentials'): boolean => {
    const value = metadata[key];
    if (value !== undefined && typeof value !== 'boolean') {
      fail(
        name,
        `metadata.lambda.${key} must be a boolean, got ${JSON.stringify(value)}`
      );
    }
    return value === true;
  };
  const couchbase = flag('couchbase');
  const amazonCredentials = flag('amazonCredentials');

  // A function that can mint tokens but cannot read the profiles they are
  // stored on is a misconfiguration that only shows up at the first request.
  if (amazonCredentials && !couchbase) {
    fail(
      name,
      'metadata.lambda.amazonCredentials needs couchbase: true — the ' +
        'encrypted secrets live on the profile documents'
    );
  }

  return {
    projectName: project.name,
    metadata: {
      packaging: packaging as LambdaPackaging,
      handler,
      description:
        typeof metadata['description'] === 'string'
          ? metadata['description']
          : undefined,
      timeoutSeconds: numberOrUndefined('timeoutSeconds'),
      memoryMb: numberOrUndefined('memoryMb'),
      couchbase,
      amazonCredentials,
      routes: parseRoutes(name, metadata['routes']),
    },
  };
}

/**
 * Every Lambda app in the workspace, in a stable order.
 *
 * Sorted by name so the synthesised template does not churn between runs — a
 * diff that changes because a directory listing came back in a different order
 * is a diff nobody can review.
 */
export function discoverLambdaApps(workspaceRoot: string): LambdaApp[] {
  const lambdasDir = join(workspaceRoot, 'apps', 'lambdas');
  if (!existsSync(lambdasDir)) return [];

  const apps: LambdaApp[] = [];
  for (const entry of readdirSync(lambdasDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectFile = join(lambdasDir, entry.name, 'project.json');
    if (!existsSync(projectFile)) continue;

    const parsed = parseLambdaMetadata(
      entry.name,
      JSON.parse(readFileSync(projectFile, 'utf8'))
    );
    if (!parsed) continue;

    apps.push({
      ...parsed.metadata,
      projectName: parsed.projectName,
      name: entry.name,
      appPath: join('apps', 'lambdas', entry.name),
      distPath: join('dist', 'apps', 'lambdas', entry.name),
    });
  }

  apps.sort((a, b) => a.name.localeCompare(b.name));
  assertNoRouteConflicts(apps);
  return apps;
}

/**
 * Two apps claiming one route key is a mistake in one of them.
 *
 * Left to API Gateway it surfaces as a duplicate-construct error naming a
 * synthesised path, which says nothing about which two `project.json` files
 * disagree. Checked here, the message names both.
 */
function assertNoRouteConflicts(apps: LambdaApp[]): void {
  const claimed = new Map<string, string>();

  for (const app of apps) {
    for (const route of app.routes ?? []) {
      const owner = claimed.get(route);
      if (owner) {
        throw new Error(
          `Route "${route}" is claimed by both "${owner}" and "${app.name}". ` +
            `Remove it from one of apps/lambdas/${owner}/project.json or ` +
            `apps/lambdas/${app.name}/project.json.`
        );
      }
      claimed.set(route, app.name);
    }
  }
}
