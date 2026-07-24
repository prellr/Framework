from __future__ import annotations

import argparse
import json
import os
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Self

from . import (
    FIXED_HORIZON_ADAPTER_VERSION,
    FORMULA_EVALUATOR_VERSION,
    PROTOCOL_VERSION,
)
from .artifacts import fetch_artifact
from .formula_evaluator import evaluate_formula_job, failed_result


class ResearchApi:
    def __init__(self, base_url: str, worker_key: str) -> None:
        parsed = urllib.parse.urlparse(base_url)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("research API URL must use http or https")
        if len(worker_key) < 32:
            raise ValueError("research worker key must contain at least 32 characters")
        self.base_url = base_url.rstrip("/")
        self.worker_key = worker_key

    def _request(self, path: str, payload: dict[str, Any]) -> Any:
        body = json.dumps(
            payload, allow_nan=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Research-Worker-Key": self.worker_key,
                "User-Agent": "alchemy-research-worker/0.1",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                if response.status == 204:
                    return None
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            message = error.read().decode("utf-8", errors="replace")[:2_000]
            raise RuntimeError(
                f"research API {path} returned {error.code}: {message}"
            ) from error

    def lease(self, worker_id: str, lease_seconds: int) -> dict[str, Any] | None:
        return self._request(
            "/api/research-worker/lease",
            {
                "capabilities": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "workerId": worker_id,
                    "resourceClasses": ["cpu"],
                    "evaluatorVersions": [FORMULA_EVALUATOR_VERSION],
                    "targetAdapterVersions": [FIXED_HORIZON_ADAPTER_VERSION],
                    "maxCandidateBatch": 500,
                },
                "leaseSeconds": lease_seconds,
            },
        )

    def heartbeat(
        self,
        *,
        shard_id: str,
        worker_id: str,
        lease_token: str,
        extend_seconds: int,
    ) -> None:
        self._request(
            "/api/research-worker/heartbeat",
            {
                "shardId": shard_id,
                "workerId": worker_id,
                "leaseToken": lease_token,
                "extendSeconds": extend_seconds,
            },
        )

    def result(
        self,
        *,
        worker_id: str,
        lease_token: str,
        result: dict[str, Any],
    ) -> None:
        self._request(
            "/api/research-worker/result",
            {
                "workerId": worker_id,
                "leaseToken": lease_token,
                "result": result,
            },
        )


class LeaseHeartbeat:
    def __init__(
        self,
        api: ResearchApi,
        *,
        job: dict[str, Any],
        worker_id: str,
        lease_token: str,
        extend_seconds: int,
    ) -> None:
        self.api = api
        self.job = job
        self.worker_id = worker_id
        self.lease_token = lease_token
        self.extend_seconds = extend_seconds
        self.stop_event = threading.Event()
        self.error: Exception | None = None
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        interval = max(10, min(60, self.extend_seconds // 3))
        while not self.stop_event.wait(interval):
            try:
                self.api.heartbeat(
                    shard_id=self.job["shardId"],
                    worker_id=self.worker_id,
                    lease_token=self.lease_token,
                    extend_seconds=self.extend_seconds,
                )
            except Exception as error:  # noqa: BLE001 - preserve any heartbeat transport failure
                self.error = error
                self.stop_event.set()

    def __enter__(self) -> Self:
        self.thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self.stop_event.set()
        self.thread.join(timeout=5)


def run_once(
    api: ResearchApi,
    *,
    worker_id: str,
    lease_seconds: int,
) -> bool:
    leased = api.lease(worker_id, lease_seconds)
    if leased is None:
        return False
    lease_token = leased["leaseToken"]
    job = leased["job"]
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="alchemy-research-") as temporary:
        directory = Path(temporary)
        heartbeat = LeaseHeartbeat(
            api,
            job=job,
            worker_id=worker_id,
            lease_token=lease_token,
            extend_seconds=lease_seconds,
        )
        with heartbeat:
            try:
                dataset_path = fetch_artifact(
                    job["dataset"], directory / "dataset.parquet"
                )
                candidate_path = fetch_artifact(
                    job["candidateManifest"], directory / "candidates"
                )
                result = evaluate_formula_job(job, dataset_path, candidate_path)
            except Exception as error:  # noqa: BLE001 - convert evaluation failures to protocol
                result = failed_result(
                    job,
                    error,
                    round((time.perf_counter() - started) * 1_000),
                )
        if heartbeat.error is not None:
            raise RuntimeError(
                "research lease heartbeat failed before commit"
            ) from heartbeat.error
        api.result(
            worker_id=worker_id,
            lease_token=lease_token,
            result=result,
        )
    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the paper-only Alchemy research worker"
    )
    parser.add_argument("--once", action="store_true", help="lease at most one shard")
    parser.add_argument("--poll-seconds", type=float, default=5)
    parser.add_argument("--lease-seconds", type=int, default=120)
    args = parser.parse_args()
    base_url = os.environ.get("ALCHEMY_RESEARCH_API_URL", "")
    worker_key = os.environ.get("ALCHEMY_RESEARCH_WORKER_KEY", "")
    worker_id = os.environ.get("ALCHEMY_RESEARCH_WORKER_ID", "")
    if not worker_id:
        raise ValueError("ALCHEMY_RESEARCH_WORKER_ID is required")
    if args.lease_seconds < 30 or args.lease_seconds > 900:
        raise ValueError("lease seconds must be between 30 and 900")
    if args.poll_seconds < 0.25:
        raise ValueError("poll seconds must be at least 0.25")
    api = ResearchApi(base_url, worker_key)
    while True:
        did_work = run_once(
            api,
            worker_id=worker_id,
            lease_seconds=args.lease_seconds,
        )
        if args.once:
            return
        if not did_work:
            time.sleep(args.poll_seconds)


if __name__ == "__main__":
    main()
