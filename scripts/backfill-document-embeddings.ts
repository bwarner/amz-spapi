#!/usr/bin/env npx tsx
/**
 * Give already-stored documents the vector that makes them findable.
 *
 * Embedding happens on import, so this is for the corpus that predates it —
 * and for the day the embedding model changes, which is the case that actually
 * matters. A stored vector records the model that produced it, so "documents
 * embedded by a model we no longer use" is a query rather than a guess, and
 * re-embedding is targeted rather than a full rebuild.
 *
 * Shares `documentSearchText` with the app rather than restating it. What text
 * stands for a document decides what the vector means, so two definitions
 * would put two different meanings into one index — searchable by one route
 * and not the other, with nothing to indicate which.
 *
 * Env: CB_DATA_API_URL, CB_USERNAME, CB_PASSWORD, CB_BUCKET, AI_GATEWAY_API_KEY
 *   npx tsx --env-file=apps/web/.env.local --env-file=apps/web/.env \
 *     scripts/backfill-document-embeddings.ts --env dev
 *   … --env dev --apply          write them
 *   … --env dev --apply --all    re-embed everything, not just what is missing
 */

import { createAIProvider } from '@amz-spapi/ai-provider';
import { embedMany } from 'ai';
import { documentSearchText, EMBEDDING_DIMENSIONS } from '@amz-spapi/sp-cache';
import { StoredDocument } from '@amz-spapi/sp-cache';
import { B, lit, n1ql, q, requireConfig, requireEnv } from './couchbase-schema';

/** One request per this many documents. */
const BATCH = 64;

type Candidate = Pick<
  StoredDocument,
  'documentId' | 'role' | 'recognition' | 'extracted' | 'fileName'
> & { embeddingModelId?: string };

async function main() {
  requireConfig();
  const args = process.argv.slice(2);
  const env = requireEnv(args[args.indexOf('--env') + 1]);
  const apply = args.includes('--apply');
  const all = args.includes('--all');

  const provider = createAIProvider();
  const model = provider.embeddingModel?.();
  const modelId = provider.embeddingModelId?.();
  if (!model || !modelId) {
    console.error('No embedding model configured. Set AI_GATEWAY_API_KEY.');
    process.exit(1);
  }

  const K = `${B()}.${q(env)}.${q('purchases_documents')}`;

  // Everything, or only what this model has not already embedded. The model
  // clause is what makes a model change a targeted re-embed: documents carrying
  // an older model's id come back, documents already on this one do not.
  const where = all
    ? 'TRUE'
    : `(d.embedding IS MISSING OR d.embeddingModelId != ${lit(modelId)})`;

  // `role` is a RESERVED WORD in N1QL — unquoted it fails with "syntax error
  // ... at: role (reserved word)", the same trap `rows` sets in report-store.
  const documents = await n1ql<Candidate>(
    `SELECT d.documentId, d.\`role\` AS \`role\`, d.recognition, d.extracted,
            d.fileName, d.embeddingModelId
       FROM ${K} AS d
      WHERE ${where}`,
    true
  );

  console.log(`model ${modelId} · ${EMBEDDING_DIMENSIONS}-wide`);
  console.log(
    `${documents.length} document(s) ${
      all ? 'to re-embed' : 'without a current embedding'
    } in ${env}`
  );
  if (!documents.length) return;

  // Text first, so a document with nothing to embed is reported rather than
  // sent to the model as an empty string and stored as a meaningless vector.
  const prepared = documents.map((document) => ({
    document,
    text: documentSearchText(document).trim(),
  }));
  const empty = prepared.filter((entry) => !entry.text);
  const embeddable = prepared.filter((entry) => entry.text);

  if (empty.length) {
    console.log(
      `  ${empty.length} have no text to embed (no vendor, references or ` +
        `line descriptions) — skipped`
    );
  }

  if (!apply) {
    for (const entry of embeddable.slice(0, 10)) {
      console.log(`  ${entry.text.slice(0, 90)}`);
    }
    if (embeddable.length > 10) {
      console.log(`  … and ${embeddable.length - 10} more`);
    }
    console.log('\nRe-run with --apply to embed and write.\n');
    return;
  }

  let written = 0;
  for (let start = 0; start < embeddable.length; start += BATCH) {
    const slice = embeddable.slice(start, start + BATCH);
    const { embeddings } = await embedMany({
      model,
      values: slice.map((entry) => entry.text),
    });

    for (const [index, entry] of slice.entries()) {
      const embedding = embeddings[index];
      if (!embedding) continue;
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        // Storing a wrong-width vector would fill the collection with rows the
        // Search index rejects at query time, far from this cause.
        console.error(
          `  width ${embedding.length} != ${EMBEDDING_DIMENSIONS} — stopping`
        );
        process.exit(1);
      }

      await n1ql(
        `UPDATE ${K} AS d
            SET d.searchText = ${lit(entry.text)},
                d.embedding = ${JSON.stringify(embedding)},
                d.embeddingModelId = ${lit(modelId)},
                d.updatedAt = ${Date.now()}
          WHERE d.documentId = ${lit(entry.document.documentId)}`
      );
      written += 1;
    }
    console.log(
      `  embedded ${Math.min(start + BATCH, embeddable.length)}/${
        embeddable.length
      }`
    );
  }

  console.log(`\nwrote ${written} embedding(s)\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
