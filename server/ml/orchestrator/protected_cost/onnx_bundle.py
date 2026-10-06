"""Rebuild inference bundles from language-neutral JSON and ONNX artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort


ROOT = Path(__file__).resolve().parents[1]


class OnnxRegressor:
    """Adapter exposing the ``predict`` method expected by the pipelines."""

    def __init__(self, model_path: Path) -> None:
        self.model_path = Path(model_path)
        self._session: ort.InferenceSession | None = None

    def _get_session(self) -> ort.InferenceSession:
        if self._session is None:
            self._session = ort.InferenceSession(
                str(self.model_path), providers=["CPUExecutionProvider"]
            )
        return self._session

    def predict(self, features: Any) -> np.ndarray:
        session = self._get_session()
        values = features.to_numpy() if hasattr(features, "to_numpy") else np.asarray(features)
        values = np.asarray(values, dtype=np.float32)
        outputs = session.run(None, {session.get_inputs()[0].name: values})
        return np.asarray(outputs[0], dtype=float).reshape(-1)


class KMeansRuntime:
    """Portable inference-only equivalent of ``sklearn.cluster.KMeans``."""

    def __init__(self, centers: Any) -> None:
        self.cluster_centers_ = np.asarray(centers, dtype=float)

    def predict(self, features: Any) -> np.ndarray:
        values = features.to_numpy() if hasattr(features, "to_numpy") else np.asarray(features)
        values = np.asarray(values, dtype=float)
        distances = ((values[:, None, :] - self.cluster_centers_[None, :, :]) ** 2).sum(axis=2)
        return distances.argmin(axis=1)


def _decode(value: Any) -> Any:
    if isinstance(value, list):
        return [_decode(item) for item in value]
    if not isinstance(value, dict):
        return value

    kind = value.get("__type__")
    if kind == "onnx_regressor":
        return OnnxRegressor(ROOT / "artifacts" / value["file"])
    if kind == "kmeans":
        return KMeansRuntime(value["cluster_centers"])
    if kind == "ndarray":
        return np.asarray(value["values"], dtype=value.get("dtype"))
    if kind == "tuple":
        return tuple(_decode(item) for item in value["items"])
    if kind == "set":
        return set(_decode(item) for item in value["items"])
    if kind == "dict_items":
        return {_decode(item[0]): _decode(item[1]) for item in value["items"]}
    if kind == "path":
        return Path(value["value"])
    return {key: _decode(item) for key, item in value.items()}


def load_bundle(name: str) -> dict[str, Any]:
    """Load one exported state and attach its ONNX Runtime model adapters."""
    state_path = ROOT / "artifacts" / "states" / f"{name}.json"
    with state_path.open("r", encoding="utf-8") as handle:
        return _decode(json.load(handle))
