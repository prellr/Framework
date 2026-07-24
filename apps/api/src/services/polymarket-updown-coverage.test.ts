import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RETROSPECTIVE_UPDOWN_PAIRS,
  updownPairOfQuestion,
} from "./polymarket-updown.ts";

test("retrospective scorer maps the exact six-asset Up/Down universe", () => {
  assert.deepEqual(RETROSPECTIVE_UPDOWN_PAIRS, [
    "BTC-USD",
    "ETH-USD",
    "SOL-USD",
    "XRP-USD",
    "DOGE-USD",
    "BNB-USD",
  ]);
  assert.equal(
    updownPairOfQuestion("Bitcoin Up or Down - July 24, 4:00PM-4:05PM ET"),
    "BTC-USD",
  );
  assert.equal(updownPairOfQuestion("Ethereum Up or Down"), "ETH-USD");
  assert.equal(updownPairOfQuestion("Solana Up or Down"), "SOL-USD");
  assert.equal(updownPairOfQuestion("XRP Up or Down"), "XRP-USD");
  assert.equal(updownPairOfQuestion("Dogecoin Up or Down"), "DOGE-USD");
  assert.equal(updownPairOfQuestion("BNB Up or Down"), "BNB-USD");
  assert.equal(updownPairOfQuestion("Binance Coin Up or Down"), "BNB-USD");
  assert.equal(updownPairOfQuestion("HYPE Up or Down"), null);
});

test("discovery, book capture, and asset summaries share the six-asset constant", () => {
  const source = readFileSync(
    new URL("./polymarket-updown.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /RETROSPECTIVE_UPDOWN_PAIR_SET\.has\(p\)/,
  );
  assert.match(
    source,
    /RETROSPECTIVE_UPDOWN_PAIR_SET\.has\(pair\)/,
  );
  assert.match(
    source,
    /fadeByCoin:\s*RETROSPECTIVE_UPDOWN_PAIRS\.map/,
  );
  assert.match(source, /\bfetchClobBooks\b/);
  assert.doesNotMatch(source, /\bfetchClobBook\b/);
  assert.doesNotMatch(
    source,
    /p\s*===\s*["']BTC-USD["']\s*\|\|\s*p\s*===\s*["']ETH-USD["']/,
  );
});

test("six-asset coverage repair remains outside the forward paper verdict path", () => {
  const source = readFileSync(
    new URL("./polymarket-updown.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\b(?:PAPER_BOTS|PAPER_FAMILYWISE|paperTrades|paper_trade)\b/,
  );
  assert.match(source, /No orders, no funds/);
  assert.match(source, /polymarketUpdownScores/);
  assert.match(source, /polymarketBookSnapshots/);
});
