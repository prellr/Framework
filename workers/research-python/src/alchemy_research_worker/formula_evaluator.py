from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from . import (
    FIXED_HORIZON_ADAPTER_VERSION,
    FORMULA_EVALUATOR_VERSION,
    PROTOCOL_VERSION,
)
from .artifacts import canonical_json_bytes, sha256_bytes

MAXIMUM_ABSOLUTE_INTERMEDIATE = 1_000_000
PROTECTED_DIVISION_MINIMUM_DENOMINATOR = 1e-9
MAXIMUM_FORMULA_NODES = 7
MAXIMUM_FORMULA_DEPTH = 3


@dataclass(frozen=True)
class FormulaMetrics:
    trades: int
    gross_mean_bps: float | None
    net_mean_bps: float | None
    hit_rate: float | None
    standard_error_bps: float | None
    lower_confidence_bound_bps: float | None
    output_mean: float | None
    output_std: float | None
    trade_returns: list[tuple[int, int, float]]


def _metadata(table: pa.Table) -> dict[str, Any]:
    raw = (table.schema.metadata or {}).get(b"alchemy.metadata")
    if raw is None:
        raise ValueError("dataset is missing Alchemy metadata")
    value = json.loads(raw)
    if value.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("dataset protocol is incompatible with this worker")
    return value


def _timestamp_ms(column: pa.ChunkedArray) -> np.ndarray:
    return column.cast(pa.int64()).combine_chunks().to_numpy(zero_copy_only=False)


def _float_column(table: pa.Table, name: str) -> np.ndarray:
    if name not in table.column_names:
        raise ValueError(f"dataset is missing column {name}")
    values = table[name].combine_chunks().to_numpy(zero_copy_only=False)
    result = np.asarray(values, dtype=np.float64)
    if not np.isfinite(result).all():
        raise ValueError(f"dataset column {name} contains non-finite values")
    return result


def _formula_complexity(node: dict[str, Any]) -> int:
    op = node.get("op")
    if op in {"feature", "constant"}:
        return 1
    if op in {"neg", "abs", "tanh"}:
        return 1 + _formula_complexity(node["child"])
    if op in {"add", "sub", "mul", "protectedDiv"}:
        return (
            1 + _formula_complexity(node["left"]) + _formula_complexity(node["right"])
        )
    raise ValueError(f"unsupported formula operator {op}")


def _formula_depth(node: dict[str, Any]) -> int:
    op = node.get("op")
    if op in {"feature", "constant"}:
        return 1
    if op in {"neg", "abs", "tanh"}:
        return 1 + _formula_depth(node["child"])
    if op in {"add", "sub", "mul", "protectedDiv"}:
        return 1 + max(_formula_depth(node["left"]), _formula_depth(node["right"]))
    raise ValueError(f"unsupported formula operator {op}")


def _render_formula(node: dict[str, Any]) -> str:
    op = node["op"]
    if op == "feature":
        return str(node["feature"])
    if op == "constant":
        return str(node["value"])
    if op == "neg":
        return f"-({_render_formula(node['child'])})"
    if op == "abs":
        return f"abs({_render_formula(node['child'])})"
    if op == "tanh":
        return f"tanh({_render_formula(node['child'])})"
    symbols = {"add": "+", "sub": "−", "mul": "×", "protectedDiv": "÷"}
    if op not in symbols:
        raise ValueError(f"unsupported formula operator {op}")
    return f"({_render_formula(node['left'])} {symbols[op]} {_render_formula(node['right'])})"


