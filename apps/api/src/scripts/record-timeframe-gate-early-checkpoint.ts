/**
 * Persist an explicitly descriptive early read of the independent strategy × timeframe gate.
 *
 * Outcomes are visible in this checkpoint, so none of its slices may become a strategy without a
 * later preregistration and fresh boundary. The script records a falsification/collection decision;
 * it never changes the paper roster, collectors, gates, settings, or any execution surface.
 */
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { floorState } from "../services/paper-floor.ts";
import { PAPER_TIMEFRAME_GATE } from "../services/paper-timeframe-gate.ts";

const slug = "updown-timeframe-gate-early-checkpoint-2026-07-24";
const marker = "# Strategy × timeframe early falsification checkpoint — 2026-07-24";
const action = "kb.paper-evidence-checkpoint.record";
const resourceId = `${slug}:v1`;
// This receipt is only valid while every five-day split-gate floor is impossible.
const evidenceHardStopMs = Date.parse("2026-07-25T00:00:00.000Z");
const categories = [
  "operations",
  "strategy",
  "research",
  "provider",
  "decision",
  "postmortem",
] as const;
const statuses = ["active", "superseded", "archived"] as const;
const user = {
  id: "agent",
  name: "Agent",
  email: "agent@localhost",
  role: "operator" as const,
  banned: false,
  banReason: null,
  banExpires: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  emailVerified: false,
  image: null,
};
const ctx = {
  user,
  session: null,
  req: new Request("http://localhost/internal/kb-timeframe-gate-early-checkpoint"),
};
const caller = appRouter.createCaller(ctx);

const ensureAudit = async () => {
  const [existingAudit] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(
      eq(auditLogs.action, action),
      eq(auditLogs.resourceType, "kbArticle"),
      eq(auditLogs.resourceId, resourceId),
    ))
    .limit(1);
  if (!existingAudit) {
    await audit(ctx, action, { resourceType: "kbArticle", resourceId });
  }
  return !existingAudit;
};

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  const auditInserted = await ensureAudit();
  console.log(JSON.stringify({ updated: false, auditInserted, slug, marker }, null, 2));
  process.exit(0);
}
if (Date.now() >= evidenceHardStopMs) {
  throw new Error("refusing an early split-gate checkpoint after its outcome window");
}

const state = await floorState();
if (
  state.timeframeGate.version !== PAPER_TIMEFRAME_GATE.version
  || state.timeframeGate.constants.evalStartMs !== PAPER_TIMEFRAME_GATE.evalStartMs
) {
  throw new Error("live split-gate contract does not match the registered checkpoint contract");
}

const splitRows = state.timeframeGate.bots;
const macroRows = state.macroDirectionGate.bots;
const gateChecks = {
  noSplitPass: splitRows.every((row) => row.state !== "passing"),
  noSplitFiveDaySpan: splitRows.every((row) => row.spanDays < PAPER_TIMEFRAME_GATE.minSpanDays),
  noSplitMarketFloor: splitRows.every((row) => row.markets < PAPER_TIMEFRAME_GATE.minMarkets),
  noPositiveSplitLowerBound: splitRows.every((row) =>
    row.residual?.lo == null || row.residual.lo <= 0
  ),
  noMacroPass: macroRows.every((row) => row.state !== "passing"),
  noMacroFiveDaySpan: macroRows.every(
    (row) => row.spanDays < state.macroDirectionGate.constants.minSpanDays,
  ),
  exactMacroCoverageAccounting:
    state.macroDirectionCoverage.overall.missingRows === 0
    && state.macroDirectionCoverage.overall.unexpectedRows === 0,
};
if (!Object.values(gateChecks).every(Boolean)) {
  throw new Error(`refusing checkpoint because an early-evidence invariant changed: ${
    JSON.stringify(gateChecks)
  }`);
}

