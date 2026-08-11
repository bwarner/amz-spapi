'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Search, Sparkles } from 'lucide-react';
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

/**
 * ⌘K over everything filed.
 *
 * Two groups, because there are honestly two searches and merging them would
 * misrepresent both.
 *
 * **Files** is a name match over the library already in memory. It covers
 * EVERYTHING — report exports, box labels, artwork, files nothing was read
 * from — and it answers instantly because the list is already here.
 *
 * **By meaning** is the Search index, and it covers only documents that were
 * extracted: invoices, receipts, waybills. It finds "the packaging supplier in
 * Guangzhou" when the invoice says Weilong, which no name match can do.
 *
 * A single blended list would quietly imply the semantic half had considered a
 * settlement export it has never seen. Two labelled groups say what looked at
 * what — and when the index is unreachable, the second group says so rather
 * than appearing empty, which would read as "no such document".
 */

export type PaletteFile = {
  id: string;
  fileName: string;
  nameUnknown?: boolean;
  produced: Array<{ kind: string }>;
};

type SemanticHit = {
  documentId: string;
  fileName?: string;
  vendorName?: string;
  documentDate?: string;
  role?: string;
};

type SearchResponse = {
  hits: SemanticHit[];
  mode: 'hybrid' | 'keyword' | 'fallback';
  reason?: string;
};

/** Long enough that typing a word does not fire four searches. */
const DEBOUNCE_MS = 250;

export function DocumentPalette({
  files,
  onSelectFile,
}: {
  files: PaletteFile[];
  /** Called with a file id so the Library can scroll to and highlight it. */
  onSelectFile: (fileId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);

  // Every request in flight, so a slow early response cannot overwrite a
  // faster later one and show results for a query the user has moved past.
  const latest = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setSemantic(null);
      setSearching(false);
      return;
    }

    const ticket = ++latest.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/documents/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: text, limit: 8 }),
        });
        const payload = (await response.json()) as SearchResponse;
        if (ticket !== latest.current) return;
        setSemantic(response.ok ? payload : null);
      } catch {
        if (ticket === latest.current) setSemantic(null);
      } finally {
        if (ticket === latest.current) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const choose = useCallback(
    (fileId: string) => {
      setOpen(false);
      setQuery('');
      onSelectFile(fileId);
    },
    [onSelectFile]
  );

  const needle = query.trim().toLowerCase();
  const matchingFiles = needle
    ? files
        .filter((file) => file.fileName.toLowerCase().includes(needle))
        .slice(0, 8)
    : files.slice(0, 8);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">
          Search {files.length} file{files.length === 1 ? '' : 's'}
        </span>
        <kbd className="ml-1 hidden rounded border bg-muted px-1.5 text-[10px] font-medium sm:inline">
          ⌘K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        // Both lists arrive filtered — one locally by name, one by the server.
        // Letting cmdk filter again would discard every semantic hit whose text
        // does not literally contain the query, which is most of them.
        commandProps={{ shouldFilter: false }}
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search by file name, supplier, or what a document says…"
        />
        <CommandList>
          {/* With cmdk's own filtering off, CommandEmpty would always render —
              it counts the items cmdk filtered, and cmdk is filtering nothing.
              So emptiness is decided here, from the two lists we control. */}
          {!matchingFiles.length && !semantic?.hits.length ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {searching ? 'Searching…' : 'Nothing matches that.'}
            </div>
          ) : null}

          {matchingFiles.length ? (
            <CommandGroup heading="Files">
              {matchingFiles.map((file) => (
                <CommandItem
                  key={file.id}
                  value={`file-${file.id}`}
                  onSelect={() => choose(file.id)}
                >
                  <FileText className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  <span className={file.nameUnknown ? 'italic' : ''}>
                    {file.fileName}
                  </span>
                  {file.produced.length ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {describeProduced(file.produced)}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {semantic?.hits.length ? (
            <CommandGroup
              heading={
                semantic.mode === 'fallback' ? 'Text match' : 'By meaning'
              }
            >
              {semantic.hits.map((hit) => (
                <CommandItem
                  key={hit.documentId}
                  value={`doc-${hit.documentId}`}
                  onSelect={() => choose(fileIdOf(hit.documentId))}
                >
                  <Sparkles className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  <span>
                    {hit.vendorName ?? hit.fileName ?? 'Document'}
                    {hit.documentDate ? (
                      <span className="text-muted-foreground">
                        {' · '}
                        {hit.documentDate}
                      </span>
                    ) : null}
                  </span>
                  {hit.role ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {hit.role.replace(/-/g, ' ')}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {/* Never leave the weaker search looking like a complete answer. */}
          {semantic?.mode === 'fallback' && needle.length >= 2 ? (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Search by meaning is unavailable, so this is a plain text match.
              Documents it would have found by description are not listed.
            </p>
          ) : null}

          {searching ? (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching documents…
            </p>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}

/**
 * A document id is `<userId>::<assetId>`, and the Library is keyed by asset.
 *
 * Split on the LAST separator: an Auth0 subject contains a `|` and could in
 * principle contain the separator too, whereas an asset id is generated by us
 * and cannot.
 */
function fileIdOf(documentId: string): string {
  const at = documentId.lastIndexOf('::');
  return at === -1 ? documentId : documentId.slice(at + 2);
}

function describeProduced(produced: Array<{ kind: string }>): string {
  const kinds = new Set(produced.map((item) => item.kind));
  if (kinds.has('report-rows')) return 'report';
  if (kinds.has('box-labels')) return 'box labels';
  if (kinds.has('purchase-document')) return 'document';
  return '';
}
