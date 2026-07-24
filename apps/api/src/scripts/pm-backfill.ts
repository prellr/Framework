import { backfillRetrospective, summarize } from "../services/polymarket-updown.ts";

async function main() {
  const hb = Number(process.env.HOURS) || 48;
  console.log(`Backfilling resolved six-asset Up/Down markets over the last ${hb}h, aligning to the Tesseract log…`);
  const rows = await backfillRetrospective(hb, 0.05);
  console.log(`\nscorable records (markets with an aligned Tesseract snapshot): ${rows.length}`);
  console.log(JSON.stringify(summarize(rows), null, 2));
  console.log("\nsample:");
  for (const r of rows.slice(0, 10)) {
    console.log(
      `  ${r.pair} ${String(r.horizonMin).padStart(2)}m | implied=${r.impliedPup.toFixed(2)} tess=${r.tessPup.toFixed(2)} edge=${r.edge >= 0 ? "+" : ""}${r.edge.toFixed(2)} | up=${r.resolvedUp ? "Y" : "n"} bet=${r.bet ?? "-"} profit=${r.profit != null ? r.profit.toFixed(3) : "—"} age=${Math.round(r.signalAgeSec)}s`,
    );
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
