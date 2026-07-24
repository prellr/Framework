/**
 * Prospective Deribit short-dated options tape (KB updown-deribit-skew-tape-v1).
 *
 * Public, unauthenticated market data only. This module records a frozen BTC/ETH 25-delta-proxy
 * skew/OI snapshot every five minutes. It emits no Polymarket side and is not imported by the paper
 * engine; any directional use requires a separate preregistration and later forward boundary.
 */
import { gte, sql } from "drizzle-orm";
import { db, deribitOptionSnapshots } from "@framework/db";
import { getSetting } from "./config.ts";
import { normCdf } from "./pricer.ts";

export const DERIBIT_SKEW_TAPE = {
  version: "updown-deribit-skew-tape-v1",
  evalStartMs: 1_784_786_400_000, // 2026-07-23 06:00:00 UTC
  sampleMs: 5 * 60_000,
  currencies: ["BTC", "ETH"] as const,
  minExpiryHours: 12,
  maxExpiryHours: 72,
  targetAbsDelta: 0.25,
  instrumentCacheMs: 30 * 60_000,
  instrumentRequestGapMs: 1_100,
  requestTimeoutMs: 20_000,
  diagnosticMinRows: 500,
  diagnosticMinSpanDays: 3,
} as const;

const ENABLED_KEY = "deribit_skew_tape_enabled";
const API_BASE = "https://www.deribit.com/api/v2/public";
type Currency = (typeof DERIBIT_SKEW_TAPE.currencies)[number];
type OptionType = "call" | "put";

export interface DeribitInstrument {
  instrument_name?: unknown;
  expiration_timestamp?: unknown;
  strike?: unknown;
  option_type?: unknown;
  is_active?: unknown;
  state?: unknown;
}

export interface DeribitBookSummary {
  instrument_name?: unknown;
  mark_iv?: unknown;
  underlying_price?: unknown;
  interest_rate?: unknown;
  open_interest?: unknown;
  bid_price?: unknown;
  ask_price?: unknown;
}

interface JoinedOption {
  instrument: string;
  expirationMs: number;
  strike: number;
  type: OptionType;
  markIv: number;
  underlying: number;
  interestRate: number;
  openInterest: number;
  bid: number | null;
  ask: number | null;
  deltaProxy: number;
}

export interface DeribitSkewSample {
  currency: Currency;
  pair: `${Currency}-USD`;
  capturedAtMs: number;
  expirationAtMs: number;
  timeToExpiryHours: number;
  underlyingPrice: number;
  interestRate: number;
  call25: JoinedOption;
  put25: JoinedOption;
  rr25VolPoints: number;
  atmStrike: number | null;
  atmMarkIv: number | null;
  callOpenInterest: number;
  putOpenInterest: number;
  putCallOiRatio: number | null;
  totalOpenInterest: number;
  optionCount: number;
  twoSidedCount: number;
}

const finite = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Standard Black-Scholes spot-delta proxy frozen in the KB contract. */
export function bsDeltaProxy(
  optionType: OptionType,
  spot: number,
  strike: number,
  markIvVolPoints: number,
  interestRate: number,
  timeYears: number,
): number | null {
  if (
    spot <= 0 || strike <= 0 || markIvVolPoints <= 0 || timeYears <= 0
    || ![spot, strike, markIvVolPoints, interestRate, timeYears].every(Number.isFinite)
  ) return null;
  const sigma = markIvVolPoints / 100;
  const sigmaT = sigma * Math.sqrt(timeYears);
  if (!(sigmaT > 0)) return null;
  const d1 = (Math.log(spot / strike) + (interestRate + 0.5 * sigma * sigma) * timeYears) / sigmaT;
  const callDelta = normCdf(d1);
  return optionType === "call" ? callDelta : callDelta - 1;
}

const candidateSort = (target: number) => (a: JoinedOption, b: JoinedOption) =>
  Math.abs(a.deltaProxy - target) - Math.abs(b.deltaProxy - target)
  || Math.abs(Math.log(a.strike / a.underlying)) - Math.abs(Math.log(b.strike / b.underlying))
  || a.instrument.localeCompare(b.instrument);

