type FindingStatus =
  | "Replicated"
  | "Measured"
  | "Fixed & verified"
  | "Strongly supported"
  | "In-sample"
  | "Retracted"
  | "Blocked"
  | "Operational";

type TableCell = {
  value: string;
  tone?: "positive" | "negative";
};

type Finding = {
  section: string;
  status: FindingStatus;
  eyebrow?: string;
  title: string;
  readout?: string;
  readoutDetail?: string;
  body: string[];
  note?: string;
  table?: {
    columns: string[];
    rows: TableCell[][];
    minWidth?: string;
  };
};

const FINDINGS: Finding[] = [
  {
    section: "Method correction",
    status: "Strongly supported",
    eyebrow: "mechanism unconfirmed",
    title: "The symmetric-bracket baseline is ~40%, not 50%",
    readout: "24 / 28 strategies below 50% · median 40.3%",
    readoutDetail: "n ≥ 20 trades each · BTC / ETH / SOL · 30 days",
    body: [
      "The method forces stop and target to equal distance so that a coin-flip entry scores 50%, making win rate a clean read on whether a strategy’s entries carry direction. Run on one strategy it looked sound. Run on twenty-eight it collapsed: almost everything sits near 40%.",
      "The likely mechanism is ordinary: when a five-minute bar touches both stop and target, the backtest resolves it as the stop. At intraday volatility that happens often enough to drag the full measurement distribution down.",
    ],
    note: "Consequence: absolute distance from 50% means nothing here. Only a strategy’s position relative to the observed cross-sectional centre carries information. Future screens rank against the empirical median.",
  },
  {
    section: "Retraction",
    status: "Retracted",
    eyebrow: "previously reported as a measured edge",
    title: "Jester V1’s entries are not established as counter-informative",
    readout: "37.8% vs 40.3% median · ordinary",
    readoutDetail: "previously reported as ~3.2σ below an assumed 50% baseline",
    body: [
      "Measured against the assumed 50% baseline, V1 looked meaningfully counter-informative and became the rationale for two registered bots that fade or follow it. Measured against the observed centre, it is only two and a half points below median.",
      "The catalogue-scale screen exposed what the single-strategy probe could not. Both bots remain registered, but fadeV1 and followV1 now stand on forward evidence only.",
    ],
  },
  {
    section: "Negative results",
    status: "Replicated",
    eyebrow: "two timeframes · cross-family control",
    title: "Combining strategies does not raise the hit rate",
    body: [
      "The middle row is the trap. Agreement among the top five looked like a large gain until we noticed that the top five included three variants of the same fade signal. Force genuine diversity, one strategy per family, and the gain inverts.",
    ],
    note: "Every apparent confluence gain traced to correlation, not confirmation. Independent signal families are the prerequisite; more voting logic is not.",
    table: {
      columns: ["Ensemble", "Markets", "Win rate", "vs individuals"],
      rows: [
        [
          { value: "SOL 5m · best-3, 2-of-3 agree" },
          { value: "37" },
          { value: "38%", tone: "negative" },
          { value: "46% → 38%", tone: "negative" },
        ],
        [
          { value: "SOL 15m · best-5, 3-of-5 agree" },
          { value: "16" },
          { value: "69%", tone: "positive" },
          { value: "54% → 69%", tone: "positive" },
        ],
        [
          { value: "SOL 15m · one per family, 3-of-5" },
          { value: "11" },
          { value: "36%", tone: "negative" },
          { value: "46% → 36%", tone: "negative" },
        ],
      ],
      minWidth: "42rem",
    },
  },
  {
    section: "Negative results",
    status: "Measured",
    eyebrow: "617 resolved markets",
    title: "These markets open efficiently — there is no favourite to fade",
    readout: "implied price 0.46–0.55 · median 0.51",
    readoutDetail: "window-start prices across every scored market",
    body: [
      "The published favourite-longshot bias is real in the literature but competed away by volume, and these markets are liquid. At the moment we decide, prices sit on the coin flip. There is no mispriced favourite at entry, so we stopped pursuing that family of edge.",
    ],
  },
  {
    section: "Corrected instrumentation",
    status: "Fixed & verified",
    title: "We were pricing against the wrong reference",
    readout: "Chainlink · not Hyperliquid",
    readoutDetail: "the contract resolves on its stated Chainlink data stream",
    body: [
      "These contracts settle on Chainlink. Our fair-value model had measured distance-to-strike on another exchange—a gap that is smallest at the open and most consequential near expiry. The pricer now reads the settlement feed directly and falls back cleanly rather than mixing sources.",
    ],
  },
  {
    section: "Corrected instrumentation",
    status: "Fixed & verified",
    title: "Cheap prices with no depth behind them were inflating results",
    readout: "DOGE 0.030 → 0.055 actual",
    readoutDetail: "real cost of a $5 order after walking the book",
    body: [
      "Paper trades were filling at the best quote regardless of size. On thin books that was fiction: this example cost 83% more once the order walked real depth. Every strategy now pays the size-weighted book price and skips markets too thin to fill.",
    ],
    note: "This matters retroactively. The asset leaderboard’s apparent leaders were concentrated in the thin markets the old fill model flattered, so pre-fix results are not trustworthy.",
  },
  {
    section: "Exploratory · not conclusions",
    status: "In-sample",
    eyebrow: "ranked against the observed centre",
    title: "Candidate signals from the catalogue screen",
    body: [
      "These are the tails of Figure 1, and nothing more. They were selected by looking at the same data that would judge them. Any candidate becomes real only after registration and evaluation on data that arrives afterward.",
    ],
    table: {
      columns: ["Strategy", "TF", "Trades", "Win rate", "vs centre"],
      rows: [
        [
          { value: "ichimoku_kijun_bounce_continuation" },
          { value: "15m" },
          { value: "79" },
          { value: "57.0%", tone: "positive" },
          { value: "+16.7", tone: "positive" },
        ],
        [
          { value: "vsa_volume_spread" },
          { value: "15m" },
          { value: "187" },
          { value: "54.0%", tone: "positive" },
          { value: "+13.7", tone: "positive" },
        ],
        [
          { value: "mass_index_reversal" },
          { value: "15m" },
          { value: "868" },
          { value: "51.2%", tone: "positive" },
          { value: "+10.9", tone: "positive" },
        ],
        [
          { value: "trade_planner" },
          { value: "5m" },
          { value: "8,732" },
          { value: "22.5%", tone: "negative" },
          { value: "−17.8", tone: "negative" },
        ],
        [
          { value: "ema_cloud_range_shift_rsi" },
          { value: "15m" },
          { value: "237" },
          { value: "17.7%", tone: "negative" },
          { value: "−22.6", tone: "negative" },
        ],
      ],
      minWidth: "46rem",
    },
  },
  {
    section: "Open · blocked",
    status: "Blocked",
    title: "Confirming the mechanism behind Figure 1",
    body: [
      "Widening the bracket should shrink the artifact because fewer bars would touch both levels. That is a decisive test of the stop-first explanation, but the practical reading does not depend on it: the empirical centre—not 50%—is the valid comparison point.",
    ],
  },
  {
    section: "Open · blocked",
    status: "Operational",
    title: "The backtest queue is not unmetered",
    readout: "93 runs in ~5 min → account-wide 403",
    readoutDetail: "~2 hour cooldown · previously believed unlimited",
    body: [
      "A burst of screening calls tripped an account-level block on every endpoint and briefly starved the signal loggers. Catalogue-scale work now runs sequentially with spacing, persists completed cells, and stops on the first rejection.",
    ],
  },
];

