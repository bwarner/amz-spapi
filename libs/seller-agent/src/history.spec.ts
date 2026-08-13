import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { trimHistory } from './history.js';

/**
 * History sanitisation, and the approval states it used to delete.
 *
 * The bug this exists to prevent, recorded because every individual step of it
 * looked reasonable:
 *
 * `create-purchase-order` requires approval. The user approved. The tool part
 * became `approval-responded`, which is neither `output-available` nor
 * `output-error`, so sanitisation dropped it as an incomplete call. With the
 * part gone, `convertToModelMessages` emitted no `tool-approval-response`, so
 * the tool never executed — and the model, now with no record that the call had
 * ever been made, proposed a new one. Which asked for approval again.
 *
 * Seven rounds of that were recorded in a single stored message (4 approved,
 * 2 rejected, 1 still pending) before anyone noticed, because nothing errored
 * at any point. The fixtures below use those real states.
 */

const toolPart = (state: string, id: string, approved?: boolean) => ({
  type: 'tool-create-purchase-order',
  toolCallId: id,
  state,
  input: { vendor: { name: 'Panama Select' } },
  ...(approved === undefined
    ? state === 'approval-requested'
      ? { approval: { id: `aitxt-${id}` } }
      : {}
    : { approval: { id: `aitxt-${id}`, approved } }),
});

function assistant(parts: unknown[]): UIMessage {
  return { id: 'a1', role: 'assistant', parts } as unknown as UIMessage;
}

/**
 * The assistant message always carries a text part, because the real one did —
 * seq 157 held 7 tool parts, 1 text and 10 step-start.
 *
 * This is not decoration. `sanitizeMessages` returns the message UNCHANGED when
 * filtering would empty it, so a fixture made only of tool parts survives any
 * amount of over-stripping and the test proves nothing. The first version of
 * this file made exactly that mistake: a mutation removing approval states from
 * the keep-list left every approval test green.
 */
function conversation(...parts: unknown[]): UIMessage[] {
  return [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'order it' }] },
    assistant([
      { type: 'text', text: 'PO draft — review & approve' },
      ...parts,
    ]),
  ] as unknown as UIMessage[];
}

/** The same parts, but with a later exchange after them — so they are stale. */
function historicConversation(...parts: unknown[]): UIMessage[] {
  return [
    ...conversation(...parts),
    {
      id: 'u2',
      role: 'user',
      parts: [{ type: 'text', text: 'show me the PO' }],
    },
    assistant([{ type: 'text', text: 'here it is' }]),
  ] as unknown as UIMessage[];
}

const statesAt = (messages: UIMessage[], index: number) =>
  (messages[index].parts as Array<{ type: string; state?: string }>)
    .filter((p) => p.type.startsWith('tool-'))
    .map((p) => p.state);

const statesOf = (messages: UIMessage[]) =>
  (
    messages[messages.length - 1].parts as Array<{
      type: string;
      state?: string;
    }>
  )
    .filter((p) => p.type.startsWith('tool-'))
    .map((p) => p.state);

describe('approval states survive sanitisation', () => {
  it('keeps an approved call, which is what lets the tool actually run', () => {
    // The whole bug in one assertion. Drop this part and the approval response
    // never reaches the executor.
    const kept = trimHistory(
      conversation(toolPart('approval-responded', 'c1', true)),
      { maxMessages: 20, minRecentMessages: 10 }
    );

    expect(statesOf(kept)).toEqual(['approval-responded']);
  });

  it('keeps a rejected call, so the model learns it was refused', () => {
    // Dropping a rejection is worse than dropping an approval: the model has no
    // idea the user said no, and proposes the same thing again.
    const kept = trimHistory(
      conversation(toolPart('approval-responded', 'c2', false)),
      { maxMessages: 20, minRecentMessages: 10 }
    );

    expect(statesOf(kept)).toEqual(['approval-responded']);
  });

  it('keeps a pending request rather than re-asking from scratch', () => {
    const kept = trimHistory(
      conversation(toolPart('approval-requested', 'c3')),
      { maxMessages: 20, minRecentMessages: 10 }
    );

    expect(statesOf(kept)).toEqual(['approval-requested']);
  });

  it('preserves the real seq-157 shape intact', () => {
    // 4 approved, 2 rejected, 1 pending — exactly what was stored while the
    // loop was happening.
    const parts = [
      toolPart('approval-responded', 'a', true),
      toolPart('approval-responded', 'b', true),
      toolPart('approval-responded', 'c', true),
      toolPart('approval-responded', 'd', true),
      toolPart('approval-responded', 'e', false),
      toolPart('approval-responded', 'f', false),
      toolPart('approval-requested', 'g'),
    ];

    const kept = trimHistory(conversation(...parts), {
      maxMessages: 20,
      minRecentMessages: 10,
    });

    expect(statesOf(kept)).toHaveLength(7);
  });
});

