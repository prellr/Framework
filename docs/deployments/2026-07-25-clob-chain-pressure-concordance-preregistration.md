# CLOB/chain-pressure concordance preregistration deployment receipt

- Deployed source commit:
  `4197222fed28594c19b80ea1cd9782d68cb40dee`
- Verified at: `2026-07-25T15:32:03Z`
- Server: Server2 (`/Users/admin/jester-analytics`)
- Recovery point: `/Users/admin/jester-releases/20260725T152557Z`
- Recovery source hash:
  `sha256:fb8f98b91c828c3c9452c847b069e8c83bfe2e19fb1393dd97de5186fc450a98`
- Recovery database hash:
  `sha256:4f2f7c8776530fe4f21d790cd3ad5f01ba17515fe23b9a5c03fa759a42eec604`
- Deployed source archive hash:
  `sha256:314ce3a62d0e638dbee760bc12370293bcc0704826463a5aba98da2464953407`
- API image:
  `sha256:d25240b61f4f984b253ce7ab0ee6c40c1c041dd481f5553d81b9d8ed559dd310`
- Worker image, unchanged:
  `sha256:82bca48c348520c4fa11ba49e6557fda5b805e9404f657a54d116613038ca008`
- Migration ledger: 44 applied migrations; this deployment added no migration

## Frozen contract

- Version: `updown-clob-chain-pressure-concordance-audit-v1`
- Prospective start: the later of the two inherited source starts,
  `2026-07-24T07:00:00.000Z`
- CLOB source: `updown-clob-event-ofi-tape-v1`
- Reference source: `polymarket-authoritative-taker-flow-tape-v1`
- The comparison is near-synchronous, not exact:
  - CLOB state sample: minute zero of each market
  - accepted state-capture offset: `[55s, 60s)`
  - authoritative chain window: `[market_start, market_start + 60s)`
  - minimum temporal overlap: 55 seconds
  - maximum boundary mismatch: 5 seconds
- BTC, ETH, SOL, XRP, DOGE, and BNB are evaluated independently at 5m and 15m,
  producing 12 frozen buckets.
- The inherited source gates must pass before the matched-panel readiness query may run.
- The matched panel then requires:
  - at least 95% anchor coverage;
  - at least five matched calendar days;
  - at least 100 matched markets in every bucket; and
  - all 12 buckets present.
- Only after every gate passes may the audit expose pooled and per-bucket Pearson correlation,
  Spearman correlation with deterministic average tie ranks, nonzero sign agreement, and the
  proxy/reference zero rates.

The clock window was selected from capture timestamps and nullability only. No CLOB imbalance
value, authoritative pressure value, market outcome, paper result, P&L, or verdict state was read
while defining it.

## Implementation

- Added the frozen contract and an outcome/performance/account/order-key guard.
- Added a protected, read-only `clobChainPressureConcordanceAudit` API query.
- Reduced readiness evaluation to one cached database scan. The value-bearing aggregate query is
  separate, cached for 15 minutes, and unreachable until the inherited source and matched-panel
  gates pass.
- Added idempotent preregistration tooling. The first production invocation inserted the active
  knowledge-base article and its audit record; a second invocation returned
  `already_registered` without another write.
- Deployed source checksums matched the committed files:
  - concordance audit:
    `18b8e09fac16debcbe905b326cec9a9fc660a0273dcd1a6242c37ccc533b8dd9`
  - concordance contract:
    `b34b49f9d397ac40021a965ed0d2b7338631c4e333dc382e39c69af3b21b6fa2`
  - Polymarket router:
    `1cf0d6a18aa149520da8da75f0b3ff872a45cd797232e07fcb151dfdf99b7064`

## Verification

- Six focused concordance tests passed.
- The complete API suite passed with 492 tests and zero failures.
- API, web, and research-protocol TypeScript validation passed.
- `git diff --check` passed.
- Production contains exactly one active knowledge-base article for the frozen version.
- Production contains exactly one `kb.preregistration.record` audit row for that version.
- A direct production service call reported both source readiness flags as false,
  `matchedReadiness: null`, and `report: null`.
- The API container is healthy with zero restarts.
- The unchanged worker remained up with zero restarts, preventing a collection gap.
- The public health endpoint returned `ok`.
- Recent API logs contained successful health and protected research reads with no application
  error.

## Safety disposition

This release preregisters an outcome-blind measurement audit. It does not create or alter a
strategy, direction, threshold, entry, price, size, paper result, verdict, order endpoint,
signing route, wallet capability, allocation control, or live-execution path. The audit cannot
admit a hypothesis or affect the frozen verdict gate. Value-bearing results remain unavailable
until the two inherited source gates and the independently frozen matched-panel gate all pass.
