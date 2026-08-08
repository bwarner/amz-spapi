import { describe, expect, it } from 'vitest';
import { normalizeChatTitle } from './chat-store';

/**
 * The gate between a text field and a stored conversation title.
 *
 * The sidebar renders the title on one line and truncates it, so anything that
 * survives here is something the user will never see in full — and a title that
 * normalises to nothing would leave a row in the list with no label and no way
 * to tell it from its neighbours. Rejecting is the caller's cue to send a 400
 * rather than write a blank.
 */
describe('normalizeChatTitle', () => {
  it('trims and keeps ordinary titles', () => {
    expect(normalizeChatTitle('  Q4 restock plan  ')).toBe('Q4 restock plan');
  });

  it('collapses newlines and runs of whitespace to single spaces', () => {
    expect(normalizeChatTitle('Returns\n\ntriage   notes')).toBe(
      'Returns triage notes'
    );
  });

  it('clamps to 60 characters with an ellipsis', () => {
    const result = normalizeChatTitle('a'.repeat(200));
    expect(result).toHaveLength(60);
    expect(result?.endsWith('…')).toBe(true);
  });

  it('rejects titles that normalise to nothing', () => {
    expect(normalizeChatTitle('')).toBeNull();
    expect(normalizeChatTitle('   \n\t ')).toBeNull();
  });

  it('rejects non-strings from an unvalidated request body', () => {
    expect(normalizeChatTitle(undefined)).toBeNull();
    expect(normalizeChatTitle(42)).toBeNull();
    expect(normalizeChatTitle({ title: 'x' })).toBeNull();
  });
});
