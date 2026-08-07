import * as cdk from 'aws-cdk-lib';
import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import type { StageConfig } from '../config/stages.js';

export type CredentialsKeyStackProps = cdk.StackProps & {
  config: StageConfig;
};

/**
 * The names other stacks reach this key by.
 *
 * Functions rather than literals because the lambdas stack imports the key
 * across a stack boundary (#55), and a name spelled out twice is a name that
 * will eventually be spelled differently — surfacing as `No export named …` at
 * deploy, long after the typo.
 */
export function credentialsKeyExportName(config: StageConfig): string {
  return `${config.appName}-${config.stageName}-credentials-key-arn`;
}

/** The stable alias. Preferred over the ARN — encrypt resolves it. */
export function credentialsKeyAlias(config: StageConfig): string {
  return `alias/${config.appName}-${config.stageName}-credentials`;
}

/**
 * The key that protects stored seller credentials (#11).
 *
 * LWA refresh tokens are long-lived and grant access to a seller's Amazon
 * account. Until now they sat in Couchbase in plaintext, so a compromise of the
 * database — or of a backup, or of anyone with read access to it — handed over
 * every connected seller. Encrypting under KMS moves the blast radius: the
 * ciphertext is useless without a separate AWS authorisation that Couchbase
 * knows nothing about.
 *
 * Its own stack because its lifecycle is not the application's. Deleting this
 * key destroys every credential encrypted under it, irreversibly and with no
 * way to re-derive them, so it must be possible to redeploy or tear down the
 * Lambdas and the buckets without ever putting this in the blast radius of that
 * command.
 */
export class CredentialsKeyStack extends Stack {
  public readonly key: kms.Key;

  constructor(scope: Construct, id: string, props: CredentialsKeyStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.key = new kms.Key(this, 'CredentialsKey', {
      description: `SellAvant stored seller credentials (${config.stageName}).`,

      // Yearly rotation of the backing material. Ciphertext records which
      // version encrypted it, so old data keeps decrypting with no re-encrypt
      // step and no key id in the decrypt call — which is why `decrypt` takes
      // only the ciphertext.
      enableKeyRotation: true,

      // A stage that retains its assets retains its key. Everywhere else the
      // key is destroyed with the stage — which destroys the credentials with
      // it, and that is the intended reading for dev: the tokens there are
      // disposable and re-obtainable by reconnecting.
      removalPolicy: config.retainAssets
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,

      // AWS's minimum. Only reached after a destroy, and only for a stage that
      // asked not to be retained; the window exists so a mistake is noticed
      // before it becomes permanent.
      pendingWindow: Duration.days(7),
    });

    // A stable name, so nothing has to thread a generated key id through
    // configuration. `KMS_CREDENTIAL_KEY_ID` can be this alias — encrypt
    // resolves it, and decrypt does not need it at all.
    this.key.addAlias(credentialsKeyAlias(config));

    new CfnOutput(this, 'CredentialsKeyArn', {
      value: this.key.keyArn,
      description:
        'KMS key for stored seller credentials. Set as KMS_CREDENTIAL_KEY_ID.',
      // Imported by the lambdas stack, which grants the credentials function
      // decrypt on it. Renaming this breaks that deploy, not this one.
      exportName: credentialsKeyExportName(config),
    });

    new CfnOutput(this, 'CredentialsKeyAlias', {
      value: credentialsKeyAlias(config),
      description: 'Stable alias for the same key; preferred over the ARN.',
    });
  }
}
