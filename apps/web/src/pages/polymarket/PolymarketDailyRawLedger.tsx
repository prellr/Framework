import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { summarizeDailyRawRows } from "./polymarket-daily-raw-summary";
import {
  nextSortState,
  PolymarketSortableHeader,
  stableSortRows,
  type SortState,
} from "./PolymarketSortableHeader";

export type DailyRawLedger = {
  version: string;
  timeZone: string;
  attributionClock: string;
  defaultVisibleDays: number;
  rangeOptions: number[];
  completedDayReviewFloor: number;
  reviewPolicy: string;
  currentDay: string;
  rows: { botKey: string; horizonMin: number; day: string; n: number; raw: number }[];
};

type LedgerBot = { key: string; name: string; color: string };
type RangeKey = "7" | "14" | "30" | "all";

const usd = (value: number) =>
  `${value < 0 ? "-" : "+"}$${Math.abs(value).toFixed(2)}`;

const parseDay = (key: string) => new Date(`${key}T12:00:00`);

/** Calendar-date arithmetic intentionally runs at UTC noon so DST cannot skip or duplicate a key. */
export function inclusiveDayKeys(first: string, last: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(first) || !/^\d{4}-\d{2}-\d{2}$/.test(last) || first > last) return [];
  const start = new Date(`${first}T12:00:00Z`);
  const end = new Date(`${last}T12:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return [];
  const keys: string[] = [];
  for (let at = start.getTime(); at <= end.getTime() && keys.length < 3_660; at += 86_400_000) {
    keys.push(new Date(at).toISOString().slice(0, 10));
  }
  return keys;
}

export function PolymarketDailyRawLedger({
  ledger,
  bots,
  title = "Daily ledger RAW",
  subtitle = "realized P&L by Chicago calendar day",
  horizonMin,
}: {
  ledger: DailyRawLedger;
  bots: LedgerBot[];
  title?: string;
  subtitle?: string;
  horizonMin?: 5 | 15;
}) {
  const [range, setRange] = useState<RangeKey>(() => {
    const saved = localStorage.getItem("floor.dailyRawRange") as RangeKey | null;
    return saved && ["7", "14", "30", "all"].includes(saved)
      ? saved
      : String(ledger.defaultVisibleDays) as RangeKey;
  });
  const [sort, setSort] = useState<SortState<string>>({
    key: "range",
    direction: "desc",
  });
  const chooseRange = (next: RangeKey) => {
    setRange(next);
    localStorage.setItem("floor.dailyRawRange", next);
  };

  const filteredRows = useMemo(
    () => ledger.rows.filter((row) => horizonMin == null || row.horizonMin === horizonMin),
    [horizonMin, ledger.rows],
  );
  const allDays = useMemo(() => {
    const observed = filteredRows.map((row) => row.day).sort();
    const first = observed[0] ?? ledger.currentDay;
    const last = [observed[observed.length - 1], ledger.currentDay]
      .filter(Boolean)
      .sort()
      .at(-1) ?? ledger.currentDay;
    return inclusiveDayKeys(first, last);
  }, [filteredRows, ledger.currentDay]);
  const days = range === "all" ? allDays : allDays.slice(-Number(range));
  const cellByKey = new Map<string, { botKey: string; day: string; n: number; raw: number }>();
  for (const row of filteredRows) {
    const key = `${row.botKey}|${row.day}`;
    const current = cellByKey.get(key) ?? { botKey: row.botKey, day: row.day, n: 0, raw: 0 };
    current.n += row.n;
    current.raw += row.raw;
    cellByKey.set(key, current);
  }
  const activeBots = bots.filter((bot) => filteredRows.some((row) => row.botKey === bot.key));
  const visibleBots = activeBots.length ? activeBots : bots;
  const botRows = visibleBots.map((bot) => {
    const cells = days.map((day) => cellByKey.get(`${bot.key}|${day}`));
    return {
      bot,
      cells,
      rangeRaw: cells.reduce((sum, row) => sum + (row?.raw ?? 0), 0),
      rangeN: cells.reduce((sum, row) => sum + (row?.n ?? 0), 0),
    };
  });
  const sortedBotRows = stableSortRows(
    botRows,
    (row) => sort.key === "strategy"
      ? row.bot.name
      : sort.key === "range"
        ? row.rangeRaw
        : row.cells[days.indexOf(sort.key)]?.raw,
    sort.direction,
  );
  const sortRows = (key: string, initialDirection: "asc" | "desc" = "desc") =>
    setSort((current) => nextSortState(current, key, initialDirection));
  const singleBot = visibleBots.length === 1 ? visibleBots[0] : null;

  const singleSeries = singleBot
    ? days.map((day) => ({ day, row: cellByKey.get(`${singleBot.key}|${day}`) }))
    : [];
  const singleMaxAbs = Math.max(0.01, ...singleSeries.map(({ row }) => Math.abs(row?.raw ?? 0)));
  const singleSummary = singleBot
    ? summarizeDailyRawRows(
        singleSeries.flatMap(({ day, row }) => row
          ? [{ day, n: row.n, raw: row.raw }]
          : []),
        ledger.currentDay,
      )
    : null;

  return (
    <Card data-testid="daily-raw-ledger">
      <CardHeader className="border-b p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              {title}
              <span className="text-xs font-normal text-muted-foreground">{subtitle}</span>
            </CardTitle>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {ledger.timeZone} · attributed when the market is graded · selected Paper Floor scope
              {horizonMin ? ` · ${horizonMin}m only` : " · 5m + 15m"}
            </p>
          </div>
          <div className="flex rounded-md border bg-muted/10 p-0.5 text-xs">
            {(["7", "14", "30", "all"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => chooseRange(key)}
                aria-pressed={range === key}
                className={"rounded px-2 py-1 transition-colors " + (range === key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground")}
              >
                {key === "all" ? "All" : `${key}D`}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {singleBot && days.length > 0 && singleSummary && (
          <div className="space-y-4 border-b px-4 py-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <DailyMetric
                label="Completed days"
                value={String(singleSummary.completedDays)}
                sub={`${singleSummary.observedDays} incl. live · review at ${ledger.completedDayReviewFloor}`}
              />
              <DailyMetric
                label="Positive days"
                value={singleSummary.completedDays
                  ? `${singleSummary.positiveCompletedDays}/${singleSummary.completedDays}`
                  : "—"}
                sub={singleSummary.completedDays
                  ? `${singleSummary.negativeCompletedDays} negative · ${singleSummary.flatCompletedDays} flat`
                  : "waiting for a completed day"}
              />
              <DailyMetric
                label="Median day"
                value={singleSummary.medianCompletedRaw == null ? "—" : usd(singleSummary.medianCompletedRaw)}
                tone={singleSummary.medianCompletedRaw}
                sub="completed days only"
              />
              <DailyMetric
                label="Best day"
                value={singleSummary.bestCompleted ? usd(singleSummary.bestCompleted.raw) : "—"}
                tone={singleSummary.bestCompleted?.raw}
                sub={singleSummary.bestCompleted?.day ?? "no completed day"}
              />
              <DailyMetric
                label="Worst day"
                value={singleSummary.worstCompleted ? usd(singleSummary.worstCompleted.raw) : "—"}
                tone={singleSummary.worstCompleted?.raw}
                sub={singleSummary.worstCompleted?.day ?? "no completed day"}
              />
              <DailyMetric
                label="Today · live"
                value={singleSummary.current ? usd(singleSummary.current.raw) : "—"}
                tone={singleSummary.current?.raw}
                sub={singleSummary.current
                  ? `${singleSummary.current.n} graded so far`
                  : "no grades yet"}
              />
            </div>
            <div className="relative h-44 overflow-hidden rounded-md border bg-muted/10">
              <div className="absolute inset-x-0 top-1/2 border-t border-dashed" />
              <div className="absolute inset-0 flex items-stretch gap-1 px-3">
                {singleSeries.map(({ day, row }) => {
                  const value = row?.raw ?? 0;
                  const height = `${Math.max(value === 0 ? 1 : 3, Math.abs(value) / singleMaxAbs * 46)}%`;
                  return (
                    <div key={day} className="group relative flex min-w-8 flex-1">
                      <div
                        className={"absolute left-[15%] right-[15%] rounded-sm " + (value > 0
                          ? "bottom-1/2 bg-success/70"
                          : value < 0
                            ? "top-1/2 bg-destructive/70"
                            : "bottom-1/2 bg-muted-foreground/25")}
                        style={{ height }}
                        title={`${day}: ${row ? `${usd(value)} · ${row.n} graded` : "no grades"}`}
                      />
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                        {parseDay(day).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <div className="max-h-[34rem] overflow-auto">
          <table className="min-w-full text-xs tabular-nums">
            <thead className="sticky top-0 z-20 border-b bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <PolymarketSortableHeader column="strategy" active={sort.key} direction={sort.direction} onSort={sortRows} initialDirection="asc" className="sticky left-0 z-30 min-w-56 bg-card px-4 py-2 font-medium">Strategy</PolymarketSortableHeader>
                {days.map((day) => (
                  <PolymarketSortableHeader key={day} column={day} active={sort.key} direction={sort.direction} onSort={sortRows} align="right" className="min-w-24 px-3 py-2 font-medium">
                    {parseDay(day).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" })}
                  </PolymarketSortableHeader>
                ))}
                <PolymarketSortableHeader column="range" active={sort.key} direction={sort.direction} onSort={sortRows} align="right" className="min-w-24 px-4 py-2 font-medium">Range</PolymarketSortableHeader>
              </tr>
            </thead>
            <tbody>
              {sortedBotRows.map(({ bot, cells, rangeRaw, rangeN }) => {
                return (
                  <tr key={bot.key} className="border-b last:border-0">
                    <td className="sticky left-0 z-10 bg-card px-4 py-2.5 font-medium">
                      <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: bot.color }} />
                      {bot.name}
                    </td>
                    {cells.map((row, index) => {
                      const value = row?.raw ?? 0;
                      return (
                        <td
                          key={days[index]}
                          className={"px-3 py-2.5 text-right " + (!row
                            ? "text-muted-foreground/35"
                            : value > 0
                              ? "bg-success/5 text-success"
                              : value < 0
                                ? "bg-destructive/5 text-destructive"
                                : "text-muted-foreground")}
                          title={row ? `${usd(value)} from ${row.n} graded trades` : "No trades graded"}
                        >
                          {row ? `${value < 0 ? "-" : "+"}$${Math.abs(value).toFixed(0)}` : "—"}
                        </td>
                      );
                    })}
                    <td className={"px-4 py-2.5 text-right font-semibold " + (rangeRaw > 0
                      ? "text-success"
                      : rangeRaw < 0
                        ? "text-destructive"
                        : "text-muted-foreground")}
                      title={`${rangeN} graded trades in the selected range`}
                    >
                      {rangeN ? usd(rangeRaw) : "—"}
                    </td>
                  </tr>
                );
              })}
              {!visibleBots.length && (
                <tr><td colSpan={days.length + 2} className="p-8 text-center text-muted-foreground">No graded daily ledger rows in this scope.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          A blank cell means no trade was graded that day. Strategies are intentionally not summed
          into a portfolio total because many make overlapping or mirrored decisions. Completed-day
          summaries are descriptive only, exclude the still-live Chicago day, and have no verdict
          gate or execution effect. Fourteen completed days permit a manual review; they do not
          constitute a pass.
        </p>
      </CardContent>
    </Card>
  );
}

function DailyMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: number | null;
}) {
  return (
    <div className="rounded-md border bg-muted/10 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={"mt-1 text-sm font-semibold tabular-nums " + (tone == null
        ? ""
        : tone > 0
          ? "text-success"
          : tone < 0
            ? "text-destructive"
            : "text-muted-foreground")}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={sub}>{sub}</div>
    </div>
  );
}
