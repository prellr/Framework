/**
 * Preregister the Cobra-screenshot-derived 5m UK-night bootstrap-MC child.
 *
 * This script reads only KB/audit metadata and child-row counts. It never selects side, outcome,
 * grade, fill, price, return, rank, P&L, account, wallet, position, or order data.
 */
import { and, count, eq, gte } from "drizzle-orm";
import { auditLogs, db, paperTrades } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { COBRA_5M_NIGHT_PRICER } from "../services/cobra-session-pricer.ts";
import { PAPER_FAMILYWISE_GATE } from "../services/paper-familywise-gate.ts";
import { PRICER } from "../services/pricer.ts";

const slug = COBRA_5M_NIGHT_PRICER.version;
const action = "kb.preregistration.record";
const resourceId = slug;
const boundary = new Date(COBRA_5M_NIGHT_PRICER.evalStartMs);
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
  req: new Request("http://localhost/internal/kb-cobra-5m-night-pricer-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  COBRA_5M_NIGHT_PRICER.version !== "updown-pricer-mc-5m-cobra-night-v1"
  || boundary.toISOString() !== "2026-07-25T00:00:00.000Z"
  || COBRA_5M_NIGHT_PRICER.parentKey !== "pricerMC"
  || COBRA_5M_NIGHT_PRICER.parentVersion !== "bootstrap-mc-v1"
  || COBRA_5M_NIGHT_PRICER.horizonMin !== 5
  || COBRA_5M_NIGHT_PRICER.eligibleSession !== "night23-07"
  || COBRA_5M_NIGHT_PRICER.evalStartMs !== PAPER_FAMILYWISE_GATE.evalStartMs
) {
  throw new Error("Cobra 5m night executable contract does not match preregistration");
}
if (Date.now() >= COBRA_5M_NIGHT_PRICER.evalStartMs) {
  throw new Error("Cobra 5m night preregistration boundary has already passed");
}

const [[allChildRows], [postBoundaryRows]] = await Promise.all([
  db
    .select({ rows: count() })
    .from(paperTrades)
    .where(eq(paperTrades.botKey, "pricerMC5mCobraNight")),
  db
    .select({ rows: count() })
    .from(paperTrades)
    .where(and(
      eq(paperTrades.botKey, "pricerMC5mCobraNight"),
      gte(paperTrades.windowStart, boundary),
    )),
]);
if (Number(allChildRows?.rows ?? 0) !== 0 || Number(postBoundaryRows?.rows ?? 0) !== 0) {
  throw new Error("refusing preregistration: Cobra 5m night ledger is not empty");
}

const existing = await caller.kb.get({ slug });
if (!existing) {
  await caller.kb.upsert({
    slug,
    title: "Bootstrap-MC 5m Cobra-night child v1",
    category: "strategy",
    tags: [
      "polymarket",
      "paper-only",
      "pricer",
      "bootstrap",
      "5m",
      "session",
      "external-prior",
      "prospective",
    ],
    status: "active",
    body: [
      "# Bootstrap-MC 5m Cobra-night child v1",
      "",
      `Preregistered ${new Date().toISOString()} for ${boundary.toISOString()}.`,
      "",
      "## External provenance and evidentiary boundary",
      "",
      `- User-supplied artifact: \`${COBRA_5M_NIGHT_PRICER.sourceArtifact}\`, showing \`${COBRA_5M_NIGHT_PRICER.sourceSystemVersion}\`.`,
      "- Multiple differently tuned source bots visibly starred `night23-07 5m`. This is an external structural prior only; the screenshot is not Jester performance evidence.",
      "- The source system's hidden signal, bull-factor tuning, star-selection process, sample definition, fee model, and execution semantics are not reproducible. None are copied.",
      "- The source also showed tick-soak, no-tick, no-ask, latency, fill, and rail telemetry. Those support operational monitoring only and do not enter this directional rule.",
      "",
      "## Frozen executable paper rule",
      "",
      "- Bot key: `pricerMC5mCobraNight`; parent: `pricerMC` / `bootstrap-mc-v1`.",
      "- Universe: the parent's six registered crypto assets; 5m only; decision instant must fall in Europe/London `night23-07`, with DST handled by the IANA timezone.",
      `- Fair value: the exact parent de-meaned ${PRICER.mcPaths.toLocaleString()}-path bootstrap using the same already-loaded one-minute return series and coherent Chainlink-preferred S/K reference.`,
      `- Entry: unchanged parent side choice and strict ${(PRICER.askEdge * 100).toFixed(0)}¢ edge over the fee-adjusted real $5 paired-book walk, with all parent freshness, timing, uniqueness, grading, and accounting rules unchanged.`,
      "- Implementation must reuse the parent's calculation and book fetch. It may add no poller, market request, model call, or execution route.",
      `- Independent evaluation unit: \`pricerMC5mCobraNight:5\` inside the frozen ${PAPER_FAMILYWISE_GATE.version} family.`,
      "- Every pre-boundary row and every source-system result is hypothesis-generation material only.",
      "- Paper only. This registration creates no account, wallet, signer, allowance, order, cancel, position, allocation, or fund-moving capability.",
    ].join("\n"),
  });
}

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

console.log(JSON.stringify({
  updated: !existing,
  auditInserted: !existingAudit,
  slug,
  boundary: boundary.toISOString(),
  allChildRows: Number(allChildRows?.rows ?? 0),
  postBoundaryRows: Number(postBoundaryRows?.rows ?? 0),
}, null, 2));
process.exit(0);
