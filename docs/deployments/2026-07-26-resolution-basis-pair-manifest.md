# Resolution-basis feature cuts and pair-manifest freeze receipt

Recorded on Server2 on 2026-07-26 after the preregistered venue-tape readiness
floor and both immutable activation boundaries had elapsed.

## Frozen feature cuts

- Artifact: `updown-resolution-source-basis-feature-cuts-v1`
- SHA-256: `ee57b674002dd545af79427d8c5c2323485f263c234acdfaa1a2214ff75cd552`
- Frozen at: `2026-07-26T13:17:56.852Z`
- Strategy not before: `2026-07-26T14:00:00.000Z`

The feature-cut command returned `immutable_artifact_already_exists`. The
artifact therefore remained unchanged and no second write or audit row was
created.

## Frozen pair manifest

- Artifact: `updown-resolution-basis-catchup-pair-manifest-v1`
- SHA-256: `90fe874915de2c0f66dda81ecc2eade65a711ca5b876c4cc3f17bb0cbf30084d`
- Frozen at: `2026-07-26T13:30:13.763Z`
- Strategy not before: `2026-07-26T14:15:00.000Z`
- Fixed causal lag: 5 seconds
- Qualifying pairs: `BTC-USD`, `DOGE-USD`, `SOL-USD`, `XRP-USD`

`BNB-USD` and `ETH-USD` remain in the immutable six-pair manifest but did not
pass the preregistered fixed-lag confidence test. No lag search, pair removal,
threshold change, or fallback was permitted.

The pair-manifest command also returned `immutable_artifact_already_exists`.
The artifact remained unchanged and no second write or audit row was created.

## Safety and verification

- The focused resolution-basis catch-up suite passed 8/8 tests.
- API TypeScript validation passed.
- The manifest is bound to the exact feature-cut SHA-256 and recomputes pair
  eligibility from the stored fixed-lag confidence bounds.
- The artifact contains no target outcome, paper result, chosen strategy
  direction, fill, return, rank, or P&L.
- It creates no paper bot and changes no existing 57-member frozen family,
  collector, verdict gate, wallet, credential, signer, or order route.
- The independent two-member catch-up family still requires a later reviewed
  paper-only implementation and launch; no automatic activation occurred.

## Operational correction

The package command for the feature-cut freezer now uses
`--env-file-if-exists`, matching the containerized launch commands. Compose
already injects the runtime environment, so a missing `/app/.env` no longer
prevents an otherwise valid, idempotent audit command from running.