const SECTION_ORDER = [
  "Method correction",
  "Retraction",
  "Negative results",
  "Corrected instrumentation",
  "Exploratory · not conclusions",
  "Open · blocked",
];

const STATUS_TONE: Record<FindingStatus, string> = {
  Replicated: "bg-success/12 text-success ring-success/25",
  Measured: "bg-success/12 text-success ring-success/25",
  "Fixed & verified": "bg-success/12 text-success ring-success/25",
  "Strongly supported": "bg-warning/15 text-warning ring-warning/30",
  "In-sample": "bg-warning/15 text-warning ring-warning/30",
  Retracted: "bg-destructive/12 text-destructive ring-destructive/25",
  Blocked: "bg-muted text-muted-foreground ring-border",
  Operational: "bg-muted text-muted-foreground ring-border",
};

const DOTS = [
  [12, 22.5, 1.15], [22.2, 17, 1.9], [35, 23, 0.95], [36.1, 19.6, 0.85],
  [36.7, 15.4, 1.05], [36.7, 24.6, 0.9], [42.4, 20.4, 1], [48.8, 16, 0.95],
  [49.3, 23.4, 0.9], [51, 19.2, 1.1], [55, 13.8, 1.05], [56.3, 21.8, 1],
  [59.5, 17.4, 1.35], [59.9, 24.2, 1.25], [60.8, 20, 1.05], [63.2, 15, 1.35],
  [65.3, 22.6, 1.2], [67.2, 18.2, 1.2], [68.3, 24.8, 1], [72.8, 16.6, 0.95],
  [75, 21.2, 0.85], [80.5, 14.4, 1.3], [82.2, 23.8, 1.15], [83.5, 18.8, 1.4],
  [84.8, 22, 1.05], [86.5, 16.2, 0.95], [89.5, 20.6, 1.2], [96, 13.2, 1],
] as const;

