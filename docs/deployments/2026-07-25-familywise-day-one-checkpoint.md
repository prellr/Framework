# Familywise day-one checkpoint

Date: 2026-07-25
Gate boundary: 2026-07-25T00:00:00.000Z
Recorded at: 2026-07-25T18:45:24.663Z

## Result

The frozen 57-member familywise paper gate is still less than one day old. No hypothesis can satisfy
the five-day, 1,500-market, 200-paired-bet, 100-cluster, two-positive-session, effect, confidence,
and Holm-adjusted significance contract.

The live checkpoint distinguishes four observations:

- **ID/NR4 5m** is the strongest early same-tick-control lead and has no strong observed dependence
  on another registered rule. It remains far below the registered verdict floors.
- **Bootstrap MC 5m** has cleared the paired-bet and cluster counts, but remains immature on
  market count, elapsed time, positive-session consistency, and its confidence bound. It continues
  unchanged as the existing frozen cohort; no diagnostic child is admitted.
- **Sweep Reclaim 15m** has a nominally positive early residual, but its decisions are strongly
  dependent on the existing fade/gauge family. It is not admitted as a new mechanism or child.
- **Always Up 5m** has broad support but is still a direction benchmark with inconsistent qualifying
  sessions, not a strategy verdict.

## Decision

No new strategy is registered from outcome-visible evidence. The existing familywise gate continues
unchanged. The next admissible ID/NR4 research input is its separately preregistered, future-only,
outcome-blind quality distribution tape beginning at 2026-07-25T22:00:00.000Z.

The checkpoint writes one Knowledge Base decision and one audit receipt. It adds no collector,
network request, timer, database table, paper bot, verdict mutation, credential, order, signing,
position, allocation, cancellation, or fund-moving path.

## Recorded evidence

- **ID/NR4 5m:** 49 paired bets, 39 clusters, +39.38¢ residual mean, nominal 95% interval
  [+19.18¢, +57.88¢], and no qualifying session.
- **Bootstrap MC 5m:** 326 paired bets, 177 clusters, +3.16¢ residual mean, nominal 95% interval
  [−4.92¢, +11.25¢], 1/2 positive qualifying sessions, 1,356/1,500 markets, and 0.781/5 days.
- **Sweep Reclaim 15m:** 47 paired bets, 36 clusters, +21.57¢ residual mean, nominal 95% interval
  [+0.85¢, +40.58¢], and no qualifying session.
- Sweep Reclaim 15m's strongest non-lineage relation was 83.5% dependence on Gauge Fade 15m,
  with the same side on 76 of 81 shared markets. ID/NR4 5m's strongest non-lineage dependence
  remained only 25.7%.
- All 57 hypotheses remained `collecting`; no unexpected exact strategy collision was present.

## Deployment and verification

- Deployed source commit: `c560409` (`chore: record familywise day-one checkpoint`)
- Server: Server2 (`/Users/admin/jester-analytics`)
- Recovery point: `/Users/admin/jester-releases/20260725T184327Z`
- Recovery source:
  `sha256:35ab84c77e51c85034fa2d306bfdfb27b48171acc34f8f32f8aaff295e3bf5d2`
- Recovery database:
  `sha256:eca0bb3103345295cf288a28970fd25c31541d72177e161033655832475974a4`
- API image:
  `sha256:bb19632a64f9faaf7abf8db8ac9a1ab78ca7e429a134c40904bc2b3bfb0bf443`
- Thirteen focused checkpoint and independence tests passed; API TypeScript validation passed.
- The first recorder run inserted one Knowledge article and one audit receipt. A second run returned
  `updated: false` and `auditInserted: false`; production contains exactly one matching article and
  one matching audit row.
- Public health returned `{"status":"ok"}`. Postgres and Redis remained healthy. The strategy
  worker retained its existing image and was not rebuilt or restarted.
- Post-deploy Server2 load was 1.70 on 10 CPU cores. The one-off recorder exited, opened no durable
  collector, and added no recurring server work.
