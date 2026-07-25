# Authoritative taker-flow distribution preregistration receipt

- Deployed commit: `10f70d737a4882863f08a246adeedfa4d1c484ea`
- Verified at: `2026-07-25T14:04:14Z`
- Server: Server2 (`/Users/admin/jester-analytics`)
- Recovery point: `/Users/admin/jester-releases/20260725T140048Z`
- Recovery source hash:
  `sha256:fba4d5c079e7e4958a5e380452a6d814bc1e7baf6b8f00d598ea8c0a7ccd0550`
- Recovery database hash:
  `sha256:8b86de3121d3d6a2e5ca72cdcaa9dc27cd9e5c143e5419cffaf04a8bfacb51fe`
- API image:
  `sha256:2b2783c8029bb8abe5c61158972d454171dc1b8d90d7f7c6b8b0fc080e6aa0a9`
- Worker image:
  `sha256:82bca48c348520c4fa11ba49e6557fda5b805e9404f657a54d116613038ca008`
- Migration ledger: 44 applied migrations; this release added no migration

## Frozen handoff

This release preregisters the missing outcome-free handoff from
`polymarket-authoritative-taker-flow-tape-v1` into a later, independently frozen feature artifact.
It adds:

- `updown-authoritative-taker-flow-distribution-audit-v1`.
- `updown-authoritative-taker-flow-feature-cut-freeze-plan-v1`.
- Future artifact version `updown-authoritative-taker-flow-feature-cuts-v1`.
- A protected read-only status/distribution query.
- A readiness-gated, manually invoked freeze script that cannot run until the inherited
  authoritative tape gate and every distribution-support floor pass.

The exact universe is six assets independently at 5m and 15m: twelve required buckets with at
least 25 distinct chain-verified markets per bucket. The exact quantiles are p05, p25, p50, p75,
and p95 for eight unsigned coordinates:

- Log chain notional.
- Log chain shares.
- Absolute chain-price distance from 0.50.
- Seconds from immutable window start.
- Public-stream ingestion latency.
- Chain confirmations.
- Absolute source/receipt price error.
- Absolute source/receipt share error.

The query selects only verified rows. It does not select or group by token identity, reported side,
decoded chain side, outcome-token mapping, market resolution, paper activity, grades, returns,
P&L, accounts, positions, wallets, credentials, or orders.

## Preregistration proof

Both metadata scripts completed once and then returned `already_registered` on an immediate rerun.
The database contains:

- One active research article for the distribution contract, with its exact marker.
- One active research article for the feature-cut plan, with its exact marker.
- Exactly one `kb.preregistration.record` audit row for each article.
- Zero frozen `updown-authoritative-taker-flow-feature-cuts-v1` artifacts.

At deployment time the inherited seven-day tape gate remained false. A direct service check
returned:

- `inheritedTapeReady: false`.
- `readyForCutFreeze: false`.
- `reportLocked: true`.
- `frozen: false`.

Therefore no feature-value query ran, no quantile was observed, and no feature cut was frozen.

## Verification

- 474 API tests passed with zero failures.
- API and web TypeScript checks passed.
- The production web build passed.
- The deployed source checksum matched the committed source.
- The authoritative trade-flow source audit passed every boundary, paper-only, outcome-blind,
  directionless, mapping, schema, source-read, and read-only RPC invariant.
- The audit observed zero pre-boundary rows, zero mapping violations, zero prohibited columns, and
  zero prohibited source reads.
- API and worker were recreated from the deployed commit and remained running with zero restarts.
- API health and the public health endpoint both returned healthy/`ok`.

## Safety disposition

The release creates no collector, subscription, table, polling loop, strategy, paper insertion,
token or direction rule, threshold, ask cap, order route, signing capability, allocation, wallet
access, or fund-moving path. It changes no existing strategy identity, decision, cohort boundary,
paper result, or verdict criterion.

When the inherited tape eventually passes seven days, the distribution is still only descriptive.
The one-time cut artifact must be frozen from all twelve complete buckets, is SHA-256 hashed and
schema-validated, and embeds a future strategy boundary at least 30 minutes later on a 15-minute
grid. Any later directional rule remains a separate preregistration with independent 5m/15m paper
identities and the unchanged verdict gate.
