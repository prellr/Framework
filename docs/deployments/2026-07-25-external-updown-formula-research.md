# External Up/Down and historical Formula Lab research deployment receipt

- Product version: `0.1.0`
- Deployed source commit: `cf374fe`
- Deployed at: `2026-07-25T01:39:20Z`
- Server: Server2 (`/Users/admin/jester-analytics`)
- Recovery point: `/Users/admin/jester-releases/20260725T013215Z`
- Source archive SHA-256: `d18c588fd05e9e114fcbc54086222f76ef59dbf214211798bb7f4df5655801eb`
- Database dump SHA-256: `8c7fa89d5acec5c721de0af6692fb28021a56a4993ace4a7a56202694ca29b1b`
- API image: `sha256:f706cad8f4689807b495448791777eb952c67eed4dee316e491d41f0235740ee`
- Worker image: `sha256:86739b880c46f84c11fb3af729f1ef6086ced03b555c750719b76d47cd9f60a7`
- Nginx image: `sha256:95e23e21307b0cb7d54b22531c900fa09a84f3463a30ed288b63d78ba8bb591d`
- Migrate image: `sha256:7fa8ee6330290050440cbca725f595101cdb7579a0e91c4ddc176b7838ddf037`

## Research disposition

The public-system review and the user-supplied August–September 2024 Formula Lab material are now
durable research inputs. They do not admit a strategy, feature, operator, threshold, or historical
performance claim.

The imported Albert expression is preserved byte-for-byte and parsed without evaluation:

`Less(Max(WMA(Ref($low,2),40),20),Mul(Cov(Sub(Div($volume,$open),Sub(Ref($volume,4),Ref($close,5))),Add(Add($volume,$close),Add(Ref($low,3),$open)),50),Ref($open,1)))`

Its deterministic syntax summary is 34 nodes, depth 7, 15 function-call nodes, nine function types,
and four source fields. Formula Lab visualizes the full abstract syntax tree and explains the
expression's branches while warning about mixed units, an unprotected division, composite scale,
and the lack of reproducible validation evidence.

The Knowledge record also captures ten public-system sources and the reusable design ideas supported
by them: source-health and latency telemetry, price-to-beat and rule visibility, model-versus-market
calibration, queue/depth-aware paper fills, immutable replay, multiplicity control, negative-result
retention, formula-output visualization, staged IC screening, cross-period minima, and distributed
worker telemetry.

## Pre-deployment gates

- 430 API service tests passed on Server2.
- API and web TypeScript checks passed.
- The web production build passed.
- `git diff --check` passed.
- The Compose configuration validated.
- A checksummed source archive and gzip-validated database dump were created before sync.
- The source sync performed no deletes.

## Post-deployment verification

- API health returned `ok`.
- API, worker, nginx, Postgres, and Redis were running; health-enabled services were healthy.
- Host load was `1.73 / 1.87 / 1.74`.
- The Knowledge article
  `alchemy-external-updown-system-intelligence-2026-07-24` was created with ten sources and the
  34-node legacy formula record.
- Re-running the recorder returned `already_recorded` and inserted no duplicate audit event.
- Formula Lab rendered `Albert legacy formula anatomy`, the exact source expression, syntax
  metrics, interpretation, warnings, and the scrollable expression tree.
- The Knowledge index rendered the new research article and its provenance tags.
- No browser console warnings or errors were observed on Formula Lab.

## Execution boundary

The frozen 57-member familywise roster, resolution-source feature-cut boundary, current search
grammar, and unchanged verdict gate remain intact. This deployment adds no strategy registration,
formula evaluation, optimizer or Crucible run, collector, subscription, database migration, paper
decision, order route, authentication, signing, submission, allocation, wallet, or fund-moving
capability. Historical screenshots and reported results remain provenance only.
