import crypto from 'node:crypto';
import {
  deleteDocument,
  executeQuery,
  getDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';

/**
 * Chunked chat persistence:
 * - `chat.conversations` — one small META doc per conversation (title,
 *   counters, photo-label registry). Never expires; refreshed every turn.
 * - `chat.messages` — one doc PER MESSAGE, keyed by the UIMessage id, with an
 *   absolute `seq` position. Each carries a TTL, so history fades out without
 *   a retention job, and reads can page (`ORDER BY seq`).
 *
 * Seq bookkeeping: messages returned to the client carry their seq in
 * `message.metadata.seq` and round-trip it on the next request. Messages
 * arriving WITHOUT a seq are new and get appended after the highest known
 * position. The final (assistant) message is always re-upserted — its parts
 * accumulate during streaming.
 */

const SCOPE = 'chat';
const META_COLLECTION = 'conversations';
const MESSAGES_COLLECTION = 'messages';
const LIST_LIMIT = 50;
const TITLE_MAX = 60;
const DEFAULT_LOAD_LIMIT = 100;
/** Message docs expire after ~180 days; meta docs persist. */
const MESSAGE_TTL_SECONDS = 180 * 24 * 60 * 60;

export type ChatMeta = {
  chatId: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Total messages ever appended (max seq + 1). */
  messageCount: number;
  /**
   * Photo label → asset id for every labeled image in the conversation.
   * Lives here so labels stay resolvable after their origin message expires
   * or falls out of the loaded window.
   */
  photoRegistry: Record<string, string>;
};

export type ChatSummary = Pick<
  ChatMeta,
  'chatId' | 'title' | 'createdAt' | 'updatedAt' | 'messageCount'
>;

type StoredChatMessage = {
  chatId: string;
  userId: string;
  seq: number;
  updatedAt: number;
  message: ChatUIMessage;
};

/** Minimal UIMessage shape this store touches (id + optional seq metadata). */
export type ChatUIMessage = {
  id: string;
  role?: string;
  metadata?: { seq?: number } & Record<string, unknown>;
  parts?: Array<{ type?: string; text?: string }>;
};

function safeUserPart(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 24);
}

function metaDocKey(userId: string, chatId: string): string {
  return `chat::${safeUserPart(userId)}::${chatId}`;
}

function messageDocKey(
  userId: string,
  chatId: string,
  messageId: string
): string {
  return `chat-msg::${safeUserPart(userId)}::${chatId}::${messageId}`;
}

/** Client-generated ids: `chat_<uuid>`. */
export function isValidChatId(value: unknown): value is string {
  return typeof value === 'string' && /^chat_[a-zA-Z0-9-]{8,64}$/.test(value);
}

/** First user text line, clamped — used as the conversation title. */
export function deriveChatTitle(messages: ChatUIMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const text = (message.parts ?? [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join(' ')
      .trim();
    if (!text) continue;
    const firstLine = text.split('\n')[0].trim();
    return firstLine.length > TITLE_MAX
      ? `${firstLine.slice(0, TITLE_MAX - 1)}…`
      : firstLine;
  }
  return 'New chat';
}

export async function listChats(userId: string): Promise<ChatSummary[]> {
  const result = await executeQuery<ChatSummary>(
    SCOPE,
    `SELECT c.chatId, c.title, c.createdAt, c.updatedAt, c.messageCount
     FROM \`${META_COLLECTION}\` c
     WHERE c.userId = $userId
     ORDER BY c.updatedAt DESC
     LIMIT ${LIST_LIMIT}`,
    { parameters: { userId } }
  );
  return result.rows;
}

export async function getChatMeta(params: {
  userId: string;
  chatId: string;
}): Promise<ChatMeta | null> {
  const doc = await getDocument<ChatMeta>(
    SCOPE,
    META_COLLECTION,
    metaDocKey(params.userId, params.chatId)
  );
  if (!doc || doc.userId !== params.userId) return null;
  return doc;
}

/**
 * Load a window of messages ascending by seq. `beforeSeq` pages further back.
 * Duplicate seqs (a regenerated tail message) resolve to the newest write.
 * Returned messages carry `metadata.seq` for round-tripping.
 */
export async function loadMessages(params: {
  userId: string;
  chatId: string;
  limit?: number;
  beforeSeq?: number;
}): Promise<ChatUIMessage[]> {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LOAD_LIMIT, 1), 500);
  const result = await executeQuery<{
    seq: number;
    updatedAt: number;
    message: ChatUIMessage;
  }>(
    SCOPE,
    `SELECT m.seq, m.updatedAt, m.message
     FROM \`${MESSAGES_COLLECTION}\` m
     WHERE m.userId = $userId AND m.chatId = $chatId
       ${params.beforeSeq !== undefined ? 'AND m.seq < $beforeSeq' : ''}
     ORDER BY m.seq DESC
     LIMIT ${limit}`,
    {
      parameters: {
        userId: params.userId,
        chatId: params.chatId,
        ...(params.beforeSeq !== undefined
          ? { beforeSeq: params.beforeSeq }
          : {}),
      },
    }
  );

  const bySeq = new Map<
    number,
    { updatedAt: number; message: ChatUIMessage }
  >();
  for (const row of result.rows) {
    const current = bySeq.get(row.seq);
    if (!current || row.updatedAt > current.updatedAt) {
      bySeq.set(row.seq, row);
    }
  }
  return [...bySeq.entries()]
    .sort(([a], [b]) => a - b)
    .map(([seq, row]) => ({
      ...row.message,
      metadata: { ...(row.message.metadata ?? {}), seq },
    }));
}

