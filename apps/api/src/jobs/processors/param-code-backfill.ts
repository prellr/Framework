import type { Job } from "bullmq";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, strategies, backtestRuns, jesterCredentials } from "@framework/db";
import { connection } from "../queue.ts";
import { publishEvent } from "../../sse.ts";
import { resolveDefaultParamCode } from "../../services/backtest.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve a few strategies' default Jester param codes per tick. The code is account-independent
 * (it's a hash of the parameter set), so any user's stored credential works. The sync backtest
 * tool is rate-limited, so we do at most a couple per run with spacing; failures just retry next
 * tick. Once every strategy has a code, the missing-query returns nothing and this is a no-op.
 */
export async function paramCodeBackfillProcessor(_job: Job): Promise<void> {
  // OPT-IN as of 2026-07-22 (default OFF): this job targets the hard-rate-limited SYNC backtest tool
  // every 2 minutes; after days of running it had coded 6/191 strategies — ~all attempts were 429s
  // silently draining the account's rate budget (part of the rate-limit incident). Param codes are
  // fetchable on demand in the UI ("Fetch Jester code"), so the trickle is cosmetic. Re-enable via
  // param_code_backfill_enabled=true only if bulk codes are actually needed.
  const { getSetting } = await import("../../services/config.ts");
  if (((await getSetting("param_code_backfill_enabled")) ?? "false") !== "true") return;
  const [cred] = await db
    .select({ userId: jesterCredentials.userId })
    .from(jesterCredentials)
    .limit(1);
  if (!cred) return; // no key on file yet

  // Prioritise strategies that have actually been backtested (so codes for what the user is
  // looking at fill in first), then fall back to any strategy still missing a code.
  // random() so a strategy that keeps failing (rate limit or an unsupported cell) doesn't
  // permanently block the two head-of-queue slots — attempts spread across the whole set.
  let missing = await db
    .selectDistinct({ id: strategies.id })
    .from(strategies)
    .innerJoin(backtestRuns, eq(backtestRuns.strategyId, strategies.id))
    .where(and(isNull(strategies.defaultParamCode), eq(backtestRuns.paramHash, "default")))
    .orderBy(sql`random()`)
    .limit(4);
  if (missing.length === 0) {
    missing = await db
      .select({ id: strategies.id })
      .from(strategies)
      .where(isNull(strategies.defaultParamCode))
      .orderBy(sql`random()`)
      .limit(4);
  }
  if (missing.length === 0) return;

  for (let i = 0; i < missing.length; i++) {
    // The sync tool rate-limits intermittently, so retry a few times per strategy.
    const code = await resolveDefaultParamCode(cred.userId, missing[i].id, 3);
    if (code) {
      await publishEvent(connection, "paramcode.resolved", { strategyId: missing[i].id, code });
    }
    if (i < missing.length - 1) await sleep(6_000); // space out the rate-limited calls
  }
}
