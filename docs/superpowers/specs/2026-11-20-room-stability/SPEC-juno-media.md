# Spec: juno-media

See [initiative](README.md) for shared commands and delivery gates.

## Objective and boundaries

Reduce initial game-media transfer and decoding without sacrificing visible
quality. Start with rendered dimensions, device pixel ratio, request counts and
transfer bytes in the real lobby/table. The game already uses WebP for cards;
changing the extension or total inventory weight alone is not a win.

## Behavior and tests

- Compare smaller WebP variants for assets drawn small. Keep the supplied
  high-resolution art available when needed; use native responsive image
  selection where appropriate. Do not change card aspect ratio, readable
  symbols, alpha, animations, theme, music or cues. Preserve the source
  provenance and update the shipped asset manifest for any derivative.
- Load only assets that serve the displayed state. Do not preload the full
  deck or patch the global cache/service worker policy. Never emit a hidden
  face's URL through `src`, `srcset`, preload, or another DOM attribute.
- Measure cold and warm entry to a fixed populated table from the same build
  fixture. Aim for at least 20% fewer transferred image bytes in the targeted
  cold small-card view, not 20% off an unrelated directory total. Verify
  desktop/mobile screenshots at typical and high pixel density, local URLs
  and correct full-size rendering. Keep original-only delivery where a
  variant cannot meet the fidelity or transfer target.
- Run `pnpm --filter @veyvox/web exec vitest run src/components/games`.
  Include manifest/URL coverage and hidden-card tests; verify the production
  build serves every referenced asset.