def _validate_formula(node: dict[str, Any], feature_columns: set[str]) -> None:
    if _formula_complexity(node) > MAXIMUM_FORMULA_NODES:
        raise ValueError("formula exceeds the worker node limit")
    if _formula_depth(node) > MAXIMUM_FORMULA_DEPTH:
        raise ValueError("formula exceeds the worker depth limit")

    def visit(current: dict[str, Any]) -> None:
        op = current.get("op")
        if op == "feature":
            if current.get("feature") not in feature_columns:
                raise ValueError(f"unknown formula feature {current.get('feature')}")
            return
        if op == "constant":
            value = current.get("value")
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("formula constant must be numeric")
            if not math.isfinite(float(value)):
                raise ValueError("formula constant must be finite")
            return
        if op in {"neg", "abs", "tanh"}:
            if not isinstance(current.get("child"), dict):
                raise ValueError("unary formula child is missing")
            visit(current["child"])
            return
        if op in {"add", "sub", "mul", "protectedDiv"}:
            if not isinstance(current.get("left"), dict) or not isinstance(
                current.get("right"), dict
            ):
                raise ValueError("binary formula children are missing")
            visit(current["left"])
            visit(current["right"])
            return
        raise ValueError(f"unsupported formula operator {op}")

    visit(node)


def _bounded(values: np.ndarray) -> np.ndarray:
    return np.where(
        np.isfinite(values) & (np.abs(values) <= MAXIMUM_ABSOLUTE_INTERMEDIATE),
        values,
        np.nan,
    )


def _evaluate_formula(
    node: dict[str, Any],
    features: dict[str, np.ndarray],
) -> np.ndarray:
    op = node["op"]
    if op == "feature":
        return features[node["feature"]]
    if op == "constant":
        first = next(iter(features.values()))
        return np.full(first.shape, float(node["value"]), dtype=np.float64)
    if op in {"neg", "abs", "tanh"}:
        child = _evaluate_formula(node["child"], features)
        return _bounded(
            -child if op == "neg" else np.abs(child) if op == "abs" else np.tanh(child)
        )
    left = _evaluate_formula(node["left"], features)
    right = _evaluate_formula(node["right"], features)
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        if op == "add":
            value = left + right
        elif op == "sub":
            value = left - right
        elif op == "mul":
            value = left * right
        elif op == "protectedDiv":
            value = np.where(
                np.abs(right) >= PROTECTED_DIVISION_MINIMUM_DENOMINATOR,
                left / right,
                np.nan,
            )
        else:
            raise ValueError(f"unsupported formula operator {op}")
    return _bounded(value)


