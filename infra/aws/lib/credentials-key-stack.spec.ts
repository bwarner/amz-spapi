import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { STAGES, type StageConfig } from '../config/stages.js';
import { CredentialsKeyStack } from './credentials-key-stack.js';

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
