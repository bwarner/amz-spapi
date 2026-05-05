export type ExtractedBrandGuideSuggestion = {
  brandName?: string;
  colors: string[];
  fonts: string[];
  palette: {
    primaryForeground?: string;
    secondaryForeground?: string;
    background?: string;
  };
  fontRoles: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  notes: string;
};

export function normalizeHexColor(value: string) {
  const match = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1];
  if (hex.length === 3) {
    return `#${hex
      .split('')
      .map((char) => `${char}${char}`)
      .join('')
      .toLowerCase()}`;
  }
  return `#${hex.toLowerCase()}`;
}

export function extractHexColors(text: string) {
  const matches = text.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g) || [];
  const unique: string[] = [];
  for (const match of matches) {
    const normalized = normalizeHexColor(match);
    if (normalized && !unique.includes(normalized)) {
      unique.push(normalized);
    }
    if (unique.length >= 8) break;
  }
  return unique;
}

export function inferBrandNameFromFileName(fileName: string) {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  const cleaned = base
    .replace(/[_-]+/g, ' ')
    .replace(/\b(style\s*guide|brand\s*guide|guidelines|logo)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function extractBrandNameFromText(text: string) {
  const headingMatch =
    text.match(/^\s*#\s+(.+)$/m) ||
    text.match(/^\s*brand\s+name\s*[:-]\s*(.+)$/im) ||
    text.match(/<title>([^<]+)<\/title>/i) ||
    text.match(
      /^\s*([A-Z][A-Za-z0-9& ]{2,50})\s+(brand guide|style guide|guidelines)\s*$/im
    );
  return headingMatch?.[1]?.trim() || '';
}

export function stripHtmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanFontName(value: string) {
  const cleaned = value
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\b(sans-serif|serif|monospace|cursive|fantasy|system-ui)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';
  if (!/[a-z]/i.test(cleaned)) return '';
  if (/^[\d\W]+$/.test(cleaned)) return '';
  return cleaned;
}

function titleCaseFontName(value: string) {
  if (!value) return '';
  if (value === value.toUpperCase()) {
    return value
      .toLowerCase()
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return value;
}

function extractFontsFromGuideLines(text: string) {
  const fonts: string[] = [];
  const seen = new Set<string>();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const addCandidate = (value: string) => {
    const cleaned = titleCaseFontName(
      cleanFontName(value.replace(/\b\d{3,4}\b/g, ' '))
    );
    if (!cleaned) return;
    if (
      ['fonts', 'font', 'colors', 'colour', 'designed by', 'logo'].includes(
        cleaned.toLowerCase()
      )
    ) {
      return;
    }
    const normalized = cleaned.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    fonts.push(cleaned);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/\bfonts?\b/i.test(line)) continue;

    const window = [line, lines[index + 1], lines[index + 2]]
      .filter(Boolean)
      .join(' ');
    const stripped = window.replace(/\bfonts?\b[:\s-]*/i, ' ');

    const matches =
      stripped.match(
        /\b([A-Z][A-Z0-9]+(?:\s+[A-Z][A-Z0-9]+){0,3}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b(?:\s+\d{3,4})?/g
      ) || [];

    for (const match of matches) {
      addCandidate(match);
      if (fonts.length >= 8) return fonts;
    }
  }

  return fonts;
}

export function extractFontCandidates(text: string) {
  const guideFonts = extractFontsFromGuideLines(text);
  if (guideFonts.length) return guideFonts;

  const fonts: string[] = [];
  const seen = new Set<string>();

  const regexes = [
    /font-family\s*:\s*([^;}\n]+)/gi,
    /font\s*:\s*[^;\n]*?\b["']?([A-Za-z][A-Za-z0-9 -]{1,60})["']?\s*(?:,|;|\n)/gi,
    /\b(?:primary|secondary|body|heading|headline|display|title)\s+font\s*[:-]\s*([A-Za-z][A-Za-z0-9 "'-]{1,60})/gi,
  ];

  for (const regex of regexes) {
    for (const match of text.matchAll(regex)) {
      const candidates = (match[1] || '')
        .split(',')
        .map((part) => titleCaseFontName(cleanFontName(part)))
        .filter(Boolean);
      for (const candidate of candidates) {
        const normalized = candidate.toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        fonts.push(candidate);
        if (fonts.length >= 8) return fonts;
      }
    }
  }

  return fonts;
}

export function inferSuggestion(params: {
  text: string;
  sourceLabel?: string;
}) {
  const colors = extractHexColors(params.text);
  const fonts = extractFontCandidates(params.text);
  const brandName =
    extractBrandNameFromText(params.text) ||
    (params.sourceLabel ? inferBrandNameFromFileName(params.sourceLabel) : '');

  const palette = {
    primaryForeground: colors[0],
    secondaryForeground: colors[1],
    background: colors[2],
  };

  const fontRoles = {
    primary: fonts[0],
    secondary: fonts[1],
    accent: fonts[2],
  };

  const notes = [
    brandName ? `Detected brand name candidate: ${brandName}.` : null,
    colors.length ? `Detected color candidates: ${colors.join(', ')}.` : null,
    fonts.length ? `Detected font candidates: ${fonts.join(', ')}.` : null,
    params.sourceLabel ? `Source: ${params.sourceLabel}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    brandName: brandName || undefined,
    colors,
    fonts,
    palette,
    fontRoles,
    notes,
  } satisfies ExtractedBrandGuideSuggestion;
}
