/**
 * Idempotently preregister the pure macro-direction side controls before their future boundary.
 *
 * KB/audit metadata only: no trades, feature values, outcomes, grades, or performance are queried.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { MACRO_BREADTH_ROUTER } from "../services/macro-breadth-router.ts";
import { MACRO_DIRECTION_CONTROLS } from "../services/macro-direction-controls.ts";

const slug = MACRO_DIRECTION_CONTROLS.version;
const marker = "## Prospective registration — macro-filtered UP/DOWN controls v1";
const action = "kb.preregistration.record";
const categories = ["operations", "strategy", "research", "provider", "decision", "postmortem"] as const;
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
  req: new Request("http://localhost/internal/kb-macro-direction-controls-v1"),
};
const caller = appRouter.createCaller(ctx);

const ensureAudit = async () => {
  const [existing] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(
      eq(auditLogs.action, action),
      eq(auditLogs.resourceType, "kbArticle"),
      eq(auditLogs.resourceId, slug),
    ))
    .limit(1);
  if (existing) return false;
  await audit(ctx, action, { resourceType: "kbArticle", resourceId: slug });
  return true;
};

if (
  MACRO_DIRECTION_CONTROLS.version !== "updown-macro-direction-controls-v1"
  || new Date(MACRO_DIRECTION_CONTROLS.evalStartMs).toISOString()
    !== "2026-07-24T06:00:00.000Z"
  || MACRO_DIRECTION_CONTROLS.macroVersion !== MACRO_BREADTH_ROUTER.version
) {
  throw new Error("macro-direction control executable contract does not match its registration");
}
if (Date.now() >= MACRO_DIRECTION_CONTROLS.evalStartMs) {
  throw new Error("macro-direction control registration boundary has already passed");
}

const existing = await caller.kb.get({ slug });
if (existing?.body.includes(marker)) {
  console.log(JSON.stringify({
    updated: false,
    auditInserted: await ensureAudit(),
    slug,
    reason: "already_registered",
  }));
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace pre-existing KB article without marker: ${slug}`);

const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} for the frozen boundary ${new Date(MACRO_DIRECTION_CONTROLS.evalStartMs).toISOString()}.`,
  "",
  "### Contamination boundary and question",
  "",
  "- This hypothesis was proposed after the Scoreboard exposed current macro-direction segmentation. Every observation before the frozen boundary is contaminated exploratory context and is excluded from these controls.",
  "- The question is deliberately simpler than the existing Macro leader — trend sleeve: does the causal macro direction alone improve the corresponding unconditional side benchmark?",
  "",
  "### Frozen paper rules",
  "",
  `- Reuse the unchanged causal classifier \`${MACRO_BREADTH_ROUTER.version}\`: synchronized completed BTC/ETH/SOL 5m candles, CMO(14), and the already-frozen UP/DOWN/RANGE/NEUTRAL thresholds and 120-second freshness limit.`,
  `- \`${MACRO_DIRECTION_CONTROLS.upBotKey}\` buys UP only when the contemporaneous macro state is exactly UP.`,
  `- \`${MACRO_DIRECTION_CONTROLS.downBotKey}\` buys DOWN only when the contemporaneous macro state is exactly DOWN.`,
  "- Both controls abstain in RANGE, NEUTRAL, and unavailable context. Missing, stale, future, or desynchronized anchors fail closed.",
  "- Use the same early-window decision cadence and $5 fee-adjusted real CLOB book walk as the unconditional controls. Require a coherent selected fill strictly between 2¢ and 98¢.",
  "- Apply no probability bridge, fair-value estimate, mid-edge threshold, ask-edge threshold, asset override, time-of-day filter, or post-boundary tuning.",
  "- Keep the unconditional Always UP and Always DOWN rows untouched. The two new bot keys are independent ledgers, and 5m and 15m evidence remains separately gated.",
  "",
  "### Scope and safety",
  "",
  `- Universe: ${MACRO_DIRECTION_CONTROLS.pairs.join(", ")} across ${MACRO_DIRECTION_CONTROLS.horizonsMin.join("m and ")}m markets.`,
  "- Paper only. No order, wallet, signing, cancellation, position, fund-moving, or live-execution route is added.",
  "- Launch auditing may read only identities, timestamps, row counts, horizon/pair scope, causal macro metadata, and parent control presence. It must not read side outcomes, grades, returns, residuals, or P&L.",
  "- Efficacy remains subject to the unchanged strategy × timeframe forward verdict gate; neither control can borrow evidence from its unconditional parent, its mirrored sibling, the macro trend sleeve, or the other timeframe.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Macro-filtered UP/DOWN controls v1",
  category: "strategy" as (typeof categories)[number],
  tags: ["polymarket", "updown", "macro", "control", "regime", "paper-only"],
  body,
  status: "active" as (typeof statuses)[number],
});

console.log(JSON.stringify({
  updated: true,
  auditInserted: await ensureAudit(),
  slug,
  version: MACRO_DIRECTION_CONTROLS.version,
  boundary: new Date(MACRO_DIRECTION_CONTROLS.evalStartMs).toISOString(),
}, null, 2));
process.exit(0);
