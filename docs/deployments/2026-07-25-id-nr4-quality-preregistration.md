# ID/NR4 age correction and prospective quality audit

Date: 2026-07-25
Prospective boundary: 2026-07-25T22:00:00.000Z

## Correction

ID/NR4 is not less than one day old. Its current-paper ledger contains observations on three
Chicago calendar dates (July 23, July 24, and July 25), with two completed days. The younger clock
belongs to the newer 57-member familywise verdict cohort, which began on July 25 at 00:00 UTC.

The strategy-detail page now reports these clocks separately:

- **Observed ledger dates** counts every date represented in the selected strategy, timeframe, and
  asset population without applying the diagnostic-period cutoff.
- The subtitle reports active days inside the selected period and the independent familywise gate
  span/state.

No ledger row, historical scope, strategy boundary, or verdict state is reset.

## Prospective quality tape

The visible three-date ID/NR4 results are treated as contaminated discovery evidence. They are not
used to define a winner, loser, feature threshold, or child strategy. Beginning at the future
boundary, the existing ID/NR4 paper row records six causal, direction-invariant coordinates:

1. setup range in basis points;
2. setup-range compression versus the prior three completed bars;
3. inside-bar range ratio versus its parent;
4. absolute setup-close location away from the range midpoint;
5. breakout extension beyond the setup boundary, scaled by setup range;
6. setup volume relative to the median of the prior three completed bars.

These fields do not change ID/NR4 v1 eligibility, probability, direction, ask comparison, paper
insertion, or verdict logic.

## Frozen disclosure gate

Feature values remain locked until all of the following pass:

- 300 future tagged rows;
- 40 distinct markets in each of BNB, BTC, DOGE, ETH, SOL, and XRP;
- five elapsed days.

At readiness, only p10, p25, p50, p75, and p90 feature distributions may be shown. The service
cannot select outcome, side, resolution, grade, quote, fill, return, P&L, control, account, wallet,
position, or order fields. The readiness/status result is cached for 15 minutes.

A distribution report does not create a strategy. Any later quality cut requires a separately
hashed immutable artifact and a new prospective paper boundary.

## Server-load and execution impact

- no new market request, websocket, subscription, or timer;
- no new database table or write path;
- one small version-filtered readiness query at most every 15 minutes after the boundary;
- a second values-only aggregation is unreachable until all support floors pass;
- no credential, signing, order, cancellation, balance, allocation, or fund-moving capability.
