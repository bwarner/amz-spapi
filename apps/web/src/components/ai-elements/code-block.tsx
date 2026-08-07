'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CheckIcon, CopyIcon } from 'lucide-react';
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  useContext,
  useState,
} from 'react';

/**
 * AI Elements `code-block`, with the same API as
 * https://registry.ai-sdk.dev/code-block.json — and deliberately without its
 * syntax highlighting.
 *
 * The registry version renders through Shiki, which is over a megabyte of
 * grammars and themes. What we actually put through this component is tool
 * parameters and tool results: machine JSON, already indented, read to check a
 * SKU or a quantity rather than to study control flow. Colouring it does not
 * help anyone answer "what did this call ask for", and the chat route is the
 * one page a seller waits on.
 *
 * The contract is kept identical — `CodeBlock` takes `code`/`language` and
 * provides the copy context — so swapping Shiki back in later is changing this
 * file and nothing else.
 */

type CodeBlockContextValue = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextValue>({ code: '' });

export type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  /** Accepted and recorded for API parity; nothing is highlighted by it. */
  language?: string;
  showLineNumbers?: boolean;
};

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const lines = showLineNumbers ? code.split('\n') : null;

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-md border bg-muted/40',
          className
        )}
        data-language={language}
        {...props}
      >
        <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
          <code className="font-mono">
            {lines
              ? lines.map((line, index) => (
                  <span key={index} className="block">
                    <span className="mr-4 inline-block min-w-10 select-none text-right text-muted-foreground">
                      {index + 1}
                    </span>
                    {line}
                  </span>
                ))
              : code}
          </code>
        </pre>
        {children}
      </div>
    </CodeBlockContext.Provider>
  );
};

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [copied, setCopied] = useState(false);
  const { code } = useContext(CodeBlockContext);

  const copy = async () => {
    // Absent outside a secure context, which local development over plain HTTP
    // is — failing silently would look like a dead button.
    if (!navigator?.clipboard?.writeText) {
      onError?.(new Error('Clipboard unavailable in this context.'));
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), timeout);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error('Copy failed.'));
    }
  };

  return (
    <Button
      className={cn('absolute right-1.5 top-1.5 h-7 w-7', className)}
      onClick={copy}
      size="icon"
      type="button"
      variant="ghost"
      {...props}
    >
      {copied ? (
        <CheckIcon className="size-3.5" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
      <span className="sr-only">Copy</span>
    </Button>
  );
};
