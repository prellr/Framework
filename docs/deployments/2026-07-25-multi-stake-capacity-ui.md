# Polymarket multi-stake modeling UI

Deployed to Server2 on 2026-07-25.

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

The Execution & Capital cross-strategy diagnostic map uses the same selector and
contract. Its funds value is applied independently to every strategy intent:

- `$5` shows each strategy's captured, fee-adjusted book-walk result;
- `$10` and `$20` linearly scale dollar net and net per bet by 2× and 4×;
- decision counts and win rates never scale; and
- modeled values do not replay deeper liquidity, slippage, or capacity.

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
- The served production bundle contains the multi-stake audit marker.
- Local and deployed source checksums matched.
- LAN and public health endpoints returned `ok`.
- Nginx started with zero restarts.
- API and worker containers were not recreated and retained zero restarts.

## Release record

- Application commit: `1988738` — Surface multi-stake capacity progress
- Recovery point: `/Users/admin/jester-releases/20260725T195658Z`
- Exact Git archive:
  `/Users/admin/jester-releases/20260725T195658Z/deploy-1988738.tgz`
- Archive SHA-256:
  `430262445ee105e1f73a6cc1f7bde888fa60a4ba64aab561fed0d1545e2bc2c3`
- Nginx image:
  `sha256:728a768f06ae8b1fc79cbbbc019c1acc98de86334ebffcf5af79411675468cf9`
- API image remained:
  `sha256:e72b60bac54fce5cfe49261f933d2b416bc4a7eff56f964d1d27cfc835a41f7f`
- Worker image remained:
  `sha256:b52cba222ab5a3ac0c9c922f0cf3977c6e7cfd9889efcc1e834462e47739baca`

The compose dependency graph reran the existing migrator while rolling nginx. No
schema change was part of this release.
