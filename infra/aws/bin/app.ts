#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { getStageConfig } from '../config/stages.js';
import { MediaAssetsStack } from '../lib/media-assets-stack.js';
import { LambdasStack } from '../lib/lambdas-stack.js';

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

for (const [key, value] of Object.entries(tags)) {
  cdk.Tags.of(mediaAssetsStack).add(key, value);
  cdk.Tags.of(lambdasStack).add(key, value);
}
