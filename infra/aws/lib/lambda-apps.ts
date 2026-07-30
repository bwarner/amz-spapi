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
  /** Set for HTTP-facing functions once #54 lands; ignored until then. */
  route?: string;
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

function fail(name: string, problem: string): never {
  throw new Error(
    `Lambda app "${name}": ${problem}. Fix metadata.lambda in ` +
      `apps/lambdas/${name}/project.json — see apps/lambdas/README.md.`
  );
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
      route:
        typeof metadata['route'] === 'string' ? metadata['route'] : undefined,
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

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}
