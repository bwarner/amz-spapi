import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import type { StageConfig } from '../config/stages.js';

/**
 * Scheduled Amazon Ads report sync (#145, ADR-0012).
 *
 *   EventBridge Scheduler → StateMachine → plan → Map( request → Wait → collect )
 *
 * ## Why this is a state machine and the SP sync next door is a queue
 *
 * Not inconsistency. The two workloads have opposite shapes, and ADR-0012
 * records the rule.
 *
 * `sync-wiring.ts` uses a FIFO queue because the seller id is the message group,
 * which paces one account's many rate-limited calls while other accounts proceed
 * in parallel. Step Functions cannot express that: `Map.MaxConcurrency` is a
 * GLOBAL cap, which is exactly the alternative that file rejects — throttling
 * every seller to protect one.
 *
 * This job is a handful of calls dominated by WAITING. Amazon takes minutes to
 * build a report, and SQS charges for that wait twice: every poll is a re-queue
 * plus a Lambda invocation, and a worker that sleeps instead burns its billed
 * runtime asleep and still dies at the timeout. A `Wait` state costs nothing and
 * runs no code.
 *
 * ## Why the Scheduler targets the machine directly
 *
 * The SP sync needs a dispatcher Lambda to decide which work is due. Here that
 * decision is the `plan` Task INSIDE the machine, so a separate function would
 * be a second deployable whose only job is to start something.
 *
 * A Construct rather than a Stack, for the reason `sync-wiring.ts` gives: the
 * machine needs the worker's ARN while the worker needs nothing back, but the
 * alarm and the schedule both live with the functions they watch, and splitting
 * them produced a CloudFormation dependency cycle last time.
 */
export interface AdsSyncWiringProps {
  config: StageConfig;
  /** Discovered by LambdasStack, which owns it. */
  worker: lambda.Function;
  /** Existing alarm topic, so ads alarms land where the others already do. */
  alarmTopic?: sns.ITopic;
}

export class AdsSyncWiring extends Construct {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: AdsSyncWiringProps) {
    super(scope, id);
    const { config, worker } = props;
    const prefix = `${config.appName}-${config.stageName}-ads-sync`;

    /** Shared retry for the calls that reach Amazon. */
    const amazonRetry = {
      // Transient only. A revoked token or a rejected window is not going to
      // succeed on the third attempt, and retrying it spends minutes proving
      // that — which is the classification `maxReceiveCount: 3` cannot make.
      errors: [
        'Lambda.TooManyRequestsException',
        'Lambda.ServiceException',
        'Lambda.AWSLambdaException',
        'Lambda.SdkClientException',
      ],
      interval: cdk.Duration.seconds(60),
      backoffRate: 2,
      maxAttempts: 5,
    };

    const plan = new tasks.LambdaInvoke(this, 'Plan', {
      lambdaFunction: worker,
      payload: sfn.TaskInput.fromObject({ step: 'plan' }),
      // The handler's own return value, not the Lambda envelope. Everything
      // downstream reads `items`, and `$.Payload.items` would leak the
      // invocation shape into every state below.
      outputPath: '$.Payload',
    }).addRetry(amazonRetry);

    const request = new tasks.LambdaInvoke(this, 'RequestReport', {
      lambdaFunction: worker,
      payload: sfn.TaskInput.fromObject({
        step: 'request',
        'item.$': '$.item',
      }),
      resultPath: '$.request',
      resultSelector: { 'state.$': '$.Payload.state' },
    }).addRetry(amazonRetry);

