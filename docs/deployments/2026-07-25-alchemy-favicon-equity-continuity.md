# Alchemy favicon and equity-continuity deployment receipt

- Deployed source commit: `91e5b79`
- Verified at: `2026-07-25T07:12:19Z`
- Server: Server2 (`/Users/admin/jester-analytics`)
- Recovery point: `/Users/admin/jester-releases/20260725T070817Z`
- Recovery source hash:
  `sha256:096b3296c790482903f03468921cee3b254227839edee7526a354223b0e7d18b`
- Recovery database hash:
  `sha256:482c9e77ddd4f4fd8c0d14b41da231ec5f6f7b57556c14f7dd1537ffafb2126a`
- Nginx image:
  `sha256:f8ac5602926778f239f9ceb3b337e507134828711aec8758d7bed46755c31028`

## Changes

- Replaced the generic browser-tab mark with a compact Alchemy philosopher's-stone glyph.
- Added a cache-busted favicon URL and a matching dark browser theme color.
- Extended each rendered paper-equity curve horizontally from its final actual grade to the
  chart's common right edge, making an abstaining strategy read as flat instead of disabled.
- Preserved the source equity series and its timestamps; the scrubber dot remains attached to the
  latest actual grade rather than the visual extension.

## Verification

- Seven focused paper-strategy source-contract tests passed.
- Web TypeScript validation passed.
- The production web build passed.
- The deployed favicon's SHA-256 hash matches the committed source.
- The public document advertises `/favicon.svg?v=alchemy-1`, theme color `#09090b`, and title
  `Alchemy`.
- The deployed Paper Floor includes the flat-tail explanation.
- No browser console errors were observed.
- API, Postgres, and Redis remained healthy; worker and nginx remained running.

## Research disposition

This release changes branding and chart presentation only. It does not alter paper decisions,
strategy rules, equity values, cohort boundaries, the frozen 57-hypothesis family, the verdict
gate, or the prohibition on live execution.
