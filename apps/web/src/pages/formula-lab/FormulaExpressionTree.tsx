import { useMemo } from "react";
import { ArrowRight, Clock3, Sigma, Split } from "lucide-react";

export type FormulaExpression =
  | { op: "feature"; feature: string }
  | { op: "constant"; value: number }
  | { op: "neg" | "abs" | "tanh"; child: FormulaExpression }
  | {
      op: "add" | "sub" | "mul" | "protectedDiv";
      left: FormulaExpression;
      right: FormulaExpression;
    };

type PositionedNode = {
  id: string;
  x: number;
  y: number;
  depth: number;
  title: string;
  detail: string;
  kind: "feature" | "constant" | "operator";
  parentId: string | null;
};

const featureLabels: Record<string, string> = {
  chainlinkReturn60s: "Chainlink return",
  chainlinkReturn300s: "Chainlink return",
  hlReturn60s: "Hyperliquid return",
  hlReturn300s: "Hyperliquid return",
  basisBps: "Venue basis",
  basisChange60sBps: "Basis change",
  basisPersistence5s: "Basis persistence",
};

const featureDetails: Record<string, string> = {
  chainlinkReturn60s: "60 seconds",
  chainlinkReturn300s: "5 minutes",
  hlReturn60s: "60 seconds",
  hlReturn300s: "5 minutes",
  basisBps: "basis points",
  basisChange60sBps: "60 seconds",
  basisPersistence5s: "5-second path",
};

const operatorLabels: Record<string, [string, string]> = {
  neg: ["Negate", "−x"],
  abs: ["Absolute", "|x|"],
  tanh: ["Squash", "tanh(x)"],
  add: ["Add", "x + y"],
  sub: ["Subtract", "x − y"],
  mul: ["Multiply", "x × y"],
  protectedDiv: ["Protected divide", "x ÷ y"],
};

function nodeDescription(node: FormulaExpression) {
  if (node.op === "feature") {
    return {
      title: featureLabels[node.feature] ?? node.feature,
      detail: featureDetails[node.feature] ?? "feature",
      kind: "feature" as const,
    };
  }
  if (node.op === "constant") {
    return {
      title: String(node.value),
      detail: "constant",
      kind: "constant" as const,
    };
  }
  const [title, detail] = operatorLabels[node.op];
  return { title, detail, kind: "operator" as const };
}

function layoutExpression(expression: FormulaExpression) {
  let leafIndex = 0;
  let maximumDepth = 0;
  const nodes: PositionedNode[] = [];

  const visit = (
    node: FormulaExpression,
    depth: number,
    parentId: string | null,
    path: string,
  ): number => {
    maximumDepth = Math.max(maximumDepth, depth);
    const children =
      node.op === "neg" || node.op === "abs" || node.op === "tanh"
        ? [node.child]
        : node.op === "add"
          || node.op === "sub"
          || node.op === "mul"
          || node.op === "protectedDiv"
          ? [node.left, node.right]
          : [];
    const childXs = children.map((child, index) =>
      visit(child, depth + 1, path, `${path}.${index}`));
    const x = childXs.length
      ? childXs.reduce((sum, value) => sum + value, 0) / childXs.length
      : leafIndex++ * 190 + 95;
    const description = nodeDescription(node);
    nodes.push({
      id: path,
      x,
      y: depth * 92 + 30,
      depth,
      parentId,
      ...description,
    });
    return x;
  };

  visit(expression, 0, null, "root");
  const width = Math.max(420, leafIndex * 190);
  const horizontalOffset = Math.max(0, (width - leafIndex * 190) / 2);
  return {
    nodes: nodes.map((node) => ({
      ...node,
      x: node.x + horizontalOffset,
    })),
    width,
    height: (maximumDepth + 1) * 92 + 20,
  };
}

export function FormulaExpressionTree({
  expression,
  formula,
  thresholdZ,
  holdSeconds,
}: {
  expression: FormulaExpression;
  formula: string;
  thresholdZ: number;
  holdSeconds: number;
}) {
  const layout = useMemo(() => layoutExpression(expression), [expression]);
  const byId = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );

  return (
    <div>
      <div className="grid border-b sm:grid-cols-4">
        {[
          {
            icon: Split,
            label: "Inputs",
            value: "Causal features",
          },
          {
            icon: Sigma,
            label: "Expression",
            value: "Frozen tree",
          },
          {
            icon: ArrowRight,
            label: "Entry gate",
            value: `output z ≥ ${thresholdZ.toFixed(1)}`,
          },
          {
            icon: Clock3,
            label: "Paper target",
            value: `short · exit +${holdSeconds / 60}m`,
          },
        ].map((step, index) => (
          <div
            key={step.label}
            className="relative border-b px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <step.icon className="h-3.5 w-3.5" />
              {step.label}
            </div>
            <div className="mt-1.5 font-mono text-xs font-medium">{step.value}</div>
            {index < 3 ? (
              <ArrowRight className="absolute -right-2 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 bg-card text-muted-foreground sm:block" />
            ) : null}
          </div>
        ))}
      </div>

      <div className="px-4 py-4">
        <div className="mb-3 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-muted-foreground">
          {formula}
        </div>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Expression tree for ${formula}`}
        >
          {layout.nodes.map((node) => {
            if (!node.parentId) return null;
            const parent = byId.get(node.parentId);
            if (!parent) return null;
            return (
              <path
                key={`${node.parentId}:${node.id}`}
                d={`M ${parent.x} ${parent.y + 25} C ${parent.x} ${parent.y + 56}, ${node.x} ${node.y - 30}, ${node.x} ${node.y - 25}`}
                className="fill-none stroke-border"
                strokeWidth="2"
              />
            );
          })}
          {layout.nodes.map((node) => {
            const isRoot = node.id === "root";
            return (
              <g key={node.id} transform={`translate(${node.x - 76} ${node.y - 25})`}>
                <rect
                  width="152"
                  height="50"
                  rx="8"
                  className={
                    isRoot
                      ? "fill-primary stroke-primary"
                      : node.kind === "operator"
                        ? "fill-muted stroke-border"
                        : "fill-card stroke-border"
                  }
                  strokeWidth="1.5"
                />
                <text
                  x="76"
                  y="20"
                  textAnchor="middle"
                  className={isRoot ? "fill-primary-foreground" : "fill-foreground"}
                  fontSize="11"
                  fontWeight="500"
                >
                  {node.title}
                </text>
                <text
                  x="76"
                  y="36"
                  textAnchor="middle"
                  className={isRoot ? "fill-primary-foreground opacity-70" : "fill-muted-foreground"}
                  fontSize="9"
                >
                  {node.detail}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