describe('abandoned calls are still stripped', () => {
  it('drops a call that never finished streaming', () => {
    // The guard's original purpose, and still correct: a stream that died
    // leaves the model looking at a call it can neither resolve nor retry.
    const kept = trimHistory(
      conversation(
        toolPart('output-available', 'ok'),
        toolPart('input-streaming', 'dead')
      ),
      { maxMessages: 20, minRecentMessages: 10 }
    );

    expect(statesOf(kept)).toEqual(['output-available']);
  });

  it('drops a call stuck at input-available', () => {
    const kept = trimHistory(
      conversation(
        toolPart('output-available', 'ok'),
        toolPart('input-available', 'stuck')
      ),
      { maxMessages: 20, minRecentMessages: 10 }
    );

    expect(statesOf(kept)).toEqual(['output-available']);
  });

  it('leaves settled calls alone', () => {
    const kept = trimHistory(
      conversation(
        toolPart('output-available', 'a'),
        toolPart('output-error', 'b')
      ),
      { maxMessages: 20, minRecentMessages: 10 }
    );

    expect(statesOf(kept)).toEqual(['output-available', 'output-error']);
  });

  it('never strips text parts', () => {
    const kept = trimHistory(
      conversation(
        { type: 'text', text: 'here is the draft' },
        toolPart('input-streaming', 'dead')
      ),
      { maxMessages: 20, minRecentMessages: 10 }
    );

    const types = (kept[1].parts as Array<{ type: string }>).map((p) => p.type);
    expect(types).toEqual(['text', 'text']);
  });
});

/**
 * The opposite failure, and the reason the rule is scoped rather than blanket.
 *
 * Keeping every approval everywhere fixed the loop and broke the conversation:
 * a call approved in a turn that has since ended will never be executed, so it
 * converts to a `tool_use` block with no `tool_result` after it and Anthropic
 * rejects the entire request —
 *
 *   messages.33: `tool_use` ids were found without `tool_result` blocks
 *   immediately after: toolu_012kzwftMhUHH5P4PBcVQCoY, ...
 *
 * — which breaks every later message, not just the one that caused it.
 */
