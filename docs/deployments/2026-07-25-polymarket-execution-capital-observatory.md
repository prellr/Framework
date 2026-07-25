# Polymarket execution and capital observatory

Date: 2026-07-25  
Alchemy version: 0.2.0  
Application commit: `0f77c817e9f560a3064b595228d4fb71d7df0f65`  
Environment: Server2 production (`https://jester.wisco.wine/polymarket`)

## Outcome

Alchemy now has a dedicated **Execution & Capital** view for the Polymarket paper engine. It separates execution-quality evidence, capital demand, strategy overlap, and retrospective segmentation from strategy-score reporting.

The view is intentionally observational:

- it is authenticated and query-only;
- it cannot create, sign, submit, cancel, or route an order;
- it does not expose wallet or allocation controls;
- it does not treat pooled strategy intents as an executable portfolio;
- it labels all stake and capacity projections as prospective models.

The active Polymarket interface no longer presents the legacy `profit stress -36%` statistic. Archived compatibility fields remain in the service layer so historical receipts are not rewritten.

## Delivered capabilities

### Execution evidence

- Unique market-side quote sampling, deduplicated before aggregation.
- Quote and execution coverage.
- Fee drag in dollars and basis points.
- Depth slippage and spread distributions.
- Multilevel book-walk rate.
- Markout dataset readiness and history span.
- Decision-preparation latency and captured-book age.

### Capital and overlap

- Naive strategy-intent notional.
- Same-market, same-side deduplicated capital.
- Duplicate intent count.
- Shared-market and opposed-market counts.
- Peak naive versus deduplicated capital.
- Prospective `$5`, `$10`, and `$20` stake capacity models.

### Cross-strategy analysis

- Daily entry-ask economics with raw P&L, net per bet, win rate, and sample size.
- Select/deselect individual strategies, plus all/none controls.
- `5m`, `15m`, and combined horizon filters.
- Entry ask, macro direction, calendar day, and signal-freshness matrices.
- Scope and period controls for paper, forward, and historical populations.

## Initial production observations

These are descriptive values observed immediately after deployment and are not verdict inputs:

- 16,971 unique quote samples with 100% captured execution coverage.
- Median fee drag: `$0.164` / `170.5 bps`.
- P95 depth slippage: `134.7 bps`.
- Multilevel book walks: `24.1%`.
- Peak naive capital: `$955`; same-market/same-side deduplicated peak: `$120`.
- 47,910 duplicate strategy intents across 11,405 unique side positions and 5,716 markets.
- 99.5% of markets contained opposed strategy intents, which makes the pooled set unsuitable for portfolio-level performance claims.
- Markout store: 59,456 rows across 5,734 markets and 2.54 days of observed history; the UI continues to hold its readiness state until the frozen three-day requirement is met.
- Decision-preparation coverage: 94.4%; P95 preparation latency `438 µs`; P95 captured-book age `114 ms`.

The entry-ask view also exposed the economic distinction requested during review: on July 24, the pooled `<35¢` bucket showed `+$348.33` from 1,926 decisions at a 26% win rate. This is useful evidence that payoff asymmetry can dominate headline win rate, but it remains a pooled retrospective slice with overlapping and opposed decisions.

## Performance controls

The API projection uses a keyed 30-second in-process cache to bound repeated analytical queries. Initial uncached production responses observed during validation were approximately:

- combined horizons: 885–944 ms;
- 5-minute horizon: 566–592 ms.

## Validation

- API TypeScript check passed.
- Web TypeScript check passed.
- Vite production build passed.
- Execution/capital source-contract tests passed: 4/4.
- Execution/capital plus paper-floor tests passed in the production API container: 7/7.
- `git diff --check` passed.
- Production `/health` returned `status: ok`.
- API, nginx, and worker containers were healthy with zero restarts after deployment.
- Authenticated browser validation passed for:
  - loading the new tab;
  - combined and 5-minute filters;
  - macro matrix selection;
  - strategy all/none controls;
  - real production data rendering.

The existing Vite large-chunk warning remains; no new build error or browser-console error was introduced.

## Deployment and recovery

Recovery directory:

`/Users/admin/jester-releases/20260725T222307Z`

Artifacts:

- source backup SHA-256: `f2a0888e3fed5f3b923604010122f99de67b7b87a6d7524f7543430f4254992b`
- database dump SHA-256: `d6f095d70f6b01c03a11831374f01689b6c8a5133cf629070f036757a4579cb1`
- exact deployment archive: `deploy-0f77c81.tgz`
- deployment archive SHA-256: `a7af9878a338feed7128b2d862647e9d4a9537781d5599600fa916ee2435acae`

Only the API and nginx images were rebuilt and recreated. The worker was not recreated, and no database migration was required.

Deployed images:

- API: `sha256:1468b86b1bfb882ead46f07929bb78daf0bfb37a36eb2f30923b9ccc1736a368`
- nginx: `sha256:2dd34689ae87f43edad93f6a2d012a12102abb64658a49c9dbe70b909c4bd520`
- unchanged worker: `sha256:cafb09cc72dac8fce06a296b885b10d0af82cde167ca08f0367b5a243bbb25a0`

## Primary implementation

- `apps/api/src/services/paper-execution-capital.ts`
- `apps/api/src/routers/polymarket.ts`
- `apps/web/src/pages/polymarket/PolymarketExecutionCapital.tsx`
- `apps/web/src/pages/polymarket/PolymarketPage.tsx`
- `apps/api/src/services/paper-execution-capital.test.ts`

