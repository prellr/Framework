/**
 * Idempotently preregister the prospective causal-delivery child of Smooth Path v1.
 *
 * Initial registration must run before the frozen boundary. A later idempotent pass may append the
 * verified operational rollout, but every path remains outcome-blind and never reads paper outcomes,
 * P&L, directions, or market-resolution data.
 */
import { and, count, eq, lt } from "drizzle-orm";
import { auditLogs, db, polymarketSmoothPathFunnel } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  SMOOTH_PATH_CAUSAL_DISPLACEMENT,
  SMOOTH_PATH_DISPLACEMENT,
} from "../services/smooth-path-displacement.ts";

const slug = "updown-smooth-path-causal-displacement-v2";
const marker = "## Prospective registration — causal delivery v2";
const operationalMarker = "## Outcome-blind funnel rollout — 2026-07-23";
const preregistrationAction = "kb.preregistration.record";
const operationalAction = "kb.operational-amendment.record";
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
  req: new Request("http://localhost/internal/kb-smooth-path-causal-v2"),
};
const caller = appRouter.createCaller(ctx);

const ensureAudit = async (action: string) => {
  const [existing] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, action),
        eq(auditLogs.resourceType, "kbArticle"),
        eq(auditLogs.resourceId, slug),
      ),
    )
    .limit(1);
  if (existing) return false;
  await audit(ctx, action, { resourceType: "kbArticle", resourceId: slug });
  return true;
};

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  let operationalUpdated = false;
  if (!existing.body.includes(operationalMarker)) {
    const [total] = await db
      .select({ rows: count() })
      .from(polymarketSmoothPathFunnel);
    const [preBoundary] = await db
      .select({ rows: count() })
      .from(polymarketSmoothPathFunnel)
      .where(
        lt(
          polymarketSmoothPathFunnel.windowStart,
          new Date(SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs),
        ),
      );
    if ((preBoundary?.rows ?? 0) !== 0) {
      throw new Error("refusing operational record: pre-boundary funnel rows exist");
    }
    const sources = Array.isArray(existing.sources)
      ? existing.sources.filter((source): source is { title: string; url: string } =>
          !!source
          && typeof source === "object"
          && typeof (source as { title?: unknown }).title === "string"
          && typeof (source as { url?: unknown }).url === "string"
        )
      : undefined;
    const operationalBody = [
      operationalMarker,
      "",
      `- The additive funnel table and paper worker were deployed before the frozen ${new Date(SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs).toISOString()} boundary; the deployment check found ${total?.rows ?? 0} total and zero pre-boundary funnel rows.`,
      "- The tape permits only the two frozen Smooth Path versions, their exact bot keys, the six-asset universe, and windows at or after the v2 boundary. Database checks enforce the stage order `observed → path-qualified → book-qualified → placed`.",
      "- Persisted fields are limited to pair/window identifiers, observation timing, book-request duration, gate booleans, rejection reasons, and path coverage/freshness diagnostics. No direction, price, selected side, outcome, grade, P&L, account, wallet, order, or position field exists.",
      "- One unique row per version and market caps growth at 12 rows per five-minute cycle. The general paper scheduler evaluates this lane once per minute only during frozen elapsed minute two, so expected volume is at most 2.4 new rows/minute.",
      "- A qualified paper insertion and its funnel row share one database transaction. The strategy cannot create a post-boundary paper decision without its corresponding outcome-blind audit evidence.",
      "- Rollout host snapshot: one-minute load 1.93 on 10 logical CPUs, worker CPU 6.75%, Postgres CPU 3.51%, and the empty indexed funnel relation 40 kB. The independent receipt verifier remained below its 0.75 normalized-load pause threshold.",
    ].join("\n");
    await caller.kb.upsert({
      slug,
      title: existing.title,
      category: existing.category as (typeof categories)[number],
      tags: existing.tags ?? undefined,
      body: `${existing.body.trim()}\n\n${operationalBody}`,
      sources,
      status: existing.status as (typeof statuses)[number],
      supersededBySlug: existing.supersededBySlug,
    });
    operationalUpdated = true;
  }
  const auditInserted = await ensureAudit(preregistrationAction);
  const operationalAuditInserted = await ensureAudit(operationalAction);
  console.log(
    JSON.stringify({
      updated: operationalUpdated,
      auditInserted,
      operationalAuditInserted,
      slug,
      reason: operationalUpdated ? "operational_rollout_recorded" : "already_registered",
    }),
  );
  process.exit(0);
}
if (existing) {
  throw new Error(`refusing to replace pre-existing KB article without marker: ${slug}`);
}
if (Date.now() >= SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs) {
  throw new Error("causal Smooth Path v2 registration boundary has already passed");
}

