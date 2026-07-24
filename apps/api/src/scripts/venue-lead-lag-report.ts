/** Descriptive-only CLI. Do not use its output as a bot without a separate preregistration. */
import { VENUE_REPORT_PAIRS, venueLeadLagReport } from "../services/venue-lead-lag-report.ts";

const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const days = Number(daysArg?.split("=")[1] ?? 3);
if (!(days > 0) || !Number.isFinite(days)) throw new Error("--days must be a positive number");
const toMs = Date.now(), fromMs = toMs - days * 86_400_000;
const reports = [];
for (const pair of VENUE_REPORT_PAIRS) reports.push(...await venueLeadLagReport(pair, fromMs, toMs));
console.log(JSON.stringify({ protocol: "LEAD-LAG-REPORT-V1", fromMs, toMs, reports }, null, 2));
