'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ToolUIPart } from 'ai';
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
} from 'react';
import {
  confirmationPhase,
  type ToolUIPartApproval,
} from './confirmation-state';

export type { ToolUIPartApproval };

/**
 * AI Elements `confirmation`, vendored from
 * https://registry.ai-sdk.dev/confirmation.json.
 *
 * What it buys us over the box it replaces: request, accepted and rejected are
 * first-class states. Ours rendered only the request, so the moment a seller
 * answered, the question and their answer both vanished — a live listing write
 * or a purchase order was approved and the transcript kept no trace of it.
 *
 * Modified in one respect. The registry source carries `@ts-expect-error` on
 * every approval state, because those states exist only in AI SDK v6 and it has
 * to compile against v5 too. We are on v6 (6.0.217), where they are in
 * `ToolUIPart` — an unused directive is itself an error (TS2578), so they are
 * removed and the SDK's own approval type is used rather than a local copy that
 * would drift from it.
 */

type ConfirmationContextValue = {
  approval: ToolUIPartApproval | undefined;
  state: ToolUIPart['state'];
};

const ConfirmationContext = createContext<ConfirmationContextValue | null>(
  null
);

const useConfirmation = () => {
  const context = useContext(ConfirmationContext);

  if (!context) {
    throw new Error('Confirmation components must be used within Confirmation');
  }

  return context;
};

export type ConfirmationProps = ComponentProps<typeof Alert> & {
  approval?: ToolUIPartApproval;
  state: ToolUIPart['state'];
};

export const Confirmation = ({
  className,
  approval,
  state,
  ...props
}: ConfirmationProps) => {
  if (!approval || state === 'input-streaming' || state === 'input-available') {
    return null;
  }

  return (
    <ConfirmationContext.Provider value={{ approval, state }}>
      <Alert className={cn('flex flex-col gap-2', className)} {...props} />
    </ConfirmationContext.Provider>
  );
};

export type ConfirmationTitleProps = ComponentProps<typeof AlertDescription>;

export const ConfirmationTitle = ({
  className,
  ...props
}: ConfirmationTitleProps) => (
  <AlertDescription className={cn('inline', className)} {...props} />
);

export type ConfirmationRequestProps = {
  children?: ReactNode;
};

export const ConfirmationRequest = ({ children }: ConfirmationRequestProps) => {
  const { approval, state } = useConfirmation();

  if (confirmationPhase(state, approval) !== 'request') {
    return null;
  }

  return children;
};

export type ConfirmationAcceptedProps = {
  children?: ReactNode;
};

export const ConfirmationAccepted = ({
  children,
}: ConfirmationAcceptedProps) => {
  const { approval, state } = useConfirmation();

  if (confirmationPhase(state, approval) !== 'accepted') {
    return null;
  }

  return children;
};

export type ConfirmationRejectedProps = {
  children?: ReactNode;
};

export const ConfirmationRejected = ({
  children,
}: ConfirmationRejectedProps) => {
  const { approval, state } = useConfirmation();

  if (confirmationPhase(state, approval) !== 'rejected') {
    return null;
  }

  return children;
};

export type ConfirmationActionsProps = ComponentProps<'div'>;

export const ConfirmationActions = ({
  className,
  ...props
}: ConfirmationActionsProps) => {
  const { approval, state } = useConfirmation();

  if (confirmationPhase(state, approval) !== 'request') {
    return null;
  }

  return (
    <div
      className={cn('flex items-center justify-end gap-2 self-end', className)}
      {...props}
    />
  );
};

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export const ConfirmationAction = (props: ConfirmationActionProps) => (
  <Button className="h-8 px-3 text-sm" type="button" {...props} />
);
