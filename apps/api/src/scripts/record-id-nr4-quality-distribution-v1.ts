/**
 * Preregister the prospective, outcome-blind quality tape for the existing ID/NR4 paper rule.
 *
 * The script may read only the presence/count of the version tag. It does not inspect side,
 * resolution, grade, quote, fill, return, P&L, account, wallet, or order data.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { sql } from "drizzle-orm";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import { ID_NR4_QUALITY_DISTRIBUTION } from "../services/id-nr4-quality-distribution.ts";

const contract = ID_NR4_QUALITY_DISTRIBUTION;
const slug = contract.version;
const marker = "## Prospective ID/NR4 causal quality distribution audit v1";
const action = "kb.preregistration.record";
const boundary = new Date(contract.evalStartMs);
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
  req: new Request("http://localhost/internal/kb-id-nr4-quality-distribution-v1"),
};
const caller = appRouter.createCaller(ctx);

if (
  contract.version !== "updown-id-nr4-breakout-quality-distribution-v1" ||
  contract.tapeVersion !== "updown-id-nr4-breakout-quality-tape-v1" ||
  boundary.toISOString() !== "2026-07-25T22:00:00.000Z" ||
  contract.botKey !== "idNr4Breakout" ||
  contract.horizonMin !== 5 ||
  contract.pairs.length !== 6 ||
  contract.quantileProbabilities.join(",") !== "0.1,0.25,0.5,0.75,0.9" ||
  contract.metrics.join(",") !==
    "setupRangeBps,rangeCompression,insideRangeRatio,absoluteCloseLocation,breakoutExtension,relativeVolume" ||
  contract.floors.rows !== 300 ||
  contract.floors.marketsPerPair !== 40 ||
  contract.floors.spanDays !== 5
) {
  throw new Error("ID/NR4 quality executable contract does not match preregistration");
}
if (Date.now() >= contract.evalStartMs) {
  throw new Error("ID/NR4 quality boundary has already passed");
}

const tagged = await db.execute<{ rows: number | string }>(sql`
  select count(*)::int as rows
  from paper_trade
  where model_meta #>> '{idNr4Breakout,quality,version}' = ${contract.tapeVersion}
`);
const taggedRows = Number(tagged.rows[0]?.rows ?? 0);
if (taggedRows !== 0) {
  throw new Error("refusing preregistration: ID/NR4 quality rows already exist");
}

const ensureAudit = async () => {
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
  console.log(
    JSON.stringify(
      {
        updated: false,
        auditInserted: await ensureAudit(),
        slug,
        boundary: boundary.toISOString(),
        taggedRows,
        reason: "already_registered",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (existing) throw new Error(`refusing to replace existing KB article without marker: ${slug}`);

const body = [
  marker,
  "",
  `Registered ${new Date().toISOString()} before the ${boundary.toISOString()} boundary and while the quality-tagged row count was zero.`,
  "",
  "### Age and contamination boundary",
  "",
  "- ID/NR4 already has observations on three Chicago ledger dates (July 23–25) and two completed days. That existing history is retained and remains visible.",
  "- The later 57-member familywise gate began July 25 at 00:00 UTC, so its cohort clock is younger than the strategy ledger. The UI must show these as separate clocks.",
  "- The visible three-date P&L and asset diagnostics motivated this research direction. They are contaminated discovery evidence and cannot enter this distribution audit or validate any later quality rule.",
  "- ID/NR4 v1, its original July 23 boundary, its decisions, and its familywise verdict gate remain unchanged.",
  "",
  "### Frozen outcome-blind contract",
  "",
  `- Version: \`${contract.version}\`; tape: \`${contract.tapeVersion}\`; boundary: \`${boundary.toISOString()}\`.`,
  `- Universe: ${contract.pairs.join(", ")} at 5m only.`,
  "- Every future ID/NR4 decision stores the coordinates on its existing paper row. No new collector, socket, polling loop, table, or paper identity is added.",
  `- Metrics: ${contract.metrics.join(", ")}.`,
  "- Setup range is scaled in basis points. Compression compares the setup range with the smallest of the prior three ranges. Containment compares it with the immediate parent range.",
  "- Absolute close location discards direction by measuring distance from the setup midpoint. Breakout extension is the absolute causal overshoot beyond the setup boundary, scaled by setup range.",
  "- Relative volume compares the setup bar with the median of the prior three completed bars; missing volume stays null.",
  `- The feature-value query is locked until at least ${contract.floors.rows} rows, ${contract.floors.marketsPerPair} distinct markets in every pair, and ${contract.floors.spanDays} elapsed days are present.`,
  `- Quantiles are fixed at ${contract.quantileProbabilities.join(", ")}. The report is cached for ${contract.cacheMs / 60_000} minutes.`,
  "",
  "### Research and execution constraints",
  "",
  "- Readiness may select only strategy identity, condition ID, pair, window time, and the version tag. The unlocked report may select only the six frozen quality coordinates.",
  "- The audit may not select or join side, resolution, grade, quote, fill, return, P&L, control performance, account, wallet, position, or order data.",
  "- A ready distribution authorizes no quality cut, side, threshold, strategy change, or promotion. Any child requires a separately hashed cut artifact and a later prospective boundary.",
  "- This artifact adds no strategy, verdict mutation, Crucible run, credential, signing capability, submission route, cancellation route, allocation, or fund-moving path.",
].join("\n");

await caller.kb.upsert({
  slug,
  title: "Prospective ID/NR4 causal quality distribution audit v1",
  category: "research",
  tags: ["polymarket", "updown", "id-nr4", "quality", "outcome-free", "prospective", "paper-only"],
  body,
  sources: [],
  status: "active",
});

console.log(
  JSON.stringify(
    {
      updated: true,
      auditInserted: await ensureAudit(),
      slug,
      boundary: boundary.toISOString(),
      taggedRows,
      metrics: contract.metrics,
      floors: contract.floors,
    },
    null,
    2,
  ),
);
process.exit(0);
