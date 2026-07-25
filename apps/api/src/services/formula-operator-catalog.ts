/**
 * Governed Formula Lab operator catalog.
 *
 * This is descriptive metadata. Only `active-search` entries are reachable by the current bounded
 * generator. Import-only and candidate entries do not change FormulaNode or generation semantics.
 */
import { FORMULAIC_FIXED_HORIZON_POC } from "./formulaic-fixed-horizon-contract.ts";

export type FormulaOperatorState =
  | "active-search"
  | "import-evaluator"
  | "candidate"
  | "excluded";

export type FormulaOperatorCategory =
  | "input"
  | "arithmetic"
  | "transform"
  | "time-series"
  | "statistical"
  | "relational"
  | "conditional";

export type FormulaOperatorParameter = {
  name: string;
  kind: "integer" | "number";
  minimum: number;
  maximum: number;
  default: number;
};

export type FormulaOperatorDefinition = {
  id: string;
  label: string;
  category: FormulaOperatorCategory;
  state: FormulaOperatorState;
  arity: 0 | 1 | 2 | 3;
  output: "numeric" | "boolean";
  causal: boolean;
  lookback: "none" | "children" | "parameterized";
  parameters: readonly FormulaOperatorParameter[];
  unitRule: string;
  computeCost: "constant" | "incremental-window" | "linear-window";
  guard: string;
  description: string;
};

const windowParameter = (
  defaultValue: number,
  maximum = 256,
): readonly FormulaOperatorParameter[] => [{
  name: "window",
  kind: "integer",
  minimum: 2,
  maximum,
  default: defaultValue,
}];

const lagParameter: readonly FormulaOperatorParameter[] = [{
  name: "periods",
  kind: "integer",
  minimum: 1,
  maximum: 256,
  default: 1,
}];

const noParameters = [] as const;

