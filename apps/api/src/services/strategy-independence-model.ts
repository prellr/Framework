export type StrategyDecision = {
  botKey: string;
  conditionId: string;
  side: string;
};

export type StrategyIdentity = {
  key: string;
  name: string;
  color: string;
};

export type StrategyStructuralRelation =
  | "expected-mirror"
  | "expected-filter"
  | "expected-router";

export type StrategyIndependencePair = {
  leftKey: string;
  rightKey: string;
  leftDecisions: number;
  rightDecisions: number;
  sharedMarkets: number;
  sameSideMarkets: number;
  agreement: number | null;
  leftCoverage: number;
  rightCoverage: number;
  subsetOverlap: number;
  dependencyStrength: number | null;
  relation: "same" | "inverse" | "mixed" | "no-overlap";
  structuralRelation: StrategyStructuralRelation | null;
  unexpectedExactCollision: boolean;
};

const validSide = (side: string): side is "up" | "down" => side === "up" || side === "down";

/**
 * Frozen implementation lineage, derived from the registered rule graph rather than observed
 * overlap. These labels are descriptive only: they do not change a strategy, hypothesis family,
 * verdict, or evidence threshold.
 */
export const EXPECTED_STRATEGY_RELATIONS = [
  { left: "alwaysUp", right: "drift", relation: "expected-mirror" },
  { left: "fade", right: "follow", relation: "expected-mirror" },
  { left: "gaugeFade", right: "gaugeFollow", relation: "expected-mirror" },
  { left: "fadeV1", right: "followV1", relation: "expected-mirror" },

  { left: "fade", right: "fadeStrong", relation: "expected-filter" },
  { left: "fade", right: "fadeRegime", relation: "expected-filter" },
  { left: "fade", right: "fadeTessCmoChop", relation: "expected-filter" },
  { left: "rocPivot", right: "rocPivotCmoTrend", relation: "expected-filter" },
  { left: "pricerMC", right: "pricerMC5mTrend", relation: "expected-filter" },
  { left: "pricerMC", right: "pricerMC5mCobraNight", relation: "expected-filter" },
  { left: "pricerBSM", right: "pricerBSMPeakRetention", relation: "expected-filter" },
  { left: "pricerBSM", right: "pricerBSMOffHours15", relation: "expected-filter" },
  { left: "smoothPathDisplacement", right: "smoothPathCausalDisplacement", relation: "expected-filter" },
  { left: "alwaysUp", right: "macroUpOnly", relation: "expected-filter" },
  { left: "drift", right: "macroDownOnly", relation: "expected-filter" },

  { left: "macroTrendSleeve", right: "macroRegimeRouter", relation: "expected-router" },
  { left: "macroRangeFade", right: "macroRegimeRouter", relation: "expected-router" },
] as const satisfies readonly {
  left: string;
  right: string;
  relation: StrategyStructuralRelation;
}[];

const canonicalPair = (left: string, right: string) =>
  left.localeCompare(right) <= 0 ? `${left}|${right}` : `${right}|${left}`;

const expectedRelationBySourcePair = new Map(
  EXPECTED_STRATEGY_RELATIONS.map((row) => [
    canonicalPair(row.left, row.right),
    row.relation,
  ]),
);

const splitStrategyKey = (key: string) => {
  const match = key.match(/^(.*):(5|15)$/);
  return match
    ? { sourceKey: match[1]!, horizonMin: Number(match[2]) as 5 | 15 }
    : { sourceKey: key, horizonMin: null };
};

export function expectedStrategyStructuralRelation(
  leftKey: string,
  rightKey: string,
): StrategyStructuralRelation | null {
  const left = splitStrategyKey(leftKey);
  const right = splitStrategyKey(rightKey);
  if (left.horizonMin !== right.horizonMin) return null;
  return expectedRelationBySourcePair.get(
    canonicalPair(left.sourceKey, right.sourceKey),
  ) ?? null;
}

export function computeStrategyIndependence(
  decisions: StrategyDecision[],
  identities: StrategyIdentity[],
) {
  const identityKeys = new Set(identities.map((identity) => identity.key));
  const byBot = new Map<string, Map<string, "up" | "down">>();

  for (const decision of decisions) {
    if (!identityKeys.has(decision.botKey) || !decision.conditionId || !validSide(decision.side)) continue;
    const markets = byBot.get(decision.botKey) ?? new Map<string, "up" | "down">();
    markets.set(decision.conditionId, decision.side);
    byBot.set(decision.botKey, markets);
  }

  const bots = identities.map((identity) => ({
    ...identity,
    decisions: byBot.get(identity.key)?.size ?? 0,
  }));
  const pairs: StrategyIndependencePair[] = [];

  for (let leftIndex = 0; leftIndex < identities.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < identities.length; rightIndex++) {
      const leftKey = identities[leftIndex]!.key;
      const rightKey = identities[rightIndex]!.key;
      const left = byBot.get(leftKey) ?? new Map<string, "up" | "down">();
      const right = byBot.get(rightKey) ?? new Map<string, "up" | "down">();
      let sharedMarkets = 0;
      let sameSideMarkets = 0;

      for (const [conditionId, side] of left) {
        const otherSide = right.get(conditionId);
        if (!otherSide) continue;
        sharedMarkets++;
        if (side === otherSide) sameSideMarkets++;
      }

      const agreement = sharedMarkets ? sameSideMarkets / sharedMarkets : null;
      const leftCoverage = left.size ? sharedMarkets / left.size : 0;
      const rightCoverage = right.size ? sharedMarkets / right.size : 0;
      const smallerDecisionSet = Math.min(left.size, right.size);
      const subsetOverlap = smallerDecisionSet ? sharedMarkets / smallerDecisionSet : 0;
      const directionalDependence = agreement == null ? null : Math.abs(2 * agreement - 1);
      const dependencyStrength = directionalDependence == null
        ? null
        : subsetOverlap * directionalDependence;
      const relation = agreement == null
        ? "no-overlap"
        : agreement >= 0.8
          ? "same"
          : agreement <= 0.2
            ? "inverse"
            : "mixed";
      const structuralRelation = expectedStrategyStructuralRelation(leftKey, rightKey);
      // The existing display contract already requires three shared markets. Full coverage on both
      // sides plus exact directional identity/inversion is an operational collision, not alpha.
      const unexpectedExactCollision =
        sharedMarkets >= 3
        && leftCoverage === 1
        && rightCoverage === 1
        && (agreement === 0 || agreement === 1)
        && structuralRelation == null;

      pairs.push({
        leftKey,
        rightKey,
        leftDecisions: left.size,
        rightDecisions: right.size,
        sharedMarkets,
        sameSideMarkets,
        agreement,
        leftCoverage,
        rightCoverage,
        subsetOverlap,
        dependencyStrength,
        relation,
        structuralRelation,
        unexpectedExactCollision,
      });
    }
  }

  pairs.sort((left, right) =>
    (right.dependencyStrength ?? -1) - (left.dependencyStrength ?? -1)
    || right.sharedMarkets - left.sharedMarkets
    || left.leftKey.localeCompare(right.leftKey)
    || left.rightKey.localeCompare(right.rightKey));

  return {
    decisions: [...byBot.values()].reduce((sum, markets) => sum + markets.size, 0),
    bots,
    pairs,
    expectedStructuralPairs: pairs.filter((pair) => pair.structuralRelation != null).length,
    unexpectedExactCollisions: pairs.filter((pair) => pair.unexpectedExactCollision).length,
  };
}