const assetResult = await db.execute<{
  pair: string;
  n: number;
  raw_usd: number;
  residual_per_contract: number;
  up_bets: number;
  down_bets: number;
}>(sql`
  with paired as (
    select
      pair,
      pnl_usd,
      side,
      (
        case when status = 'won' then 1 - ask_paid else -ask_paid end
        -
        case
          when (side = 'down' and status = 'won')
            or (side = 'up' and status = 'lost')
            then 1 - control_ask_paid
          else -control_ask_paid
        end
      ) as residual
    from paper_trade
    where bot_key = 'pricerMC'
      and horizon_min = 5
      and window_start >= ${new Date(PAPER_TIMEFRAME_GATE.evalStartMs)}
      and status in ('won', 'lost')
      and ask_paid > 0
      and ask_paid < 1
      and control_ask_paid > 0
      and control_ask_paid < 1
  )
  select
    pair,
    count(*)::int as n,
    coalesce(sum(pnl_usd), 0)::double precision as raw_usd,
    coalesce(avg(residual), 0)::double precision as residual_per_contract,
    count(*) filter (where side = 'up')::int as up_bets,
    count(*) filter (where side = 'down')::int as down_bets
  from paired
  group by pair
  order by pair
`);
const assetRows = assetResult.rows.map((row) => ({
  pair: row.pair,
  n: Number(row.n),
  rawUsd: Number(row.raw_usd),
  residualPerContract: Number(row.residual_per_contract),
  upBets: Number(row.up_bets),
  downBets: Number(row.down_bets),
}));
if (
  assetRows.length !== 6
  || assetRows.some((row) =>
    !Number.isFinite(row.rawUsd)
    || !Number.isFinite(row.residualPerContract)
    || row.n !== row.upBets + row.downBets
  )
) {
  throw new Error("bootstrap-MC asset checkpoint is incomplete");
}

const splitByKey = new Map(splitRows.map((row) => [row.key, row] as const));
const pricerMc = splitByKey.get("pricerMC:5");
const pricerMcTrend = splitByKey.get("pricerMC5mTrend:5");
if (!pricerMc?.residual || !pricerMcTrend?.residual) {
  throw new Error("bootstrap-MC split cohorts are missing from the live gate");
}

const positiveSplitRows = splitRows
  .filter((row) => (row.residual?.mean ?? 0) > 0)
  .sort((left, right) =>
    (right.residual?.mean ?? 0) - (left.residual?.mean ?? 0)
    || right.bets - left.bets
  );
