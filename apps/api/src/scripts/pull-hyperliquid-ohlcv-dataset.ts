/**
 * Pull one bounded, read-only Hyperliquid OHLCV snapshot into Alchemy's immutable research format.
 *
 * Defaults: BTC, 15m, 30 completed UTC days. Set ALCHEMY_REGISTER_DATASET=1 to also register the
 * manifest in the research control plane. Registration remains source-only and cannot start a
 * research experiment, create a strategy, or enable execution.
 */
import { fileURLToPath } from "node:url";
import { pullHyperliquidOhlcvDataset } from "../services/hyperliquid-ohlcv-dataset.ts";

const lookbackDays = Number(process.env.ALCHEMY_HL_LOOKBACK_DAYS ?? "30");
const outputDir =
  process.env.ALCHEMY_RESEARCH_DATA_DIR
  ?? fileURLToPath(new URL("../../../../.research-data/", import.meta.url));

const result = await pullHyperliquidOhlcvDataset({
  coin: process.env.ALCHEMY_HL_COIN ?? "BTC",
  interval: process.env.ALCHEMY_HL_INTERVAL ?? "15m",
  lookbackDays,
  outputDir,
});

let registration: { id: string; status: string } | null = null;
if (process.env.ALCHEMY_REGISTER_DATASET === "1") {
  const { registerResearchDataset } = await import("../services/research-control-plane.ts");
  const registered = await registerResearchDataset(result.manifest);
  registration = { id: registered.id, status: registered.status };
}

console.log(JSON.stringify({
  datasetId: result.manifest.datasetId,
  datasetVersion: result.manifest.datasetVersion,
  contentHash: result.manifest.contentHash,
  rawContentHash: result.rawContentHash,
  rows: result.manifest.rowCount,
  eventStart: result.manifest.eventStart,
  eventEnd: result.manifest.eventEnd,
  frozenAt: result.manifest.frozenAt,
  validation: result.validation,
  canonicalPath: result.canonicalPath,
  rawPath: result.rawPath,
  manifestPath: result.manifestPath,
  registration,
  executionAllowed: false,
}, null, 2));
process.exit(0);
