import { db, jesterCredentials } from "@framework/db";
import { getSetting } from "../services/config.ts";
async function main() {
  const k = await getSetting("AGENT_API_KEY");
  for (const q of ["fdffabc2", "8932e057", "702ee6845ab5", "87d6dd63", "ichimoku"]) {
    const r = await fetch(`http://localhost:3000/api/trpc/search.global?input=${encodeURIComponent(JSON.stringify({ json: { q } }))}`, { headers: { "X-API-Key": k! } });
    const j: any = await r.json();
    const d = j?.result?.data?.json;
    if (!d) { console.log(`"${q}" -> ${JSON.stringify(j).slice(0,160)}`); continue; }
    console.log(`"${q}" -> live=${(d.live||[]).length} strategies=${d.strategies.length} codes=${d.codes.length} defaultCodes=${d.defaultCodes.length} pairs=${d.pairs.length}`);
    if ((d.live||[])[0]) console.log(`    LIVE: ${d.live[0].code} ${d.live[0].strategyId} ${d.live[0].pair}/${d.live[0].timeframe} ${d.live[0].endedAt ? "(ended)" : "(active)"}`);
    if (d.codes[0]) console.log(`    code hit: ${d.codes[0].code} ${d.codes[0].strategyId} ${d.codes[0].pair}/${d.codes[0].timeframe}`);
    if (d.defaultCodes[0]) console.log(`    default: ${d.defaultCodes[0].code} -> ${d.defaultCodes[0].name}`);
    if (d.strategies[0]) console.log(`    strategy: ${d.strategies[0].id}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
