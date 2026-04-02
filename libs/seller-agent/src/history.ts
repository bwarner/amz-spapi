import type { UIMessage } from 'ai';

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
export function trimHistory(messages: UIMessage[], config: HistoryConfig = {}): UIMessage[] {
  const maxMessages = config.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const minRecentMessages = config.minRecentMessages ?? DEFAULT_MIN_RECENT_MESSAGES;

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
    if (!part.type.startsWith('tool-') || part.type === 'tool-result') return false;
    const tp = part as { type: string; state?: string };
    return tp.state !== 'output-available' && tp.state !== 'output-error';
  });
}

function sanitizeMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => {
    if (msg.role !== 'assistant' || !msg.parts) return msg;

    const hasIncompleteTools = msg.parts.some((part) => {
      if (!part.type.startsWith('tool-') || part.type === 'tool-result') return false;
      const tp = part as { type: string; state?: string };
      return tp.state !== 'output-available' && tp.state !== 'output-error';
    });

    if (!hasIncompleteTools) return msg;

    const cleanParts = msg.parts.filter((part) => {
      if (!part.type.startsWith('tool-') || part.type === 'tool-result') return true;
      const tp = part as { type: string; state?: string };
      return tp.state === 'output-available' || tp.state === 'output-error';
    });

    if (cleanParts.length === 0) return msg;

    return { ...msg, parts: cleanParts };
  });
}
