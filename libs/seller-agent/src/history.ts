import type { ModelMessage, UIMessage } from 'ai';

export interface HistoryConfig {
  maxMessages?: number;
  minRecentMessages?: number;
}

const DEFAULT_MAX_MESSAGES = 20;
const DEFAULT_MIN_RECENT_MESSAGES = 10;

/**
 * Trims conversation history to reduce token usage while preserving context.
 * Preserves tool call/result pairs and ensures remaining messages start with a user message.
 */
export function trimHistory(
  messages: UIMessage[],
  config: HistoryConfig = {}
): UIMessage[] {
  const maxMessages = config.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const minRecentMessages =
    config.minRecentMessages ?? DEFAULT_MIN_RECENT_MESSAGES;

  if (messages.length <= maxMessages) {
    return sanitizeMessages(messages);
  }

  const toRemove = messages.length - maxMessages;
  const safeToRemove = Math.min(toRemove, messages.length - minRecentMessages);

  if (safeToRemove <= 0) {
    return sanitizeMessages(messages);
  }

  let trimIndex = safeToRemove;

  for (let i = trimIndex; i < messages.length - minRecentMessages; i++) {
    const msg = messages[i];
    if (msg?.role === 'user') {
      trimIndex = i;
      break;
    }
    if (msg?.role === 'assistant' && !hasUnresolvedToolCalls(msg)) {
      trimIndex = i + 1;
    }
  }

  let trimmed = messages.slice(trimIndex);

  while (trimmed.length > minRecentMessages && trimmed[0]?.role !== 'user') {
    trimmed = trimmed.slice(1);
  }

  return sanitizeMessages(trimmed);
}

function hasUnresolvedToolCalls(message: UIMessage): boolean {
  if (!message.parts) return false;
  return message.parts.some((part) => {
    if (!part.type.startsWith('tool-') || part.type === 'tool-result')
      return false;
    const tp = part as { type: string; state?: string };
    return tp.state !== 'output-available' && tp.state !== 'output-error';
  });
}

/** Settled calls. These carry a result, so they are always safe to send. */
const SETTLED_TOOL_STATES = new Set(['output-available', 'output-error']);

/** A live approval handshake. Resolvable only in the LAST assistant message. */
const APPROVAL_TOOL_STATES = new Set([
  'approval-requested',
  'approval-responded',
]);

/**
 * Whether a tool part may be sent to the model.
 *
 * Two failures pull in opposite directions here, and both have bitten:
 *
 * 1. Strip the LIVE approval and the approved call vanishes before
 *    `convertToModelMessages` runs. No `tool-approval-response` is emitted, the
 *    tool never executes, and the model — seeing no record the call was made —
 *    proposes a new one, which asks for approval again. That was the
 *    `create-purchase-order` loop.
 *
 * 2. Keep a STALE approval and it converts to a `tool_use` block with no
 *    `tool_result` after it, because nothing will ever execute a call from a
 *    turn that has already ended. Anthropic rejects the whole request:
 *
 *      messages.33: `tool_use` ids were found without `tool_result` blocks
 *      immediately after
 *
 *    which breaks every subsequent message in the conversation, not just the
 *    one that produced it.
 *
 * So an approval part is keepable exactly while it can still be resolved: in
 * the last assistant message, which is the one the next request acts on.
 * Everywhere else it is an orphan and must go, same as a call abandoned
 * mid-stream (`input-streaming` / `input-available`), which is never keepable.
 */
function isKeepableToolPart(
  part: { type: string; state?: string },
  isLastAssistantMessage: boolean
): boolean {
  if (!part.type.startsWith('tool-') || part.type === 'tool-result') {
    return true;
  }
  const state = part.state ?? '';
  if (SETTLED_TOOL_STATES.has(state)) return true;
  return isLastAssistantMessage && APPROVAL_TOOL_STATES.has(state);
}

function sanitizeMessages(messages: UIMessage[]): UIMessage[] {
  // Only the final assistant message can still have its approvals resolved, so
  // it is the only one allowed to carry them.
  const lastAssistantIndex = messages.reduce(
    (found, msg, index) => (msg.role === 'assistant' ? index : found),
    -1
  );

  return messages.map((msg, index) => {
    if (msg.role !== 'assistant' || !msg.parts) return msg;
    const isLast = index === lastAssistantIndex;

    const keepable = (part: unknown) =>
      isKeepableToolPart(part as { type: string; state?: string }, isLast);

    if (msg.parts.every(keepable)) return msg;

    const cleanParts = msg.parts.filter(keepable);

    // Every part was dropped. Returning the message untouched would put the
    // orphans straight back, so return it empty-partsed instead: the turn
    // produced nothing the model can act on, and saying nothing is correct.
    if (cleanParts.length === 0) return { ...msg, parts: [] };

    return { ...msg, parts: cleanParts };
  });
}

/** Images kept in context: the current look plus one for comparison. */
const DEFAULT_IMAGE_HISTORY = 2;

/**
 * Strip images out of all but the most recent tool results.
 *
 * A tool that returns pixels (look-at-photo) costs ~1.4k tokens per image and
 * those tokens are REPLAYED on every later turn — four looks in one turn means
 * ~6k tokens of stale screenshots riding along forever. Prompt caching would
 * make those cheap but they would still consume the context window, so the fix
 * is to drop them: the model keeps the text summary it was given alongside each
 * image, plus whatever it concluded at the time, and can always look again.
 *
 * Runs on ModelMessages, after convertToModelMessages has materialised the
 * images, so it needs no cooperation from the tools themselves.
 */
export function dropStaleToolImages(
  messages: ModelMessage[],
  keep = DEFAULT_IMAGE_HISTORY
): ModelMessage[] {
  const isImagePart = (part: unknown) => {
    const type = (part as { type?: string } | null)?.type;
    return type === 'image-data' || type === 'image-url' || type === 'media';
  };

  // Index every tool-result part that carries an image, newest last.
  const carriers: Array<{ message: number; part: number }> = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) return;
    message.content.forEach((part, partIndex) => {
      const output = (part as { output?: { type?: string; value?: unknown } })
        .output;
      if (
        output?.type === 'content' &&
        Array.isArray(output.value) &&
        output.value.some(isImagePart)
      ) {
        carriers.push({ message: messageIndex, part: partIndex });
      }
    });
  });

  const stale = carriers.slice(0, Math.max(carriers.length - keep, 0));
  if (!stale.length) return messages;

  const staleKeys = new Set(stale.map((c) => `${c.message}:${c.part}`));
  return messages.map((message, messageIndex) => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      return message;
    }
    return {
      ...message,
      content: message.content.map((part, partIndex) => {
        if (!staleKeys.has(`${messageIndex}:${partIndex}`)) return part;
        const output = (part as { output: { value: unknown[] } }).output;
        const text = output.value
          .filter((value) => !isImagePart(value))
          .map((value) => (value as { text?: string }).text)
          .filter(Boolean)
          .join(' ');
        return {
          ...(part as object),
          output: {
            type: 'text',
            value:
              `${text} (image dropped from context — look again if you need it.)`.trim(),
          },
        };
      }),
    } as ModelMessage;
  });
}
