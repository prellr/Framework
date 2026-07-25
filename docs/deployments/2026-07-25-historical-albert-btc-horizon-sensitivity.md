# Historical Albert formula × BTC fixed-exit sensitivity

## Outcome

Alchemy replayed the exact imported Albert expression on the immutable TradingView Hyperliquid BTC
5m tape with forced exits at 30 minutes, 1 hour, and 4 hours. The original 10-minute replay remains
its own immutable baseline receipt.

The sensitivity family changed only the exit clock. Formula semantics, short side, next-open entry,
training-only z-score moments, four expanding chronological folds, non-overlapping positions,
gap rejection, 100-trades-per-fold floor, 10 bps round-trip stress, and the fixed-notional capital
illustration were held constant.

## Receipt identity

Sensitivity receipt:
`sha256:8c1088fedfbc2c8c93daf525e62c9d331cb882423c6dc05eabc000e556a15c1d`

Dataset:
`sha256:455ea5183517895bbcb17ec97fc9936304e97d4b81a45d4cd406864c805c1b53`

## Result

No requested horizon produced a declared trial with positive net mean in every fold after the
frozen 10 bps cost stress.

| Exit | Best gross row | Trades | Gross mean | Net mean | Positive folds | Floor |
|---:|---|---:|---:|---:|---:|---:|
| 30m | Albert short low tail, z1 | 145 | +2.90 bps | -7.10 bps | 1/4 | under |
| 1h | Always-short control | 5,102 | +0.63 bps | -9.37 bps | 0/4 | met |
| 4h | Always-short control | 1,275 | +2.51 bps | -7.49 bps | 0/4 | met |

At 30 minutes, the extreme-low-tail z1 row was the largest gross formula row, but it remained net
negative and missed the sample floor in every fold. At one hour and four hours, the formula's
low-tail rows became gross-negative. At four hours, the broad Albert high-tail row was slightly
worse than the always-short control, so the current gate added no value.

Held-out Spearman association increased with the horizon and was positive in every requested fold.
That is a lead for a separately declared percentile/rank-gate sensitivity family, not permission to
retrofit the current mean/std thresholds.

## Safety and evidence

This is retrospective discovery, not untouched validation. OHLCV opens are not executable fills.
No result selects or exports a winner, creates a strategy, creates a paper bot, changes the verdict
gate, starts Crucible, signs an order, or enables execution.

## Verification

- Replay tests cover exact 30m, 60m, and 240m exits, deterministic receipts, gap rejection,
  chronological purging, and future-data mutation protection.
- Formula Lab exposes all 21 requested horizon × trial rows in a sortable table.
- The complete matrix and limitations are recorded in the in-app knowledge base.