    /**
     * A minute before the first poll.
     *
     * Amazon has never finished a report faster than this, so polling sooner
     * spends a Lambda invocation to be told PROCESSING. The wait costs nothing:
     * Step Functions bills state transitions, not elapsed time.
     */
    const wait = new sfn.Wait(this, 'WaitForReport', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(60)),
    });

    const collect = new tasks.LambdaInvoke(this, 'CollectReport', {
      lambdaFunction: worker,
      payload: sfn.TaskInput.fromObject({
        step: 'collect',
        'item.$': '$.item',
      }),
      resultPath: '$.collect',
      resultSelector: {
        'state.$': '$.Payload.state',
        'rowsNew.$': '$.Payload.rowsNew',
      },
    }).addRetry(amazonRetry);

    const done = new sfn.Succeed(this, 'Done');

    /**
     * `pending` goes back to Wait; everything else ends this item.
     *
     * `failed` succeeds the ITEM deliberately. The failure is already on the run
     * record — which is what stops a failed fetch reading downstream as "this
     * seller ran no ads" — and failing the branch here would only add a second,
     * less informative record of the same fact while risking the Map's
     * tolerated-failure budget on something already handled.
     */
    const afterCollect = new sfn.Choice(this, 'ReportReady?')
      .when(sfn.Condition.stringEquals('$.collect.state', 'pending'), wait)
      .otherwise(done);

    wait.next(collect);
    collect.next(afterCollect);

    // A window already ingested, or already being built. Requesting again would
    // pay Amazon twice for rows dedup then discards.
    const perItem = new sfn.Choice(this, 'RequestAccepted?')
      .when(
        sfn.Condition.stringEquals('$.request.state', 'skipped'),
        new sfn.Succeed(this, 'AlreadyHeld')
      )
      .otherwise(wait);

    request.next(perItem);

    const eachProfile = new sfn.Map(this, 'EachReport', {
      itemsPath: '$.items',
      // `itemSelector`, not the deprecated `parameters`: each iteration is
      // handed ONE work item under a stable key, so the Task states inside read
      // `$.item` rather than depending on where the Map put it.
      itemSelector: { 'item.$': '$$.Map.Item.Value' },
      /**
       * One profile's report failing must not abandon the others.
       *
       * Reports are independent — a revoked token on the CA profile says
       * nothing about the US one — so a whole-run failure would discard good
       * work to report a problem already recorded per profile.
       */
      resultPath: sfn.JsonPath.DISCARD,
      maxConcurrency: 4,
    });
    eachProfile.itemProcessor(request);
    eachProfile.addCatch(new sfn.Succeed(this, 'MapFinishedWithFailures'), {
      resultPath: sfn.JsonPath.DISCARD,
    });

    plan.next(eachProfile);

    this.stateMachine = new sfn.StateMachine(this, 'AdsSyncStateMachine', {
      stateMachineName: `${prefix}`,
      definitionBody: sfn.DefinitionBody.fromChainable(plan),
      /**
       * Long enough for a slow report, short enough that a stuck execution is
       * not still running tomorrow when the next one starts. `collectAdsReport`
       * gives up after its own poll ceiling well before this.
       */
      timeout: cdk.Duration.hours(2),
      stateMachineType: sfn.StateMachineType.STANDARD,
      tracingEnabled: true,
    });

    /**
     * Daily, after the SP-API window.
     *
     * Later than the SP sync on purpose: ads reports are what the harvest reads,
     * and running them while SP-API work is still in flight would stack two
     * different rate budgets against the same account for no gain.
     */
    const schedulerRole = new iam.Role(this, 'AdsSyncSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Lets EventBridge Scheduler start the ads sync machine.',
    });
    this.stateMachine.grantStartExecution(schedulerRole);

    new scheduler.CfnSchedule(this, 'AdsSyncSchedule', {
      name: `${prefix}-daily`,
      description: 'Daily Amazon Ads report sync.',
      flexibleTimeWindow: { mode: 'FLEXIBLE', maximumWindowInMinutes: 60 },
      scheduleExpression: 'cron(0 7 * * ? *)',
      scheduleExpressionTimezone: 'UTC',
      target: {
        arn: this.stateMachine.stateMachineArn,
        roleArn: schedulerRole.roleArn,
        retryPolicy: {
          // Safe to retry: `requestAdsReport` declines a window already
          // requested or ingested, so a second execution costs a plan and
          // some skips rather than a second paid report.
          maximumRetryAttempts: 2,
          maximumEventAgeInSeconds: 3600,
        },
      },
    });

    /**
     * A failed EXECUTION is the alarm, not a failed report.
     *
     * Per-report failures are recorded on the run and surfaced on the AdOps
     * screen; alarming on them would page for a single revoked profile. An
     * execution that fails outright means the machine itself could not run —
     * the plan step died, or every branch threw — and then nothing was fetched
     * at all, which is the case that goes unnoticed.
     */
    if (props.alarmTopic) {
      const failed = new cloudwatch.Alarm(this, 'AdsSyncExecutionFailed', {
        alarmName: `${prefix}-execution-failed`,
        alarmDescription:
          'The ads report sync could not run. Ads performance stops updating ' +
          'silently: the harvest refuses on its coverage gate and the AdOps ' +
          'screen keeps showing whatever was last ingested.',
        metric: this.stateMachine.metricFailed({
          period: cdk.Duration.hours(1),
          statistic: 'Sum',
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      failed.addAlarmAction(new actions.SnsAction(props.alarmTopic));
    }

    new cdk.CfnOutput(this, 'AdsSyncStateMachineArn', {
      value: this.stateMachine.stateMachineArn,
      description: 'Daily ads report sync. Start it by hand to backfill.',
    });
  }
}
