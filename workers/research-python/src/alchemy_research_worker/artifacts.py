from __future__ import annotations

import hashlib
import json
import shutil
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def verify_artifact(path: Path, artifact: dict[str, Any]) -> None:
    expected = artifact.get("contentHash")
    actual = sha256_file(path)
    if actual != expected:
        raise ValueError(
            f"artifact digest mismatch: expected {expected}, received {actual}"
        )
    expected_size = artifact.get("byteSize")
    if expected_size is not None and path.stat().st_size != expected_size:
        raise ValueError(
            f"artifact byte size mismatch: expected {expected_size}, "
            f"received {path.stat().st_size}"
        )


def fetch_artifact(
    artifact: dict[str, Any],
    destination: Path,
    *,
    maximum_bytes: int = 4 * 1024 * 1024 * 1024,
) -> Path:
    """Fetch one leased artifact without accepting database or venue URLs."""
    uri = str(artifact.get("uri", ""))
    parsed = urllib.parse.urlparse(uri)
    destination.parent.mkdir(parents=True, exist_ok=True)

    if parsed.scheme == "file":
        source = Path(urllib.request.url2pathname(parsed.path))
        if not source.is_file():
            raise FileNotFoundError(f"artifact does not exist: {source}")
        if source.stat().st_size > maximum_bytes:
            raise ValueError("artifact exceeds the worker download limit")
        shutil.copyfile(source, destination)
    elif parsed.scheme in {"http", "https"}:
        request = urllib.request.Request(
            uri,
            headers={"User-Agent": "alchemy-research-worker/0.1"},
            method="GET",
        )
        written = 0
        with urllib.request.urlopen(request, timeout=60) as response:
            declared = response.headers.get("Content-Length")
            if declared is not None and int(declared) > maximum_bytes:
                raise ValueError("artifact exceeds the worker download limit")
            with destination.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > maximum_bytes:
                        raise ValueError("artifact exceeds the worker download limit")
                    handle.write(chunk)
    else:
        raise ValueError(
            "research workers accept only file:// and http(s):// artifacts"
        )

    verify_artifact(destination, artifact)
    return destination
