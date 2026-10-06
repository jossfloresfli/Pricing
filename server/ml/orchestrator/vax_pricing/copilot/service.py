from __future__ import annotations

from datetime import datetime
from hashlib import sha256
import json
import math
from pathlib import Path
from typing import Any

from vax_pricing.config import PROCESSED_DIR
from protected_cost.preprocessing import canonicalize_location

from .budget import CopilotLimitError, UsageBudget
from .embeddings import OpenAISemanticRanker
from .history import HistoricalQuery, HistoricalRepository
from .openai_client import CopilotGenerator, OpenAICopilotGenerator
from .regional import (
    RegionalSegmentation,
    assignments_status,
    corpus_fingerprint,
    load_region_labels,
    load_related_corridors,
    regenerate_assignments,
)
from .retrieval import DocumentRepository
from .schemas import (
    Citation,
    CopilotResponse,
    CopilotStatus,
    HistoricalSupport,
    PricingResult,
    QuoteRequest,
    TokenUsage,
)
from .settings import CopilotSettings
from .budget import CopilotLimitError, UsageBudget, create_usage_budget

PROMPT_VERSION = "vax-price-explainer-v7-usd-display"

# Claves cuyos valores numéricos representan dinero en la evidencia y los
# bloques del prompt. La conversión a USD es puramente de presentación: la
# recuperación, los filtros y la clasificación de costo operan en MXN.
_USD_MONEY_KEYS = frozenset(
    {
        "cost",
        "all_in_rate_sale",
        "margin_amount",
        "usual_amount",
        "low",
        "usual",
        "high",
        "cost_low",
        "cost_usual",
        "cost_high",
        "sale_all_in_low",
        "sale_all_in_usual",
        "sale_all_in_high",
        "sale_all_in",
        "margin_usual_amount",
        "cost_change_amount",
        "sale_change_amount",
        "selected_cost",
        "base_cost",
        "protection_amount",
        "prediction",
    }
)


def convert_money_to_usd(node: Any, rate: float) -> Any:
    """Convierte recursivamente montos MXN a USD y marca currency='USD'."""

    if isinstance(node, dict):
        converted: dict[str, Any] = {}
        for key, value in node.items():
            if key == "currency" and isinstance(value, str) and value:
                converted[key] = "USD"
            elif (
                key in _USD_MONEY_KEYS
                and isinstance(value, (int, float))
                and not isinstance(value, bool)
            ):
                converted[key] = round(float(value) * rate, 2)
            else:
                converted[key] = convert_money_to_usd(value, rate)
        return converted
    if isinstance(node, list):
        return [convert_money_to_usd(item, rate) for item in node]
    return node

# Claves de modelo que corresponden al modelo regional National Geo en la
# trazabilidad del cotizador. used_by_selected_cost sólo puede venir de aquí,
# nunca deducirse de la evidencia recuperada.
GEO_MODEL_KEYS = frozenset({"ajustada", "national_geo", "national_geo_mxn", "geo"})
FORBIDDEN_OUTPUT_TERMS = ("accesorial", "accessorial")


def _manifest_version(path: Path) -> str:
    if not path.exists():
        return "missing"
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    return f"{payload.get('schema_version', 'unknown')}@{payload.get('built_at', 'unknown')}"


def _semantic_index_matches(
    *,
    document_path: Path,
    vectors_path: Path,
    metadata_path: Path,
) -> bool:
    if not document_path.exists() or not vectors_path.exists() or not metadata_path.exists():
        return False
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return False
    return metadata.get("source_sha256") == sha256(document_path.read_bytes()).hexdigest()


