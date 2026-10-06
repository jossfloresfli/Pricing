from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from .budget import UsageBudget
from .token_limits import count_tokens


class OpenAISemanticRanker:
    """Compara una consulta contra embeddings documentales generados offline."""

    def __init__(
        self,
        *,
        client: Any,
        model: str,
        vectors_path: Path,
        metadata_path: Path,
        budget: UsageBudget,
    ) -> None:
        if not vectors_path.exists() or not metadata_path.exists():
            raise FileNotFoundError("Falta el índice semántico documental.")
        vectors = np.load(vectors_path)["vectors"].astype(np.float32)
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        evidence_ids = [str(value) for value in metadata["evidence_ids"]]
        if len(evidence_ids) != len(vectors):
            raise ValueError("Los vectores y sus identificadores no tienen la misma longitud.")
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        self._vectors = vectors / np.maximum(norms, 1e-12)
        self._evidence_ids = evidence_ids
        self._client = client
        self._model = model
        self.budget = budget

    def rank(self, query: str, *, limit: int) -> list[str]:
        estimated_tokens = max(1, count_tokens(query, self._model))
        reservation = self.budget.reserve(
            estimated_input_tokens=estimated_tokens,
            max_output_tokens=1,
        )
        try:
            response = self._client.embeddings.create(model=self._model, input=query)
        except Exception:
            self.budget.fail(reservation)
            raise
        usage = getattr(response, "usage", None)
        actual_tokens = int(
            getattr(usage, "prompt_tokens", 0)
            or getattr(usage, "total_tokens", 0)
            or estimated_tokens
        )
        self.budget.settle(
            reservation,
            input_tokens=actual_tokens,
            output_tokens=0,
        )
        query_vector = np.asarray(response.data[0].embedding, dtype=np.float32)
        query_vector /= max(float(np.linalg.norm(query_vector)), 1e-12)
        scores = self._vectors @ query_vector
        indices = np.argsort(-scores, kind="stable")[:limit]
        return [self._evidence_ids[int(index)] for index in indices]