/** Pure frozen transform from the two official bulk responses into one tape row. */
export function buildDeribitSkewSample(
  currency: Currency,
  instruments: DeribitInstrument[],
  summaries: DeribitBookSummary[],
  capturedAtMs: number,
): DeribitSkewSample | null {
  if (!Number.isFinite(capturedAtMs) || capturedAtMs < DERIBIT_SKEW_TAPE.evalStartMs) return null;

  const summaryByInstrument = new Map(
    summaries.flatMap((summary) =>
      typeof summary.instrument_name === "string" ? [[summary.instrument_name, summary] as const] : []),
  );
  const metadata = instruments.flatMap((instrument) => {
    const name = typeof instrument.instrument_name === "string" ? instrument.instrument_name : null;
    const expirationMs = finite(instrument.expiration_timestamp);
    const strike = finite(instrument.strike);
    const type: OptionType | null = instrument.option_type === "call" || instrument.option_type === "put"
      ? instrument.option_type
      : null;
    if (
      !name || !expirationMs || !strike || strike <= 0 || !type
      || instrument.is_active !== true || instrument.state !== "open"
      || !summaryByInstrument.has(name)
    ) return [];
    const hours = (expirationMs - capturedAtMs) / 3_600_000;
    if (hours < DERIBIT_SKEW_TAPE.minExpiryHours || hours > DERIBIT_SKEW_TAPE.maxExpiryHours) return [];
    return [{ instrument, summary: summaryByInstrument.get(name)!, name, expirationMs, strike, type, hours }];
  });
  const expirations = [...new Set(metadata.map((row) => row.expirationMs))].sort((a, b) => a - b);
  const expirationMs = expirations[0];
  if (!expirationMs) return null;
  const timeYears = (expirationMs - capturedAtMs) / (365.25 * 86_400_000);

  const selected = metadata
    .filter((row) => row.expirationMs === expirationMs)
    .flatMap((row): JoinedOption[] => {
      const markIv = finite(row.summary.mark_iv);
      const underlying = finite(row.summary.underlying_price);
      const interestRate = finite(row.summary.interest_rate);
      const openInterest = finite(row.summary.open_interest);
      if (
        markIv == null || markIv <= 0 || underlying == null || underlying <= 0
        || interestRate == null || openInterest == null || openInterest < 0
      ) return [];
      const deltaProxy = bsDeltaProxy(row.type, underlying, row.strike, markIv, interestRate, timeYears);
      if (deltaProxy == null) return [];
      const bid = finite(row.summary.bid_price), ask = finite(row.summary.ask_price);
      return [{
        instrument: row.name,
        expirationMs,
        strike: row.strike,
        type: row.type,
        markIv,
        underlying,
        interestRate,
        openInterest,
        bid: bid != null && bid > 0 ? bid : null,
        ask: ask != null && ask > 0 ? ask : null,
        deltaProxy,
      }];
    });
  if (!selected.length) return null;
  const twoSided = selected.filter((row) => row.bid != null && row.ask != null);
  const call25 = twoSided
    .filter((row) => row.type === "call")
    .sort(candidateSort(DERIBIT_SKEW_TAPE.targetAbsDelta))[0];
  const put25 = twoSided
    .filter((row) => row.type === "put")
    .sort(candidateSort(-DERIBIT_SKEW_TAPE.targetAbsDelta))[0];
  if (!call25 || !put25) return null;

  const underlyingPrice = median(selected.map((row) => row.underlying));
  const interestRate = median(selected.map((row) => row.interestRate));
  const strikePairs = new Map<number, { call?: JoinedOption; put?: JoinedOption }>();
  for (const option of twoSided) {
    const pair = strikePairs.get(option.strike) ?? {};
    pair[option.type] = option;
    strikePairs.set(option.strike, pair);
  }
  const atm = [...strikePairs.entries()]
    .filter((entry): entry is [number, { call: JoinedOption; put: JoinedOption }] => !!entry[1].call && !!entry[1].put)
    .sort((a, b) =>
      Math.abs(Math.log(a[0] / underlyingPrice)) - Math.abs(Math.log(b[0] / underlyingPrice))
      || a[0] - b[0])[0];
  const callOpenInterest = selected
    .filter((row) => row.type === "call")
    .reduce((sum, row) => sum + row.openInterest, 0);
  const putOpenInterest = selected
    .filter((row) => row.type === "put")
    .reduce((sum, row) => sum + row.openInterest, 0);

  return {
    currency,
    pair: `${currency}-USD`,
    capturedAtMs,
    expirationAtMs: expirationMs,
    timeToExpiryHours: (expirationMs - capturedAtMs) / 3_600_000,
    underlyingPrice,
    interestRate,
    call25,
    put25,
    rr25VolPoints: call25.markIv - put25.markIv,
    atmStrike: atm?.[0] ?? null,
    atmMarkIv: atm ? (atm[1].call.markIv + atm[1].put.markIv) / 2 : null,
    callOpenInterest,
    putOpenInterest,
    putCallOiRatio: callOpenInterest > 0 ? putOpenInterest / callOpenInterest : null,
    totalOpenInterest: callOpenInterest + putOpenInterest,
    optionCount: selected.length,
    twoSidedCount: twoSided.length,
  };
}

