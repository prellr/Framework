/** Read-only: dump a strategy's numeric params + defaults so we can pick effective optimize levers. */
import { db, jesterCredentials } from "@framework/db";
import { getStrategyParams } from "../services/optimize.ts";

async function main() {
  const [cred] = await db.select({ userId: jesterCredentials.userId }).from(jesterCredentials).limit(1);
  if (!cred) return console.log("no cred");
  const sid = process.argv[2] ?? "mean_reversion_pocket_volume";
  const { defaults, numeric } = await getStrategyParams(cred.userId, sid, "BTC-USD", "15m");
  console.log("strategy:", sid);
  console.log("numeric params:", numeric.map((n: any) => `${n.name}=${n.value}`).join(", "));
  console.log("all defaults keys:", Object.keys(defaults).join(", "));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
