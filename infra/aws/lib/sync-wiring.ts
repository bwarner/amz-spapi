import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import type { StageConfig } from '../config/stages.js';

/**
 * Scheduled SP-API sync (#36, ADR-0009).
 *
 *   EventBridge Scheduler → dispatcher → SQS FIFO → worker → Couchbase
 *
 * A Construct rather than a Stack, and that is not a style choice. As a separate
 * stack it deadlocked: the queue must grant the dispatcher and set its
 * `SYNC_QUEUE_URL`, which makes the lambdas stack depend on this one, while the
 * schedule needs the dispatcher's ARN, which makes this one depend on the
 * lambdas stack. CloudFormation rejects that outright:
 *
 *   «DependencyCycle» 'sellavant-dev-lambdas' depends on 'sellavant-dev-sync'
 *   … would create a cyclic reference
 *
 * Wiring that both reads from and writes to a set of functions belongs in the
 * stack that owns them. The file stays separate so the reasoning below is not
 * buried inside function discovery.
 */
export interface SyncWiringProps {
  config: StageConfig;
  /** Discovered by LambdasStack, which owns them. */
  dispatcher: lambda.Function;
  worker: lambda.Function;
  /** Existing alarm topic, so sync alarms land where the others already do. */
  alarmTopic?: sns.ITopic;
}

export class SyncWiring extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: SyncWiringProps) {
    super(scope, id);
    const { config } = props;
    const prefix = `${config.appName}-${config.stageName}-sync`;

    /**
     * Failures land here after the redrive policy gives up.
     *
     * Retained for 14 days — the maximum — because a DLQ message is the only
     * surviving record of a window that was never synced, and for finances the
     * data behind it ages out of Amazon in 180. Losing the evidence a week
     * later would leave a permanent hole with nothing to explain it.
     */
    this.deadLetterQueue = new sqs.Queue(this, 'SyncDlq', {
      queueName: `${prefix}-dlq.fifo`,
      fifo: true,
      contentBasedDeduplication: false,
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true,
    });

    /**
     * FIFO, with the seller id as the message group.
     *
     * That is the rate-pacing mechanism, not a nicety. SP-API limits are per
     * seller account, so serialising one seller's messages keeps a run inside
     * its budget while different sellers proceed in parallel. A standard queue
     * would need a global concurrency cap instead, which throttles every seller
     * to protect one.
     *
     * The cost is head-of-line blocking: a poison message stalls that seller's
     * group until `maxReceiveCount` sends it to the DLQ. Bounded, and the
     * dispatcher independently sheds sellers failing repeatedly, so a revoked
     * authorization stops producing messages rather than filling the DLQ.
     */
    this.queue = new sqs.Queue(this, 'SyncQueue', {
      queueName: `${prefix}.fifo`,
      fifo: true,
      // The dispatcher supplies explicit deduplication ids keyed on the run, so
      // content-based hashing would be both redundant and wrong: two runs of the
      // same seller × domain are legitimately different messages.
      contentBasedDeduplication: false,
      // Must exceed the worker timeout, or SQS redelivers a message that is
      // still being processed — and a second worker then runs the same seller
      // against Amazon concurrently, which is exactly what the FIFO grouping
      // exists to prevent. Six times, matching Lambda's own guidance.
      visibilityTimeout: cdk.Duration.minutes(30),
      retentionPeriod: cdk.Duration.days(4),
      enforceSSL: true,
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        // Three attempts: enough to ride out a throttle or a brief SP-API
        // outage, few enough that a genuinely broken seller reaches the DLQ
        // within one scheduled run rather than after days of retries.
        maxReceiveCount: 3,
      },
    });

    this.queue.grantSendMessages(props.dispatcher);
    props.dispatcher.addEnvironment('SYNC_QUEUE_URL', this.queue.queueUrl);

    props.worker.addEventSource(
      new SqsEventSource(this.queue, {
        // One message at a time. A larger batch would put several sellers in one
        // invocation and serialise them behind each other, which is the
        // opposite of what the FIFO grouping is for.
        batchSize: 1,
        // Without this the partial batch response the worker returns is
        // IGNORED, and any failure redelivers the whole batch.
        reportBatchItemFailures: true,
      })
    );

    /**
     * Nightly, in UTC.
     *
     * Deliberately not "every hour": Amazon's finance data settles slowly and a
     * more frequent poll spends rate-limit budget re-reading windows that have
     * not changed. Freshness beyond this comes from notifications (#85), not
     * from a tighter schedule.
     */
    const schedulerRole = new iam.Role(this, 'SyncSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Lets EventBridge Scheduler invoke the sync dispatcher.',
    });
    props.dispatcher.grantInvoke(schedulerRole);

    new scheduler.CfnSchedule(this, 'SyncSchedule', {
      name: `${prefix}-nightly`,
      description: 'Nightly SP-API sync fan-out.',
      flexibleTimeWindow: {
        // An hour of jitter. Every stage firing on the same minute would stack
        // identical SP-API load, and the data is not time-critical to the hour.
        mode: 'FLEXIBLE',
        maximumWindowInMinutes: 60,
      },
      scheduleExpression: 'cron(0 5 * * ? *)',
      scheduleExpressionTimezone: 'UTC',
      target: {
        arn: props.dispatcher.functionArn,
        roleArn: schedulerRole.roleArn,
        retryPolicy: {
          // The dispatcher is idempotent within a run thanks to the
          // deduplication id, so retrying it is safe.
          maximumRetryAttempts: 2,
          maximumEventAgeInSeconds: 3600,
        },
      },
    });

    /**
     * Anything in the DLQ is a window that was never synced.
     *
     * Alarming on the SQS metric rather than publishing our own: SQS already
     * emits this, and a second copy would cost money to say the same thing.
     *
     * The threshold is ONE. A dead letter here is not a transient blip — it
     * survived three receives — and for finances the data behind it ages out of
     * Amazon inside 180 days. There is no "acceptable background rate" of
     * permanently missing windows.
     */
    if (props.alarmTopic) {
      const dlqAlarm = new cloudwatch.Alarm(this, 'SyncDlqNotEmpty', {
        alarmName: `${prefix}-dlq-not-empty`,
        alarmDescription:
          'A sync window was never fetched. Each message names the seller and ' +
          'domain; the data behind a finances window is gone in 180 days.',
        metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
          period: cdk.Duration.minutes(5),
          statistic: 'Maximum',
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // A queue with nothing in it reports no data rather than zero, and
        // treating that as a breach would alarm on every quiet period.
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      dlqAlarm.addAlarmAction(new actions.SnsAction(props.alarmTopic));
    }

    new cdk.CfnOutput(this, 'SyncQueueUrl', {
      value: this.queue.queueUrl,
      description: 'FIFO queue carrying one message per seller × domain.',
    });
    new cdk.CfnOutput(this, 'SyncDlqUrl', {
      value: this.deadLetterQueue.queueUrl,
      description: 'Windows that were never synced. Worth an alarm.',
    });
  }
}
