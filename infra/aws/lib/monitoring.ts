import { Duration } from 'aws-cdk-lib';
import type { IHttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import type { StageConfig } from '../config/stages.js';

/**
 * Alarms on traffic that actually happened.
 *
 * Deliberately not a synthetic probe of `/health`. A dependency-free function
 * answering 200 mostly proves that AWS is up: it shares no code path with a
 * real request, so it stays green through exactly the failures worth paging
 * for. These watch what callers experienced instead, which needs no public
 * endpoint and no credential for a prober to hold.
 *
 * Errors and throttles are measured on the **alias**, because that is what is
 * invoked. Metrics on the bare function would also count direct `$LATEST`
 * invocations, which are someone debugging, not production traffic.
 */
export type ApiMonitoringProps = {
  config: StageConfig;
  /** The HTTP API to watch, when the stage built one. */
  api?: IHttpApi;
  /** Aliases to watch, keyed by app name. */
  targets: ReadonlyMap<string, lambda.Alias>;
};

export class ApiMonitoring extends Construct {
  /** Subscribe to this to be told. */
  public readonly topic: sns.Topic;
  /** Every alarm created, so tests and dashboards can enumerate them. */
  public readonly alarms: cloudwatch.Alarm[] = [];

  constructor(scope: Construct, id: string, props: ApiMonitoringProps) {
    super(scope, id);

    const { config, api, targets } = props;

    this.topic = new sns.Topic(this, 'Alarms', {
      topicName: `${config.appName}-${config.stageName}-alarms`,
      displayName: `SellAvant ${config.stageName} alarms`,
    });

    // Optional: an unsubscribed topic still records every alarm in the console
    // and costs nothing, so the absence of an address is not a reason to skip
    // the alarms themselves.
    if (config.alarmEmail) {
      this.topic.addSubscription(
        new subscriptions.EmailSubscription(config.alarmEmail)
      );
    }

    for (const [name, alias] of targets) {
      // Any error at all. A Lambda that threw is a defect every time — there is
      // no healthy rate of unhandled exceptions to tune around.
      this.alarm(
        `${pascal(name)}Errors`,
        alias.metricErrors({ period: Duration.minutes(5) }),
        1,
        `${name} threw at least one unhandled error in 5 minutes.`
      );

      // Throttling means concurrency ran out: requests were rejected before
      // the function ran, so nothing in its own logs will show it.
      this.alarm(
        `${pascal(name)}Throttles`,
        alias.metricThrottles({ period: Duration.minutes(5) }),
        1,
        `${name} was throttled — requests were rejected before it ran.`
      );
    }

    if (api) {
      // 5xx is the gateway or the integration failing. Always a defect.
      this.alarm(
        'ApiServerErrors',
        api.metricServerError({ period: Duration.minutes(5) }),
        1,
        'The HTTP API returned 5xx.'
      );

      // 4xx is mostly normal — an expired token is a 401 and users have those
      // all day. What is not normal is a sustained flood, which is what a
      // broken authorizer looks like: unreachable JWKS, or an audience that no
      // longer matches, rejecting every request while nothing throws and no
      // 5xx is recorded. Nothing else would catch that.
      //
      // The threshold is a placeholder until there is traffic to baseline
      // against, and two evaluation periods keep a brief blip from paging.
      this.alarm(
        'ApiClientErrors',
        api.metricClientError({ period: Duration.minutes(5) }),
        config.clientErrorAlarmThreshold ?? 50,
        'The HTTP API returned an unusual number of 4xx — check the authorizer.',
        2
      );
    }
  }

  private alarm(
    id: string,
    metric: cloudwatch.Metric,
    threshold: number,
    description: string,
    evaluationPeriods = 1
  ): void {
    const alarm = new cloudwatch.Alarm(this, id, {
      metric,
      threshold,
      evaluationPeriods,
      alarmDescription: description,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      // No data means no traffic, which is not a failure. Left as the default
      // these would sit in INSUFFICIENT_DATA and train everyone to ignore them.
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new actions.SnsAction(this.topic));
    this.alarms.push(alarm);
  }
}

function pascal(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}
