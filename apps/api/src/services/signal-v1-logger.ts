/**
 * Jester V1 entry logger — tournament bot #5's feed. V1 (jester_v1_remastered) must be subscribed
 * on the selected Jester account before its live entry signals are available. The logger verifies
 * that external state instead of assuming it, but it never subscribes or changes the account. An early
 * symmetric-bracket screen called the entries counter-informative against an assumed 50% baseline;
 * that conclusion was retracted when the catalogue screen established an empirical centre near 40%.
 * The fixed fade/follow bridge therefore has no retrospective edge claim: both orientations stand
 * only on their separately frozen forward evidence.
 *
 * The exact sided-signal shape is unknown until the first live entry fires, so ingestion is defensive:
 *  - jester_notifications (1 call/tick): auto-trade alerts; parse V1 mentions for a BUY/SELL side.
 *  - jester_signals_history (every ~3rd tick, rate-limit-prone channel): per-pair events; use any
 *    side/direction field present.
 * Events with a parseable side land in signal_snapshot (source="jester_v1") with the REGISTERED bridge
 * pup = buy→0.75 / sell→0.25. Unsided events are logged as warnings, never guessed. Cursor in
 * app_settings prevents re-ingesting. Read-only — this logger never trades anything.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, jesterCredentials, signalSnapshots } from "@framework/db";
import { getSetting, setSetting } from "./config.ts";
import { jesterCall } from "./jester.ts";
import { resolveV1PollState } from "./signal-v1-source-health.ts";

export const V1_SOURCE = "jester_v1";
export const V1_STRATEGY_ID = "jester_v1_remastered";
const ENABLED_KEY = "v1_signal_logger_enabled"; // default armed
const CURSOR_KEY = "v1_signal_logger_cursor_ms";
const PAIRS_KEY = "v1_signal_pairs"; // pairs V1 is subscribed on (comma-sep); default BNB-USD
// REGISTERED event bridge (gate v1 amendment): a V1 BUY reads as P(up)=0.75, SELL as 0.25.
export const V1_PUP = { buy: 0.75, sell: 0.25 } as const;

const tool = (u: string, name: string, args: Record<string, unknown>) =>
  jesterCall(u, "POST", "/api/delegated/mcp/tool", { name, args }, 20_000).then((r) => r?.result ?? r);

export type V1IngestHealth = {
  written: number;
  unsided: number;
  credentialPresent: boolean;
  subscriptionChecked: boolean;
  subscribed: boolean | null;
  notificationOk: boolean;
  notificationSkipped: boolean;
  historyChecks: number;
  historySucceeded: number;
};

let cachedSubscribed: boolean | null = null;

async function readTool(
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; value: any } | { ok: false; value: null }> {
  try {
    return { ok: true, value: await tool(userId, name, args) };
  } catch {
    // The processor emits bounded source-health telemetry. Do not log payloads or duplicate a
    // potentially sensitive upstream error here.
    return { ok: false, value: null };
  }
}

export async function v1LoggerEnabled(): Promise<boolean> {
  const v = await getSetting(ENABLED_KEY);
  return v == null ? true : v === "true";
}

async function v1Pairs(): Promise<string[]> {
  const raw = await getSetting(PAIRS_KEY);
  const out = raw ? raw.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean) : [];
  return out.length ? out : ["BNB-USD"];
}

/** Best-effort side extraction from an arbitrary event/notification object. Never guesses. */
function sideOf(o: any): "buy" | "sell" | null {
  const direct = String(o?.side ?? o?.direction ?? o?.action ?? o?.type ?? "").toLowerCase();
  if (/^(buy|long)$/.test(direct)) return "buy";
  if (/^(sell|short)$/.test(direct)) return "sell";
  const text = [o?.message, o?.title, o?.body, o?.text, o?.description].filter(Boolean).join(" ").toLowerCase();
  const buy = /\b(buy|long|bought|opened long)\b/.test(text);
  const sell = /\b(sell|short|sold|opened short)\b/.test(text);
  if (buy && !sell) return "buy";
  if (sell && !buy) return "sell";
  return null; // ambiguous or absent — do not guess a direction
}

function tsOf(o: any): number | null {
  const raw = o?.timestamp ?? o?.ts ?? o?.time ?? o?.createdAt ?? o?.at ?? null;
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Date.parse(String(raw));
  return Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : null;
}

async function alreadyLogged(pair: string, eventMs: number): Promise<boolean> {
  const [row] = await db
    .select({ at: signalSnapshots.capturedAt })
    .from(signalSnapshots)
    .where(and(eq(signalSnapshots.source, V1_SOURCE), eq(signalSnapshots.pair, pair), eq(signalSnapshots.capturedAt, new Date(eventMs))))
    .limit(1);
  return !!row;
}

async function logEvent(pair: string, side: "buy" | "sell", eventMs: number, raw: unknown): Promise<boolean> {
  if (await alreadyLogged(pair, eventMs)) return false;
  await db.insert(signalSnapshots).values({
    source: V1_SOURCE,
    pair,
    capturedAt: new Date(eventMs), // the ENTRY moment, not ingestion time — alignment depends on it
    pup: V1_PUP[side],
    score: null,
    category: side,
    meta: { raw, ingestedAt: Date.now() } as any,
  });
  return true;
}

