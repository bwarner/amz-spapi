import * as cdk from 'aws-cdk-lib';
import { CfnOutput, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { StageConfig } from '../config/stages.js';

export type VercelAccessStackProps = cdk.StackProps & {
  config: StageConfig;
};

/**
 * How the Vercel-hosted web app reaches AWS, without a stored AWS credential.
 *
 * Vercel signs a short-lived OIDC token per deployment; AWS trusts that issuer
 * and exchanges the token for temporary credentials via
 * `sts:AssumeRoleWithWebIdentity`. Nothing long-lived exists to leak: there is
 * no access key in the Vercel dashboard, nothing to rotate, and nothing that
 * keeps working after the deployment that used it is gone.
 *
 * **It no longer decrypts seller credentials.** That grant was the original
 * reason this stack existed, and #55 removed the need for it: stored
 * credentials are unwrapped in the credentials Lambda now, so the Vercel
 * runtime has nothing to decrypt and is not given the ability. What remains is
 * S3 access for generated media.
 *
 * The trust policy pins both the audience and the subject, so it is not enough
 * to hold *a* Vercel token: it must be one issued for this team, this project,
 * and this environment.
 */
export class VercelAccessStack extends Stack {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: VercelAccessStackProps) {
    super(scope, id, props);

    const { config } = props;
    const { vercel } = config;

    if (!vercel) {
      throw new Error(
        `Stage "${config.stageName}" has no Vercel settings, so no role can be ` +
          `scoped to it. Set them in config/stages.ts, or do not deploy this stack.`
      );
    }

    // Team-scoped issuer. The alternative — the global `oidc.vercel.com` — is
    // one issuer shared by every Vercel customer, which puts the entire burden
    // of the boundary on the `aud` and `sub` conditions below.
    const issuerUrl = `https://oidc.vercel.com/${vercel.teamSlug}`;

    const provider = new iam.OpenIdConnectProvider(this, 'VercelOidc', {
      url: issuerUrl,
      // Vercel's own audience convention. Not a secret; it is what the `aud`
      // condition is matched against.
      clientIds: [`https://vercel.com/${vercel.teamSlug}`],
    });

    // `sub` identifies exactly one project in one environment. Without it, any
    // project in the team could assume this role — including one added later
    // by someone who never saw this file.
    const subject = `owner:${vercel.teamSlug}:project:${vercel.projectName}:environment:${vercel.environment}`;

    this.role = new iam.Role(this, 'VercelRole', {
      roleName: `${config.appName}-${config.stageName}-vercel`,
      description: `Assumed by Vercel ${vercel.environment} deployments of ${vercel.projectName}.`,
      assumedBy: new iam.WebIdentityPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            [`oidc.vercel.com/${vercel.teamSlug}:aud`]: `https://vercel.com/${vercel.teamSlug}`,
            [`oidc.vercel.com/${vercel.teamSlug}:sub`]: subject,
          },
        }
      ),
      // An hour is far longer than a request; the credentials are cached per
      // instance and re-obtained on expiry.
      maxSessionDuration: cdk.Duration.hours(1),
    });

    new CfnOutput(this, 'VercelRoleArn', {
      value: this.role.roleArn,
      description: 'Set as AWS_ROLE_ARN in the Vercel project.',
    });

    new CfnOutput(this, 'VercelOidcSubject', {
      value: subject,
      description: 'The only subject this role will accept.',
    });
  }
}
