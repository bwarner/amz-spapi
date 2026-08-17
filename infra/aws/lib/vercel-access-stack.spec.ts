import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { STAGES, type StageConfig } from '../config/stages.js';
import { VercelAccessStack } from './vercel-access-stack.js';

/**
 * The Vercel OIDC role (#11).
 *
 * Two things carry the security of this stack, and one of them is also the
 * thing that broke a deploy: the trust policy must pin exactly one Vercel
 * environment, and the account-level OIDC provider must be created exactly
 * once per AWS account no matter how many stages share it.
 */

function synth(config: StageConfig): Template {
  const app = new cdk.App();
  return Template.fromStack(
    new VercelAccessStack(app, `test-${config.stageName}-vercel`, {
      env: { account: config.account, region: config.region },
      config,
    })
  );
}

const PROVIDER = 'Custom::AWSCDKOpenIdConnectProvider';

describe('the account-level OIDC provider', () => {
  it('is created by the stage that owns it', () => {
    synth(STAGES.dev).resourceCountIs(PROVIDER, 1);
  });

  it('is NOT created by a stage that shares the account', () => {
    // The failure this prevents is a real one: dev and staging share account
    // 853583158600, IAM keys a provider by URL, and the URL carries the team
    // rather than the stage — so the second stack to deploy died with
    // `EntityAlreadyExistsException: Provider with url … already exists`.
    synth(STAGES.staging).resourceCountIs(PROVIDER, 0);
  });

  it('still trusts the existing provider, by a constructed ARN', () => {
    // Referencing rather than importing: the ARN is fully determined by the
    // account and the URL, so there is no export to publish and no deploy
    // ordering between the two stacks.
    const json = JSON.stringify(synth(STAGES.staging).toJSON());

    expect(json).toContain(
      `:iam::${STAGES.staging.account}:oidc-provider/oidc.vercel.com/bfwarnergmailcoms-projects`
    );
  });

  it('gives production its own, since it is alone in its account', () => {
    synth(STAGES.prod).resourceCountIs(PROVIDER, 1);
  });
});

describe('the trust policy', () => {
  const subjectOf = (config: StageConfig): string => {
    const roles = synth(config).findResources('AWS::IAM::Role');
    const role = Object.values(roles).find(
      (r) => r.Properties.RoleName === `sellavant-${config.stageName}-vercel`
    );
    return JSON.stringify(role?.Properties.AssumeRolePolicyDocument);
  };

  it('pins staging to the custom environment, not to preview', () => {
    // Verified against a real token: the segment is the environment NAME, and
    // staging deploys to a Vercel CUSTOM environment called `staging`.
    expect(subjectOf(STAGES.staging)).toContain('environment:staging');
  });

  it('keeps dev on preview, so a PR preview cannot assume staging', () => {
    // The whole isolation argument for two stages in one AWS account. If both
    // claimed the same subject, either could assume the other's role.
    expect(subjectOf(STAGES.dev)).toContain('environment:preview');
    expect(subjectOf(STAGES.dev)).not.toContain('environment:staging');
  });

  it('pins the audience as well as the subject', () => {
    // Subject alone is not enough: `aud` is what stops a token minted for a
    // different consumer being replayed here.
    expect(subjectOf(STAGES.staging)).toContain(
      'https://vercel.com/bfwarnergmailcoms-projects'
    );
  });

  it('accepts only web identity, never a bare AWS principal', () => {
    synth(STAGES.staging).hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'sellavant-staging-vercel',
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'sts:AssumeRoleWithWebIdentity' }),
        ]),
      }),
    });
  });
});

describe('what the role may do', () => {
  it('carries no KMS grant', () => {
    // #55 moved credential decryption into the credentials Lambda. A grant
    // here would leave the capability standing with nothing using it.
    expect(JSON.stringify(synth(STAGES.staging).toJSON())).not.toContain(
      'kms:Decrypt'
    );
  });
});

describe('a stage with no Vercel settings', () => {
  it('refuses to synth rather than deploying an unscoped role', () => {
    expect(() => synth({ ...STAGES.staging, vercel: undefined })).toThrow(
      /no Vercel settings/
    );
  });
});
