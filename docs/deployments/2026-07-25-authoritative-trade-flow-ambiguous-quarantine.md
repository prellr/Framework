# Authoritative trade-flow ambiguous-provenance quarantine receipt

- Deployed source commits: `1ca8498`, `632bd04`
- Natural-runtime verification: `2026-07-25T13:54:25Z`
- Server: Server2 (`/Users/admin/jester-analytics`)
- Recovery point: `/Users/admin/jester-releases/20260725T090556Z`
- Migration: `0043_flippant_doctor_strange.sql`
- Migration ledger after deploy: 44 applied migrations

## Purpose

The replacement-receipt verifier previously left rows pending when more than one distinct official
Polymarket hash matched every frozen public-stream execution fact. Retrying cannot disambiguate
those rows without inventing a new post-boundary selection rule. The deployed change therefore
classifies this irreducible case as terminal `ambiguous_hash`, leaves it unverified, and clears all
derived receipt metadata while preserving the immutable source-stream hash and event.

This is an outcome-blind provenance quarantine. It does not inspect or change a token choice,
direction, result, strategy, paper decision, grade, P&L, verdict criterion, or execution path.

## Natural retry proof

The service was left running through the unmodified durable retry deadlines. A read-only
post-deadline check found:

- 52 terminal `ambiguous_hash` events.
- Zero `ambiguous_hash` rows carrying a chain transaction hash, block, confirmation count,
  exchange, chain side, chain token, chain amounts, chain price, chain shares, verification
  timestamp, or verification method.
- Zero pending events older than three minutes.
- 1,503,277 verified events and 1,503,682 terminal events at the proof instant.
- A terminal chain-verification rate of `0.99973066`.
- Ambiguous source events spanning `2026-07-24 21:14:19.744` through
  `2026-07-25 09:14:21.885`.
- Natural classification attempts spanning `2026-07-25 09:25:39.940` through
  `2026-07-25 10:06:30.118`, with two to five attempts per event.

The source hash remains intact by design. It is evidence of what the public stream reported, not a
claim that the unavailable receipt was independently verified.

## Runtime and source invariants

- API, worker, and nginx were all running for five hours with zero restarts.
- API health was `healthy`.
- The authoritative source audit passed every invariant:
  exact boundary, paper-only, outcome-blind, no directional rule, no pre-boundary rows, no mapping
  violations, no prohibited columns or source reads, read-only RPC contract, and declared schema
  checks.
- The audit observed 1,503,467 stored rows, zero pre-boundary rows, zero mapping violations, and
  zero prohibited source reads.

## Telemetry follow-up

The database transition was authoritative and complete, but the existing five-minute verifier-log
throttle could omit a nonzero terminal-classification line when the transition occurred between
scheduled telemetry emissions. The next worker release makes any nonzero replacement verification
or ambiguity count bypass that throttle. It changes observability only; classification,
readiness, and the verdict gate remain unchanged.
