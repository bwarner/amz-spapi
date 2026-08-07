'use client';

import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { ToolUIPart } from 'ai';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  CircleSlashIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { isValidElement } from 'react';
import { CodeBlock } from './code-block';

/**
 * AI Elements `tool`, vendored from https://registry.ai-sdk.dev/tool.json.
 *
 * What it buys us is the collapsible body: until now a tool call was a single
 * line of prose and there was no way to see what it was asked for or what came
 * back, so "the numbers look wrong" had nowhere to go but a guess.
 *
 * TWO DELIBERATE CHANGES.
 *
 * 1. `stalled`. The registry maps state straight to a badge, so an unsettled
 *    call renders as "Running" with a pulsing clock — forever. But state alone
 *    cannot tell running from never-finished: both are simply "not settled".
 *    Reopening a conversation then showed live-looking spinners for calls that
 *    had stopped days earlier and would never resume; seven of them, in the
 *    case that prompted #72. Only the caller knows whether anything is actually
 *    in flight, so it passes that in and a stalled call says it did not finish.
 *
 * 2. `group` on the trigger. The registry's chevron carries
 *    `group-data-[state=open]:rotate-180` with no `group` anywhere above it, so
 *    it never rotates and the control gives no sign it is expandable.
 */

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn('not-prose w-full rounded-md border', className)}
    {...props}
  />
);

export type ToolHeaderProps = {
  title?: string;
  type: ToolUIPart['type'];
  state: ToolUIPart['state'];
  /**
   * The call is unsettled and nothing is running: the turn ended without it
   * resolving. A spinner here would claim work is happening; there is no
   * request.
   */
  stalled?: boolean;
  className?: string;
};

const STATE_LABELS: Record<ToolUIPart['state'], string> = {
  'input-streaming': 'Pending',
  'input-available': 'Running',
  'approval-requested': 'Awaiting approval',
  'approval-responded': 'Responded',
  'output-available': 'Completed',
  'output-error': 'Error',
  'output-denied': 'Denied',
};

const STATE_ICONS: Record<ToolUIPart['state'], ReactNode> = {
  'input-streaming': <CircleIcon className="size-3.5" />,
  'input-available': <ClockIcon className="size-3.5 animate-pulse" />,
  'approval-requested': <ClockIcon className="size-3.5 text-amber-600" />,
  'approval-responded': <CheckCircleIcon className="size-3.5 text-blue-600" />,
  'output-available': <CheckCircleIcon className="size-3.5 text-green-600" />,
  'output-error': <XCircleIcon className="size-3.5 text-red-600" />,
  'output-denied': <XCircleIcon className="size-3.5 text-orange-600" />,
};

const getStatusBadge = (state: ToolUIPart['state'], stalled: boolean) => {
  if (stalled) {
    return (
      <Badge className="gap-1.5 rounded-full text-xs" variant="outline">
        <CircleSlashIcon className="size-3.5 text-muted-foreground/60" />
        Didn&rsquo;t finish
      </Badge>
    );
  }

  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {STATE_ICONS[state]}
      {STATE_LABELS[state]}
    </Badge>
  );
};

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  stalled = false,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      'group flex w-full items-center justify-between gap-4 p-3 text-left',
      className
    )}
    {...props}
  >
    <div className="flex min-w-0 items-center gap-2">
      <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span
        className={cn(
          'truncate font-medium text-sm',
          stalled && 'text-muted-foreground/60 line-through'
        )}
      >
        {title ?? type.split('-').slice(1).join('-')}
      </span>
      {getStatusBadge(state, stalled)}
    </div>
    <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<'div'> & {
  input: ToolUIPart['input'];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div
    className={cn('space-y-2 overflow-hidden px-3 pb-3', className)}
    {...props}
  >
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
  </div>
);

export type ToolOutputProps = ComponentProps<'div'> & {
  output: ToolUIPart['output'];
  errorText: ToolUIPart['errorText'];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let rendered = <div>{output as ReactNode}</div>;

  if (typeof output === 'string') {
    rendered = <CodeBlock code={output} language="text" />;
  } else if (typeof output === 'object' && !isValidElement(output)) {
    rendered = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  }

  return (
    <div className={cn('space-y-2 px-3 pb-3', className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? 'Error' : 'Result'}
      </h4>
      {errorText ? (
        <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
          {errorText}
        </div>
      ) : (
        rendered
      )}
    </div>
  );
};
