# Brand assets

Sellavant's logo is hosted by the web app out of `apps/web/public/brand/`, so it
ships and versions with a normal deploy. There is no separate bucket, CDN or
brand service to keep in sync.

**Canonical base URL: `https://www.sellavant.com/brand/`**

Use the `www` host. The apex answers `308` to `www`, and partner/OAuth consoles
frequently fetch a logo without following redirects — they will record a
failure, not a logo.

`https://www.sellavant.com/brand/brand.json` is the machine-readable manifest of
everything below.

## What to hand each consumer

### Partner / OAuth consoles

Square PNG, because these consoles reject SVG.

| Console                             | Asset                                                    |
| ----------------------------------- | -------------------------------------------------------- |
| Amazon SP-API / Ads app listing     | `https://www.sellavant.com/brand/sellavant-icon-512.png` |
| Auth0 Universal Login               | `https://www.sellavant.com/brand/sellavant-icon-150.png` |
| Anything asking for a mid-size tile | `https://www.sellavant.com/brand/sellavant-icon-256.png` |

The tile is self-contained navy with its own rounded corners, so it reads on a
light or a dark console chrome without a variant swap.

### Transactional email

Gmail and Outlook do not render SVG at all. Always use PNG, always set an
explicit `width` and `height` (Outlook sizes unstyled images wrong), and serve
the 2x asset displayed at 1x so it stays sharp on retina.

```html
<img
  src="https://www.sellavant.com/brand/sellavant-logo-horizontal-600.png"
  width="300"
  height="72"
  alt="Sellavant"
  style="display:block;border:0;outline:none;text-decoration:none;"
/>
```

For a template that renders on a dark card — or for clients that force dark mode
and would otherwise put navy type on near-black — swap in the on-dark lockup:

```
https://www.sellavant.com/brand/sellavant-logo-horizontal-on-dark-600.png
```

## The full set

Horizontal lockup, `300:72`. PNGs at `300` (1x), `600` (2x), `900` (3x).

- `sellavant-logo-horizontal.svg` · `-300.png` · `-600.png` · `-900.png`
- `sellavant-logo-horizontal-on-dark.svg` · `-on-dark-300.png` · `-on-dark-600.png` · `-on-dark-900.png`

Compact lockup, `283:72` — Inter's text optical cut and a trimmed box, for
rendering around 100px wide. Above that, use the horizontal lockup.

- `sellavant-logo-small.svg` · `sellavant-logo-small-on-dark.svg`

Square icon, `1:1`.

- `sellavant-icon.svg` · `sellavant-icon-inverse.svg` (cream keyline, for dark)
- `sellavant-icon-512.png` · `-256.png` · `-150.png`

Other.

- `sellavant-mark.svg` — trendline and bars alone, no tile
- `sellavant-favicon.svg` — simplified, no trendline, legible at 16–32px

Clear space: at least 0.5x the lockup height on all sides.

## The wordmark is outlined, on purpose

The wordmark is Inter ExtraBold **converted to paths**. It is not live `<text>`,
and it must not be turned back into live text.

The earlier version declared `font-family="Inter, Arial, Helvetica"` and shipped
no font. Inter is not loaded anywhere in the web app — the app uses Geist — and
it is certainly not installed on a partner's rasterizer or in an email pipeline.
Every one of those renderers silently substituted a fallback face, so the logo
was a different shape depending on who drew it. Outlining removes the question.

The practical consequence: **nothing at build or request time needs a font.**
`render-pngs.mjs` reads only the committed SVGs, so it produces identical output
on any machine and in CI.

## Regenerating

Rasterize the PNGs from the committed SVGs. No font required — run this after
any SVG change:

```bash
node scripts/brand/render-pngs.mjs
```

Re-outline the wordmark. Rare — only when the wordmark itself changes. Requires
Inter Variable (<https://rsms.me/inter/>, OFL-1.1) installed locally; the script
lists the paths it checks:

```bash
node scripts/brand/outline-wordmark.mjs
```

`outline-wordmark.mjs` writes the four lockup SVGs, so follow it with
`render-pngs.mjs`.

## Serving

`apps/web/next.config.mjs` sets, for `/brand/:path*`:

- `Cache-Control: public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000`
  — one day in browsers, a week at the CDN. Next serves `public/` with
  `max-age=0, must-revalidate` by default, which turns every Gmail image-proxy
  fetch into an origin hit.
- `Access-Control-Allow-Origin: *` — public brand assets, and cross-origin
  `fetch()`/canvas reads otherwise fail.

Deliberately not `immutable`: the URLs are stable but their bytes are
replaceable, and a day of browser cache is the most worth committing to.
