import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { STAGES, type StageConfig } from '../config/stages.js';
import { GitHubAccessStack } from './github-access-stack.js';

/**
 * The GitHub Actions OIDC deploy role.
 *
 * Two things carry the security of this stack. The trust policy must pin one
 * repository AND one GitHub environment — a branch-scoped subject would trust
 * anyone who can push a branch. And the grant must stay narrow: assuming the
 * CDK bootstrap roles is the whole requirement, so anything wider hands CI a
 * permission the workstation path never had.
 */

function synth(config: StageConfig): Template {
  const app = new cdk.App();
  return Template.fromStack(
    new GitHubAccessStack(app, `test-${config.stageName}-github`, {
      env: { account: config.account, region: config.region },
      config,
    })
  );
}

const PROVIDER = 'Custom::AWSCDKOpenIdConnectProvider';

const PROD_GITHUB = STAGES.prod.github;
if (!PROD_GITHUB) {
  throw new Error(
    'The prod stage must carry GitHub settings; these tests describe them.'
  );
}

/** A second stage in the same account, which must reference the provider rather than recreate it. */
const sharingTheAccount: StageConfig = {
  ...STAGES.prod,
  stageName: 'staging',
  github: { ...PROD_GITHUB, ownsOidcProvider: false },
};

describe('the trust policy', () => {
  it('pins the repository and the GitHub environment, not a branch', () => {
    // `repo:owner/name:ref:refs/heads/main` would be satisfied by any workflow
    // running on a branch, and branches are cheap to create. The environment
    // segment is what forces the job through GitHub's deployment rules.
    //
    // The subject is matched case-insensitively and the audience exactly: the
    // environment segment is a name someone typed into repository settings
    // (`Production` here, `production` in the workflow), and GitHub does not
    // document which casing reaches the token. `sts.amazonaws.com` has no such
    // ambiguity.
    synth(STAGES.prod).hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              },
              StringEqualsIgnoreCase: {
                'token.actions.githubusercontent.com:sub':
                  'repo:bwarner/amz-spapi:environment:production',
              },
            },
          }),
        ]),
      }),
    });
  });

  it('matches the whole subject, never a prefix', () => {
    // Case-insensitive is not the same as loose. A trailing wildcard is the
    // classic mistake here: `repo:bwarner/amz-spapi:*` accepts every workflow
    // in the repository, on any branch, with no environment in the path at all.
    const json = JSON.stringify(synth(STAGES.prod).toJSON());
    expect(json).not.toContain('StringLike');
    expect(json).toContain('repo:bwarner/amz-spapi:environment:production');
    expect(json).not.toContain('repo:bwarner/amz-spapi:*');
  });

  it('scopes staging to its own environment, not production’s', () => {
    // Both stages now deploy from CI, and they live in different AWS accounts.
    // A subject shared between them would let a push to main reach prod.
    const json = JSON.stringify(synth(STAGES.staging).toJSON());
    expect(json).toContain('repo:bwarner/amz-spapi:environment:staging');
    expect(json).not.toContain('environment:production');
  });
});

describe('the permissions granted', () => {
  it('is allowed to assume the CDK bootstrap roles', () => {
    synth(STAGES.prod).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'AssumeCdkBootstrapRoles',
            Action: 'sts:AssumeRole',
          }),
        ]),
      }),
    });
  });

  it('scopes those roles to this account, not to every account', () => {
    // A token minted for this repository must not reach a bootstrap role in a
    // different SellAvant account — that is the boundary between prod and dev.
    const json = JSON.stringify(synth(STAGES.prod).toJSON());
    expect(json).toContain(`cdk-hnb659fds-*`);
    expect(json).not.toContain(':iam::*:role/');
  });

  it('grants nothing else — CI is not an administrator', () => {
    // Every permission that changes infrastructure belongs to cfn-exec-role,
    // which CloudFormation assumes and the bootstrap stack bounds. If this
    // stack ever grows a second statement, that reasoning no longer holds.
    const policies = synth(STAGES.prod).findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap(
      (p) => p.Properties.PolicyDocument.Statement as unknown[]
    );
    expect(statements).toHaveLength(1);
  });
});

describe('the account-level OIDC provider', () => {
  it('is created by the stage that owns it', () => {
    synth(STAGES.prod).resourceCountIs(PROVIDER, 1);
  });

  it('trusts the audience AWS STS requires', () => {
    synth(STAGES.prod).hasResourceProperties(PROVIDER, {
      ClientIDList: ['sts.amazonaws.com'],
    });
  });

  it('is NOT created by a stage that only references it', () => {
    // GitHub's issuer URL is one global endpoint, so it carries neither stage
    // nor organisation. Two stages in one account want the identical provider
    // and the second to deploy would die with EntityAlreadyExistsException —
    // the same failure that already bit the Vercel stack.
    synth(sharingTheAccount).resourceCountIs(PROVIDER, 0);
  });

  it('still trusts the existing provider, by a constructed ARN', () => {
    const json = JSON.stringify(synth(sharingTheAccount).toJSON());
    expect(json).toContain('oidc-provider/token.actions.githubusercontent.com');
  });
});

describe('a stage with no GitHub settings', () => {
  it('refuses to synthesize rather than deploying an unscoped role', () => {
    // The failure mode being prevented is a role whose subject condition is
    // built from `undefined` and therefore matches nothing useful — or, worse,
    // is dropped and matches everything.
    const { github: _omitted, ...rest } = STAGES.prod;
    expect(() => synth(rest as StageConfig)).toThrow(/has no GitHub settings/);
  });
});
