'use client';

import { MessageBubble } from '../../(dashboard)/chat/message-bubble';
import type { GalleryCase as Case } from './cases';

/**
 * One fixture, rendered exactly as the conversation would render it.
 *
 * A client boundary because `MessageBubble` is one, and because the approval
 * buttons need a handler — here it does nothing, so a screenshot cannot be
 * changed by clicking on it.
 */
export function GalleryCase({ entry }: { entry: Case }) {
  return (
    <MessageBubble
      message={entry.message}
      isLast={entry.isLast ?? false}
      isStreaming={entry.isStreaming ?? false}
      onApprovalResponse={() => undefined}
    />
  );
}
