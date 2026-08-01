#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { getStageConfig } from '../config/stages.js';
import { MediaAssetsStack } from '../lib/media-assets-stack.js';
import { LambdasStack } from '../lib/lambdas-stack.js';
import { CredentialsKeyStack } from '../lib/credentials-key-stack.js';
import { VercelAccessStack } from '../lib/vercel-access-stack.js';

const app = new cdk.App();
const stage = getStageConfig(app.node.tryGetContext('stage'));

// Resolved from this file rather than the working directory: `cdk` can be run
// from the repo root or from infra/aws, and the artefact paths must not depend
// on which one somebody chose.
const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);

const tags: Record<string, string> = {
  Application: stage.appName,
  Stage: stage.stageName,
  ManagedBy: 'cdk',
};

const mediaAssetsStack = new MediaAssetsStack(
  app,
  `${stage.appName}-${stage.stageName}-media-assets`,
  {
    env: {
      account: stage.account,
      region: stage.region,
    },
    config: stage,
    description: `SellAvant media asset storage for ${stage.stageName}.`,
  }
);

const lambdasStack = new LambdasStack(
  app,
  `${stage.appName}-${stage.stageName}-lambdas`,
  {
    env: {
      account: stage.account,
      region: stage.region,
    },
    config: stage,
    workspaceRoot,
    description: `SellAvant Lambda functions for ${stage.stageName}.`,
  }
);

// Separate from everything else on purpose: destroying this key destroys every
// stored credential with it, so it must never be in the blast radius of a
// routine application teardown (#11).
const credentialsKeyStack = new CredentialsKeyStack(
  app,
  `${stage.appName}-${stage.stageName}-credentials-key`,
  {
    env: {
      account: stage.account,
      region: stage.region,
    },
    config: stage,
    description: `SellAvant stored-credential encryption key for ${stage.stageName}.`,
  }
);

// Only for a stage a Vercel deployment actually targets. Without this the
// stage grants Vercel no AWS access at all, which is the right default.
const vercelAccessStack = stage.vercel
  ? new VercelAccessStack(
      app,
      `${stage.appName}-${stage.stageName}-vercel-access`,
      {
        env: {
          account: stage.account,
          region: stage.region,
        },
        config: stage,
        description: `SellAvant Vercel OIDC access for ${stage.stageName}.`,
      }
    )
  : undefined;

if (vercelAccessStack) {
  // The whole point of the role: unwrap stored seller credentials.
  vercelAccessStack.grantCredentialsKey(credentialsKeyStack.key);

  // Reuse the media stack's own runtime policy rather than restating S3
  // permissions here, so the two cannot drift apart.
  vercelAccessStack.role.addManagedPolicy(mediaAssetsStack.runtimePolicy);
}

for (const [key, value] of Object.entries(tags)) {
  cdk.Tags.of(mediaAssetsStack).add(key, value);
  cdk.Tags.of(lambdasStack).add(key, value);
  cdk.Tags.of(credentialsKeyStack).add(key, value);
  if (vercelAccessStack) cdk.Tags.of(vercelAccessStack).add(key, value);
}
