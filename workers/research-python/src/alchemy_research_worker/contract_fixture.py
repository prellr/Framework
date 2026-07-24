"""Emit one real evaluator result for the TypeScript wire-contract verifier."""

from __future__ import annotations

import json
import math
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from . import (
    FIXED_HORIZON_ADAPTER_VERSION,
    FORMULA_EVALUATOR_VERSION,
    PROTOCOL_VERSION,
)
from .artifacts import canonical_json_bytes, sha256_file
from .build_dataset import build_dataset
from .formula_evaluator import evaluate_formula_job


def _iso(value_ms: int) -> str:
    return (
        datetime.fromtimestamp(value_ms / 1_000, tz=timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def main() -> None:
    start = 1_900_000_000_000
    horizon = 600_000
    rows = 72
    discovery_end = start + (rows - 1) * 60_000 + horizon + 10_000
    with tempfile.TemporaryDirectory(prefix="alchemy-contract-") as temporary:
        root = Path(temporary)
        spec = {
            "datasetId": "cross-language-contract-fixture",
            "datasetVersion": "1",
            "frozenAt": _iso(discovery_end + 1_000),
            "featureColumns": ["momentum"],
            "boundary": {
                "discoveryStart": _iso(start - 1_000),
                "discoveryEnd": _iso(discovery_end),
                "embargoMs": horizon,
            },
            "labelSpec": {
                "kind": "fixed-horizon-log-return",
                "horizonMs": horizon,
                "paperOnly": True,
            },
            "sourceSpecs": [{"id": "synthetic-contract-source"}],
            "targetSpecs": [
                {
                    "id": "BTC-USD",
                    "asset": "BTC-USD",
                    "kind": "fixed-horizon-short",
                    "horizonMs": horizon,
                    "riskPerNotional": 1,
                    "capitalRequiredPerNotional": 1,
                }
            ],
        }
        spec_path = root / "spec.json"
        spec_path.write_bytes(canonical_json_bytes(spec))
        input_path = root / "rows.jsonl"
        with input_path.open("w", encoding="utf-8") as handle:
            for index in range(rows):
                received = start + index * 60_000
                momentum = math.sin(index * 0.31)
                handle.write(
                    json.dumps(
                        {
                            "row_id": f"contract-{index:04d}",
                            "asset": "BTC-USD",
                            "target_id": "BTC-USD",
                            "event_at_ms": received - 100,
                            "source_at_ms": received - 50,
                            "received_at_ms": received,
                            "label_end_at_ms": received + horizon,
                            "label_received_at_ms": received + horizon + 100,
                            "entry_price": 100,
                            "exit_price": 100 * math.exp(-momentum * 0.001),
                            "momentum": momentum,
                        },
                        separators=(",", ":"),
                    )
                    + "\n"
                )
        dataset_path, _, dataset_manifest = build_dataset(
            input_path=input_path,
            spec_path=spec_path,
            output_dir=root / "dataset",
        )
        candidate_path = root / "candidates.json"
        candidate_path.write_bytes(
            canonical_json_bytes(
                {
                    "candidates": [
                        {
                            "id": "momentum-short:z0",
                            "expression": {"op": "feature", "feature": "momentum"},
                            "thresholdZ": 0,
                        }
                    ]
                }
            )
        )
        job = {
            "protocolVersion": PROTOCOL_VERSION,
            "experimentId": "00000000-0000-4000-8000-000000000021",
            "shardId": "00000000-0000-4000-8000-000000000022",
            "attempt": 1,
            "leaseExpiresAt": _iso(discovery_end + 120_000),
            "stage": "discovery",
            "resourceClass": "cpu",
            "dataset": dataset_manifest["artifact"],
            "candidateManifest": {
                "contentHash": sha256_file(candidate_path),
                "uri": candidate_path.resolve().as_uri(),
                "format": "json",
                "byteSize": candidate_path.stat().st_size,
                "schemaVersion": "formula-candidate-v1",
            },
            "candidateStart": 0,
            "candidateEnd": 1,
            "targetId": "BTC-USD",
            "targetAdapterVersion": FIXED_HORIZON_ADAPTER_VERSION,
            "evaluatorVersion": FORMULA_EVALUATOR_VERSION,
            "costModel": {
                "roundTripBps": 1,
                "minimumTrades": 3,
                "complexityPenaltyBps": 0.01,
                "riskPerNotional": 1,
                "capitalRequiredPerNotional": 1,
            },
            "capitalPolicy": {
                "startingCapitalUsd": 10_000,
                "sizingMode": "fixed-risk",
                "sizingValue": 100,
                "compound": True,
                "maxGrossExposureFraction": 1,
                "maxConcurrentPositions": 1,
                "liquidationFloorUsd": 0,
            },
            "seed": 42,
        }
        result = evaluate_formula_job(job, dataset_path, candidate_path)
        print(canonical_json_bytes(result).decode("utf-8"))


if __name__ == "__main__":
    main()
