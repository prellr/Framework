# Paper bot source and funnel activity

## Diagnosis

Four active-looking 5-minute paper cards had empty decision ledgers for two different reasons:

- `Fade Jester V1` and `Follow Jester V1` had no local `jester_v1` signal rows because every stored
  Jester credential was valid but its upstream signal subscription was disabled. The logger was
  healthy and correctly abstained instead of inventing a signal.
- `Smooth path / strike displacement` and `Smooth path — causal ticks` were evaluating the
  prospective six-asset tape. They produced path-qualified candidates, but none also passed the
  frozen book-edge/chase gate, so no paper decision row was placed.

The former scoreboard exposed only the selected paper ledger. Consequently, “upstream produced no
signal” and “the strategy evaluated data and rejected every candidate” both appeared as zero trades,
zero grades, and “none in scope.”

## Correction

- The Jester V1 logger persists a bounded operational receipt after each run. It records only
  subscription status, notification/history health, capture counts, and receipt time.
- The paper-floor response reads that receipt and the count/time of locally captured Jester V1
  signals.
- The response also reports the existing outcome-blind Smooth Path funnel totals: eligible,
  observed, path-qualified, book-qualified, and placed.
- Jester cards can now say `upstream unsubscribed`, `subscribed · awaiting entry`,
  `source check error`, or `source check stale`.
- Smooth Path cards can now show progress such as
  `3,270 observed · 20 path · 0 book`.
- The generic decision row now says `none in selected scope`, separating the selected ledger from
  source and funnel health.

No side, signal value, price, market result, grade, return, rank, P&L, credential, account, wallet,
order, signer, or execution control was added to these diagnostics. Strategy rules, paper decisions,
and every verdict boundary remain unchanged.

## Verification

- API and web TypeScript validation passed.
- All 538 API service tests passed.
- The production web bundle built successfully.
- The new focused tests cover confirmed unsubscribe, stale source receipts, missing observations,
  stale funnel capture, and observed/path/book stage counts.

## Server2 deployment

- Source commit: `1ca0fc9` (`Expose paper bot source activity`).
- Recovery point: `/Users/admin/jester-releases/20260725T205526Z`.
- Recovery archive SHA-256:
  `82e51ac26b898e223e04bf9eb963d7e354237d0c015170e53d577f03f2ee7988`.
- Recovery database SHA-256:
  `8df3b731fb46a793fa1d2e22d53d29b4ae2c75a3d71d452d07637e398f98c61f`.
- Rolled images:
  - API: `sha256:34166c6d8df8fab88316f5761c29ea374e08aa1929595c9022b40462b96c23db`
  - Worker: `sha256:cafb09cc72dac8fce06a296b885b10d0af82cde167ca08f0367b5a243bbb25a0`
  - Web/nginx: `sha256:0e56c67ca9449776e478fde9c98dec017fa0c75c19bc799ad96a00fc619528ba`
- Post-roll health returned `status=ok`; API, worker, Postgres, and nginx were healthy.
- The authenticated production Paper Floor rendered the new activity rows:
  - Smooth Path v1: `3,319 observed · 6 path · 0 book`
  - Smooth Path causal v2: `3,318 observed · 21 path · 0 book`
  - Jester V1: `upstream unsubscribed` with zero locally captured sided entries
- The worker resumed all six-symbol RTDS, Hyperliquid BBO/public-trade, Polymarket trade-flow, and
  CLOB event-OFI streams. No schema, signal rule, paper-decision, verdict-gate, or execution-path
  change was made.