export const FORMULA_OPERATOR_CATALOG: readonly FormulaOperatorDefinition[] = [
  {
    id: "feature",
    label: "Feature",
    category: "input",
    state: "active-search",
    arity: 0,
    output: "numeric",
    causal: true,
    lookback: "none",
    parameters: noParameters,
    unitRule: "inherits the declared feature unit",
    computeCost: "constant",
    guard: "feature must be present and finite",
    description: "A named value from the frozen causal feature frame.",
  },
  {
    id: "constant",
    label: "Constant",
    category: "input",
    state: "active-search",
    arity: 0,
    output: "numeric",
    causal: true,
    lookback: "none",
    parameters: noParameters,
    unitRule: "dimensionless unless the grammar supplies a typed unit",
    computeCost: "constant",
    guard: "finite values only",
    description: "A bounded numeric literal recorded in the candidate manifest.",
  },
  ...(["add", "sub"] as const).map((id): FormulaOperatorDefinition => ({
    id,
    label: id === "add" ? "Add" : "Subtract",
    category: "arithmetic",
    state: "active-search",
    arity: 2,
    output: "numeric",
    causal: true,
    lookback: "children",
    parameters: noParameters,
    unitRule: "children must have compatible units",
    computeCost: "constant",
    guard: "finite result and global magnitude cap",
    description: id === "add" ? "Adds two numeric child expressions." : "Subtracts the right child from the left.",
  })),
  {
    id: "mul",
    label: "Multiply",
    category: "arithmetic",
    state: "active-search",
    arity: 2,
    output: "numeric",
    causal: true,
    lookback: "children",
    parameters: noParameters,
    unitRule: "multiplies child units",
    computeCost: "constant",
    guard: "finite result and global magnitude cap",
    description: "Multiplies two numeric child expressions.",
  },
  {
    id: "protectedDiv",
    label: "Protected divide",
    category: "arithmetic",
    state: "active-search",
    arity: 2,
    output: "numeric",
    causal: true,
    lookback: "children",
    parameters: noParameters,
    unitRule: "divides left units by right units",
    computeCost: "constant",
    guard: `rejects denominators below ${FORMULAIC_FIXED_HORIZON_POC.grammar.protectedDivisionMinimumDenominator}`,
    description: "Divides only when the denominator is safely separated from zero.",
  },
  ...(["neg", "abs", "tanh"] as const).map((id): FormulaOperatorDefinition => ({
    id,
    label: id === "neg" ? "Negate" : id === "abs" ? "Absolute value" : "Hyperbolic tangent",
    category: "transform",
    state: "active-search",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "children",
    parameters: noParameters,
    unitRule: id === "tanh" ? "requires dimensionless standardized input" : "preserves child units",
    computeCost: "constant",
    guard: "finite input and global magnitude cap",
    description:
      id === "neg"
        ? "Reverses the sign of a numeric expression."
        : id === "abs"
          ? "Returns the magnitude of a numeric expression."
          : "Smoothly compresses a standardized value into the interval (−1, 1).",
  })),
  {
    id: "numericMin",
    label: "Numeric minimum (Qlib Less)",
    category: "arithmetic",
    state: "import-evaluator",
    arity: 2,
    output: "numeric",
    causal: true,
    lookback: "children",
    parameters: noParameters,
    unitRule: "children must have compatible units",
    computeCost: "constant",
    guard: "finite children only",
    description: "Element-wise numeric minimum used by the imported Albert expression.",
  },
  {
    id: "lag",
    label: "Past reference / lag",
    category: "time-series",
    state: "import-evaluator",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "parameterized",
    parameters: lagParameter,
    unitRule: "preserves child units",
    computeCost: "constant",
    guard: "positive periods only; resets at every data gap",
    description: "Returns a prior observation without permitting a future reference.",
  },
  {
    id: "rollingMax",
    label: "Rolling maximum",
    category: "time-series",
    state: "import-evaluator",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "parameterized",
    parameters: windowParameter(20),
    unitRule: "preserves child units",
    computeCost: "incremental-window",
    guard: "bounded window; resets at every data gap",
    description: "Largest causal value in the trailing window.",
  },
  {
    id: "legacyWma",
    label: "Legacy weighted mean (Qlib WMA)",
    category: "time-series",
    state: "import-evaluator",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "parameterized",
    parameters: windowParameter(20),
    unitRule: "preserves child units",
    computeCost: "linear-window",
    guard: "pinned Qlib v0.9.5 scaling; resets at every data gap",
    description: "Linearly weighted trailing mean preserved for exact legacy-expression replay.",
  },
  {
    id: "rollingCovariance",
    label: "Rolling covariance",
    category: "statistical",
    state: "import-evaluator",
    arity: 2,
    output: "numeric",
    causal: true,
    lookback: "parameterized",
    parameters: windowParameter(50),
    unitRule: "product of child units",
    computeCost: "linear-window",
    guard: "sample covariance; bounded window; resets at every data gap",
    description: "Trailing sample covariance used by the imported Albert expression.",
  },
  {
    id: "signedLog1p",
    label: "Signed log1p",
    category: "transform",
    state: "candidate",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "children",
    parameters: noParameters,
    unitRule: "requires normalized or dimensionless input",
    computeCost: "constant",
    guard: "sign(x) × log(1 + abs(x)); finite input only",
    description: "Compresses heavy-tailed values while preserving sign.",
  },
  {
    id: "clip",
    label: "Symmetric clip",
    category: "transform",
    state: "candidate",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "children",
    parameters: [{
      name: "limit",
      kind: "number",
      minimum: 0.25,
      maximum: 20,
      default: 5,
    }],
    unitRule: "preserves child units when the limit has matching units",
    computeCost: "constant",
    guard: "positive finite limit",
    description: "Winsorizes an expression to a declared symmetric magnitude.",
  },
  ...([
    ["rollingMean", "Rolling mean", "Average trailing value."],
    ["rollingStd", "Rolling standard deviation", "Sample standard deviation over the trailing window."],
    ["rollingMin", "Rolling minimum", "Smallest causal value in the trailing window."],
    ["rollingSum", "Rolling sum", "Sum of causal values in the trailing window."],
  ] as const).map(([id, label, description]): FormulaOperatorDefinition => ({
    id,
    label,
    category: id === "rollingStd" ? "statistical" : "time-series",
    state: "candidate",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "parameterized",
    parameters: windowParameter(20),
    unitRule: id === "rollingStd" ? "preserves child units" : "preserves child units",
    computeCost: id === "rollingMin" ? "incremental-window" : "linear-window",
    guard: "bounded window; minimum observations declared; resets at every data gap",
    description,
  })),
  {
    id: "ema",
    label: "Exponentially weighted mean",
    category: "time-series",
    state: "candidate",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "parameterized",
    parameters: windowParameter(20),
    unitRule: "preserves child units",
    computeCost: "incremental-window",
    guard: "frozen initialization rule; resets at every data gap",
    description: "Causal exponentially weighted trailing mean.",
  },
  {
    id: "delta",
    label: "Lagged difference",
    category: "time-series",
    state: "candidate",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "parameterized",
    parameters: lagParameter,
    unitRule: "preserves child units",
    computeCost: "constant",
    guard: "positive lag only; resets at every data gap",
    description: "Current value minus its declared past reference.",
  },
  {
    id: "logReturn",
    label: "Log return",
    category: "time-series",
    state: "candidate",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "parameterized",
    parameters: lagParameter,
    unitRule: "dimensionless",
    computeCost: "constant",
    guard: "strictly positive values and positive lag only",
    description: "Natural log of current value divided by a declared past value.",
  },
  {
    id: "rollingZScore",
    label: "Rolling z-score",
    category: "statistical",
    state: "candidate",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "parameterized",
    parameters: windowParameter(60),
    unitRule: "dimensionless",
    computeCost: "linear-window",
    guard: "protected trailing standard deviation; no current-to-future normalization",
    description: "Standardizes the current value with trailing-only moments.",
  },
  {
    id: "rollingCorrelation",
    label: "Rolling correlation",
    category: "statistical",
    state: "candidate",
    arity: 2,
    output: "numeric",
    causal: true,
    lookback: "parameterized",
    parameters: windowParameter(50),
    unitRule: "dimensionless",
    computeCost: "linear-window",
    guard: "protected variances; bounded window; resets at every data gap",
    description: "Trailing Pearson correlation between two expressions.",
  },
  {
    id: "rollingRank",
    label: "Rolling percentile rank",
    category: "statistical",
    state: "candidate",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "parameterized",
    parameters: windowParameter(60),
    unitRule: "dimensionless",
    computeCost: "linear-window",
    guard: "frozen tie policy; bounded window; resets at every data gap",
    description: "Percentile rank of the current value within its trailing window.",
  },
  {
    id: "rollingSlope",
    label: "Rolling linear slope",
    category: "statistical",
    state: "candidate",
    arity: 1,
    output: "numeric",
    causal: true,
    lookback: "parameterized",
    parameters: windowParameter(20),
    unitRule: "child units per observation",
    computeCost: "linear-window",
    guard: "fixed causal time index; bounded window; resets at every data gap",
    description: "Least-squares slope of an expression over the trailing window.",
  },
  ...([
    ["greaterThan", "Greater than"],
    ["lessThan", "Less than"],
  ] as const).map(([id, label]): FormulaOperatorDefinition => ({
    id,
    label,
    category: "relational",
    state: "candidate",
    arity: 2,
    output: "boolean",
    causal: true,
    lookback: "children",
    parameters: noParameters,
    unitRule: "children must have compatible units",
    computeCost: "constant",
    guard: "requires a future typed Boolean grammar",
    description: `${label} comparison for an explicit typed condition.`,
  })),
  {
    id: "ifElse",
    label: "If / else",
    category: "conditional",
    state: "candidate",
    arity: 3,
    output: "numeric",
    causal: true,
    lookback: "children",
    parameters: noParameters,
    unitRule: "numeric branches must have compatible units",
    computeCost: "constant",
    guard: "condition must be typed Boolean; both branches remain bounded",
    description: "Selects one of two numeric expressions from a typed causal condition.",
  },
  {
    id: "futureReference",
    label: "Future reference / lead",
    category: "time-series",
    state: "excluded",
    arity: 1,
    output: "numeric",
    causal: false,
    lookback: "parameterized",
    parameters: lagParameter,
    unitRule: "preserves child units",
    computeCost: "constant",
    guard: "always rejected",
    description: "Reads a future value and would leak the label into the formula.",
  },
  {
    id: "arbitraryCode",
    label: "Arbitrary code / eval",
    category: "conditional",
    state: "excluded",
    arity: 0,
    output: "numeric",
    causal: false,
    lookback: "none",
    parameters: noParameters,
    unitRule: "unknown",
    computeCost: "constant",
    guard: "never parsed or executed",
    description: "Unbounded user code is outside the typed Formula Lab grammar.",
  },
] as const;

const activeOperatorIds = [
  "feature",
  "constant",
  ...FORMULAIC_FIXED_HORIZON_POC.grammar.unaryOperators,
  ...FORMULAIC_FIXED_HORIZON_POC.grammar.binaryOperators,
];

export function formulaOperatorCatalogStatus() {
  const operators = FORMULA_OPERATOR_CATALOG.map((operator) => ({
    ...operator,
    parameters: [...operator.parameters],
  }));
  return {
    version: "alchemy-formula-operator-catalog-v1",
    policy:
      "Catalog entries are descriptive; only active-search operators are reachable by the current generator.",
    activeOperatorIds,
    counts: {
      total: operators.length,
      activeSearch: operators.filter((operator) => operator.state === "active-search").length,
      importEvaluator: operators.filter((operator) => operator.state === "import-evaluator").length,
      candidate: operators.filter((operator) => operator.state === "candidate").length,
      excluded: operators.filter((operator) => operator.state === "excluded").length,
    },
    operators,
    invariants: {
      candidateChangesGenerator: false,
      importEvaluatorChangesGenerator: false,
      arbitraryCodeAllowed: false,
      futureReferencesAllowed: false,
      createsStrategy: false,
      enablesExecution: false,
    },
  } as const;
}
