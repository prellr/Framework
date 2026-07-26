import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

const { trailingUnder35DayKeys, under35LocalDayKey } =
  await import("./paper-under-35-portfolio.ts");

const service = readFileSync(new URL("./paper-under-35-portfolio.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("../routers/polymarket.ts", import.meta.url), "utf8");
const page = readFileSync(
  new URL("../../../web/src/pages/polymarket/PolymarketUnder35PortfolioPage.tsx", import.meta.url),
  "utf8",
);

test("under-35 view preserves the exact registered strategy-timeframe roster", () => {
  assert.match(service, /PAPER_BOTS\.flatMap/);
  assert.match(service, /paperBotBucketUniverse\(bot\)/);
  assert.match(service, /key:\s*`\$\{bot\.key\}:\$\{horizonMin\}`/);
  assert.match(router, /under35Portfolio:\s*managerProcedure[\s\S]*?\.query/);
});

test("under-35 evidence uses the recorded fee-adjusted ask and seven local dates", () => {
  assert.match(service, /lt\(paperTrades\.askPaid,\s*UNDER_35_MAX_ASK\)/);
  assert.match(service, /UNDER_35_MAX_ASK\s*=\s*0\.35/);
  assert.match(service, /recorded fee-adjusted \$5 book-walk VWAP/);
  assert.deepEqual(trailingUnder35DayKeys(Date.parse("2026-07-25T23:00:00Z"), "America/Chicago"), [
    "2026-07-19",
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
    "2026-07-23",
    "2026-07-24",
    "2026-07-25",
  ]);
  assert.equal(
    under35LocalDayKey(Date.parse("2026-07-26T02:00:00Z"), "America/Chicago"),
    "2026-07-25",
  );
});

test("under-35 portfolio and history accept one shared asset scope", () => {
  assert.match(router, /under35Portfolio:[\s\S]*?assets:\s*z[\s\S]*?under35TradeHistory:/);
  assert.match(router, /under35TradeHistory:[\s\S]*?assets:\s*z[\s\S]*?\.query/);
  assert.match(
    service,
    /inArray\(\s*paperTrades\.pair,\s*input\.assets\.map\(\(asset\) => `\$\{asset\}-USD`\),?\s*\)/,
  );
  assert.match(page, /function AssetSelector/);
  assert.match(page, /<AssetSelector value=\{assets\} onChange=\{setAssets\}/);
  assert.match(page, /cohortKeys:\s*historyCohortKeys,\s*assets/);
});

test("under-35 trade history is bounded, graded, and carries exact decision evidence", () => {
  assert.match(router, /under35TradeHistory:\s*managerProcedure[\s\S]*?\.query/);
  assert.match(service, /TRADE_HISTORY_LIMIT\s*=\s*10_000/);
  assert.match(service, /inArray\(paperTrades\.status,\s*\["won",\s*"lost"\]\)/);
  assert.match(service, /conditionId:\s*paperTrades\.conditionId/);
  assert.match(service, /requestedCohorts\.has\(cohort\.key\)/);
  assert.match(service, /eq\(paperTrades\.horizonMin,\s*cohort\.horizonMin\)/);
  assert.match(service, /windowStartMs:\s*row\.windowStart\.getTime\(\)/);
  assert.match(service, /decidedAtMs:\s*row\.decidedAt\.getTime\(\)/);
  assert.match(service, /ask:\s*ask/);
  assert.match(service, /rawNet:\s*num\(row\.pnlUsd\)/);
  assert.match(service, /Unique market-side exposure counts reveal strategies sharing/);
});

test("under-35 selection projection remains read-only and cannot alter strategy state", () => {
  assert.match(service, /paperOnly:\s*true as const/);
  assert.match(service, /executionCapability:\s*false as const/);
  assert.match(service, /Selections are a user-interface research workspace only/);
  assert.doesNotMatch(
    service,
    /\b(placeOrder|submitOrder|cancelOrder|privateKey|signature)\b|db\.(insert|update|delete)\(/,
  );
});

test("dedicated page exposes a seven-day sortable inclusion workbench", () => {
  assert.match(page, /Average RAW net per selected cohort/);
  assert.match(page, /data\.dayKeys\.map/);
  assert.match(page, /Activate visible/);
  assert.match(page, /Deactivate visible/);
  assert.match(page, /SELECTION_STORAGE_KEY/);
  assert.match(page, /WORKSPACE_STORAGE_KEY/);
  assert.match(page, /localStorage\.setItem\(\s*WORKSPACE_STORAGE_KEY/);
  assert.match(page, /PolymarketSortableHeader/);
  assert.match(page, /Research selection · no strategy mutation/);
  assert.match(page, /Stake per decision/);
  assert.match(page, /value:\s*50,\s*label:\s*"\$50"/);
  assert.match(page, /Trade quantity/);
  assert.match(page, /Seven-day cells/);
  assert.match(page, /Asset results across selected strategies/);
  assert.match(page, /Deactivated strategies/);
  assert.match(page, /aria-expanded/);
});

test("dedicated page groups selected trade history without deduplicating accounting", () => {
  assert.match(page, /Selected-cohort trade history/);
  assert.match(page, /Market window/);
  assert.match(page, /Calendar day/);
  assert.match(page, /cohortKeys:\s*historyCohortKeys/);
  assert.match(page, /selectedKeys\.has\(trade\.cohortKey\)/);
  assert.match(page, /`\$\{trade\.conditionId\}:\$\{trade\.side\}`/);
  assert.match(page, /overlapping strategy decisions/);
  assert.match(page, /row sums are not capital-deduplicated/);
  assert.match(page, /Entry ask/);
});
