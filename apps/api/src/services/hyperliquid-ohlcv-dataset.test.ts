import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  pullHyperliquidOhlcvDataset,
  validateHyperliquidOhlcv,
} from "./hyperliquid-ohlcv-dataset.ts";
import type { HlCandleSnapshot } from "./hyperliquid.ts";

const DAY_MS = 86_400_000;
const start = Date.UTC(2026, 6, 21);

const candles = Array.from({ length: 3 }, (_, index): HlCandleSnapshot => {
  const t = start + index * DAY_MS;
  return {
    t,
    T: t + DAY_MS - 1,
    s: "BTC",
    i: "1d",
    o: 100 + index,
    h: 103 + index,
    l: 99 + index,
    c: 102 + index,
    v: 10 + index,
    n: 100 + index,
  };
});

test("OHLCV validation accepts a complete aligned candle series", () => {
  const result = validateHyperliquidOhlcv({
    candles,
    coin: "BTC",
    interval: "1d",
    startTime: start,
    endExclusive: start + 3 * DAY_MS,
  });
  assert.equal(result.rows, 3);
  assert.equal(result.gaps, 0);
  assert.equal(result.invalidOhlcv, 0);
});

test("OHLCV validation rejects gaps and partial candles", () => {
  assert.throws(
    () =>
      validateHyperliquidOhlcv({
        candles: [candles[0]!, candles[2]!],
        coin: "BTC",
        interval: "1d",
        startTime: start,
        endExclusive: start + 3 * DAY_MS,
      }),
    /incomplete/,
  );

  const partial = candles.map((candle) => ({ ...candle }));
  partial[2]!.T -= 1;
  assert.throws(
    () =>
      validateHyperliquidOhlcv({
        candles: partial,
        coin: "BTC",
        interval: "1d",
        startTime: start,
        endExclusive: start + 3 * DAY_MS,
      }),
    /invalid=1/,
  );
});

test("pull writes immutable raw, canonical, and manifest artifacts", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "alchemy-hl-ohlcv-"));
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      type: string;
      req: { coin: string; interval: string; startTime: number; endTime: number };
    };
    assert.equal(request.type, "candleSnapshot");
    assert.deepEqual(request.req, {
      coin: "BTC",
      interval: "1d",
      startTime: start,
      endTime: start + 3 * DAY_MS - 1,
    });
    return new Response(JSON.stringify(candles.map((candle) => ({
      ...candle,
      o: String(candle.o),
      h: String(candle.h),
      l: String(candle.l),
      c: String(candle.c),
      v: String(candle.v),
    }))));
  };

  try {
    const result = await pullHyperliquidOhlcvDataset({
      coin: "BTC",
      interval: "1d",
      lookbackDays: 3,
      outputDir,
      nowMs: start + 3 * DAY_MS,
      fetcher,
    });
    assert.equal(result.manifest.rowCount, 3);
    assert.deepEqual(result.manifest.assets, ["BTC-USD"]);
    assert.equal(result.manifest.labelSpec.kind, "none");
    assert.equal(result.manifest.targetSpecs[0]?.executionAllowed, false);
    assert.match(result.manifest.contentHash, /^sha256:[a-f0-9]{64}$/);

    const canonical = await readFile(result.canonicalPath, "utf8");
    const rows = canonical.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(rows.length, 3);
    assert.equal(rows[0].open, 100);
    assert.equal(rows[2].trade_count, 102);

    const raw = JSON.parse(await readFile(result.rawPath, "utf8"));
    assert.equal(raw.request.type, "candleSnapshot");
    assert.equal(raw.candles[0].o, "100");

    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.contentHash, result.manifest.contentHash);
    assert.equal(manifest.availabilityClock, "receive_clock");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
