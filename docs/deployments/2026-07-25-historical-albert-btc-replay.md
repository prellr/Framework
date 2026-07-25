# Historical Albert formula × BTC 5m replay

## Outcome

Alchemy now has a restricted Microsoft Qlib v0.9.5-compatible evaluator for the user-supplied
Albert expression, a gap-safe canonical OHLCV adapter, exact fixed-clock 10-minute labels,
chronological fold assessment, non-overlapping paper positions, and a fixed-notional capital-path
illustration.

The immutable BTC source tape contains 102,267 five-minute bars in three gap-safe segments.
102,066 completed-bar decisions were eligible for replay.

## Corrected semantics

Primary Qlib source established that:

- `Less(left,right)` is an element-wise numeric minimum, not a Boolean predicate;
- `Max(feature,N)` is a rolling maximum, not a two-input maximum;
- `Ref(feature,N)` reads N periods ago when N is positive;
- `Cov(left,right,N)` is rolling covariance;
- Qlib v0.9.5 `WMA` normalizes linear weights and then calls `np.nanmean(weight * x)`.

Alchemy pins and reproduces those historical semantics. It does not silently replace the WMA with
a conventional weighted sum.

## Trial result

Receipt:
`sha256:f73f89915dc51a2c564cc1dc9ab9f9305844e3bc46f3e451443d82f73d0b9bd1`

Dataset:
`sha256:455ea5183517895bbcb17ec97fc9936304e97d4b81a45d4cd406864c805c1b53`

Seven trials were retained: one always-short control and high/low formula tails at z = 0, 0.5,
and 1. Entry is the next contiguous five-minute open after the decision bar closes; exit is the
open exactly ten minutes after entry. Every completed trade receives a 10 bps round-trip stress.

No trial produced a positive net fold. The extreme low-tail z1 trial had the largest gross mean,
at +2.08 bps, but remained -7.92 bps net and missed the 100-trades-per-fold floor. The high-tail
z0.5 and z1 gates generated no trades because the raw formula output is extremely negatively
skewed.

## Safety and evidence

This is retrospective discovery, not untouched validation. Historical OHLCV bar opens are not
executable fills. No result selects or exports a winner, creates a strategy, creates a paper bot,
changes the familywise roster or verdict gate, starts Crucible, signs an order, or enables
execution.

Any percentile/rank gate, winsorization, component formula, conventional-WMA version, long-side
target, or alternate horizon is a new sensitivity family prompted by this audit. It must not be
substituted into this receipt.

## Verification

- Restricted evaluator tests cover operator semantics, exact legacy WMA scaling, gap resets,
  unsupported functions, and future-reference rejection.
- Replay tests cover artifact hashes, source clocks, gap crossing, chronological purging,
  denominator retention, and future-data mutation protection.
- API and web type checks pass.

Source: [Microsoft Qlib v0.9.5 operators](https://github.com/microsoft/qlib/blob/v0.9.5/qlib/data/ops.py).
