/**
 * Record the outcome-blind Jester V1 source-health finding.
 *
 * This script reads only stored credential identities, the read-only Jester subscription audit,
 * local signal-row count, source text, and KB/audit metadata. It never subscribes, reads strategy
 * performance, inspects paper outcomes, or changes the frozen familywise roster.
 */
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { auditLogs, db, jesterCredentials, signalSnapshots } from "@framework/db";
import { appRouter } from "../trpc/router.ts";
import { audit } from "../services/audit.ts";
import {
  PAPER_FAMILYWISE_HYPOTHESES,
} from "../services/paper-familywise-gate.ts";
import { jesterCall } from "../services/jester.ts";
import { V1_SOURCE, V1_STRATEGY_ID } from "../services/signal-v1-logger.ts";

const slug = "updown-familywise-verdict-gate-v1";
const marker = "## Source-health finding — Jester V1 is not subscribed — 2026-07-25";
const action = "kb.source-health.record";
const resourceId = `${slug}:jester-v1-unsubscribed-2026-07-25`;
const categories = [
  "operations",
  "strategy",
  "research",
  "provider",
  "decision",
  "postmortem",
] as const;
const statuses = ["active", "superseded", "archived"] as const;
const expectedKeys = [
  "fadeV1:5",
  "fadeV1:15",
  "followV1:5",
  "followV1:15",
] as const;
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
  req: new Request("http://localhost/internal/kb-v1-subscription-health"),
};
const caller = appRouter.createCaller(ctx);

const article = await caller.kb.get({ slug });
if (!article) throw new Error(`KB article not found: ${slug}`);
if (!categories.includes(article.category as (typeof categories)[number])) {
  throw new Error(`invalid KB category: ${article.category}`);
}
if (!statuses.includes(article.status as (typeof statuses)[number])) {
  throw new Error(`invalid KB status: ${article.status}`);
}
for (const key of expectedKeys) {
  if (!PAPER_FAMILYWISE_HYPOTHESES.includes(key)) {
    throw new Error(`familywise roster no longer contains ${key}`);
  }
}

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

if (article.body.includes(marker)) {
  const auditInserted = await ensureAudit();
  console.log(JSON.stringify({
    updated: false,
    auditInserted,
    slug,
    marker,
  }, null, 2));
  process.exit(0);
}

const loggerSource = readFileSync(
  new URL("../services/signal-v1-logger.ts", import.meta.url),
  "utf8",
);
const sourceHealthSource = readFileSync(
  new URL("../services/signal-v1-source-health.ts", import.meta.url),
  "utf8",
);
if (
  !loggerSource.includes('"jester_subscription_audit"')
  || !loggerSource.includes("notificationSkipped: true")
  || !sourceHealthSource.includes("subscribed !== false")
  || /jester_automation_actions|subscribe_cached_best|jesterTradeCall/.test(
    `${loggerSource}\n${sourceHealthSource}`,
  )
) {
  throw new Error("V1 source-health implementation does not match the read-only contract");
}

const credentials = await db
  .select({ userId: jesterCredentials.userId })
  .from(jesterCredentials);
if (!credentials.length) throw new Error("no Jester credential available for source-health audit");

const subscriptionStates: boolean[] = [];
for (const credential of credentials) {
  let subscribed: boolean | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2 && subscribed == null; attempt++) {
    try {
      const response = await jesterCall(
        credential.userId,
        "POST",
        "/api/delegated/mcp/tool",
        {
          name: "jester_subscription_audit",
          args: { strategyId: V1_STRATEGY_ID },
        },
        20_000,
      );
      if (typeof response?.result?.subscribed === "boolean") {
        subscribed = response.result.subscribed;
      } else {
        lastError = new Error("subscription audit omitted its boolean subscribed field");
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (subscribed == null) {
    throw new Error(
      `subscription audit remained inconclusive: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
  subscriptionStates.push(subscribed);
}
if (subscriptionStates.some(Boolean)) {
  throw new Error("refusing stale finding because a stored account is now subscribed to Jester V1");
}

const signalRows = await db.$count(
  signalSnapshots,
  eq(signalSnapshots.source, V1_SOURCE),
);
if (signalRows !== 0) {
  throw new Error(`refusing zero-row finding because ${signalRows} Jester V1 signals now exist`);
}

const recordedAt = new Date().toISOString();
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
    `Recorded ${recordedAt} from read-only subscription audits and local source counts.`,
    "",
    `- All ${credentials.length} stored Jester analysis credential(s) reported \`subscribed=false\` for \`${V1_STRATEGY_ID}\`. No activation or subscription action was requested or executed.`,
    `- The local \`${V1_SOURCE}\` signal tape contained ${signalRows} rows. The four frozen hypotheses \`${expectedKeys.join("`, `")}\` therefore remain valid members of the 57-unit Holm family but have no captured candidate decision.`,
    "- This is a source-availability diagnosis, not evidence for either orientation. The hypotheses cannot satisfy their 200-paired-bet floor while the upstream strategy is unsubscribed, and they do not leave the family or release alpha to another candidate.",
    "- Operational correction: the existing 15-minute deep logger tick now checks the read-only subscription audit first. A confirmed unsubscribe becomes an explicit health state and suppresses interim notification/history calls; an unknown or timed-out audit continues polling so a transient Jester failure cannot silently drop a real signal.",
    "- No historical signal, paper row, market, comparator, threshold, strategy side, account subscription, verdict input, or execution setting was created, removed, or changed.",
  ].join("\n"),
  sources,
  status: article.status as (typeof statuses)[number],
  supersededBySlug: article.supersededBySlug ?? undefined,
});
const auditInserted = await ensureAudit();

console.log(JSON.stringify({
  updated: true,
  auditInserted,
  slug,
  marker,
  recordedAt,
  credentialCount: credentials.length,
  subscribedCredentialCount: subscriptionStates.filter(Boolean).length,
  signalRows,
  frozenKeys: expectedKeys,
}, null, 2));
process.exit(0);
