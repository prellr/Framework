# Polymarket connector architecture

Date: 2026-07-25  
Status: public data connected; authenticated trading locked

## Decision

Alchemy will use the current official unified TypeScript SDK,
[`@polymarket/client`](https://docs.polymarket.com/getting-started/typescript), for the account and
order lifecycle. The older standalone TypeScript and Python CLOB clients, public bots, and the
official CLI are useful reference implementations but are not the production dependency.

The official migration guide explicitly replaces the previous split SDK packages with the unified
client:

- [SDK migration](https://docs.polymarket.com/getting-started/migrate-from-previous-sdks)
- [Official TypeScript SDK repository](https://github.com/Polymarket/ts-sdk)
- [Official Polymarket CLI](https://github.com/Polymarket/polymarket-cli)

## Current connector inventory

Already connected:

- Gamma market discovery for crypto Up/Down markets.
- Shared public CLOB market WebSocket and in-memory books.
- Captured fee-adjusted book walks and entry asks.
- Tick-size, minimum-size, staleness, depth, and maximum-slippage validation.
- Deterministic FOK BUY shadow plans with no REST, database, socket creation, or JSON parsing on the
  preparation hot path.
- Execution-cost, markout, capacity, overlap, and capital diagnostics.

New in `polymarket-connector-readiness-v1`:

- A bounded live probe through the official public SDK.
- A secret-free control-plane projection of wallet, signer, relayer, RPC, and risk configuration.
- A dedicated **Settings → Polymarket connector** surface for account prerequisites, risk limits,
  and research collectors. Signer, relayer-key, and RPC values are encrypted at rest and never
  returned in plaintext.
- A visible readiness panel in Execution & Capital.
- Node 24 in the production image, matching the current SDK runtime requirement.

Not connected:

- `SecureClient` construction and CLOB L1/L2 authentication.
- Authenticated user WebSocket.
- REST reconciliation for open orders and fills after reconnect.
- Balance, allowance, and position reconciliation.
- Idempotent order journal and client intent IDs.
- Order submission, cancellation, or emergency cancel-all.
- A live canary arm that can actually reach an order endpoint.

No API mutation was added in this milestone.

## Official authentication model

For an existing Polymarket account, the official flow requires:

1. The account wallet address.
2. The private signer that controls the account.
3. A Relayer API key and its signer address for gasless wallet operations.
4. L1 EIP-712 authentication to create or derive CLOB L2 credentials.
5. L2 HMAC authentication for private CLOB requests.
6. A wallet signature on every order.

Source: [Wallets and Authentication](https://docs.polymarket.com/trading/wallets-auth).

Alchemy should use a dedicated, tightly funded signer and account wallet. It should not reuse a
general-purpose treasury or personal wallet.

## Planned runtime shape

```text
strategy decision
  -> in-memory paired CLOB book
  -> fee/depth/tick/staleness/risk checks
  -> deterministic order intent + idempotency key
  -> local signing
  -> official SecureClient order post
  -> user WebSocket acknowledgement/fill updates
  -> REST reconciliation after every reconnect
  -> durable order/fill/position ledger
```

Market-data reads stay shared. A strategy must not open its own REST or WebSocket connection.
Account state is single-writer and reconciled from both the authenticated user stream and REST.

The official order documentation provides market/limit order creation, posting, batching, and order
statuses:

- [Place Orders](https://docs.polymarket.com/trading/place-orders)
- [Manage Orders](https://docs.polymarket.com/trading/manage-orders)
- [Real-Time Order Updates](https://docs.polymarket.com/trading/realtime-order-updates)

## Required fail-closed controls

Before the first live canary, all of these are mandatory:

- Explicit maximum order dollars.
- Explicit maximum total open exposure.
- Explicit daily realized-plus-mark-to-market loss limit.
- Explicit maximum public-book age.
- One open intent per strategy × market unless the strategy contract permits otherwise.
- Idempotent submission and duplicate-fill protection.
- Reconnect recovery: suspend new orders, list open orders and recent fills, reconcile, then resume.
- Cancel-all and stop-new-orders controls independent of the strategy engine.
- Geographical and account-eligibility check.
- Balance/allowance check before every submission.
- Recorded quote, expected fill, actual fill, fee, slippage, signing latency, post latency, and
  acknowledgement latency.

## Fees and execution economics

For fee-enabled crypto markets, the current taker fee formula is price-dependent. The official SDK
fetches and applies the market fee parameters; the connector should not hardcode a second manual fee
into the submitted order. Our shadow and analytics layers still record an independent fee estimate
for audit and reconciliation.

Source: [Polymarket Fees](https://docs.polymarket.com/trading/fees).

## Controlled activation sequence

1. Public SDK probe — implemented.
2. Configure dedicated wallet, signer, relayer, RPC, and explicit risk limits.
3. Add an admin-only connection test that constructs `SecureClient`, reports the resolved account,
   and performs read-only account/order/balance calls.
4. Add user-stream ingestion plus REST reconciliation and a durable account ledger.
5. Add a dry-run order state machine that consumes real acknowledgements without posting orders.
6. Add submission code behind a build-time capability flag and a separate runtime arm.
7. Run a human-confirmed minimum-size canary in one market.
8. Evaluate fills, slippage, stale rejects, duplicate protection, and capital limits before
   increasing scope.

Strategy performance gates and connector safety gates are independent. Passing one cannot bypass
the other.
