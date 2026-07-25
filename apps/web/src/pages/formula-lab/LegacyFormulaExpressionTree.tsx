import { useMemo } from "react";

type LegacyFormulaNode =
  | {
      kind: "call";
      name: string;
      args: LegacyFormulaNode[];
    }
  | {
      kind: "feature";
      name: string;
    }
  | {
      kind: "constant";
      value: number;
    };

type PositionedNode = {
  id: string;
  x: number;
  y: number;
  title: string;
  detail: string;
  kind: LegacyFormulaNode["kind"];
  parentId: string | null;
};

const operatorDetails: Record<string, string> = {
  Less: "left < right",
  Max: "maximum",
  WMA: "weighted mean",
  Ref: "completed-bar lag",
  Mul: "multiply",
  Cov: "rolling covariance",
  Sub: "subtract",
  Div: "unprotected divide",
  Add: "add",
};

function describe(node: LegacyFormulaNode) {
  if (node.kind === "feature") {
    return {
      title: node.name.replace("$", ""),
      detail: "OHLCV field",
    };
  }
  if (node.kind === "constant") {
    return {
      title: String(node.value),
      detail: "constant",
    };
  }
  return {
    title: node.name,
    detail: operatorDetails[node.name] ?? "legacy call",
  };
}

function layoutExpression(expression: LegacyFormulaNode) {
  let leafIndex = 0;
  let maximumDepth = 0;
  const nodes: PositionedNode[] = [];

  const visit = (
    node: LegacyFormulaNode,
    depth: number,
    parentId: string | null,
    path: string,
  ): number => {
    maximumDepth = Math.max(maximumDepth, depth);
    const children = node.kind === "call" ? node.args : [];
    const childXs = children.map((child, index) =>
      visit(child, depth + 1, path, `${path}.${index}`),
    );
    const x = childXs.length
      ? childXs.reduce((sum, value) => sum + value, 0) / childXs.length
      : leafIndex++ * 166 + 83;
    nodes.push({
      id: path,
      x,
      y: depth * 86 + 28,
      kind: node.kind,
      parentId,
      ...describe(node),
    });
    return x;
  };

  visit(expression, 0, null, "root");
  return {
    nodes,
    width: Math.max(640, leafIndex * 166),
    height: (maximumDepth + 1) * 86 + 16,
  };
}

export function LegacyFormulaExpressionTree({
  expression,
  formula,
}: {
  expression: LegacyFormulaNode;
  formula: string;
}) {
  const layout = useMemo(() => layoutExpression(expression), [expression]);
  const byId = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);

  return (
    <div>
      <div className="bg-muted/10 border-b px-4 py-3">
        <div className="text-muted-foreground text-[10px] font-semibold uppercase tracking-[0.12em]">
          Exact imported source
        </div>
        <div className="text-foreground mt-1 overflow-x-auto pb-1 font-mono text-[11px] leading-relaxed">
          <span className="whitespace-nowrap">{formula}</span>
        </div>
      </div>
      <div className="overflow-x-auto px-4 py-4">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          className="max-w-none"
          role="img"
          aria-label="Parsed expression tree for the imported historical Albert formula"
        >
          {layout.nodes.map((node) => {
            if (!node.parentId) return null;
            const parent = byId.get(node.parentId);
            if (!parent) return null;
            return (
              <path
                key={`${node.parentId}:${node.id}`}
                d={`M ${parent.x} ${parent.y + 23} C ${parent.x} ${parent.y + 50}, ${node.x} ${node.y - 28}, ${node.x} ${node.y - 23}`}
                className="stroke-border fill-none"
                strokeWidth="1.5"
              />
            );
          })}
          {layout.nodes.map((node) => {
            const root = node.id === "root";
            return (
              <g key={node.id} transform={`translate(${node.x - 69} ${node.y - 23})`}>
                <rect
                  width="138"
                  height="46"
                  rx="7"
                  className={
                    root
                      ? "fill-warning stroke-warning"
                      : node.kind === "call"
                        ? "fill-muted stroke-border"
                        : "fill-card stroke-border"
                  }
                  strokeWidth="1.25"
                />
                <text
                  x="69"
                  y="19"
                  textAnchor="middle"
                  className={root ? "fill-warning-foreground" : "fill-foreground"}
                  fontSize="10.5"
                  fontWeight="600"
                >
                  {node.title}
                </text>
                <text
                  x="69"
                  y="34"
                  textAnchor="middle"
                  className={root ? "fill-warning-foreground opacity-75" : "fill-muted-foreground"}
                  fontSize="8.5"
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
