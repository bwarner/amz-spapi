#! /usr/bin/env node

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import openapiTS, { astToString } from 'openapi-typescript';
export * from './lib/ManagerAccount_prod_3p.js';

const schemas = [
  'ManagerAccount_prod_3p.json',
  'SponsoredProducts_prod_3p.json',
];
program
  .command('generate')
  .description('Generate the Amazon Ads schema')
  .action(async () => {
    for (const schema of schemas) {
      const schemaPath = path.resolve(
        '../amazon-ads-schema/src',
        'assets',
        schema
      );
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
