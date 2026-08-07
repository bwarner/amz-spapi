/**
 * Files a turn produced, pulled out of the tool results that made them.
 *
 * Until now these reached the reader only if the model remembered to write a
 * markdown link — `seller-agent.ts` literally instructs it to, in two places.
 * That is a poor way to hold the one file a seller asked for: it is buried in
 * prose, it is lost the moment the model paraphrases instead, and there is no
 * sign of how big it is or what format it came out as.
 *
 * Reading it from the result instead means the file is always there, exactly
 * once, whatever the model chose to say about it.
 */

export type ProducedFile = {
  url: string;
  /** What to call it. Falls back to something honest rather than "file". */
  name: string;
  /** A short line under the title: size, format, count. */
  detail?: string;
};

/** Human-readable bytes. Files here run from a few KB to tens of MB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10 so "1.4 MB" keeps its meaning; none above, where it
  // is noise.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? (value as UnknownRecord) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * The files in one tool result.
 *
 * Keyed off the shape rather than a list of tool names, so a new tool that
 * returns a `downloadUrl` is rendered without anyone remembering to register
 * it — the failure mode being avoided is precisely "nobody wired it up".
 */
export function extractDownloads(
  toolName: string,
  output: unknown
): ProducedFile[] {
  const data = asRecord(output);
  if (!data) return [];

  // A refusal carries no file, and rendering a download for one would be worse
  // than showing nothing.
  if (data['success'] === false) return [];

  const files: ProducedFile[] = [];

  const single = str(data['downloadUrl']);
  if (single) {
    const size = num(data['sizeBytes']);
    const count = num(data['fileCount']);
    const detail = [
      count ? `${count} file${count === 1 ? '' : 's'}` : '',
      size ? formatBytes(size) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    files.push({
      url: single,
      name: str(data['fileName']) ?? defaultName(toolName, data),
      detail: detail || undefined,
    });
  }

  // `get-purchase-order` returns one entry per format that has been rendered.
  const downloads = data['downloads'];
  if (Array.isArray(downloads)) {
    for (const entry of downloads) {
      const record = asRecord(entry);
      const url = str(record?.['downloadUrl']);
      if (!record || !url) continue;
      const format = str(record['format']);
      files.push({
        url,
        name: str(record['fileName']) ?? defaultName(toolName, data),
        detail: format ? format.toUpperCase() : undefined,
      });
    }
  }

  return files;
}

function defaultName(toolName: string, data: UnknownRecord): string {
  const poNumber = str(data['poNumber']);
  if (poNumber) return `Purchase order ${poNumber}`;
  if (toolName === 'export-photo-set') return 'Photo set';
  return 'Download';
}