async function deribitGet<T>(method: string, params: Record<string, string | boolean>): Promise<T[]> {
  const url = new URL(`${API_BASE}/${method}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "jester-analysis/deribit-skew-tape-v1" },
    signal: AbortSignal.timeout(DERIBIT_SKEW_TAPE.requestTimeoutMs),
  });
  if (!response.ok) throw new Error(`Deribit ${method} HTTP ${response.status}`);
  const payload = await response.json() as { result?: unknown; error?: { message?: unknown } };
  if (!Array.isArray(payload.result)) {
    throw new Error(`Deribit ${method}: ${String(payload.error?.message ?? "invalid result")}`);
  }
  return payload.result as T[];
}

const instrumentCache = new Map<Currency, { expiresAtMs: number; rows: DeribitInstrument[] }>();
let lastInstrumentRequestAt = 0;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function loadInstruments(currency: Currency, nowMs: number): Promise<DeribitInstrument[]> {
  const cached = instrumentCache.get(currency);
  if (cached && cached.expiresAtMs > nowMs) return cached.rows;
  const waitMs = DERIBIT_SKEW_TAPE.instrumentRequestGapMs - (Date.now() - lastInstrumentRequestAt);
  if (waitMs > 0) await delay(waitMs);
  lastInstrumentRequestAt = Date.now();
  const rows = await deribitGet<DeribitInstrument>("get_instruments", {
    currency,
    kind: "option",
    expired: false,
  });
  instrumentCache.set(currency, { expiresAtMs: nowMs + DERIBIT_SKEW_TAPE.instrumentCacheMs, rows });
  return rows;
}

export async function deribitSkewTapeEnabled(): Promise<boolean> {
  const setting = await getSetting(ENABLED_KEY);
  return setting == null ? true : setting === "true";
}

export async function deribitSkewCaptureTick(nowMs = Date.now()) {
  if (nowMs < DERIBIT_SKEW_TAPE.evalStartMs || !await deribitSkewTapeEnabled()) {
    return { considered: 0, captured: 0, errors: 0 };
  }
  let captured = 0, errors = 0;
  for (const currency of DERIBIT_SKEW_TAPE.currencies) {
    try {
      const instruments = await loadInstruments(currency, nowMs);
      const summaries = await deribitGet<DeribitBookSummary>("get_book_summary_by_currency", {
        currency,
        kind: "option",
      });
      const sample = buildDeribitSkewSample(currency, instruments, summaries, nowMs);
      if (!sample) continue;
      const inserted = await db
        .insert(deribitOptionSnapshots)
        .values({
          currency: sample.currency,
          pair: sample.pair,
          sampleBucket: new Date(Math.floor(nowMs / DERIBIT_SKEW_TAPE.sampleMs) * DERIBIT_SKEW_TAPE.sampleMs),
          capturedAt: new Date(sample.capturedAtMs),
          expirationAt: new Date(sample.expirationAtMs),
          timeToExpiryHours: sample.timeToExpiryHours,
          underlyingPrice: sample.underlyingPrice,
          interestRate: sample.interestRate,
          call25Instrument: sample.call25.instrument,
          call25Strike: sample.call25.strike,
          call25DeltaProxy: sample.call25.deltaProxy,
          call25MarkIv: sample.call25.markIv,
          call25Bid: sample.call25.bid!,
          call25Ask: sample.call25.ask!,
          call25OpenInterest: sample.call25.openInterest,
          put25Instrument: sample.put25.instrument,
          put25Strike: sample.put25.strike,
          put25DeltaProxy: sample.put25.deltaProxy,
          put25MarkIv: sample.put25.markIv,
          put25Bid: sample.put25.bid!,
          put25Ask: sample.put25.ask!,
          put25OpenInterest: sample.put25.openInterest,
          rr25VolPoints: sample.rr25VolPoints,
          atmStrike: sample.atmStrike,
          atmMarkIv: sample.atmMarkIv,
          callOpenInterest: sample.callOpenInterest,
          putOpenInterest: sample.putOpenInterest,
          putCallOiRatio: sample.putCallOiRatio,
          totalOpenInterest: sample.totalOpenInterest,
          optionCount: sample.optionCount,
          twoSidedCount: sample.twoSidedCount,
        })
        .onConflictDoNothing()
        .returning({ id: deribitOptionSnapshots.id });
      captured += inserted.length;
    } catch (error) {
      errors++;
      console.error(`[deribit-skew] ${currency}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { considered: DERIBIT_SKEW_TAPE.currencies.length, captured, errors };
}

export function deribitSkewDiagnosticReady(rows: number, spanDays: number): boolean {
  return rows >= DERIBIT_SKEW_TAPE.diagnosticMinRows
    && spanDays >= DERIBIT_SKEW_TAPE.diagnosticMinSpanDays;
}

/** Count/span/freshness only; no skew sign, OI ratio, IV, or directional diagnostic. */
export async function deribitSkewTapeStatus() {
  const rows = await db
    .select({
      currency: deribitOptionSnapshots.currency,
      rows: sql<number>`count(*)::int`,
      firstAt: sql<Date>`min(${deribitOptionSnapshots.capturedAt})`,
      lastAt: sql<Date>`max(${deribitOptionSnapshots.capturedAt})`,
    })
    .from(deribitOptionSnapshots)
    .where(gte(deribitOptionSnapshots.capturedAt, new Date(DERIBIT_SKEW_TAPE.evalStartMs)))
    .groupBy(deribitOptionSnapshots.currency);
  const byCurrency = new Map(rows.map((row) => [row.currency, row]));
  const asMs = (value: Date | string | null | undefined) =>
    value == null ? null : value instanceof Date ? value.getTime() : new Date(value).getTime();
  const nowMs = Date.now();
  const currencies = DERIBIT_SKEW_TAPE.currencies.map((currency) => {
    const row = byCurrency.get(currency);
    const firstAtMs = asMs(row?.firstAt), lastAtMs = asMs(row?.lastAt);
    const count = Number(row?.rows ?? 0);
    const spanDays =
      firstAtMs != null && lastAtMs != null && lastAtMs >= firstAtMs
        ? (lastAtMs - firstAtMs) / 86_400_000
        : 0;
    return {
      currency,
      rows: count,
      spanDays,
      firstAtMs,
      lastAtMs,
      latestAgeSec: lastAtMs == null ? null : Math.max(0, Math.round((nowMs - lastAtMs) / 1000)),
      readyForFrozenDiagnostic: deribitSkewDiagnosticReady(count, spanDays),
    };
  });
  return {
    version: DERIBIT_SKEW_TAPE.version,
    evalStartMs: DERIBIT_SKEW_TAPE.evalStartMs,
    sampleMs: DERIBIT_SKEW_TAPE.sampleMs,
    diagnosticMinRows: DERIBIT_SKEW_TAPE.diagnosticMinRows,
    diagnosticMinSpanDays: DERIBIT_SKEW_TAPE.diagnosticMinSpanDays,
    currencies,
    allCurrenciesReadyForFrozenDiagnostic: currencies.every((currency) => currency.readyForFrozenDiagnostic),
  };
}
