# Polymarket 15-minute public-book handoff hardening

- Commit: `8f05b76` — Harden Polymarket 15m book handoff
- Deployed to Server2: `2026-07-25T20:21:56Z`
- Recovery point: `/Users/admin/jester-releases/20260725T202051Z`
- Recovery source SHA-256:
  `9df2d9bedd118dbf012bdcb3239583055eece21acadd05609f50e252dc499378`
- Recovery database SHA-256:
  `92151203422dd28dd2188f4b009a77ad096002f8d9fae97c4a4a1fca26b8f004`
- Worker image:
  `sha256:5c453a49d7b07a6c5cd8cec36215914e5c694a2583b10f829fe146f9e611ee24`

## Outcome-blind diagnosis

The shadow-connector latency audit had 242 stale-book rejections. All but two were concentrated in
twenty 15-minute windows, with the same forty rejected plans in every asset's 15-minute bucket.
The surrounding windows were fully prepared. This diagnosis inspected only market identity,
decision clocks, timeframe, and the connector's acceptance/rejection telemetry; it did not inspect
side, price, signal, outcome, grade, return, rank, or P&L.

The existing socket contract subscribes to the next market during a frozen one-minute handoff and
refreshes discovery every thirty seconds. Complete current-market discovery stopped at contracts
ending within fifteen minutes. One minute before a 15-minute contract begins, that contract ends
sixteen minutes in the future, so it could not be discovered early enough for the promised handoff.
Its initial public book therefore depended on a post-open race with the paper decision clock.

The snapshot watchdog compounded that race by checking only already-open markets, not the future
handoff tokens that the socket intended to subscribe.

## Correction

- Current discovery now extends seventeen minutes: the original fifteen-minute market horizon plus
  the one-minute subscription lead and one thirty-second refresh interval, rounded up.
- Paper decisions remain restricted to markets whose windows have already opened.
- The existing snapshot watchdog now requires baselines for every token eligible for the same
  bounded subscription, including the one-minute future handoff.
- No socket, poller, fallback request, database read, credential, signer, order submission,
  cancellation, fill reconciliation, balance, wallet, or execution control was added.
- Historical stale rows remain unchanged and continue to count against the frozen audit coverage
  floor.

## Verification

- Forty-five focused discovery, collector, report, and boundary tests passed.
- API TypeScript validation passed.
- Worker restarted with zero restarts and initialized the current 24/24 public CLOB books.
- At the first post-deploy 5-minute handoff, the watchdog detected the future baseline requirement,
  reconnected before the decision clock, expanded the subscription from 24 to 36 tokens, and all
  twelve corresponding shadow plans were prepared with 1–100 ms public-book age.
- At the first exact simultaneous 5-minute and 15-minute boundary (`2026-07-25T20:30:00Z`), all
  twenty-four shadow plans were prepared without a stale-book rejection. The twelve 15-minute plans
  used public books aged 5–61 ms; the twelve 5-minute plans used books aged 8–76 ms.
- The immutable all-history audit then contained 3,960 expected plans across 1,980 markets, with
  3,718 prepared (93.8889% coverage) and the original 242 historical stale-book rejections retained.
  Operational review therefore remained false because the frozen audit still had less than 95%
  coverage and less than 24 hours of span.
- The worker remained load-bounded after the boundary at approximately 13% CPU and 262 MiB, with
  zero restarts.

The shadow connector remains research-only. Authentication, signing, and submission are disabled,
and no live Polymarket execution interface or endpoint exists.
