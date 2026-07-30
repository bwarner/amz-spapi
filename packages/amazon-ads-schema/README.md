# amazon-ads-schema

Official Amazon Ads API OpenAPI 3.0 documents, checked in as JSON.

**This package contains no TypeScript.** It is a set of assets, not a module —
there is no entry point to import, and it has no build or typecheck target. The
types generated _from_ these documents live in `amazon-ads-generated`.

```
src/assets/ManagerAccount_prod_3p.json
src/assets/SponsoredProducts_prod_3p.json
```

## Consuming it

One document, by name:

```ts
import schema from '@farvisionllc/amazon-ads-schema/assets/SponsoredProducts_prod_3p.json';
```

All of them — resolve the package, then read the directory, so that this package
stays the single owner of which documents exist:

```ts
const manifest = createRequire(from).resolve(
  '@farvisionllc/amazon-ads-schema/package.json'
);
const assetsDir = path.join(path.dirname(manifest), 'src', 'assets');
```

That is what `amazon-ads-generated` does. Do not reach for a relative
`../amazon-ads-schema/src` path: it depends on the caller's working directory and
breaks silently if either package moves.

## Adding a schema

Drop the JSON in `src/assets/`, then regenerate the types:

```bash
npx nx run amazon-ads-generated:generate
```

The generator enumerates this directory, so there is no list to update
alongside it.
