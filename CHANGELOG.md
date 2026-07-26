# Changelog

All notable Alchemy changes are recorded here. Versions follow Semantic Versioning for the
application and its research interfaces; research contracts retain their own immutable version
identifiers.

## [0.4.0] - 2026-07-25

### Added

- Per-user Polymarket account registry with support for multiple independently labeled wallets,
  one explicit default account, and per-account risk budgets.
- Encrypted-at-rest signer and Relayer credentials with masked, secret-free browser projections.
- Dedicated **Settings → Polymarket accounts** workflow for personal accounts and
  **Admin → Settings → Polymarket system connector** for Builder credentials, shared
  infrastructure, platform ceilings, and the global kill switch.

### Changed

- Split Polymarket configuration into a platform-owned Builder plane and a user-owned wallet plane.
- Modeled Deposit, legacy proxy, Safe, and direct EOA wallets while reserving Builder-managed
  account provisioning for a later authenticated connector milestone.
- Execution & Capital now reports both system-connector readiness and the current user's saved
  default account without exposing credentials.

### Safety

- Personal account routes require an authenticated human session, scope every read and mutation to
  the current user, and omit secrets from responses and audit records.
- Account limits fail closed until all administrator ceilings are configured and may never exceed
  those ceilings.
- Production Docker contexts exclude environment files, database backups, local dependency trees,
  and temporary deployment artifacts so secrets cannot be copied into application images.
- Production API and worker processes consume Compose-injected environment variables and treat a
  local `.env` file as optional rather than requiring a secret-bearing file inside the image.
- No account verification, authentication, order submission, cancellation, or live execution route
  was added.

## [0.3.0] - 2026-07-25

### Added

- Exact, integrity-checked chronological trade ledgers for all supported historical Albert chart
  and forced-exit experiments.
- Configurable Formula Lab capital simulator with starting equity, four sizing modes, compounding,
  leverage, planned-loss sizing, and explicit risk-budget breach reporting.
- Interactive realized-equity chart and paginated entry/exit ledger with timestamps, prices,
  notional, gross return, execution costs, funding, net return, P&L, and post-trade equity.
- Hyperliquid-aware cost assumptions: editable taker fee per fill, slippage per side, and funding
  per day, with official venue documentation linked in-product.

### Changed

- Renamed historical `Final equity` to `Frozen end equity` and disclosed its $10,000 starting
  balance, fixed $1,000 notional, non-compounding, one-position, holdout-only contract.
- Historical result rows can open their exact scored period, source-tape period, trade path, and
  capital simulation without modifying the frozen receipt.

### Safety

- Historical OHLCV opens remain research marks, not executable fills. Funding defaults to zero
  because the imported OHLCV contains no historical funding ledger.
- Risk-based sizing derives notional from a planned loss but simulates no stop; realized
  risk-budget breaches are surfaced rather than hidden.
- The simulator is query-only and cannot select a winner, register a strategy, create a paper bot,
  access an account, sign an order, or enable execution.

## [0.2.1] - 2026-07-25

### Added

- Frozen, outcome-blind 30-second execution markout disclosure with preregistered count, market,
  and observation-span floors.
- Execution & Capital liquidation audit showing contract markout, immediate $5 liquidation
  return, mid-price movement, capture delay, and nonnegative-rate distributions by timeframe,
  entry ask, and asset.

### Changed

- Markout observations are deduplicated to the earliest captured market-side quote so shared
  strategy decisions cannot inflate the execution sample.
- Clarified that 30-second markout is an adverse-selection and immediate-liquidation diagnostic;
  it is not settlement P&L, an added execution charge, or a familywise-verdict input.

### Safety

- No signed markout result or segmented value is returned until all frozen readiness floors pass.
- The disclosure query excludes strategy identity, signals, grades, outcomes, P&L, controls,
  accounts, wallets, and orders.

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
