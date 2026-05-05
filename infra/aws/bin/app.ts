#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { getStageConfig } from '../config/stages.js';
import { BedrockRuntimeStack } from '../lib/bedrock-runtime-stack.js';
import { MediaAssetsStack } from '../lib/media-assets-stack.js';

const app = new cdk.App();
const stage = getStageConfig(app.node.tryGetContext('stage'));

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

const bedrockRuntimeStack = new BedrockRuntimeStack(
  app,
  `${stage.appName}-${stage.stageName}-bedrock-runtime`,
  {
    env: {
      account: stage.account,
      region: stage.region,
    },
    config: stage,
    description: `SellAvant Bedrock runtime permissions for ${stage.stageName}.`,
  }
);

for (const [key, value] of Object.entries(tags)) {
  cdk.Tags.of(mediaAssetsStack).add(key, value);
  cdk.Tags.of(bedrockRuntimeStack).add(key, value);
}
