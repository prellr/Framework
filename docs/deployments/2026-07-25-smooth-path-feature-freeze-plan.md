# Smooth Path outcome-blind feature-freeze plan

Date: 2026-07-25

## Purpose

Smooth Path is collecting causal, direction-invariant path measurements on the live six-asset
Polymarket 5-minute tape, but neither Smooth Path paper strategy has produced a book-qualified
decision. The observed funnel is informative about system health, not evidence that a direction or
threshold has an edge.

Before any outcomes are inspected for discovery, this deployment preregisters how the path-feature
distributions will be frozen. It does not create, select, register, or run another strategy.

## Readiness at deployment

The prospective boundary is `2026-07-24T03:00:00.000Z`. At deployment, both metric versions had
complete coverage but had not spanned the required three days:

| Metric version | Pair-row range | Complete rows | Complete coverage | Elapsed span |
| --- | ---: | ---: | ---: | ---: |
| `updown-smooth-path-displacement-v1` | 494–498 | 2,980 | 100% | 1.76 days |
| `updown-smooth-path-causal-displacement-v2` | 495–498 | 2,981 | 100% | 1.76 days |

The pre-existing quality contract remains authoritative. A freeze is unavailable until both
versions independently satisfy all of the following:

- 5,000 complete metric rows;
- 800 complete rows for every BNB, BTC, DOGE, ETH, SOL, and XRP pair;
- three elapsed days;
- at least 95% complete coverage.

With uninterrupted collection, the elapsed-time floor is expected to be the binding condition
until approximately 2026-07-27T03:00:00.000Z (Sunday, July 26 at 10:00 PM America/Chicago).

## Frozen artifact contract

The preregistration is stored as
`updown-smooth-path-feature-cut-freeze-plan-v1`. Once every quality floor passes, the separate
freeze command may create `updown-smooth-path-feature-cuts-v1`.

The artifact has a fixed version order:

1. `updown-smooth-path-displacement-v1`;
2. `updown-smooth-path-causal-displacement-v2`.

For each version it may store only support metadata and the p10, p50, and p90 values of these
unsigned, outcome-blind metrics:

1. `absDisplacementLog`;
2. `pathR2`;
3. `pathEfficiency`;
4. `continuationSlopePerSec`;
5. `continuationFreshLog`.

The builder rejects missing or extra versions, insufficient support, invalid or out-of-range
values, non-monotone quantiles, and any artifact that fails its SHA-256 round trip. The earliest
possible strategy boundary is the first five-minute grid point at least 30 minutes after the
artifact is frozen.

The artifact cannot choose a side, direction, asset, threshold, strategy, comparator, paper row, or
verdict. A future causal-v3 transform must be separately preregistered with its exact transform,
cut, and later boundary.

## Verification

- API TypeScript validation passed.
- The four focused feature-freeze tests passed.
- All 542 API service tests passed with the test database configured.
- The production preregistration command stored the active knowledge-base article.
- A production freeze attempt failed closed with
  `refusing Smooth Path feature-cut freeze: quality distributions are not ready`.
- API health returned `status=ok` after the rollout.
- The worker, web/nginx, database schema, paper engine, strategy rules, and verdict gate were not
  changed or restarted.

## Server2 deployment

- Source commit: `a6be3b0` (`Preregister Smooth Path feature freeze`).
- Recovery point: `/Users/admin/jester-releases/20260725T212608Z`.
- Recovery source SHA-256:
  `5f57b25d7f0e1a591fd70788af24b71ed1beea08a915ea3b3f9071940ef94d49`.
- Recovery database SHA-256:
  `08c956fa24cb9a8cde5bfdf83481ef8d300dfbaa3d76eb7e4cce4bfd798c36eb`.
- Rolled API image:
  `sha256:663824b4a31a1f34840f13520516b7701fd7e24f443ed789cab69007787b79bc`.
- Stored knowledge article:
  `updown-smooth-path-feature-cut-freeze-plan-v1`.

No order endpoint, key, signer, wallet, balance, allocation, position, cancellation, or other live
execution capability exists in this change.