const cents = (value: number | null | undefined) =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}¢`;
const dollars = (value: number) =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const generatedAt = new Date().toISOString();

const body = [
  marker,
  "",
  `Recorded ${generatedAt}. Outcomes were already visible; this is a descriptive checkpoint, not a registration dataset.`,
  "",
  "## Frozen evidence boundary",
  "",
  `- Split gate: \`${state.timeframeGate.version}\`, starting ${new Date(PAPER_TIMEFRAME_GATE.evalStartMs).toISOString()}.`,
  `- Required per independent strategy × timeframe cohort: ${PAPER_TIMEFRAME_GATE.minMarkets.toLocaleString()} markets, ${PAPER_TIMEFRAME_GATE.minSpanDays} days, ${PAPER_TIMEFRAME_GATE.minBets} paired bets, two qualifying UK sessions, mean residual at least ${cents(PAPER_TIMEFRAME_GATE.minResidual)}, and a whole-window cluster-bootstrap 95% lower bound above zero.`,
  "- Every result below is paired to the executable same-tick control. Raw paper dollars are shown only where needed to demonstrate why raw ranking can mislead.",
  "",
  "## Early split-gate result",
  "",
  `- No cohort can pass: the longest split span is ${Math.max(...splitRows.map((row) => row.spanDays)).toFixed(3)} days and the largest opportunity denominator is ${Math.max(...splitRows.map((row) => row.markets)).toLocaleString()} markets.`,
  "- No positive-residual cohort has a 95% lower bound above zero.",
  ...positiveSplitRows.slice(0, 10).map((row) =>
    `- \`${row.key}\`: ${row.bets.toLocaleString()} paired bets / ${row.residual!.clusters.toLocaleString()} clusters; mean ${cents(row.residual!.mean)}, 95% CI [${cents(row.residual!.lo)}, ${cents(row.residual!.hi)}]; ${row.positiveQualifyingSessions}/${row.qualifyingSessions} qualifying sessions positive.`
  ),
  "",
  "## Bootstrap-MC falsification",
  "",
  `- Parent \`pricerMC:5\`: ${pricerMc.bets.toLocaleString()} paired bets / ${pricerMc.residual.clusters.toLocaleString()} clusters; mean ${cents(pricerMc.residual.mean)}, 95% CI [${cents(pricerMc.residual.lo)}, ${cents(pricerMc.residual.hi)}].`,
  `- Outcome-inspired trend child \`pricerMC5mTrend:5\`: ${pricerMcTrend.bets.toLocaleString()} paired bets / ${pricerMcTrend.residual.clusters.toLocaleString()} clusters; mean ${cents(pricerMcTrend.residual.mean)}, 95% CI [${cents(pricerMcTrend.residual.lo)}, ${cents(pricerMcTrend.residual.hi)}].`,
  "- The child has not rescued the parent in this early cohort. Neither result is mature enough for a verdict, and neither authorizes another filter.",
  "",
  "### Parent 5m asset dispersion",
  "",
  ...assetRows.map((row) =>
    `- ${row.pair.replace("-USD", "")}: n=${row.n.toLocaleString()}, raw ${dollars(row.rawUsd)}, same-tick-control residual ${cents(row.residualPerContract)} (${row.upBets} UP / ${row.downBets} DOWN).`
  ),
  "",
  "- In particular, a positive raw asset bucket can have flat or negative residual after contemporaneous direction is removed. Asset-specific winners in this snapshot are contaminated hypotheses; selecting one now would require a new future boundary and could not reuse these rows.",
  "",
  "## Macro-direction read",
  "",
  ...macroRows.map((row) =>
    `- \`${row.key}\`: ${row.bets.toLocaleString()} paired bets / ${row.residual?.clusters.toLocaleString() ?? "0"} clusters; mean ${cents(row.residual?.mean)}, 95% CI [${cents(row.residual?.lo)}, ${cents(row.residual?.hi)}]; ${row.qualifyingSessions} qualifying session${row.qualifyingSessions === 1 ? "" : "s"}.`
  ),
  `- Macro coverage accounting is exact: ${state.macroDirectionCoverage.overall.placedRows.toLocaleString()} expected rows placed, ${state.macroDirectionCoverage.overall.missingRows} missing, ${state.macroDirectionCoverage.overall.unexpectedRows} unexpected; ${percent(state.macroDirectionCoverage.overall.availableRows / Math.max(1, state.macroDirectionCoverage.overall.eligibleRows))} available.`,
  "- The macro DOWN 5m indication is directionally interesting but still spans one session and its clustered interval crosses zero. Continued collection is the registered action.",
  "",
  "## Decision",
  "",
  "- No additional bot, asset filter, threshold, or ensemble is admitted from this checkpoint.",
  "- Continue the independent 5m/15m paper cohorts until the unchanged market, span, paired-bet, cluster-bootstrap, and session floors are met.",
  "- The next causal research substrate remains the already registered readiness queue. Hyperliquid flow, public CLOB event-OFI, Deribit skew, and lead/lag reports stay locked until their original floors pass.",
  "- Paper only. This checkpoint creates no order, wallet, key, signing, cancellation, funding, position, or execution path.",
].join("\n");

if (existing) {
  if (
    !categories.includes(existing.category as (typeof categories)[number])
    || !statuses.includes(existing.status as (typeof statuses)[number])
  ) {
    throw new Error("existing checkpoint article has an invalid KB contract");
  }
}
await caller.kb.upsert({
  slug,
  title: "Strategy × timeframe early falsification checkpoint — 2026-07-24",
  category: "decision",
  tags: [
    "polymarket",
    "updown",
    "paper-only",
    "forward-only",
    "timeframe-gate",
    "falsification",
  ],
  body,
  status: "active",
});
const auditInserted = await ensureAudit();

console.log(JSON.stringify({
  updated: true,
  auditInserted,
  slug,
  marker,
  generatedAt,
  gateChecks,
  split: {
    rows: splitRows.length,
    positiveRows: positiveSplitRows.length,
    maxSpanDays: Math.max(...splitRows.map((row) => row.spanDays)),
    maxMarkets: Math.max(...splitRows.map((row) => row.markets)),
  },
  pricerMc5m: {
    bets: pricerMc.bets,
    mean: pricerMc.residual.mean,
    lo: pricerMc.residual.lo,
    hi: pricerMc.residual.hi,
  },
  pricerMcTrend5m: {
    bets: pricerMcTrend.bets,
    mean: pricerMcTrend.residual.mean,
    lo: pricerMcTrend.residual.lo,
    hi: pricerMcTrend.residual.hi,
  },
  assetRows,
}, null, 2));
process.exit(0);
