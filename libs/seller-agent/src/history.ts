import type { ModelMessage, UIMessage } from 'ai';

export interface HistoryConfig {
  maxMessages?: number;
  minRecentMessages?: number;
  /**
   * Per-tool-output character cap on REPLAY. A tool result larger than this is
   * replaced with a marked, clipped preview before it is sent back to the
   * model. Applied uniformly to every settled result, every request — a cap
   * that spared "recent" results would rewrite each one the turn it stopped
   * being recent, invalidating the prompt cache mid-prefix every turn.
   */
  maxToolOutputChars?: number;
  /**
   * Context budget, in characters of serialised parts (≈4 chars per token).
   * `maxContextChars` is the ceiling that TRIGGERS a trim; the trim then cuts
   * to `targetContextChars`. The gap between them is hysteresis: trimming to
   * the target leaves headroom, so the prefix then stays byte-identical —
   * cacheable — for many turns before the next trim.
   */
  maxContextChars?: number;
  targetContextChars?: number;
}

const DEFAULT_MAX_MESSAGES = 20;
const DEFAULT_MIN_RECENT_MESSAGES = 10;
/** ~2k tokens. The largest single result worth replaying wholesale. */
const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 8_000;
/** ~60k tokens of history — the ceiling that triggers a trim… */
const DEFAULT_MAX_CONTEXT_CHARS = 240_000;
/** …and the ~40k-token low-water mark it cuts down to. */
const DEFAULT_TARGET_CONTEXT_CHARS = 160_000;

/**
 * Trims conversation history to reduce token usage while preserving context.
 *
 * Three passes, in order (#133 — one live conversation reached 948k tokens
 * per TURN and burned the daily cap in seven):
 *
 *  1. Sanitise every message: repair malformed tool inputs, drop orphaned
 *     approvals, and cap oversized tool OUTPUTS with a marked preview.
 *  2. Count-based trim (the original behaviour): oldest messages go once the
 *     conversation exceeds `maxMessages`.
 *  3. Budget-based trim: if what remains still serialises over
 *     `maxContextChars`, drop oldest messages down to `targetContextChars`.
 *
 * Both trims preserve tool call/result pairing and re-align to a user
 * message, and neither cuts into the last `minRecentMessages`.
 */
export function trimHistory(
  messages: UIMessage[],
  config: HistoryConfig = {}
): UIMessage[] {
  const maxMessages = config.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const minRecentMessages =
    config.minRecentMessages ?? DEFAULT_MIN_RECENT_MESSAGES;

  const sanitized = sanitizeMessages(
    messages,
    config.maxToolOutputChars ?? DEFAULT_MAX_TOOL_OUTPUT_CHARS
  );

  const counted =
    sanitized.length <= maxMessages
      ? sanitized
      : trimFrom(sanitized, sanitized.length - maxMessages, minRecentMessages);

  return trimToBudget(counted, {
    maxContextChars: config.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS,
    targetContextChars:
      config.targetContextChars ?? DEFAULT_TARGET_CONTEXT_CHARS,
    minRecentMessages,
  });
}

/** Drop roughly `toRemove` oldest messages, respecting pairing and starts. */
function trimFrom(
  messages: UIMessage[],
  toRemove: number,
  minRecentMessages: number
): UIMessage[] {
  const safeToRemove = Math.min(toRemove, messages.length - minRecentMessages);
  if (safeToRemove <= 0) return messages;

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
  return trimmed;
}

/** Serialised size of one message's parts — the replay cost proxy. */
function messageChars(message: UIMessage): number {
  try {
    return JSON.stringify(message.parts ?? []).length;
  } catch {
    return 0;
  }
}

/**
 * Enforce the character budget by dropping oldest messages.
 *
 * Does NOTHING while under the ceiling — that is the hysteresis that keeps
 * the prefix byte-identical (and therefore prompt-cacheable) between trims.
 * When the ceiling is crossed, cuts to the lower target in one chunk, so the
 * next many turns are again append-only.
 */
function trimToBudget(
  messages: UIMessage[],
  budget: {
    maxContextChars: number;
    targetContextChars: number;
    minRecentMessages: number;
  }
): UIMessage[] {
  const sizes = messages.map(messageChars);
  let total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= budget.maxContextChars) return messages;

  let drop = 0;
  while (
    total > budget.targetContextChars &&
    drop < messages.length - budget.minRecentMessages
  ) {
    total -= sizes[drop];
    drop += 1;
  }
  if (drop === 0) return messages;
  return trimFrom(messages, drop, budget.minRecentMessages);
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

/**
 * A settled tool part whose `input` is not an object poisons the whole
 * conversation on replay: it converts to a `tool_use` block without a
 * dictionary and Anthropic rejects the request —
 *
 *   messages.45.content.1.tool_use.input: Input should be a valid dictionary
 *
 * — on EVERY turn after the one that wrote it. Seen live with a
 * `total-report-rows` call that failed schema validation: the SDK persisted
 * the errored part with no `input` at all. The call already happened and its
 * (error) result is worth keeping, so repair the record rather than drop it.
 */
function repairToolInput<T extends { type: string; input?: unknown }>(
  part: T
): T {
  if (!part.type.startsWith('tool-') || part.type === 'tool-result') {
    return part;
  }
  const input = part.input;
  const isDictionary =
    typeof input === 'object' && input !== null && !Array.isArray(input);
  return isDictionary ? part : { ...part, input: {} };
}

/**
 * Cap an oversized tool OUTPUT with a marked, clipped preview.
 *
 * The compounding at the heart of #133: a tool result enters the history once
 * and is then re-sent on every step of every later turn. One 100k-character
 * report dump costs ~25k tokens × every subsequent model call. The current
 * turn is unaffected — the SDK feeds the model this turn's results directly,
 * full-size — so what is capped here is exactly the replay, where the
 * assistant's own answer text already carries the conclusions.
 *
 * The marker says what happened and what to do, because a silent clip reads
 * as a complete result: the model would total a truncated list and present
 * the sum as the whole (the same failure the spreadsheet preview note
 * exists to prevent).
 */
function capToolOutput<
  T extends { type: string; state?: string; output?: unknown }
>(part: T, maxChars: number): T {
  if (!part.type.startsWith('tool-') || part.type === 'tool-result') {
    return part;
  }
  if (part.output === undefined) return part;
  let serialized: string;
  try {
    serialized = JSON.stringify(part.output) ?? '';
  } catch {
    return part;
  }
  if (serialized.length <= maxChars) return part;
  return {
    ...part,
    output: {
      truncated: true,
      note:
        `This result was ${serialized.length} characters and has been ` +
        'clipped from the conversation history to save context. The preview ' +
        'below is INCOMPLETE — never total or enumerate from it. Call the ' +
        'tool again if you need the full result.',
      preview: serialized.slice(0, maxChars),
    },
  };
}

function sanitizeMessages(
  messages: UIMessage[],
  maxToolOutputChars: number
): UIMessage[] {
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

    const cleanParts = msg.parts
      .filter(keepable)
      .map((part) => repairToolInput(part))
      .map((part) => capToolOutput(part, maxToolOutputChars));

    // Every part was dropped. Returning the message untouched would put the
    // orphans straight back, so return it empty-partsed instead: the turn
    // produced nothing the model can act on, and saying nothing is correct.
    if (cleanParts.length === 0 && msg.parts.length > 0) {
      return { ...msg, parts: [] };
    }

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
