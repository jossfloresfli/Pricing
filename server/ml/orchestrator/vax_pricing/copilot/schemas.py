from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CopilotStatus(str, Enum):
    GROUNDED = "grounded"
    LIMITED_EVIDENCE = "limited_evidence"
    UNAVAILABLE = "unavailable"


class ComparisonBasis(str, Enum):
    SAME_ROUTE_EQUIPMENT = "same_route_equipment"
    SAME_ROUTE = "same_route"
    COMPARABLE_ROUTES = "comparable_routes"
    NONE = "none"


class MoneyRange(BaseModel):
    low: float | None = None
    usual: float | None = None
    high: float | None = None


class MarginSummary(BaseModel):
    usual_amount: float | None = None
    usual_percentage: float | None = None
    negative_record_count: int = 0


class HistoricalRouteSummary(BaseModel):
    evidence_id: str
    origin: str
    destination: str
    division: str
    equipment: str
    service_type: str | None = None
    operational_category: str | None = None
    flow: str | None = None
    currency: str
    shipment_count: int
    sale_margin_record_count: int
    cost: MoneyRange
    all_in_rate_sale: MoneyRange
    margin: MarginSummary
    latest_available_at: datetime | None = None


class HistoricalRecord(BaseModel):
    evidence_id: str
    carrier: str | None = None
    shipment_date: datetime | None = None
    origin: str
    destination: str
    division: str
    equipment: str
    service_type: str | None = None
    operational_category: str | None = None
    flow: str | None = None
    distance_km: float | None = None
    currency: str
    cost: float
    all_in_rate_sale: float | None = None
    margin_amount: float | None = None
    margin_percentage: float | None = None
    has_negative_margin: bool = False


class CarrierRouteSummary(BaseModel):
    carrier: str
    origin: str
    destination: str
    division: str
    equipment: str
    service_type: str | None = None
    currency: str
    shipment_count: int
    sale_margin_record_count: int
    reference_ids: list[str] = Field(default_factory=list, max_length=5)
    cost: MoneyRange
    all_in_rate_sale: MoneyRange
    margin: MarginSummary
    latest_available_at: datetime | None = None


class NearbyHistoricalRouteSummary(HistoricalRouteSummary):
    origin_distance_km: float
    destination_distance_km: float
    route_distance_difference_pct: float | None = None
    carriers: list[CarrierRouteSummary] = Field(default_factory=list)


class NearbyHistoricalSupport(BaseModel):
    radius_km: float = 30.0
    route_count: int = 0
    comparable_count: int = 0
    history_window: Literal[
        "recent_6_months", "older_than_6_months", "none"
    ] = "none"
    older_history_fallback: bool = False
    routes: list[NearbyHistoricalRouteSummary] = Field(default_factory=list)
    message: str = (
        "No se encontraron rutas con origen y destino dentro del radio configurado."
    )


class RegionalRouteSummary(HistoricalRouteSummary):
    """Resumen por corredor dirigido (estados o regiones)."""

    origin_state: str
    destination_state: str
    origin_region_label: str | None = None
    destination_region_label: str | None = None
    regional_corridor: str | None = None
    comparison_level: Literal[
        "same_state_pair",
        "same_regional_corridor",
        "related_corridor",
        "comparable_distance_equipment",
    ]
    distance_km_min: float | None = None
    distance_km_max: float | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None
    reference_ids: list[str] = Field(default_factory=list, max_length=5)
    carriers: list[CarrierRouteSummary] = Field(default_factory=list)


class RegionalSupport(BaseModel):
    """Comparación regional (división National, segmentación congelada)."""

    status: Literal["applicable", "not_applicable", "unavailable"] = (
        "not_applicable"
    )
    reason: str | None = None
    comparison_level: Literal[
        "same_state_pair",
        "same_regional_corridor",
        "related_corridor",
        "comparable_distance_equipment",
        "none",
    ] = "none"
    used_by_selected_cost: bool = False
    origin_state: str | None = None
    destination_state: str | None = None
    origin_region_label: str | None = None
    destination_region_label: str | None = None
    regional_corridor: str | None = None
    route_count: int = 0
    comparable_count: int = 0
    carrier_count: int = 0
    negative_margin_count: int = 0
    latest_available_at: datetime | None = None
    history_window: Literal[
        "recent_6_months", "older_than_6_months", "none"
    ] = "none"
    older_history_fallback: bool = False
    regional_cost_level: Literal[
        "lower", "similar", "higher", "insufficient_evidence", "not_evaluated"
    ] = "not_evaluated"
    related_corridors_enabled: bool = False
    model_version: str | None = None
    artifact_checksum: str | None = None
    routes: list[RegionalRouteSummary] = Field(default_factory=list)
    message: str = (
        "La comparación regional no aplica para esta cotización."
    )


class HistoricalTrend(BaseModel):
    period_start: datetime | None = None
    period_end: datetime | None = None
    cost_change_amount: float | None = None
    cost_change_percentage: float | None = None
    sale_change_amount: float | None = None
    sale_change_percentage: float | None = None
    margin_change_percentage_points: float | None = None
    message: str


