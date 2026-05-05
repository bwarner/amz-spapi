import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { auth0 } from '../../../../../lib/auth0';
import {
  inferSuggestion,
  stripHtmlToText,
  type ExtractedBrandGuideSuggestion,
} from '../../../../../lib/brand-guide-extraction';

const execFileAsync = promisify(execFile);
const PYTHON_BIN =
  '/Users/bwarner/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.startsWith('local.') ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function isPdfMimeType(contentType: string, sourceLabel = '') {
  return (
    contentType.includes('application/pdf') ||
    sourceLabel.toLowerCase().endsWith('.pdf')
  );
}

function isTextLike(contentType: string, sourceLabel = '') {
  const lower = sourceLabel.toLowerCase();
  return (
    contentType.startsWith('text/') ||
    contentType.includes('image/svg+xml') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.html') ||
    lower.endsWith('.css')
  );
}

async function extractPdfText(buffer: Buffer) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sellavant-pdf-'));
  const pdfPath = path.join(tempDir, 'source.pdf');
  try {
    await writeFile(pdfPath, buffer);
    const { stdout } = await execFileAsync(
      PYTHON_BIN,
      [
        '-c',
        [
          'import json, sys',
          'from pypdf import PdfReader',
          'reader = PdfReader(sys.argv[1])',
          'parts = []',
          'for page in reader.pages[:10]:',
          '    try:',
          '        parts.append(page.extract_text() or "")',
          '    except Exception:',
          '        pass',
          'text = "\\n".join(parts)',
          'print(json.dumps({"text": text[:50000]}))',
        ].join('\n'),
        pdfPath,
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024 * 2 }
    );
    const parsed = JSON.parse(stdout) as { text?: string };
    return parsed.text || '';
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function extractFromTextSource(params: {
  text: string;
  sourceLabel?: string;
}): Promise<ExtractedBrandGuideSuggestion> {
  return inferSuggestion(params);
}

async function extractFromFile(file: File) {
  const sourceLabel = file.name;
  const mimeType = file.type || 'application/octet-stream';

  if (isPdfMimeType(mimeType, sourceLabel)) {
    const text = await extractPdfText(Buffer.from(await file.arrayBuffer()));
    return extractFromTextSource({ text, sourceLabel });
  }

  if (isTextLike(mimeType, sourceLabel)) {
    const text = await file.text();
    return extractFromTextSource({ text, sourceLabel });
  }

  return {
    brandName: undefined,
    colors: [],
    fonts: [],
    palette: {},
    fontRoles: {},
    notes: `No extractor is available yet for ${sourceLabel}.`,
  } satisfies ExtractedBrandGuideSuggestion;
}

async function extractFromUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    isPrivateHost(url.hostname)
  ) {
    throw new Error('Only public http(s) URLs can be used for extraction.');
  }

  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; SellAvantBrandGuideExtractor/1.0; +https://sellavant.com)',
      Accept:
        'text/html,application/xhtml+xml,application/xml,application/pdf,text/plain;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Could not read source URL (HTTP ${response.status}).`);
  }

  const contentType = response.headers.get('content-type') || '';

  if (isPdfMimeType(contentType, url.pathname)) {
    const text = await extractPdfText(
      Buffer.from(await response.arrayBuffer())
    );
    return extractFromTextSource({ text, sourceLabel: rawUrl });
  }

  const html = await response.text();
  const text = contentType.includes('text/html') ? stripHtmlToText(html) : html;
  return extractFromTextSource({ text, sourceLabel: rawUrl });
}

function mergeSuggestions(suggestions: ExtractedBrandGuideSuggestion[]) {
  const colors: string[] = [];
  const fonts: string[] = [];
  let brandName = '';
  const notes: string[] = [];

  for (const suggestion of suggestions) {
    if (!brandName && suggestion.brandName) {
      brandName = suggestion.brandName;
    }
    for (const color of suggestion.colors) {
      if (!colors.includes(color)) colors.push(color);
      if (colors.length >= 6) break;
    }
    for (const font of suggestion.fonts) {
      if (!fonts.includes(font)) fonts.push(font);
      if (fonts.length >= 6) break;
    }
    if (suggestion.notes) notes.push(suggestion.notes);
  }

  return {
    brandName: brandName || undefined,
    colors,
    fonts,
    palette: {
      primaryForeground: colors[0],
      secondaryForeground: colors[1],
      background: colors[2],
    },
    fontRoles: {
      primary: fonts[0],
      secondary: fonts[1],
      accent: fonts[2],
    },
    notes: notes.join(' '),
  } satisfies ExtractedBrandGuideSuggestion;
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contentType = request.headers.get('content-type') || '';

  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const files = formData
        .getAll('files')
        .filter((item): item is File => item instanceof File);
      if (!files.length) {
        return Response.json(
          { error: 'No files were provided.' },
          { status: 400 }
        );
      }

      const suggestions = await Promise.all(
        files.map((file) => extractFromFile(file))
      );
      const merged = mergeSuggestions(suggestions);
      return Response.json({
        suggestions,
        merged,
      });
    }

    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== 'string' || !body.url.trim()) {
      return Response.json(
        { error: 'A public URL is required.' },
        { status: 400 }
      );
    }

    const suggestion = await extractFromUrl(body.url);
    return Response.json({ suggestions: [suggestion], merged: suggestion });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not extract from source.';
    return Response.json({ error: message }, { status: 400 });
  }
}
