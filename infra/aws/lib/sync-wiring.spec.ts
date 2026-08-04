import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { STAGES } from '../config/stages.js';
import { SyncWiring } from './sync-wiring.js';

/**
 * Queue semantics, not CDK's constructs (#36).
 *
 * Each of these is a property that fails silently if it drifts: a standard
 * queue still delivers, a batch of ten still processes, a missing partial-batch
 * setting still returns a response nobody reads. The system keeps working and
 * quietly does the wrong thing to a seller's rate limit or their data.
 */

function synth() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const fn = (id: string) =>
    new lambda.Function(stack, id, {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'main.handler',
      code: lambda.Code.fromInline('export const handler = async () => {};'),
    });

  new SyncWiring(stack, 'Sync', {
    config: STAGES.dev,
    dispatcher: fn('Dispatcher'),
    worker: fn('Worker'),
    alarmTopic: new sns.Topic(stack, 'Alarms'),
  });
  return Template.fromStack(stack);
}

describe('the queue', () => {
  it('is FIFO, which is what paces one seller against SP-API', () => {
    // Not decoration. SP-API limits are per seller account, so grouping by
    // seller serialises that account's run while other sellers proceed. A
    // standard queue would need a global concurrency cap instead, throttling
    // every seller to protect one.
    synth().hasResourceProperties('AWS::SQS::Queue', {
      QueueName: Match.stringLikeRegexp('sync\\.fifo$'),
      FifoQueue: true,
    });
  });

  it('does not deduplicate on content', () => {
    // Two scheduled runs of the same seller x domain are legitimately different
    // messages. Content hashing would drop the second as a duplicate and the
    // seller would sync once, ever.
    // Emitted explicitly as false rather than omitted, so assert the value.
    synth().hasResourceProperties('AWS::SQS::Queue', {
      QueueName: Match.stringLikeRegexp('sync\\.fifo$'),
      ContentBasedDeduplication: false,
    });
  });

  it('redrives to a DLQ rather than retrying forever', () => {
    synth().hasResourceProperties('AWS::SQS::Queue', {
      QueueName: Match.stringLikeRegexp('sync\\.fifo$'),
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
    });
  });

  it('holds the visibility timeout above the worker timeout', () => {
    // If it were shorter, SQS redelivers a message still being processed and a
    // second worker runs the same seller against Amazon concurrently — exactly
    // what the FIFO grouping exists to prevent.
    const props = synth().findResources('AWS::SQS::Queue');
    const main = Object.values(props).find((r) =>
      String(r.Properties.QueueName).endsWith('sync.fifo')
    );

    expect(main?.Properties.VisibilityTimeout).toBeGreaterThanOrEqual(300);
  });

  it('keeps dead letters for the full 14 days', () => {
    // A DLQ message is the only surviving record of a window never synced, and
    // for finances the data behind it ages out of Amazon in 180 days. Losing
    // the evidence early leaves a permanent hole with nothing to explain it.
    synth().hasResourceProperties('AWS::SQS::Queue', {
      QueueName: Match.stringLikeRegexp('dlq\\.fifo$'),
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
  });
});

describe('the worker event source', () => {
  it('reports partial batch failures', () => {
    // Without this the worker's response is IGNORED and one failure redelivers
    // the whole batch — so sellers that already succeeded re-run against
    // Amazon, spending rate-limit budget redoing completed work.
    synth().hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    });
  });

  it('takes one message at a time', () => {
    // A larger batch puts several sellers in one invocation and serialises them
    // behind each other, which is the opposite of what FIFO grouping is for.
    synth().hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 1,
    });
  });
});

describe('the schedule', () => {
  it('runs nightly in UTC', () => {
    synth().hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(0 5 * * ? *)',
      ScheduleExpressionTimezone: 'UTC',
    });
  });

  it('spreads the start across an hour', () => {
    // Every stage firing on the same minute stacks identical SP-API load, and
    // this data is not time-critical to the hour.
    synth().hasResourceProperties('AWS::Scheduler::Schedule', {
      FlexibleTimeWindow: Match.objectLike({
        Mode: 'FLEXIBLE',
        MaximumWindowInMinutes: 60,
      }),
    });
  });

  it('targets the dispatcher, never the worker', () => {
    // The worker is queue-driven. A schedule pointed at it would run a job with
    // no message to tell it which seller or domain.
    const schedules = synth().findResources('AWS::Scheduler::Schedule');
    const target = Object.values(schedules)[0].Properties.Target;

    expect(JSON.stringify(target)).toContain('Dispatcher');
    expect(JSON.stringify(target)).not.toContain('Worker');
  });
});

describe('the dispatcher', () => {
  it('is told the queue url', () => {
    synth().hasResourceProperties('AWS::Lambda::Function', {
      Environment: Match.objectLike({
        Variables: Match.objectLike({ SYNC_QUEUE_URL: Match.anyValue() }),
      }),
    });
  });
});

describe('the dead letter alarm', () => {
  it('fires on a single message', () => {
    // A dead letter survived three receives, and for finances the data behind
    // it ages out of Amazon inside 180 days. There is no acceptable background
    // rate of permanently missing windows.
    synth().hasResourceProperties('AWS::CloudWatch::Alarm', {
      Threshold: 1,
      EvaluationPeriods: 1,
      MetricName: 'ApproximateNumberOfMessagesVisible',
    });
  });

  it('does not alarm on an empty queue reporting no data', () => {
    // SQS reports no data rather than zero when a queue is idle. Treating that
    // as breaching would alarm through every quiet period, and an alarm that is
    // always red is one nobody reads.
    synth().hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'ApproximateNumberOfMessagesVisible',
      TreatMissingData: 'notBreaching',
    });
  });
});
