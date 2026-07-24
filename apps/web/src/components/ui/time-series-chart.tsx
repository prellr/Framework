import { useEffect, useMemo, useRef, useState } from "react";

export interface Pt {
  t: number; // epoch ms
  v: number;
}

const money = (v: number) =>
  `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/**
 * SVG area+line chart for a value-over-time series, with an interactive scrubber: hover or
 * click-drag across it to read the value and timestamp at each point (crosshair + floating readout).
 * The viewBox tracks the MEASURED pixel width, so it's a true 1:1 canvas — no aspect-ratio
 * letterboxing — keeping the crosshair exactly under the cursor and the chart full-width.
 *
 * `signed` colors the series by whether the latest value is +/- (for PnL-style data that crosses 0);
 * otherwise it's colored by net direction over the window. `money` formats values as USD.
 */
export function TimeSeriesChart({
  points,
  money: isMoney,
  signed,
  height = 170,
}: {
  points: Pt[];
  money?: boolean;
  signed?: boolean;
  height?: number;
}) {
  const H = height, pad = { l: 54, r: 12, t: 14, b: 22 };
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(700);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { path, area, first, last, min, max, dataMin, dataMax, zeroY, up, geo } = useMemo(() => {
    const ts = points.map((p) => p.t);
    const vs = points.map((p) => p.v);
    const tMin = Math.min(...ts), tMax = Math.max(...ts);
    const dataMin = Math.min(...vs), dataMax = Math.max(...vs);
    let vMin = dataMin, vMax = dataMax;
    // Fit the SELECTED window's actual range. `signed` only guarantees the zero baseline is in view
    // (so you can see above/below water) — it must NOT mirror the domain, which would waste half the
    // canvas and flatten the curve whenever the series sits mostly on one side of zero.
    if (signed) { vMin = Math.min(vMin, 0); vMax = Math.max(vMax, 0); }
    if (vMax === vMin) { vMax += 1; vMin -= 1; }
    const pad2 = (vMax - vMin) * 0.08 || 1;
    vMin -= pad2; vMax += pad2;
    const xOf = (t: number) => pad.l + (W - pad.l - pad.r) * ((t - tMin) / (tMax - tMin || 1));
    const yOf = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - vMin) / (vMax - vMin || 1));
    const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(" ");
    const a = `${d} L${xOf(tMax).toFixed(1)},${yOf(vMin).toFixed(1)} L${xOf(tMin).toFixed(1)},${yOf(vMin).toFixed(1)} Z`;
    const g = points.map((p) => ({ x: xOf(p.t), y: yOf(p.v), t: p.t, v: p.v }));
    const zeroY = vMin < 0 && vMax > 0 ? yOf(0) : null;
    return {
      path: d, area: a, first: vs[0], last: vs[vs.length - 1],
      min: vMin, max: vMax, dataMin, dataMax, zeroY,
      up: vs[vs.length - 1] >= vs[0], geo: g,
    };
  }, [points, signed, W, H]);

  const fmt = (v: number) => (isMoney ? money(v) : v.toFixed(2));
  const change = last - first;
  const tone = signed ? (last >= 0 ? "text-success" : "text-destructive") : up ? "text-success" : "text-destructive";
  const spanMs = points[points.length - 1].t - points[0].t;
  const showTime = spanMs < 2 * 86_400_000;
  const dfmt = (t: number) => {
    const d = new Date(t);
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    return showTime ? `${md} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : md;
  };

  const onMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * W;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < geo.length; i++) {
      const dd = Math.abs(geo[i].x - svgX);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    setHover(best);
  };

  const hp = hover != null ? geo[hover] : null;
  const headVal = hp ? hp.v : last;
  const headSub = hp ? dfmt(hp.t) : `${change >= 0 ? "+" : ""}${fmt(change)} over period`;
  const labelLeft = hp ? hp.x > W * 0.6 : false;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-semibold tabular-nums">{fmt(headVal)}</span>
        <span className={"text-sm tabular-nums " + (hp ? "text-muted-foreground" : change >= 0 ? "text-success" : "text-destructive")}>
          {headSub}
        </span>
        {/* Actual high/low over the SELECTED window — the range the axis is now fitted to. */}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          high <span className="text-foreground">{fmt(dataMax)}</span> · low{" "}
          <span className="text-foreground">{fmt(dataMin)}</span>
        </span>
      </div>
      <div ref={wrapRef}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: H }}
          className="touch-none select-none"
          onMouseMove={(e) => onMove(e.clientX)}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => onMove(e.touches[0].clientX)}
          onTouchMove={(e) => onMove(e.touches[0].clientX)}
          onTouchEnd={() => setHover(null)}
        >
          {/* Zero baseline, only when the series actually crosses it. */}
          {zeroY != null && (
            <line
              x1={pad.l} y1={zeroY} x2={W - pad.r} y2={zeroY}
              stroke="currentColor" className="text-muted-foreground" strokeOpacity={0.35}
              strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke"
            />
          )}
          <g className={tone}>
            <path d={area} fill="currentColor" opacity={0.1} />
            <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </g>
          <text x={pad.l - 6} y={pad.t + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">{fmt(max)}</text>
          <text x={pad.l - 6} y={H - pad.b} textAnchor="end" className="fill-muted-foreground text-[10px]">{fmt(min)}</text>
          <text x={pad.l} y={H - 5} className="fill-muted-foreground text-[10px]">{dfmt(points[0].t)}</text>
          <text x={W - pad.r} y={H - 5} textAnchor="end" className="fill-muted-foreground text-[10px]">{dfmt(points[points.length - 1].t)}</text>

          {hp && (
            <g>
              <line x1={hp.x} y1={pad.t} x2={hp.x} y2={H - pad.b} stroke="currentColor" className="text-muted-foreground" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              <circle cx={hp.x} cy={hp.y} r={6} className={tone} fill="currentColor" opacity={0.2} />
              <circle cx={hp.x} cy={hp.y} r={3.5} className={tone} fill="currentColor" />
              <g transform={`translate(${labelLeft ? hp.x - 104 : hp.x + 10}, ${Math.max(pad.t, Math.min(hp.y - 18, H - pad.b - 38))})`}>
                <rect width={96} height={36} rx={5} className="fill-card stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <text x={8} y={15} className="fill-foreground text-[11px] font-semibold">{fmt(hp.v)}</text>
                <text x={8} y={28} className="fill-muted-foreground text-[10px]">{dfmt(hp.t)}</text>
              </g>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
