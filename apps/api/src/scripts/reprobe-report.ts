/**
 * Re-probe of JESTER_API_REPORT.md findings, run after the report was handed to Jester.
 * READ-ONLY: no subscribe / apply / optimize_start — nothing here mutates the live account or
 * spends a trade action. Findings 1, 3, 6, 10 require a live activation or a fresh backtest to
 * observe and are intentionally NOT triggered here; they're checked passively where possible.
 */
import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";

const j = (v: any, n = 1200) => JSON.stringify(v, null, 2).slice(0, n);

async function main() {
  const [c] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!c) return console.log("no cred");
  const uid = c.userId;
  const tool = (name: string, args: any = {}) =>
    jesterCall(uid, "POST", "/api/delegated/mcp/tool", { name, args }).catch((e) => ({ __err: e instanceof Error ? e.message : String(e) }));

  // ── F2: /pnl/summary period PnL always zero ───────────────────────────────
  console.log("\n========== F2: /pnl/summary period PnL ==========");
  const pnl: any = await jesterCall(uid, "GET", "/api/delegated/pnl/summary").catch((e) => ({ __err: String(e) }));
  console.log("pnl block:", j(pnl?.pnl ?? pnl, 400));
  const pb = pnl?.pnl ?? {};
  const anyNonZero = ["total", "today", "week", "month"].some((k) => Number(pb[k]) !== 0);
  console.log(`VERDICT F2: ${anyNonZero ? "FIXED — period PnL now populated" : "unchanged — still all zero"}`);

  // ── F4: my_live_performance omits strategies ──────────────────────────────
  console.log("\n========== F4: my_live_performance vs my_strategies ==========");
  const live: any = await tool("jester_my_live_performance");
  const mine: any = await tool("jester_my_strategies");
  const liveRows = live?.result?.rows ?? live?.result?.strategies ?? [];
  const mineRows = mine?.result?.strategies ?? mine?.result?.rows ?? [];
  console.log(`my_live_performance -> ${Array.isArray(liveRows) ? liveRows.length : "?"} (count field: ${live?.result?.count})`);
  console.log(`my_strategies       -> ${Array.isArray(mineRows) ? mineRows.length : "?"}`);
  const omitted = live?.result?.omitted ?? live?.result?.excluded ?? null;
  console.log(`omitted/excluded field present: ${omitted != null ? j(omitted, 200) : "no"}`);
  console.log(`VERDICT F4: ${Array.isArray(liveRows) && Array.isArray(mineRows) && liveRows.length >= mineRows.length ? "FIXED — parity" : omitted != null ? "IMPROVED — omission now disclosed" : "unchanged — silently fewer rows"}`);

  // ── F5: errors nested under result.error, no top-level error/code ──────────
  console.log("\n========== F5: error surfacing (resolve a bogus hash) ==========");
  const bogus: any = await tool("jester_param_hash_resolve", { paramHash: "deadbeef0000", strategyId: "bb_hybrid" });
  console.log("keys:", Object.keys(bogus?.result ?? bogus ?? {}).join(", "));
  console.log("top-level error:", bogus?.error ?? "(absent)");
  console.log("machine code:", bogus?.code ?? bogus?.result?.code ?? "(absent)");
  console.log("result.error:", bogus?.result?.error ?? bogus?.__err ?? "(absent)");
  console.log(`VERDICT F5: ${bogus?.error || bogus?.code || bogus?.result?.code ? "IMPROVED — top-level error/code now present" : "unchanged — reason only under result.error"}`);

  // ── F11: optimizer cache coverage + bulk endpoints empty ──────────────────
  console.log("\n========== F11: optimizer cache coverage ==========");
  const top: any = await tool("jester_top_backtests", { limit: 300 });
  const cov = top?.result?.optimizationCacheCoverage ?? null;
  console.log("coverage:", j(cov, 400));
  const bulkRest: any = await jesterCall(uid, "GET", "/api/delegated/strategies/top-optimized-combos?pair=BTC-USD&timeframe=15m&days=30&perStrategy=3&limit=200").catch((e) => ({ __err: String(e) }));
  const bulkCount = bulkRest?.count ?? bulkRest?.result?.count ?? (Array.isArray(bulkRest?.combos) ? bulkRest.combos.length : "?");
  const disc: any = await tool("jester_discover_optimized_combos", { pair: "BTC-USD", timeframe: "15m", days: 30, limit: 100 });
  console.log(`REST top-optimized-combos count: ${bulkCount}`);
  console.log(`discover_optimized_combos count: ${disc?.result?.count ?? "?"}`);
  const withCache = cov?.withCachedOptimizedParams ?? 0;
  console.log(`VERDICT F11: ${withCache > 10 ? `IMPROVED — ${withCache} strategies cached now` : `roughly unchanged — ${withCache}/${cov?.totalBacktestable ?? "?"} cached`}`);

  // ── F13a: recommendation carries no backtest window ───────────────────────
  console.log("\n========== F13a: recommendation window/provenance ==========");
  const picks = top?.result?.backtests ?? top?.result?.strategies ?? top?.result ?? [];
  const first = Array.isArray(picks) ? picks[0] : (Array.isArray(picks?.rows) ? picks.rows[0] : null);
  console.log("sample pick:", j(first, 600));
  const windowFields = ["days", "testDays", "startDate", "endDate", "span", "spanDays", "periodDays"].filter((k) => first && first[k] != null);
  console.log(`VERDICT F13a: ${windowFields.length ? `FIXED — window present (${windowFields.join(", ")})` : "unchanged — no time denominator on the pick"}`);

  // ── F13b: three endpoints disagree for bb_hybrid ──────────────────────────
  console.log("\n========== F13b: cross-endpoint agreement (bb_hybrid) ==========");
  const bbTop = Array.isArray(picks) ? picks.find((p: any) => (p.id ?? p.strategyId) === "bb_hybrid") : null;
  const rank: any = await tool("jester_cached_backtest_ranking", { strategyId: "bb_hybrid" });
  const rr = rank?.result ?? {};
  console.log(`top_backtests   bb_hybrid: ${bbTop ? `${bbTop.pair}/${bbTop.timeframe} ${bbTop.totalReturn}%` : "(not in list)"}`);
  console.log(`cached_ranking  bb_hybrid: headline=${rr.headline ?? "?"} mostProfitablePair=${j(rr.mostProfitablePair, 120)}`);
  const rankedPairs = (rr.rankedPairs ?? []).map((p: any) => `${p.pair}/${p.timeframe} ${p.totalReturn ?? p.return}%`);
  console.log(`  rankedPairs: ${rankedPairs.slice(0, 6).join(" | ") || "(none)"}`);
  const topCell = bbTop ? `${bbTop.pair}/${bbTop.timeframe}` : null;
  const rankLists = topCell ? rankedPairs.some((s: string) => s.startsWith(topCell)) : false;
  console.log(`VERDICT F13b: ${bbTop && rankLists ? "IMPROVED — ranking now lists the picked cell" : "unchanged — endpoints still name different best cells"}`);

  // ── F12: hash resolvability of cached top backtests ───────────────────────
  console.log("\n========== F12: hash resolvability of cached picks ==========");
  const sample = (Array.isArray(picks) ? picks : []).filter((p: any) => p.paramHash && p.source === "optimized").slice(0, 6);
  let ok = 0;
  for (const p of sample) {
    const r: any = await tool("jester_param_hash_resolve", { paramHash: p.paramHash, strategyId: p.id ?? p.strategyId });
    const n = r?.result?.parameters ? Object.keys(r.result.parameters).length : (r?.result?.count ?? 0);
    const good = n > 0 && !r?.result?.error && !r?.__err;
    if (good) ok++;
    console.log(`  ${(p.id ?? p.strategyId).padEnd(28)} ${String(p.paramHash).padEnd(14)} -> ${good ? `${n} params` : (r?.result?.error ?? r?.__err ?? "no params")}`);
  }
  console.log(`VERDICT F12: ${sample.length ? `${ok}/${sample.length} resolvable` : "no optimized picks to test"}`);

  console.log("\n========== done ==========");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
