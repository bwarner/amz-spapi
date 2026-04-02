'use client';

import { Bot, User, Loader2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UIMessage } from 'ai';

export type AppMessage = UIMessage;

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
    state !== 'output-available' && state !== 'output-error' && state !== 'output-denied';
  const labels = TOOL_LABELS[toolName];
  const label = labels ? (isLoading ? labels[0] : labels[1]) : toolName;

  return (
    <div className="flex items-center gap-1.5 text-sm">
      {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {!isLoading && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      <span className={cn('text-muted-foreground', isLoading && 'animate-pulse')}>
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

  // Collect tool invocations from parts
  const toolCalls: { toolName: string; state: string }[] = [];
  let textContent = '';

  if (message.parts) {
    for (const part of message.parts) {
      if (part.type === 'text') {
        textContent += part.text;
      } else if (part.type === 'tool-invocation') {
        toolCalls.push({
          toolName: (part as any).toolInvocation?.toolName || 'unknown',
          state: (part as any).toolInvocation?.state || 'call',
        });
      }
    }
  }

  // Fallback: if no text parts found, check if there's any text in parts we missed
  if (!textContent && message.parts?.length === 0) {
    textContent = '';
  }

  return (
    <div className={cn('flex gap-2 sm:gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}

      <div
        className={cn(
          'max-w-[92%] sm:max-w-[80%] rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        )}
      >
        {/* Tool call indicators */}
        {toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {toolCalls.map((tc, i) => (
              <ToolCallDisplay key={i} toolName={tc.toolName} state={tc.state} />
            ))}
          </div>
        )}

        {/* Text content with markdown */}
        {textContent && (
          <div className={cn(
            'prose prose-sm max-w-none',
            isUser ? 'prose-invert' : 'dark:prose-invert'
          )}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
