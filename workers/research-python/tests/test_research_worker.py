from __future__ import annotations

import json
import math
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq
from alchemy_research_worker import (
    FIXED_HORIZON_ADAPTER_VERSION,
    FORMULA_EVALUATOR_VERSION,
    PROTOCOL_VERSION,
)
from alchemy_research_worker.artifacts import (
    canonical_json_bytes,
    sha256_file,
)
from alchemy_research_worker.build_dataset import build_dataset
from alchemy_research_worker.formula_evaluator import evaluate_formula_job
from alchemy_research_worker.worker import ResearchApi, run_once


def iso(value_ms: int) -> str:
    return (
        datetime.fromtimestamp(value_ms / 1_000, tz=timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


class ResearchWorkerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="alchemy-worker-test-")
        self.root = Path(self.temporary.name)
        self.start = 1_900_000_000_000
        self.horizon = 600_000
        self.count = 180
        final_received = self.start + (self.count - 1) * 60_000
        self.discovery_end = final_received + self.horizon + 10_000
        self.frozen_at = self.discovery_end + 1_000
        self.spec = {
            "datasetId": "synthetic-fixed-horizon-v1",
            "datasetVersion": "1",
            "frozenAt": iso(self.frozen_at),
            "featureColumns": ["momentum", "basis"],
            "boundary": {
                "discoveryStart": iso(self.start - 1_000),
                "discoveryEnd": iso(self.discovery_end),
                "embargoMs": self.horizon,
            },
            "labelSpec": {
                "kind": "fixed-horizon-log-return",
                "horizonMs": self.horizon,
                "paperOnly": True,
            },
            "sourceSpecs": [{"id": "synthetic-test-source"}],
            "targetSpecs": [
                {
                    "id": "BTC-USD",
                    "asset": "BTC-USD",
                    "kind": "fixed-horizon-short",
                    "horizonMs": self.horizon,
                    "entryPriceColumn": "entry_price",
                    "exitPriceColumn": "exit_price",
                    "riskPerNotional": 1,
                    "capitalRequiredPerNotional": 1,
                }
            ],
        }
        self.spec_path = self.root / "spec.json"
        self.spec_path.write_bytes(canonical_json_bytes(self.spec))
        rows = []
        for index in range(self.count):
            received = self.start + index * 60_000
            momentum = math.sin(index * 0.23)
            entry = 100.0
            # Positive momentum predicts a falling future price, so the positive-momentum short
            # formula has a deterministic paper edge in this synthetic mechanics fixture.
            exit_price = entry * math.exp(-momentum * 0.001)
            rows.append(
                {
                    "row_id": f"row-{index:04d}",
                    "asset": "BTC-USD",
                    "target_id": "BTC-USD",
                    "event_at_ms": received - 100,
                    "source_at_ms": received - 50,
                    "received_at_ms": received,
                    "label_end_at_ms": received + self.horizon,
                    "label_received_at_ms": received + self.horizon + 100,
                    "entry_price": entry,
                    "exit_price": exit_price,
                    "momentum": momentum,
                    "basis": math.cos(index * 0.17),
                }
            )
        # Reverse the source to prove canonical sorting is part of materialization.
        self.rows = list(reversed(rows))
        self.input_path = self.root / "rows.jsonl"
        self.input_path.write_text(
            "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in self.rows),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_dataset_is_causal_content_addressed_and_deterministic(self) -> None:
        first_dir = self.root / "first"
        second_dir = self.root / "second"
        first_path, _, first_manifest = build_dataset(
            input_path=self.input_path,
            spec_path=self.spec_path,
            output_dir=first_dir,
        )
        second_path, _, second_manifest = build_dataset(
            input_path=self.input_path,
            spec_path=self.spec_path,
            output_dir=second_dir,
        )
        self.assertEqual(first_manifest["contentHash"], sha256_file(first_path))
        self.assertEqual(first_manifest["contentHash"], second_manifest["contentHash"])
        self.assertEqual(first_path.read_bytes(), second_path.read_bytes())
        self.assertEqual(first_manifest["availabilityClock"], "receive_clock")
        self.assertEqual(first_manifest["rowCount"], self.count)
        table = pq.read_table(first_path)
        self.assertEqual(table["row_id"][0].as_py(), "row-0000")
        metadata = json.loads(table.schema.metadata[b"alchemy.metadata"])
        self.assertEqual(metadata["protocolVersion"], PROTOCOL_VERSION)
        self.assertEqual(metadata["featureColumns"], ["momentum", "basis"])

    def test_dataset_rejects_lookahead_and_incomplete_labels(self) -> None:
        bad = dict(self.rows[0])
        bad["row_id"] = "future-clock"
        bad["source_at_ms"] = bad["received_at_ms"] + 1
        path = self.root / "future.jsonl"
        path.write_text(json.dumps(bad) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "feature clock from the future"):
            build_dataset(
                input_path=path,
                spec_path=self.spec_path,
                output_dir=self.root / "bad-output",
            )

        incomplete = dict(self.rows[0])
        incomplete["row_id"] = "late-label"
        incomplete["label_received_at_ms"] = self.discovery_end
        path.write_text(json.dumps(incomplete) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "interval ended"):
            build_dataset(
                input_path=path,
                spec_path=self.spec_path,
                output_dir=self.root / "bad-output-2",
            )

    def test_formula_result_and_capital_summary_are_deterministic(self) -> None:
        dataset_path, _, manifest = build_dataset(
            input_path=self.input_path,
            spec_path=self.spec_path,
            output_dir=self.root / "dataset",
        )
        candidates = {
            "version": "alchemy-formula-scale-engine-v1",
            "candidates": [
                {
                    "id": "momentum-short:z0",
                    "expression": {"op": "feature", "feature": "momentum"},
                    "thresholdZ": 0,
                },
                {
                    "id": "momentum-fade:z0",
                    "expression": {
                        "op": "neg",
                        "child": {"op": "feature", "feature": "momentum"},
                    },
                    "thresholdZ": 0,
                },
            ],
        }
        candidate_path = self.root / "candidates.json"
        candidate_path.write_bytes(canonical_json_bytes(candidates))
        candidate_hash = sha256_file(candidate_path)
        job = {
            "protocolVersion": PROTOCOL_VERSION,
            "experimentId": "00000000-0000-4000-8000-000000000001",
            "shardId": "00000000-0000-4000-8000-000000000002",
            "attempt": 1,
            "leaseExpiresAt": iso(self.frozen_at + 120_000),
            "stage": "discovery",
            "resourceClass": "cpu",
            "dataset": manifest["artifact"],
            "candidateManifest": {
                "contentHash": candidate_hash,
                "uri": candidate_path.resolve().as_uri(),
                "format": "json",
                "byteSize": candidate_path.stat().st_size,
                "schemaVersion": "formula-candidate-v1",
            },
            "candidateStart": 0,
            "candidateEnd": 2,
            "targetId": "BTC-USD",
            "targetAdapterVersion": FIXED_HORIZON_ADAPTER_VERSION,
            "evaluatorVersion": FORMULA_EVALUATOR_VERSION,
            "costModel": {
                "roundTripBps": 1,
                "minimumTrades": 10,
                "complexityPenaltyBps": 0.01,
                "riskPerNotional": 1,
                "capitalRequiredPerNotional": 1,
            },
            "capitalPolicy": {
                "startingCapitalUsd": 10_000,
                "sizingMode": "fixed-notional",
                "sizingValue": 1_000,
                "compound": False,
                "maxGrossExposureFraction": 1,
                "maxConcurrentPositions": 1,
                "minNotionalUsd": 1,
                "maxNotionalUsd": 1_000,
                "liquidationFloorUsd": 0,
            },
            "seed": 42,
        }
        first = evaluate_formula_job(job, dataset_path, candidate_path)
        second = evaluate_formula_job(job, dataset_path, candidate_path)
        self.assertEqual(first["resultDigest"], second["resultDigest"])
        first_without_runtime = {**first, "runtimeMs": 0}
        second_without_runtime = {**second, "runtimeMs": 0}
        first_without_runtime.pop("resultDigest")
        second_without_runtime.pop("resultDigest")
        self.assertEqual(first_without_runtime, second_without_runtime)
        self.assertEqual(first["status"], "completed")
        self.assertEqual(first["evaluatedCandidates"], 2)
        self.assertEqual(first["evaluatedRows"], 2 * self.count)
        self.assertTrue(first["resultDigest"].startswith("sha256:"))
        best = first["inlineResults"][0]
        self.assertEqual(best["candidateId"], "momentum-short:z0")
        self.assertGreater(best["netMeanBps"], 0)
        self.assertGreater(best["capitalSummary"]["finalEquityUsd"], 10_000)
        self.assertTrue(best["metrics"]["paperOnly"])

    def test_validation_partitions_rows_and_uses_only_frozen_calibration(self) -> None:
        discovery_count = 80
        validation_count = 60
        discovery_end = (
            self.start + (discovery_count - 1) * 60_000 + self.horizon + 1_000
        )
        validation_start = discovery_end + self.horizon
        validation_end = (
            validation_start + (validation_count - 1) * 60_000 + self.horizon + 1_000
        )
        frozen_at = validation_end + 1_000
        spec = {
            **self.spec,
            "datasetId": "synthetic-discovery-validation-v1",
            "frozenAt": iso(frozen_at),
            "boundary": {
                "discoveryStart": iso(self.start - 1_000),
                "discoveryEnd": iso(discovery_end),
                "embargoMs": self.horizon,
                "validationStart": iso(validation_start),
                "validationEnd": iso(validation_end),
            },
        }
        spec_path = self.root / "validation-spec.json"
        spec_path.write_bytes(canonical_json_bytes(spec))
        rows = []
        for stage_start, count, prefix in (
            (self.start, discovery_count, "discovery"),
            (validation_start, validation_count, "validation"),
        ):
            for index in range(count):
                received = stage_start + index * 60_000
                momentum = math.sin(index * 0.23)
                rows.append(
                    {
                        "row_id": f"{prefix}-{index:04d}",
                        "asset": "BTC-USD",
                        "target_id": "BTC-USD",
                        "event_at_ms": received - 100,
                        "source_at_ms": received - 50,
                        "received_at_ms": received,
                        "label_end_at_ms": received + self.horizon,
                        "label_received_at_ms": received + self.horizon + 100,
                        "entry_price": 100.0,
                        "exit_price": 100.0 * math.exp(-momentum * 0.001),
                        "momentum": momentum,
                        "basis": math.cos(index * 0.17),
                    }
                )
        rows_path = self.root / "validation-rows.jsonl"
        rows_path.write_text(
            "".join(
                json.dumps(row, separators=(",", ":")) + "\n" for row in reversed(rows)
            ),
            encoding="utf-8",
        )
        dataset_path, _, dataset_manifest = build_dataset(
            input_path=rows_path,
            spec_path=spec_path,
            output_dir=self.root / "validation-dataset",
        )
        discovery_candidates = {
            "version": "alchemy-formula-scale-engine-v1",
            "stage": "discovery",
            "candidates": [
                {
                    "id": "momentum-short:z0",
                    "expression": {"op": "feature", "feature": "momentum"},
                    "thresholdZ": 0,
                }
            ],
        }
        discovery_path = self.root / "discovery-candidates.json"
        discovery_path.write_bytes(canonical_json_bytes(discovery_candidates))
        capital_policy = {
            "startingCapitalUsd": 10_000,
            "sizingMode": "fixed-notional",
            "sizingValue": 1_000,
            "compound": False,
            "maxGrossExposureFraction": 1,
            "maxConcurrentPositions": 1,
            "liquidationFloorUsd": 0,
        }
        base_job = {
            "protocolVersion": PROTOCOL_VERSION,
            "experimentId": "00000000-0000-4000-8000-000000000021",
            "shardId": "00000000-0000-4000-8000-000000000022",
            "attempt": 1,
            "leaseExpiresAt": iso(frozen_at + 120_000),
            "resourceClass": "cpu",
            "dataset": dataset_manifest["artifact"],
            "candidateStart": 0,
            "candidateEnd": 1,
            "targetId": "BTC-USD",
            "targetAdapterVersion": FIXED_HORIZON_ADAPTER_VERSION,
            "evaluatorVersion": FORMULA_EVALUATOR_VERSION,
            "costModel": {
                "roundTripBps": 1,
                "minimumTrades": 10,
                "complexityPenaltyBps": 0.01,
                "riskPerNotional": 1,
                "capitalRequiredPerNotional": 1,
            },
            "capitalPolicy": capital_policy,
            "seed": 42,
        }
        discovery_job = {
            **base_job,
            "stage": "discovery",
            "candidateManifest": {
                "contentHash": sha256_file(discovery_path),
                "uri": discovery_path.resolve().as_uri(),
                "format": "json",
                "schemaVersion": "formula-candidate-v1",
            },
        }
        discovery_result = evaluate_formula_job(
            discovery_job,
            dataset_path,
            discovery_path,
        )
        self.assertEqual(discovery_result["evaluatedRows"], discovery_count)

        validation_candidates = {
            "version": "alchemy-formula-validation-selection-v2",
            "stage": "validation",
            "featureCalibration": {
                "momentum": {"mean": 1_000.0, "std": 1.0},
                "basis": {"mean": 0.0, "std": 1.0},
            },
            "candidates": [
                {
                    "id": "momentum-short:z0",
                    "expression": {"op": "feature", "feature": "momentum"},
                    "thresholdZ": 0,
                    "outputCalibration": {"mean": 0.0, "std": 1.0},
                }
            ],
        }
        validation_path = self.root / "validation-candidates.json"
        validation_path.write_bytes(canonical_json_bytes(validation_candidates))
        validation_job = {
            **base_job,
            "experimentId": "00000000-0000-4000-8000-000000000023",
            "shardId": "00000000-0000-4000-8000-000000000024",
            "stage": "validation",
            "candidateManifest": {
                "contentHash": sha256_file(validation_path),
                "uri": validation_path.resolve().as_uri(),
                "format": "json",
                "schemaVersion": "formula-validation-selection-v2",
            },
        }
        validation_result = evaluate_formula_job(
            validation_job,
            dataset_path,
            validation_path,
        )
        self.assertEqual(validation_result["evaluatedRows"], validation_count)
        self.assertEqual(len(validation_result["inlineResults"]), 1)
        candidate = validation_result["inlineResults"][0]
        self.assertEqual(candidate["trades"], 0)
        self.assertIsNone(candidate["grossMeanBps"])
        self.assertIsNone(candidate["selectionScore"])
        self.assertFalse(candidate["metrics"]["eligible"])
        self.assertEqual(candidate["metrics"]["stage"], "validation")
        self.assertEqual(
            candidate["metrics"]["featureCalibration"],
            validation_candidates["featureCalibration"],
        )
        self.assertEqual(
            candidate["metrics"]["outputCalibration"],
            {"mean": 0.0, "std": 1.0},
        )

        missing_calibration = {
            **validation_candidates,
            "featureCalibration": {"momentum": {"mean": 0.0, "std": 1.0}},
        }
        missing_path = self.root / "missing-calibration.json"
        missing_path.write_bytes(canonical_json_bytes(missing_calibration))
        with self.assertRaisesRegex(ValueError, "exact frozen feature calibration"):
            evaluate_formula_job(validation_job, dataset_path, missing_path)

    def test_pull_worker_round_trip_needs_only_http_and_hashed_artifacts(self) -> None:
        dataset_path, _, manifest = build_dataset(
            input_path=self.input_path,
            spec_path=self.spec_path,
            output_dir=self.root / "http-dataset",
        )
        candidates = {
            "version": "alchemy-formula-scale-engine-v1",
            "candidates": [
                {
                    "id": "momentum-short:z0",
                    "expression": {"op": "feature", "feature": "momentum"},
                    "thresholdZ": 0,
                }
            ],
        }
        candidate_path = self.root / "http-candidates.json"
        candidate_path.write_bytes(canonical_json_bytes(candidates))
        captured: dict[str, Any] = {}
        worker_key = "w" * 32

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_: object) -> None:
                return

            def do_GET(self) -> None:
                source = (
                    dataset_path
                    if self.path == "/dataset"
                    else candidate_path
                    if self.path == "/candidates"
                    else None
                )
                if source is None:
                    self.send_error(404)
                    return
                body = source.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:
                self.assert_worker_key()
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                if self.path.endswith("/lease"):
                    capabilities = payload["capabilities"]
                    if capabilities["workerId"] != "http-test-worker":
                        self.send_error(400)
                        return
                    port = self.server.server_address[1]
                    job = {
                        "protocolVersion": PROTOCOL_VERSION,
                        "experimentId": "00000000-0000-4000-8000-000000000011",
                        "shardId": "00000000-0000-4000-8000-000000000012",
                        "attempt": 1,
                        "leaseExpiresAt": iso(self_outer.frozen_at + 120_000),
                        "stage": "discovery",
                        "resourceClass": "cpu",
                        "dataset": {
                            **manifest["artifact"],
                            "uri": f"http://127.0.0.1:{port}/dataset",
                        },
                        "candidateManifest": {
                            "contentHash": sha256_file(candidate_path),
                            "uri": f"http://127.0.0.1:{port}/candidates",
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
                            "minimumTrades": 10,
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
                    self.send_json({"leaseToken": "l" * 43, "job": job})
                elif self.path.endswith("/heartbeat"):
                    self.send_json(
                        {"leaseExpiresAt": iso(self_outer.frozen_at + 120_000)}
                    )
                elif self.path.endswith("/result"):
                    captured.update(payload)
                    self.send_json({"idempotent": False})
                else:
                    self.send_error(404)

            def assert_worker_key(self) -> None:
                if self.headers.get("X-Research-Worker-Key") != worker_key:
                    self.send_error(401)
                    raise AssertionError("worker key mismatch")

            def send_json(self, value: dict[str, Any]) -> None:
                body = canonical_json_bytes(value)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self_outer = self
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            api = ResearchApi(
                f"http://127.0.0.1:{server.server_address[1]}",
                worker_key,
            )
            self.assertTrue(
                run_once(api, worker_id="http-test-worker", lease_seconds=30)
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

        self.assertEqual(captured["workerId"], "http-test-worker")
        self.assertEqual(captured["leaseToken"], "l" * 43)
        self.assertEqual(captured["result"]["status"], "completed")
        self.assertEqual(captured["result"]["evaluatedCandidates"], 1)
        self.assertGreater(
            captured["result"]["inlineResults"][0]["capitalSummary"]["finalEquityUsd"],
            10_000,
        )

    def test_worker_source_has_no_database_venue_or_execution_dependency(self) -> None:
        package = Path(__file__).parents[1] / "src" / "alchemy_research_worker"
        source = "\n".join(
            (package / name).read_text(encoding="utf-8")
            for name in ("worker.py", "formula_evaluator.py", "artifacts.py")
        )
        for forbidden in (
            "DATABASE_URL",
            "private_key",
            "wallet_secret",
            "place_order",
            "submit_order",
            "polymarket",
            "hyperliquid",
        ):
            self.assertNotIn(forbidden, source.lower())


if __name__ == "__main__":
    unittest.main()
