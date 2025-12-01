#! /usr/bin/env node

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import openapiTS, { astToString } from 'openapi-typescript';
import SwaggerConverter from 'swagger2openapi';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Export generated schemas - will be available after running 'generate' command
// export * from './lib/catalogItems_2022-04-01.js';
// export * from './lib/ordersV0.js';

// List of SP-API schemas to generate (Swagger 2.0 format)
const schemas = [
  'catalogItems_2022-04-01.json',
  'ordersV0.json',
  // Add more SP-API schemas here as needed:
  // 'listings_2021-08-01.json',
  // etc.
];

program
  .command('generate')
  .description('Generate TypeScript types from SP-API Swagger 2.0 schemas')
  .action(async () => {
    console.log('🚀 Generating SP-API TypeScript types...\n');
    for (const schema of schemas) {
      // Resolve from workspace root
      const workspaceRoot = path.resolve(__dirname, '../../../../');
      const schemaPath = path.join(
        workspaceRoot,
        'packages/amazon-sp-schema/src/assets',
        schema
      );
      console.log(`📄 Processing: ${schema}`);
      console.log(`   Schema path: ${schemaPath}`);
      await generateSchema(schemaPath);
      console.log(`✅ Generated types for ${schema}\n`);
    }
    console.log('🎉 All SP-API types generated successfully!');
  });

program.parse(process.argv);

async function generateSchema(filePath: string) {
  console.log('   Step 1: Reading Swagger 2.0 schema...');
  const swaggerContent = fs.readFileSync(filePath, 'utf8');
  const swaggerSchema = JSON.parse(swaggerContent);

  console.log('   Step 2: Converting Swagger 2.0 → OpenAPI 3.0...');
  // Convert Swagger 2.0 to OpenAPI 3.0
  const conversionResult = await SwaggerConverter.convertObj(swaggerSchema, {
    patch: true,
    warnOnly: true,
  });

  // Serialize and re-parse to avoid type incompatibilities
  const openApiSchema = JSON.parse(JSON.stringify(conversionResult.openapi));

  console.log('   Step 3: Generating TypeScript types from OpenAPI 3.0...');
  // Generate TypeScript types using openapi-typescript v7 API
  const ast = await openapiTS(openApiSchema, {
    exportType: true,
    alphabetize: true,
    arrayLength: true,
    emptyObjectsUnknown: true,
    defaultNonNullable: true,
    excludeDeprecated: true,
  });

  const generated = astToString(ast);

  // Output to the lib directory
  const workspaceRoot = path.resolve(__dirname, '../../../../');
  const outputPath = path.join(
    workspaceRoot,
    'packages/amazon-sp-generated/src/lib',
    path.basename(filePath).replace('.json', '.ts')
  );

  console.log(`   Output path: ${outputPath}`);
  fs.writeFileSync(outputPath, generated);
}
