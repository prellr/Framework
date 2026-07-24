# Alchemy Polymarket research completion audit

Last reviewed: 2026-07-24, before the frozen familywise boundary opens.

## Scope and non-negotiable boundary

Alchemy is evaluating paper-only strategies for Polymarket crypto Up/Down markets. The
authoritative objective is measured forward edge against fee-adjusted executable asks, not a
retrospective winner search. No item below authorizes order signing, submission, cancellation,
wallet access, strategy arming, or live execution.

The only time-gated item in this audit is the first post-boundary receipt audit for the frozen
57-member strategy × timeframe family and the 12-bucket shadow connector telemetry contract.
Until that receipt exists, every result remains research or paper evidence.

## Product and research requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Preserve stats and fail visibly instead of substituting blanks or zeroes | Complete | `PolymarketScoreboard`, `PolymarketPerformanceLens`, `CruciblePage`, and `FormulaLabPage` all render explicit unavailable states. `paper-floor-view.ts` preserves scoped responses without using a hidden-tab fallback. |
| Minimize the forward verdict gate | Complete | `PolymarketPaperFloor.tsx` persists `floor.gateCollapsed`, exposes an accessible Expand/Minimize control, and keeps a compact state summary while collapsed. |
| Distinguish genuinely different strategies from correlated copies | Complete | Cards expose overlap diagnostics, `strategy-independence-model.ts` declares known relations, and the frozen gate evaluates a single full family instead of counting correlated bots as independent discoveries. |
| Rework Scoreboard and Strategy Lab for the expanded strategy/data set | Complete | `PolymarketScoreboard.tsx` provides family/gate summaries and the performance lens. `PolymarketStrategyLab.tsx` exposes preregistered hypotheses, tape readiness, frozen artifacts, shadow-connector telemetry, and outcome-blind data contracts. |
| Show every asset × timeframe bucket, including zero or losing cells | Complete | `paperBotBucketUniverse` supplies registered zero-activity buckets; Paper Floor cards render the complete bucket list. Strategy Lab explicitly preserves all 12 connector buckets and funnel asset cells. |
| Equity time scrubber and per-strategy show/hide | Complete | `PolymarketPaperFloor.tsx` provides `equity-time-scrubber`, per-series toggles, all/none controls, and persisted hidden-series state. |
| Collapsible icon-only left navigation with click and Cmd/Ctrl-B | Complete | `AppShell.tsx` owns the persisted collapse state and keyboard handler; `Sidebar.tsx` renders accessible icon-only navigation and click-to-toggle branding. |
| Live causal macro direction, including UP, DOWN, RANGE, and matching side controls | Complete | `macro-breadth-router.ts` classifies only synchronized completed BTC/ETH/SOL bars and fails closed when missing, future, stale, or desynchronized. `macro-direction-controls.ts` adds matching-only Always UP/Always DOWN controls; neutral, range for those controls, and unavailable inputs abstain. |
| Server-load-aware tick/flow collection | Complete | `polymarket-trade-flow-tape.ts` separates transport heartbeat from market-data liveness, applies bounded reconnect/backoff, batches receipt verification, and yields verification under broad host pressure. It is outcome blind and structurally cannot trade. |
| Separate 5m and 15m strategies/verdicts | Complete | `PolymarketPerformanceLens.tsx` defaults to separate strategy × timeframe rows, supports 5m, 15m, and diagnostic pooled views, and maps each split row to its independent frozen familywise hypothesis. |
| Multi-day, time-period, time-of-day, day-of-week, and other segmentation | Complete | The performance lens supports 24h/3d/7d/30d/all and calendar day, session/hour, weekday, macro, technical regime, asset, chosen side, entry ask, and signal-freshness tables. Thin or single-day slices are muted rather than deleted. |
| Hide a strategy card directly from the card | Complete | Paper Floor card controls persist `floor.hiddenBots`; the filter bar can restore hidden cards. |
| Review stale timers and distinguish dead from abstaining | Complete | RTDS reconnects an open socket after 30s without data. The Polymarket flow tape uses distinct 45s transport and 90s market-data watchdogs plus current-book initialization and stable-connection grace timers. Paper cards use a dedicated Redis runtime heartbeat from the general one-minute worker lane and show the strategy’s last-decision age separately, so a healthy abstention is not mistaken for a dead worker. Macro completed bars fail closed beyond 120s. |
| Daily RAW ledger and longer-horizon trend view | Complete | `paper-daily-ledger.ts` defines America/Chicago day boundaries. `PolymarketDailyRawLedger.tsx` supplies daily cells, cumulative chart, range selectors, sample counts, and sortable range totals. |
| Per-strategy pages and links from cards/tables | Complete | `/polymarket/strategy/$botKey` renders scope-to-date buckets, segmentation, and recent trades. Scoreboard, Paper Floor, Strategy Lab, performance rows, and asset pages link into it. |
| Per-asset pages and links from all Polymarket asset labels | Complete | `/polymarket/asset/$asset` supplies outcome tape, strategy comparison, timeframe/period controls, and recent activity. `PolymarketAssetLink` is reused across paper cards, tapes, segmentation, strategy pages, and connector telemetry. |
| Column-sortable data grids | Complete | Shared `PolymarketSortableHeader` and stable sort helpers cover Scoreboard, performance/segmentation, daily ledger, Paper Floor buckets/feed/combinations, strategy detail, Findings, Strategy Lab telemetry, and Crucible. Asset detail uses the same accessible sort semantics locally. |
| Replace misleading “worst-case” labeling | Complete | `paper-accounting.ts` declares the copied 36% winner haircut uncalibrated and forbidden as a verdict input. UI labels it `Profit stress −36%`; RAW and same-tick control residual remain the authoritative accounting/comparison measures. |
| Read-only, low-latency Polymarket connector groundwork | Complete for shadow research; live execution intentionally absent | `polymarket-shadow-connector.ts` and its audit build execution-plan telemetry from public books without auth, signing, submission, cancellation, or fill claims. The post-boundary 12-bucket receipt is still pending. |
| In-app Findings register | Complete | `PolymarketFindings.tsx` is the fourth Polymarket tab and includes the V1 retraction, current forward conclusions, methodology, and sortable evidence tables. |
| Read-only Crucible results and result collections | Complete | `/crucible` groups mirrored catalog/warehouse results into sortable collections. Its router contains only a protected query; tests prohibit Jester calls, Crucible/Target tools, and mutation procedures. |
| Formula Lab beyond Polymarket | Complete for the research mechanics | The Alchemy Formula Lab has venue-neutral source and target adapters, deterministic 10,000-candidate manifests, content-addressed datasets, sharded pull workers, fixed-horizon labels, capital/risk simulation, and a separated protocol/compute/UI architecture. |
| Visualize algebraic formulas | Complete | `FormulaExpressionTree.tsx` renders the selected candidate as an interactive AST from causal features through frozen transform, threshold, and fixed-horizon paper target. Formula status exposes the expression and depth used by that inspector. |
| Prospective formula validation without leakage or family cherry-picking | Complete | Validation freezes discovery feature/output calibration, rejects pre-boundary or future-label rows, preserves zero-trade candidates, and performs Holm correction over the entire declared family. Both TypeScript and Python workers enforce the same v2 protocol. |
| Rebrand Jester Analytics to Alchemy | Complete at the product surface | Authentication, sidebar, Formula Lab, and setup runbook use Alchemy. Stable internal package, compatibility, infrastructure, and upstream-Jester identifiers remain unchanged deliberately. |

