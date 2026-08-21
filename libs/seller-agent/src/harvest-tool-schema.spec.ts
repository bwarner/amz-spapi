import { describe, expect, it } from 'vitest';
import { asSchema } from 'ai';
import { createSellerAgent } from './seller-agent.js';
import type { AIProvider } from '@amz-spapi/ai-provider';

/**
 * The JSON Schema the harvest tools actually present to the model.
 *
 * Asserted against the CONVERTED schema rather than the Zod object, because
 * the failure this exists to catch lived entirely in the conversion. The Zod
 * read fine — `funnel: z.unknown()` — while what reached the model was a bare
 * `{ description }` with no type, and Zod treats unknown as optional so it
 * never appeared in `required`. The model was handed a parameter it was not
 * obliged to send and given no shape to build, `additionalProperties: false`
 * stripped anything mis-keyed, and save-harvest-funnel rejected every attempt
 * with "funnelId, name and nodes are undefined" — a tool apparently ignoring
 * its own argument.
 *
 * Nothing in the type system could see that. Only the generated schema can.
 */

const provider = {
  languageModel: () => ({} as never),
} as unknown as AIProvider;

/** The harvest tools only exist when harvestOps is supplied; never called. */
const harvestOps = {
  listFunnels: async () => [],
  proposeFunnel: async () => ({ skipped: [] }),
  saveFunnel: async () => ({ funnelId: 'f1' }),
  planHarvest: async () => ({}),
  applyGraduation: async () => ({}),
  dueNegatives: async () => ({ decisions: [] }),
  applyNegative: async () => ({ applied: true }),
} as never;

function toolSchema(name: string) {
  const tools = (
    createSellerAgent({
      provider,
      marketplaceId: 'ATVPDKIKX0DER',
      harvestOps,
    } as never) as unknown as {
      tools: Record<string, { inputSchema: unknown }>;
    }
  ).tools;

  return asSchema(tools[name].inputSchema as never).jsonSchema as {
    required?: string[];
    properties: Record<string, Record<string, unknown>>;
  };
}

describe('save-harvest-funnel', () => {
  it('REQUIRES the funnel, so the model cannot omit it', () => {
    const schema = toolSchema('save-harvest-funnel');
    expect(schema.required ?? []).toContain('funnel');
  });

  it('gives the funnel a type, so the model knows what to build', () => {
    // A property with only a description is not a contract. It is what let a
    // trimmed funnel be assembled by guesswork and rejected every time.
    const schema = toolSchema('save-harvest-funnel');
    expect(schema.properties['funnel'].type).toBe('object');
  });

  it('names the fields the store will insist on', () => {
    const funnel = toolSchema('save-harvest-funnel').properties['funnel'] as {
      required?: string[];
    };
    expect(funnel.required ?? []).toEqual(
      expect.arrayContaining(['funnelId', 'name', 'nodes', 'edges'])
    );
  });

  it('keeps the extra node fields propose returns', () => {
    // advertisedProductIds and productsReadAt are load-bearing downstream —
    // the product-scope gate reads them — and the model should not have to
    // restate what it was just handed.
    const nodes = (
      toolSchema('save-harvest-funnel').properties['funnel'] as {
        properties: { nodes: { items: { additionalProperties?: boolean } } };
      }
    ).properties.nodes.items;
    expect(nodes.additionalProperties).not.toBe(false);
  });
});

describe('propose-harvest-funnel', () => {
  it('offers productIds, so a funnel can be scoped to one product', () => {
    // Without it the proposal is the whole account — dozens of nodes and
    // hundreds of edges, which gets accepted wholesale or abandoned.
    const schema = toolSchema('propose-harvest-funnel');
    expect(schema.properties['productIds']).toBeDefined();
  });
});
