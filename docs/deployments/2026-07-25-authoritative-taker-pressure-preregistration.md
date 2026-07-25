# Authoritative taker-pressure preregistration receipt

- Deployed commit: `780a1ded35ea29cf094d06134fe3968cf52f86c8`
- Verified at: `2026-07-25T15:01:15Z`
- Server: Server2 (`/Users/admin/jester-analytics`)
- Recovery point: `/Users/admin/jester-releases/20260725T145655Z`
- Recovery source hash:
  `sha256:99cadfb80e618962da591a87ebd2289c5324fd05a4863f1b154c519fc9935c40`
- Recovery database hash:
  `sha256:041dabce76bcbf0d17a7150cc46ed7c9e038d0c8665fdbf9d95c7639594119b1`
- Deployed source archive hash:
  `sha256:a09507f25ba09d8276be0b61b24cd996274acae5db9bb0d856a0b5ccc69f8e04`
- API image:
  `sha256:0fda72301a724c315bb223c20add52bdd3b05cb6a65aa1009febb4750227b347`
- Worker image, deliberately unchanged:
  `sha256:82bca48c348520c4fa11ba49e6557fda5b805e9404f657a54d116613038ca008`
- Migration ledger: 44 applied migrations; this release added no migration

## Frozen handoff

This release preregisters an outcome-free reference for comparing live public-book flow proxies
with independently reconciled Polygon receipts. It adds:

- `updown-authoritative-taker-pressure-distribution-audit-v1`.
- `updown-authoritative-taker-pressure-feature-cut-freeze-plan-v1`.
- Future artifact version `updown-authoritative-taker-pressure-feature-cuts-v1`.
- A protected, read-only audit query.
- A readiness-gated, manually invoked freeze script.

The private transform admits only `verified` events with an immutable transaction hash, at least
20 confirmations, positive decoded chain shares, and an event time in
`[window_start, window_start + 60s)`. It maps complementary outcome books into canonical
UP-probability pressure:

- Buy UP and sell DOWN are positive.
- Sell UP and buy DOWN are negative.
- Shares are the weight so the complementary books remain symmetric.

The transform aggregates to exactly one market row before computing any distribution. The signed
market value remains private. Only five unsigned references can be disclosed:

- Log gross first-minute shares.
- Verified first-minute event count.
- Unique reconciled receipt count.
- Absolute net-share pressure divided by gross shares.
- Largest single event divided by gross shares.

The frozen universe is the six assets independently at 5m and 15m: twelve buckets with at least
25 active first-minute markets in each bucket. Every future artifact must contain exact market
coverage, monotone p05/p25/p50/p75/p95 references, valid ranges, positive required IQRs,
receipt counts no greater than event counts, strict schema validation, and a matching SHA-256.

## Preregistration proof

Both metadata scripts inserted their article and audit record once. Immediate reruns returned
`already_registered` without another write. Production contains:

- One active distribution-contract article.
- One active feature-cut-plan article.
- Exactly one `kb.preregistration.record` audit row for each article.
- Zero `updown-authoritative-taker-pressure-feature-cuts-v1` artifacts.

The feature-cut freeze script was not run.

## Locked production state

At verification time the inherited authoritative tape reported:

- 1,540,145 raw events.
- 1,539,115 verified events.
- 4,107 distinct markets.
- 1.79128 days of prospective span.
- 100% hash coverage.
- 99.9732% chain-verification rate.
- Healthy collection, latency, receipt provenance, and verifier catch-up.

The direct production service check returned:

- `inheritedTapeReady: false`.
- `readyForCutFreeze: false`.
- `report: null`.
- `eligibleToFreeze: false`.
- `frozen: false`.
- `artifact: null`.

Consequently no private pressure distribution ran, no signed or unsigned feature value was
observed, and no cut was frozen. Collection must reach the inherited seven-day span floor before
the preregistered distribution may execute.

## Verification

- 486 API tests passed with zero failures.
- API, web, and research-protocol TypeScript checks passed.
- The deployed service and router checksums matched commit `780a1de`.
- The protected router contains no mutation procedure for this audit.
- Source guards prove the preregistration scripts are metadata-only.
- Source guards prove the audit and freeze paths contain no paper ledger or order operation.
- The API was recreated healthy with zero restarts.
- The unchanged worker continued running with zero restarts, avoiding a research-tape gap.
- The public production health endpoint returned `ok`.

## Safety disposition

This release creates no collector, subscription, table, polling loop, strategy, paper roster
member, direction rule, ask cap, outcome join, order route, signing capability, wallet access,
allocation, or fund-moving path. It changes no existing strategy, cohort boundary, paper result,
verdict criterion, or execution control.

Even after the seven-day tape floor passes, the frozen artifact remains an unsigned
proxy-validation reference. Direct decision-time use requires a separate prospective availability
audit and a later preregistered paper boundary. Any candidate must keep independent 5m/15m
identities, fee-adjusted executable paired-book economics, chronological clustered validation,
same-panel controls, and the unchanged forward verdict gate.
