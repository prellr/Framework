/**
 * Freeze the preregistered, outcome-free fixed-lag pair eligibility manifest.
 *
 * The script reads only KB/audit metadata plus the preregistered Chainlink × Hyperliquid venue
 * tape. It evaluates exactly the five-second row for all six pairs, sequentially, and writes one
 * immutable hashed KB artifact. It never reads a market result, paper decision, grade, return,
 * account, wallet, position, order, credential, signing state, or execution route.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { LEAD_LAG_REPORT, type LeadLagResult } from "../services/lead-lag-analysis.ts";
import {
  RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN,
  buildResolutionBasisCatchupPairManifest,
  parseResolutionBasisCatchupPairManifestEnvelope,
  serializeResolutionBasisCatchupPairManifestEnvelope,
} from "../services/resolution-source-basis-catchup-plan.ts";
import {
  RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE,
  parseResolutionSourceBasisFeatureCutEnvelope,
} from "../services/resolution-source-basis-feature-cut-freeze.ts";
import {
  VENUE_REPORT_PAIRS,
  venueLeadLagReport,
  venueLeadLagTapeStatus,
} from "../services/venue-lead-lag-report.ts";

const plan = RESOLUTION_SOURCE_BASIS_CATCHUP_PLAN;
const slug = plan.prerequisiteVersions.pairManifest;
const marker = "# Frozen outcome-free resolution-basis catch-up pair manifest v1";
const planMarker = "## Outcome-blind resolution-source basis catch-up preregistration v1";
const action = "kb.pair-manifest.freeze";
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
  req: new Request("http://localhost/internal/freeze-resolution-basis-catchup-pair-manifest"),
};
const caller = appRouter.createCaller(ctx);

const ensureAudit = async (metadata: Record<string, unknown>) => {
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
  await audit(ctx, action, {
    resourceType: "kbArticle",
    resourceId: slug,
    newValue: metadata,
  });
  return true;
};

const featureCutArticle = await caller.kb.get({
  slug: RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.artifactSlug,
});
if (!featureCutArticle) {
  throw new Error("missing frozen resolution-source feature-cut artifact");
}
const featureCuts = parseResolutionSourceBasisFeatureCutEnvelope(featureCutArticle.body);

const existing = await caller.kb.get({ slug });
if (existing) {
  if (!existing.body.includes(marker)) {
    throw new Error(`refusing to replace existing KB article without marker: ${slug}`);
  }
  const envelope = parseResolutionBasisCatchupPairManifestEnvelope(existing.body, featureCuts);
  const qualifyingPairs = envelope.artifact.rows
    .filter((row) => row.qualified)
    .map((row) => row.pair);
  console.log(JSON.stringify({
    frozen: true,
    updated: false,
    auditInserted: await ensureAudit({
      sha256: envelope.sha256,
      frozenAtMs: envelope.artifact.frozenAtMs,
      strategyNotBeforeMs: envelope.artifact.strategyNotBeforeMs,
      qualifyingPairs,
    }),
    slug,
    sha256: envelope.sha256,
    frozenAt: new Date(envelope.artifact.frozenAtMs).toISOString(),
    strategyNotBefore: new Date(envelope.artifact.strategyNotBeforeMs).toISOString(),
    qualifyingPairs,
    createsPaperBot: false,
    reason: "immutable_artifact_already_exists",
  }, null, 2));
  process.exit(0);
}

const preregistration = await caller.kb.get({ slug: plan.version });
if (!preregistration?.body.includes(planMarker)) {
  throw new Error(`missing preregistered basis catch-up plan: ${plan.version}`);
}

const tape = await venueLeadLagTapeStatus();
if (
  tape.version !== plan.prerequisiteVersions.venueTape
  || tape.pairs.length !== VENUE_REPORT_PAIRS.length
  || !tape.allPairsReadyForFrozenDiagnostic
  || tape.pairs.some((pair) => !pair.readyForFrozenDiagnostic)
) {
  throw new Error("refusing pair-manifest freeze: exact six-pair venue tape is not ready");
}

const frozenAtMs = Date.now();
const fixedRows: LeadLagResult[] = [];
for (const pair of VENUE_REPORT_PAIRS) {
  const report = await venueLeadLagReport(pair, LEAD_LAG_REPORT.evalStartMs, frozenAtMs);
  const fixed = report.find((row) => row.lagSec === plan.fixedRule.leadLagSec);
  if (!fixed || !fixed.ready) {
    throw new Error(`refusing pair-manifest freeze: fixed five-second row not ready for ${pair}`);
  }
  fixedRows.push(fixed);
}

const envelope = buildResolutionBasisCatchupPairManifest({
  featureCuts,
  leadLagResults: fixedRows,
  frozenAtMs,
});
const qualifyingPairs = envelope.artifact.rows
  .filter((row) => row.qualified)
  .map((row) => row.pair);
const body = [
  marker,
  "",
  `Frozen ${new Date(envelope.artifact.frozenAtMs).toISOString()} from the complete six-pair venue tape.`,
  "",
  "## Frozen eligibility roster",
  "",
  ...envelope.artifact.rows.map(
    (row) =>
      `- \`${row.pair}\`: ${row.qualified ? "QUALIFIED" : "NOT QUALIFIED"}; fixed ${row.lagSec}s lag; ${row.rows.toLocaleString()} rows; ${row.spanDays.toFixed(3)} days; ${row.blocks} blocks; forward 95% CI [${row.forwardCi.map(String).join(", ")}]; forward-minus-reverse 95% CI [${row.differenceCi.map(String).join(", ")}].`,
  ),
  "",
  "## Binding and boundary",
  "",
  `- Feature-cut SHA-256: \`${envelope.artifact.featureCutsSha256}\`.`,
  `- Pair-manifest SHA-256: \`${envelope.sha256}\`.`,
  `- No prospective strategy may begin before \`${new Date(envelope.artifact.strategyNotBeforeMs).toISOString()}\`.`,
  `- ${qualifyingPairs.length ? `Qualifying pairs: ${qualifyingPairs.join(", ")}.` : "No pair qualified; the preregistered family remains archived and unimplemented."}`,
  "",
  "## Restrictions",
  "",
  "- This artifact records only source-clock lead/lag evidence. It contains no target outcome, paper result, chosen strategy direction, fill, return, rank, or P&L.",
  "- It creates no paper bot, decision, registration, subscription, polling loop, order route, credential, signing capability, allocation, wallet, or execution path.",
  "- The existing familywise verdict gate and frozen strategy population remain unchanged.",
  "",
  serializeResolutionBasisCatchupPairManifestEnvelope(envelope, featureCuts),
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Frozen outcome-free resolution-basis catch-up pair manifest v1",
  category: "research",
  tags: [
    "polymarket",
    "updown",
    "chainlink",
    "hyperliquid",
    "basis",
    "lead-lag",
    "pair-manifest",
    "paper-only",
  ],
  body,
  sources: [
    {
      title: "Resolution-source basis catch-up preregistration v1",
      url: `https://jester.wisco.wine/knowledge/${plan.version}`,
    },
    {
      title: "Frozen outcome-blind resolution-source basis feature cuts v1",
      url: `https://jester.wisco.wine/knowledge/${RESOLUTION_SOURCE_BASIS_FEATURE_CUT_FREEZE.artifactSlug}`,
    },
  ],
  status: "active",
});
const auditInserted = await ensureAudit({
  sha256: envelope.sha256,
  frozenAtMs: envelope.artifact.frozenAtMs,
  strategyNotBeforeMs: envelope.artifact.strategyNotBeforeMs,
  fixedLagSec: envelope.artifact.fixedLagSec,
  qualifyingPairs,
});

console.log(JSON.stringify({
  frozen: true,
  updated: true,
  auditInserted,
  slug,
  sha256: envelope.sha256,
  featureCutsSha256: envelope.artifact.featureCutsSha256,
  frozenAt: new Date(envelope.artifact.frozenAtMs).toISOString(),
  strategyNotBefore: new Date(envelope.artifact.strategyNotBeforeMs).toISOString(),
  fixedLagSec: envelope.artifact.fixedLagSec,
  qualifyingPairs,
  createsPaperBot: false,
}, null, 2));
process.exit(0);
