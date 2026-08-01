import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';

/**
 * How this app authenticates to AWS, in both places it runs (#11).
 *
 * On Vercel there is no AWS credential to find: no instance profile, no
 * `~/.aws`, and deliberately no access key in the dashboard. Instead Vercel
 * signs a short-lived OIDC token per deployment and STS exchanges it for
 * temporary credentials via `AssumeRoleWithWebIdentity`. The role is created in
 * `infra/aws/lib/vercel-access-stack.ts`, and its trust policy pins the team,
 * project and environment, so the token is only good for this deployment.
 *
 * Locally there is no OIDC token, and `AWS_ROLE_ARN` is unset, so this returns
 * `undefined` and the SDK falls back to its own chain — the SSO profile in
 * `AWS_PROFILE`. That asymmetry is the point: neither environment needs a
 * stored key, and neither needs to know about the other.
 *
 * Note the default chain is not a fallback *on Vercel*. If `AWS_ROLE_ARN` were
 * missing there, the SDK would search for credentials it cannot find and fail
 * at the first call — which is exactly what the app did before this existed.
 */
export function awsCredentials(): AwsCredentialIdentityProvider | undefined {
  const roleArn = process.env['AWS_ROLE_ARN'];
  if (!roleArn) return undefined;

  return awsCredentialsProvider({ roleArn });
}
