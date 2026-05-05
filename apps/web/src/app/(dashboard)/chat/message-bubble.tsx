'use client';

import { Bot, User, Loader2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UIMessage } from 'ai';
import { APlusDocumentSchema, type APlusDocument } from '@farvisionllc/models';
import { APlusPreview } from '@/components/aplus-preview/aplus-preview';

export type AppMessage = UIMessage;

const APLUS_TOOL_PART_TYPE = 'tool-generate-aplus-preview';

type ToolPart = {
  type: string;
  state?: string;
  output?: unknown;
  errorText?: string;
};

function getToolName(partType: string): string | null {
  return partType.startsWith('tool-') ? partType.slice('tool-'.length) : null;
}

function parseAPlusDoc(output: unknown): APlusDocument | null {
  const parsed = APlusDocumentSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}

const MARKDOWN_COMPONENTS: Components = {
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

const TOOL_LABELS: Record<string, [string, string]> = {
  'search-catalog': ['Searching catalog...', 'Catalog search complete'],
  'get-listing': ['Fetching listing details...', 'Listing details retrieved'],
  'get-orders': ['Fetching orders...', 'Orders retrieved'],
  'get-order-details': ['Fetching order details...', 'Order details retrieved'],
  'get-inventory': ['Checking inventory...', 'Inventory retrieved'],
};

function ToolCallDisplay({
  toolName,
  state,
}: {
  toolName: string;
  state: string;
}) {
  const isLoading =
    state !== 'output-available' &&
    state !== 'output-error' &&
    state !== 'output-denied';
  const labels = TOOL_LABELS[toolName];
  const label = labels ? (isLoading ? labels[0] : labels[1]) : toolName;

  return (
    <div className="flex items-center gap-1.5 text-sm">
      {isLoading && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      )}
      {!isLoading && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      <span
        className={cn('text-muted-foreground', isLoading && 'animate-pulse')}
      >
        {label}
      </span>
    </div>
  );
}

export function MessageBubble({
  message,
  isLast,
  isStreaming,
}: {
  message: AppMessage;
  isLast: boolean;
  isStreaming: boolean;
}) {
  const isUser = message.role === 'user';

  // Collect tool calls + special-render any A+ preview output
  const toolCalls: { toolName: string; state: string }[] = [];
  const aplusDocs: APlusDocument[] = [];
  let textContent = '';

  if (message.parts) {
    for (const part of message.parts as ToolPart[]) {
      if (part.type === 'text') {
        textContent += (part as { type: 'text'; text: string }).text;
        continue;
      }
      const toolName = getToolName(part.type);
      if (!toolName) continue;

      toolCalls.push({ toolName, state: part.state ?? 'input-streaming' });

      if (
        part.type === APLUS_TOOL_PART_TYPE &&
        part.state === 'output-available'
      ) {
        const doc = parseAPlusDoc(part.output);
        if (doc) aplusDocs.push(doc);
      }
    }
  }

  return (
    <div
      className={cn(
        'flex gap-2 sm:gap-3',
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
          aplusDocs.length > 0
            ? 'w-full max-w-full sm:max-w-[95%]'
            : 'max-w-[92%] sm:max-w-[80%]',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        {/* Tool call indicators */}
        {toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {toolCalls.map((tc, i) => (
              <ToolCallDisplay
                key={i}
                toolName={tc.toolName}
                state={tc.state}
              />
            ))}
          </div>
        )}

        {/* A+ preview docs (rendered before text so user sees the artifact first) */}
        {aplusDocs.length > 0 && (
          <div className="mb-3 space-y-4">
            {aplusDocs.map((doc, i) => (
              <APlusPreview key={i} doc={doc} />
            ))}
          </div>
        )}

        {/* Text content with markdown */}
        {textContent && (
          <div
            className={cn(
              'prose prose-sm max-w-none',
              isUser ? 'prose-invert' : 'dark:prose-invert'
            )}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={MARKDOWN_COMPONENTS}
            >
              {textContent}
            </ReactMarkdown>
          </div>
        )}

        {/* Streaming indicator */}
        {isLast && isStreaming && !textContent && toolCalls.length === 0 && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
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
