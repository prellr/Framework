import assert from "node:assert/strict";
import test from "node:test";
import {
  COBRA_5M_NIGHT_PRICER,
  COBRA_SESSION_PRICER,
  cobra5mNightPricerEligible,
  cobraSessionPricerEligible,
  ukTradingSessionAt,
} from "./cobra-session-pricer.ts";

test("uses the preregistered forward boundary", () => {
  assert.equal(new Date(COBRA_SESSION_PRICER.evalStartMs).toISOString(), "2026-07-23T04:30:00.000Z");
});

test("assigns July instants by Europe/London decision time", () => {
  // July is BST (UTC+1): 05:59Z=06:59, 06:00Z=07:00, 18:00Z=19:00, 22:00Z=23:00.
  assert.equal(ukTradingSessionAt(Date.parse("2026-07-23T05:59:59Z")), "night23-07");
  assert.equal(ukTradingSessionAt(Date.parse("2026-07-23T06:00:00Z")), "day07-19");
  assert.equal(ukTradingSessionAt(Date.parse("2026-07-23T17:59:59Z")), "day07-19");
  assert.equal(ukTradingSessionAt(Date.parse("2026-07-23T18:00:00Z")), "eve19-23");
  assert.equal(ukTradingSessionAt(Date.parse("2026-07-23T21:59:59Z")), "eve19-23");
  assert.equal(ukTradingSessionAt(Date.parse("2026-07-23T22:00:00Z")), "night23-07");
});

test("allows only 15m night/evening decisions", () => {
  const night = Date.parse("2026-07-23T04:30:00Z"); // 05:30 BST
  const day = Date.parse("2026-07-23T12:00:00Z"); // 13:00 BST
  const evening = Date.parse("2026-07-23T19:00:00Z"); // 20:00 BST
  assert.equal(cobraSessionPricerEligible(15, night), true);
  assert.equal(cobraSessionPricerEligible(15, evening), true);
  assert.equal(cobraSessionPricerEligible(15, day), false);
  assert.equal(cobraSessionPricerEligible(5, night), false);
  assert.equal(cobraSessionPricerEligible(60, evening), false);
});

test("5m Cobra night child is future-dated and changes only session eligibility", () => {
  assert.equal(COBRA_5M_NIGHT_PRICER.version, "updown-pricer-mc-5m-cobra-night-v1");
  assert.equal(new Date(COBRA_5M_NIGHT_PRICER.evalStartMs).toISOString(), "2026-07-25T00:00:00.000Z");
  assert.equal(COBRA_5M_NIGHT_PRICER.parentKey, "pricerMC");
  const night = Date.parse("2026-07-25T00:30:00Z"); // 01:30 BST
  const day = Date.parse("2026-07-25T12:00:00Z"); // 13:00 BST
  const evening = Date.parse("2026-07-25T19:00:00Z"); // 20:00 BST
  assert.equal(cobra5mNightPricerEligible(5, night), true);
  assert.equal(cobra5mNightPricerEligible(5, day), false);
  assert.equal(cobra5mNightPricerEligible(5, evening), false);
  assert.equal(cobra5mNightPricerEligible(15, night), false);
});
