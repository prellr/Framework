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

