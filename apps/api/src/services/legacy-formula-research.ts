/**
 * Parser and evidence contract for a user-supplied historical Formula Lab expression.
 *
 * This module parses data only. It cannot evaluate a formula, read a tape or outcome, create a
 * strategy, write a paper decision, start a search job, or reach an execution path.
 */

export type LegacyFormulaNode =
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

type Token =
  | { kind: "identifier"; value: string }
  | { kind: "number"; value: number; source: string }
  | { kind: "leftParen" | "rightParen" | "comma" };

export const LEGACY_ALBERT_FORMULA_SOURCE =
  "Less(Max(WMA(Ref($low,2),40),20),Mul(Cov(Sub(Div($volume,$open),Sub(Ref($volume,4),Ref($close,5))),Add(Add($volume,$close),Add(Ref($low,3),$open)),50),Ref($open,1)))";

const OPERATOR_GLOSSARY: Record<
  string,
  {
    label: string;
    detail: string;
  }
> = {
  Less: {
    label: "Less than",
    detail: "Boolean entry predicate: left expression < right expression.",
  },
  Max: {
    label: "Maximum",
    detail: "Returns the larger input; here it places a floor under the lagged WMA branch.",
  },
  WMA: {
    label: "Weighted moving average",
    detail: "Weighted average of a prior-bar series over the declared lookback.",
  },
  Ref: {
    label: "Lagged reference",
    detail: "Reads a bar field at the declared number of completed bars in the past.",
  },
  Mul: {
    label: "Multiply",
    detail: "Multiplies the rolling covariance branch by the prior open.",
  },
  Cov: {
    label: "Rolling covariance",
    detail: "Covariance of two derived series over the declared 50-bar lookback.",
  },
  Sub: {
    label: "Subtract",
    detail: "Difference between two derived values.",
  },
  Div: {
    label: "Divide",
    detail: "Ratio of two values; a production grammar would require protected division.",
  },
  Add: {
    label: "Add",
    detail: "Sum of two derived values.",
  },
};

function tokenizeFormula(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ kind: "leftParen" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ kind: "rightParen" });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ kind: "comma" });
      index += 1;
      continue;
    }
    if (char === "-" || /\d/.test(char)) {
      const start = index;
      if (char === "-") index += 1;
      while (index < source.length && /\d/.test(source[index])) index += 1;
      if (source[index] === ".") {
        index += 1;
        while (index < source.length && /\d/.test(source[index])) index += 1;
      }
      const literal = source.slice(start, index);
      const value = Number(literal);
      if (!Number.isFinite(value)) {
        throw new Error(`invalid numeric literal at character ${start}: ${literal}`);
      }
      tokens.push({ kind: "number", value, source: literal });
      continue;
    }
    if (char === "$" || /[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) index += 1;
      tokens.push({ kind: "identifier", value: source.slice(start, index) });
      continue;
    }
    throw new Error(`unsupported formula character at ${index}: ${JSON.stringify(char)}`);
  }
  return tokens;
}

export function parseLegacyFormula(source: string): LegacyFormulaNode {
  const tokens = tokenizeFormula(source);
  let cursor = 0;

  const parseExpression = (): LegacyFormulaNode => {
    const token = tokens[cursor];
    if (!token) throw new Error("unexpected end of formula");
    if (token.kind === "number") {
      cursor += 1;
      return { kind: "constant", value: token.value };
    }
    if (token.kind !== "identifier") {
      throw new Error(`expected expression at token ${cursor}, received ${token.kind}`);
    }
    cursor += 1;
    const next = tokens[cursor];
    if (next?.kind !== "leftParen") {
      if (!token.value.startsWith("$")) {
        throw new Error(`bare identifiers must be source features: ${token.value}`);
      }
      return { kind: "feature", name: token.value };
    }

    cursor += 1;
    const args: LegacyFormulaNode[] = [];
    if (tokens[cursor]?.kind !== "rightParen") {
      while (true) {
        args.push(parseExpression());
        const delimiter = tokens[cursor];
        if (delimiter?.kind === "comma") {
          cursor += 1;
          continue;
        }
        if (delimiter?.kind === "rightParen") break;
        throw new Error(`expected comma or right parenthesis at token ${cursor}`);
      }
    }
    cursor += 1;
    return { kind: "call", name: token.value, args };
  };

  const expression = parseExpression();
  if (cursor !== tokens.length) {
    throw new Error(`unexpected trailing tokens at token ${cursor}`);
  }
  return expression;
}

