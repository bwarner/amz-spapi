# amazon-sp-generated

TypeScript type definitions generated from Amazon SP-API schemas.

## Overview

This package automatically generates TypeScript types from Amazon SP-API Swagger 2.0 specifications. Since SP-API uses Swagger 2.0 and we want to use modern tooling (openapi-typescript v7.8.0), we:

1. **Convert** Swagger 2.0 → OpenAPI 3.0 using `swagger2openapi`
2. **Generate** TypeScript types using `openapi-typescript` v7.8.0

This approach allows us to:
- ✅ Use the same `openapi-typescript` version as `amazon-ads-generated` (v7.8.0)
- ✅ Avoid version conflicts in the monorepo
- ✅ Leverage modern OpenAPI 3.0 tooling
- ✅ Maintain consistency across all API type generation

## Project Structure

```
packages/
├── amazon-sp-schema/          # Source Swagger 2.0 schemas
│   └── src/assets/
│       └── *.json            # SP-API Swagger 2.0 files
└── amazon-sp-generated/       # Generated TypeScript types
    └── src/
        ├── index.ts          # Generator CLI script
        └── lib/
            └── *.ts          # Generated type files
```

## Usage

### Generate Types

```bash
# Using Nx (recommended)
npx nx run amazon-sp-generated:generate

# Or manually
npm run build
node dist/packages/amazon-sp-generated/src/index.js generate
```

### Add New SP-API Schemas

1. Download the Swagger 2.0 JSON from [Amazon SP-API Models](https://github.com/amzn/selling-partner-api-models)
2. Place it in `packages/amazon-sp-schema/src/assets/`
3. Add the filename to the `schemas` array in [src/index.ts](src/index.ts#L17)
4. Run `npx nx run amazon-sp-generated:generate`
5. Export the generated types in [src/index.ts](src/index.ts#L14)

### Use Generated Types

```typescript
import type { paths, components } from '@amz-spapi/amazon-sp-generated';

// Use path types
type CatalogItemsResponse = paths['/catalog/2022-04-01/items']['get']['responses']['200']['content']['application/json'];

// Use component types
type Item = components['schemas']['Item'];
```

## How It Works

The generator script performs three steps for each schema:

1. **Read** the Swagger 2.0 JSON file from `amazon-sp-schema`
2. **Convert** Swagger 2.0 → OpenAPI 3.0 using `swagger2openapi.convertObj()`
3. **Generate** TypeScript types using `openapiTS()` from `openapi-typescript` v7

The conversion happens at build time, so there's no runtime overhead.

## Nx Integration

The package is integrated with Nx:

- **Build**: Compiles the generator script
- **Generate**: Runs the generator (depends on build)
- **Caching**: Nx caches outputs based on input schemas
- **Inputs**: Watches `packages/amazon-sp-schema/src/assets/**/*.json`
- **Outputs**: Generates to `src/lib/**/*.ts`

## Dependencies

- `openapi-typescript@^7.8.0` - Type generation
- `swagger2openapi@^7.0.8` - Swagger 2.0 → OpenAPI 3.0 conversion
- `commander@^12.1.0` - CLI framework
- `@types/swagger2openapi` - TypeScript types for swagger2openapi

## Comparison with amazon-ads-generated

Both packages follow the same pattern:

| Feature | amazon-ads-generated | amazon-sp-generated |
|---------|---------------------|---------------------|
| Input Format | OpenAPI 3.0.1 | Swagger 2.0 |
| Conversion | None needed | swagger2openapi |
| Type Generator | openapi-typescript v7.8.0 | openapi-typescript v7.8.0 |
| Nx Integration | ✅ | ✅ |
| Output Format | TypeScript types | TypeScript types |

## References

- [Amazon SP-API Models](https://github.com/amzn/selling-partner-api-models)
- [openapi-typescript Documentation](https://openapi-ts.dev/)
- [swagger2openapi](https://github.com/Mermade/oas-kit/tree/main/packages/swagger2openapi)
