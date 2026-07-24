import type { Job } from "bullmq";
import { availableParallelism, loadavg } from "node:os";
import { db, jesterCredentials } from "@framework/db";
import { connection } from "../queue.ts";
import { publishEvent } from "../../sse.ts";
import {
  COVERAGE_MAX_LOAD_PER_CPU,
  coverageEnabled,
  coverageLoadPerCpu,
  scanCoverage,
} from "../../services/coverage.ts";

let lastLoadDeferralLogAt = 0;

/**
 * Fill a few stale cells of the coverage matrix each tick. Cheap no-op while disarmed — the enabled
 * check short-circuits before any Jester call, so this scheduler can run always-on at zero cost
 * until a manager turns the engine on.
 */
export async function coverageScanProcessor(_job: Job): Promise<void> {
  if (!(await coverageEnabled())) return;
  const loadPerCpu = coverageLoadPerCpu(loadavg()[0] ?? Number.NaN, availableParallelism());
  if (loadPerCpu >= COVERAGE_MAX_LOAD_PER_CPU) {
    const now = Date.now();
    if (now - lastLoadDeferralLogAt >= 5 * 60_000) {
      console.warn(
        `[coverage] deferred loadPerCpu=${loadPerCpu.toFixed(3)}`
        + ` limit=${COVERAGE_MAX_LOAD_PER_CPU}`,
      );
      lastLoadDeferralLogAt = now;
    }
    return;
  }
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) return;
  try {
    const { ran, stale, target } = await scanCoverage(cred.userId);
    if (ran > 0) {
      console.log(`[coverage] filled ${ran} (stale ${stale} of ${target})`);
      await publishEvent(connection, "coverage.scanned", { ran, stale, target });
    }
  } catch (err) {
    console.error("[coverage] scan failed:", err instanceof Error ? err.message : err);
  }
}
