# Alchemy versioning

Alchemy uses three complementary identifiers:

1. **Product version** — the SemVer value in `/VERSION`. Bump it when a coherent application
   release is prepared.
2. **Git commit** — the exact source snapshot. Every deployment and recovery point should record
   the full commit SHA.
3. **Research-contract version** — immutable identifiers such as
   `alchemy-formula-scale-engine-v1`. Never change the meaning of an existing research-contract
   version; add a new version and preserve the prior one for reproducibility.

## Product-version rules

- Patch (`0.1.0` → `0.1.1`): compatible fixes, copy changes, instrumentation, and presentation
  improvements that do not change stored or research-contract semantics.
- Minor (`0.1.0` → `0.2.0`): compatible product capabilities, pages, data products, or new
  explicitly versioned research contracts.
- Major (`0.x` → `1.0.0`, then `1.x` → `2.0.0`): an intentionally stable public baseline or an
  incompatible application/data interface.

Pre-1.0 versions indicate that the product and research surface are evolving. They do not weaken
the immutability requirement for frozen research contracts.

## Checkpoint workflow

1. Audit the worktree for generated files, credentials, database dumps, and oversized artifacts.
2. Run API tests, TypeScript checks, web production build, worker tests, and `git diff --check`.
3. Update `/VERSION` and `/CHANGELOG.md` when preparing a new product version.
4. Commit an intentional source snapshot. Do not combine unrelated runtime dumps or secrets.
5. Record the commit SHA in the Server2 recovery/deployment receipt.
6. Create and push a release tag only as a separate, explicit release action.

Versioning describes software state. It does not alter a strategy's evidence status, frozen
boundary, verdict, paper allocation, or execution permission.
