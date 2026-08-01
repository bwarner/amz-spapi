import { Annotations, CfnOutput } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import type { StageConfig } from '../config/stages.js';
import type { LambdaApp } from './lambda-apps.js';

export type LambdaHttpApiProps = {
  config: StageConfig;
  /** Every discovered app; those with no `routes` are skipped. */
  apps: LambdaApp[];
  /**
   * What each route invokes, keyed by app name — the `live` alias, not the
   * bare function. Integrating `$LATEST` would tie the API to a mutable
   * pointer, so a deploy could not be shifted gradually or rolled back.
   */
  targets: ReadonlyMap<string, lambda.IFunction>;
  /**
   * The Auth0 authorizer from #54, applied to every route once it exists.
   * Until then routes are **unauthenticated** and synth says so.
   */
  authorizer?: apigwv2.IHttpRouteAuthorizer;
};

/**
 * The HTTP front door, built from what the apps declare (#54).
 *
 * Routes come from `metadata.lambda.routes` in each app's project.json, for the
 * same reason the functions themselves do: a list of paths kept in the CDK file
 * becomes the thing that knows, and drifts from the handlers it claims to
 * describe. Making a function reachable is adding a line to its own project.
 *
 * Deliberately a Construct rather than its own Stack. Consuming
 * `LambdasStack.functions` across a stack boundary would make CloudFormation
 * exports, and an export cannot be removed while another stack imports it — so
 * deleting a route later would need a two-step deploy to undo something that
 * should be one line.
 *
 * No CORS: the browser never calls this. Next.js route handlers call it
 * server-side with the user's access token, which is the seam #54 describes.
 */
export class LambdaHttpApi extends Construct {
  public readonly api: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: LambdaHttpApiProps) {
    super(scope, id);

    const { config, apps, targets, authorizer } = props;
    const routed = apps.filter((app) => app.routes?.length);

    this.api = new apigwv2.HttpApi(this, 'Api', {
      apiName: `${config.appName}-${config.stageName}`,
      description: `SellAvant private API for ${config.stageName}.`,
    });

    if (!authorizer) {
      // Visible on every synth and deploy rather than buried in a comment: an
      // API with no authorizer answers anyone who finds the URL.
      Annotations.of(this).addWarningV2(
        'sellavant:http-api-unauthenticated',
        `HTTP API "${config.appName}-${config.stageName}" has no authorizer, so ` +
          `its ${routed.length} routed function(s) are reachable without ` +
          `credentials. The Auth0 authorizer is #54; do not route anything ` +
          `that reads seller data until it is wired.`
      );
    }

    for (const app of routed) {
      const target = targets.get(app.name);
      if (!target) {
        // Only reachable if the two are built from different app lists.
        throw new Error(
          `Lambda "${app.name}" declares routes but no function was built for it.`
        );
      }

      // One integration per function, shared by that function's routes: the
      // integration is the function, not the path.
      const integration = new HttpLambdaIntegration(
        `${pascal(app.name)}Integration`,
        target
      );

      for (const route of app.routes ?? []) {
        const [method, path] = route.split(' ');
        this.api.addRoutes({
          path,
          methods: [method as apigwv2.HttpMethod],
          integration,
          authorizer,
        });
      }
    }

    new CfnOutput(this, 'ApiUrl', {
      value: this.api.apiEndpoint,
      description: `HTTP API endpoint (${routed.length} routed function(s)).`,
    });
  }
}

function pascal(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}