## Verification already completed

- API tests: 410 passing, including dedicated paper-worker runtime-heartbeat coverage.
- Python research worker: 6 passing; lint and format checks passing.
- Cross-language worker result accepted by the TypeScript gateway under protocol v2.
- Protocol, database, API, and web typechecks passing.
- Web production build passing.
- Drizzle schema, snapshot, and pending migration agree.
- Formula validation tests reject tampering, pre-boundary leakage, future-label leakage, and
  validation recentering.
- Source scans confirm the research worker and shadow connector contain no order execution path.
- Server2 read-only health check showed healthy API, Postgres, Redis, nginx, and worker services with
  fresh venue and trade-flow tapes before the boundary.

### Pre-boundary Server2 baseline

Across `2026-07-24T23:17:52Z`–`23:19:01Z`, API health was OK and host load was bounded at
`1.28 / 1.53 / 1.56`. Five venue feeds were 4.6 seconds fresh and BNB was 24.6 seconds fresh; all
12 state-tape asset × timeframe buckets were 3.4–63.7 seconds fresh; the public trade-flow receipt
tape was 1.3 seconds fresh. No Paper Floor or RTDS failure appeared in the subsequent 20-minute
worker error filter. The control-decision clock advanced to the `23:25:00Z` market window as
expected, confirming that decision age follows eligible market windows rather than the one-minute
worker cadence. The new independent runtime heartbeat removes that ambiguity after deployment.

## Remaining gated evidence

1. After `2026-07-25T00:16:00Z`, record the familywise launch receipt and verify the exact 57-member
   roster, explicit exceptions, control opportunity floors, unique identities, and zero
   pre-boundary rows.
2. Record the shadow connector launch receipt and verify all 12 asset × timeframe buckets and its
   two telemetry records without enabling auth, signing, or submission.
3. Recheck Server2 service health, load, collector freshness, and the rendered Alchemy pages.
4. Deploy only after those audits pass. A successful deployment still leaves every Polymarket
   strategy paper-only and subject to its frozen prospective verdict gate.
