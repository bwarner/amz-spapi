'use client';

import { memo, useEffect, useRef, useState } from 'react';

import {
  AlertCircle,
  Bot,
  Check,
  Copy,
  Download,
  RotateCcw,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { ToolUIPart, UIMessage } from 'ai';
import { APlusDocumentSchema, type APlusDocument } from '@farvisionllc/models';
import { APlusPreview } from '@/components/aplus-preview/aplus-preview';
import {
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableHead,
  MarkdownTableRow,
} from './markdown-table';
import { Loader } from '@/components/ai-elements/loader';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { approvalSummary, isStalled, toolTitle } from './tool-presentation';
import { extractDownloads, type ProducedFile } from './downloads';
import { extractListingToolImages, type ListingImage } from './listing-images';
import { Button } from '@/components/ui/button';
import {
  Artifact,
  ArtifactActions,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from '@/components/ai-elements/artifact';
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
  type ToolUIPartApproval,
} from '@/components/ai-elements/confirmation';

export type AppMessage = UIMessage;

const APLUS_TOOL_PART_TYPE = 'tool-generate-aplus-preview';

type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: ToolUIPartApproval;
};

function getToolName(partType: string): string | null {
  return partType.startsWith('tool-') ? partType.slice('tool-'.length) : null;
}

function parseAPlusDoc(output: unknown): APlusDocument | null {
  const parsed = APlusDocumentSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}

const MARKDOWN_COMPONENTS: Components = {
  /**
   * Tables get their own component: bordered, scrollable in both directions,
   * collapsed behind a control once tall, and typeset per cell rather than per
   * table. See `markdown-table.tsx` for why the old blanket monospace was the
   * thing making listing tables unreadable.
   */
  table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
  td: ({ children }) => <MarkdownTableCell>{children}</MarkdownTableCell>,
  th: ({ children }) => <MarkdownTableHead>{children}</MarkdownTableHead>,
  tr: ({ children }) => <MarkdownTableRow>{children}</MarkdownTableRow>,
  img: ({ src, alt, title }) => {
    if (!src) return null;
    return (
      <img
        src={typeof src === 'string' ? src : undefined}
        alt={alt ?? ''}
        title={title}
        loading="lazy"
        decoding="async"
        // @ts-expect-error fetchpriority is a valid HTML attribute not yet in React types
        fetchpriority="low"
        className="my-2 h-auto max-w-full rounded-md bg-muted-foreground/5"
      />
    );
  },
};

const LISTING_IMAGE_TOOL_TYPES = new Set([
  'tool-get-my-listing',
  'tool-search-my-listings',
  'tool-propose-listing-photos',
  'tool-generate-image',
  'tool-crop-image',
  'tool-trim-image',
  'tool-scale-image',
  'tool-remove-image-background',
  'tool-compose-image',
  'tool-generate-infographic',
  'tool-render-graphic',
  // Public catalog tools — competitor images render side by side with yours.
  'tool-get-listing',
  'tool-search-catalog',
]);

/**
 * One renderable step of an assistant turn, in the order it happened.
 *
 * Rendering by sequence rather than by kind is what keeps a tool badge next to
 * the sentence that explains it.
 */
type MessageBlock =
  | { kind: 'text'; text: string }
  | {
      kind: 'tool';
      toolName: string;
      type: string;
      state: string;
      input: unknown;
      output: unknown;
      errorText?: string;
      /**
       * Carried on the tool block rather than as a block of its own.
       *
       * An approval is a property OF a call — the component decides what to
       * show from the call's state and the decision recorded on it. Splitting
       * them meant the approval could only be rendered while it was pending,
       * because that was the only moment both were in hand, so answering one
       * erased the question and the answer together.
       */
      approval?: ToolUIPartApproval;
    }
  | { kind: 'aplus'; doc: APlusDocument }
  | { kind: 'images'; images: ListingImage[] }
  /**
   * A file the turn produced. Read from the tool result rather than from a
   * markdown link the model had to remember to write.
   */
  | { kind: 'downloads'; files: ProducedFile[] };

/**
 * A tool call: one line, expandable to what it was asked for and what it
 * returned.
 *
 * The parameters and result were previously unreachable — a call was a
 * sentence, and "that number looks wrong" had nowhere to go. They are collapsed
 * by default because a turn can hold a dozen calls and the prose is the point.
 */
