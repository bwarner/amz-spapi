#!/usr/bin/env npx tsx
/**
 * Give already-uploaded files back their names.
 *
 * Until the documents importer started passing `originalFileName` through,
 * every uploaded file was stored under `persistGeneratedFileAsset`'s generated
 * name — `generated-asset_9f3c….pdf`. The bytes and the classification were
 * kept; only the name a human recognises was dropped. That was invisible while
 * nothing listed these files, and is the first thing the Documents screen
 * shows.
 *
 * The names still exist, in whatever read the file afterwards, so this is a
 * one-way repair rather than a guess:
 *
 *   1. `reports_imports.fileName`, matched on `fileSha256` = the asset's own
 *      sha256. The strongest source and the widest: every spreadsheet that
 *      turned out to be an Amazon report has one.
 *   2. `purchases_documents.fileName`, matched on `assetId` — invoices and
 *      receipts that were extracted.
 *   3. `reports_box_labels.fileName`, matched on `assetId`.
 *
 * Anything none of them covers keeps its generated name, which is honest: we
 * genuinely do not know what that file was called.
 *
 * A renamed asset also stops being eligible for asset GC, which only ever
 * collects `generated-` names — correct, since these are uploads.
 *
 * Usage:
 *   npx tsx --env-file=apps/web/.env.local scripts/backfill-asset-names.ts --env dev
 *   … --env dev --apply      (without --apply it only reports)
 */

import { B, lit, n1ql, q, requireConfig, requireEnv } from './couchbase-schema';

type Row = {
  id: string;
  assetId: string;
  originalFileName: string;
  sha256?: string;
};

async function main() {
  requireConfig();
  const args = process.argv.slice(2);
  const env = requireEnv(args[args.indexOf('--env') + 1]);
  const apply = args.includes('--apply');

  const K = (collection: string) => `${B()}.${q(env)}.${q(collection)}`;

  const assets = await n1ql<Row>(
    `SELECT META(d).id AS id, d.assetId, d.originalFileName,
            d.hashes.sha256 AS sha256
       FROM ${K('media_assets')} AS d
      WHERE d.createdForFeature = 'documents'
        AND d.originalFileName LIKE 'generated-%'`,
    true
  );

  console.log(`${assets.length} unnamed document assets in ${env}`);
  if (!assets.length) return;

  // One read per source rather than one per asset: these are small collections
  // and a per-asset lookup would be hundreds of round trips.
  const [imports, documents, labels] = await Promise.all([
    n1ql<{ sha: string; fileName: string }>(
      `SELECT d.fileSha256 AS sha, d.fileName
         FROM ${K('reports_imports')} AS d
        WHERE d.fileSha256 IS NOT MISSING AND d.fileName IS NOT MISSING`,
      true
    ),
    n1ql<{ assetId: string; fileName: string }>(
      `SELECT d.assetId, d.fileName FROM ${K('purchases_documents')} AS d
        WHERE d.fileName IS NOT MISSING`,
      true
    ),
    n1ql<{ assetId: string; fileName: string }>(
      `SELECT DISTINCT d.assetId, d.fileName FROM ${K(
        'reports_box_labels'
      )} AS d
        WHERE d.fileName IS NOT MISSING AND d.assetId IS NOT MISSING`,
      true
    ),
  ]);

  const bySha = new Map(imports.map((row) => [row.sha, row.fileName]));
  const byAsset = new Map<string, string>();
  // Box labels first so an extracted document's name wins on a collision — it
  // is the more specific record of the two.
  for (const row of labels) byAsset.set(row.assetId, row.fileName);
  for (const row of documents) byAsset.set(row.assetId, row.fileName);

  const renames: Array<{ id: string; from: string; to: string; via: string }> =
    [];
  for (const asset of assets) {
    const fromImport = asset.sha256 ? bySha.get(asset.sha256) : undefined;
    const fromAsset = byAsset.get(asset.assetId);
    const name = fromImport ?? fromAsset;
    if (!name) continue;
    renames.push({
      id: asset.id,
      from: asset.originalFileName,
      to: name,
      via: fromImport ? 'report import' : 'document/label',
    });
  }

  for (const rename of renames) {
    console.log(`  ${rename.to}   (via ${rename.via})`);
  }
  console.log(
    `\n${renames.length} of ${assets.length} can be named; ` +
      `${assets.length - renames.length} have no record of their name.`
  );

  if (!apply) {
    console.log('\nRe-run with --apply to write.\n');
    return;
  }

  for (const rename of renames) {
    // Only originalFileName changes. The S3 key is built from the name at
    // upload time and is NOT rewritten: the object is found by key, the key is
    // stored on the asset, and renaming the object would be a copy-and-delete
    // that risks the bytes to fix a label.
    await n1ql(
      `UPDATE ${K('media_assets')} AS d
          SET d.originalFileName = ${lit(rename.to)},
              d.updatedAt = ${Date.now()}
        WHERE META(d).id = ${lit(rename.id)}`
    );
  }
  console.log(`\nrenamed ${renames.length}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