describe('stale approvals are dropped', () => {
  it('removes an approved call from an older message', () => {
    // Nothing will ever execute it, so sending it is a guaranteed 400.
    const kept = trimHistory(
      historicConversation(toolPart('approval-responded', 'orphan', true)),
      { maxMessages: 20, minRecentMessages: 10 }
    );

    expect(statesAt(kept, 1)).toEqual([]);
  });

  it('removes a stale pending request too', () => {
    const kept = trimHistory(
      historicConversation(toolPart('approval-requested', 'orphan')),
      { maxMessages: 20, minRecentMessages: 10 }
    );

    expect(statesAt(kept, 1)).toEqual([]);
  });

  it('keeps settled calls in older messages, which carry results', () => {
    const kept = trimHistory(
      historicConversation(toolPart('output-available', 'done')),
      { maxMessages: 20, minRecentMessages: 10 }
    );

    expect(statesAt(kept, 1)).toEqual(['output-available']);
  });

  it('drops the whole seq-157 pile once it is history', () => {
    // The exact message that produced the 400: 4 approved, 2 rejected, 1
    // pending, none executed.
    const kept = trimHistory(
      historicConversation(
        toolPart('approval-responded', 'a', true),
        toolPart('approval-responded', 'b', true),
        toolPart('approval-responded', 'c', true),
        toolPart('approval-responded', 'd', true),
        toolPart('approval-responded', 'e', false),
        toolPart('approval-responded', 'f', false),
        toolPart('approval-requested', 'g')
      ),
      { maxMessages: 20, minRecentMessages: 10 }
    );

    expect(statesAt(kept, 1)).toEqual([]);
    // The text survives, so the turn is not erased — only the unresolvable calls.
    const types = (kept[1].parts as Array<{ type: string }>).map((p) => p.type);
    expect(types).toEqual(['text']);
  });

  it('still keeps the LIVE approval, which is the whole point', () => {
    // Both rules at once: a stale approval in message 1 goes, a live one in the
    // last assistant message stays.
    const messages = [
      ...conversation(toolPart('approval-responded', 'orphan', true)),
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'again' }] },
      assistant([
        { type: 'text', text: 'approve?' },
        toolPart('approval-responded', 'live', true),
      ]),
    ] as unknown as UIMessage[];

    const kept = trimHistory(messages, {
      maxMessages: 20,
      minRecentMessages: 10,
    });

    expect(statesAt(kept, 1)).toEqual([]);
    expect(statesAt(kept, 3)).toEqual(['approval-responded']);
  });
});

describe('tool inputs are repaired on replay', () => {
  // Seen live: a total-report-rows call failed schema validation and the SDK
  // persisted its output-error part with NO input at all. On replay that
  // converts to a tool_use block without a dictionary, and Anthropic rejects
  // the ENTIRE conversation ("Input should be a valid dictionary") on every
  // turn after the one that wrote it — one bad part poisons the whole chat.
  it('gives a settled part with a missing input an empty dictionary', () => {
    const broken = {
      type: 'tool-total-report-rows',
      toolCallId: 'toolu_015JR1j8',
      state: 'output-error',
      errorText: 'schema validation failed',
      // no `input` key — exactly as persisted
    };
    const kept = trimHistory(conversation(broken), {
      maxMessages: 20,
      minRecentMessages: 10,
    });

    const part = (kept[1].parts as Array<Record<string, unknown>>).find(
      (p) => p['type'] === 'tool-total-report-rows'
    );
    expect(part?.['input']).toEqual({});
    // The error result itself survives — the call happened, and the model
    // should see that it failed rather than propose it fresh.
    expect(part?.['state']).toBe('output-error');
  });

  it('leaves a real input alone', () => {
    const kept = trimHistory(
      conversation(toolPart('output-available', 'ok-1')),
      { maxMessages: 20, minRecentMessages: 10 }
    );
    const part = (kept[1].parts as Array<Record<string, unknown>>).find((p) =>
      String(p['type']).startsWith('tool-')
    );
    expect(part?.['input']).toEqual({ vendor: { name: 'Panama Select' } });
  });
});

