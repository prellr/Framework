# Resolution-basis preregistration and Polymarket stake models

Deployed to Server2 on 2026-07-25.

## Version

- `dcc0cd2` — preregister resolution basis catch-up family
- `ec13246` — add Polymarket stake scenario modeling
- Source deployed from the exact `ec13246` Git archive.

## User-visible change

Polymarket strategy detail pages now offer three analysis-only stake scenarios:

- `$5 captured` — the authoritative recorded paper fill and gate input.
- `$10 linear` — dollar P&L scaled 2× from the recorded $5 fill.
- `$20 linear` — dollar P&L scaled 4× from the recorded $5 fill.

The $10 and $20 scenarios do not replay deeper order-book liquidity, additional
slippage, or capacity. The page labels this limitation directly. Stake selection
does not change trades, win rate, entry asks, the paper engine stake, or any
verdict gate.

The selected scenario is reflected in summary metrics, daily RAW ledger, asset
buckets, segmentation tables, and recent decision P&L. Captured asks remain
explicitly labeled as the fee-adjusted `$5 VWAP`.

## Research metadata

The resolution-source basis catch-up plan was recorded as metadata only under:

`updown-resolution-source-basis-catchup-preregistration-v1`

It contains separate 5m and 15m hypotheses, reads no feature outcomes, creates no
paper bot, and changes no existing paper decision. The first recorder invocation
reported `updated: true` and `auditInserted: true`; the second reported
`already_recorded`, proving idempotence.

## Verification

- Focused paper-strategy detail safety tests: 7/7 passed.
- Web TypeScript check: passed.
- API TypeScript check: passed.
- Production web build: passed.
- Live browser verification:
  - `$10 linear` rendered the 2× warning and scaled dollar values.
  - Clicking `$20 linear` updated the URL to `stake=20`, rendered the 4× warning,
    and scaled RAW net while preserving the same sample counts and win rate.
- Server health after deployment: healthy.

The local all-service API test command was not used as a release gate because
database-backed tests require `DATABASE_URL`; the focused non-database safety
suite and both typechecks passed.

## Server2 recovery point

Directory:

`/Users/admin/jester-releases/20260725T191849Z`

Artifacts:

- `source.tgz`
  - SHA-256: `84c91b6defe9de9b0c146069bbf0885901f1decc16408a1826106b1657f81b82`
- `postgres.sql.gz`
  - SHA-256: `1cecfd777fc58b48523acd9dd16d6ddc6cd3d4717342eb9ee0132582095d5f8d`

## Container audit

Before:

- API image: `sha256:bb19632a64f9faaf7abf8db8ac9a1ab78ca7e429a134c40904bc2b3bfb0bf443`
- Nginx image: `sha256:90c26cd60328510a085260e5f3415cec1f60bd49181e720481a5cc7a4aa7e292`
- Worker container: `d2978d5148af`
- Worker image: `sha256:273032822a9c778d5be22119f3a72d327b43eaa287a49e64a1b5bc27eacb1a30`

After:

- API image: `sha256:b99a0a67842cbafdced94796dcf913eaf22c08f677744197ba522e0bafdeab8c`
- Nginx image: `sha256:dadc7e28fc5fb582adacd24c6ff50a30f920af6624f37857c02c53f7d6af086b`
- Worker container and image remained unchanged.

