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

/**
 * Tool-part states that must survive into the model's context.
 *
 * `output-available` / `output-error` are settled calls, and the approval pair
 * is a live handshake — NOT an abandoned call.
 *
 * Stripping an approval part is what made `create-purchase-order` loop. The
 * user approved, the part became `approval-responded`, this function deleted it
 * because it was neither of the two settled states, and
 * `convertToModelMessages` therefore emitted no `tool-approval-response`. The
 * tool never executed, the model saw no record that the call had ever been
 * made, and it proposed a fresh one — which asked for approval again. Seven
 * rounds of that were recorded in a single message before anyone noticed,
 * because every individual step looked reasonable.
 *
 * What SHOULD still be stripped is a call abandoned mid-flight
 * (`input-streaming` / `input-available`), typically a stream that died. Those
 * leave the model looking at a call with no result and no way to resolve it.
 */
const KEEPABLE_TOOL_STATES = new Set([
  'output-available',
  'output-error',
  'approval-requested',
  'approval-responded',
]);

/** A tool part the model must still see. Non-tool parts are always kept. */
function isKeepableToolPart(part: { type: string; state?: string }): boolean {
  if (!part.type.startsWith('tool-') || part.type === 'tool-result') {
    return true;
  }
  return KEEPABLE_TOOL_STATES.has(part.state ?? '');
}

function sanitizeMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => {
    if (msg.role !== 'assistant' || !msg.parts) return msg;

    const hasAbandonedTools = msg.parts.some(
      (part) => !isKeepableToolPart(part as { type: string; state?: string })
    );

    if (!hasAbandonedTools) return msg;

    const cleanParts = msg.parts.filter((part) =>
      isKeepableToolPart(part as { type: string; state?: string })
    );

    if (cleanParts.length === 0) return msg;

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