function BaselineFigure() {
  return (
    <figure className="rounded-xl border bg-card p-4 sm:p-6">
      <div className="mb-5 flex flex-col gap-1 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Figure 1</p>
          <h2 className="mt-1 font-serif text-xl font-semibold tracking-tight sm:text-2xl">The baseline was in the wrong place</h2>
        </div>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">28 strategies · symmetric ±1×ATR</p>
      </div>
      <svg
        viewBox="0 0 100 34"
        className="block h-auto w-full min-w-[38rem]"
        role="img"
        aria-label="Strip plot of 28 strategy win rates clustered near 40 percent, with reference lines at the assumed 50 percent baseline and observed 40.3 percent median."
      >
        <line x1="2" y1="27" x2="98" y2="27" className="stroke-border" strokeWidth="0.25" />
        <line x1="82" y1="4" x2="82" y2="27" className="stroke-destructive" strokeWidth="0.4" strokeDasharray="1.2 1" />
        <text x="82" y="2.6" className="fill-destructive font-mono" fontSize="2.1" textAnchor="middle">assumed 50%</text>
        <line x1="60.6" y1="4" x2="60.6" y2="27" className="stroke-success" strokeWidth="0.5" />
        <text x="60.6" y="2.6" className="fill-success font-mono" fontSize="2.1" textAnchor="middle">observed median 40.3%</text>
        <g className="fill-muted-foreground font-mono" fontSize="2" textAnchor="middle">
          <text x="4" y="31">15%</text>
          <text x="27" y="31">25%</text>
          <text x="50" y="31">35%</text>
          <text x="73" y="31">45%</text>
          <text x="96" y="31">55%</text>
        </g>
        <g className="fill-muted-foreground" fillOpacity="0.82">
          {DOTS.slice(0, 26).map(([cx, cy, r], index) => <circle key={index} cx={cx} cy={cy} r={r} />)}
        </g>
        <g className="fill-success" fillOpacity="0.95">
          {DOTS.slice(26).map(([cx, cy, r], index) => <circle key={index} cx={cx} cy={cy} r={r} />)}
        </g>
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span>● one strategy · radius ∝ trade count</span>
        <span className="text-success">● above the observed centre</span>
      </div>
      <figcaption className="mt-4 max-w-4xl text-sm leading-6 text-muted-foreground">
        Twenty-four of 28 Jester strategies landed below the theoretical 50% line. A full distribution that sits roughly ten points away from its assumed baseline is a bent ruler, not twenty-four independently bad strategies.
      </figcaption>
    </figure>
  );
}