/**
 * Atomically reserve `count` seq positions on the meta doc while merging photo
 * labels and touching updatedAt — a single N1QL mutation on one document, so
 * concurrent turns (two tabs/devices on the same conversation) can never hand
 * out overlapping positions or drop each other's labels. Returns the base seq
 * of the reserved range, or null when the meta doc does not exist yet.
 */
async function reserveSeqRange(params: {
  userId: string;
  chatId: string;
  count: number;
  now: number;
  photoLabels: Record<string, string>;
}): Promise<number | null> {
  const result = await executeQuery<number>(
    SCOPE,
    `UPDATE \`${META_COLLECTION}\` USE KEYS $key
     SET messageCount = IFMISSINGORNULL(messageCount, 0) + $count,
         updatedAt = $now,
         photoRegistry = OBJECT_CONCAT(IFMISSINGORNULL(photoRegistry, {}), $labels)
     RETURNING RAW messageCount`,
    {
      parameters: {
        key: metaDocKey(params.userId, params.chatId),
        count: params.count,
        now: params.now,
        labels: params.photoLabels,
      },
    }
  );
  if (result.rows.length === 0) return null;
  return result.rows[0] - params.count;
}

/**
 * Persist a completed turn: append new messages (those without a seq),
 * re-upsert the final message, merge photo labels, refresh the meta doc.
 */
export async function saveChatTurn(params: {
  userId: string;
  chatId: string;
  messages: ChatUIMessage[];
  photoLabels?: Record<string, string>;
}): Promise<void> {
  const { userId, chatId, messages } = params;
  if (messages.length === 0) return;

  const now = Date.now();
  const photoLabels = params.photoLabels ?? {};
  const newCount = messages.filter(
    (message) => typeof message.metadata?.seq !== 'number'
  ).length;

  let baseSeq = await reserveSeqRange({
    userId,
    chatId,
    count: newCount,
    now,
    photoLabels,
  });
  if (baseSeq === null) {
    // First turn — create the meta doc with the range pre-reserved. INSERT
    // (not UPSERT) so a concurrent first turn loses cleanly; the loser
    // reserves its range from the winner's counter.
    const inserted = await executeQuery<string>(
      SCOPE,
      `INSERT INTO \`${META_COLLECTION}\` (KEY, VALUE)
       VALUES ($key, $document)
       RETURNING RAW META().id`,
      {
        parameters: {
          key: metaDocKey(userId, chatId),
          document: {
            chatId,
            userId,
            title: deriveChatTitle(messages),
            createdAt: now,
            updatedAt: now,
            messageCount: newCount,
            photoRegistry: photoLabels,
          } satisfies ChatMeta,
        },
      }
    ).catch(() => ({ rows: [] as string[] }));

    baseSeq =
      inserted.rows.length > 0
        ? 0
        : await reserveSeqRange({
            userId,
            chatId,
            count: newCount,
            now,
            photoLabels,
          });
    if (baseSeq === null) return; // Meta unavailable — skip this turn.
  }

  // Assign absolute positions: known seqs stick, new messages take the
  // reserved range in order.
  let offset = 0;
  const assigned: Array<{
    message: ChatUIMessage;
    seq: number;
    isNew: boolean;
  }> = messages.map((message) => {
    const known = message.metadata?.seq;
    if (typeof known === 'number') {
      return { message, seq: known, isNew: false };
    }
    const seq = baseSeq + offset;
    offset += 1;
    return { message, seq, isNew: true };
  });

  const toWrite = assigned.filter(
    (entry, index) => entry.isNew || index === assigned.length - 1
  );
  await Promise.all(
    toWrite.map((entry) =>
      upsertDocument<StoredChatMessage>(
        SCOPE,
        MESSAGES_COLLECTION,
        messageDocKey(userId, chatId, entry.message.id),
        {
          chatId,
          userId,
          seq: entry.seq,
          updatedAt: now,
          message: {
            ...entry.message,
            metadata: { ...(entry.message.metadata ?? {}), seq: entry.seq },
          },
        },
        MESSAGE_TTL_SECONDS
      )
    )
  );
}

export async function deleteChat(params: {
  userId: string;
  chatId: string;
}): Promise<boolean> {
  const meta = await getChatMeta(params);
  if (!meta) return false;
  await executeQuery(
    SCOPE,
    `DELETE FROM \`${MESSAGES_COLLECTION}\`
     WHERE userId = $userId AND chatId = $chatId`,
    { parameters: { userId: params.userId, chatId: params.chatId } }
  );
  return deleteDocument(
    SCOPE,
    META_COLLECTION,
    metaDocKey(params.userId, params.chatId)
  );
}
