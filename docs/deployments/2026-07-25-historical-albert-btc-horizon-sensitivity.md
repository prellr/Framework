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

## Production deployment

- Source commit: `289e178` (`feat(formula-lab): add Albert horizon sensitivity`)
- Deployed: `2026-07-25T16:00Z`
- Host/project: `server2.local` · `/Users/admin/jester-analytics`
- Recovery point: `/Users/admin/jester-releases/20260725T155827Z`
- Pre-deploy source archive:
  `sha256:cea8bc92cd09ac8a9d1dbc787626f754c0a6ddad79130b845832ad92edf51f7a`
- Pre-deploy database dump:
  `sha256:3e479dd024c68f8ddc0c20f52a80b27b4a0c27821389c88e46b89c6dbd1716c2`
- API image:
  `sha256:e6d3208b3c0d411ddcf8b2d446a2d018999b6f6a317680647679f09bec10eb56`
- Nginx image:
  `sha256:1381ddde1cdd95cc933578334a00efc611f04eaddbaa80c985377ba033b67e7a`
- Knowledge slug:
  `alchemy-historical-albert-btc-5m-horizon-sensitivity-research-v1`
- Knowledge row count: `1`; matching audit row count: `1`
- Public health: `{"status":"ok"}`
- Browser verification: both the immutable 10m baseline and the new 30m/1h/4h section render;
  the expanded section contains all 21 declared rows and produced no console warnings or errors.
- Worker remained on its existing image and was not restarted.
