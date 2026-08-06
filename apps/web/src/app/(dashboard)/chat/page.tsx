'use client';

import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai';
import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Send,
  Sparkles,
  Loader2,
  AlertCircle,
  Paperclip,
  X,
  Square,
} from 'lucide-react';
import { uploadImageAsset } from '@/lib/asset-upload-client';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '../../../components/ai-elements/conversation';
import { ConversationSidebar } from './conversation-sidebar';
import { MessageBubble, type AppMessage } from './message-bubble';

type PendingPhoto = {
  label: string;
  assetId: string;
  url: string;
  fileName: string;
};

const PHOTO_LABEL_PATTERN = /Photo ([A-Z]{1,2})\b/g;

/**
 * Letters already used anywhere in the conversation (uploads and tool
 * proposals both label images "Photo <letters>"), so new attachments continue
 * the sequence instead of colliding.
 */
function usedPhotoLetters(
  messages: AppMessage[],
  pending: PendingPhoto[]
): Set<string> {
  const used = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const text =
        part.type === 'text'
          ? (part as { text?: string }).text
          : JSON.stringify((part as { output?: unknown }).output ?? '');
      if (!text) continue;
      for (const match of text.matchAll(PHOTO_LABEL_PATTERN)) {
        used.add(match[1]);
      }
    }
  }
  for (const photo of pending) {
    const letter = photo.label.replace('Photo ', '');
    used.add(letter);
  }
  return used;
}

/** Spreadsheet-style sequence: A..Z, AA, AB, ... (702 labels). */
function letterForIndex(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  const first = Math.floor(index / 26) - 1;
  const second = index % 26;
  return String.fromCharCode(65 + first) + String.fromCharCode(65 + second);
}

function nextPhotoLetters(used: Set<string>, count: number): string[] {
  const letters: string[] = [];
  for (let i = 0; i < 702 && letters.length < count; i++) {
    const letter = letterForIndex(i);
    if (!used.has(letter)) letters.push(letter);
  }
  return letters;
}

type PendingDocument = {
  assetId: string;
  fileName: string;
  /** What the recogniser made of it, so the chip can say more than "file". */
  kind?: string;
  /**
   * A markdown table of the first rows, for spreadsheets only.
   *
   * Inlined because there is no tool that reads a sheet: a PDF invoice has
   * `read-document`, a spreadsheet has nothing, so an asset id alone would
   * attach a file the agent cannot open. The preview is bounded server-side —
   * enough to answer a question about a small sheet, and for a large one it
   * says it is truncated so the agent offers report import instead.
   */
  preview?: string;
  totalRows?: number;
};

/**
 * Tell the agent which documents are attached and how to reach them.
 *
 * PDFs travel as an asset id and nothing more: `read-document` opens them, and
 * that is the agent's own decision and its own metered call, so inlining the
 * extracted figures here would pay for the extraction twice and file nothing.
 *
 * Spreadsheets are the opposite case, and deliberately so. No tool reads a
 * sheet, so an id alone would attach a file the agent cannot open — the same
 * silence #72 is about, in a different container. Their rows travel inline,
 * bounded server-side, and a truncated preview says so.
 */
function documentManifest(documents: PendingDocument[]): string {
  const entries = documents.map((doc) => {
    const head = `- ${doc.fileName}${
      doc.kind ? ` (looks like: ${doc.kind})` : ''
    } — assetId: ${doc.assetId}`;
    if (!doc.preview) return head;
    const rows = doc.totalRows != null ? ` — ${doc.totalRows} rows` : '';
    return `${head}${rows}\n\n${doc.preview}`;
  });
  return `Attached documents (open any PDF with read-document before answering):\n\n${entries.join(
    '\n\n'
  )}`;
}

function photoManifest(photos: PendingPhoto[]): string {
  const lines = photos.map(
    (photo) => `![${photo.label}](${photo.url} "${photo.fileName}")`
  );
  return `Attached product photos (refer to them by label):\n\n${lines.join(
    '\n'
  )}`;
}

// Conversations live server-side (Couchbase); the browser only remembers
// which conversation it was on.
/**
 * Attachable non-image files.
 *
 * Extension as well as mime type, because browsers label these
 * inconsistently — an .xlsx arrives as octet-stream often enough that trusting
 * `file.type` alone silently rejects real spreadsheets.
 */
const DOCUMENT_EXTENSIONS = ['pdf', 'csv', 'tsv', 'xlsx', 'xls', 'xlsm'];

function isDocumentFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (DOCUMENT_EXTENSIONS.includes(extension)) return true;
  return (
    file.type === 'application/pdf' ||
    file.type === 'text/csv' ||
    file.type === 'text/tab-separated-values' ||
    file.type.includes('spreadsheet') ||
    file.type.includes('ms-excel')
  );
}

