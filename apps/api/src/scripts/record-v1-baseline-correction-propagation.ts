/**
 * Propagate the V1 symmetric-bracket retraction into older durable research records.
 *
 * Historical text is preserved as history; this appends an explicit correction notice. The script
 * reads and writes KB/audit metadata only. It cannot inspect paper rows, outcomes, fills, rankings,
 * strategy parameters, or execution state.
 */
import { and, eq } from "drizzle-orm";
import { auditLogs, db } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";

const correctionSlug = "entry-quality-screen-baseline-correction";
const targets = [
  "polymarket-updown-tesseract-fade",
  "updown-verdict-gate-v1",
] as const;
const marker = "## Retraction notice — symmetric-bracket baseline correction";
const action = "kb.correction-propagation.record";
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
  req: new Request("http://localhost/internal/kb-v1-baseline-correction-propagation"),
};
const caller = appRouter.createCaller(ctx);

const correction = await caller.kb.get({ slug: correctionSlug });
if (
  !correction
  || !correction.body.includes("Cross-sectional MEDIAN win rate = **40.3%**")
  || !correction.body.includes("RETRACTION")
) {
  throw new Error("authoritative V1 baseline correction is missing or incomplete");
}

const results = [];
for (const slug of targets) {
  const article = await caller.kb.get({ slug });
  if (!article) throw new Error(`correction target not found: ${slug}`);
  if (!categories.includes(article.category as (typeof categories)[number])) {
    throw new Error(`invalid KB category for ${slug}: ${article.category}`);
  }
  if (!statuses.includes(article.status as (typeof statuses)[number])) {
    throw new Error(`invalid KB status for ${slug}: ${article.status}`);
  }

  const updated = !article.body.includes(marker);
  if (updated) {
    const sources = Array.isArray(article.sources)
      ? article.sources.filter((source): source is { title: string; url: string } =>
        !!source
        && typeof source === "object"
        && typeof (source as { title?: unknown }).title === "string"
        && typeof (source as { url?: unknown }).url === "string"
      )
      : undefined;
    await caller.kb.upsert({
      slug: article.slug,
      title: article.title,
      category: article.category as (typeof categories)[number],
      tags: article.tags ?? [],
      body: [
        article.body.trim(),
        "",
        marker,
        "",
        `Correction propagated ${new Date().toISOString()} from \`${correctionSlug}\`.`,
        "",
        "- The earlier claim that `jester_v1_remastered` entries were approximately 3.2σ counter-informative compared 37.8% with an assumed 50% symmetric-bracket baseline.",
        "- The catalogue screen established that the same measurement has an empirical cross-sectional median near 40.3%, largely because ambiguous bars are conservatively resolved stop-first. Against that centre, 37.8% is ordinary—not established directional information.",
        "- Absolute significance against 50% is invalid for this screen. Future entry-quality screens must compare against the frozen empirical cross-sectional centre.",
        "- Registered `fadeV1` and `followV1` rows remain valid prospective hypotheses only. This correction changes no bridge, signal ingestion, paper row, gate, threshold, side, or execution setting, and grants neither orientation any retrospective evidentiary weight.",
      ].join("\n"),
      sources,
      status: article.status as (typeof statuses)[number],
      supersededBySlug: article.supersededBySlug ?? undefined,
    });
  }

  const resourceId = `${slug}:${correctionSlug}`;
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
  results.push({
    slug,
    updated,
    auditInserted: !existingAudit,
  });
}

console.log(JSON.stringify({
  correctionSlug,
  marker,
  targets: results,
}, null, 2));
process.exit(0);
