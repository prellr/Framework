# Frozen 30-second paper markout disclosure

Date: 2026-07-25  
Alchemy version: 0.2.1  
Application commit: `eef07661becbbcb6d3f05c42b9289d80d4c841a9`  
Environment: Server2 production (`https://jester.wisco.wine/polymarket`)

## Outcome

The Polymarket **Execution & Capital** view now contains a frozen, outcome-blind 30-second liquidation audit. It measures adverse selection after a captured paper quote without changing the paper ledger, strategy verdicts, or live-execution state.

The audit remains locked until every preregistered readiness floor is satisfied:

- at least 1,000 terminal observations;
- at least 200 unique markets;
- at least 3.0 days between the first and last eligible observation.

Before unlock, the API returns readiness counts and the measurement disclosure only. It returns `report: null`, and the UI shows no signed markouts, quantiles, assets, horizons, or entry-ask results.

## Measurement contract

Disclosure version: `paper-fill-markout-disclosure-v1`  
Audit version: `paper-fill-markout-audit-v1`

- Quote sample: earliest captured observation for each market × side.
- Target delay: 30 seconds.
- Maximum admissible delay: 75 seconds.
- Contract markout: observed 30-second bid minus captured fee-adjusted ask.
- `$5` liquidation return: `5 × (bid / ask − 1)`.
- Frozen quantiles: P10, P50, and P90.
- Frozen dimensions: overall, timeframe, entry ask, and asset.
- Stake: `$5`.
- Outcome blind: yes.
- Verdict input: no.

This liquidation return is not settlement P&L and is not subtracted from ledger RAW. RAW already uses the recorded fee-adjusted `$5` depth-walk result at settlement; treating the 30-second markout as another execution charge would double-count execution effects. The audit instead answers a separate question: what immediate liquidation would have looked like after the captured quote.

## Source isolation

The report query reads captured quote and delayed bid data only. It does not read:

- strategy or bot identity;
- signal values;
- grades, outcomes, wins, or losses;
- settlement or ledger P&L;
- control residuals;
- wallet, account, or order data.

A source-contract guard rejects any report definition containing those prohibited result or execution-control fields.

## Production state at validation

Immediately after deployment:

- eligible rows: 60,111;
- terminal rows: 60,108;
- captured observations: 60,043;
- unavailable observations: 65;
- stale observations: 0;
- unique markets: 5,788;
- observed span: 2.559 days;
- `readyForDescriptiveAudit: false`;
- `resultsLocked: true`;
- `report: null`.

The row and market floors were already met. The three-day time floor remained binding, so no outcome-like audit result was exposed.

## Validation

- Focused disclosure and markout-model tests passed: 8/8.
- API TypeScript check passed.
- Web TypeScript check passed.
- Vite production build passed.
- `git diff --check` passed.
- Full production API test suite passed: 551/551.
- Production `/health` returned `status: ok`.
- The API container was healthy with zero restarts.
- Authenticated production browser validation passed for the new Execution & Capital view.
- The locked audit displayed readiness counts without signed result fields.
- Browser console warnings and errors: none.

The existing Vite large-chunk warning remains informational; it did not affect the production build or browser validation.

## Deployment and recovery

Recovery directory:

`/Users/admin/jester-releases/20260725T225029Z`

Artifacts:

- source backup SHA-256: `5d75aedbf6e9deb6e334eaef06402a01a681687d5bbaa2a3093377dc6eab90e8`
- database dump SHA-256: `9c3e3dcf8522becd69846aba36d0a5384126a60d00b43a0b498ed907fdc15fa8`
- exact deployment archive: `deploy-eef0766.tgz`
- deployment archive SHA-256: `5ce619c418b8d67e4912b1ce2386e70e894d29eaa933e0a763a2d9752a74dd5b`

Only the API and nginx images were rebuilt and recreated. No database migration was required. The worker remained running on its prior image.

Deployed images:

- API: `sha256:0e22feb5a895262dd0c99938733f9348864a96be4f0aa5f5974e4af053d2fbe1`
- nginx: `sha256:5fda4bc8f24a9db91aa232c55e8d36d6ed31e3fcdba8fb8b82edd52db1a28dbf`
- unchanged worker: `sha256:cafb09cc72dac8fce06a296b885b10d0af82cde167ca08f0367b5a243bbb25a0`

All three containers reported zero restarts after deployment.

## Primary implementation

- `apps/api/src/services/paper-markout-disclosure.ts`
- `apps/api/src/services/paper-markout-disclosure.test.ts`
- `apps/api/src/services/paper-markout-report.ts`
- `apps/api/src/routers/polymarket.ts`
- `apps/web/src/pages/polymarket/PolymarketExecutionCapital.tsx`