const CHAT_ID_KEY = 'sellavant-chat-id';

type ChatSummary = {
  chatId: string;
  title: string;
  updatedAt: number;
  messageCount: number;
};

function newChatId(): string {
  return `chat_${crypto.randomUUID()}`;
}

export default function ChatPage() {
  const [input, setInput] = useState('');
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>(
    []
  );
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatIdRef = useRef<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatList, setChatList] = useState<ChatSummary[]>([]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        // The conversation id lives in a ref so the transport always sends the
        // CURRENT conversation without re-instantiating the chat hook.
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { id: chatIdRef.current ?? id, messages },
        }),
      }),
    []
  );

  const {
    messages,
    sendMessage,
    setMessages,
    stop,
    status,
    error,
    addToolApprovalResponse,
  } = useChat<AppMessage>({
    id: 'sellavant-chat',
    transport,
    // Approval-gated tools (live listing writes) pause the agent; once the
    // user responds, the turn continues automatically.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const isStreaming = status === 'submitted' || status === 'streaming';

  // Resume the last conversation from the server (browser only remembers its id).
  useEffect(() => {
    const storedId = window.localStorage.getItem(CHAT_ID_KEY);
    const chatId =
      storedId && /^chat_[a-zA-Z0-9-]{8,64}$/.test(storedId)
        ? storedId
        : newChatId();
    chatIdRef.current = chatId;
    setActiveChatId(chatId);
    window.localStorage.setItem(CHAT_ID_KEY, chatId);
    if (!storedId) return;

    let cancelled = false;
    fetch(`/api/chats/${chatId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { chat?: { messages?: AppMessage[] } } | null) => {
        if (cancelled) return;
        if (data?.chat?.messages?.length) {
          setMessages(data.chat.messages);
        }
      })
      .catch(() => {
        // Offline / not yet saved — start empty.
      });
    return () => {
      cancelled = true;
    };
  }, [setMessages]);

  const handleNewChat = useCallback(() => {
    const chatId = newChatId();
    chatIdRef.current = chatId;
    setActiveChatId(chatId);
    window.localStorage.setItem(CHAT_ID_KEY, chatId);
    // Also a whole-conversation swap, even though the new one is empty: the
    // first reply should not animate up from wherever the old one was left.
    setMessages([]);
    setPendingPhotos([]);
  }, [setMessages]);

  const refreshChatList = useCallback(async () => {
    try {
      const res = await fetch('/api/chats');
      if (!res.ok) return;
      const data = (await res.json()) as { chats?: ChatSummary[] };
      setChatList(data.chats ?? []);
    } catch {
      // Listing is best-effort.
    }
  }, []);

  const selectChat = useCallback(
    async (chatId: string) => {
      if (chatId === chatIdRef.current) return;
      try {
        const res = await fetch(`/api/chats/${chatId}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          chat?: { messages?: AppMessage[] };
        };
        chatIdRef.current = chatId;
        setActiveChatId(chatId);
        window.localStorage.setItem(CHAT_ID_KEY, chatId);
        setMessages(data.chat?.messages ?? []);
        setPendingPhotos([]);
      } catch {
        // Leave the current conversation in place on failure.
      }
    },
    [setMessages]
  );

  const deleteChatById = useCallback(
    async (chatId: string) => {
      try {
        await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
        setChatList((current) =>
          current.filter((chat) => chat.chatId !== chatId)
        );
        if (chatId === chatIdRef.current) handleNewChat();
      } catch {
        // Best-effort.
      }
    },
    [handleNewChat]
  );

  // Keep the sidebar list fresh: on mount and after each completed turn
  // (a first turn creates the conversation and gives it its title).
  useEffect(() => {
    if (!isStreaming) void refreshChatList();
  }, [isStreaming, refreshChatList]);

  const suggestedPrompts = [
    'Critique my tea infusion listing',
    'Show my orders from the last 7 days',
    'What are my best-selling products?',
    'Check inventory levels for my FBA products',
  ];

  /**
   * Scrolling is `Conversation`'s job now (`use-stick-to-bottom`).
   *
   * What used to be here: a layout effect handling three cases — jump to the
   * end when a conversation is swapped in, follow smoothly when a message
   * arrives while you are at the bottom, and leave the scroll alone when you
   * have scrolled up to read — plus a scroll listener driving a button, and a
   * shared 100px threshold so the two could not disagree.
   *
   * All three cases are what `use-stick-to-bottom` exists to solve, and it does
   * one thing the hand-rolled version did not: it keeps the view pinned while
   * content GROWS, which is what a streaming reply does between message
   * updates. The old effect only ran when `messages` changed, so a long token
   * stream drifted off the bottom until the next update yanked it back.
   *
   * The `jumpToEndRef` flag is gone too — `initial="smooth"` on `Conversation`
   * covers opening a conversation.
   */

  /**
   * Send PDFs through the existing document importer.
   *
   * That route already stores the file as an asset, recognises it and extracts
   * cost data — the machinery the chat surface simply had no entry point into.
   * Only the asset id and the verdict come back here; the agent reads the
   * document itself when it needs to, so attaching one costs nothing until it
   * is used.
   */
  const uploadDocuments = async (files: File[]) => {
    const attached: PendingDocument[] = [];
    const failed: string[] = [];

    for (const file of files) {
      const body = new FormData();
      body.append('file', file);
      try {
        const res = await fetch('/api/documents/import', {
          method: 'POST',
          body,
        });
        const data = (await res.json()) as {
          assetId?: string;
          error?: string;
          recognition?: { kind?: string };
          spreadsheet?: {
            markdown?: string;
            totalRows?: number;
            truncated?: boolean;
          };
          spreadsheetError?: string;
        };
        if (!res.ok || !data.assetId) {
          failed.push(`${file.name}${data.error ? ` (${data.error})` : ''}`);
          continue;
        }
        if (data.spreadsheetError)
          failed.push(`${file.name} (${data.spreadsheetError})`);
        attached.push({
          assetId: data.assetId,
          fileName: file.name,
          kind:
            data.recognition?.kind && data.recognition.kind !== 'unknown'
              ? data.recognition.kind
              : undefined,
          preview: data.spreadsheet?.markdown,
          totalRows: data.spreadsheet?.totalRows,
        });
      } catch {
        failed.push(file.name);
      }
    }

    if (attached.length) {
      setPendingDocuments((current) => [
        ...current,
        // Same file twice in one turn is a slip, not an instruction.
        ...attached.filter(
          (doc) => !current.some((existing) => existing.assetId === doc.assetId)
        ),
      ]);
    }
    if (failed.length) {
      setUploadError(`Could not attach ${failed.join(', ')}.`);
    }
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadError(null);

    const all = Array.from(files);
    const selected = all.filter((file) => file.type.startsWith('image/'));
    const documents = all.filter((file) => isDocumentFile(file));
    const rejected = all.filter(
      (file) => !selected.includes(file) && !documents.includes(file)
    );

    // Never silence (#72). A file that is dropped and then simply vanishes is
    // indistinguishable from a broken app; say which ones were not taken.
    if (rejected.length) {
      setUploadError(
        `Cannot attach ${rejected
          .map((file) => file.name)
          .join(', ')} — chat takes images, PDFs and spreadsheets.`
      );
    }
    if (!selected.length && !documents.length) return;

    setUploadingCount((count) => count + selected.length + documents.length);
    try {
      if (documents.length) await uploadDocuments(documents);
      if (!selected.length) return;

      const uploaded = await Promise.all(
        selected.map((file) => uploadImageAsset(file))
      );
      setPendingPhotos((current) => {
        const used = usedPhotoLetters(messages, current);
        const letters = nextPhotoLetters(used, uploaded.length);
        const labeled = uploaded
          .filter(
            (asset) => !current.some((photo) => photo.assetId === asset.assetId)
          )
          .map((asset, index) => ({
            label: `Photo ${letters[index] ?? '?'}`,
            assetId: asset.assetId,
            url: asset.url,
            fileName: asset.fileName,
          }));
        return [...current, ...labeled];
      });
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : 'Photo upload failed.'
      );
    } finally {
      setUploadingCount((count) => count - selected.length - documents.length);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePendingPhoto = (assetId: string) => {
    setPendingPhotos((current) =>
      current.filter((photo) => photo.assetId !== assetId)
    );
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (
      (!text && pendingPhotos.length === 0 && pendingDocuments.length === 0) ||
      isStreaming
    ) {
      return;
    }
    if (uploadingCount > 0) return;

    const photos = pendingPhotos;
    const documents = pendingDocuments;
    setInput('');
    setPendingPhotos([]);
    setPendingDocuments([]);
    const combined = [
      text,
      photos.length ? photoManifest(photos) : '',
      documents.length ? documentManifest(documents) : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    await sendMessage({ text: combined });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePromptClick = (prompt: string) => {
    setInput(prompt);
  };

  const activeTitle =
    chatList.find((chat) => chat.chatId === activeChatId)?.title ?? 'New chat';

  return (
    <SidebarProvider className="min-h-0 h-[calc(100vh-3.5rem)]">
      <ConversationSidebar
        conversations={chatList}
        activeChatId={activeChatId}
        isStreaming={isStreaming}
        onSelect={(chatId) => void selectChat(chatId)}
        onDelete={(chatId) => void deleteChatById(chatId)}
        onNewChat={handleNewChat}
      />

      {/* Chat column */}
      <SidebarInset className="relative flex min-w-0 flex-1 flex-col">
        {/* Conversation header */}
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          {/*
            Replaces the hand-rolled PanelLeft button. Not `md:hidden` any more:
            the sidebar is now collapsible on desktop too, so the trigger is
            useful at every width.
          */}
          <SidebarTrigger className="h-8 w-8" title="Conversations" />
          <span className="truncate text-sm font-medium">
            {messages.length === 0 ? 'New chat' : activeTitle}
          </span>
        </div>

        {/* Messages area. Scroll behaviour is `use-stick-to-bottom`'s — see the
            note on the removed effects above. */}
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl xl:max-w-5xl 2xl:max-w-6xl gap-0 px-4 py-6">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[60vh] flex-col items-center justify-center text-center">
                <div className="rounded-full bg-primary/10 p-4">
                  <Sparkles className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">
                  How can I help grow your Amazon business?
                </h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  I can analyze your listings, review orders, check inventory,
                  and suggest improvements to boost your sales.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2 px-2">
                  {suggestedPrompts.map((prompt, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      onClick={() => handlePromptClick(prompt)}
                      className="text-xs whitespace-normal h-auto py-2 text-left"
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((message, index) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isLast={index === messages.length - 1}
                    isStreaming={isStreaming}
                    onApprovalResponse={(id, approved) =>
                      void addToolApprovalResponse({ id, approved })
                    }
                  />
                ))}
              </div>
            )}
          </ConversationContent>
          {/* Renders itself only when you have scrolled away from the bottom. */}
          <ConversationScrollButton className="bottom-6 shadow-md" />
        </Conversation>

        {/* Error banner */}
        {error && (
          <div className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-4 py-3">
            <div className="mx-auto flex max-w-3xl xl:max-w-5xl 2xl:max-w-6xl items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">
                {error.message || 'Something went wrong'}
              </p>
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="shrink-0 border-t bg-background">
          <div className="mx-auto max-w-3xl xl:max-w-5xl 2xl:max-w-6xl px-2 py-3 sm:px-4 sm:py-4">
            {(pendingPhotos.length > 0 ||
              pendingDocuments.length > 0 ||
              uploadingCount > 0 ||
              uploadError) && (
              <div className="mb-2">
                {uploadError && (
                  <p className="mb-1 text-xs text-destructive">{uploadError}</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {pendingPhotos.map((photo) => (
                    <figure key={photo.assetId} className="relative w-16">
                      <img
                        src={`${photo.url}?w=160`}
                        alt={photo.label}
                        className="h-16 w-16 rounded-md border bg-white object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removePendingPhoto(photo.assetId)}
                        className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 shadow-sm"
                        title={`Remove ${photo.label}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <figcaption className="mt-0.5 truncate text-center text-[10px] text-muted-foreground">
                        {photo.label}
                      </figcaption>
                    </figure>
                  ))}
                  {pendingDocuments.map((doc) => (
                    <div
                      key={doc.assetId}
                      className="relative flex h-16 items-center gap-2 rounded-md border bg-background px-2 pr-6"
                      title={doc.fileName}
                    >
                      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="max-w-[10rem] truncate text-xs font-medium">
                          {doc.fileName}
                        </p>
                        {doc.kind && (
                          <p className="text-[10px] text-muted-foreground">
                            {doc.kind.replace(/-/g, ' ')}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingDocuments((current) =>
                            current.filter(
                              (entry) => entry.assetId !== doc.assetId
                            )
                          )
                        }
                        className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 shadow-sm"
                        title={`Remove ${doc.fileName}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {uploadingCount > 0 && (
                    <div className="flex h-16 w-16 items-center justify-center rounded-md border">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            )}
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,.pdf,.csv,.tsv,.xlsx,.xls,.xlsm"
                multiple
                hidden
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                className="h-11 w-11 shrink-0 rounded-full"
                title="Attach product photos"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Textarea
                placeholder="Ask about listings, orders..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                className="h-11 min-h-11 max-h-11 flex-1 resize-none overflow-hidden rounded-2xl py-2.5 text-base sm:text-sm"
                rows={1}
              />
              {isStreaming ? (
                <Button
                  type="button"
                  onClick={() => void stop()}
                  size="icon"
                  variant="destructive"
                  className="h-11 w-11 shrink-0 rounded-full"
                  title="Stop generating"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={
                    (!input.trim() &&
                      pendingPhotos.length === 0 &&
                      pendingDocuments.length === 0) ||
                    uploadingCount > 0
                  }
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-full"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </form>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
