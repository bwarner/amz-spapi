'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Search, Sparkles } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
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

type SearchFacets = {
  roles: Array<{ role: string; count: number }>;
  periods: Array<{ label: string; from?: string; to?: string; count: number }>;
};

type SearchResponse = {
  hits: SemanticHit[];
  mode: 'hybrid' | 'keyword' | 'fallback';
  reason?: string;
  /**
   * FTS facets over the WHOLE match set — what lets eight visible hits say
   * "of 41: 29 invoices, 12 receipts". Absent on the fallback path, and the
   * chips simply do not render.
   */
  facets?: SearchFacets;
};

type PeriodFilter = { label: string; from?: string; to?: string };

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
  // Facet filters, round-tripped to the search request. One of each: the
  // palette is a finder, not a query builder.
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter | null>(null);

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
          body: JSON.stringify({
            q: text,
            limit: 8,
            ...(roleFilter ? { roles: [roleFilter] } : {}),
            ...(periodFilter?.from ? { from: periodFilter.from } : {}),
            ...(periodFilter?.to ? { to: periodFilter.to } : {}),
          }),
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
  }, [query, roleFilter, periodFilter]);

  const choose = useCallback(
    (fileId: string) => {
      setOpen(false);
      setQuery('');
      setRoleFilter(null);
      setPeriodFilter(null);
      onSelectFile(fileId);
    },
    [onSelectFile]
  );

  const close = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setRoleFilter(null);
      setPeriodFilter(null);
    }
  }, []);

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

      <CommandDialog open={open} onOpenChange={close}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search by file name, supplier, or what a document says…"
        />
        {/* Facet chips: counts over the WHOLE match set (FTS facets), so the
            eight hits below can say what the rest are. Clicking narrows the
            search server-side; the active chip clicks off again. While a
            filter is active the returned facets describe the FILTERED set, so
            the active chip is rendered from state, not from the response. */}
        {semantic?.facets || roleFilter || periodFilter ? (
          <div className="flex flex-wrap gap-1 border-b px-3 py-2">
            {(roleFilter
              ? [{ role: roleFilter, count: undefined }]
              : (semantic?.facets?.roles ?? []).slice(0, 6)
            ).map((entry) => (
              <FacetChip
                key={entry.role}
                label={entry.role.replace(/-/g, ' ')}
                count={entry.count}
                active={roleFilter === entry.role}
                onClick={() =>
                  setRoleFilter(roleFilter === entry.role ? null : entry.role)
                }
              />
            ))}
            {(periodFilter
              ? [{ ...periodFilter, count: undefined }]
              : (semantic?.facets?.periods ?? []).slice(0, 4)
            ).map((entry) => (
              <FacetChip
                key={entry.label}
                label={entry.label}
                count={'count' in entry ? entry.count : undefined}
                active={periodFilter?.label === entry.label}
                onClick={() =>
                  setPeriodFilter(
                    periodFilter?.label === entry.label
                      ? null
                      : { label: entry.label, from: entry.from, to: entry.to }
                  )
                }
              />
            ))}
          </div>
        ) : null}
        <CommandList>
          <CommandEmpty>
            {searching ? 'Searching…' : 'Nothing matches that.'}
          </CommandEmpty>

          {matchingFiles.length ? (
            <CommandGroup heading="Files">
              {matchingFiles.map((file) => (
                <CommandItem
                  key={file.id}
                  value={itemValue('file', file.id, query)}
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
                  value={itemValue('doc', hit.documentId, query)}
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

function FacetChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground'
          : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground'
      }
    >
      {label}
      {count !== undefined ? (
        <span className="ml-1 tabular-nums opacity-70">{count}</span>
      ) : (
        <span className="ml-1">×</span>
      )}
    </button>
  );
}

/**
 * An item's cmdk value: the query, then what makes the row unique.
 *
 * cmdk filters items itself by matching this against what was typed, and that
 * filter is the wrong tool for a list the server already chose — a semantic hit
 * is returned BECAUSE it means the same thing, not because its text contains
 * those words, so cmdk would discard exactly the results worth showing.
 *
 * Turning the filter off is the obvious fix and the wrong one: cmdk derives
 * keyboard selection from the same pass, so with it off every row reports
 * itself selected and nothing indicates what Enter will open. Folding the query
 * into the value keeps cmdk doing its job — every row matches, so every row
 * survives — while selection, arrow keys and Enter keep working as built.
 */
function itemValue(kind: string, id: string, query: string): string {
  return `${query} ${kind}-${id}`;
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
