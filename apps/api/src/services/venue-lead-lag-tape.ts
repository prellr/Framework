/**
 * Synchronized one-second Chainlink/Hyperliquid tape for forward lead/lag research.
 *
 * This is an observational collector, not a strategy. It batches writes every five seconds and
 * discards a failed batch instead of retrying without bound. Any signal derived from these rows must
 * be specified and registered separately before its own forward evaluation begins.
 */
import { db, venuePriceSnapshots } from "@framework/db";
import { getSetting } from "./config.ts";
import { chainlinkNow } from "./rtds.ts";
import { hlBboNow, HL_RTDS_PAIRS, startHlRtds } from "./hl-rtds.ts";

export const VENUE_TAPE = {
  sampleMs: 1_000,
  flushMs: 5_000,
  maxSourceAgeMs: 10_000,
  maxReceiveAgeMs: 10_000,
  maxPendingRows: 600,
} as const;

const ENABLED_KEY = "venue_lead_lag_tape_enabled";
type Pending = typeof venuePriceSnapshots.$inferInsert;
const pending: Pending[] = [];
let started = false;
let flushing = false;
let lastErrorLogAt = 0;

function sample() {
  const now = Date.now();
  const sampledAtMs = Math.floor(now / VENUE_TAPE.sampleMs) * VENUE_TAPE.sampleMs;
  for (const pair of HL_RTDS_PAIRS) {
    const chainlink = chainlinkNow(pair), hl = hlBboNow(pair);
    if (!chainlink || !hl) continue;
    const chainlinkAgeMs = now - chainlink.sourceAtMs;
    const chainlinkReceiveAgeMs = now - chainlink.receivedAtMs;
    const hlAgeMs = now - hl.sourceAtMs;
    const hlReceiveAgeMs = now - hl.receivedAtMs;
    if (
      chainlinkAgeMs > VENUE_TAPE.maxSourceAgeMs || chainlinkReceiveAgeMs > VENUE_TAPE.maxReceiveAgeMs ||
      hlAgeMs > VENUE_TAPE.maxSourceAgeMs || hlReceiveAgeMs > VENUE_TAPE.maxReceiveAgeMs
    ) continue;
    pending.push({
      pair,
      sampledAt: new Date(sampledAtMs),
      chainlinkPrice: chainlink.px,
      chainlinkSourceAt: new Date(chainlink.sourceAtMs),
      chainlinkReceivedAt: new Date(chainlink.receivedAtMs),
      chainlinkAgeMs,
      hlMid: hl.px,
      hlSourceAt: new Date(hl.sourceAtMs),
      hlReceivedAt: new Date(hl.receivedAtMs),
      hlAgeMs,
      basisBps: 10_000 * Math.log(hl.px / chainlink.px),
    });
  }
  if (pending.length > VENUE_TAPE.maxPendingRows) pending.splice(0, pending.length - VENUE_TAPE.maxPendingRows);
}

async function flush() {
  if (flushing || !pending.length) return;
  flushing = true;
  const batch = pending.splice(0, pending.length);
  try {
    await db.insert(venuePriceSnapshots).values(batch).onConflictDoNothing();
  } catch (error) {
    const now = Date.now();
    if (now - lastErrorLogAt >= 60_000) {
      console.error(`[venue-tape] discarded=${batch.length}: ${error instanceof Error ? error.message : String(error)}`);
      lastErrorLogAt = now;
    }
  } finally {
    flushing = false;
  }
}

/** Start the read-only stream and bounded sampler once. */
export async function startVenueLeadLagTape() {
  if (started) return;
  started = true;
  const setting = await getSetting(ENABLED_KEY);
  if (setting === "false") {
    console.log("[venue-tape] disabled");
    return;
  }
  startHlRtds();
  setInterval(sample, VENUE_TAPE.sampleMs);
  setInterval(() => { void flush(); }, VENUE_TAPE.flushMs);
  console.log(`[venue-tape] sampling ${HL_RTDS_PAIRS.length} pairs every ${VENUE_TAPE.sampleMs}ms`);
}
