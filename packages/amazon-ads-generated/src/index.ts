#! /usr/bin/env node

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import openapiTS, { astToString } from 'openapi-typescript';

program
  .command('generate')
  .description('Generate the Amazon Ads schema')
  .action(async () => {
    const schemaPath = path.resolve(
      '../amazon-ads-schema/src',
      'assets',
      'SponsoredProducts_prod_3p.json'
    );
    console.log(`schemaPath: ${schemaPath}`);
    await generateSchema(schemaPath);
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
    'schema',
    'SponsoredProducts_prod_3p.ts'
  );
  console.log(`outputPath: ${outputPath}`);
  fs.writeFileSync(outputPath, generated);
}