/**
 * One ingestion pass. A deep tick first audits the external subscription and polls signals_history
 * only when the source is subscribed or the audit is inconclusive. Confirmed unsubscribes remain a
 * visible, low-load no-op until the next deep check. This service never changes subscription state.
 */
export async function ingestV1Signals(deep: boolean): Promise<V1IngestHealth> {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) {
    return {
      written: 0,
      unsided: 0,
      credentialPresent: false,
      subscriptionChecked: false,
      subscribed: null,
      notificationOk: false,
      notificationSkipped: true,
      historyChecks: 0,
      historySucceeded: 0,
    };
  }
  const u = cred.userId;
  let auditedSubscription: boolean | null = null;
  if (deep) {
    const subscriptionRead = await readTool(
      u,
      "jester_subscription_audit",
      { strategyId: V1_STRATEGY_ID },
    );
    if (
      subscriptionRead.ok
      && typeof subscriptionRead.value?.subscribed === "boolean"
    ) {
      auditedSubscription = subscriptionRead.value.subscribed;
      cachedSubscribed = auditedSubscription;
    }
  }
  const pollState = resolveV1PollState(cachedSubscribed, auditedSubscription);
  if (!pollState.shouldPoll) {
    return {
      written: 0,
      unsided: 0,
      credentialPresent: true,
      subscriptionChecked: deep,
      subscribed: pollState.subscribed,
      notificationOk: false,
      notificationSkipped: true,
      historyChecks: 0,
      historySucceeded: 0,
    };
  }
  const pairs = await v1Pairs();
  const cursor = Number((await getSetting(CURSOR_KEY)) ?? 0);
  let maxSeen = cursor;
  let written = 0, unsided = 0;
  let historyChecks = 0, historySucceeded = 0;

  // 1. Notifications — auto-trade alerts (single call, ~10min TTL upstream, so 5m cadence catches all).
  const notificationRead = await readTool(u, "jester_notifications", {});
  const notif = notificationRead.value;
  const items: any[] = notif?.notifications ?? notif?.items ?? (Array.isArray(notif) ? notif : []);
  for (const it of items) {
    const text = JSON.stringify(it).toLowerCase();
    if (!text.includes("jester_v1") && !text.includes("jester v1")) continue;
    const ms = tsOf(it) ?? Date.now();
    if (ms <= cursor) continue;
    const pair = pairs.find((p) => text.includes(p.toLowerCase()) || text.includes(p.replace("-USD", "").toLowerCase())) ?? pairs[0];
    const side = sideOf(it);
    // Advance the cursor even for unsided events — otherwise they re-warn every tick forever
    // (the stale June fleet-cache burned calls + log spam until this fix).
    maxSeen = Math.max(maxSeen, ms);
    if (!side) { unsided++; console.warn("[v1-log] unsided notification:", JSON.stringify(it).slice(0, 220)); continue; }
    if (await logEvent(pair, side, ms, it)) written++;
  }

  // 2. signals_history per subscribed pair (deep ticks only — this channel rate-limits aggressively).
  if (deep) {
    for (const pair of pairs) {
      historyChecks++;
      const historyRead = await readTool(
        u,
        "jester_signals_history",
        { strategyId: V1_STRATEGY_ID, pair },
      );
      if (historyRead.ok) historySucceeded++;
      const hist = historyRead.value;
      const sigs: any[] = hist?.signals ?? [];
      for (const s of sigs) {
        const ms = tsOf(s);
        if (!ms || ms <= cursor) continue;
        const side = sideOf(s);
        maxSeen = Math.max(maxSeen, ms); // cursor advances past unsided events too (no eternal re-warn)
        if (!side) { unsided++; console.warn("[v1-log] unsided history event:", JSON.stringify(s).slice(0, 220)); continue; }
        if (await logEvent(pair, side, ms, s)) written++;
      }
    }
  }

  if (maxSeen > cursor) await setSetting(CURSOR_KEY, String(maxSeen));
  return {
    written,
    unsided,
    credentialPresent: true,
    subscriptionChecked: deep,
    subscribed: pollState.subscribed,
    notificationOk: notificationRead.ok,
    notificationSkipped: false,
    historyChecks,
    historySucceeded,
  };
}

/** Latest V1 entry for a pair within freshness — the Paper Floor bots' read. */
export async function latestV1Signal(pair: string, nowMs: number, maxAgeSec: number): Promise<{ pup: number; ageSec: number } | null> {
  const [row] = await db
    .select({ pup: signalSnapshots.pup, at: signalSnapshots.capturedAt })
    .from(signalSnapshots)
    .where(and(eq(signalSnapshots.source, V1_SOURCE), eq(signalSnapshots.pair, pair)))
    .orderBy(desc(signalSnapshots.capturedAt))
    .limit(1);
  if (!row) return null;
  const ageSec = (nowMs - row.at.getTime()) / 1000;
  return ageSec <= maxAgeSec ? { pup: row.pup, ageSec } : null;
}
