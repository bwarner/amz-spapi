/**
 * The function that proves the pipeline (#53).
 *
 * It answers with what it is and where it is running, which is exactly what you
 * want from the first Lambda in a new stack: if this responds, the Nx build, the
 * bundle, the CDK construct, the IAM role and the deploy all worked. It has no
 * dependencies and touches nothing, so a failure here is never ambiguous.
 *
 * Pure TypeScript with no native dependencies, so it takes the bundled-zip path
 * — see apps/lambdas/README.md.
 */

export type HealthResponse = {
  status: 'ok';
  service: string;
  stage: string;
  /** Set by Lambda itself; absent when running under `sam local invoke`. */
  requestId?: string;
  at: string;
};

export type MinimalContext = { awsRequestId?: string };

/** Split out so the response can be asserted without faking a Lambda runtime. */
export function buildHealthResponse(
  env: NodeJS.ProcessEnv,
  context: MinimalContext | undefined,
  now: Date
): HealthResponse {
  return {
    status: 'ok',
    service: env['SERVICE_NAME'] || 'health',
    stage: env['STAGE'] || 'dev',
    requestId: context?.awsRequestId,
    at: now.toISOString(),
  };
}

export async function handler(
  _event: unknown,
  context?: MinimalContext
): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
  const payload = buildHealthResponse(process.env, context, new Date());

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}
