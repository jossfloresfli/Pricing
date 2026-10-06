from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
import json
import math
from typing import Any

from .budget import InputTokenLimitError


REQUEST_OVERHEAD_TOKENS = 160


@lru_cache(maxsize=8)
def _encoding_for_model(model: str) -> Any | None:
    try:
        import tiktoken

        try:
            return tiktoken.encoding_for_model(model)
        except KeyError:
            return tiktoken.get_encoding("o200k_base")
    except Exception:
        return None


def count_tokens(text: str, model: str) -> int:
    """Cuenta tokens con una estimación conservadora adicional por bytes."""

    encoding = _encoding_for_model(model)
    # El contador por bytes sigue siendo conservador y evita depender de red
    # cuando tiktoken todavía no ha descargado su vocabulario local.
    encoded_count = len(encoding.encode(text)) if encoding is not None else 0
    byte_estimate = math.ceil(len(text.encode("utf-8")) / 3)
    return max(encoded_count, byte_estimate)


def render_user_content(evidence_blocks: dict[str, Any]) -> str:
    return (
        "Explica la cotización usando estos cuatro bloques JSON. "
        "No uses información externa.\n"
        + json.dumps(
            evidence_blocks,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
    )


def estimate_input_tokens(
    *,
    system_prompt: str,
    user_content: str,
    schema: dict[str, Any],
    model: str,
) -> int:
    schema_text = json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
    return (
        count_tokens(system_prompt, model)
        + count_tokens(user_content, model)
        + count_tokens(schema_text, model)
        + REQUEST_OVERHEAD_TOKENS
    )


@dataclass(frozen=True)
class PreparedEvidence:
    blocks: dict[str, Any]
    user_content: str
    estimated_input_tokens: int
    evidence_ids: frozenset[str]


def _evidence_ids(blocks: dict[str, Any]) -> frozenset[str]:
    identifiers: set[str] = set()
    historical = blocks.get("historical_support", {})
    for record in historical.get("route_summaries", []):
        evidence_id = record.get("evidence_id")
        if evidence_id:
            identifiers.add(str(evidence_id))
    for record in historical.get("reference_records", []):
        evidence_id = record.get("evidence_id")
        if evidence_id:
            identifiers.add(str(evidence_id))
    for record in historical.get("nearby_routes", {}).get("route_summaries", []):
        evidence_id = record.get("evidence_id")
        if evidence_id:
            identifiers.add(str(evidence_id))
    for record in historical.get("regional_support", {}).get("route_summaries", []):
        evidence_id = record.get("evidence_id")
        if evidence_id:
            identifiers.add(str(evidence_id))
    for record in blocks.get("documentary_context", []):
        evidence_id = record.get("evidence_id")
        if evidence_id:
            identifiers.add(str(evidence_id))
    return frozenset(identifiers)


def prepare_evidence(
    evidence_blocks: dict[str, Any],
    *,
    system_prompt: str,
    schema: dict[str, Any],
    model: str,
    max_input_tokens: int,
) -> PreparedEvidence:
    if max_input_tokens <= 0:
        raise ValueError("COPILOT_MAX_INPUT_TOKENS debe ser positivo.")
    blocks = deepcopy(evidence_blocks)

    def render() -> tuple[str, int]:
        content = render_user_content(blocks)
        estimate = estimate_input_tokens(
            system_prompt=system_prompt,
            user_content=content,
            schema=schema,
            model=model,
        )
        return content, estimate

    user_content, estimate = render()
    documents = blocks.get("documentary_context", [])
    route_summaries = blocks.get("historical_support", {}).get(
        "route_summaries", []
    )
    reference_records = blocks.get("historical_support", {}).get(
        "reference_records", []
    )
    nearby_route_summaries = (
        blocks.get("historical_support", {})
        .get("nearby_routes", {})
        .get("route_summaries", [])
    )

    regional_route_summaries = (
        blocks.get("historical_support", {})
        .get("regional_support", {})
        .get("route_summaries", [])
    )

    # La recuperación ordena por relevancia; los últimos elementos salen primero.
    # Prioridad de recorte: documentos -> regional -> exacta -> cercanas -> folios.
    while estimate > max_input_tokens and len(documents) > 1:
        documents.pop()
        user_content, estimate = render()
    while estimate > max_input_tokens and regional_route_summaries:
        regional_route_summaries.pop()
        user_content, estimate = render()
    while estimate > max_input_tokens and len(route_summaries) > 1:
        route_summaries.pop()
        user_content, estimate = render()
    while estimate > max_input_tokens and len(nearby_route_summaries) > 1:
        nearby_route_summaries.pop()
        user_content, estimate = render()
    while estimate > max_input_tokens and len(reference_records) > 2:
        reference_records.pop()
        user_content, estimate = render()
    while estimate > max_input_tokens and documents:
        documents.pop()
        user_content, estimate = render()
    while estimate > max_input_tokens and route_summaries:
        route_summaries.pop()
        user_content, estimate = render()
    while estimate > max_input_tokens and nearby_route_summaries:
        nearby_route_summaries.pop()
        user_content, estimate = render()
    while estimate > max_input_tokens and reference_records:
        reference_records.pop()
        user_content, estimate = render()

    if estimate > max_input_tokens:
        raise InputTokenLimitError(
            "La solicitud mínima del copiloto excede el límite local de entrada."
        )
    return PreparedEvidence(
        blocks=blocks,
        user_content=user_content,
        estimated_input_tokens=estimate,
        evidence_ids=_evidence_ids(blocks),
    )
