/**
 * Read-only diagnostic: dump the structure of Jester's live-config tools so we can see where the
 * ACTIVE param code (the combo an automation is actually trading) lives. No mutation, no secrets.
 */
import { db, jesterCredentials } from "@framework/db";
import { jesterCall } from "../services/jester.ts";

const trunc = (o: unknown, n = 4000) => {
  const s = JSON.stringify(o, null, 2);
  return s.length > n ? s.slice(0, n) + `\n… (${s.length} chars total)` : s;
};

async function main() {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) {
    console.log("no credential");
    process.exit(1);
  }
  for (const name of ["jester_strategy_settings", "jester_my_strategies", "jester_automation_center"]) {
    try {
      const res = await jesterCall(cred.userId, "POST", "/api/delegated/mcp/tool", { name, args: {} });
      console.log(`\n===== ${name} =====`);
      console.log(trunc(res?.result ?? res));
    } catch (err) {
      console.log(`\n===== ${name} FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
