import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importTradingViewOhlcvDataset } from "./tradingview-ohlcv-dataset.ts";

const importedAtMs = Date.UTC(2026, 6, 24, 22);

test("TradingView import preserves raw CSVs, excludes derived columns, and segments gaps", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alchemy-tv-ohlcv-"));
  const outputDir = path.join(root, "output");
  const firstPath = path.join(root, "first.csv");
  const secondPath = path.join(root, "second.csv");
  const header = "time,open,high,low,close,Example Signal,Volume\n";
  const first = [
    header,
    "1754265600,100,103,99,102,1,10\n",
    "1754265900,102,104,101,103,0,11\n",
  ].join("");
  const second = [
    header,
    "1754265900,102,104,101,103,999,11\n",
    "1754266500,103,105,102,104,1,12\n",
  ].join("");
  await writeFile(firstPath, first);
  await writeFile(secondPath, second);

  try {
    const result = await importTradingViewOhlcvDataset({
      sourcePaths: [firstPath, secondPath],
      asset: "BTC-USDC-PERP",
      venue: "hyperliquid",
      symbol: "BTCUSDC.P",
      interval: "5m",
      outputDir,
      importedAtMs,
    });

    assert.equal(result.manifest.rowCount, 3);
    assert.deepEqual(result.manifest.assets, ["BTC-USDC-PERP"]);
    assert.equal(result.manifest.labelSpec.kind, "none");
    assert.equal(result.manifest.targetSpecs[0]?.executionAllowed, false);
    assert.equal(result.validation.identicalDuplicatesRemoved, 1);
    assert.equal(result.validation.gapCount, 1);
    assert.equal(result.validation.missingBars, 1);
    assert.equal(result.validation.segments, 2);
    assert.deepEqual(result.validation.excludedDerivedColumns, ["Example Signal"]);

    const canonical = (await readFile(result.canonicalPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(canonical[0].segment_id, 1);
    assert.equal(canonical[1].segment_id, 1);
    assert.equal(canonical[2].segment_id, 2);
    assert.equal(canonical[0].bar_available_at_ms, 1_754_265_899_999);
    assert.equal(canonical[0]["Example Signal"], undefined);
    assert.equal(canonical[2].close_time_ms, 1_754_266_799_999);

    assert.equal(await readFile(result.rawPaths[0]!, "utf8"), first);
    assert.equal(await readFile(result.rawPaths[1]!, "utf8"), second);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TradingView import rejects conflicting duplicate OHLCV bars", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alchemy-tv-conflict-"));
  const outputDir = path.join(root, "output");
  const firstPath = path.join(root, "first.csv");
  const secondPath = path.join(root, "second.csv");
  const header = "time,open,high,low,close,Volume\n";
  await writeFile(firstPath, `${header}1754265600,100,103,99,102,10\n`);
  await writeFile(secondPath, `${header}1754265600,100,103,99,101,10\n`);

  try {
    await assert.rejects(
      importTradingViewOhlcvDataset({
        sourcePaths: [firstPath, secondPath],
        asset: "BTC-USDC-PERP",
        venue: "hyperliquid",
        symbol: "BTCUSDC.P",
        interval: "5m",
        outputDir,
        importedAtMs,
      }),
      /conflictingDuplicates=1/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
