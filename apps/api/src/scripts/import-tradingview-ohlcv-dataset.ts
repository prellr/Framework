/**
 * Import one or more local TradingView CSV exports into Alchemy's immutable research format.
 *
 * Usage:
 *   pnpm --filter @framework/api research:import-tradingview-ohlcv -- /abs/part-1.csv /abs/part-2.csv
 *
 * This is source-only. It cannot create a formula experiment, register a strategy, or trade.
 */
import { fileURLToPath } from "node:url";
import { importTradingViewOhlcvDataset } from "../services/tradingview-ohlcv-dataset.ts";

const sourcePaths = process.argv.slice(2);
if (sourcePaths.length < 1) {
  throw new Error("Pass at least one absolute TradingView CSV path");
}

const outputDir =
  process.env.ALCHEMY_RESEARCH_DATA_DIR
  ?? fileURLToPath(new URL("../../../../.research-data/", import.meta.url));

const result = await importTradingViewOhlcvDataset({
  sourcePaths,
  asset: process.env.ALCHEMY_TV_ASSET ?? "BTC-USDC-PERP",
  venue: process.env.ALCHEMY_TV_VENUE ?? "hyperliquid",
  symbol: process.env.ALCHEMY_TV_SYMBOL ?? "BTCUSDC.P",
  interval: process.env.ALCHEMY_TV_INTERVAL ?? "5m",
  outputDir,
});

console.log(JSON.stringify({
  datasetId: result.manifest.datasetId,
  datasetVersion: result.manifest.datasetVersion,
  contentHash: result.manifest.contentHash,
  rows: result.manifest.rowCount,
  eventStart: result.manifest.eventStart,
  eventEnd: result.manifest.eventEnd,
  frozenAt: result.manifest.frozenAt,
  validation: result.validation,
  canonicalPath: result.canonicalPath,
  rawPaths: result.rawPaths,
  manifestPath: result.manifestPath,
  registration: null,
  executionAllowed: false,
}, null, 2));
process.exit(0);