function FindingTable({ table }: { table: NonNullable<Finding["table"]> }) {
  const [sort, setSort] = useState<SortState<string>>({
    key: "0",
    direction: "asc",
  });
  const value = (cell: string, columnIndex: number) => {
    if (columnIndex === 0) return cell;
    const normalized = cell.replace(/[,$%+¢]/g, "").replace(/[−–—]/g, "-").trim();
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : cell;
  };
  const rows = stableSortRows(
    table.rows,
    (row) => value(row[Number(sort.key)]?.value ?? "", Number(sort.key)),
    sort.direction,
  );
  const onSort = (key: string, initialDirection: "asc" | "desc" = "desc") =>
    setSort((current) => nextSortState(current, key, initialDirection));

  return (
    <div className="max-w-full overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse font-mono text-xs tabular-nums" style={{ minWidth: table.minWidth ?? "36rem" }}>
        <thead className="bg-muted/35">
          <tr>
            {table.columns.map((column, columnIndex) => (
              <PolymarketSortableHeader
                key={column}
                column={String(columnIndex)}
                active={sort.key}
                direction={sort.direction}
                onSort={onSort}
                initialDirection={columnIndex === 0 ? "asc" : "desc"}
                className="whitespace-nowrap border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
              >
                {column}
              </PolymarketSortableHeader>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={
                    "whitespace-nowrap px-3 py-2.5 " +
                    (cell.tone === "positive"
                      ? "text-success"
                      : cell.tone === "negative"
                        ? "text-destructive"
                        : cellIndex === 0
                          ? "text-foreground"
                          : "text-muted-foreground")
                  }
                >
                  {cell.value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingEntry({ finding }: { finding: Finding }) {
  return (
    <article className="grid gap-5 border-t py-7 first:border-t-0 first:pt-0 md:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="space-y-2">
        <span className={"inline-flex rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset " + STATUS_TONE[finding.status]}>
          {finding.status}
        </span>
        {finding.eyebrow && (
          <p className="font-mono text-[10px] uppercase leading-4 tracking-[0.1em] text-muted-foreground">{finding.eyebrow}</p>
        )}
      </div>
      <div className="min-w-0 space-y-4">
        <h3 className="max-w-3xl font-serif text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{finding.title}</h3>
        {finding.readout && (
          <div className="border-l-2 border-foreground/70 py-1 pl-4">
            <p className="font-mono text-base font-medium tabular-nums text-foreground sm:text-lg">{finding.readout}</p>
            {finding.readoutDetail && (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{finding.readoutDetail}</p>
            )}
          </div>
        )}
        {finding.table && <FindingTable table={finding.table} />}
        <div className="max-w-3xl space-y-3 text-sm leading-6 text-muted-foreground">
          {finding.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        {finding.note && (
          <p className="max-w-3xl border-l-2 border-border pl-4 text-sm leading-6 text-muted-foreground">{finding.note}</p>
        )}
      </div>
    </article>
  );
}

export function PolymarketFindings() {
  const green = FINDINGS.filter((finding) => ["Replicated", "Measured", "Fixed & verified"].includes(finding.status)).length;
  const amber = FINDINGS.filter((finding) => ["Strongly supported", "In-sample"].includes(finding.status)).length;
  const red = FINDINGS.filter((finding) => finding.status === "Retracted").length;
  const slate = FINDINGS.filter((finding) => ["Blocked", "Operational"].includes(finding.status)).length;

  return (
    <div className="mx-auto max-w-6xl space-y-10 overflow-x-hidden pb-10">
      <header className="space-y-5 pt-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Polymarket Up/Down · research register</p>
          <h1 className="mt-2 max-w-3xl font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">What we actually learned</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
            Accumulated findings from the crypto Up/Down study, including negative results, corrected instrumentation, and the conclusion we retracted. Status is the primary signal: it tells you how much to trust each item.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.08em]">
          <span className="rounded-full bg-success/12 px-2.5 py-1 text-success ring-1 ring-inset ring-success/25">{green} established / fixed</span>
          <span className="rounded-full bg-warning/15 px-2.5 py-1 text-warning ring-1 ring-inset ring-warning/30">{amber} supported / in-sample</span>
          <span className="rounded-full bg-destructive/12 px-2.5 py-1 text-destructive ring-1 ring-inset ring-destructive/25">{red} retracted</span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground ring-1 ring-inset ring-border">{slate} blocked / operational</span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          <span>Compiled 2026-07-23</span>
          <span>Forward evaluation</span>
          <span>Paper only</span>
        </div>
      </header>

      <div className="overflow-x-auto">
        <BaselineFigure />
      </div>

      {SECTION_ORDER.map((section) => (
        <section key={section} aria-labelledby={`findings-${section.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
          <h2
            id={`findings-${section.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
            className="border-b pb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground"
          >
            {section}
          </h2>
          <div className="mt-6">
            {FINDINGS.filter((finding) => finding.section === section).map((finding) => (
              <FindingEntry key={finding.title} finding={finding} />
            ))}
          </div>
        </section>
      ))}

      <p className="max-w-3xl border-t pt-6 text-sm leading-6 text-muted-foreground">
        <strong className="font-semibold text-foreground">Why this register is rich in negative results.</strong>{" "}
        That is the honest output of pre-registration and forward evaluation: the discipline converts appealing patterns into discarded hypotheses before anyone acts on them. Findings that survive are valuable precisely because so many did not.
      </p>
    </div>
  );
}
import { useState } from "react";
import {
  nextSortState,
  PolymarketSortableHeader,
  stableSortRows,
  type SortState,
} from "./PolymarketSortableHeader";
