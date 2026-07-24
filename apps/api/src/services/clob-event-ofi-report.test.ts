import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CLOB_EVENT_OFI_TAPE } from "./clob-event-ofi.ts";
import {
  assertOutcomeBlindClobEventStatus,
  clobEventOfiReady,
} from "./clob-event-ofi-report.ts";

const readyInput = {
  usableRows: CLOB_EVENT_OFI_TAPE.minRows,
  resolvedMarkets: CLOB_EVENT_OFI_TAPE.minMarkets,
  spanDays: CLOB_EVENT_OFI_TAPE.minSpanDays,
  coverage: CLOB_EVENT_OFI_TAPE.minCoverage,
  weakestBucketMarkets: CLOB_EVENT_OFI_TAPE.minRowsPerBucket,
  healthy: true,
};

test("CLOB event-OFI readiness requires every frozen floor", () => {
  assert.equal(clobEventOfiReady(readyInput), true);
  for (const [key, value] of Object.entries({
    usableRows: CLOB_EVENT_OFI_TAPE.minRows - 1,
    resolvedMarkets: CLOB_EVENT_OFI_TAPE.minMarkets - 1,
    spanDays: CLOB_EVENT_OFI_TAPE.minSpanDays - 0.001,
    coverage: CLOB_EVENT_OFI_TAPE.minCoverage - Number.EPSILON,
    weakestBucketMarkets: CLOB_EVENT_OFI_TAPE.minRowsPerBucket - 1,
    healthy: false,
  })) {
    assert.equal(clobEventOfiReady({ ...readyInput, [key]: value }), false, `${key} must fail`);
  }
});

test("CLOB event-OFI readiness disclosure blocks signs, outcomes, and performance", () => {
  assert.doesNotThrow(() =>
    assertOutcomeBlindClobEventStatus({
      usableRows: 20_000,
      resolvedMarkets: 1_500,
      operationalCoverage: {
        windowMin: 30,
        eligibleRows: 360,
        usableRows: 360,
        coverage: 1,
        pairedBookEligibleRows: 330,
        pairedBookUsableRows: 330,
        pairedBookCoverage: 1,
        pairedBookUnavailableRows: 30,
        transportMissingRows: 0,
      },
      operationalHealth: { latestMarketDataAgeSec: 1 },
      readyForOutcomeFreeDistributionAudit: false,
    }),
  );
  for (const forbidden of [
    { canonical60s: 0.2 },
    { nested: { outcome: "UP" } },
    { strategy: { chosenSide: "DOWN" } },
    { performance: { pnl: 10, winRate: 0.6 } },
  ]) {
    assert.throws(
      () => assertOutcomeBlindClobEventStatus(forbidden),
      /readiness disclosure blocked/,
    );
  }
});

test("CLOB event-OFI readiness query checks values but never selects them", () => {
  const source = readFileSync(new URL("./clob-event-ofi-report.ts", import.meta.url), "utf8");
  assert.match(source, /isNotNull\(polymarketStateSnapshots\.clobEventOfiCanonical60s\)/);
  assert.doesNotMatch(source, /canonical60s:\s*polymarketStateSnapshots/);
  assert.match(source, /labelStatus} = 'resolved'[\s\S]*?and \$\{usableFlow\}/);
  assert.match(source, /OPERATIONAL_COVERAGE_WINDOW_MIN = 30/);
  assert.match(source, /operationalEligibleRows[\s\S]*?operationalUsableRows/);
  assert.match(
    source,
    /operationalPairedBookEligibleRows[\s\S]*?operationalPairedBookUsableRows/,
  );
  assert.match(source, /operationalTransportMissingRows/);
  assert.match(source, /coverage,\s*operationalCoverage:/);
});

