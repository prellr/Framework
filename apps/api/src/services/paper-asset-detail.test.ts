import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiRouter = readFileSync(
  new URL("../routers/polymarket.ts", import.meta.url),
  "utf8",
);
const floorSource = readFileSync(
  new URL("./paper-floor.ts", import.meta.url),
  "utf8",
);
const performanceSource = readFileSync(
  new URL("./paper-performance.ts", import.meta.url),
  "utf8",
);
const webRouter = readFileSync(
  new URL("../../../web/src/router.tsx", import.meta.url),
  "utf8",
);
const assetPage = readFileSync(
  new URL("../../../web/src/pages/polymarket/PolymarketAssetDetailPage.tsx", import.meta.url),
  "utf8",
);
const assetLink = readFileSync(
  new URL("../../../web/src/pages/polymarket/PolymarketAssetLink.tsx", import.meta.url),
  "utf8",
);
const performanceLens = readFileSync(
  new URL("../../../web/src/pages/polymarket/PolymarketPerformanceLens.tsx", import.meta.url),
  "utf8",
);

test("Polymarket assets have a routeable evidence-only research page", () => {
  assert.match(webRouter, /path:\s*"\/polymarket\/asset\/\$asset"/);
  assert.match(assetLink, /to="\/polymarket\/asset\/\$asset"/);
  assert.match(assetPage, /Unique market direction by day/);
  assert.match(assetPage, /Strategy comparison/);
  assert.match(assetPage, /Recent \{asset\} \{horizonMin\}m paper decisions/);
  assert.match(assetPage, /function SortHeader/);
  assert.match(assetPage, /aria-sort=/);
  assert.match(assetPage, /toggleStrategySort/);
  assert.match(assetPage, /toggleDailySort/);
  assert.match(assetPage, /toggleFeedSort/);
  assert.match(assetPage, /paper evidence only/);
  assert.doesNotMatch(assetPage, /polymarket\.floor/);
  assert.doesNotMatch(assetPage, /placeOrder|createOrder|walletPrivateKey|privateKey/);
});

test("asset detail queries are bounded, read-only, and keep asset slices diagnostic", () => {
  assert.match(apiRouter, /assetFeed:\s*protectedProcedure/);
  assert.match(apiRouter, /\.query\(\(\{ input \}\) => paperAssetFeed\(input\)\)/);
  assert.doesNotMatch(apiRouter, /assetFeed:[\s\S]{0,600}\.mutation\(/);
  assert.match(floorSource, /export async function paperAssetFeed/);
  assert.match(floorSource, /Math\.min\(200/);
  assert.match(performanceSource, /eq\(paperTrades\.pair, `\$\{asset\}-USD`\)/);
  assert.match(performanceSource, /rows are a diagnostic slice/);
});

test("strategy-timeframe rows and asset labels expose contextual detail links", () => {
  assert.match(performanceLens, /to="\/polymarket\/strategy\/\$botKey"/);
  assert.match(performanceLens, /horizon:\s*row\.horizonMin === 15 \? 15 : 5/);
  assert.match(performanceLens, /<PolymarketAssetLink/);
});
