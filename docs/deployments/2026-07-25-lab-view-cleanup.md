# Formula and Strategy Lab view cleanup deployment receipt

- Deployed source commit: `a09bca2`
- Verified at: `2026-07-25T04:52:48Z`
- Server: Server2 (`/Users/admin/jester-analytics`)
- Recovery point: `/Users/admin/jester-releases/20260725T044932Z`
- Recovery source hash:
  `sha256:41e58cce07f1782809530636a96dfd372937a125153f3172628e2b9af20d5faf`
- Recovery database hash:
  `sha256:214061d0b6090de7614ab339e6b1d91a89a1abada695a579fccea5e94417230d`
- Nginx image:
  `sha256:b1938b2415ea4fbdde7eb77922e72af398462289ce82133f066c4948ecce3135`

## Changes

- Removed the Albert legacy formula-anatomy presentation from Formula Lab.
- Preserved the immutable imported formula, historical replay, evaluator, provenance, and Knowledge
  records.
- Replaced Strategy Registry shorthand with descriptive sortable column titles for the strategy
  rule, family, timeframe/scope, gate state, eligible control-market denominator, candidate versus
  paired-graded counts, independent clusters, control-relative edge and interval, and cohort start.
- Added precise hover descriptions for each registry column.

## Verification

- Ten focused source and research-contract tests passed.
- Web TypeScript validation passed.
- The production web build passed.
- The deployed Formula Lab no longer contains the anatomy block and still renders the historical
  BTC replay.
- The deployed Strategy Registry renders all descriptive column titles.
- No browser console errors were observed.
- API, Postgres, and Redis were healthy; worker and nginx were running.

## Research disposition

This is a presentation-only change. It does not alter the imported formula, strategy rules,
paper decisions, cohort boundaries, frozen 57-hypothesis family, verdict gate, or execution
prohibition.
