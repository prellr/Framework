import {
  formulaOperatorCatalogStatus,
  type FormulaOperatorDefinition,
  type FormulaOperatorState,
} from "./formula-operator-catalog.ts";

const status = formulaOperatorCatalogStatus();

export const FORMULA_OPERATOR_CATALOG_KNOWLEDGE = {
  version: status.version,
  status: "active",
  sources: [
    {
      title: "Microsoft Qlib v0.9.5 operator implementation",
      url: "https://github.com/microsoft/qlib/blob/v0.9.5/qlib/data/ops.py",
    },
    {
      title: "Interpretable Machine Learning for Science with PySR and SymbolicRegression.jl",
      url: "https://arxiv.org/abs/2305.01582",
    },
    {
      title: "Alchemy Formula Lab research and validation framework v2",
      url: "https://jester.wisco.wine/knowledge/alchemy-formula-lab-research-framework-v2",
    },
  ],
  invariants: status.invariants,
} as const;

const stateTitle: Record<FormulaOperatorState, string> = {
  "active-search": "Active search grammar",
  "import-evaluator": "Pinned import evaluator",
  candidate: "Candidate operators",
  excluded: "Explicit exclusions",
};

function operatorLine(operator: FormulaOperatorDefinition): string {
  const parameters = operator.parameters.length
    ? ` Parameters: ${operator.parameters
        .map((parameter) =>
          `${parameter.name} ${parameter.minimum}–${parameter.maximum} (default ${parameter.default})`,
        )
        .join("; ")}.`
    : "";
  return `- **${operator.label}** (\`${operator.id}\`, arity ${operator.arity}): ${operator.description} Guard: ${operator.guard}. Unit rule: ${operator.unitRule}.${parameters}`;
}

export function renderFormulaOperatorCatalogKnowledge(recordedAtIso: string): string {
  return [
    "## Alchemy Formula Lab operator catalog v1",
    "",
    `Recorded ${recordedAtIso}. The catalog contains ${status.counts.total} governed definitions: ${status.counts.activeSearch} active, ${status.counts.importEvaluator} import-only, ${status.counts.candidate} candidates, and ${status.counts.excluded} excluded.`,
    "",
    "### Why the catalog exists",
    "",
    "- A formula search must not discover its own language while it is running. Operator identity, arity, parameters, causal lookback, unit behavior, numerical guards, and compute cost are versioned before candidate generation.",
    "- Adding an operator to this catalog does not add it to the generator. Only `active-search` entries are reachable by the current typed AST.",
    "- The number of formulas is a configurable experiment budget. A 20-formula smoke test and a distributed search use the same frozen catalog and manifest rules; 10,000 is a benchmark example, not a target.",
    "- Every attempted formula stays in the declared denominator, including invalid, non-finite, missing-history, and zero-trade candidates.",
    "",
    ...(["active-search", "import-evaluator", "candidate", "excluded"] as const).flatMap(
      (state) => [
        `### ${stateTitle[state]}`,
        "",
        ...status.operators.filter((operator) => operator.state === state).map(operatorLine),
        "",
      ],
    ),
    "### Admission protocol",
    "",
    "1. Define exact scalar or series semantics, parameter bounds, units, warm-up behavior, gap resets, and computational complexity.",
    "2. Add conformance tests against a pinned primary implementation where the operator is imported from another system.",
    "3. Prove causality: no future reference, full-sample normalization, label-derived state, or cross-boundary rolling window.",
    "4. Benchmark the operator on representative frame lengths and assign a per-experiment cost budget.",
    "5. Bump the grammar version and generate a new immutable candidate manifest. Old manifests retain their original semantics.",
    "6. Treat all results as discovery. A selected formula still requires a new untouched forward boundary and the existing validation gate.",
    "",
    "### Current boundary",
    "",
    "- Candidate rows are design options only. They cannot be emitted by the current generator.",
    "- Legacy Qlib rows exist only to reproduce the supplied Albert expression with pinned v0.9.5 behavior.",
    "- Future references and arbitrary code are always rejected.",
    "- The catalog has no database query, market-data read, strategy registration, paper-bot creation, search launch, signing, order, wallet, or execution path.",
  ].join("\n");
}
