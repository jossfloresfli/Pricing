from __future__ import annotations

import sys
from pathlib import Path
from typing import Mapping

import pandas as pd

from .preprocessing import prepare_quote
from .route_cache import RouteCache, RouteNotFoundError


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
ORCHESTRATOR_DIR = PACKAGE_ROOT / "experiments/modelos_v2_2026/protected_cost_orchestrator_20260717"
if str(ORCHESTRATOR_DIR) not in sys.path:
    sys.path.insert(0, str(ORCHESTRATOR_DIR))

from integration import ProtectedCostOrchestrator
from segmented_router import RouterConfig, route_shadow_decision


class ProtectedCostService:
    """Adaptador importable para integrar el orquestador en un backend existente."""

    def __init__(self, route_cache: RouteCache | None = None) -> None:
        self.route_cache = route_cache or RouteCache()
        self.orchestrator = ProtectedCostOrchestrator.from_paths(repo_root=PACKAGE_ROOT)
        self.router_config = RouterConfig.from_json(PACKAGE_ROOT / "config/router_policy.json")

    def prepare(
        self,
        raw_quote: Mapping[str, object],
        *,
        created_at: object | None = None,
        distance_km: float | None = None,
        geo: Mapping[str, object] | None = None,
    ) -> pd.DataFrame:
        origin = raw_quote.get("ORIGEN", raw_quote.get("origin"))
        destination = raw_quote.get("DESTINO", raw_quote.get("destination"))
        cached_geo: Mapping[str, object] | None = None
        if distance_km is None:
            try:
                cached_geo = self.route_cache.lookup(origin, destination)
                distance_km = float(cached_geo["google_distance_km"])
            except RouteNotFoundError:
                if geo is None:
                    raise
        resolved_geo = dict(cached_geo or {})
        resolved_geo.update(dict(geo or {}))
        if distance_km is None and resolved_geo.get("google_distance_km") is not None:
            distance_km = float(resolved_geo["google_distance_km"])

        prepared = prepare_quote(raw_quote, created_at=created_at, distance_km=distance_km)
        prepared.update({
            "quote_id": raw_quote.get("quote_id"),
            "quote_row_id": raw_quote.get("quote_row_id"),
            "currency": str(raw_quote.get("currency", "")).strip().upper(),
            "anio_creacion": pd.Timestamp(created_at or pd.Timestamp.now()).year,
            "origin_lat": resolved_geo.get("origin_lat"),
            "origin_lng": resolved_geo.get("origin_lng"),
            "destination_lat": resolved_geo.get("destination_lat"),
            "destination_lng": resolved_geo.get("destination_lng"),
            "origin_elevation_m": resolved_geo.get("origin_elevation_m"),
            "destination_elevation_m": resolved_geo.get("destination_elevation_m"),
            "google_origin_elevation_m": resolved_geo.get("origin_elevation_m"),
            "google_destination_elevation_m": resolved_geo.get("destination_elevation_m"),
        })
        return pd.DataFrame([prepared])

    def predict_prepared(self, quote: pd.DataFrame) -> dict[str, object]:
        prediction = self.orchestrator.predict(quote).iloc[0].to_dict()
        hybrid_prediction = None
        try:
            hybrid = self.orchestrator.hybrid_predictor(quote.copy())
            if isinstance(hybrid, pd.DataFrame) and not hybrid.empty:
                hybrid_prediction = hybrid.iloc[0].get("cost_mxn_prediction")
        except Exception:
            hybrid_prediction = None
        routing = route_shadow_decision(
            quote.iloc[0].to_dict(),
            prediction,
            config=self.router_config,
            hybrid_prediction_mxn=hybrid_prediction,
        )
        return {"prediction": prediction, "routing": routing}

    def predict(self, raw_quote: Mapping[str, object], **prepare_kwargs: object) -> dict[str, object]:
        return self.predict_prepared(self.prepare(raw_quote, **prepare_kwargs))