describe('oversized tool outputs are capped on replay (#133)', () => {
  const bigOutput = {
    rows: Array.from({ length: 2000 }, (_, i) => `row-${i}`),
  };

  const settled = (id: string, output: unknown) => ({
    type: 'tool-total-report-rows',
    toolCallId: id,
    state: 'output-available',
    input: { kind: 'settlement' },
    output,
  });

  it('replaces a huge output with a marked, clipped preview', () => {
    const kept = trimHistory(conversation(settled('big', bigOutput)), {
      maxMessages: 20,
      minRecentMessages: 10,
      maxToolOutputChars: 500,
    });

    const part = (kept[1].parts as Array<Record<string, unknown>>).find((p) =>
      String(p['type']).startsWith('tool-')
    );
    const output = part?.['output'] as Record<string, unknown>;
    expect(output['truncated']).toBe(true);
    // The marker must FORBID totalling the preview — a silent clip reads as a
    // complete result, which is the spreadsheet-preview failure all over.
    expect(String(output['note'])).toMatch(/INCOMPLETE/);
    expect(String(output['preview']).length).toBe(500);
    // The call record itself is intact: same input, same id.
    expect(part?.['input']).toEqual({ kind: 'settlement' });
  });

  it('leaves a small output byte-identical — the cache-stability contract', () => {
    const small = settled('small', { total: 42 });
    const kept = trimHistory(conversation(small), {
      maxMessages: 20,
      minRecentMessages: 10,
      maxToolOutputChars: 500,
    });
    const part = (kept[1].parts as Array<Record<string, unknown>>).find((p) =>
      String(p['type']).startsWith('tool-')
    );
    expect(part?.['output']).toEqual({ total: 42 });
  });

  it('caps uniformly, newest included: a result must never change shape just because it aged', () => {
    // If the newest turn's results were spared, each would be rewritten the
    // moment it stopped being newest — invalidating the prompt cache
    // mid-prefix on every single turn.
    const kept = trimHistory(
      [
        ...conversation(settled('old', bigOutput)),
        { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'more' }] },
        {
          id: 'a2',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'here it is' },
            settled('new', bigOutput),
          ],
        },
      ] as never,
      { maxMessages: 20, minRecentMessages: 10, maxToolOutputChars: 500 }
    );

    for (const index of [1, 3]) {
      const part = (kept[index].parts as Array<Record<string, unknown>>).find(
        (p) => String(p['type']).startsWith('tool-')
      );
      expect((part?.['output'] as Record<string, unknown>)['truncated']).toBe(
        true
      );
    }
  });
});

describe('history is trimmed to a character budget (#133)', () => {
  const filler = (id: string, chars: number) => [
    {
      id: `u-${id}`,
      role: 'user',
      parts: [{ type: 'text', text: 'q'.repeat(20) }],
    },
    {
      id: `a-${id}`,
      role: 'assistant',
      parts: [{ type: 'text', text: 'x'.repeat(chars) }],
    },
  ];

  it('does nothing under the ceiling, so the prefix stays byte-identical', () => {
    const messages = [
      ...filler('1', 1000),
      ...filler('2', 1000),
    ] as unknown as UIMessage[];
    const kept = trimHistory(messages, {
      maxMessages: 50,
      minRecentMessages: 2,
      maxContextChars: 10_000,
      targetContextChars: 5_000,
    });
    expect(kept.map((m) => m.id)).toEqual(messages.map((m) => m.id));
  });

  it('cuts past the ceiling down to the target, oldest first, in one chunk', () => {
    const messages = [
      ...filler('1', 4000),
      ...filler('2', 4000),
      ...filler('3', 4000),
      ...filler('4', 4000),
    ] as unknown as UIMessage[];
    const kept = trimHistory(messages, {
      maxMessages: 50,
      minRecentMessages: 2,
      maxContextChars: 12_000,
      targetContextChars: 8_000,
    });

    // Oldest exchanges dropped; the survivors start at a user message.
    expect(kept[0]?.role).toBe('user');
    expect(kept.length).toBeLessThan(messages.length);
    const totalChars = kept.reduce(
      (sum, m) => sum + JSON.stringify(m.parts ?? []).length,
      0
    );
    expect(totalChars).toBeLessThanOrEqual(12_000);
    // And the newest exchange is untouched.
    expect(kept[kept.length - 1]?.id).toBe('a-4');
  });

  it('never cuts into the protected recent messages, even over budget', () => {
    const messages = filler('1', 50_000) as unknown as UIMessage[];
    const kept = trimHistory(messages, {
      maxMessages: 50,
      minRecentMessages: 2,
      maxContextChars: 10_000,
      targetContextChars: 5_000,
    });
    // Two messages, both protected: over budget but nothing to safely drop.
    expect(kept.map((m) => m.id)).toEqual(['u-1', 'a-1']);
  });
});
