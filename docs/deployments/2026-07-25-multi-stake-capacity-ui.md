# Polymarket multi-stake modeling UI

Prepared for Server2 on 2026-07-25.

## User-facing model

Polymarket orders are not limited to a fixed `$5` stake. Strategy detail pages now
offer three descriptive views:

- `$5 captured` uses the recorded fee-adjusted book-walk VWAP for each paper
  decision.
- `$10 linear` scales the captured `$5` dollar result by 2×.
- `$20 linear` scales the captured `$5` dollar result by 4×.

The `$10` and `$20` views do not claim that deeper liquidity was available at the
same price. They leave decisions, fill asks, win rate, paper stake, verdict gates,
and execution unchanged.

## Capacity disclosure

Strategy detail pages show the current status of
`polymarket-multi-stake-capacity-v1` beside the stake selector. The Strategy Lab
audit registry also contains a `$5 / $10 / $20 same-book capacity` row with:

- prospective market count and seven-day span;
- weakest asset × timeframe bucket count;
- paired `$10` and `$20` coverage;
- the frozen readiness requirements; and
- an explicit statement that linear modeling remains authoritative until a
  separate frozen capacity-distribution review is complete.

The capacity collector reuses the two public UP/DOWN books already fetched for
each `$5` paper decision. The UI release adds no request, socket, poller, strategy,
paper trade, gate input, signing, order, wallet, or execution path.

## Verification

- Web TypeScript check passed.
- API TypeScript check passed.
- Nine focused multi-stake capacity tests passed.
- Web production build passed.
- The existing large Vite chunk warning remains informational and unrelated.

