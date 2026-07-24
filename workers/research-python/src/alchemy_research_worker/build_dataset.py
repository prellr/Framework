from __future__ import annotations

import argparse
import json
import math
import os
import tempfile
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from . import PROTOCOL_VERSION
from .artifacts import canonical_json_bytes, sha256_file

DATASET_SCHEMA_VERSION = "alchemy-fixed-horizon-dataset-v1"
BASE_COLUMNS = (
    "row_id",
    "asset",
    "target_id",
    "event_at_ms",
    "source_at_ms",
    "received_at_ms",
    "label_end_at_ms",
    "label_received_at_ms",
    "entry_price",
    "exit_price",
)


def _parse_iso(value: Any, label: str) -> int:
    if not isinstance(value, str):
        raise TypeError(f"{label} must be an ISO-8601 string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError(f"{label} must include a timezone")
    return round(parsed.timestamp() * 1_000)


def _iso(value_ms: int) -> str:
    return (
        datetime.fromtimestamp(value_ms / 1_000, tz=timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{label} must be an integer")
    if abs(value) > 9_007_199_254_740_991:
        raise ValueError(f"{label} exceeds the cross-language safe-integer range")
    return value


def _finite_float(value: Any, label: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result) or (positive and result <= 0):
        qualifier = "positive and " if positive else ""
        raise ValueError(f"{label} must be {qualifier}finite")
    return result


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise TypeError(f"input line {line_number} must be an object")
            rows.append(value)
    if not rows:
        raise ValueError("dataset input must contain at least one row")
    return rows


def _validate_spec(spec: dict[str, Any]) -> dict[str, Any]:
    required = {
        "datasetId",
        "datasetVersion",
        "frozenAt",
        "featureColumns",
        "boundary",
        "labelSpec",
        "sourceSpecs",
        "targetSpecs",
    }
    missing = sorted(required - spec.keys())
    if missing:
        raise ValueError(f"dataset spec is missing {', '.join(missing)}")
    if not isinstance(spec["datasetId"], str) or not spec["datasetId"].strip():
        raise ValueError("datasetId must be non-empty")
    if (
        not isinstance(spec["datasetVersion"], str)
        or not spec["datasetVersion"].strip()
    ):
        raise ValueError("datasetVersion must be non-empty")
    features = spec["featureColumns"]
    if (
        not isinstance(features, list)
        or not features
        or any(not isinstance(value, str) or not value for value in features)
        or len(set(features)) != len(features)
        or set(features).intersection(BASE_COLUMNS)
    ):
        raise ValueError("featureColumns must be non-empty, unique, and not reserved")
    targets = spec["targetSpecs"]
    if not isinstance(targets, list) or not targets:
        raise ValueError("targetSpecs must be non-empty")
    target_ids: set[str] = set()
    for target in targets:
        if not isinstance(target, dict):
            raise TypeError("each target spec must be an object")
        target_id = target.get("id")
        asset = target.get("asset")
        horizon_ms = target.get("horizonMs")
        if (
            not isinstance(target_id, str)
            or not target_id
            or target_id in target_ids
            or not isinstance(asset, str)
            or not asset
            or isinstance(horizon_ms, bool)
            or not isinstance(horizon_ms, int)
            or horizon_ms < 1
        ):
            raise ValueError(
                "target specs require unique ids, assets, and positive horizonMs"
            )
        target_ids.add(target_id)
    boundary = spec["boundary"]
    if not isinstance(boundary, dict):
        raise TypeError("boundary must be an object")
    discovery_start = _parse_iso(boundary.get("discoveryStart"), "discoveryStart")
    discovery_end = _parse_iso(boundary.get("discoveryEnd"), "discoveryEnd")
    embargo_ms = _integer(boundary.get("embargoMs"), "embargoMs")
    if discovery_end <= discovery_start or embargo_ms < 0:
        raise ValueError("discovery boundary or embargo is invalid")
    validation_start_value = boundary.get("validationStart")
    validation_end_value = boundary.get("validationEnd")
    if (validation_start_value is None) != (validation_end_value is None):
        raise ValueError("validationStart and validationEnd must be supplied together")
    validation_start = (
        _parse_iso(validation_start_value, "validationStart")
        if validation_start_value is not None
        else None
    )
    validation_end = (
        _parse_iso(validation_end_value, "validationEnd")
        if validation_end_value is not None
        else None
    )
    if (
        validation_start is not None
        and validation_end is not None
        and (
            validation_start < discovery_end + embargo_ms
            or validation_end <= validation_start
        )
    ):
        raise ValueError("validation must begin after discovery plus embargo")
    return {
        **spec,
        "_clock": {
            "discoveryStart": discovery_start,
            "discoveryEnd": discovery_end,
            "validationStart": validation_start,
            "validationEnd": validation_end,
            "frozenAt": _parse_iso(spec["frozenAt"], "frozenAt"),
        },
    }


def _interval_end(received_at_ms: int, clock: dict[str, int | None]) -> int:
    if clock["discoveryStart"] <= received_at_ms < clock["discoveryEnd"]:
        return int(clock["discoveryEnd"])
    validation_start = clock["validationStart"]
    validation_end = clock["validationEnd"]
    if (
        validation_start is not None
        and validation_end is not None
        and validation_start <= received_at_ms < validation_end
    ):
        return int(validation_end)
    raise ValueError(
        "row receive clock is outside discovery/validation or inside the embargo"
    )


def _normalize_rows(
    rows: Iterable[dict[str, Any]],
    spec: dict[str, Any],
) -> list[dict[str, Any]]:
    target_by_id = {target["id"]: target for target in spec["targetSpecs"]}
    features: list[str] = spec["featureColumns"]
    clock = spec["_clock"]
    normalized: list[dict[str, Any]] = []
    row_ids: set[str] = set()
    row_keys: set[tuple[str, str, int]] = set()

    for input_index, row in enumerate(rows, start=1):
        row_id = row.get("row_id")
        asset = row.get("asset")
        target_id = row.get("target_id")
        if (
            not isinstance(row_id, str)
            or not row_id
            or row_id in row_ids
            or not isinstance(asset, str)
            or not asset
            or not isinstance(target_id, str)
            or target_id not in target_by_id
        ):
            raise ValueError(f"row {input_index} has an invalid or duplicate identity")
        target = target_by_id[target_id]
        if asset != target["asset"]:
            raise ValueError(f"row {input_index} asset does not match its target")

        event_at_ms = _integer(row.get("event_at_ms"), "event_at_ms")
        source_at_ms = _integer(row.get("source_at_ms"), "source_at_ms")
        received_at_ms = _integer(row.get("received_at_ms"), "received_at_ms")
        label_end_at_ms = _integer(row.get("label_end_at_ms"), "label_end_at_ms")
        label_received_at_ms = _integer(
            row.get("label_received_at_ms"), "label_received_at_ms"
        )
        interval_end = _interval_end(received_at_ms, clock)
        if event_at_ms > received_at_ms or source_at_ms > received_at_ms:
            raise ValueError(f"row {input_index} uses a feature clock from the future")
        if label_end_at_ms != received_at_ms + target["horizonMs"]:
            raise ValueError(f"row {input_index} does not match its fixed horizon")
        if label_received_at_ms < label_end_at_ms:
            raise ValueError(
                f"row {input_index} label was received before its exit event"
            )
        if label_received_at_ms >= interval_end:
            raise ValueError(
                f"row {input_index} label was unavailable before its research interval ended"
            )
        if label_received_at_ms > clock["frozenAt"]:
            raise ValueError(
                f"row {input_index} label was unavailable at the frozen clock"
            )

        key = (asset, target_id, received_at_ms)
        if key in row_keys:
            raise ValueError(
                f"row {input_index} duplicates an asset/target/receive clock"
            )
        row_ids.add(row_id)
        row_keys.add(key)
        normalized_row: dict[str, Any] = {
            "row_id": row_id,
            "asset": asset,
            "target_id": target_id,
            "event_at_ms": event_at_ms,
            "source_at_ms": source_at_ms,
            "received_at_ms": received_at_ms,
            "label_end_at_ms": label_end_at_ms,
            "label_received_at_ms": label_received_at_ms,
            "entry_price": _finite_float(
                row.get("entry_price"), "entry_price", positive=True
            ),
            "exit_price": _finite_float(
                row.get("exit_price"), "exit_price", positive=True
            ),
        }
        for feature in features:
            normalized_row[feature] = _finite_float(
                row.get(feature), f"feature {feature}"
            )
        normalized.append(normalized_row)

    normalized.sort(
        key=lambda row: (
            row["target_id"],
            row["asset"],
            row["received_at_ms"],
            row["row_id"],
        )
    )
    return normalized


def _field(name: str, data_type: pa.DataType, role: str) -> pa.Field:
    return pa.field(
        name, data_type, nullable=False, metadata={b"alchemy.role": role.encode()}
    )


def _schema(feature_columns: list[str], metadata: dict[bytes, bytes]) -> pa.Schema:
    timestamp = pa.timestamp("ms", tz="UTC")
    return pa.schema(
        [
            _field("row_id", pa.string(), "id"),
            _field("asset", pa.string(), "id"),
            _field("target_id", pa.string(), "id"),
            _field("event_at_ms", timestamp, "event_clock"),
            _field("source_at_ms", timestamp, "source_clock"),
            _field("received_at_ms", timestamp, "receive_clock"),
            _field("label_end_at_ms", timestamp, "label"),
            _field("label_received_at_ms", timestamp, "receive_clock"),
            _field("entry_price", pa.float64(), "feature"),
            _field("exit_price", pa.float64(), "label"),
            *[_field(name, pa.float64(), "feature") for name in feature_columns],
        ],
        metadata=metadata,
    )


def _manifest_columns(feature_columns: list[str]) -> list[dict[str, Any]]:
    return [
        {"name": "row_id", "dataType": "utf8", "role": "id", "nullable": False},
        {"name": "asset", "dataType": "utf8", "role": "id", "nullable": False},
        {"name": "target_id", "dataType": "utf8", "role": "id", "nullable": False},
        {
            "name": "event_at_ms",
            "dataType": "timestamp_ms",
            "role": "event_clock",
            "nullable": False,
        },
        {
            "name": "source_at_ms",
            "dataType": "timestamp_ms",
            "role": "source_clock",
            "nullable": False,
        },
        {
            "name": "received_at_ms",
            "dataType": "timestamp_ms",
            "role": "receive_clock",
            "nullable": False,
        },
        {
            "name": "label_end_at_ms",
            "dataType": "timestamp_ms",
            "role": "label",
            "nullable": False,
        },
        {
            "name": "label_received_at_ms",
            "dataType": "timestamp_ms",
            "role": "receive_clock",
            "nullable": False,
        },
        {
            "name": "entry_price",
            "dataType": "float64",
            "role": "feature",
            "nullable": False,
        },
        {
            "name": "exit_price",
            "dataType": "float64",
            "role": "label",
            "nullable": False,
        },
        *[
            {
                "name": name,
                "dataType": "float64",
                "role": "feature",
                "nullable": False,
            }
            for name in feature_columns
        ],
    ]


def build_dataset(
    *,
    input_path: Path,
    spec_path: Path,
    output_dir: Path,
) -> tuple[Path, Path, dict[str, Any]]:
    spec_value = json.loads(spec_path.read_text(encoding="utf-8"))
    if not isinstance(spec_value, dict):
        raise TypeError("dataset spec must be an object")
    spec = _validate_spec(spec_value)
    rows = _normalize_rows(_load_jsonl(input_path), spec)
    output_dir.mkdir(parents=True, exist_ok=True)

    metadata_value = {
        "protocolVersion": PROTOCOL_VERSION,
        "datasetId": spec["datasetId"],
        "datasetVersion": spec["datasetVersion"],
        "schemaVersion": DATASET_SCHEMA_VERSION,
        "featureColumns": spec["featureColumns"],
        "boundary": spec["boundary"],
        "labelSpec": spec["labelSpec"],
        "sourceSpecs": spec["sourceSpecs"],
        "targetSpecs": spec["targetSpecs"],
        "frozenAt": spec["frozenAt"],
        "availabilityClock": "receive_clock",
    }
    metadata = {
        b"alchemy.metadata": canonical_json_bytes(metadata_value),
        b"alchemy.protocolVersion": PROTOCOL_VERSION.encode(),
        b"alchemy.schemaVersion": DATASET_SCHEMA_VERSION.encode(),
    }
    schema = _schema(spec["featureColumns"], metadata)
    arrays: dict[str, pa.Array] = {}
    for field in schema:
        values = [row[field.name] for row in rows]
        arrays[field.name] = pa.array(values, type=field.type)
    table = pa.table(arrays, schema=schema)

    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=".alchemy-dataset-", suffix=".parquet", dir=output_dir
    )
    os.close(file_descriptor)
    temporary_path = Path(temporary_name)
    try:
        pq.write_table(
            table,
            temporary_path,
            compression="zstd",
            compression_level=9,
            data_page_version="2.0",
            row_group_size=65_536,
            use_dictionary=["asset", "target_id"],
            version="2.6",
            write_statistics=True,
        )
        content_hash = sha256_file(temporary_path)
        artifact_path = output_dir / f"{content_hash.removeprefix('sha256:')}.parquet"
        if artifact_path.exists():
            if sha256_file(artifact_path) != content_hash:
                raise ValueError("content-address collision at dataset destination")
            temporary_path.unlink()
        else:
            temporary_path.replace(artifact_path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()

    event_times = [row["event_at_ms"] for row in rows]
    assets = sorted({row["asset"] for row in rows})
    artifact = {
        "contentHash": content_hash,
        "uri": artifact_path.resolve().as_uri(),
        "format": "parquet",
        "byteSize": artifact_path.stat().st_size,
        "schemaVersion": DATASET_SCHEMA_VERSION,
    }
    manifest = {
        "protocolVersion": PROTOCOL_VERSION,
        "datasetId": spec["datasetId"],
        "datasetVersion": spec["datasetVersion"],
        "contentHash": content_hash,
        "artifact": artifact,
        "rowCount": len(rows),
        "assets": assets,
        "eventStart": _iso(min(event_times)),
        "eventEnd": _iso(max(event_times)),
        "frozenAt": spec["frozenAt"],
        "availabilityClock": "receive_clock",
        "columns": _manifest_columns(spec["featureColumns"]),
        "boundary": spec["boundary"],
        "labelSpec": spec["labelSpec"],
        "sourceSpecs": spec["sourceSpecs"],
        "targetSpecs": spec["targetSpecs"],
    }
    manifest_path = output_dir / f"{content_hash.removeprefix('sha256:')}.manifest.json"
    manifest_path.write_bytes(canonical_json_bytes(manifest) + b"\n")
    return artifact_path, manifest_path, manifest


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build an immutable causal Alchemy Parquet research dataset"
    )
    parser.add_argument("--input", required=True, type=Path, help="bounded JSONL input")
    parser.add_argument(
        "--spec", required=True, type=Path, help="preregistered build spec"
    )
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    artifact_path, manifest_path, manifest = build_dataset(
        input_path=args.input,
        spec_path=args.spec,
        output_dir=args.output_dir,
    )
    print(
        json.dumps(
            {
                "artifact": str(artifact_path),
                "manifest": str(manifest_path),
                "contentHash": manifest["contentHash"],
                "rowCount": manifest["rowCount"],
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
