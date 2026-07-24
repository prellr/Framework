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
const webRouter = readFileSync(
  new URL("../../../web/src/router.tsx", import.meta.url),
  "utf8",
);
const detailPage = readFileSync(
  new URL("../../../web/src/pages/polymarket/PolymarketStrategyDetailPage.tsx", import.meta.url),
  "utf8",
);
const paperFloorPage = readFileSync(
  new URL("../../../web/src/pages/polymarket/PolymarketPaperFloor.tsx", import.meta.url),
  "utf8",
);
const scoreboardPage = readFileSync(
  new URL("../../../web/src/pages/polymarket/PolymarketScoreboard.tsx", import.meta.url),
  "utf8",
);
const strategyLabPage = readFileSync(
  new URL("../../../web/src/pages/polymarket/PolymarketStrategyLab.tsx", import.meta.url),
  "utf8",
);

test("every paper strategy has a routeable evidence-only detail surface", () => {
  assert.match(webRouter, /path:\s*"\/polymarket\/strategy\/\$botKey"/);
  assert.match(detailPage, /PolymarketDailyRawLedger/);
  assert.match(detailPage, /Scope-to-date asset buckets/);
  assert.match(detailPage, /Segmentation/);
  assert.match(detailPage, /Recent \{horizonMin\}m decisions/);
  assert.match(paperFloorPage, /to="\/polymarket\/strategy\/\$botKey"/);
  assert.match(scoreboardPage, /to="\/polymarket\/strategy\/\$botKey"/);
  assert.match(scoreboardPage, /title="Daily RAW trend"/);
  assert.match(strategyLabPage, /to="\/polymarket\/strategy\/\$botKey"/);
});

test("strategy detail data remains bounded, read-only, and paper-only", () => {
  assert.match(apiRouter, /strategyFeed:\s*protectedProcedure/);
  assert.match(apiRouter, /\.query\(\(\{ input \}\) => paperStrategyFeed\(input\)\)/);
  assert.doesNotMatch(apiRouter, /strategyFeed:[\s\S]{0,500}\.mutation\(/);
  assert.match(floorSource, /Math\.min\(200/);
  assert.match(floorSource, /paperStrategyFeed/);
  assert.match(detailPage, /paper only · live locked/);
  assert.match(detailPage, /Execution" value="Locked; no route exists"/);
  assert.doesNotMatch(detailPage, /placeOrder|createOrder|walletPrivateKey|privateKey/);
});

test("daily RAW evidence uses grade-time Chicago days and never claims portfolio additivity", () => {
  const dailyLedger = readFileSync(
    new URL("./paper-daily-ledger.ts", import.meta.url),
    "utf8",
  );
  const dailyView = readFileSync(
    new URL("../../../web/src/pages/polymarket/PolymarketDailyRawLedger.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dailyLedger, /timeZone:\s*"America\/Chicago"/);
  assert.match(dailyLedger, /attributionClock:\s*"graded_at"/);
  assert.match(
    floorSource,
    /gradedAt\}\s+at time zone 'UTC'\)\s+at time zone \$\{PAPER_DAILY_LEDGER\.timeZone\}/s,
  );
  assert.match(floorSource, /currentChicagoDay = paperDailyLedgerDayKey\(now\)/);
  assert.doesNotMatch(
    floorSource,
    /\(\$\{paperTrades\.gradedAt\}\s+at time zone \$\{PAPER_DAILY_LEDGER\.timeZone\}\)::date/,
  );
  assert.match(dailyView, /Strategies are intentionally not summed/);
});
