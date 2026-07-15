import type {
  APlusModuleTextFieldDescriptor,
  APlusTextFieldPath,
} from './aplus.js';
import type { Section } from './experience.js';

// ---------------------------------------------------------------------------
// Section-level editing primitives — the Experience-model mirror of the
// module descriptor pattern in aplus.ts. The editor edits SECTIONS (single
// source of truth); the compiled deployment is always derived.
// ---------------------------------------------------------------------------

/**
 * Enumerates every editable text field of a section — narrative copy,
 * archetype-specific structured content, and per-image-slot alt + generation
 * brief — with stable paths (rooted at the Section) for setSectionTextField.
 */
export function sectionTextFieldDescriptors(
  section: Section
): APlusModuleTextFieldDescriptor[] {
  const fields: APlusModuleTextFieldDescriptor[] = [];
  const add = (
    label: string,
    path: APlusTextFieldPath,
    value: string | undefined | null,
    maxLength: number,
    multiline = false
  ) => fields.push({ label, path, value: value ?? '', maxLength, multiline });

  add('Section label', ['label'], section.label, 120);
  add('Headline', ['headline'], section.headline, 160);
  add('Body', ['subcopy'], section.subcopy, 1200, true);
  section.bullets?.forEach((bullet, index) =>
    add(`Bullet ${index + 1}`, ['bullets', index], bullet, 160)
  );

  const layout = section.visual.layout;
  const layoutPath = (...tail: Array<string | number>): APlusTextFieldPath => [
    'visual',
    'layout',
    ...tail,
  ];
  switch (layout.archetype) {
    case 'feature-grid':
      layout.tiles.forEach((tile, index) => {
        add(
          `Tile ${index + 1} headline`,
          layoutPath('tiles', index, 'headline'),
          tile.headline,
          160
        );
        add(
          `Tile ${index + 1} body`,
          layoutPath('tiles', index, 'body'),
          tile.body,
          400,
          true
        );
      });
      break;
    case 'icon-row':
      layout.items.forEach((item, index) =>
        add(
          `Icon ${index + 1} label`,
          layoutPath('items', index, 'label'),
          item.label,
          40
        )
      );
      break;
    case 'comparison-table':
      layout.columns.forEach((column, index) =>
        add(
          `Product ${index + 1}`,
          layoutPath('columns', index, 'title'),
          column.title,
          100
        )
      );
      layout.rows.forEach((row, rowIndex) => {
        add(
          `Row ${rowIndex + 1} label`,
          layoutPath('rows', rowIndex, 'label'),
          row.label,
          60
        );
        row.values.forEach((value, valueIndex) =>
          add(
            `${row.label || `Row ${rowIndex + 1}`} — ${
              layout.columns[valueIndex]?.title || `Product ${valueIndex + 1}`
            }`,
            layoutPath('rows', rowIndex, 'values', valueIndex),
            value,
            80
          )
        );
      });
      break;
    case 'dual-use-split':
      layout.panels.forEach((panel, index) => {
        add(
          `Panel ${index + 1} label`,
          layoutPath('panels', index, 'label'),
          panel.label,
          40
        );
        add(
          `Panel ${index + 1} caption`,
          layoutPath('panels', index, 'caption'),
          panel.caption,
          160
        );
      });
      break;
    case 'stat-band':
      layout.stats.forEach((stat, index) => {
        add(
          `Stat ${index + 1} value`,
          layoutPath('stats', index, 'value'),
          stat.value,
          16
        );
        add(
          `Stat ${index + 1} label`,
          layoutPath('stats', index, 'label'),
          stat.label,
          40
        );
      });
      break;
    case 'spec-sheet':
      layout.rows.forEach((row, index) => {
        add(
          `Spec ${index + 1} label`,
          layoutPath('rows', index, 'label'),
          row.label,
          60
        );
        add(
          `Spec ${index + 1} value`,
          layoutPath('rows', index, 'value'),
          row.value,
          200
        );
      });
      break;
    case 'qna':
      layout.items.forEach((item, index) => {
        add(
          `Question ${index + 1}`,
          layoutPath('items', index, 'question'),
          item.question,
          200
        );
        add(
          `Answer ${index + 1}`,
          layoutPath('items', index, 'answer'),
          item.answer,
          800,
          true
        );
      });
      break;
    case 'hotspots':
      layout.hotspots.forEach((spot, index) => {
        add(
          `Hotspot ${index + 1} label`,
          layoutPath('hotspots', index, 'label'),
          spot.label,
          60
        );
        add(
          `Hotspot ${index + 1} copy`,
          layoutPath('hotspots', index, 'copy'),
          spot.copy,
          200
        );
      });
      break;
    default:
      // Hero-style archetypes: copy lives on the section fields above.
      break;
  }

  section.visual.images.forEach((slot, index) => {
    add(
      `${slot.role} alt text`,
      ['visual', 'images', index, 'alt'],
      slot.alt,
      160
    );
    add(
      `${slot.role} image brief`,
      ['visual', 'images', index, 'source', 'brief'],
      slot.source.brief,
      1200,
      true
    );
  });

  return fields;
}

/**
 * Immutably sets one text field on a section by descriptor path. Same
 * semantics as setModuleTextField: the raw value is stored (typing trailing
 * spaces works); clearing stores undefined for object keys and '' for array
 * elements. Editing a slot's alt mirrors it onto the resolved image.
 */
export function setSectionTextField(
  section: Section,
  path: APlusTextFieldPath,
  value: string
): Section {
  if (path.length === 0) return section;
  const next = structuredClone(section);
  let parent: unknown = next;
  for (let i = 0; i < path.length - 1; i++) {
    if (parent === null || typeof parent !== 'object') return section;
    parent = (parent as Record<string | number, unknown>)[path[i]];
  }
  if (parent === null || typeof parent !== 'object') return section;

  const target = parent as Record<string | number, unknown>;
  const tail = path[path.length - 1];
  const trimmed = value.trim();
  if (trimmed === '') {
    target[tail] = typeof tail === 'number' ? '' : undefined;
  } else {
    target[tail] = value;
    if (tail === 'alt') {
      const resolved = (target as { resolved?: unknown }).resolved;
      if (
        resolved !== null &&
        typeof resolved === 'object' &&
        'alt' in resolved
      ) {
        (resolved as { alt: string }).alt = value;
      }
    }
  }
  return next;
}

/**
 * Writes a generated/placed image into the slot with the given role — the
 * editor's write-back when an image job completes. Returns the section
 * unchanged when no slot matches.
 */
export function setSectionResolvedImage(
  section: Section,
  role: string,
  image: { url: string; alt?: string }
): Section {
  const index = section.visual.images.findIndex((slot) => slot.role === role);
  if (index < 0) return section;
  const next = structuredClone(section);
  const slot = next.visual.images[index];
  slot.resolved = { url: image.url, alt: image.alt ?? (slot.alt || slot.role) };
  return next;
}
