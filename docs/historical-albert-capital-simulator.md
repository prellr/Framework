# Historical Albert capital simulator

## Purpose

Formula Lab now separates an immutable research result from a configurable capital illustration.
The former answers “what did this frozen trial produce under its archived assumptions?” The latter
answers “what would the same exact holdout trade path look like under another starting balance,
position-sizing rule, leverage assumption, and execution-cost model?”

Neither number is a live account balance or an executable forecast.

## Archived equity contract

Every historical result row labeled **Frozen end equity** uses:

- $10,000 starting equity;
- fixed $1,000 notional per accepted trade;
- no compounding;
- one position at a time;
- chronological out-of-sample holdout observations only; and
- the receipt’s original generic 10 bps round-trip cost.

The displayed time span is the interval from the first scored holdout entry to the final forced
exit. It is not the complete source-data period and is not the current date range.

For the default example—BTC 1h chart, 24h forced exit, Albert low-tail z1—the scored period is
2025-10-21 19:00 UTC through 2026-07-21 19:00 UTC. It contains 45 trades, 27 wins, and 18 losses.
The frozen illustration ends at $10,131.49.

## Exact trade artifact

`historical-albert-trade-ledgers-v1` contains exact chronological holdout observations for all
supported historical Albert chart/exit experiments. Each record includes entry time, forced exit
time, observed entry-open price, observed exit-open price, and the resulting short return.

The artifact is deterministic and integrity checked at API startup:

- content hash:
  `sha256:e3a1bc72d82ce05f2fbae688f7cf2b1bf6f017ce01f9f467857f2602939dbe4e`
- 11 experiment families;
- 77 formula trial rows; and
- 156,156 exact holdout trade observations.

These are OHLCV research marks, not executable order-book fills. The artifact does not reconstruct
depth, latency, liquidation, maker fills, or account-specific venue state.

## Configurable simulation

The simulator can change:

- starting equity;
- fixed-dollar or percentage-of-equity notional;
- fixed-dollar or percentage-of-equity risk budget;
- compounding;
- leverage;
- planned loss as a percentage of notional;
- Hyperliquid taker fee per side;
- slippage per side; and
- funding cost or credit per day.

Risk-based modes divide the chosen risk budget by planned loss to derive notional. They do not add
a stop-loss to the historical trade path. Realized losses can therefore exceed the planned budget,
and the simulator reports those breaches.

## Hyperliquid cost model

The default perpetual taker fee is 4.5 bps on entry and 4.5 bps on exit, matching Hyperliquid’s
published base tier-0 taker rate of 0.045% per fill. Exit fees are charged against observed exit
notional rather than assumed equal to entry notional.

Slippage defaults to 0.5 bps per side as an editable illustration. This keeps the default near the
old generic 10 bps round trip when entry and exit prices are similar while preserving fee and
slippage as separate assumptions.

Hyperliquid funding accrues hourly, but the imported TradingView OHLCV has no historical funding
ledger. Funding therefore defaults to an explicit 0 bps per day and remains editable. A true
historical reconstruction requires a timestamped funding series and the account’s actual fee tier.

Primary sources:

- [Hyperliquid trading fees](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees)
- [Hyperliquid funding](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding)

## Interpretation boundary

Changing simulator assumptions never changes the frozen research receipt. No simulator result
selects a formula, registers a strategy, creates a paper bot, reaches an account, signs an order,
or enables execution.
