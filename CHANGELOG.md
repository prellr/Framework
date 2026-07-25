# Changelog

All notable Alchemy changes are recorded here. Versions follow Semantic Versioning for the
application and its research interfaces; research contracts retain their own immutable version
identifiers.

## [0.2.0] - 2026-07-25

### Added

- Dedicated Polymarket Execution & Capital view with captured fee, spread, depth-slippage,
  multi-level quote, preparation-latency, markout-readiness, stake-capacity, and overlap evidence.
- Same-market/side capital deduplication alongside the naive strategy-stacking model; opposed
  contracts remain separate.
- Cross-strategy entry-ask, macro-direction, calendar-day, and signal-freshness matrices with
  5m/15m and strategy visibility controls.
- Daily entry-ask economics chart with raw net, net-per-bet, win-rate, and decision-count lenses.
- Explicit paper-ledger, familywise-gate, and observed-gate-span age labels.

### Changed

- Removed the legacy 36% winning-profit stress metric from active Polymarket views. Captured
  fee-adjusted RAW results and the dedicated execution-cost evidence are now the displayed
  economics.

### Safety

- The execution view is a read-only projection over paper decisions and public captured books.
  It has no credentials, signing, balance, allocation, order submission, or cancellation path.
- Quote-cost evidence is deduplicated independently of strategy performance, and cross-strategy
  segment comparisons remain retrospective diagnostics that cannot affect a frozen verdict.

## [0.1.0] - 2026-07-24

### Added

- Alchemy product identity and responsive, collapsible navigation.
- Polymarket Scoreboard, Strategy Lab, strategy detail, asset detail, Findings, Crucible
  observatory, and Formula Lab product surfaces.
- Independent 5m/15m strategy and asset diagnostics with sortable tables, daily history, time,
  weekday, macro, regime, price, side, and freshness segmentation.
- Paper-only Polymarket research collection, causal feature tapes, forward boundaries, familywise
  validation contracts, and audited knowledge-base records.
- Venue-neutral Formula Lab mechanics: bounded expression trees, deterministic 10,000-variant
  manifests, sharded evaluation, untouched validation selection, fixed-horizon targets, and
  explicit capital/risk simulation.
- Read-only research worker protocol and separate data, compute, and visualization layers.
- Versioned Formula Lab research and validation framework with academic, official-interface, and
  practitioner-engineering sources.

### Safety

- Strategy discovery cannot register a strategy, create a paper bot, start Crucible, or enable
  execution.
- Live trading remains locked behind the existing verdict gate; this baseline adds no signing,
  wallet, order-submission, or fund-moving path.
- Retrospective and synthetic Formula Lab results remain descriptive and cannot be promoted as
  forward evidence.