function ToolCallDisplay({
  toolName,
  type,
  state,
  input,
  output,
  errorText,
  isActive,
}: {
  toolName: string;
  type: string;
  state: string;
  input: unknown;
  output: unknown;
  errorText?: string;
  /** This message is the last one and the conversation is streaming. */
  isActive: boolean;
}) {
  const stalled = isStalled(state, isActive);
  const title = toolTitle(toolName, state);

  // Nothing to expand into until the call carries something. An empty body
  // would offer a chevron that opens onto blank space.
  const hasBody = input !== undefined || output !== undefined || errorText;

  return (
    <Tool>
      <ToolHeader
        title={title}
        type={type as ToolUIPart['type']}
        state={state as ToolUIPart['state']}
        stalled={stalled}
      />
      {hasBody && (
        <ToolContent>
          {input !== undefined && <ToolInput input={input} />}
          {(output !== undefined || errorText) && (
            <ToolOutput output={output} errorText={errorText} />
          )}
        </ToolContent>
      )}
    </Tool>
  );
}

/**
 * One hover action under a message.
 *
 * Always in the layout, revealed on hover, rather than mounted on hover — the
 * transcript sticks to the bottom while streaming, and a control that adds a
 * row when the pointer crosses a message would shove the conversation as you
 * reached for it.
 */
function MessageAction({
  icon,
  label,
  isUser,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  isUser: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'h-6 gap-1.5 px-2 text-xs opacity-0 transition-opacity',
        // Keyboard users never trigger the hover, so the focus ring would
        // otherwise land on something invisible.
        'focus-visible:opacity-100 group-hover/message:opacity-100',
        isUser
          ? 'text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </Button>
  );
}

/**
 * Copy this message's prose.
 *
 * Text blocks only, joined the way they were written. Not what a selection
 * would give you: the tool cards render their name, arguments and output as
 * text, so dragging across a tool-heavy answer picks up a transcript of the
 * machinery around the answer. What people want out of a message is the part
 * addressed to them.
 */
function CopyMessageButton({
  text,
  isUser,
}: {
  text: string;
  isUser: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  // A pending reset outliving the component would set state on an unmounted
  // one; conversations get swapped out from under these buttons.
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    []
  );

  const copy = async () => {
    // Absent outside a secure context, which local development over plain HTTP
    // is — failing silently would look like a dead button.
    if (!navigator?.clipboard?.writeText) {
      setFailed(true);
      resetRef.current = setTimeout(() => setFailed(false), 2000);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      resetRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
      resetRef.current = setTimeout(() => setFailed(false), 2000);
    }
  };

  return (
    <MessageAction
      isUser={isUser}
      onClick={() => void copy()}
      icon={
        failed ? (
          <AlertCircle className="size-3.5" />
        ) : copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )
      }
      label={failed ? 'Copy failed' : copied ? 'Copied' : 'Copy'}
    />
  );
}

/**
 * One message, memoized.
 *
 * The chat input's state lives in the page component that renders this list, so
 * every keystroke re-renders that component — and without `memo`, every message
 * in the conversation with it. Each bubble renders markdown, tables and images,
 * so on a long conversation that is hundreds of subtrees rebuilt per character
 * and typing visibly lags.
 *
 * Memo only helps if the props are referentially stable, which is why
 * `onApprovalResponse` is a `useCallback` at the call site. An inline arrow
 * there would be a new function every render and every bubble would re-render
 * anyway — the failure mode where `memo` looks applied and does nothing.
 *
 * `message` identity comes from `useChat` and is stable per message; `isLast`
 * and `isStreaming` change only for the last bubble, and only while streaming.
 * So a keystroke re-renders none of them.
 */