const inheritedGates = [
  `minimum ${SMOOTH_PATH_DISPLACEMENT.minTicks} distinct source-time ticks`,
  `opening coverage within ${SMOOTH_PATH_DISPLACEMENT.maxStartCoverageSec}s`,
  `maximum intertick gap ${SMOOTH_PATH_DISPLACEMENT.maxIntertickGapSec}s`,
  `source and receipt age at most ${SMOOTH_PATH_DISPLACEMENT.maxSourceAgeSec}s`,
  `absolute strike displacement at least ${SMOOTH_PATH_DISPLACEMENT.minAbsDisplacementLog}`,
  `path R² at least ${SMOOTH_PATH_DISPLACEMENT.minPathR2}`,
  `path efficiency at least ${SMOOTH_PATH_DISPLACEMENT.minPathEfficiency}`,
  `signed fresh-return floor ${SMOOTH_PATH_DISPLACEMENT.minSignedFreshReturnLog}`,
  `event-side probability ${SMOOTH_PATH_DISPLACEMENT.eventSideProbability}`,
  `strict executable-ask edge above ${SMOOTH_PATH_DISPLACEMENT.askEdge}`,
  `maximum minute-1 ask drift ${SMOOTH_PATH_DISPLACEMENT.maxAskDrift}`,
].join("; ");

const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} for the frozen boundary ${new Date(SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs).toISOString()}.`,
  "",
  "### Outcome-blind reason",
  "",
  "- A complete v1 minute-two decision cycle produced six eligible/six observed paths, with two rejected because their newest RTDS delivery arrived after the paired-book response timestamp. One separate path cleared every path-quality gate and was rejected only by the unchanged executable edge/chase rule.",
  "- No side distribution, market outcome, grade, win rate, or P&L was inspected. The observed issue is temporal causality, not strategy performance.",
  "",
  "### Exact registered delta",
  "",
  "- v1 remains frozen and independently scored under `smoothPathDisplacement`.",
  "- v2 uses the independent bot key `smoothPathCausalDisplacement` and version `updown-smooth-path-causal-displacement-v2`.",
  "- A tick is eligible only when both its Chainlink source timestamp and this worker's local receipt timestamp are no later than the paired-book capture timestamp. Equal source timestamps retain the latest delivery that was already available by that time.",
  "- Every numeric signal, path-quality, event-probability, fee-adjusted ask-edge, and chase threshold is inherited unchanged from v1.",
  "",
  "### Frozen contract",
  "",
  `- Scope: ${SMOOTH_PATH_CAUSAL_DISPLACEMENT.pairs.join(", ")}; 5-minute markets only; prior fill at elapsed minute ${SMOOTH_PATH_CAUSAL_DISPLACEMENT.previousSampleMinute}; decision at elapsed minute ${SMOOTH_PATH_CAUSAL_DISPLACEMENT.decisionSampleMinute}.`,
  `- Gates: ${inheritedGates}.`,
  "- Inputs: public Polymarket RTDS Chainlink resolution-price ticks, immutable minute-1 fee-adjusted fills, and one current paired CLOB batch-book response.",
  "- Execution model: $5 paper-only total outlay. No wallet, key, signing, order placement, cancellation, or fund path exists.",
  "- Evaluation: retain all asset buckets including zero activity, keep v1 and v2 separate, and apply the existing forward verdict gate. No threshold may be revised from v2 outcomes.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Smooth Path causal-delivery child v2",
  category: "strategy" as (typeof categories)[number],
  tags: ["polymarket", "updown", "chainlink", "rtds", "causality", "paper-only"],
  body,
  sources: [
    {
      title: "Polymarket Real-Time Data Socket",
      url: "https://docs.polymarket.com/market-data/websocket/rtds",
    },
  ],
  status: "active" as (typeof statuses)[number],
});
const auditInserted = await ensureAudit(preregistrationAction);
console.log(
  JSON.stringify(
    {
      updated: true,
      auditInserted,
      slug,
      version: SMOOTH_PATH_CAUSAL_DISPLACEMENT.version,
      boundary: new Date(SMOOTH_PATH_CAUSAL_DISPLACEMENT.evalStartMs).toISOString(),
    },
    null,
    2,
  ),
);
process.exit(0);
