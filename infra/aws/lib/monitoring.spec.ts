import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { STAGES, type StageConfig } from '../config/stages.js';
import { LambdasStack } from './lambdas-stack.js';

/**
 * These pin the alarms to the failures they exist to catch, not to CloudWatch.
 *
 * The one that matters most is the client-error alarm: it is the only signal
 * that would notice a broken authorizer, which rejects every request while
 * nothing throws and no 5xx is ever recorded.
 */

type Fixture = { routes?: string[] };

function workspace(apps: Record<string, Fixture>): string {
  const root = mkdtempSync(join(tmpdir(), 'monitoring-'));

  for (const [name, fixture] of Object.entries(apps)) {
    const appDir = join(root, 'apps', 'lambdas', name);
    const distDir = join(root, 'dist', 'apps', 'lambdas', name);
    mkdirSync(appDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });

    writeFileSync(
      join(appDir, 'project.json'),
      JSON.stringify({
        name: `lambda-${name}`,
        metadata: {
          lambda: {
            packaging: 'zip',
            handler: 'main.handler',
            ...(fixture.routes ? { routes: fixture.routes } : {}),
          },
        },
      })
    );
    writeFileSync(
      join(distDir, 'main.js'),
      'export const handler = async () => ({});\n'
    );
  }

  return root;
}

function synth(root: string, config: StageConfig = STAGES.dev): Template {
  const app = new cdk.App();
  return Template.fromStack(
    new LambdasStack(app, 'test-lambdas', {
      env: { account: '111122223333', region: 'us-east-1' },
      config,
      workspaceRoot: root,
    })
  );
}

/** Alarms matching a metric name, whatever they are called. */
function alarmsOn(template: Template, metricName: string) {
  return Object.values(template.findResources('AWS::CloudWatch::Alarm')).filter(
    (alarm) => alarm.Properties.MetricName === metricName
  );
}

describe('ApiMonitoring topic', () => {
  it('creates a topic even with no email to send to', () => {
    // An unsubscribed alarm still records in the console, so a missing address
    // is not a reason to skip the alarms.
    const template = synth(workspace({ health: {} }));

    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.resourceCountIs('AWS::SNS::Subscription', 0);
  });

  it('subscribes the configured address', () => {
    const template = synth(workspace({ health: {} }), {
      ...STAGES.dev,
      alarmEmail: 'ops@example.com',
    });

    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'ops@example.com',
    });
  });
});

describe('ApiMonitoring Lambda alarms', () => {
  it('alarms on any error, since none is a healthy rate', () => {
    const template = synth(workspace({ health: {} }));
    const [errors] = alarmsOn(template, 'Errors');

    expect(errors.Properties.Threshold).toBe(1);
    expect(errors.Properties.ComparisonOperator).toBe(
      'GreaterThanOrEqualToThreshold'
    );
  });

  it('alarms on throttles, which leave no trace in the function log', () => {
    const template = synth(workspace({ health: {} }));

    expect(alarmsOn(template, 'Throttles')).toHaveLength(1);
  });

  it('measures the alias, not the bare function', () => {
    // Metrics on the function would also count direct $LATEST invocations,
    // which are someone debugging rather than production traffic.
    const template = synth(workspace({ health: {} }));
    const [errors] = alarmsOn(template, 'Errors');

    const resource = errors.Properties.Dimensions.find(
      (d: { Name: string }) => d.Name === 'Resource'
    );
    expect(resource).toBeDefined();
  });

  it('covers every function, so adding one cannot leave it unwatched', () => {
    const template = synth(
      workspace({ health: {}, me: { routes: ['GET /me'] }, triage: {} })
    );

    expect(alarmsOn(template, 'Errors')).toHaveLength(3);
    expect(alarmsOn(template, 'Throttles')).toHaveLength(3);
  });

  it('treats no traffic as healthy rather than insufficient data', () => {
    // Left as the default these would sit in INSUFFICIENT_DATA and train
    // everyone to ignore them.
    const template = synth(workspace({ health: {} }));

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      TreatMissingData: 'notBreaching',
    });
  });
});

describe('ApiMonitoring API alarms', () => {
  const routed = () => workspace({ me: { routes: ['GET /me'] } });

  it('alarms on any 5xx', () => {
    const [serverErrors] = alarmsOn(synth(routed()), '5xx');

    expect(serverErrors.Properties.Threshold).toBe(1);
  });

  it('alarms on a 4xx flood, which is what a broken authorizer looks like', () => {
    // Nothing else would catch it: every request is rejected, nothing throws,
    // and no 5xx is recorded.
    const [clientErrors] = alarmsOn(synth(routed()), '4xx');

    expect(clientErrors.Properties.Threshold).toBe(50);
    // Two periods, so an ordinary blip of expired tokens does not page.
    expect(clientErrors.Properties.EvaluationPeriods).toBe(2);
  });

  it('takes the 4xx threshold from the stage when it is tuned', () => {
    const template = synth(routed(), {
      ...STAGES.dev,
      clientErrorAlarmThreshold: 200,
    });

    expect(alarmsOn(template, '4xx')[0].Properties.Threshold).toBe(200);
  });

  it('builds no API alarms when there is no API', () => {
    const template = synth(workspace({ triage: {} }));

    expect(alarmsOn(template, '5xx')).toHaveLength(0);
    expect(alarmsOn(template, '4xx')).toHaveLength(0);
  });
});

describe('ApiMonitoring wiring', () => {
  it('points every alarm at the topic', () => {
    const template = synth(workspace({ me: { routes: ['GET /me'] } }));
    const alarms = Object.values(
      template.findResources('AWS::CloudWatch::Alarm')
    );

    const topicId = Object.keys(template.findResources('AWS::SNS::Topic'))[0];

    expect(alarms.length).toBeGreaterThan(0);
    for (const alarm of alarms) {
      // An alarm with no action is a dashboard nobody looks at.
      expect(alarm.Properties.AlarmActions).toEqual([{ Ref: topicId }]);
    }
  });

  it('gives every alarm a description saying what it means', () => {
    const template = synth(workspace({ me: { routes: ['GET /me'] } }));

    for (const alarm of Object.values(
      template.findResources('AWS::CloudWatch::Alarm')
    )) {
      expect(alarm.Properties.AlarmDescription).toBeTruthy();
    }
  });
});
