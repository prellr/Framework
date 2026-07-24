# Alchemy research worker

This package is the reference implementation of Alchemy's external research-compute seam. It is
deliberately separate from the API, warehouse, collectors, paper ledger, and all execution code.

The worker can:

- read an immutable, content-addressed Parquet dataset;
- read a content-addressed formula-candidate manifest;
- lease one bounded shard through `/api/research-worker/lease`;
- evaluate fixed-horizon paper outcomes and the supplied capital policy;
- heartbeat the lease and return content-hashed research results.

The worker cannot create an experiment, query the application database, access venue credentials,
register a strategy, create a paper bot, or place a trade.

## Dataset layout

`alchemy-build-dataset` converts bounded JSONL rows into deterministic Parquet. Every row has:

- `row_id`, `asset`, and `target_id`;
- `event_at_ms`, `source_at_ms`, and `received_at_ms`;
- `label_end_at_ms` and `label_received_at_ms`;
- `entry_price`, `exit_price`, and the feature columns named by the build specification.

The builder rejects rows whose feature clocks were unavailable at entry, labels that were
unavailable by the end of their research interval, rows inside the discovery/validation embargo,
duplicates, and fixed-horizon mismatches. Rows are sorted before serialization. The Parquet file is
named by its SHA-256 digest and the emitted dataset manifest uses the same digest.

Example:

```bash
uv run --project workers/research-python \
  alchemy-build-dataset \
  --input /bounded/export.jsonl \
  --spec /bounded/dataset-spec.json \
  --output-dir /immutable/alchemy
```

The build spec supplies the frozen clock, boundary, feature columns, sources, labels, and target
adapters. It must be preregistered; the builder never invents a boundary from the data.

## Worker

```bash
export ALCHEMY_RESEARCH_API_URL=https://alchemy.example
export ALCHEMY_RESEARCH_WORKER_KEY=...
export ALCHEMY_RESEARCH_WORKER_ID=cpu-lab-01

uv run --project workers/research-python alchemy-research-worker
```

The worker uses only Python's standard HTTP client. Dataset and candidate artifact URIs may be
`file://` URIs on a shared research filesystem or bounded `http(s)://` download URLs. Every
download is verified against the lease's SHA-256 hash before parsing.

For development, `--once` leases at most one shard and exits. The default mode polls continuously.
The environment intentionally has no database URL, wallet, exchange key, or trading credential.
