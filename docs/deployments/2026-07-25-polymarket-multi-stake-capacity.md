# Polymarket multi-stake capacity tape v1

Deployed prospectively to Server2 on 2026-07-25.

## Version and boundary

- Commit: `085f3ef` — Capture Polymarket multi-stake capacity
- Preregistered tape: `polymarket-multi-stake-capacity-v1`
- Frozen boundary: `2026-07-25T22:00:00.000Z`
- Modeled total outlays: `$5`, `$10`, `$20`

The existing `$5 captured` strategy evidence remains authoritative. The `$10 linear`
and `$20 linear` UI scenarios remain explicitly hypothetical until this tape has
enough prospective book-depth evidence.

## Collection contract

The state collector already fetches one public UP book and one public DOWN book per
market-minute. At and after the boundary, it walks those exact same in-memory books
at `$10` and `$20` total outlay using the captured taker-fee curve.

The release adds no CLOB request, socket, poller, raw-book table, service, strategy,
paper trade, outcome lookup, verdict input, account access, signing, order, wallet,
or execution path. Incremental work is four bounded ask walks and five nullable
scalars on the state row already written.

## Frozen readiness

Only collection metadata is exposed until all floors pass:

- 1,500 distinct markets.
- Seven elapsed days.
- 100 distinct markets in every asset × 5m/15m bucket.
- 90% of rows with paired `$10` and `$20` fills on both outcomes.

The initial production status correctly reported zero rows and
`readyForCapacityDistribution: false`, with strategy coupling, verdict coupling,
external requests, and execution capability all `false`.

## Preregistration proof

The first production recorder invocation returned:

- `updated: true`
- `auditInserted: true`
- `readsFeatureValues: false`
- `readsOutcomes: false`
- `addsExternalRequests: false`
- `createsPaperBot: false`
- `executionCapability: false`

The immediate rerun returned `already_registered` and inserted no second audit row.
Production contained exactly one article with the registered slug.

## Migration and verification

- Migration: `0044_sparkling_champions.sql`
- Migration ledger after release: 45
- Added columns: `capacity_version`, `up_fill_10`, `down_fill_10`,
  `up_fill_20`, `down_fill_20`
- All five columns are nullable.
- API TypeScript check passed.
- Twelve focused multi-stake and existing `$5` execution tests passed.
- Server-side source checksums matched the committed source.
- API health returned `ok`.
- The pre-boundary database assertion found zero capacity-tagged/value rows.
- After the worker recreation, the unchanged state-tape loop wrote 12 new rows by
  `19:37:55.770Z`; the first observed post-start capture was within 50 seconds.
- Worker public feeds resubscribed to 24 trade-flow tokens and initialized all
  24/24 CLOB event-OFI books.

## Server2 recovery point

Directory:

`/Users/admin/jester-releases/20260725T193451Z`

Artifacts:

- `source.tgz`
  - SHA-256: `bce605b06532d6ac8a5c818b5ac951d412a2de2a0eeefa6a7b9184449f4d5a1d`
- `postgres.sql.gz`
  - SHA-256: `c84e7e0cae820ef31e5aa0bf0c6bbb27fa7b6e8f2194a09d3bf3e069fac66387`
- Deployed Git archive
  - SHA-256: `0af68f7c9f26f731520a2b8efc729a3ec6cdb514cd3b568c300705e0c260dca1`

## Container audit

Before:

- API: `sha256:b99a0a67842cbafdced94796dcf913eaf22c08f677744197ba522e0bafdeab8c`
- Worker: `sha256:273032822a9c778d5be22119f3a72d327b43eaa287a49e64a1b5bc27eacb1a30`

After:

- API: `sha256:e72b60bac54fce5cfe49261f933d2b416bc4a7eff56f964d1d27cfc835a41f7f`
- Worker: `sha256:b52cba222ab5a3ac0c9c922f0cf3977c6e7cfd9889efcc1e834462e47739baca`
- Migrator: `sha256:f73bbc17f28227f146d085103b601741c1297bed16b1a880289a58d07883d1f6`
- Nginx remained unchanged:
  `sha256:dadc7e28fc5fb582adacd24c6ff50a30f920af6624f37857c02c53f7d6af086b`

API and worker both started with zero restarts. Postgres, Redis, and nginx were not
recreated.
