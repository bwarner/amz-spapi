#! /usr/bin/env node

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
export * from './lib/ManagerAccount_prod_3p.js';

/**
 * Locate the schema package through Node's own resolution, rather than by
 * guessing at a sibling directory: `../amazon-ads-schema/src` broke if either
 * package moved, and said nothing about a dependency.
 *
 * Resolution starts from the invocation directory because of two constraints.
 * The dependency is declared by this package, so pnpm links it into
 * `packages/amazon-ads-generated/node_modules` and nowhere else; and this file
 * runs as compiled JS out of `dist/`, outside that tree, so `import.meta.url`
 * cannot see the link. The `generate` target pins `cwd` to this project's root,
 * which is the contract relied on here.
 */
function schemaAssetsDir(): string {
  const from = pathToFileURL(path.join(process.cwd(), 'package.json'));
  try {
    const manifest = createRequire(from).resolve(
      '@farvisionllc/amazon-ads-schema/package.json'
    );
    return path.join(path.dirname(manifest), 'src', 'assets');
  } catch {
    throw new Error(
      `Could not resolve @farvisionllc/amazon-ads-schema from ${process.cwd()}. ` +
        'Run this through `nx run amazon-ads-generated:generate`, which sets the ' +
        'working directory to this project root.'
    );
  }
}

/**
 * The schema package owns which documents exist; read them rather than keeping
 * a second copy of the list here that has to be edited in step.
 */
function schemaFiles(assetsDir: string): string[] {
  return fs
    .readdirSync(assetsDir)
    .filter((file) => file.endsWith('.json'))
    .sort();
}

program
  .command('generate')
  .description('Generate the Amazon Ads schema')
  .action(async () => {
    const assetsDir = schemaAssetsDir();
    const schemas = schemaFiles(assetsDir);

    if (schemas.length === 0) {
      throw new Error(`No schema documents found in ${assetsDir}`);
    }

    for (const schema of schemas) {
      const schemaPath = path.join(assetsDir, schema);
      console.log(`schemaPath: ${schemaPath}`);
      await generateSchema(schemaPath);
    }
  });

program.parse(process.argv);

async function generateSchema(filePath: string) {
  console.log('Generating the Amazon Ads schema');
  const ast = await openapiTS(`file://${filePath}`, {
    exportType: true,
    alphabetize: true,
    arrayLength: true,
    emptyObjectsUnknown: true,
    defaultNonNullable: true,
    excludeDeprecated: true,
  });
  const generated = astToString(ast);
  const outputPath = path.resolve(
    'src',
    'lib',
    filePath.split('/').pop()?.split('.').shift() + '.ts'
  );
  console.log(`outputPath: ${outputPath}`);
  fs.writeFileSync(outputPath, generated);
}