class PriceCopilotService:
    def __init__(
        self,
        *,
        settings: CopilotSettings,
        history: HistoricalRepository,
        documents: DocumentRepository,
        generator: CopilotGenerator | None,
        index_version: str,
        regional_assignments_state: str = "unknown",
    ) -> None:
        self.settings = settings
        self.history = history
        self.documents = documents
        self.generator = generator
        self.index_version = index_version
        self.regional_assignments_state = regional_assignments_state

    @classmethod
    def from_settings(
        cls, settings: CopilotSettings | None = None
    ) -> "PriceCopilotService":
        settings = settings or CopilotSettings.from_env()
        generator: OpenAICopilotGenerator | None = None
        semantic_ranker = None
        if settings.is_openai_configured:
            generator = OpenAICopilotGenerator(settings)
            vectors_path = settings.vector_dir / "document_embeddings.npz"
            metadata_path = settings.vector_dir / "document_embeddings.json"
            document_path = settings.structured_dir / "document_chunks.jsonl"
            if (
                settings.semantic_search_enabled
                and _semantic_index_matches(
                    document_path=document_path,
                    vectors_path=vectors_path,
                    metadata_path=metadata_path,
                )
            ):
                semantic_ranker = OpenAISemanticRanker(
                    client=generator.client,
                    model=settings.embedding_model,
                    vectors_path=vectors_path,
                    metadata_path=metadata_path,
                    budget=create_usage_budget(
                        sqlite_path=settings.embedding_usage_db_path,
                        scope="embedding",
                        daily_token_limit=settings.embedding_daily_token_limit,
                        daily_request_limit=settings.embedding_daily_request_limit,
                    ),
                )
        regional_segmentation = None
        regional_assignments_state = "disabled"
        if settings.regional_support_enabled:
            root_dir = settings.structured_dir.parent.parent
            artifacts_dir = root_dir / "artifacts"
            manifest_path = (
                settings.structured_dir / "regional_assignments_manifest.json"
            )
            # Verificación de desfase: si el corpus histórico o el caché de
            # rutas cambió desde la última derivación, se regenera la capa
            # con el script offline oficial; si falla, se conserva la capa
            # existente y el estado queda visible en /health.
            fingerprint = corpus_fingerprint(
                settings.structured_dir / "historical_loads.jsonl",
                PROCESSED_DIR / "google_maps_route_cache.csv",
            )
            regional_assignments_state = assignments_status(
                manifest_path, fingerprint
            )
            if regional_assignments_state in ("missing", "stale"):
                if regenerate_assignments(root_dir):
                    refreshed = assignments_status(manifest_path, fingerprint)
                    regional_assignments_state = (
                        "regenerated" if refreshed == "fresh" else refreshed
                    )
                else:
                    regional_assignments_state = (
                        f"{regional_assignments_state}_regeneration_failed"
                    )
            regional_segmentation = RegionalSegmentation.load(
                artifacts_dir,
                region_labels=load_region_labels(manifest_path),
            )
        # Catálogo aprobado de corredores relacionados (dirigidos). Sin
        # archivo aprobado el nivel queda deshabilitado; nunca se inventan
        # relaciones.
        related_corridors = load_related_corridors(
            settings.structured_dir / "related_corridors.json"
        )
        history = HistoricalRepository(
            settings.structured_dir / "historical_loads.jsonl",
            route_cache_path=PROCESSED_DIR / "google_maps_route_cache.csv",
            regional_assignments_path=(
                settings.structured_dir / "regional_assignments.jsonl"
            ),
            regional_segmentation=regional_segmentation,
            related_corridors=related_corridors,
            max_regional_route_summaries=settings.max_regional_route_summaries,
            regional_cost_level_lower_pct=settings.regional_cost_level_lower_pct,
            regional_cost_level_higher_pct=settings.regional_cost_level_higher_pct,
            regional_min_trips_for_level=settings.regional_min_trips_for_level,
            max_records=settings.max_history_records,
            max_route_summaries=settings.max_route_summaries,
            nearby_radius_km=settings.nearby_route_radius_km,
            nearby_distance_tolerance_pct=(
                settings.nearby_route_distance_tolerance_pct
            ),
            max_nearby_route_summaries=settings.max_nearby_route_summaries,
        )
        documents = DocumentRepository(
            settings.structured_dir / "document_chunks.jsonl",
            semantic_ranker=semantic_ranker,
            max_documents=settings.max_documents,
        )
        return cls(
            settings=settings,
            history=history,
            documents=documents,
            generator=generator,
            index_version=_manifest_version(settings.structured_dir / "manifest.json"),
            regional_assignments_state=regional_assignments_state,
        )

    def health(self) -> dict[str, Any]:
        budget = getattr(self.generator, "budget", None)
        budget_status = {
            "scope": "per_user",
            "requests_limit": self.settings.daily_request_limit,
            "tokens_limit": self.settings.daily_token_limit,
            "status": (
                "requires_authenticated_subject"
                if budget is not None
                else "inactive"
            ),
        }
        return {
            "enabled": self.settings.enabled,
            "configured": self.settings.is_openai_configured,
            "available": bool(
                self.settings.is_openai_configured and self.generator is not None
            ),
            "model": self.settings.active_model,
            "model_phase": self.settings.model_phase,
            "prompt_version": PROMPT_VERSION,
            "index_version": self.index_version,
            "historical_records": self.history.record_count,
            "nearby_routes": {
                "radius_km": self.settings.nearby_route_radius_km,
                "route_distance_tolerance_pct": (
                    self.settings.nearby_route_distance_tolerance_pct
                ),
                "max_route_summaries": self.settings.max_nearby_route_summaries,
                "coordinate_source": "google_maps_route_cache",
            },
            "regional_support": {
                "enabled": self.settings.regional_support_enabled,
                "available": self.history.regional_available,
                "max_route_summaries": self.settings.max_regional_route_summaries,
                "related_corridor_catalog": (
                    "approved_catalog_loaded_"
                    f"{len(self.history.related_corridors)}_corridors"
                    if getattr(self.history, "related_corridors", None)
                    else "disabled_no_approved_catalog"
                ),
                "regional_cost_level_thresholds": {
                    "lower_pct": self.settings.regional_cost_level_lower_pct,
                    "higher_pct": self.settings.regional_cost_level_higher_pct,
                    "min_trips_for_level": (
                        self.settings.regional_min_trips_for_level
                    ),
                },
                "assignments_status": self.regional_assignments_state,
            },
            "document_chunks": self.documents.record_count,
            "semantic_search": (
                "openai_embeddings"
                if self.documents.semantic_available
                else "local_hybrid_fallback"
            ),
            "embedding_model": self.settings.embedding_model,
            "limits": {
                "max_input_tokens": self.settings.max_input_tokens,
                "max_output_tokens": self.settings.max_output_tokens,
                "automatic_retries": 0,
                "daily_budget": budget_status,
                "semantic_query_budget": (
                    self.documents.semantic_budget_snapshot
                    or {
                        "requests_limit": self.settings.embedding_daily_request_limit,
                        "tokens_limit": self.settings.embedding_daily_token_limit,
                        "status": "inactive",
                    }
                ),
            },
        }

    def budget_snapshot(self, *, budget_subject: str) -> dict[str, int | str]:
        """Devuelve la cuota del usuario autenticado sin exponer su identidad."""
        budget = getattr(self.generator, "budget", None)
        if budget is None:
            return {
                "scope": "per_user",
                "requests_limit": self.settings.daily_request_limit,
                "tokens_limit": self.settings.daily_token_limit,
                "status": "inactive",
            }
        return budget.snapshot(budget_subject)

    @staticmethod
    def _document_query(request: QuoteRequest, pricing: PricingResult) -> str:
        values = [
            request.origin,
            request.destination,
            request.equipment,
            request.division,
            request.flow or "",
            request.service_range or "",
            *pricing.reasons,
            *pricing.guardrail_reasons,
        ]
        if pricing.regional_context is not None:
            values.extend(
                [
                    "segmentación regional National Geo",
                    pricing.regional_context.origin_region,
                    pricing.regional_context.destination_region,
                    pricing.regional_context.regional_corridor,
                ]
            )
        return " ".join(value for value in values if value)

    def explain(
        self,
        request: QuoteRequest,
        pricing: PricingResult,
        *,
        budget_subject: str,
    ) -> CopilotResponse:
        route_resolution = pricing.route_resolution
        request_geo = request.geo

        def coordinate(name: str) -> float | None:
            requested = getattr(request_geo, name, None) if request_geo else None
            if requested is not None:
                return requested
            return getattr(route_resolution, name, None) if route_resolution else None

        # Las ubicaciones pueden llegar en formato Google Maps ("Tonalá, Jal.,
        # México"); el historial usa "ciudad, estado completo". Sin canonizar,
        # rutas con historial real aparecían como "sin historial propio".
        canonical_origin = canonicalize_location(request.origin) or request.origin
        canonical_destination = (
            canonicalize_location(request.destination) or request.destination
        )
        historical = self.history.search(
            HistoricalQuery(
                origin=canonical_origin,
                destination=canonical_destination,
                equipment=request.equipment,
                division=request.division,
                service_range=request.service_range,
                currency=request.currency,
                quote_created_at=request.created_at,
                distance_km=(
                    request.distance_km
                    or (
                        pricing.route_resolution.distance_km
                        if pricing.route_resolution
                        else None
                    )
                ),
                origin_lat=coordinate("origin_lat"),
                origin_lng=coordinate("origin_lng"),
                destination_lat=coordinate("destination_lat"),
                destination_lng=coordinate("destination_lng"),
                quoted_cost=(
                    pricing.selected_cost if pricing.selected_cost > 0 else None
                ),
            )
        )
        regional = historical.support.regional_support
        # used_by_selected_cost proviene EXCLUSIVAMENTE de la trazabilidad del
        # modelo seleccionado en el cotizador; nunca se deduce de la evidencia.
        used_by_selected_cost = False
        if pricing.regional_context is not None:
            used_by_selected_cost = pricing.regional_context.used_by_selected_cost
        else:
            # Doble condición de trazabilidad del cotizador (nunca de la
            # evidencia): la opción seleccionada es el modelo regional Y el
            # identificador interno del modelo seleccionado también lo indica.
            selected_model_name = (pricing.selected_model or "").strip().lower()
            selected_is_geo_option = any(
                model.selected and model.key.strip().lower() in GEO_MODEL_KEYS
                for model in pricing.models
            )
            used_by_selected_cost = selected_is_geo_option and (
                "geo" in selected_model_name or "ajustada" in selected_model_name
            )
        regional.used_by_selected_cost = used_by_selected_cost

        # Presentación en USD para divisiones que se cotizan en dólares
        # (Crossborder/Domestic): TODA la salida —evidencia, tablas y texto—
        # se muestra en USD. La recuperación y clasificación anteriores ya
        # ocurrieron en MXN.
        usd_rate = request.usd_display.rate if request.usd_display else None
        if usd_rate is not None:
            historical.support = HistoricalSupport.model_validate(
                convert_money_to_usd(
                    historical.support.model_dump(mode="json"), usd_rate
                )
            )
            historical.evidence = convert_money_to_usd(
                historical.evidence, usd_rate
            )
            regional = historical.support.regional_support

        warnings: list[str] = []
        if regional.status == "applicable" and regional.comparable_count:
            warnings.append(
                "La comparación regional es complementaria; no sustituye la "
                "ruta exacta ni la validación con el transportista."
            )
        if historical.support.comparable_count == 0:
            if historical.support.nearby_routes.comparable_count:
                warnings.append(
                    "No se encontró historial principal; las rutas cercanas se "
                    "muestran sólo como referencia secundaria."
                )
            else:
                warnings.append("No se encontraron viajes anteriores comparables.")
        document_result = self.documents.search(
            query=self._document_query(request, pricing),
            division=request.division,
            equipment=request.equipment,
            origin=request.origin,
            destination=request.destination,
            reasons=pricing.reasons + pricing.guardrail_reasons,
            at=request.created_at,
        )
        if not document_result.records:
            warnings.append("No se encontró documentación aplicable.")
        stale_count = sum(record["is_stale"] for record in document_result.records)
        if stale_count:
            warnings.append(
                f"{stale_count} fuente(s) recuperada(s) están vencidas y sólo "
                "pueden usarse como contexto histórico."
            )

        if self.generator is None:
            return CopilotResponse(
                status=CopilotStatus.UNAVAILABLE,
                answer=(
                    "El precio está disponible, pero el copiloto no está habilitado "
                    "o no tiene una clave de OpenAI configurada."
                ),
                historical_support=historical.support,
                warnings=warnings,
                model=self.settings.active_model,
                model_phase=self.settings.model_phase,
                prompt_version=PROMPT_VERSION,
                index_version=self.index_version,
                usage=TokenUsage(),
            )

        route_history_for_model = [
            item["prompt_payload"]
            for item in historical.evidence.values()
            if item.get("type") == "historical_summary"
            and item.get("prompt_payload", {}).get("comparison") != "nearby_routes"
        ]
        nearby_history_for_model = [
            item["prompt_payload"]
            for item in historical.evidence.values()
            if item.get("type") == "historical_summary"
            and item.get("prompt_payload", {}).get("comparison") == "nearby_routes"
        ]
        reference_history_for_model = [
            item["prompt_payload"]
            for item in historical.evidence.values()
            if item.get("type") == "historical_record"
        ]
        regional_history_for_model = [
            item["prompt_payload"]
            for item in historical.evidence.values()
            if item.get("type") == "historical_summary"
            and str(
                item.get("prompt_payload", {}).get("comparison", "")
            ).startswith("regional_")
        ]
        route_history_for_model = [
            record
            for record in route_history_for_model
            if not str(record.get("comparison", "")).startswith("regional_")
        ]
        evidence_blocks = {
            "request": {
                "origin": request.origin,
                "destination": request.destination,
                "equipment": request.equipment,
                "division": request.division,
                "flow": request.flow,
                "service_type": request.service_range,
                "currency": request.currency,
                "distance_km": (
                    request.distance_km
                    or (
                        pricing.route_resolution.distance_km
                        if pricing.route_resolution
                        else None
                    )
                ),
            },
            "pricing_result": {
                "selected_cost": pricing.selected_cost,
                "all_in_rate_sale": pricing.all_in_rate_sale,
                "margin_amount": pricing.margin_amount,
                "margin_percentage": pricing.margin_percentage,
                "model": pricing.selected_model,
                "base_cost": pricing.base_cost,
                "protection_amount": pricing.protection_amount,
                "protection_applied": pricing.protection_applied,
                "review_required": pricing.review_required,
                "reasons": pricing.reasons,
                "guardrail_reasons": pricing.guardrail_reasons,
                "action": pricing.action,
                "regional_context": (
                    pricing.regional_context.model_dump(mode="json")
                    if pricing.regional_context
                    else None
                ),
            },
            "historical_support": {
                "comparison_basis": historical.support.comparison_basis.value,
                "comparable_count": historical.support.comparable_count,
                "history_window": historical.support.history_window,
                "older_history_fallback": historical.support.older_history_fallback,
                "message": historical.support.message,
                "fluctuation": (
                    historical.support.fluctuation.model_dump(mode="json")
                    if historical.support.fluctuation
                    else None
                ),
                "route_summaries": route_history_for_model,
                "nearby_routes": {
                    "radius_km": historical.support.nearby_routes.radius_km,
                    "route_count": historical.support.nearby_routes.route_count,
                    "comparable_count": (
                        historical.support.nearby_routes.comparable_count
                    ),
                    "history_window": (
                        historical.support.nearby_routes.history_window
                    ),
                    "older_history_fallback": (
                        historical.support.nearby_routes.older_history_fallback
                    ),
                    "message": historical.support.nearby_routes.message,
                    "route_summaries": nearby_history_for_model,
                },
                "reference_records": reference_history_for_model[:4],
                "regional_support": {
                    "status": regional.status,
                    "reason": regional.reason,
                    "comparison_level": regional.comparison_level,
                    "used_by_selected_cost": regional.used_by_selected_cost,
                    "origin_state": regional.origin_state,
                    "destination_state": regional.destination_state,
                    "origin_region": regional.origin_region_label,
                    "destination_region": regional.destination_region_label,
                    "directed_corridor": (
                        f"{regional.origin_state} -> {regional.destination_state}"
                        if regional.origin_state and regional.destination_state
                        else None
                    ),
                    "comparable_count": regional.comparable_count,
                    "history_window": regional.history_window,
                    "older_history_fallback": regional.older_history_fallback,
                    "regional_cost_level": regional.regional_cost_level,
                    "message": regional.message,
                    "route_summaries": regional_history_for_model[:3],
                },
            },
            "documentary_context": document_result.records,
        }
        if usd_rate is not None:
            # Los montos del cotizador también se presentan en USD; el costo
            # seleccionado usa redondeo hacia arriba, igual que el cotizador.
            evidence_blocks["request"]["currency"] = "USD"
            evidence_blocks["pricing_result"] = convert_money_to_usd(
                evidence_blocks["pricing_result"], usd_rate
            )
            evidence_blocks["pricing_result"]["selected_cost"] = math.ceil(
                pricing.selected_cost * usd_rate
            )
        evidence = {**historical.evidence, **document_result.evidence}
        try:
            generated = self.generator.generate(
                evidence_blocks,
                budget_subject=budget_subject,
            )
        except CopilotLimitError as exc:
            warnings.append(f"{exc} No se realizó una llamada de generación a OpenAI.")
            return CopilotResponse(
                status=CopilotStatus.UNAVAILABLE,
                answer=(
                    "El precio está disponible, pero el límite local de consumo "
                    "impidió generar la explicación. Solicita revisión humana."
                ),
                historical_support=historical.support,
                warnings=warnings,
                model=self.settings.active_model,
                model_phase=self.settings.model_phase,
                prompt_version=PROMPT_VERSION,
                index_version=self.index_version,
                usage=TokenUsage(),
            )
        except Exception:
            return CopilotResponse(
                status=CopilotStatus.UNAVAILABLE,
                answer=(
                    "El precio está disponible, pero el copiloto no pudo generar "
                    "la explicación. Solicita revisión humana."
                ),
                historical_support=historical.support,
                warnings=warnings,
                model=self.settings.active_model,
                model_phase=self.settings.model_phase,
                prompt_version=PROMPT_VERSION,
                index_version=self.index_version,
                usage=TokenUsage(),
            )

        if any(
            term in generated.output.answer.lower() for term in FORBIDDEN_OUTPUT_TERMS
        ):
            warnings.append(
                "La explicación generada incluyó contenido fuera del alcance y fue descartada."
            )
            return CopilotResponse(
                status=CopilotStatus.LIMITED_EVIDENCE,
                answer=(
                    "No fue posible generar una explicación dentro del alcance aprobado. "
                    "El precio permanece disponible y requiere revisión humana."
                ),
                historical_support=historical.support,
                warnings=warnings,
                model=generated.model,
                model_phase=self.settings.model_phase,
                prompt_version=PROMPT_VERSION,
                index_version=self.index_version,
                usage=generated.usage,
            )

        allowed_ids = generated.submitted_evidence_ids or frozenset(evidence)
        valid_ids: list[str] = []
        invalid_ids: list[str] = []
        for evidence_id in generated.output.evidence_ids:
            if (
                evidence_id in evidence
                and evidence_id in allowed_ids
                and evidence_id not in valid_ids
            ):
                valid_ids.append(evidence_id)
            elif evidence_id not in allowed_ids:
                invalid_ids.append(evidence_id)
        submitted_reference_ids = [
            record["evidence_id"]
            for record in reference_history_for_model[:4]
            if record["evidence_id"] in allowed_ids
        ]
        regional_document_ids = [
            record["evidence_id"]
            for record in document_result.records
            if "regional_segmentation" in record.get("topics", [])
            and record["evidence_id"] in allowed_ids
        ]
        for evidence_id in submitted_reference_ids[:2]:
            if evidence_id not in valid_ids:
                valid_ids.append(evidence_id)
        if (
            pricing.regional_context
            and pricing.regional_context.used_by_selected_cost
            and regional_document_ids
            and regional_document_ids[0] not in valid_ids
        ):
            valid_ids.insert(0, regional_document_ids[0])
        if invalid_ids:
            warnings.append(
                "La respuesta intentó usar evidencia no proporcionada; esas citas "
                "fueron eliminadas."
            )
        valid_ids = valid_ids[:6]
        citations = [Citation.model_validate(evidence[evidence_id]) for evidence_id in valid_ids]
        warnings.extend(
            limitation
            for limitation in generated.output.limitations
            if limitation not in warnings
        )
        limited = (
            generated.output.evidence_status == "limited_evidence"
            or historical.support.comparable_count == 0
            or not citations
            or bool(invalid_ids)
        )
        answer = generated.output.answer
        if (
            pricing.regional_context
            and pricing.regional_context.used_by_selected_cost
            and (
                pricing.regional_context.origin_region.lower() not in answer.lower()
                or pricing.regional_context.destination_region.lower()
                not in answer.lower()
            )
        ):
            answer = (
                f"{answer.rstrip()} El corredor regional "
                f"{pricing.regional_context.regional_corridor} también fue relevante "
                "porque había poca experiencia en la ruta exacta y se usaron zonas "
                "parecidas como apoyo."
            )
        # Validación regional determinista (sin segunda llamada a OpenAI):
        # degradar o aclarar afirmaciones no respaldadas.
        answer_lower = answer.lower()
        # Anclaje de menciones regionales: cualquier etiqueta de región del
        # catálogo congelado que aparezca en la respuesta debe pertenecer a la
        # evidencia regional entregada; si no, se agrega una corrección.
        segmentation = getattr(self.history, "regional_segmentation", None)
        if segmentation is not None and segmentation.region_labels:
            allowed_labels = {
                str(value).lower()
                for value in (
                    regional.origin_region_label,
                    regional.destination_region_label,
                    *(
                        label
                        for route in regional.routes
                        for label in (
                            route.origin_region_label,
                            route.destination_region_label,
                        )
                    ),
                )
                if value
            }
            ungrounded = [
                label
                for label in segmentation.region_labels.values()
                if label.lower() in answer_lower
                and label.lower() not in allowed_labels
            ]
            if ungrounded:
                answer = (
                    f"{answer.rstrip()} Aclaración: las regiones "
                    f"{', '.join(sorted(set(ungrounded)))} no forman parte de la "
                    "evidencia regional de esta cotización; ignora esa mención."
                )
                warnings.append(
                    "La explicación mencionó regiones fuera de la evidencia "
                    "entregada; se agregó una corrección."
                )
        mentions_regional = any(
            token in answer_lower for token in ("región", "region", "corredor")
        )
        if mentions_regional and not regional.used_by_selected_cost:
            influence_terms = ("influy", "se usó la región", "se uso la region", "determinó el costo", "determino el costo")
            if any(term in answer_lower for term in influence_terms):
                answer = (
                    f"{answer.rstrip()} Aclaración: la comparación regional es "
                    "sólo contexto; no influyó en el costo seleccionado."
                )
                warnings.append(
                    "La explicación sugería influencia regional sin respaldo de "
                    "trazabilidad; se agregó una aclaración."
                )
        if mentions_regional and regional.regional_cost_level in {
            "not_evaluated",
            "insufficient_evidence",
        }:
            classification_terms = (
                "más barato que la región",
                "más caro que la región",
                "mas barato que la region",
                "mas caro que la region",
                "por debajo del nivel regional",
                "por encima del nivel regional",
            )
            if any(term in answer_lower for term in classification_terms):
                answer = (
                    f"{answer.rstrip()} Nota: el nivel de costo regional no fue "
                    "clasificado para esta cotización; la comparación se "
                    "muestra sin clasificación."
                )
                warnings.append(
                    "La explicación intentó clasificar el nivel regional sin "
                    "clasificación disponible; se agregó una nota."
                )
        if submitted_reference_ids and not any(
            evidence_id in answer for evidence_id in submitted_reference_ids
        ):
            answer = (
                f"{answer.rstrip()} Referencias históricas: "
                f"{', '.join(submitted_reference_ids[:2])}."
            )
        return CopilotResponse(
            status=(
                CopilotStatus.LIMITED_EVIDENCE if limited else CopilotStatus.GROUNDED
            ),
            answer=answer,
            historical_support=historical.support,
            citations=citations,
            warnings=warnings,
            model=generated.model,
            model_phase=self.settings.model_phase,
            prompt_version=PROMPT_VERSION,
            index_version=self.index_version,
            usage=generated.usage,
        )
