import { getSetting } from "../services/config.ts";
async function main() {
  const k = await getSetting("AGENT_API_KEY");
  const r = await fetch("http://localhost:3000/api/trpc/account.portfolio", { headers: { "X-API-Key": k! } });
  const j: any = await r.json();
  const pp = j?.result?.data?.json?.periodPnl;
  console.log("periodPnl:", JSON.stringify(pp, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