test("CLOB event-OFI launch audit reads only collection metadata and nullability", () => {
  const source = readFileSync(
    new URL("../scripts/record-clob-event-ofi-launch-success.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /count\(\*\) filter/);
  assert.match(source, /clob_event_ofi_canonical_60s is null/);
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|chosen_side|raw_net|worst_case_net)\b/i,
  );
  assert.doesNotMatch(source, /select\s*\(\s*\{[^}]*clobEventOfiCanonical/is);
});

test("pre-boundary transport amendment records provenance without reading evidence", () => {
  const source = readFileSync(
    new URL("../scripts/record-clob-event-ofi-transport-hardening.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Pre-boundary transport hardening/);
  assert.match(source, /silent-freeze report/);
  assert.doesNotMatch(
    source,
    /\b(?:polymarket_state_snapshot|paper_trade|resolved_up|label_status|chosen_side|raw_net|worst_case_net)\b/i,
  );
});

test("observation-clock repair records only outcome-blind launch operations", () => {
  const source = readFileSync(
    new URL("../scripts/record-clob-event-ofi-observation-clock-repair.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Post-boundary launch incident — observation-clock repair/);
  assert.match(source, /tick-start timestamp/);
  assert.match(source, /tagged_rows/);
  assert.doesNotMatch(
    source,
    /\b(?:canonical|paper_trade|resolved_up|label_status|chosen_side|pnl|win_rate|raw_net|worst_case_net)\b/i,
  );
});

test("partial-initialization hardening records counts and transport state only", () => {
  const source = readFileSync(
    new URL(
      "../scripts/record-clob-event-ofi-partial-initialization-hardening.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /partial current-book initialization/);
  assert.match(source, /tagged_rows/);
  assert.match(source, /code 1006/);
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|chosen_side|pnl|win_rate|raw_net|worst_case_net)\b/i,
  );
  assert.doesNotMatch(source, /clob_event_ofi_(?:canonical|up_events|down_events|source_age)/i);
});

test("snapshot-guard correction preserves real one-sided-book coverage failures", () => {
  const source = readFileSync(
    new URL(
      "../scripts/record-clob-event-ofi-snapshot-guard-correction.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /snapshot receipt vs two-sided quote/);
  assert.match(source, /Empty or one-sided books remain null/);
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|chosen_side|pnl|win_rate|raw_net|worst_case_net)\b/i,
  );
  assert.doesNotMatch(source, /clob_event_ofi_(?:canonical|up_events|down_events|source_age)/i);
});

test("source-clock amendment is transport-only and retains the late-event limit", () => {
  const source = readFileSync(
    new URL(
      "../scripts/record-clob-event-ofi-source-clock-tolerance.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /source-clock tolerance/);
  assert.match(source, /maxSourceClockLeadMs !== 250/);
  assert.match(source, /maxTransportLagMs !== 30_000/);
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|chosen_side|pnl|win_rate|raw_net|worst_case_net)\b/i,
  );
  assert.doesNotMatch(source, /clob_event_ofi_(?:canonical|up_events|down_events|source_age)/i);
});

test("live-subscription scope amendment reads collection tags only and preserves discovery", () => {
  const source = readFileSync(
    new URL(
      "../scripts/record-clob-event-ofi-live-subscription-scope.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /bounded live subscription scope/i);
  assert.match(source, /marketLookaheadHours !== 3/);
  assert.match(source, /subscriptionLeadMs !== 60_000/);
  assert.match(source, /36 abnormal code 1006 socket closes/);
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|chosen_side|pnl|win_rate|raw_net|worst_case_net)\b/i,
  );
  assert.doesNotMatch(source, /clob_event_ofi_(?:canonical|up_events|down_events|source_age)/i);
});

test("partial-discovery retention amendment uses touch nullability without reading values", () => {
  const source = readFileSync(
    new URL(
      "../scripts/record-clob-event-ofi-partial-discovery-retention.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /partial discovery retention/i);
  assert.match(source, /up_bid is not null/);
  assert.match(source, /two_sided_missing_rows/);
  assert.match(source, /subscribing to only 16 tokens/);
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|chosen_side|pnl|win_rate|raw_net|worst_case_net)\b/i,
  );
  assert.doesNotMatch(source, /select[\s\S]*?\b(?:up_bid|up_ask|down_bid|down_ask)\b\s*,/i);
  assert.doesNotMatch(source, /clob_event_ofi_(?:canonical|up_events|down_events|source_age)/i);
});

test("complete-current discovery amendment records pagination evidence without outcomes", () => {
  const source = readFileSync(
    new URL(
      "../scripts/record-clob-event-ofi-complete-current-discovery.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /complete current-market discovery/i);
  assert.match(source, /lookaheadMin !== 15/);
  assert.match(source, /pageSize !== 100/);
  assert.match(
    source,
    /Number\(CURRENT_UPDOWN_DISCOVERY\.maxPages\) !== 5/,
  );
  assert.match(source, /cacheMs !== 20_000/);
  assert.match(source, /20 instead of the expected live universe/);
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|chosen_side|pnl|win_rate|raw_net|worst_case_net)\b/i,
  );
  assert.doesNotMatch(source, /select[\s\S]*?\b(?:up_bid|up_ask|down_bid|down_ask)\b\s*,/i);
  assert.doesNotMatch(source, /clob_event_ofi_(?:canonical|up_events|down_events|source_age)/i);
});

test("complete-current discovery launch receipt preserves the frozen gate and reads no values", () => {
  const source = readFileSync(
    new URL(
      "../scripts/record-clob-event-ofi-complete-current-discovery-launch.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /complete current-market discovery launch receipt/i);
  assert.match(source, /minCoverage !== 0\.95/);
  assert.match(source, /eligibleRows < 144/);
  assert.match(source, /tagged_buckets/);
  assert.match(source, /24\/24 initialized books/);
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|chosen_side|pnl|win_rate|raw_net|worst_case_net)\b/i,
  );
  assert.doesNotMatch(source, /select[\s\S]*?\b(?:up_bid|up_ask|down_bid|down_ask)\b\s*,/i);
  assert.doesNotMatch(source, /clob_event_ofi_(?:canonical|up_events|down_events|source_age)/i);
});

test("reduced-scope WebSocket probe records a no-change transport disposition", () => {
  const source = readFileSync(
    new URL(
      "../scripts/record-clob-websocket-health-probe.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /Outcome-blind reduced-scope WebSocket probe/);
  assert.match(source, /12 outcome tokens/);
  assert.match(source, /1 abnormal code-1006 close/);
  assert.match(source, /61 usable of 66 eligible rows/);
  assert.match(source, /no collector-scope or reconnect change is authorized/);
  assert.match(source, /frozen 95% cumulative coverage floor/);
  assert.doesNotMatch(
    source,
    /\b(?:paper_trade|resolved_up|label_status|chosen_side|pnl|win_rate|raw_net|worst_case_net)\b/i,
  );
  assert.doesNotMatch(source, /select[\s\S]*?\b(?:up_bid|up_ask|down_bid|down_ask)\b\s*,/i);
  assert.doesNotMatch(source, /clob_event_ofi_(?:canonical|up_events|down_events|source_age)/i);
});

test("complete-snapshot recovery records predeploy and launch nullability without values", () => {
  const amendment = readFileSync(
    new URL(
      "../scripts/record-clob-event-ofi-snapshot-recovery-backoff.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(amendment, /complete-snapshot reconnect recovery/i);
  assert.match(amendment, /tradeFlowCurrentSnapshotsReady\(24, 24\)/);
  assert.match(amendment, /adds no socket, subscription, poll, table, row/);
  assert.doesNotMatch(
    amendment,
    /\b(?:paper_trade|resolved_up|label_status|chosen_side|pnl|win_rate|raw_net|worst_case_net)\b/i,
  );

  const launch = readFileSync(
    new URL(
      "../scripts/record-clob-event-ofi-snapshot-recovery-launch.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(launch, /2026-07-24T13:08:15\.000Z/);
  assert.match(launch, /paired_book_unavailable_rows/);
  assert.match(launch, /transport_missing_rows/);
  assert.match(launch, /noTransportMissingRows/);
  assert.match(launch, /noPartialTaggedRows/);
  assert.doesNotMatch(
    launch,
    /\b(?:paper_trade|resolved_up|label_status|chosen_side|pnl|win_rate|raw_net|worst_case_net)\b/i,
  );
  assert.doesNotMatch(
    launch,
    /select[\s\S]*?\b(?:up_bid|up_ask|down_bid|down_ask)\b\s*,/i,
  );
});
