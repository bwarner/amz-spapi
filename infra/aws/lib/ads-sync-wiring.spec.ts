import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { STAGES } from '../config/stages.js';
import { AdsSyncWiring } from './ads-sync-wiring.js';

/**
 * State machine semantics, not CDK's constructs (#145, ADR-0012).
 *
 * The failures these guard are the quiet ones. A machine that fails a whole run
 * on one revoked profile still "works" — it just fetches nothing for the other
 * three. A poll loop with no Wait still works, and bills for every poll. A
 * retry that treats a rejected window as transient still works, and spends five
 * minutes proving it.
 */

function synth() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const worker = new lambda.Function(stack, 'AdsWorker', {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: 'main.handler',
    code: lambda.Code.fromInline('export const handler = async () => {};'),
  });

  new AdsSyncWiring(stack, 'AdsSync', {
    config: STAGES.dev,
    worker,
    alarmTopic: new sns.Topic(stack, 'Alarms'),
  });
  return Template.fromStack(stack);
}

/** The machine definition, as the object CloudFormation will receive. */
function definition(template: Template): Record<string, unknown> {
  const machines = template.findResources('AWS::StepFunctions::StateMachine');
  const body = Object.values(machines)[0].Properties.DefinitionString;
  // CDK emits the definition as an Fn::Join of literals and ARN references.
  // The references sit INSIDE already-quoted strings, so the placeholder must
  // be bare — quoting it produces `""ARN""` and invalid JSON.
  const joined = (body['Fn::Join']?.[1] ?? [])
    .map((part: unknown) => (typeof part === 'string' ? part : 'ARN'))
    .join('');
  return JSON.parse(joined);
}

/**
 * The per-item states, which live inside the Map rather than at the top level.
 *
 * Everything interesting — the wait, the poll loop, the skip — is per report,
 * so a test reading only `definition().States` sees Plan and the Map and
 * concludes the machine does nothing.
 */
function itemStates(
  template: Template
): Record<string, Record<string, unknown>> {
  const states = definition(template).States as Record<
    string,
    { Type: string }
  >;
  const map = Object.values(states).find((s) => s.Type === 'Map') as
    | { ItemProcessor?: { States: Record<string, Record<string, unknown>> } }
    | undefined;
  return map?.ItemProcessor?.States ?? {};
}

describe('the machine', () => {
  it('exists as a STANDARD machine, not express', () => {
    // Express drops execution history after five minutes, and a report that
    // took eight would have no record of what happened to it.
    synth().hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineType: 'STANDARD',
    });
  });

  it('waits rather than polling immediately', () => {
    // The whole reason this is not a queue: waiting costs nothing here, and a
    // poll that arrives before Amazon has finished spends an invocation to be
    // told PROCESSING.
    const waits = Object.values(itemStates(synth())).filter(
      (s) => s.Type === 'Wait'
    );

    expect(waits.length).toBeGreaterThan(0);
  });

  it('loops back to Wait while a report is pending', () => {
    // Without the loop the machine polls once and gives up on every report that
    // is not instantly ready, which is nearly all of them.
    const states = itemStates(synth());
    const choice = states['ReportReady?'] as {
      Choices: Array<{ StringEquals?: string; Next: string }>;
    };
    const pending = choice.Choices.find((c) => c.StringEquals === 'pending');

    expect(pending?.Next).toBe('WaitForReport');
  });

  it('does not re-request a window it already holds', () => {
    // Amazon bills for generation, so `skipped` must END the item rather than
    // fall through to the wait-and-collect loop and a second paid report.
    const states = itemStates(synth());
    const choice = states['RequestAccepted?'] as {
      Choices: Array<{ StringEquals?: string; Next: string }>;
    };
    const skipped = choice.Choices.find((c) => c.StringEquals === 'skipped');

    expect(skipped).toBeDefined();
    expect(states[skipped?.Next ?? ''].Type).toBe('Succeed');
  });

  it('lets one profile fail without taking the run with it', () => {
    // A revoked token on the CA profile says nothing about the US one, so a
    // whole-run failure would discard good work to report a handled problem.
    const states = definition(synth()).States as Record<
      string,
      { Type: string; Catch?: Array<{ ErrorEquals: string[]; Next: string }> }
    >;
    const map = Object.values(states).find((s) => s.Type === 'Map');

    const caught = map?.Catch?.[0];
    expect(caught?.ErrorEquals).toEqual(['States.ALL']);
    expect(states[caught?.Next ?? ''].Type).toBe('Succeed');
  });

  it('bounds concurrency, so four profiles do not become four times the rate', () => {
    const states = definition(synth()).States as Record<
      string,
      { Type: string; MaxConcurrency?: number }
    >;
    const map = Object.values(states).find((s) => s.Type === 'Map');

    expect(map?.MaxConcurrency).toBeGreaterThan(0);
    expect(map?.MaxConcurrency).toBeLessThanOrEqual(10);
  });

  it('retries only transient errors, never States.ALL', () => {
    // The classification a queue's maxReceiveCount cannot make: a revoked token
    // or a rejected window will not succeed on the third attempt, and retrying
    // spends minutes proving it.
    //
    // Asserted on the Retry blocks specifically. The Map's Catch DOES use
    // States.ALL, deliberately — that is what lets one profile fail without
    // taking the run with it — so a whole-document search would flag the
    // correct behaviour as the bug.
    const retries = Object.values(itemStates(synth())).flatMap(
      (state) => (state['Retry'] as Array<{ ErrorEquals: string[] }>) ?? []
    );

    expect(retries.length).toBeGreaterThan(0);
    expect(retries.flatMap((r) => r.ErrorEquals)).toContain(
      'Lambda.TooManyRequestsException'
    );
    for (const retry of retries) {
      expect(retry.ErrorEquals).not.toContain('States.ALL');
    }
  });
});

describe('the schedule', () => {
  it('starts the machine directly, with no dispatcher in between', () => {
    // "Which runs are due" is the plan Task inside the machine, so a dispatcher
    // would be a second deployable whose only job is to start something.
    const schedules = synth().findResources('AWS::Scheduler::Schedule');
    const target = Object.values(schedules)[0].Properties.Target;

    expect(JSON.stringify(target.Arn)).toContain('StateMachine');
  });

  it('runs after the SP-API window, not alongside it', () => {
    // Stacking two rate budgets against the same account buys nothing.
    synth().hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(0 7 * * ? *)',
    });
  });

  it('jitters, so every stage does not fire on the same minute', () => {
    synth().hasResourceProperties('AWS::Scheduler::Schedule', {
      FlexibleTimeWindow: Match.objectLike({ Mode: 'FLEXIBLE' }),
    });
  });

  it('grants the scheduler only StartExecution', () => {
    const policies = synth().findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap(
      (p) =>
        p.Properties.PolicyDocument.Statement as Array<Record<string, unknown>>
    );
    const scheduler = statements.filter((s) =>
      JSON.stringify(s['Action']).includes('states:StartExecution')
    );

    expect(scheduler.length).toBeGreaterThan(0);
    for (const statement of scheduler) {
      expect(JSON.stringify(statement['Action'])).not.toContain('states:*');
    }
  });
});

describe('the alarm', () => {
  it('fires on a failed EXECUTION, not on a failed report', () => {
    // Per-report failures are on the run record; alarming on them would page
    // for one revoked profile. An execution failure means nothing was fetched.
    synth().hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'ExecutionsFailed',
      Threshold: 1,
    });
  });

  it('treats no data as healthy, so a quiet day does not alarm', () => {
    synth().hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'ExecutionsFailed',
      TreatMissingData: 'notBreaching',
    });
  });
});
