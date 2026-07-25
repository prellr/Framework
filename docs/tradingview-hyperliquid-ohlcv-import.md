# TradingView Hyperliquid OHLCV import

Alchemy can import one or more local TradingView CSV exports as one immutable, source-only OHLCV
dataset:

```bash
pnpm --filter @framework/api research:import-tradingview-ohlcv -- \
  /absolute/path/to/part-1.csv \
  /absolute/path/to/part-2.csv
```

Defaults are `BTC-USDC-PERP`, venue `hyperliquid`, symbol `BTCUSDC.P`, and interval `5m`. Override
them with `ALCHEMY_TV_ASSET`, `ALCHEMY_TV_VENUE`, `ALCHEMY_TV_SYMBOL`, and
`ALCHEMY_TV_INTERVAL`.

The importer:

- preserves every supplied CSV byte-for-byte under a SHA-256 content address;
- requires identical schemas and the source columns `time`, `open`, `high`, `low`, `close`, and
  `Volume` (case-insensitive);
- validates timestamp alignment, strict chronological order within each file, positive and
  internally consistent OHLC prices, and non-negative volume;
- orders all bars globally, removes only byte-equivalent OHLCV duplicates, and rejects conflicting
  duplicate timestamps;
- records missing intervals and assigns a new `segment_id` after every gap so rolling Formula Lab
  operators cannot bridge missing history;
- exposes only time and OHLCV as canonical research features; chart, indicator, stop, target,
  entry, signal, and version columns remain raw provenance and do not enter the feature surface;
- creates no labels, formula trials, strategies, orders, credentials, or execution routes.

## BTCUSDC.P import receipt — 2026-07-24

Five user-supplied 5-minute exports produced:

- dataset ID: `tradingview-hyperliquid-btcusdc-p-5m-ohlcv`
- content hash:
  `sha256:455ea5183517895bbcb17ec97fc9936304e97d4b81a45d4cd406864c805c1b53`
- 102,267 valid bars from `2025-08-04T00:00:00.000Z` through
  `2026-07-25T03:04:59.999Z`
- 99.9902% interval coverage, with no duplicates, conflicting bars, invalid OHLCV rows, or
  zero-volume rows
- three continuous segments separated by two source gaps:
  - one missing bar between `2025-08-23T08:45:00.000Z` and
    `2025-08-23T08:55:00.000Z`
  - nine missing bars between `2026-06-25T03:55:00.000Z` and
    `2026-06-25T04:45:00.000Z`

Fourteen TradingView-derived columns were preserved only in the raw files: liquidation levels,
stop/target plots, dynamic retracement levels, entry price, pivot state, and indicator version.
They are not admissible Formula Lab inputs in this dataset.

The canonical artifact and manifest are staged under
`.research-data/tradingview/hyperliquid/btcusdc-p/5m/`, which is intentionally Git-ignored. The
dataset has not been registered in the production control plane and no backtest has been run.
