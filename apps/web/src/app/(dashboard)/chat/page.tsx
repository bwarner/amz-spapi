'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Sparkles, Loader2, ArrowDown, Plus, AlertCircle } from 'lucide-react';
import { MessageBubble, type AppMessage } from './message-bubble';

const STORAGE_KEY = 'sellavant-chat';

function loadMessages(): AppMessage[] | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // Ignore parse errors
  }
  return undefined;
}

function saveMessages(messages: AppMessage[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // Ignore quota errors
  }
}

export default function ChatPage() {
  const [input, setInput] = useState('');
  const [chatKey, setChatKey] = useState(0);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat' }),
    []
  );

  const { messages, sendMessage, setMessages, status, error } = useChat<AppMessage>({
    id: 'sellavant-chat',
    transport,
  });

  const isStreaming = status === 'submitted' || status === 'streaming';
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Restore messages from localStorage
  useEffect(() => {
    const stored = loadMessages();
    if (stored && stored.length > 0) {
      setMessages(stored);
    }
  }, [chatKey, setMessages]);

  // Persist messages
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(messages);
    }
  }, [messages]);

  const handleNewChat = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setMessages([]);
    setChatKey((k) => k + 1);
  }, [setMessages]);

  const suggestedPrompts = [
    'Critique my tea infusion listing',
    'Show my orders from the last 7 days',
    'What are my best-selling products?',
    'Check inventory levels for my FBA products',
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isNearBottom && messages.length > 0);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [messages.length]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    await sendMessage({ text });
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

  return (
    <div className="relative flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Messages area */}
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex h-full min-h-[60vh] flex-col items-center justify-center text-center">
              <div className="rounded-full bg-primary/10 p-4">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">
                How can I help grow your Amazon business?
              </h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                I can analyze your listings, review orders, check inventory, and suggest
                improvements to boost your sales.
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
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <Button
          variant="outline"
          size="icon"
          onClick={scrollToBottom}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full shadow-md"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      )}

      {/* Error banner */}
      {error && (
        <div className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error.message || 'Something went wrong'}</p>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t bg-background">
        <div className="mx-auto max-w-3xl px-2 py-3 sm:px-4 sm:py-4">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleNewChat}
              disabled={isStreaming || messages.length === 0}
              className="hidden sm:flex h-11 w-11 shrink-0 rounded-full"
              title="New chat"
            >
              <Plus className="h-4 w-4" />
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
            <Button
              type="submit"
              disabled={!input.trim() || isStreaming}
              size="icon"
              className="h-11 w-11 shrink-0 rounded-full"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
