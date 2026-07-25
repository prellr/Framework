# Formula operators and admin login history deployment receipt

- Deployed source commits: `8cc258e`, `5ebd0c8`
- Verified at: `2026-07-25T04:37:28Z`
- Server: Server2 (`/Users/admin/jester-analytics`)
- Recovery point: `/Users/admin/jester-releases/20260725T042656Z`
- Recovery source hash:
  `sha256:c110b4aea4aaaac2b5979adf7a06109679a5c6508ff9545da70257dff7a5dd0f`
- Recovery database hash:
  `sha256:127ab4cb1ecc6dd880acef868eb03022001233daf0f25eb65e8dda968f9f664d`
- Migration ledger: 41 applied migrations
- API image:
  `sha256:13164a30b240715fb3a1fb3dc3b26f856c4d227548ceb1685d56b8916e6591af`
- Worker image:
  `sha256:1f18bdbf1077ccf20c72f452fdd7fceaf532755dc506d28d2923b623b62921fd`
- Nginx image:
  `sha256:805c80a949a36e50169841f1faf8b0565e68a77bfb47f20f9eca562d8f321bc5`

## Formula Lab

- Added a governed operator catalog with separate active-search, import-evaluator, candidate, and
  excluded states.
- Kept the random-search budget configurable. Ten thousand candidates is a capacity example, not
  a fixed target or success criterion.
- Preserved the exact historical Albert expression in the research record and replayed it against
  the immutable BTC 5m tape without selecting or exporting a winner.
- Recorded `alchemy-formula-operator-catalog-v1` and
  `alchemy-historical-albert-btc-5m-replay-research-v1` in Knowledge. Repeating the write produced
  no duplicate audit events.

## Login history

- Added the append-only `login_event` audit table and a successful-session creation hook.
- The admin-only API returns user snapshots, authentication method, IP address, user agent, and
  login time. It never returns session IDs, tokens, cookies, or passwords.
- Existing retained sessions were backfilled once through the idempotent migration. Server2
  contains 12 backfilled login records.
- The deployed **Settings → Admin → Login history** view exposes user filtering, paging, and
  sortable columns. It renders in the browser's local timezone.

## Verification

- 451 database-backed service tests passed on Server2 with zero failures.
- Two focused admin login-history router tests passed.
- Database, API, and web TypeScript checks passed.
- The production web build passed.
- API, Postgres, and Redis reported healthy; worker and nginx were running.
- The deployed admin view rendered all 12 retained-session records, the user sort reordered rows,
  and no browser console errors were observed.

## Safety disposition

This release changes research tooling and administrative auditing only. It does not register or
admit a strategy, alter the frozen familywise roster or verdict gate, start Crucible, authenticate
to an exchange, sign or submit an order, or enable live execution.
