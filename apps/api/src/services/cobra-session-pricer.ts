/**
 * External screenshot-derived session/horizon hypothesis.
 *
 * KB: cobra-session-horizon-pricer-v1. The source system's hidden model is not reproducible, so the
 * only transferred claim is its visible 15m session interaction. Jester keeps its own deterministic
 * BSM fair value and asks whether 15m entries outside the UK day session retain edge.
 */
export const COBRA_SESSION_PRICER = {
  evalStartMs: 1784781000000, // 2026-07-23 04:30:00.000 UTC — preregistered before implementation
  horizonMin: 15,
  eligibleSessions: ["night23-07", "eve19-23"] as const,
} as const;

/**
 * Independent 5m child derived from the 2026-07-24 Cobra v1.9.2 screenshot.
 *
 * The visible source repeatedly starred `night23-07 5m` across several differently tuned bots.
 * That is an external prior, not evidence for Jester and not permission to copy its hidden bull
 * factors. Jester therefore keeps the exact parent bootstrap-MC calculation and changes only one
 * clock-known eligibility rule after a fresh prospective boundary.
 */
export const COBRA_5M_NIGHT_PRICER = {
  version: "updown-pricer-mc-5m-cobra-night-v1",
  parentKey: "pricerMC",
  parentVersion: "bootstrap-mc-v1",
  evalStartMs: Date.parse("2026-07-25T00:00:00.000Z"),
  horizonMin: 5,
  eligibleSession: "night23-07",
  sourceArtifact: "photo_2026-07-24 12.48.53.jpeg",
  sourceSystemVersion: "Cobra Capital Inc v1.9.2",
} as const;

export type UkTradingSession = "night23-07" | "day07-19" | "eve19-23";

const ukHourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Session is assigned from the actual decision instant, including Europe/London DST. */
export function ukTradingSessionAt(decidedAtMs: number): UkTradingSession {
  const hour = Number(ukHourFormat.format(new Date(decidedAtMs)));
  if (hour >= 23 || hour < 7) return "night23-07";
  if (hour >= 19) return "eve19-23";
  return "day07-19";
}

export function cobraSessionPricerEligible(horizonMin: number, decidedAtMs: number): boolean {
  if (horizonMin !== COBRA_SESSION_PRICER.horizonMin) return false;
  const session = ukTradingSessionAt(decidedAtMs);
  return COBRA_SESSION_PRICER.eligibleSessions.some((eligible) => eligible === session);
}

export function cobra5mNightPricerEligible(horizonMin: number, decidedAtMs: number): boolean {
  return horizonMin === COBRA_5M_NIGHT_PRICER.horizonMin
    && ukTradingSessionAt(decidedAtMs) === COBRA_5M_NIGHT_PRICER.eligibleSession;
}