function MessageBubbleImpl({
  message,
  isLast,
  isStreaming,
  onApprovalResponse,
  onRewind,
}: {
  message: AppMessage;
  isLast: boolean;
  isStreaming: boolean;
  onApprovalResponse?: (id: string, approved: boolean) => void;
  /**
   * Cut the conversation back to just before this message and reopen it in the
   * composer. Offered on your own messages only — rewinding to an assistant
   * message would leave the question that prompted it with nothing to answer.
   */
  onRewind?: (messageId: string) => void;
}) {
  const isUser = message.role === 'user';

  /**
   * The turn, in the order it happened.
   *
   * Previously every text part was concatenated into one string and every tool
   * call collected into a separate list, so a turn that went
   * `text → removeBackground → text → composite → text` rendered as all the
   * tool badges followed by all the prose. The reader lost which commentary
   * belonged to which step, and the text parts were glued together with no
   * separator — running the last sentence of one into the first of the next.
   *
   * Walking the parts in sequence fixes both: the concatenation bug is a
   * consequence of the ordering bug, not a separate defect.
   */
  const blocks: MessageBlock[] = [];
  const seenImageUrls = new Set<string>();

  /**
   * Adjacent text parts join with no separator, because streaming splits text
   * at arbitrary points — a paragraph break between them would land mid
   * sentence. A tool part is what ends a block, so the next text starts a new
   * one.
   */
  const appendText = (text: string) => {
    const last = blocks[blocks.length - 1];
    if (last?.kind === 'text') last.text += text;
    else blocks.push({ kind: 'text', text });
  };

  if (message.parts) {
    for (const part of message.parts as ToolPart[]) {
      if (part.type === 'text') {
        appendText((part as { type: 'text'; text: string }).text);
        continue;
      }
      const toolName = getToolName(part.type);
      if (!toolName) continue;

      blocks.push({
        kind: 'tool',
        toolName,
        type: part.type,
        state: part.state ?? 'input-streaming',
        input: part.input,
        output: part.output,
        errorText: part.errorText,
        // Whatever the state. A decision that has been made is part of the
        // record, and the component decides whether to show it as a question,
        // an approval or a refusal.
        approval: part.approval?.id ? part.approval : undefined,
      });

      if (part.state === 'output-available') {
        const files = extractDownloads(toolName, part.output);
        if (files.length) blocks.push({ kind: 'downloads', files });
      }

      if (
        part.type === APLUS_TOOL_PART_TYPE &&
        part.state === 'output-available'
      ) {
        const doc = parseAPlusDoc(part.output);
        if (doc) blocks.push({ kind: 'aplus', doc });
      }

      if (
        LISTING_IMAGE_TOOL_TYPES.has(part.type) &&
        part.state === 'output-available'
      ) {
        // Deduped across the whole message: two tools reporting the same image
        // should not show it twice, even from different steps.
        const images = extractListingToolImages(part.output).filter((image) => {
          if (seenImageUrls.has(image.url)) return false;
          seenImageUrls.add(image.url);
          return true;
        });
        if (images.length) blocks.push({ kind: 'images', images });
      }
    }
  }

  const hasAPlusDoc = blocks.some((block) => block.kind === 'aplus');
  const hasText = blocks.some(
    (block) => block.kind === 'text' && block.text.trim()
  );
  const hasTool = blocks.some((block) => block.kind === 'tool');

  const copyableText = blocks
    .filter((block): block is Extract<MessageBlock, { kind: 'text' }> =>
      Boolean(block.kind === 'text' && block.text.trim())
    )
    .map((block) => block.text.trim())
    .join('\n\n');

  return (
    <div
      className={cn(
        'group/message flex gap-2 sm:gap-3',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && (
        <div className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}

      <div
        className={cn(
          'rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3',
          hasAPlusDoc
            ? 'w-full max-w-full sm:max-w-[95%]'
            : 'max-w-[92%] sm:max-w-[80%]',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        {/* Every step in the order it happened (#72). */}
        {blocks.map((block, index) => {
          switch (block.kind) {
            case 'text':
              return block.text.trim() ? (
                <div
                  key={index}
                  className={cn(
                    // The block fills the bubble so tables, code and images use
                    // the width; only paragraphs and list items are held to a
                    // reading measure. Capping the whole block instead would
                    // narrow exactly the content that wanted the room (#72).
                    'prose prose-sm max-w-none prose-p:max-w-[70ch] prose-li:max-w-[70ch]',
                    // Not the first block means prose that follows a tool,
                    // which needs air above it or it reads as a caption.
                    index > 0 && 'mt-3',
                    isUser ? 'prose-invert' : 'dark:prose-invert'
                  )}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={MARKDOWN_COMPONENTS}
                  >
                    {block.text}
                  </ReactMarkdown>
                </div>
              ) : null;

            case 'tool':
              return (
                <div
                  key={index}
                  className={cn('space-y-2', index > 0 && 'mt-2')}
                >
                  <ToolCallDisplay
                    toolName={block.toolName}
                    type={block.type}
                    state={block.state}
                    input={block.input}
                    output={block.output}
                    errorText={block.errorText}
                    isActive={Boolean(isLast && isStreaming)}
                  />
                  <Confirmation
                    approval={block.approval}
                    state={block.state as ToolUIPart['state']}
                    className="border-amber-400/60 bg-amber-50 dark:bg-amber-950/30"
                  >
                    <ConfirmationTitle>
                      {approvalSummary(block.toolName, block.input)}
                    </ConfirmationTitle>
                    <ConfirmationRequest>
                      <ConfirmationActions>
                        <ConfirmationAction
                          onClick={() =>
                            block.approval &&
                            onApprovalResponse?.(block.approval.id, true)
                          }
                        >
                          Approve
                        </ConfirmationAction>
                        <ConfirmationAction
                          variant="outline"
                          onClick={() =>
                            block.approval &&
                            onApprovalResponse?.(block.approval.id, false)
                          }
                        >
                          Reject
                        </ConfirmationAction>
                      </ConfirmationActions>
                    </ConfirmationRequest>
                    {/* The decision stays on the record once made. Before, both
                        question and answer vanished the moment it was given. */}
                    <ConfirmationAccepted>
                      <p className="text-sm font-medium text-green-700 dark:text-green-500">
                        You approved this
                      </p>
                    </ConfirmationAccepted>
                    <ConfirmationRejected>
                      <p className="text-sm font-medium text-muted-foreground">
                        You rejected this — it was not run
                      </p>
                    </ConfirmationRejected>
                  </Confirmation>
                </div>
              );

            case 'aplus':
              return (
                <Artifact key={index} className="mt-3">
                  <ArtifactHeader>
                    <div className="min-w-0">
                      <ArtifactTitle>A+ content</ArtifactTitle>
                      <ArtifactDescription>
                        {block.doc.modules.length} module
                        {block.doc.modules.length === 1 ? '' : 's'} — a preview,
                        not published
                      </ArtifactDescription>
                    </div>
                  </ArtifactHeader>
                  {/* No `ArtifactContent` padding: the preview renders its own
                      page-width layout and boxing it inside a gutter would
                      misrepresent how it lays out on Amazon. */}
                  <APlusPreview doc={block.doc} />
                </Artifact>
              );

            case 'downloads':
              return (
                <div key={index} className="mt-3 space-y-2">
                  {block.files.map((file) => (
                    <Artifact key={file.url}>
                      <ArtifactHeader>
                        <div className="min-w-0">
                          <ArtifactTitle className="truncate">
                            {file.name}
                          </ArtifactTitle>
                          {file.detail && (
                            <ArtifactDescription>
                              {file.detail}
                            </ArtifactDescription>
                          )}
                        </div>
                        <ArtifactActions>
                          {/* `Button asChild` rather than `ArtifactAction`,
                              which renders its icon alongside an sr-only span —
                              two children, which Slot refuses. An anchor and
                              not a click handler, so it survives a middle-click
                              and a "save link as". */}
                          <Button
                            asChild
                            size="sm"
                            variant="ghost"
                            className="size-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                          >
                            <a
                              href={file.url}
                              download
                              aria-label={`Download ${file.name}`}
                            >
                              <Download className="size-4" />
                            </a>
                          </Button>
                        </ArtifactActions>
                      </ArtifactHeader>
                    </Artifact>
                  ))}
                </div>
              );

            case 'images':
              return (
                <div key={index} className="mt-3 flex flex-wrap gap-2">
                  {block.images.map((image) => (
                    <figure key={image.url} className="w-24">
                      <a href={image.url} target="_blank" rel="noreferrer">
                        <img
                          src={image.thumbUrl ?? image.url}
                          alt={image.label ?? 'Listing image'}
                          loading="lazy"
                          decoding="async"
                          className="h-24 w-24 rounded-md border bg-white object-contain"
                        />
                      </a>
                      {image.label && (
                        <figcaption className="mt-0.5 truncate text-[10px] text-muted-foreground">
                          {image.label}
                        </figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              );
          }
        })}

        {/* Streaming indicator */}
        {isLast && isStreaming && !hasText && !hasTool && (
          <Loader className="text-muted-foreground" />
        )}

        {/*
          Not while this message is still being written: the text is
          incomplete, so a copy taken then is a copy of a fragment.
        */}
        {!(isLast && isStreaming) && (copyableText || (isUser && onRewind)) && (
          <div className="mt-1.5 flex justify-end gap-1">
            {isUser && onRewind && (
              <MessageAction
                icon={<RotateCcw className="size-3.5" />}
                label="Retry from here"
                isUser={isUser}
                onClick={() => onRewind(message.id)}
              />
            )}
            {copyableText && (
              <CopyMessageButton text={copyableText} isUser={isUser} />
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary">
          <User className="h-4 w-4 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);
