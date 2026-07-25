# Authoritative trade-flow retry hardening deployment receipt

- Deployed source commits: `0849d84`, `ad280d5`, `bd47f87`
- Verified at: `2026-07-25T07:48:40Z`
- Server: Server2 (`/Users/admin/jester-analytics`)
- Recovery point: `/Users/admin/jester-releases/20260725T073314Z`
- Recovery source hash:
  `sha256:146b1a2e97d8c609a2d77e2fbba52b4a0711fa9700f4aa4998b693a7559b24d5`
- Recovery database hash:
  `sha256:a3e04b5ccf05048567e2e8c9849cf0bc03b036a117f3662e33231cf0721459d2`
- Migration ledger: 42 applied migrations
- API image:
  `sha256:be895310ef116860f3f5e4a58f0750e86c4441bdd6c80530dcbe60bd88949189`
- Worker image:
  `sha256:6004a4ddf0eeedfebac41a358c82bf37cbd4902963fea59d0947a92af90e3b96`
- Nginx image:
  `sha256:dbfd9e0f391f37a1cf537e9fbf8b2ce41b7794fe7828dfa30bf29e25c534411c`

## Diagnosis

- The receipt verifier selected the oldest 200 pending events every ten seconds.
- Some public Polymarket transaction hashes returned no Polygon receipt for many hours. With no
  durable last-attempt timestamp, those same null receipts repeatedly occupied the head of the
  queue and blocked newer evidence.
- A read-only sample confirmed that the oldest ten hashes all still returned null receipts. No
  strategy outcome, paper P&L, directional sign, or verdict result was inspected in making this
  operational diagnosis.

## Changes

- Added durable `verification_attempts` and `verification_attempted_at` fields through migration
  `0041_absurd_paper_doll.sql`.
- Gave never-attempted rows a dedicated live lane and delayed their first receipt lookup for 60
  seconds, preserving the existing 20-confirmation finality requirement.
- Added exponential null-receipt retries beginning at ten minutes and capped at six hours.
- Rotated attempted rows by their last lookup time so a durable null receipt cannot repeatedly
  block newly arriving evidence.
- Split operational telemetry into old pending, currently overdue, and retry-deferred counts.
  Readiness remains fail-closed whenever old source hashes are unresolved, even if the verifier
  itself is caught up.
- Corrected PostgreSQL's timestamp inference at the row-specific retry boundary by comparing the
  timestamp column to a statement-stable `timestamp without time zone` clock.

## Verification

- Twenty focused collector and receipt-verifier tests passed.
- The complete API suite passed with 456 tests and zero failures.
- API and web TypeScript validation passed.
- The production web build passed.
- The migration applied successfully and the production schema reports all 42 migrations.
- The corrected worker completed a 200-hash receipt batch in 952 ms with no SQL error, remained
  running with zero restarts, and the public health endpoint returned `ok`.
- Immediately after the corrected worker started, the never-attempted overdue lane fell from
  1,152 rows to 13 and total pending fell from 11,673 to 9,520. Older null-receipt rows remain
  eligible only on their bounded retry clock.
- The deployed Strategy Lab renders the explicit `60s initial / 10m–6h retry` telemetry and
  continues to label the authoritative flow audit unavailable while unresolved source receipts
  remain.

## Research disposition

This release repairs an outcome-blind data-quality verifier. It does not change a strategy rule,
entry, side, price, size, paper result, cohort boundary, the frozen 57-hypothesis family, any
verdict criterion, or the prohibition on order creation, signing, wallet access, and live
execution.
