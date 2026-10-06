from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv

from vax_pricing.config import RAG_STRUCTURED_DIR, RAG_VECTOR_DIR, ROOT


MAX_INPUT_TOKEN_CEILING = 3000
MAX_OUTPUT_TOKEN_CEILING = 300
DAILY_TOKEN_CEILING = 85000
DAILY_REQUEST_CEILING = 25
EMBEDDING_DAILY_TOKEN_CEILING = 5000
EMBEDDING_DAILY_REQUEST_CEILING = 30


def _as_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} debe ser un número entero.") from exc


def _as_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} debe ser numérico.") from exc


def _bounded_positive_int(name: str, default: int, ceiling: int) -> int:
    value = _as_int(name, default)
    if value <= 0:
        raise ValueError(f"{name} debe ser mayor que cero.")
    return min(value, ceiling)


@dataclass(frozen=True)
class CopilotSettings:
    enabled: bool
    api_key: str | None
    model_test: str
    model_target: str
    model_phase: str
    embedding_model: str
    semantic_search_enabled: bool
    timeout_seconds: float
    max_input_tokens: int
    max_output_tokens: int
    daily_token_limit: int
    daily_request_limit: int
    embedding_daily_token_limit: int
    embedding_daily_request_limit: int
    max_history_records: int
    max_route_summaries: int
    nearby_route_radius_km: float
    nearby_route_distance_tolerance_pct: float
    max_nearby_route_summaries: int
    regional_support_enabled: bool
    max_regional_route_summaries: int
    regional_cost_level_lower_pct: float
    regional_cost_level_higher_pct: float
    regional_min_trips_for_level: int
    max_documents: int
    structured_dir: Path
    vector_dir: Path
    usage_db_path: Path
    embedding_usage_db_path: Path

    @property
    def active_model(self) -> str:
        return self.model_target if self.model_phase == "target" else self.model_test

    @property
    def is_openai_configured(self) -> bool:
        return bool(self.enabled and self.api_key)

    @classmethod
    def from_env(cls) -> "CopilotSettings":
        load_dotenv(ROOT / ".env", override=False)
        phase = os.getenv("COPILOT_MODEL_PHASE", "test").strip().lower()
        if phase not in {"test", "target"}:
            raise ValueError("COPILOT_MODEL_PHASE debe ser 'test' o 'target'.")
        return cls(
            enabled=_as_bool(os.getenv("COPILOT_ENABLED"), False),
            api_key=os.getenv("OPENAI_API_KEY") or None,
            model_test=os.getenv("OPENAI_MODEL_TEST", "gpt-5.4-mini").strip(),
            model_target=os.getenv("OPENAI_MODEL_TARGET", "gpt-5.6-luna").strip(),
            model_phase=phase,
            embedding_model=os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small").strip(),
            semantic_search_enabled=_as_bool(os.getenv("COPILOT_SEMANTIC_SEARCH"), True),
            timeout_seconds=_as_float("COPILOT_TIMEOUT_SECONDS", 20.0),
            max_input_tokens=_bounded_positive_int(
                "COPILOT_MAX_INPUT_TOKENS", 3000, MAX_INPUT_TOKEN_CEILING
            ),
            max_output_tokens=_bounded_positive_int(
                "COPILOT_MAX_OUTPUT_TOKENS", 300, MAX_OUTPUT_TOKEN_CEILING
            ),
            daily_token_limit=_bounded_positive_int(
                "COPILOT_DAILY_TOKEN_LIMIT", 85000, DAILY_TOKEN_CEILING
            ),
            daily_request_limit=_bounded_positive_int(
                "COPILOT_DAILY_REQUEST_LIMIT", 25, DAILY_REQUEST_CEILING
            ),
            embedding_daily_token_limit=_bounded_positive_int(
                "COPILOT_EMBEDDING_DAILY_TOKEN_LIMIT",
                5000,
                EMBEDDING_DAILY_TOKEN_CEILING,
            ),
            embedding_daily_request_limit=_bounded_positive_int(
                "COPILOT_EMBEDDING_DAILY_REQUEST_LIMIT",
                30,
                EMBEDDING_DAILY_REQUEST_CEILING,
            ),
            max_history_records=_as_int("COPILOT_MAX_HISTORY_RECORDS", 8),
            max_route_summaries=_as_int("COPILOT_MAX_ROUTE_SUMMARIES", 3),
            nearby_route_radius_km=_as_float(
                "COPILOT_NEARBY_ROUTE_RADIUS_KM", 30.0
            ),
            nearby_route_distance_tolerance_pct=_as_float(
                "COPILOT_NEARBY_ROUTE_DISTANCE_TOLERANCE_PCT", 20.0
            ),
            max_nearby_route_summaries=_as_int(
                "COPILOT_MAX_NEARBY_ROUTE_SUMMARIES", 5
            ),
            regional_support_enabled=_as_bool(
                os.getenv("COPILOT_REGIONAL_SUPPORT_ENABLED"), True
            ),
            max_regional_route_summaries=_as_int(
                "COPILOT_MAX_REGIONAL_ROUTE_SUMMARIES", 3
            ),
            regional_cost_level_lower_pct=_as_float(
                "COPILOT_REGIONAL_COST_LEVEL_LOWER_PCT", -10.0
            ),
            regional_cost_level_higher_pct=_as_float(
                "COPILOT_REGIONAL_COST_LEVEL_HIGHER_PCT", 10.0
            ),
            regional_min_trips_for_level=_as_int(
                "COPILOT_REGIONAL_MIN_TRIPS_FOR_LEVEL", 3
            ),
            max_documents=_as_int("COPILOT_MAX_DOCUMENTS", 4),
            structured_dir=RAG_STRUCTURED_DIR,
            vector_dir=RAG_VECTOR_DIR,
            usage_db_path=ROOT / "rag" / "runtime" / "copilot_usage.sqlite3",
            embedding_usage_db_path=(
                ROOT / "rag" / "runtime" / "embedding_query_usage.sqlite3"
            ),
        )
