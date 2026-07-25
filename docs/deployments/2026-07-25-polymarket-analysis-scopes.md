# Polymarket analysis scopes deployment receipt

- Product version: `0.1.0`
- Deployed source commit: `c43471c`
- Deployed at: `2026-07-25T00:47:01Z`
- Server: Server2 (`/Users/admin/jester-analytics`)
- Recovery point: `/Users/admin/jester-releases/20260725T004053Z`
- Source archive SHA-256: `f6220070e12061142c1be3dc70381b6a283d3963e0df246cd4b3110a60ff6fad`
- Database dump SHA-256: `bc5ee70146acc2434adf83c3e9a0037c28b38807a5253d2c7114d4c2dbd8cbce`
- API image: `sha256:267b6a4cdb03cd1c0959e32dcc3806d79b9010b1db9fa7ad07d37900e6172379`
- Worker image: `sha256:5012e680b48920050870b396566bb54cfb65d7d06133ad44e4dbe99db34d0c6b`
- Nginx image: `sha256:095f38ea42bd95d1b090449cc84caa3fb0fe187f8434d0735cc2a3bac77031c0`

## Changes

- Added `All`, `5m`, and `15m` card scopes to Paper Floor.
- Recomputed card totals, ranking, open exposure, daily results, stress results, last-decision
  timing, and bucket rows from the selected timeframe rather than merely hiding bucket rows.
- Added shareable, persistent multi-asset filters to strategy detail pages.
- Applied the selected asset population consistently to summary metrics, daily ledger, asset
  buckets, segmentation, and recent paper decisions.
- Added split-registry state messaging that distinguishes a pre-boundary expected-zero state from
  a post-boundary operational collection warning.
- Preserved the frozen pooled and split verdict populations; all new controls are diagnostic only.

## Pre-deployment gates

- 421 API service tests passed.
- API and web TypeScript checks passed.
- The web production build passed.
- Focused source-contract tests for asset filtering, card-scope recomputation, and split-registry
  status passed.
- `git diff --check` passed.
- The Compose configuration validated.
- A checksummed source archive and gzip-validated database dump were created before sync.
- The source sync contained only the ten intended files and performed no deletes.

## Post-deployment verification

- API health returned `ok`.
- API, worker, nginx, Postgres, and Redis were running; health-enabled services were healthy.
- Host load was `1.60 / 1.72 / 1.73`.
- The live split registry reported active post-boundary collection in 57 of 57 frozen
  strategy-by-timeframe cohorts.
- Selecting `5m` on Paper Floor produced 5m-only totals, ranking, and bucket rows; selecting `15m`
  produced independently recomputed 15m results.
- A direct `SOL` strategy-detail slice changed every diagnostic surface to SOL-only observations
  while leaving the familywise verdict and execution lock unchanged.
- No browser console errors were observed.

## Research disposition

This deployment changes read-only diagnostic analysis and presentation only. It does not mutate
registered rules, alter frozen verdict inputs, enable authentication/signing/submission, create an
order route, or authorize live execution.
