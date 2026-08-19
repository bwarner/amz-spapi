import * as cdk from 'aws-cdk-lib';
import { CfnOutput, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { StageConfig } from '../config/stages.js';

export type GitHubAccessStackProps = cdk.StackProps & {
  config: StageConfig;
};

/**
 * The CDK bootstrap qualifier these stacks deploy under.
 *
 * Default, because nothing overrides it: there is no `cdk.json` and no custom
 * synthesizer. Verified against the prod account, which holds
 * `cdk-hnb659fds-{deploy,file-publishing,image-publishing,lookup}-role-…` at
 * bootstrap version 32. If a custom qualifier is ever adopted this is the one
 * place to change it — the grant below would otherwise go on naming roles that
 * do not exist, and fail only at deploy time.
 */
const CDK_BOOTSTRAP_QUALIFIER = 'hnb659fds';

/**
 * How GitHub Actions reaches AWS to deploy infrastructure, without a stored key.
 *
 * The counterpart to `VercelAccessStack`, and deliberately shaped like it:
 * GitHub signs a short-lived OIDC token per job, AWS trusts that issuer, and
 * `sts:AssumeRoleWithWebIdentity` exchanges it for temporary credentials. No
 * access key lives in repository secrets, so there is nothing to rotate and
 * nothing that keeps working after the job that used it has finished.
 *
 * **Why this exists.** `deploy-web.yml` gated the Vercel half of the system
 * behind a GitHub Release while the AWS half had no automation at all, because
 * the runner had no way into the account: no OIDC provider trusted GitHub, and
 * the documented procedure (`aws sso login`, then `AWS_PROFILE=… cdk deploy`)
 * needs an interactive login that cannot run unattended. So infrastructure
 * moved only when somebody remembered, and prod drifted twenty-two resources
 * behind `main` while the web app shipped twenty-one pull requests.
 *
 * **What it can do is narrow.** This role is not an administrator. It may
 * assume this account's CDK bootstrap roles and nothing else — the same doorway
 * `cdk deploy` uses from a workstation. Every permission that actually changes
 * infrastructure lives on `cdk-…-cfn-exec-role`, which CloudFormation assumes,
 * and is bounded by the bootstrap stack rather than by this file.
 */
export class GitHubAccessStack extends Stack {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubAccessStackProps) {
    super(scope, id, props);

    const { config } = props;
    const { github } = config;

    if (!github) {
      throw new Error(
        `Stage "${config.stageName}" has no GitHub settings, so no role can be ` +
          `scoped to it. Set them in config/stages.ts, or do not deploy this stack.`
      );
    }

    const issuerHost = 'token.actions.githubusercontent.com';

    /**
     * The OIDC provider is per ACCOUNT, and this URL is not even ours.
     *
     * IAM keys a provider by URL, and GitHub's is one global endpoint shared by
     * every GitHub user on earth — so it carries neither the stage nor the
     * organisation. The collision that already bit the Vercel stack is sharper
     * here: two stages sharing an account want the identical provider, and so
     * would any unrelated stack in that account that ever trusted GitHub. The
     * second to deploy fails with `EntityAlreadyExistsException`.
     *
     * So exactly one stage per account creates it and the rest reference it by
     * an ARN fully determined by the account and the URL — no export, no
     * import, and no deploy ordering between the stacks.
     */
    const providerArn = github.ownsOidcProvider
      ? new iam.OpenIdConnectProvider(this, 'GitHubOidc', {
          url: `https://${issuerHost}`,
          // GitHub's documented audience for AWS. Not a secret; it is simply
          // what the `aud` condition below is matched against.
          clientIds: ['sts.amazonaws.com'],
        }).openIdConnectProviderArn
      : Stack.of(this).formatArn({
          service: 'iam',
          region: '',
          resource: 'oidc-provider',
          resourceName: issuerHost,
        });

    /**
     * `sub` pins one repository AND one GitHub environment.
     *
     * The environment segment is the load-bearing half. A `repo:owner/name:ref:…`
     * subject would trust any workflow running on a branch, which is something
     * anyone who can push a branch can arrange. Naming the environment means the
     * job must declare `environment: production`, which is where GitHub's own
     * approval rules and secrets live — so the protection GitHub already
     * enforces becomes the same boundary AWS enforces, rather than a second one
     * that can quietly disagree with it.
     */
    const subject = `repo:${github.owner}/${github.repo}:environment:${github.environment}`;

    this.role = new iam.Role(this, 'GitHubDeployRole', {
      roleName: `${config.appName}-${config.stageName}-github-deploy`,
      description: `Assumed by GitHub Actions ${github.environment} deploys of ${github.owner}/${github.repo}.`,
      /**
       * Two operators, and the split is deliberate.
       *
       * `aud` is matched exactly: `sts.amazonaws.com` is a fixed literal with
       * no casing to disagree about.
       *
       * `sub` is matched case-INSENSITIVELY, because the environment segment is
       * a name a human typed into repository settings and IAM's StringEquals is
       * case-sensitive. This repository's environments are `Staging` and
       * `Production`; the workflow jobs and this config say `staging` and
       * `production`, which GitHub resolves case-insensitively on its side.
       * Whether the casing GitHub then puts in the token is the environment's
       * or the job's is not documented — the OIDC reference only ever shows an
       * all-lowercase example — and guessing decides whether every deploy in
       * this repository works.
       *
       * IgnoreCase costs almost nothing: the subject still pins one repository
       * and one environment, and the only additional principals it admits are
       * spellings of that same environment name, which GitHub will not let you
       * create twice anyway. The alternative is renaming both environments to
       * lowercase so all three layers agree — a better fix at the source, and
       * still worth doing, but it is a setting rather than something this stack
       * can guarantee.
       */
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          [`${issuerHost}:aud`]: 'sts.amazonaws.com',
        },
        StringEqualsIgnoreCase: {
          [`${issuerHost}:sub`]: subject,
        },
      }),
      // A CDK deploy of this app runs minutes, not hours — long enough that a
      // slow CloudFormation rollback does not lose its credentials mid-flight.
      maxSessionDuration: cdk.Duration.hours(1),
    });

    /**
     * The only grant: assume this account's CDK bootstrap roles.
     *
     * `cdk deploy` does not act as the caller. It assumes `deploy-role` to touch
     * CloudFormation, `file-publishing-role` and `image-publishing-role` to
     * stage assets, and `lookup-role` for context queries — then CloudFormation
     * assumes `cfn-exec-role` to make the actual changes. Granting those is
     * therefore the whole requirement, and granting more would hand CI a
     * permission the workstation path never had.
     *
     * Scoped to this account by ARN, so a token minted for this repository
     * cannot reach a bootstrap role in a different SellAvant account.
     */
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [
          Stack.of(this).formatArn({
            service: 'iam',
            region: '',
            resource: 'role',
            resourceName: `cdk-${CDK_BOOTSTRAP_QUALIFIER}-*`,
          }),
        ],
      })
    );

    new CfnOutput(this, 'GitHubDeployRoleArn', {
      value: this.role.roleArn,
      description:
        'Set as the AWS_DEPLOY_ROLE_ARN variable on the GitHub environment.',
    });

    new CfnOutput(this, 'GitHubOidcSubject', {
      value: subject,
      description: 'The only subject this role will accept.',
    });
  }
}