def _load_candidate_manifest(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        raise ValueError("candidate manifest is empty")
    if raw.startswith("{"):
        value = json.loads(raw)
        candidates = value.get("candidates") if isinstance(value, dict) else None
        if not isinstance(candidates, list):
            raise ValueError("JSON candidate manifest must contain a candidates array")
        manifest = value
    else:
        candidates = [json.loads(line) for line in raw.splitlines() if line.strip()]
        manifest = {"stage": "discovery"}
    if not candidates or any(
        not isinstance(candidate, dict) for candidate in candidates
    ):
        raise ValueError("candidate manifest must contain formula objects")
    ids: set[str] = set()
    for candidate in candidates:
        candidate_id = candidate.get("id")
        threshold = candidate.get("thresholdZ")
        if (
            not isinstance(candidate_id, str)
            or not candidate_id
            or candidate_id in ids
            or isinstance(threshold, bool)
            or not isinstance(threshold, (int, float))
            or not math.isfinite(float(threshold))
            or threshold < 0
            or not isinstance(candidate.get("expression"), dict)
        ):
            raise ValueError("candidate manifest has an invalid or duplicate formula")
        ids.add(candidate_id)
    return manifest, candidates


def _parse_iso_ms(value: Any, label: str) -> int:
    if not isinstance(value, str):
        raise TypeError(f"{label} must be an ISO-8601 timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError(f"{label} must include a timezone")
    return round(parsed.timestamp() * 1_000)


def _stage_bounds(metadata: dict[str, Any], stage: str) -> tuple[int, int]:
    boundary = metadata.get("boundary")
    if not isinstance(boundary, dict):
        raise TypeError("dataset metadata has no research boundary")
    if stage == "discovery":
        return (
            _parse_iso_ms(boundary.get("discoveryStart"), "discoveryStart"),
            _parse_iso_ms(boundary.get("discoveryEnd"), "discoveryEnd"),
        )
    if stage == "validation":
        if (
            boundary.get("validationStart") is None
            or boundary.get("validationEnd") is None
        ):
            raise ValueError("validation job requires a frozen validation interval")
        return (
            _parse_iso_ms(boundary["validationStart"], "validationStart"),
            _parse_iso_ms(boundary["validationEnd"], "validationEnd"),
        )
    raise ValueError(f"unsupported research stage {stage}")


def _moments(
    value: Any, label: str, *, positive_std: bool = False
) -> tuple[float, float]:
    if not isinstance(value, dict):
        raise TypeError(f"{label} calibration is missing")
    mean = value.get("mean")
    std = value.get("std")
    if (
        isinstance(mean, bool)
        or not isinstance(mean, (int, float))
        or isinstance(std, bool)
        or not isinstance(std, (int, float))
        or not math.isfinite(float(mean))
        or not math.isfinite(float(std))
        or float(std) < 0
        or (positive_std and float(std) <= 1e-12)
    ):
        raise ValueError(f"{label} calibration is invalid")
    return float(mean), float(std)


def _feature_calibration(
    manifest: dict[str, Any],
    feature_columns: set[str],
    values: dict[str, np.ndarray],
    stage: str,
) -> tuple[dict[str, dict[str, float]], dict[str, np.ndarray]]:
    if stage == "validation":
        raw = manifest.get("featureCalibration")
        if not isinstance(raw, dict) or set(raw) != feature_columns:
            raise ValueError(
                "validation manifest requires exact frozen feature calibration"
            )
        calibration = {}
        standardized = {}
        for name in sorted(feature_columns):
            mean, std = _moments(raw[name], f"feature {name}")
            calibration[name] = {"mean": mean, "std": std}
            standardized[name] = (
                (values[name] - mean) / std
                if std > 1e-12
                else np.zeros(values[name].shape, dtype=np.float64)
            )
        return calibration, standardized

    calibration = {}
    standardized = {}
    for name in sorted(feature_columns):
        mean = float(values[name].mean())
        std = float(values[name].std(ddof=1)) if values[name].size > 1 else 0.0
        calibration[name] = {"mean": mean, "std": std}
        standardized[name] = (
            (values[name] - mean) / std
            if std > 1e-12
            else np.zeros(values[name].shape, dtype=np.float64)
        )
    return calibration, standardized


def _formula_metrics(
    output: np.ndarray,
    candidate: dict[str, Any],
    received_at_ms: np.ndarray,
    label_end_at_ms: np.ndarray,
    gross_bps: np.ndarray,
    round_trip_bps: float,
    output_calibration: dict[str, Any] | None,
) -> FormulaMetrics:
    valid = np.isfinite(output)
    valid_values = output[valid]
    if output_calibration is None:
        if valid_values.size < 2:
            return FormulaMetrics(0, None, None, None, None, None, None, None, [])
        output_mean = float(valid_values.mean())
        output_std = float(valid_values.std(ddof=1))
    else:
        output_mean, output_std = _moments(
            output_calibration,
            f"candidate {candidate.get('id')} output",
            positive_std=True,
        )
    if not math.isfinite(output_std) or output_std <= 1e-12:
        return FormulaMetrics(
            0,
            None,
            None,
            None,
            None,
            None,
            output_mean,
            output_std,
            [],
        )

    score = (output - output_mean) / output_std
    entries: list[int] = []
    next_eligible_at = -(2**63)
    threshold = float(candidate["thresholdZ"])
    for index in range(output.size):
        if received_at_ms[index] < next_eligible_at:
            continue
        if not math.isfinite(float(score[index])) or score[index] < threshold:
            continue
        if not math.isfinite(float(gross_bps[index])):
            continue
        entries.append(index)
        next_eligible_at = int(label_end_at_ms[index])
    if not entries:
        return FormulaMetrics(
            0,
            None,
            None,
            None,
            None,
            None,
            output_mean,
            output_std,
            [],
        )

    gross = gross_bps[entries]
    net = gross - round_trip_bps
    standard_error = (
        float(net.std(ddof=1) / math.sqrt(len(entries))) if len(entries) > 1 else 0.0
    )
    net_mean = float(net.mean())
    trade_returns = [
        (
            int(received_at_ms[index]),
            int(label_end_at_ms[index]),
            float(net_value / 10_000),
        )
        for index, net_value in zip(entries, net, strict=True)
    ]
    return FormulaMetrics(
        trades=len(entries),
        gross_mean_bps=float(gross.mean()),
        net_mean_bps=net_mean,
        hit_rate=float(np.mean(net > 0)),
        standard_error_bps=standard_error,
        lower_confidence_bound_bps=net_mean - 1.645 * standard_error,
        output_mean=output_mean,
        output_std=output_std,
        trade_returns=trade_returns,
    )


def _capital_summary(
    trade_returns: list[tuple[int, int, float]],
    policy: dict[str, Any],
    *,
    risk_per_notional: float,
    capital_required_per_notional: float,
) -> dict[str, Any]:
    starting = float(policy["startingCapitalUsd"])
    equity = starting
    peak = starting
    minimum = starting
    maximum_drawdown = 0.0
    maximum_notional = 0.0
    executed = 0
    skipped = 0
    liquidated = False
    mode = policy["sizingMode"]
    sizing_value = float(policy["sizingValue"])
    compound = bool(policy["compound"])
    exposure_fraction = float(policy["maxGrossExposureFraction"])
    minimum_notional = float(policy.get("minNotionalUsd", 0))
    maximum_notional_limit = float(policy.get("maxNotionalUsd", math.inf))
    liquidation_floor = float(policy["liquidationFloorUsd"])
    if (
        not math.isfinite(starting)
        or starting <= 0
        or not math.isfinite(sizing_value)
        or sizing_value <= 0
        or not math.isfinite(exposure_fraction)
        or exposure_fraction <= 0
        or risk_per_notional <= 0
        or capital_required_per_notional <= 0
    ):
        raise ValueError(
            "capital policy and target economics must be positive and finite"
        )

    for _, _, net_return in trade_returns:
        if liquidated or equity <= liquidation_floor:
            skipped += 1
            continue
        sizing_equity = equity if compound else starting
        if mode == "fixed-notional":
            requested = sizing_value
        elif mode == "equity-fraction-notional":
            requested = sizing_equity * sizing_value
        elif mode == "fixed-risk":
            requested = sizing_value / risk_per_notional
        elif mode == "equity-fraction-risk":
            requested = sizing_equity * sizing_value / risk_per_notional
        else:
            raise ValueError(f"unsupported capital sizing mode {mode}")
        notional = min(
            requested,
            maximum_notional_limit,
            max(0.0, equity) * exposure_fraction,
            max(0.0, equity) / capital_required_per_notional,
        )
        if notional < minimum_notional or not math.isfinite(notional) or notional <= 0:
            skipped += 1
            continue
        pnl = notional * net_return
        equity += pnl
        executed += 1
        maximum_notional = max(maximum_notional, notional)
        peak = max(peak, equity)
        minimum = min(minimum, equity)
        maximum_drawdown = max(maximum_drawdown, peak - equity)
        if equity <= liquidation_floor:
            liquidated = True

    return {
        "startingCapitalUsd": starting,
        "finalEquityUsd": equity,
        "totalPnlUsd": equity - starting,
        "totalReturnPct": 100 * (equity / starting - 1),
        "minimumEquityUsd": minimum,
        "maximumDrawdownUsd": maximum_drawdown,
        "maximumDrawdownPct": 100 * maximum_drawdown / peak if peak > 0 else 0,
        "maximumNotionalUsd": maximum_notional,
        "executedTrades": executed,
        "skippedTrades": skipped,
        "liquidated": liquidated,
    }


def evaluate_formula_job(
    job: dict[str, Any],
    dataset_path: Path,
    candidate_path: Path,
) -> dict[str, Any]:
    started = time.perf_counter()
    if job.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("job protocol is incompatible with this worker")
    if job.get("evaluatorVersion") != FORMULA_EVALUATOR_VERSION:
        raise ValueError("job requests an unsupported evaluator")
    if job.get("targetAdapterVersion") != FIXED_HORIZON_ADAPTER_VERSION:
        raise ValueError("job requests an unsupported target adapter")
    stage = job.get("stage")
    if stage not in {"discovery", "validation"}:
        raise ValueError("job requests an unsupported research stage")

    table = pq.read_table(dataset_path)
    metadata = _metadata(table)
    stage_start_ms, stage_end_ms = _stage_bounds(metadata, stage)
    target = next(
        (
            value
            for value in metadata.get("targetSpecs", [])
            if value.get("id") == job.get("targetId")
        ),
        None,
    )
    if target is None:
        raise ValueError(f"dataset does not define target {job.get('targetId')}")
    target_ids = np.asarray(
        table["target_id"].combine_chunks().to_pylist(), dtype=object
    )
    all_received_at_ms = _timestamp_ms(table["received_at_ms"])
    all_label_received_at_ms = _timestamp_ms(table["label_received_at_ms"])
    mask = (
        (target_ids == job["targetId"])
        & (all_received_at_ms >= stage_start_ms)
        & (all_received_at_ms < stage_end_ms)
        & (all_label_received_at_ms < stage_end_ms)
    )
    indices = np.flatnonzero(mask)
    if indices.size == 0:
        raise ValueError("dataset has no complete rows for the leased target and stage")
    table = table.take(pa.array(indices, type=pa.int64()))
    received_at_ms = _timestamp_ms(table["received_at_ms"])
    order = np.argsort(received_at_ms, kind="stable")
    table = table.take(pa.array(order, type=pa.int64()))
    received_at_ms = received_at_ms[order]
    label_end_at_ms = _timestamp_ms(table["label_end_at_ms"])
    if np.any(label_end_at_ms != received_at_ms + int(target["horizonMs"])):
        raise ValueError("dataset target rows do not match the leased fixed horizon")

    feature_columns = set(metadata.get("featureColumns", []))
    if not feature_columns:
        raise ValueError("dataset metadata has no feature columns")
    manifest, all_candidates = _load_candidate_manifest(candidate_path)
    manifest_stage = manifest.get("stage", "discovery")
    if manifest_stage != stage:
        raise ValueError(f"{stage} job requires a {stage} candidate manifest")
    feature_values = {
        name: _float_column(table, name) for name in sorted(feature_columns)
    }
    feature_calibration, standardized = _feature_calibration(
        manifest,
        feature_columns,
        feature_values,
        stage,
    )
    entry_price = _float_column(table, "entry_price")
    exit_price = _float_column(table, "exit_price")
    gross_bps = 10_000 * np.log(entry_price / exit_price)

    start = int(job["candidateStart"])
    end = int(job["candidateEnd"])
    if start < 0 or end <= start or end > len(all_candidates):
        raise ValueError("leased candidate slice is outside the candidate manifest")
    candidates = all_candidates[start:end]
    cost_model = job.get("costModel") or {}
    round_trip_bps = float(cost_model.get("roundTripBps", 0))
    minimum_trades = int(cost_model.get("minimumTrades", 1))
    complexity_penalty_bps = float(cost_model.get("complexityPenaltyBps", 0))
    risk_per_notional = float(cost_model.get("riskPerNotional", 1))
    capital_required_per_notional = float(
        cost_model.get("capitalRequiredPerNotional", 1)
    )
    if (
        not math.isfinite(round_trip_bps)
        or round_trip_bps < 0
        or minimum_trades < 1
        or not math.isfinite(complexity_penalty_bps)
        or complexity_penalty_bps < 0
    ):
        raise ValueError("job cost model is invalid")

    inline_results: list[dict[str, Any]] = []
    for candidate in candidates:
        _validate_formula(candidate["expression"], feature_columns)
        frozen_output_calibration = (
            candidate.get("outputCalibration") if stage == "validation" else None
        )
        if stage == "validation" and frozen_output_calibration is None:
            raise ValueError(
                f"validation candidate {candidate['id']} has no frozen output calibration"
            )
        output = _evaluate_formula(candidate["expression"], standardized)
        metrics = _formula_metrics(
            output,
            candidate,
            received_at_ms,
            label_end_at_ms,
            gross_bps,
            round_trip_bps,
            frozen_output_calibration,
        )
        ineligible = (
            metrics.trades < minimum_trades
            or metrics.lower_confidence_bound_bps is None
            or metrics.gross_mean_bps is None
            or metrics.net_mean_bps is None
            or metrics.hit_rate is None
        )
        if stage == "discovery" and ineligible:
            continue
        complexity = _formula_complexity(candidate["expression"])
        selection_score = (
            None
            if metrics.lower_confidence_bound_bps is None
            else metrics.lower_confidence_bound_bps
            - (complexity_penalty_bps * complexity if stage == "discovery" else 0)
        )
        one_sided_p_value = (
            None
            if metrics.trades < minimum_trades
            or metrics.net_mean_bps is None
            or metrics.standard_error_bps is None
            else (
                0.0
                if metrics.standard_error_bps <= 1e-12 and metrics.net_mean_bps > 0
                else 1.0
                if metrics.standard_error_bps <= 1e-12
                else 0.5
                * math.erfc(
                    metrics.net_mean_bps / metrics.standard_error_bps / math.sqrt(2)
                )
            )
        )
        inline_results.append(
            {
                "candidateId": candidate["id"],
                "targetId": job["targetId"],
                "trades": metrics.trades,
                "grossMeanBps": metrics.gross_mean_bps,
                "netMeanBps": metrics.net_mean_bps,
                "standardErrorBps": metrics.standard_error_bps,
                "lowerConfidenceBoundBps": metrics.lower_confidence_bound_bps,
                "hitRate": metrics.hit_rate,
                "selectionScore": selection_score,
                "capitalSummary": _capital_summary(
                    metrics.trade_returns,
                    job["capitalPolicy"],
                    risk_per_notional=risk_per_notional,
                    capital_required_per_notional=capital_required_per_notional,
                ),
                "metrics": {
                    "formula": _render_formula(candidate["expression"]),
                    "thresholdZ": float(candidate["thresholdZ"]),
                    "complexity": complexity,
                    "validOutputs": int(np.isfinite(output).sum()),
                    "paperOnly": True,
                    "stage": stage,
                    "eligible": not ineligible,
                    "featureCalibration": feature_calibration,
                    "outputCalibration": (
                        None
                        if metrics.output_mean is None or metrics.output_std is None
                        else {
                            "mean": metrics.output_mean,
                            "std": metrics.output_std,
                        }
                    ),
                    "oneSidedPValue": one_sided_p_value,
                },
            }
        )
    if len(inline_results) > 500:
        raise ValueError("eligible result count exceeds the inline protocol limit")
    inline_results.sort(
        key=(
            (lambda value: value["candidateId"])
            if stage == "validation"
            else (
                lambda value: (
                    -float(value["selectionScore"]),
                    value["candidateId"],
                )
            )
        )
    )
    runtime_ms = max(0, round((time.perf_counter() - started) * 1_000))
    result: dict[str, Any] = {
        "protocolVersion": PROTOCOL_VERSION,
        "experimentId": job["experimentId"],
        "shardId": job["shardId"],
        "attempt": int(job["attempt"]),
        "status": "completed",
        "runtimeMs": runtime_ms,
        "evaluatedCandidates": len(candidates),
        "evaluatedRows": len(candidates) * table.num_rows,
        "inlineResults": inline_results,
    }
    # Runtime is operational telemetry, not scientific content. Excluding it makes the digest
    # stable when an identical leased shard must be recomputed after a transport interruption.
    digest_input = {key: value for key, value in result.items() if key != "runtimeMs"}
    result["resultDigest"] = sha256_bytes(canonical_json_bytes(digest_input))
    return result


def failed_result(
    job: dict[str, Any], error: Exception, runtime_ms: int
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "protocolVersion": PROTOCOL_VERSION,
        "experimentId": job["experimentId"],
        "shardId": job["shardId"],
        "attempt": int(job["attempt"]),
        "status": "failed",
        "runtimeMs": max(0, int(runtime_ms)),
        "evaluatedCandidates": 0,
        "evaluatedRows": 0,
        "error": {
            "code": "worker_evaluation_failed",
            "message": str(error)[:2_000],
            "retryable": False,
        },
    }
    digest_input = {key: value for key, value in result.items() if key != "runtimeMs"}
    result["resultDigest"] = sha256_bytes(canonical_json_bytes(digest_input))
    return result
