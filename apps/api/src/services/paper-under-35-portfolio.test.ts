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
  assert.match(router, /under35Portfolio:\s*protectedProcedure[\s\S]*?\.query/);
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
  assert.match(page, /Select visible/);
  assert.match(page, /Clear visible/);
  assert.match(page, /SELECTION_STORAGE_KEY/);
  assert.match(page, /PolymarketSortableHeader/);
  assert.match(page, /Research selection · no strategy mutation/);
});
