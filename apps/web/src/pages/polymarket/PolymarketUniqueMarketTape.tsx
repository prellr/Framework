import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PolymarketAssetLink } from "./PolymarketAssetLink";
import {
  nextSortState,
  PolymarketSortableHeader,
  stableSortRows,
  type SortState,
} from "./PolymarketSortableHeader";

export type UniqueMarketTapeCell = {
  pair: string;
  horizonMin: number;
  n: number;
  up: number;
  down: number;
};

const PAIRS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "BNB-USD"] as const;
const HORIZONS = [5, 15] as const;
type TapeSortKey = "asset" | "5" | "15";

const wilson95 = (wins: number, n: number): [number, number] | null => {
  if (n <= 0) return null;
  const z = 1.959963984540054;
  const p = wins / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
};

export function PolymarketUniqueMarketTape({
  assetTape,
  scopeLabel,
  scope,
}: {
  assetTape: readonly UniqueMarketTapeCell[] | null | undefined;
  scopeLabel?: string;
  scope?: "paper" | "forward" | "history";
}) {
  const [sort, setSort] = useState<SortState<TapeSortKey>>({
    key: "asset",
    direction: "asc",
  });
  const rows = stableSortRows(
    PAIRS,
    (pair) => {
      if (sort.key === "asset") return pair;
      const horizonMin = Number(sort.key);
      const bucket = assetTape?.find(
        (item) => item.pair === pair && item.horizonMin === horizonMin,
      );
      return bucket?.n ? bucket.up / bucket.n : null;
    },
    sort.direction,
  );
  const onSort = (key: TapeSortKey, initialDirection: "asc" | "desc" = "desc") =>
    setSort((current) => nextSortState(current, key, initialDirection));

  return (
    <Card className="overflow-hidden shadow-none">
      <CardHeader className="border-b p-4">
        <CardTitle className="text-base">
          Unique market tape
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {scopeLabel ? `${scopeLabel} · ` : ""}one resolved market = one observation · UP base rate with 95% interval
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm tabular-nums">
            <thead>
              <tr className="border-b bg-muted/20 text-left text-xs uppercase text-muted-foreground">
                <PolymarketSortableHeader column="asset" active={sort.key} direction={sort.direction} onSort={onSort} initialDirection="asc" className="px-4 py-2 font-medium">Asset</PolymarketSortableHeader>
                {HORIZONS.map((horizonMin) => (
                  <PolymarketSortableHeader key={horizonMin} column={String(horizonMin) as TapeSortKey} active={sort.key} direction={sort.direction} onSort={onSort} className="px-4 py-2 font-medium">{horizonMin}m outcomes</PolymarketSortableHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((pair) => (
                <tr key={pair} className="border-b last:border-0">
                  <td className="px-4 py-2 font-medium">
                    <PolymarketAssetLink asset={pair} scope={scope} />
                  </td>
                  {HORIZONS.map((horizonMin) => {
                    const bucket = assetTape?.find((item) => item.pair === pair && item.horizonMin === horizonMin);
                    const interval = bucket ? wilson95(bucket.up, bucket.n) : null;
                    return (
                      <td key={horizonMin} className="px-4 py-2">
                        {!bucket || bucket.n === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <PolymarketAssetLink
                            asset={pair}
                            scope={scope}
                            horizonMin={horizonMin}
                            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span
                              className="contents"
                            title={`${bucket.up} UP / ${bucket.down} DOWN unique resolved markets. Strategy rows can repeat each outcome across multiple bots.`}
                            >
                            <span className="font-medium">{Math.round((100 * bucket.up) / bucket.n)}% UP</span>
                            <span className="text-xs text-muted-foreground">n {bucket.n}</span>
                            {interval && (
                              <span className="text-[10px] text-muted-foreground">
                                95% {Math.round(interval[0] * 100)}–{Math.round(interval[1] * 100)}%
                              </span>
                            )}
                            </span>
                          </PolymarketAssetLink>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          Derived from the universal Always Down control, so every market is counted once. This is the asset outcome tape—not a strategy score. Strategy win rates are conditional on entry and can share the same market with many other bots.
        </p>
      </CardContent>
    </Card>
  );
}
