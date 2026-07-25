# Authoritative trade-flow retry-lifecycle deployment receipt

- Deployed source commit: `2413338`
- Verified at: `2026-07-25T08:49:04Z`
- Server: Server2 (`/Users/admin/jester-analytics`)
- Recovery point: `/Users/admin/jester-releases/20260725T081645Z`
- Recovery source hash:
  `sha256:87b920c269611b2934fee1d4fb69d22a3520e86dd504e9e46c9b91fe79897e3d`
- Recovery database hash:
  `sha256:69b77e200f3a468fceb33479e978b267ed9f97c473f77facc624aa77dd2ad5c8`
- Migration: `0042_busy_expediter.sql`
- Migration ledger: 43 applied migrations
- API image:
  `sha256:1ec41e1e7813a90c424f1e4d238d221a7fe2cfc10db75ac3042e87dd47ee45a1`
- Worker image:
  `sha256:e2866d70fb4c421fefeb814b4902b2a4facee77350b0252b402d110fa3a42b18`
- Nginx image:
  `sha256:b7d238345c1756782139e81ea33cffe1578727bc8bade8cde9080b17376532a7`
- Migrator image:
  `sha256:9d49d952767dc90378ffd59172cca22cdcf98a7c00a1a2ddc134d6053a51580c`

## Diagnosis

- A read-only, outcome-blind sample covered 300 old pending public transaction hashes.
- Two hundred original hashes appeared in the official Polymarket Data API and had Polygon
  receipts. These were ordinary verifier backlog.
- One hundred original hashes appeared in neither the official Data API response nor Polygon
  receipts. They were stale source lifecycle hashes rather than transactions awaiting mining.
- Strict source matching found exactly one later public hash for 53 events and multiple candidates
  for 47. Every unique candidate arrived 12–15 seconds after its source event.
- All 53 unique candidates independently passed the existing finalized V2 OrdersMatched receipt
  decoder, including finality, exchange, token, reported side, shares, and price. The other 47
  remained unresolved.
- This is consistent with Polymarket's documented `RETRYING` lifecycle: a matched order may be
  resubmitted by the operator after failure or reorganization and mine under a later transaction
  hash.
- No outcome, paper result, P&L, directional aggregate, or verdict was inspected.

## Changes

- Kept the public-stream `transaction_hash` immutable and added nullable audit fields for the exact
  mined `chain_transaction_hash` and its `verification_method`.
- Direct source-hash receipts always take priority.
- Limited retry-lifecycle recovery to rows whose original receipt is null, which have already had a
  verification attempt, and whose event is at least ten minutes old.
- Queried the official Data API by condition ID and required exact token, exact reported side,
  shares within `1e-6`, price within the frozen `0.005000001` half-tick tolerance, and a
  forward-only timestamp from the source second through 60 seconds.
- Accepted only one distinct replacement hash. Missing and ambiguous matches remain pending.
- Required every candidate to pass a second, read-only Polygon receipt batch and the existing
  finalized V2 OrdersMatched reconciliation contract before marking it verified.
- Bounded each ten-second verifier cycle to four Data API conditions, cached responses for 60
  seconds with a 16-market cap, and performed the second RPC batch only for unique candidates.
  Data API and replacement RPC failures cannot block direct receipt updates.
- Added replacement-candidate and replacement-verified telemetry, surfaced the aggregate verified
  replacement count in Strategy Lab, and recorded the research in the Alchemy knowledge base with
  an audit entry.

## Verification

- Twenty-two focused collector and receipt-verifier tests passed.
- The complete API suite passed with 458 tests and zero failures.
- API and web TypeScript validation passed.
- The production web build passed using the workspace's arm64 Node 20 runtime.
- Migration `0042` applied successfully. The production schema reports 43 migrations, both new
  columns as nullable text, and a check constraint limiting the method to `source_hash` or
  `data_api_replacement`.
- API, worker, and nginx were recreated from the new images. The API became healthy immediately,
  the local public health endpoint returned `ok`, and the worker resumed all 24 trade-flow token
  subscriptions.
- The first production verifier cycle reconciled 141 source hashes in 582 ms at load-per-CPU
  `0.278`.
- At the natural third-attempt retry boundary, the verifier accepted 49 replacements and left 51
  rows pending. The first logged replacement batch reported four candidates and four verified
  receipts in 1,620 ms at load-per-CPU `0.226`; subsequent bounded cycles raised the aggregate
  accepted count to 49.
- The 51 unresolved rows advanced to attempt four without a replacement method, chain hash, or
  verification error. They remain pending on the next bounded backoff because they did not satisfy
  the unique-candidate-plus-finalized-receipt contract.
- By final verification, 14,534 post-deployment events had reconciled directly by source hash.
  API, worker, and nginx were all running with zero restarts, and no verifier error was logged.
- The knowledge-base update completed with `updated: true` and `auditInserted: true`.

## Sources

- [Polymarket order lifecycle](https://docs.polymarket.com/trading/manage-orders)
- [Polymarket Data API public trades](https://docs.polymarket.com/api-reference/core/get-trades-for-a-user-or-markets)

## Research disposition

This release repairs outcome-blind receipt provenance. It does not alter strategy rules, entries,
sides, prices, sizes, paper results, cohort boundaries, the frozen 57-hypothesis family, any
verdict criterion, readiness's fail-closed behavior, or the prohibition on order creation,
signing, wallet access, and live execution.