class HistoricalSupport(BaseModel):
    comparison_basis: ComparisonBasis = ComparisonBasis.NONE
    comparable_count: int = 0
    cost_record_count: int = 0
    sale_margin_record_count: int = 0
    carrier_count: int = 0
    routes: list[HistoricalRouteSummary] = Field(default_factory=list)
    carriers: list[CarrierRouteSummary] = Field(default_factory=list)
    records: list[HistoricalRecord] = Field(default_factory=list)
    latest_available_at: datetime | None = None
    history_window: Literal[
        "recent_6_months", "older_than_6_months", "none"
    ] = "none"
    window_start_at: datetime | None = None
    older_history_fallback: bool = False
    fluctuation: HistoricalTrend | None = None
    nearby_routes: NearbyHistoricalSupport = Field(
        default_factory=NearbyHistoricalSupport
    )
    regional_support: RegionalSupport = Field(default_factory=RegionalSupport)
    message: str = "No se encontraron viajes anteriores comparables."


class Citation(BaseModel):
    evidence_id: str
    type: Literal[
        "historical_record",
        "historical_summary",
        "policy",
        "toll_rate",
        "document",
    ]
    title: str
    source: str
    excerpt: str
    url: str | None = None
    verified_at: str | None = None
    is_stale: bool = False


class TokenUsage(BaseModel):
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0


class CopilotResponse(BaseModel):
    status: CopilotStatus
    answer: str
    historical_support: HistoricalSupport
    citations: list[Citation] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    model: str
    model_phase: Literal["test", "target"]
    prompt_version: str
    index_version: str
    usage: TokenUsage = Field(default_factory=TokenUsage)


class GeneratedCopilotAnswer(BaseModel):
    """Contrato que debe producir el modelo; las citas se resuelven en el backend."""

    model_config = ConfigDict(extra="forbid")

    evidence_status: Literal["grounded", "limited_evidence"]
    answer: str = Field(min_length=1, max_length=1200)
    evidence_ids: list[str] = Field(max_length=6)
    limitations: list[str] = Field(max_length=3)


class GeoInput(BaseModel):
    origin_lat: float | None = None
    origin_lng: float | None = None
    destination_lat: float | None = None
    destination_lng: float | None = None
    origin_elevation_m: float | None = None
    destination_elevation_m: float | None = None


class UsdDisplay(BaseModel):
    """Presentación en USD para divisiones que se cotizan en dólares.

    La recuperación histórica sigue operando en MXN; este campo sólo indica
    que toda la salida (evidencia, tablas y texto) debe mostrarse en USD.
    """

    rate: float = Field(gt=0)


class QuoteRequest(BaseModel):
    quote_id: str = Field(default_factory=lambda: f"Q-{uuid4().hex[:12]}")
    quote_row_id: str | None = None
    currency: str = "MXN"
    origin: str = Field(min_length=2)
    destination: str = Field(min_length=2)
    equipment: str = Field(min_length=1)
    division: str = Field(min_length=1)
    flow: str | None = None
    client: str | None = None
    provider: str | None = None
    service_range: str | None = None
    distance_km: float | None = Field(default=None, gt=0)
    target_margin_pct: float = Field(default=18.0, ge=0, lt=95)
    all_in_rate_sale: float | None = Field(default=None, gt=0)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    geo: GeoInput | None = None
    usd_display: UsdDisplay | None = None

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized != "MXN":
            raise ValueError("El cotizador experimental sólo admite MXN.")
        return normalized

    @field_validator("created_at")
    @classmethod
    def ensure_timezone(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


class PricingModelResult(BaseModel):
    key: str
    label: str
    role: str
    selected: bool = False
    available: bool = False
    prediction: float | None = None
    all_in_rate_sale: float | None = None
    margin_amount: float | None = None
    margin_percentage: float | None = None


class RouteResolutionInfo(BaseModel):
    route_key: str
    source: Literal["cache", "google_maps", "request"]
    distance_km: float
    duration_seconds: float | None = None
    origin_lat: float | None = None
    origin_lng: float | None = None
    destination_lat: float | None = None
    destination_lng: float | None = None
    origin_elevation_m: float | None = None
    destination_elevation_m: float | None = None
    updated_at: str | None = None


class RegionalPricingContext(BaseModel):
    model_version: str
    region_count: int
    origin_region: str
    destination_region: str
    regional_corridor: str
    used_by_selected_cost: bool
    relevance: str
    boundary_note: str


class PricingResult(BaseModel):
    quote_id: str
    currency: str
    selected_cost: float
    all_in_rate_sale: float
    margin_amount: float
    margin_percentage: float
    selected_model: str
    models: list[PricingModelResult] = Field(default_factory=list)
    inference_runtime: Literal["onnx", "joblib", "unknown"] = "unknown"
    model_artifact_format: str | None = None
    route_resolution: RouteResolutionInfo | None = None
    regional_context: RegionalPricingContext | None = None
    base_cost: float | None = None
    protection_amount: float | None = None
    protection_applied: bool = False
    market_review_required: bool = True
    strict_review_required: bool = False
    policy_version: str | None = None
    review_required: bool
    decision_blocked: bool
    route_history_count: int
    history_level: str
    reasons: list[str] = Field(default_factory=list)
    guardrail_reasons: list[str] = Field(default_factory=list)
    action: str


class QuoteResponse(BaseModel):
    pricing: PricingResult


class CopilotExplainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    quote_id: str = Field(min_length=1, max_length=100)
    model_key: str = Field(min_length=1, max_length=100)


class CopilotExplainResponse(BaseModel):
    copilot: CopilotResponse


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    pricing: dict[str, Any]
    copilot: dict[str, Any]
