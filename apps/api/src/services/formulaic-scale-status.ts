import {
  FORMULAIC_CAPITAL_BACKTEST,
  type FormulaCapitalSizing,
} from "./formulaic-capital-backtest.ts";
import {
  FORMULAIC_SCALE_ENGINE,
  generateFormulaVariantManifest,
  inspectFormulaVariant,
  planFormulaExperiment,
  type FormulaTargetUnit,
} from "./formulaic-scale-engine.ts";

const CAPACITY_SEED = "formula-scale-capacity-v1";
const targets: FormulaTargetUnit[] = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "DOGE",
  "BNB",
].map((asset) => ({
  key: `${asset}-USD:hyperliquid-10m`,
  adapter: "hyperliquid-fixed-horizon-paper",
  pair: `${asset}-USD`,
  holdSeconds: 600,
  roundTripCostBps: 10,
}));
const manifest = generateFormulaVariantManifest({
  seed: CAPACITY_SEED,
  variantCount: FORMULAIC_SCALE_ENGINE.defaultVariantCount,
});
const plan = planFormulaExperiment({
  manifest,
  targets,
  createdAtMs: 0,
  dataEndExclusiveMs: 0,
});

const sizingModes: Array<{
  mode: FormulaCapitalSizing["mode"];
  label: string;
  definition: string;
}> = [
  {
    mode: "fixed-notional",
    label: "Fixed notional",
    definition: "The same dollar exposure is requested for every entry.",
  },
  {
    mode: "equity-fraction-notional",
    label: "Equity % notional",
    definition: "Requested exposure is a fixed fraction of current or starting equity.",
  },
  {
    mode: "fixed-risk",
    label: "Fixed dollar risk",
    definition: "Notional is solved so the target adapter's maximum planned loss equals a fixed dollar budget.",
  },
  {
    mode: "equity-fraction-risk",
    label: "Equity % risk",
    definition: "Notional is solved so maximum planned loss equals a fixed fraction of current or starting equity.",
  },
];

export function formulaicScaleStatus() {
  return {
    version: FORMULAIC_SCALE_ENGINE.version,
    generatorVersion: FORMULAIC_SCALE_ENGINE.generatorVersion,
    state: "mechanics-verified",
    manifest: {
      seed: manifest.seed,
      variants: manifest.variantCount,
      hash: manifest.candidateManifestHash,
      thresholdsZ: manifest.thresholdsZ,
      sample: manifest.candidates.slice(0, 8).map(inspectFormulaVariant),
    },
    plan: {
      targetCount: plan.targetCount,
      evaluationUnits: plan.evaluationUnitCount,
      shardSize: plan.shardSize,
      shardCount: plan.shardCount,
      shardsPerTarget: plan.shardCount / plan.targetCount,
      targets: plan.targets,
      discoveryTrials: plan.family.discoveryTrials,
      expectedFalsePositivesAtNominalFivePercent:
        plan.family.expectedFalsePositivesAtNominalFivePercent,
      discoveryIsEvidence: plan.family.discoveryIsEvidence,
      validationRequiresNewBoundary:
        plan.family.validationRequiresNewBoundary,
    },
    capital: {
      version: FORMULAIC_CAPITAL_BACKTEST.version,
      startingCapitalConfigurable: true,
      compoundSizingConfigurable: true,
      sizingModes,
      requiredTargetEconomics: [
        "net return on notional after target-specific costs",
        "maximum planned loss per dollar of notional",
        "cash or margin reserved per dollar of notional",
      ],
      constraints: [
        "minimum and maximum notional",
        "maximum gross exposure as a fraction of equity",
        "maximum concurrent positions",
        "liquidation equity floor",
        "preregistered simultaneous-entry priority",
      ],
      outputs: [
        "final equity and total return",
        "realized equity curve and maximum drawdown",
        "gross exposure and capital reserved",
        "win rate, profit factor, and P&L distribution",
        "planned risk, realized risk breaches, skips, and liquidation",
      ],
      defaultPaperTemplate: {
        initialCapitalUsd: 10_000,
        sizing: { mode: "fixed-risk", riskUsd: 100 },
        compoundSizing: true,
        minimumNotionalUsd: 5,
        maximumNotionalUsd: 10_000,
        maximumGrossExposureFraction: 1,
        maximumConcurrentPositions: 6,
        liquidationEquityUsd: 0,
      },
    },
    benchmark: {
      command: "pnpm benchmark:formulaic-scale",
      workload:
        "10,000 variants × 1,440 synthetic points, evaluated in 40 local shards for one target",
      productionCollectorUsed: false,
    },
    persistence: {
      state: "durable-control-plane-built",
      detail:
        "The deterministic engine now has durable dataset, experiment, shard, artifact, and result ledgers plus an independently authenticated pull-lease worker protocol. Dataset artifact production and separately deployed CPU/GPU workers remain intentionally inactive.",
    },
    invariants: {
      ...FORMULAIC_SCALE_ENGINE.invariants,
      ...FORMULAIC_CAPITAL_BACKTEST.invariants,
      discoveryCanAuthorizeStrategy: false,
      validationRequiresNewForwardBoundary: true,
      executionAllowed: false,
    },
  };
}
