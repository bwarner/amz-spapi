import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { STAGES, type StageConfig } from '../config/stages.js';
import { CredentialsKeyStack } from './credentials-key-stack.js';
import { VercelAccessStack } from './vercel-access-stack.js';

/**
 * The properties that matter here are the ones whose absence is silent: a key
 * without rotation still works, and a key that is destroyed with its stage
 * still deploys. Both are only discovered later, and one of them is discovered
 * by losing every stored credential.
 */

function synth(config: StageConfig = STAGES.dev): Template {
  const app = new cdk.App();
  return Template.fromStack(
    new CredentialsKeyStack(app, 'test-credentials-key', {
      env: { account: '111122223333', region: 'us-east-1' },
      config,
    })
  );
}

describe('CredentialsKeyStack', () => {
  it('rotates the key, so old ciphertext keeps decrypting without a re-encrypt', () => {
    synth().hasResourceProperties('AWS::KMS::Key', {
      EnableKeyRotation: true,
    });
  });

  it('gives the key a stable alias, so nothing threads a generated id around', () => {
    synth().hasResourceProperties('AWS::KMS::Alias', {
      AliasName: 'alias/sellavant-dev-credentials',
    });
  });

  it('retains the key for a stage that retains its assets', () => {
    // Deleting it destroys every credential encrypted under it, irreversibly.
    const template = synth(STAGES.staging);

    template.hasResource('AWS::KMS::Key', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('destroys the key for a stage that does not, matching its other assets', () => {
    synth(STAGES.dev).hasResource('AWS::KMS::Key', {
      DeletionPolicy: 'Delete',
    });
  });

  it('leaves a window in which a destroy can still be undone', () => {
    synth(STAGES.dev).hasResourceProperties('AWS::KMS::Key', {
      PendingWindowInDays: 7,
    });
  });

  it('exports the ARN so other stacks can grant on it without a duplicate key', () => {
    const outputs = synth().findOutputs('*');

    expect(
      Object.values(outputs).some(
        (output) => output.Export?.Name === 'sellavant-dev-credentials-key-arn'
      )
    ).toBe(true);
  });

  it('creates the key and nothing else — this stack is only the key', () => {
    // Its lifecycle is deliberately not the application's, so anything else
    // landing here would tie the two together again.
    const template = synth();

    template.resourceCountIs('AWS::KMS::Key', 1);
    template.resourceCountIs('AWS::KMS::Alias', 1);
  });
});

/**
 * Who may unwrap a stored credential (#55, step 5).
 *
 * The list is the security boundary, so it gets a test rather than a comment.
 * It used to include the Vercel role — that was the original purpose of the
 * `vercel-access` stack — and the whole of #55 is the work of removing it.
 */
describe('the Vercel role no longer decrypts credentials', () => {
  it('the vercel-access stack grants no KMS action at all', () => {
    const app = new cdk.App();
    const stack = new VercelAccessStack(app, 'test-vercel-access', {
      env: { account: '111122223333', region: 'us-east-1' },
      config: STAGES.dev,
    });

    const json = JSON.stringify(Template.fromStack(stack).toJSON());

    expect(json).not.toContain('kms:Decrypt');
    expect(json).not.toContain('kms:Encrypt');
    expect(json).not.toContain('kms:GenerateDataKey');
  });

  it('exposes no way to grant one', () => {
    // `grantCredentialsKey` is gone rather than merely uncalled. An unused
    // method that re-grants the most dangerous capability in the system is an
    // invitation, and nothing in the codebase would fail if someone accepted it.
    const app = new cdk.App();
    const stack = new VercelAccessStack(app, 'test-vercel-access-2', {
      env: { account: '111122223333', region: 'us-east-1' },
      config: STAGES.dev,
    });

    expect(
      (stack as unknown as Record<string, unknown>)['grantCredentialsKey']
    ).toBeUndefined();
  });
});

/**
 * The migration scaffold that keeps the key-ARN export alive (#55, step 5).
 *
 * Tested so that removing it is a deliberate act with a failing test attached,
 * rather than a tidy-up that silently breaks the next prod deploy. See the
 * comment on `exportValue` in the stack for the removal condition.
 */
describe('the key-ARN export is published unconditionally', () => {
  const template = () => {
    const app = new cdk.App();
    return Template.fromStack(
      new CredentialsKeyStack(app, 'sellavant-dev-credentials-key', {
        env: { account: '111122223333', region: 'us-east-1' },
        config: STAGES.dev,
      })
    );
  };

  it('publishes the auto-generated name the old consumer imports', () => {
    // The NAME is the contract, and it is not ours to choose: CloudFormation
    // matches imports by string. `vercel-access` stacks deployed before #55
    // import exactly this, so a different name would leave the export they
    // depend on unpublished — which is the failure this exists to prevent.
    const exports = Object.values(template().toJSON().Outputs ?? {})
      .map((output) => (output as { Export?: { Name?: string } }).Export?.Name)
      .filter(Boolean);

    expect(exports).toContain(
      'sellavant-dev-credentials-key:ExportsOutputFnGetAttCredentialsKeyA24B74BFArn9B22653B'
    );
  });

  it('still publishes the stable named export as well', () => {
    // The one the lambdas stack imports by name. Unrelated to the scaffold, and
    // it must survive its removal.
    template().hasOutput('CredentialsKeyArn', {
      Export: { Name: 'sellavant-dev-credentials-key-arn' },
    });
  });
});