export function renderLegacyFormula(node: LegacyFormulaNode): string {
  if (node.kind === "constant") return String(node.value);
  if (node.kind === "feature") return node.name;
  return `${node.name}(${node.args.map(renderLegacyFormula).join(",")})`;
}

export function legacyFormulaComplexity(node: LegacyFormulaNode): number {
  if (node.kind !== "call") return 1;
  return 1 + node.args.reduce((sum, child) => sum + legacyFormulaComplexity(child), 0);
}

export function legacyFormulaDepth(node: LegacyFormulaNode): number {
  if (node.kind !== "call") return 1;
  return 1 + Math.max(0, ...node.args.map(legacyFormulaDepth));
}

function collectCalls(
  node: LegacyFormulaNode,
  counts = new Map<string, number>(),
): Map<string, number> {
  if (node.kind !== "call") return counts;
  counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
  node.args.forEach((child) => collectCalls(child, counts));
  return counts;
}

function collectFeatures(node: LegacyFormulaNode, features = new Set<string>()): Set<string> {
  if (node.kind === "feature") features.add(node.name);
  if (node.kind === "call") node.args.forEach((child) => collectFeatures(child, features));
  return features;
}

const expression = parseLegacyFormula(LEGACY_ALBERT_FORMULA_SOURCE);
const operatorCounts = [...collectCalls(expression).entries()]
  .map(([name, count]) => ({
    name,
    count,
    label: OPERATOR_GLOSSARY[name]?.label ?? name,
    detail: OPERATOR_GLOSSARY[name]?.detail ?? "Imported legacy function.",
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

export const LEGACY_ALBERT_FORMULA_RESEARCH = {
  id: "legacy-albert-formula-2024-08",
  source: LEGACY_ALBERT_FORMULA_SOURCE,
  expression,
  canonicalSource: renderLegacyFormula(expression),
  complexity: legacyFormulaComplexity(expression),
  depth: legacyFormulaDepth(expression),
  operators: operatorCounts,
  features: [...collectFeatures(expression)].sort(),
  provenance: {
    kind: "user-provided-historical-conversation",
    period: "August–September 2024",
    suppliedAt: "2026-07-24",
    systemName: "Albert",
  },
  interpretation: [
    "The root Less predicate compares a lagged-low WMA branch with a rolling-covariance branch scaled by the prior open.",
    "The left branch takes the maximum of a 40-bar WMA of lows lagged two completed bars and the constant 20.",
    "The covariance uses a 50-bar lookback over two highly composite OHLCV-derived series.",
    "The right branch multiplies that covariance by the open from one completed bar ago.",
  ],
  researchLessons: [
    "Legacy formulas need an import parser and AST visualizer separate from the bounded executable search grammar.",
    "Raw formula output should be plotted against price before any threshold or trade rule is attached.",
    "Operator frequency, tree ancestry, complexity, signal density, and clustering should be retained for every generated formula.",
    "Information coefficient can be a training-only screening statistic, but survivors still require purged chronological validation and full trial-denominator accounting.",
    "Long and short searches, assets, entry thresholds, and fixed exit horizons are separate trial families.",
    "Cross-period minimum performance is a useful fragility diagnostic, not a substitute for untouched forward evidence.",
  ],
  warnings: [
    "Historical screenshots and reported win rates are discovery-era observations, not reproducible validation evidence.",
    "The expression mixes price and volume units and may be scale-dependent across assets or venue conventions.",
    "The unprotected Div operator and large composite products require explicit finite-value and overflow guards before evaluation.",
    "Importing this expression does not admit its functions, constants, or result into the current Formula Lab search grammar.",
  ],
  invariants: {
    evaluatesFormula: false,
    readsMarketData: false,
    readsOutcomes: false,
    createsStrategy: false,
    createsPaperBot: false,
    startsSearch: false,
    enablesExecution: false,
    preservesVerdictGate: true,
  },
} as const;
