from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import unicodedata
from typing import Any

import numpy as np
import pandas as pd

from .regional import RegionalSegmentation, state_from_location
from .schemas import (
    CarrierRouteSummary,
    RegionalRouteSummary,
    RegionalSupport,
    ComparisonBasis,
    HistoricalRecord,
    HistoricalRouteSummary,
    HistoricalSupport,
    HistoricalTrend,
    MarginSummary,
    MoneyRange,
    NearbyHistoricalRouteSummary,
    NearbyHistoricalSupport,
)


def normalize_key(value: object) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value).strip().lower())
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = re.sub(r"[^a-z0-9\s,./#-]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def route_key(origin: str, destination: str) -> str:
    return f"{normalize_key(origin)} -> {normalize_key(destination)}"


def distance_band(value: float | None) -> str:
    if value is None or not np.isfinite(value) or value < 0:
        return "unknown"
    if value < 250:
        return "0000_0249_km"
    if value < 500:
        return "0250_0499_km"
    if value < 1000:
        return "0500_0999_km"
    if value < 2000:
        return "1000_1999_km"
    return "2000_plus_km"


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as stream:
        for line in stream:
            if line.strip():
                records.append(json.loads(line))
    return records


def _number(value: object) -> float | None:
    numeric = pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0]
    if pd.isna(numeric) or not np.isfinite(float(numeric)):
        return None
    return round(float(numeric), 2)


def _money_range(series: pd.Series) -> MoneyRange:
    values = pd.to_numeric(series, errors="coerce").dropna()
    if values.empty:
        return MoneyRange()
    return MoneyRange(
        low=_number(values.quantile(0.25)),
        usual=_number(values.median()),
        high=_number(values.quantile(0.75)),
    )


def _stable_id(prefix: str, *parts: object) -> str:
    raw = "\x1f".join("" if part is None else str(part) for part in parts)
    return f"{prefix}-{sha256(raw.encode('utf-8')).hexdigest()[:16]}"


@dataclass(frozen=True)
class HistoricalQuery:
    origin: str
    destination: str
    equipment: str
    division: str
    service_range: str | None
    currency: str
    quote_created_at: datetime
    distance_km: float | None = None
    origin_lat: float | None = None
    origin_lng: float | None = None
    destination_lat: float | None = None
    destination_lng: float | None = None
    quoted_cost: float | None = None


@dataclass
class HistoricalRetrieval:
    support: HistoricalSupport
    evidence: dict[str, dict[str, Any]]
    internal_match_level: str


class HistoricalRepository:
    """Recupera comparables sin modificar el histórico fuente."""

    def __init__(
        self,
        path: Path,
        *,
        route_cache_path: Path | None = None,
        max_records: int = 8,
        max_route_summaries: int = 5,
        max_carrier_summaries: int = 12,
        nearby_radius_km: float = 30.0,
        nearby_distance_tolerance_pct: float = 20.0,
        max_nearby_route_summaries: int = 5,
        max_nearby_carriers_per_route: int = 4,
        regional_assignments_path: Path | None = None,
        regional_segmentation: RegionalSegmentation | None = None,
        max_regional_route_summaries: int = 3,
        regional_cost_level_lower_pct: float = -10.0,
        regional_cost_level_higher_pct: float = 10.0,
        regional_min_trips_for_level: int = 3,
        related_corridors: dict[str, list[str]] | None = None,
    ) -> None:
        # Catálogo aprobado de corredores relacionados (dirigidos). None =
        # nivel deshabilitado (sin catálogo no se inventan relaciones).
        self.related_corridors = related_corridors
        if not path.exists():
            raise FileNotFoundError(f"No existe el histórico estructurado: {path}")
        frame = pd.DataFrame.from_records(_read_jsonl(path))
        if frame.empty:
            raise ValueError("El histórico estructurado está vacío.")
        frame["cost_available_at"] = pd.to_datetime(
            frame["cost_available_at"], errors="coerce", utc=True
        )
        frame["quote_created_at"] = pd.to_datetime(
            frame["quote_created_at"], errors="coerce", utc=True
        )
        for column in ("all_in_rate_cost", "all_in_rate_sale", "distance_km"):
            frame[column] = pd.to_numeric(frame.get(column), errors="coerce")
        for column in (
            "equipment_key",
            "division_key",
            "range_key",
            "currency",
            "distance_band",
        ):
            frame[column] = frame.get(column, "").fillna("").astype(str).map(normalize_key)
        frame["route_key"] = [
            route_key(origin, destination)
            if normalize_key(origin) and normalize_key(destination)
            else str(existing)
            for origin, destination, existing in zip(
                frame.get("origin", ""),
                frame.get("destination", ""),
                frame.get("route_key", ""),
            )
        ]
        coordinate_columns = (
            "origin_lat",
            "origin_lng",
            "destination_lat",
            "destination_lng",
        )
        for column in coordinate_columns:
            if column not in frame:
                frame[column] = np.nan
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
        if route_cache_path is not None and route_cache_path.exists():
            cache = pd.read_csv(route_cache_path, encoding="utf-8-sig", low_memory=False)
            cache_columns = {
                "google_origin_lat": "origin_lat",
                "google_origin_lng": "origin_lng",
                "google_destination_lat": "destination_lat",
                "google_destination_lng": "destination_lng",
            }
            if "route_key" in cache and all(
                source in cache for source in cache_columns
            ):
                cache = cache[["route_key", *cache_columns]].copy()
                cache["route_key"] = cache["route_key"].fillna("").map(
                    lambda value: " -> ".join(
                        normalize_key(part)
                        for part in str(value).split("->", maxsplit=1)
                    )
                )
                cache = cache.drop_duplicates("route_key", keep="last").rename(
                    columns=cache_columns
                )
                frame = frame.merge(
                    cache,
                    on="route_key",
                    how="left",
                    suffixes=("", "_cache"),
                    validate="many_to_one",
                )
                for column in coordinate_columns:
                    cached = pd.to_numeric(
                        frame.pop(f"{column}_cache"), errors="coerce"
                    )
                    frame[column] = frame[column].combine_first(cached)
        frame["currency"] = frame["currency"].str.upper()
        if "provider" not in frame:
            frame["provider"] = ""
        frame["provider"] = frame["provider"].fillna("").astype(str).str.strip()
        if "load_id" not in frame:
            frame["load_id"] = frame["evidence_id"]
        frame["load_id"] = frame["load_id"].fillna(frame["evidence_id"]).astype(str)
        valid_sale = frame["all_in_rate_sale"].gt(0)
        frame["calculated_margin_amount"] = np.where(
            valid_sale,
            frame["all_in_rate_sale"] - frame["all_in_rate_cost"],
            np.nan,
        )
        frame["calculated_margin_pct"] = np.where(
            valid_sale,
            100
            * frame["calculated_margin_amount"]
            / frame["all_in_rate_sale"],
            np.nan,
        )
        regional_columns = (
            "origin_state",
            "destination_state",
            "origin_region",
            "destination_region",
            "regional_corridor_id",
            "state_corridor",
        )
        for column in regional_columns:
            frame[column] = None
        self.regional_segmentation = regional_segmentation
        self.regional_available = False
        if (
            regional_segmentation is not None
            and regional_assignments_path is not None
            and regional_assignments_path.exists()
        ):
            assignments = pd.DataFrame.from_records(
                _read_jsonl(regional_assignments_path)
            )
            if not assignments.empty and "evidence_id" in assignments:
                resolved = assignments[
                    assignments.get("resolution_status", "").eq("resolved")
                    # La capa derivada debe corresponder al mismo artefacto
                    # congelado; si el checksum difiere, se ignora (unavailable).
                    & assignments.get("artifact_checksum", "").eq(
                        regional_segmentation.checksum
                    )
                ]
                if not resolved.empty:
                    resolved = resolved.rename(
                        columns={"regional_corridor": "regional_corridor_id"}
                    )[
                        [
                            "evidence_id",
                            "origin_state",
                            "destination_state",
                            "origin_region",
                            "destination_region",
                            "regional_corridor_id",
                            "state_corridor",
                        ]
                    ].drop_duplicates("evidence_id", keep="last")
                    frame = frame.drop(columns=list(regional_columns)).merge(
                        resolved, on="evidence_id", how="left", validate="many_to_one"
                    )
                    self.regional_available = True
        self._frame = frame
        self.max_records = max_records
        self.max_route_summaries = max_route_summaries
        self.max_carrier_summaries = max_carrier_summaries
        if nearby_radius_km <= 0:
            raise ValueError("El radio de rutas cercanas debe ser mayor que cero.")
        if nearby_distance_tolerance_pct < 0:
            raise ValueError("La tolerancia de distancia no puede ser negativa.")
        self.nearby_radius_km = float(nearby_radius_km)
        self.nearby_distance_tolerance_pct = float(
            nearby_distance_tolerance_pct
        )
        self.max_nearby_route_summaries = max(0, int(max_nearby_route_summaries))
        self.max_nearby_carriers_per_route = max(
            0, int(max_nearby_carriers_per_route)
        )
        self.max_regional_route_summaries = max(
            0, int(max_regional_route_summaries)
        )
        # Umbrales aprobados para clasificar el nivel de costo regional.
        # lower_pct: diferencia porcentual por debajo de la mediana regional →
        #   "lower" (p.ej. -10.0 significa que el costo cotizado es ≥10% más bajo).
        # higher_pct: diferencia porcentual por encima de la mediana regional →
        #   "higher" (p.ej. 10.0 significa que es ≥10% más alto).
        # Entre ambos umbrales → "similar".
        if regional_cost_level_lower_pct >= 0:
            raise ValueError(
                "regional_cost_level_lower_pct debe ser negativo (p.ej. -10.0)."
            )
        if regional_cost_level_higher_pct <= 0:
            raise ValueError(
                "regional_cost_level_higher_pct debe ser positivo (p.ej. 10.0)."
            )
        if regional_min_trips_for_level < 1:
            raise ValueError("regional_min_trips_for_level debe ser al menos 1.")
        self.regional_cost_level_lower_pct = float(regional_cost_level_lower_pct)
        self.regional_cost_level_higher_pct = float(regional_cost_level_higher_pct)
        self.regional_min_trips_for_level = int(regional_min_trips_for_level)

    @property
    def record_count(self) -> int:
        return int(len(self._frame))

    def _eligible(self, query: HistoricalQuery) -> pd.DataFrame:
        timestamp = query.quote_created_at
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        timestamp = pd.Timestamp(timestamp).tz_convert("UTC")
        frame = self._frame
        return frame[
            frame["cost_available_at"].notna()
            & frame["cost_available_at"].lt(timestamp)
            & frame["all_in_rate_cost"].gt(0)
            & frame["currency"].eq(query.currency.upper())
            & frame.get("eligible_for_point_in_time", True)
        ]

    def _select_level(
        self,
        eligible: pd.DataFrame,
        query: HistoricalQuery,
        *,
        allow_peers: bool = True,
    ) -> tuple[str, pd.DataFrame]:
        requested_route = route_key(query.origin, query.destination)
        equipment = normalize_key(query.equipment)
        division = normalize_key(query.division)
        service_range = normalize_key(query.service_range)

        route_mask = eligible["route_key"].eq(requested_route)
        equipment_mask = eligible["equipment_key"].eq(equipment)
        division_mask = eligible["division_key"].eq(division)

        if service_range:
            exact = eligible[
                route_mask
                & equipment_mask
                & division_mask
                & eligible["range_key"].eq(service_range)
            ]
            if not exact.empty:
                return "exact", exact

        relaxed = eligible[route_mask & equipment_mask & division_mask]
        if not relaxed.empty:
            return "relaxed", relaxed

        same_route = eligible[route_mask & equipment_mask]
        if not same_route.empty:
            return "route", same_route

        # Si la ruta solicitada tiene historial con otro equipo o división,
        # esa información es preferible a las rutas comparables: sólo se cae a
        # comparables cuando la ruta no tiene NINGÚN viaje registrado.
        route_any = eligible[route_mask]
        if not route_any.empty:
            return "route_any_equipment", route_any

        if not allow_peers:
            return "none", eligible.iloc[0:0]

        peer_mask = equipment_mask & division_mask
        if service_range:
            narrowed = eligible[peer_mask & eligible["range_key"].eq(service_range)]
            if not narrowed.empty:
                peer_mask &= eligible["range_key"].eq(service_range)
        requested_band = distance_band(query.distance_km)
        if requested_band != "unknown":
            narrowed = eligible[peer_mask & eligible["distance_band"].eq(requested_band)]
            if not narrowed.empty:
                peer_mask &= eligible["distance_band"].eq(requested_band)
        peers = eligible[peer_mask]
        return ("peer_segment", peers) if not peers.empty else ("none", peers)

    @staticmethod
    def _basis(match_level: str) -> ComparisonBasis:
        if match_level in {"exact", "relaxed"}:
            return ComparisonBasis.SAME_ROUTE_EQUIPMENT
        if match_level in {"route", "route_any_equipment"}:
            return ComparisonBasis.SAME_ROUTE
        if match_level == "peer_segment":
            return ComparisonBasis.COMPARABLE_ROUTES
        return ComparisonBasis.NONE

    @staticmethod
    def _message(match_level: str, count: int) -> str:
        if count == 0:
            return "No se encontraron viajes anteriores comparables."
        if match_level == "peer_segment":
            return (
                f"Se encontraron {count} viajes de rutas comparables. "
                "Úsalos como orientación y confirma las condiciones de la ruta solicitada."
            )
        if match_level == "route_any_equipment":
            return (
                f"Se encontraron {count} viajes de la misma ruta con otro equipo o "
                "división. Úsalos como referencia y valida las condiciones del "
                "equipo solicitado."
            )
        if count == 1:
            return "Sólo se encontró un viaje anterior para esta comparación."
        if count <= 3:
            return f"Sólo se encontraron {count} viajes anteriores para esta comparación."
        return f"Se encontraron {count} viajes anteriores útiles para orientar el precio."

    @staticmethod
    def _older_trend(selected: pd.DataFrame) -> HistoricalTrend:
        ordered = selected.sort_values("cost_available_at", kind="stable").copy()
        ordered["period"] = (
            ordered["cost_available_at"].dt.tz_localize(None).dt.to_period("M")
        )
        monthly = ordered.groupby("period", sort=True).agg(
            cost=("all_in_rate_cost", "median"),
            sale=("all_in_rate_sale", "median"),
            margin=("calculated_margin_pct", "median"),
        )
        period_start = ordered["cost_available_at"].min()
        period_end = ordered["cost_available_at"].max()
        prefix = (
            "Se muestran viajes anteriores a los seis meses previos a la "
            "cotización como referencia histórica. "
        )
        if len(monthly) < 2:
            return HistoricalTrend(
                period_start=period_start.to_pydatetime(),
                period_end=period_end.to_pydatetime(),
                message=(
                    prefix
                    + "No hay meses distintos suficientes para describir la "
                    "fluctuación de la ruta en el tiempo."
                ),
            )

        first = monthly.iloc[0]
        last = monthly.iloc[-1]

        def change_amount(name: str) -> float | None:
            if pd.isna(first[name]) or pd.isna(last[name]):
                return None
            return _number(last[name] - first[name])

        def change_percentage(name: str) -> float | None:
            if (
                pd.isna(first[name])
                or pd.isna(last[name])
                or float(first[name]) == 0
            ):
                return None
            return _number(100 * (last[name] - first[name]) / first[name])

        cost_pct = change_percentage("cost")
        sale_pct = change_percentage("sale")
        margin_points = change_amount("margin")

        def phrase(label: str, value: float | None, unit: str = "%") -> str | None:
            if value is None:
                return None
            if value == 0:
                return f"{label} se mantuvo sin cambio"
            direction = "subió" if value > 0 else "bajó"
            return f"{label} {direction} {abs(value):.1f}{unit}"

        readable = [
            value
            for value in (
                phrase("el costo habitual", cost_pct),
                phrase("la venta habitual", sale_pct),
                phrase("el margen habitual", margin_points, " puntos"),
            )
            if value
        ]
        suffix = (
            "Entre el primer y el último periodo disponible, "
            + ", ".join(readable)
            + ". Esto muestra que la ruta ha fluctuado con el tiempo."
            if readable
            else "No hay importes suficientes para describir la fluctuación."
        )
        return HistoricalTrend(
            period_start=period_start.to_pydatetime(),
            period_end=period_end.to_pydatetime(),
            cost_change_amount=change_amount("cost"),
            cost_change_percentage=cost_pct,
            sale_change_amount=change_amount("sale"),
            sale_change_percentage=sale_pct,
            margin_change_percentage_points=margin_points,
            message=prefix + suffix,
        )

    def _route_summary(
        self, group: pd.DataFrame, match_level: str
    ) -> tuple[HistoricalRouteSummary, dict[str, Any]]:
        first = group.iloc[0]
        valid_sale = group[group["all_in_rate_sale"].gt(0)]
        latest = group["cost_available_at"].max()
        route_id = _stable_id(
            "hist-summary",
            match_level,
            first.get("route_key"),
            first.get("equipment_key"),
            first.get("division_key"),
            first.get("currency"),
            latest,
        )
        margin_values = valid_sale["calculated_margin_pct"]
        margin_amounts = valid_sale["calculated_margin_amount"]
        summary = HistoricalRouteSummary(
            evidence_id=route_id,
            origin=str(first.get("origin") or ""),
            destination=str(first.get("destination") or ""),
            division=str(first.get("division") or ""),
            equipment=str(first.get("equipment") or ""),
            service_type=str(first.get("range") or "") or None,
            operational_category=str(first.get("route_type") or "") or None,
            flow=str(first.get("flow") or "") or None,
            currency=str(first.get("currency") or "MXN").upper(),
            shipment_count=int(len(group)),
            sale_margin_record_count=int(len(valid_sale)),
            cost=_money_range(group["all_in_rate_cost"]),
            all_in_rate_sale=_money_range(valid_sale["all_in_rate_sale"]),
            margin=MarginSummary(
                usual_amount=_number(margin_amounts.median()) if not margin_amounts.empty else None,
                usual_percentage=_number(margin_values.median()) if not margin_values.empty else None,
                negative_record_count=int(margin_values.lt(0).sum()),
            ),
            latest_available_at=latest.to_pydatetime() if not pd.isna(latest) else None,
        )
        excerpt = (
            f"{summary.shipment_count} viajes de {summary.origin} a {summary.destination}; "
            f"costo habitual {summary.cost.usual}, venta all-in habitual "
            f"{summary.all_in_rate_sale.usual} y margen habitual "
            f"{summary.margin.usual_percentage}% {summary.currency}."
        )
        evidence = {
            "evidence_id": route_id,
            "type": "historical_summary",
            "title": f"Histórico {summary.origin} → {summary.destination}",
            "source": "Histórico de viajes facturados VAX",
            "excerpt": excerpt,
            "url": None,
            "verified_at": (
                summary.latest_available_at.date().isoformat()
                if summary.latest_available_at
                else None
            ),
            "is_stale": False,
            "prompt_payload": {
                "evidence_id": route_id,
                "comparison": self._basis(match_level).value,
                "origin": summary.origin,
                "destination": summary.destination,
                "division": summary.division,
                "equipment": summary.equipment,
                "service_type": summary.service_type,
                "operational_category": summary.operational_category,
                "flow": summary.flow,
                "currency": summary.currency,
                "shipment_count": summary.shipment_count,
                "cost_low": summary.cost.low,
                "cost_usual": summary.cost.usual,
                "cost_high": summary.cost.high,
                "sale_all_in_low": summary.all_in_rate_sale.low,
                "sale_all_in_usual": summary.all_in_rate_sale.usual,
                "sale_all_in_high": summary.all_in_rate_sale.high,
                "margin_usual_amount": summary.margin.usual_amount,
                "margin_usual_percentage": summary.margin.usual_percentage,
                "negative_margin_records": summary.margin.negative_record_count,
                "latest_available_at": (
                    summary.latest_available_at.isoformat()
                    if summary.latest_available_at
                    else None
                ),
            },
        }
        return summary, evidence

    @staticmethod
    def _carrier_summary(group: pd.DataFrame) -> CarrierRouteSummary:
        first = group.iloc[0]
        valid_sale = group[group["all_in_rate_sale"].gt(0)]
        latest = group["cost_available_at"].max()
        margin_values = valid_sale["calculated_margin_pct"]
        margin_amounts = valid_sale["calculated_margin_amount"]
        references = [
            str(value)
            for value in group.sort_values(
                ["cost_available_at", "load_id"],
                ascending=[False, True],
                kind="stable",
            )["load_id"].head(5)
        ]
        return CarrierRouteSummary(
            carrier=str(first.get("provider") or "Transportista no identificado"),
            origin=str(first.get("origin") or ""),
            destination=str(first.get("destination") or ""),
            division=str(first.get("division") or ""),
            equipment=str(first.get("equipment") or ""),
            service_type=str(first.get("range") or "") or None,
            currency=str(first.get("currency") or "MXN").upper(),
            shipment_count=int(len(group)),
            sale_margin_record_count=int(len(valid_sale)),
            reference_ids=references,
            cost=_money_range(group["all_in_rate_cost"]),
            all_in_rate_sale=_money_range(valid_sale["all_in_rate_sale"]),
            margin=MarginSummary(
                usual_amount=(
                    _number(margin_amounts.median())
                    if not margin_amounts.empty
                    else None
                ),
                usual_percentage=(
                    _number(margin_values.median())
                    if not margin_values.empty
                    else None
                ),
                negative_record_count=int(margin_values.lt(0).sum()),
            ),
            latest_available_at=(
                latest.to_pydatetime() if not pd.isna(latest) else None
            ),
        )

    @staticmethod
    def _coordinates_available(query: HistoricalQuery) -> bool:
        values = (
            query.origin_lat,
            query.origin_lng,
            query.destination_lat,
            query.destination_lng,
        )
        return all(value is not None and np.isfinite(value) for value in values)

    @staticmethod
    def _haversine_km(
        latitude: pd.Series,
        longitude: pd.Series,
        requested_latitude: float,
        requested_longitude: float,
    ) -> pd.Series:
        latitudes = np.radians(pd.to_numeric(latitude, errors="coerce"))
        longitudes = np.radians(pd.to_numeric(longitude, errors="coerce"))
        requested_lat = np.radians(requested_latitude)
        requested_lng = np.radians(requested_longitude)
        delta_lat = latitudes - requested_lat
        delta_lng = longitudes - requested_lng
        haversine = (
            np.sin(delta_lat / 2) ** 2
            + np.cos(requested_lat)
            * np.cos(latitudes)
            * np.sin(delta_lng / 2) ** 2
        )
        return pd.Series(
            6371.0088 * 2 * np.arcsin(np.sqrt(haversine)),
            index=latitude.index,
        )

    def _nearby_candidates(
        self, eligible: pd.DataFrame, query: HistoricalQuery
    ) -> pd.DataFrame:
        if not self._coordinates_available(query):
            return eligible.iloc[0:0].copy()
        candidates = eligible[
            eligible["equipment_key"].eq(normalize_key(query.equipment))
            & eligible["division_key"].eq(normalize_key(query.division))
            & eligible["route_key"].ne(route_key(query.origin, query.destination))
            & eligible["origin_lat"].notna()
            & eligible["origin_lng"].notna()
            & eligible["destination_lat"].notna()
            & eligible["destination_lng"].notna()
        ].copy()
        if candidates.empty:
            return candidates

        candidates["origin_distance_km"] = self._haversine_km(
            candidates["origin_lat"],
            candidates["origin_lng"],
            float(query.origin_lat),
            float(query.origin_lng),
        )
        candidates["destination_distance_km"] = self._haversine_km(
            candidates["destination_lat"],
            candidates["destination_lng"],
            float(query.destination_lat),
            float(query.destination_lng),
        )
        candidates = candidates[
            candidates["origin_distance_km"].le(self.nearby_radius_km)
            & candidates["destination_distance_km"].le(self.nearby_radius_km)
            & ~(
                candidates["origin_distance_km"].le(0.5)
                & candidates["destination_distance_km"].le(0.5)
            )
        ].copy()
        if candidates.empty:
            return candidates

        if query.distance_km is not None and query.distance_km > 0:
            candidates["route_distance_difference_pct"] = (
                100
                * (candidates["distance_km"] - float(query.distance_km)).abs()
                / float(query.distance_km)
            )
            if self.nearby_distance_tolerance_pct > 0:
                candidates = candidates[
                    candidates["route_distance_difference_pct"].isna()
                    | candidates["route_distance_difference_pct"].le(
                        self.nearby_distance_tolerance_pct
                    )
                ].copy()
        else:
            candidates["route_distance_difference_pct"] = np.nan

        requested_range = normalize_key(query.service_range)
        candidates["service_match"] = (
            candidates["range_key"].eq(requested_range)
            if requested_range
            else True
        )
        return candidates

    def _nearby_support(
        self,
        eligible: pd.DataFrame,
        query: HistoricalQuery,
        window_start: pd.Timestamp,
    ) -> tuple[NearbyHistoricalSupport, dict[str, dict[str, Any]]]:
        candidates = self._nearby_candidates(eligible, query)
        if candidates.empty:
            return NearbyHistoricalSupport(radius_km=self.nearby_radius_km), {}

        recent = candidates[candidates["cost_available_at"].ge(window_start)]
        if recent.empty:
            selected = candidates[candidates["cost_available_at"].lt(window_start)]
            history_window = "older_than_6_months"
            older_fallback = True
        else:
            selected = recent
            history_window = "recent_6_months"
            older_fallback = False
        if selected.empty:
            return NearbyHistoricalSupport(radius_km=self.nearby_radius_km), {}

        groups = list(
            selected.groupby(["route_key", "currency"], sort=False, dropna=False)
        )
        groups.sort(
            key=lambda item: (
                -int(item[1]["service_match"].any()),
                float(item[1]["origin_distance_km"].iloc[0])
                + float(item[1]["destination_distance_km"].iloc[0]),
                float(
                    item[1]["route_distance_difference_pct"].iloc[0]
                    if pd.notna(item[1]["route_distance_difference_pct"].iloc[0])
                    else float("inf")
                ),
                -len(item[1]),
                -item[1]["cost_available_at"].max().timestamp(),
            )
        )

        summaries: list[NearbyHistoricalRouteSummary] = []
        evidence: dict[str, dict[str, Any]] = {}
        included_count = 0
        for _, group in groups[: self.max_nearby_route_summaries]:
            base, citation = self._route_summary(group, "nearby")
            carrier_groups = list(
                group.groupby("provider", sort=False, dropna=False)
            )
            carrier_groups.sort(
                key=lambda item: (
                    -len(item[1]),
                    -item[1]["cost_available_at"].max().timestamp(),
                    str(item[0]),
                )
            )
            carriers = [
                self._carrier_summary(carrier_group)
                for _, carrier_group in carrier_groups[
                    : self.max_nearby_carriers_per_route
                ]
            ]
            summary = NearbyHistoricalRouteSummary(
                **base.model_dump(),
                origin_distance_km=_number(group["origin_distance_km"].iloc[0]) or 0,
                destination_distance_km=(
                    _number(group["destination_distance_km"].iloc[0]) or 0
                ),
                route_distance_difference_pct=_number(
                    group["route_distance_difference_pct"].iloc[0]
                ),
                carriers=carriers,
            )
            citation["is_stale"] = older_fallback
            citation["excerpt"] = (
                f"{citation['excerpt']} El origen está a "
                f"{summary.origin_distance_km:.1f} km y el destino a "
                f"{summary.destination_distance_km:.1f} km de los puntos solicitados."
            )
            citation["prompt_payload"].update(
                {
                    "comparison": "nearby_routes",
                    "origin_distance_km": summary.origin_distance_km,
                    "destination_distance_km": summary.destination_distance_km,
                    "route_distance_difference_pct": (
                        summary.route_distance_difference_pct
                    ),
                }
            )
            summaries.append(summary)
            evidence[summary.evidence_id] = citation
            included_count += len(group)

        route_count = len(summaries)
        age_note = (
            " Son viajes anteriores a los últimos seis meses y se muestran sólo "
            "como referencia histórica."
            if older_fallback
            else ""
        )
        support = NearbyHistoricalSupport(
            radius_km=self.nearby_radius_km,
            route_count=route_count,
            comparable_count=included_count,
            history_window=history_window,
            older_history_fallback=older_fallback,
            routes=summaries,
            message=(
                f"Se encontraron {included_count} viajes en {route_count} rutas "
                f"con ambos extremos dentro de {self.nearby_radius_km:g} km. "
                "Son una referencia secundaria y no sustituyen la ruta exacta."
                + age_note
            ),
        )
        return support, evidence

    def _classify_regional_cost_level(
        self,
        *,
        comparable_count: int,
        regional_costs: pd.Series,
        quoted_cost: float | None,
    ) -> str:
        """Clasifica el nivel de costo de la cotización vs. la mediana regional.

        Umbrales configurables (aprobados por Pricing/Ops/Procurement):
        - ``not_evaluated``: quoted_cost ausente o sin mediana válida.
        - ``insufficient_evidence``: comparable_count < regional_min_trips_for_level.
        - ``lower``: cotización ≥ lower_pct% por debajo de la mediana regional.
        - ``higher``: cotización ≥ higher_pct% por encima de la mediana regional.
        - ``similar``: entre ambos umbrales.
        """
        if comparable_count < self.regional_min_trips_for_level:
            return "insufficient_evidence"
        if quoted_cost is None or not np.isfinite(quoted_cost) or quoted_cost <= 0:
            return "not_evaluated"
        regional_median = pd.to_numeric(regional_costs, errors="coerce").dropna()
        if regional_median.empty:
            return "not_evaluated"
        median_value = float(regional_median.median())
        if not np.isfinite(median_value) or median_value <= 0:
            return "not_evaluated"
        pct_diff = 100.0 * (quoted_cost - median_value) / median_value
        if pct_diff <= self.regional_cost_level_lower_pct:
            return "lower"
        if pct_diff >= self.regional_cost_level_higher_pct:
            return "higher"
        return "similar"

    _LTL_EQUIPMENT_TOKENS = ("ltl",)

    def _regional_not_applicable(self, reason: str, message: str) -> RegionalSupport:
        segmentation = self.regional_segmentation
        return RegionalSupport(
            status="not_applicable",
            reason=reason,
            message=message,
            model_version=(
                "national-geo-2026-frozen" if segmentation is not None else None
            ),
            artifact_checksum=(
                segmentation.checksum if segmentation is not None else None
            ),
        )

    def _regional_support(
        self,
        eligible: pd.DataFrame,
        query: HistoricalQuery,
        window_start: pd.Timestamp,
    ) -> tuple[RegionalSupport, dict[str, dict[str, Any]]]:
        """Comparación regional (sólo National, segmentación congelada).

        Prioridad estricta de niveles: mismo par de estados dirigido →
        mismo corredor regional dirigido → corredores relacionados
        (deshabilitado: no existe catálogo aprobado) → distancia y equipo
        comparables. Nunca sustituye a la ruta exacta ni a las cercanas.
        """

        segmentation = self.regional_segmentation
        if segmentation is None or not self.regional_available:
            return (
                RegionalSupport(
                    status="unavailable",
                    reason="regional_artifact_unavailable",
                    message=(
                        "La comparación regional no está disponible: el artefacto "
                        "congelado de segmentación o la capa derivada no pasó la "
                        "verificación de integridad."
                    ),
                ),
                {},
            )
        if normalize_key(query.division) != "national":
            return (
                self._regional_not_applicable(
                    "division_not_national",
                    "La comparación regional sólo aplica a la división National.",
                ),
                {},
            )
        equipment_key = normalize_key(query.equipment)
        if any(token in equipment_key for token in self._LTL_EQUIPMENT_TOKENS):
            return (
                self._regional_not_applicable(
                    "equipment_ltl",
                    "La comparación regional no aplica a embarques LTL.",
                ),
                {},
            )
        if not self._coordinates_available(query):
            return (
                self._regional_not_applicable(
                    "missing_coordinates",
                    "La comparación regional no aplica: la cotización no tiene "
                    "coordenadas completas y válidas.",
                ),
                {},
            )
        origin_state = normalize_key(state_from_location(query.origin) or "")
        destination_state = normalize_key(
            state_from_location(query.destination) or ""
        )
        if not origin_state or not destination_state:
            return (
                self._regional_not_applicable(
                    "state_not_in_structured_label",
                    "La comparación regional no aplica: el origen o destino no "
                    "tiene estado en formato estructurado.",
                ),
                {},
            )
        origin_region = segmentation.assign_point(
            float(query.origin_lat), float(query.origin_lng)
        )
        destination_region = segmentation.assign_point(
            float(query.destination_lat), float(query.destination_lng)
        )
        corridor_id = f"{origin_region}->{destination_region}"

        base = RegionalSupport(
            status="applicable",
            origin_state=origin_state,
            destination_state=destination_state,
            origin_region_label=segmentation.label(origin_region),
            destination_region_label=segmentation.label(destination_region),
            regional_corridor=(
                f"{segmentation.label(origin_region)} -> "
                f"{segmentation.label(destination_region)}"
            ),
            model_version="national-geo-2026-frozen",
            artifact_checksum=segmentation.checksum,
            related_corridors_enabled=bool(self.related_corridors),
        )

        requested_route = route_key(query.origin, query.destination)
        candidates = eligible[
            eligible["division_key"].eq("national")
            & eligible["equipment_key"].eq(equipment_key)
            & eligible["route_key"].ne(requested_route)
            & eligible["origin_state"].notna()
        ].copy()

        def _level_frame(level: str) -> pd.DataFrame:
            if level == "same_state_pair":
                return candidates[
                    candidates["origin_state"].eq(origin_state)
                    & candidates["destination_state"].eq(destination_state)
                ]
            if level == "same_regional_corridor":
                return candidates[
                    candidates["regional_corridor_id"].eq(corridor_id)
                ]
            if level == "related_corridor":
                if not self.related_corridors:
                    return candidates.iloc[0:0]
                requested_corridor = f"{origin_state} -> {destination_state}"
                related = self.related_corridors.get(requested_corridor, [])
                if not related:
                    return candidates.iloc[0:0]
                # Sólo relaciones del catálogo aprobado, dirigidas (la
                # inversa no cuenta como el mismo corredor relacionado).
                return candidates[candidates["state_corridor"].isin(related)]
            if level == "comparable_distance_equipment":
                if query.distance_km is None or query.distance_km <= 0:
                    return candidates.iloc[0:0]
                difference_pct = (
                    100
                    * (candidates["distance_km"] - float(query.distance_km)).abs()
                    / float(query.distance_km)
                )
                return candidates[
                    candidates["distance_km"].notna()
                    & difference_pct.le(self.nearby_distance_tolerance_pct)
                ]
            return candidates.iloc[0:0]

        selected = candidates.iloc[0:0]
        level = "none"
        # Nivel "related_corridor": sólo participa cuando existe un catálogo
        # aprobado (Pricing/Ops/Procurement); sin catálogo queda deshabilitado.
        for candidate_level in (
            "same_state_pair",
            "same_regional_corridor",
            "related_corridor",
            "comparable_distance_equipment",
        ):
            frame = _level_frame(candidate_level)
            if not frame.empty:
                selected = frame
                level = candidate_level
                break
        if selected.empty:
            base.status = "applicable"
            base.comparison_level = "none"
            # Sin evidencia regional el conteo (0) es inferior al mínimo
            # aprobado de viajes; el nivel se clasifica como insufficient_evidence.
            base.regional_cost_level = "insufficient_evidence"
            base.message = (
                "No se encontraron viajes regionales comparables para este "
                "corredor dirigido."
            )
            return base, {}

        recent = selected[selected["cost_available_at"].ge(window_start)]
        if recent.empty:
            selected_window = selected
            history_window = "older_than_6_months"
            older_fallback = True
        else:
            selected_window = recent
            history_window = "recent_6_months"
            older_fallback = False

        groups = list(
            selected_window.groupby(
                ["state_corridor", "currency"], sort=False, dropna=False
            )
        )
        groups.sort(
            key=lambda item: (
                -len(item[1]),
                -item[1]["cost_available_at"].max().timestamp(),
                str(item[0]),
            )
        )
        summaries: list[RegionalRouteSummary] = []
        evidence: dict[str, dict[str, Any]] = {}
        for _, group in groups[: self.max_regional_route_summaries]:
            summary_base, citation = self._route_summary(group, "peer_segment")
            first = group.iloc[0]
            group_origin_region = first.get("origin_region")
            group_destination_region = first.get("destination_region")
            references = [
                str(value)
                for value in group.sort_values(
                    ["cost_available_at", "load_id"],
                    ascending=[False, True],
                    kind="stable",
                )["load_id"].head(5)
            ]
            carrier_groups = list(group.groupby("provider", sort=False, dropna=False))
            carrier_groups.sort(
                key=lambda item: (
                    -len(item[1]),
                    -item[1]["cost_available_at"].max().timestamp(),
                    str(item[0]),
                )
            )
            carriers = [
                self._carrier_summary(carrier_group)
                for _, carrier_group in carrier_groups[
                    : self.max_nearby_carriers_per_route
                ]
            ]
            regional_id = _stable_id(
                "hist-regional",
                level,
                first.get("state_corridor"),
                first.get("equipment_key"),
                first.get("currency"),
                group["cost_available_at"].max(),
            )
            summary = RegionalRouteSummary(
                **{
                    **summary_base.model_dump(),
                    "evidence_id": regional_id,
                },
                origin_state=str(first.get("origin_state") or ""),
                destination_state=str(first.get("destination_state") or ""),
                origin_region_label=(
                    segmentation.label(group_origin_region)
                    if pd.notna(group_origin_region)
                    else None
                ),
                destination_region_label=(
                    segmentation.label(group_destination_region)
                    if pd.notna(group_destination_region)
                    else None
                ),
                regional_corridor=(
                    f"{segmentation.label(group_origin_region)} -> "
                    f"{segmentation.label(group_destination_region)}"
                    if pd.notna(group_origin_region)
                    and pd.notna(group_destination_region)
                    else None
                ),
                comparison_level=level,
                distance_km_min=_number(group["distance_km"].min()),
                distance_km_max=_number(group["distance_km"].max()),
                period_start=(
                    group["cost_available_at"].min().to_pydatetime()
                    if not pd.isna(group["cost_available_at"].min())
                    else None
                ),
                period_end=(
                    group["cost_available_at"].max().to_pydatetime()
                    if not pd.isna(group["cost_available_at"].max())
                    else None
                ),
                reference_ids=references,
                carriers=carriers,
            )
            citation["evidence_id"] = regional_id
            citation["title"] = (
                f"Comparación regional {summary.origin_state.title()} → "
                f"{summary.destination_state.title()}"
            )
            citation["is_stale"] = older_fallback
            # El payload para OpenAI no incluye transportistas ni coordenadas
            # ni términos de agrupamiento; sólo el resumen comercial.
            citation["prompt_payload"] = {
                "evidence_id": regional_id,
                "comparison": f"regional_{level}",
                "origin_state": summary.origin_state,
                "destination_state": summary.destination_state,
                "origin_region": summary.origin_region_label,
                "destination_region": summary.destination_region_label,
                "directed_corridor": (
                    f"{summary.origin_state} -> {summary.destination_state}"
                ),
                "equipment": summary.equipment,
                "currency": summary.currency,
                "shipment_count": summary.shipment_count,
                "cost_low": summary.cost.low,
                "cost_usual": summary.cost.usual,
                "cost_high": summary.cost.high,
                "sale_all_in_usual": summary.all_in_rate_sale.usual,
                "margin_usual_percentage": summary.margin.usual_percentage,
                "negative_margin_records": summary.margin.negative_record_count,
                "distance_km_min": summary.distance_km_min,
                "distance_km_max": summary.distance_km_max,
                "period_start": (
                    summary.period_start.isoformat() if summary.period_start else None
                ),
                "period_end": (
                    summary.period_end.isoformat() if summary.period_end else None
                ),
                "latest_available_at": (
                    summary.latest_available_at.isoformat()
                    if summary.latest_available_at
                    else None
                ),
            }
            summaries.append(summary)
            evidence[regional_id] = citation

        valid_sale = selected_window[selected_window["all_in_rate_sale"].gt(0)]
        latest = selected_window["cost_available_at"].max()
        base.comparison_level = level
        base.route_count = len(summaries)
        base.comparable_count = int(len(selected_window))
        base.carrier_count = int(
            selected_window["provider"].replace("", np.nan).nunique()
        )
        base.negative_margin_count = int(
            valid_sale["calculated_margin_pct"].lt(0).sum()
        )
        base.latest_available_at = (
            latest.to_pydatetime() if not pd.isna(latest) else None
        )
        base.history_window = history_window
        base.older_history_fallback = older_fallback
        # Clasificar el nivel de costo regional con los umbrales aprobados.
        base.regional_cost_level = self._classify_regional_cost_level(
            comparable_count=int(len(selected_window)),
            regional_costs=selected_window["all_in_rate_cost"],
            quoted_cost=query.quoted_cost,
        )
        base.routes = summaries
        level_names = {
            "same_state_pair": "mismo par de estados (dirigido)",
            "same_regional_corridor": "mismo corredor regional (dirigido)",
            "related_corridor": (
                "corredor relacionado del catálogo aprobado (dirigido)"
            ),
            "comparable_distance_equipment": "distancia y equipo comparables",
        }
        age_note = (
            " Son viajes anteriores a los últimos seis meses y se muestran sólo "
            "como referencia histórica."
            if older_fallback
            else ""
        )
        base.message = (
            f"Se encontraron {base.comparable_count} viajes regionales por "
            f"{level_names[level]}. Es una referencia complementaria y no "
            "sustituye la ruta exacta ni las rutas cercanas." + age_note
        )
        return base, evidence

    def search(self, query: HistoricalQuery) -> HistoricalRetrieval:
        eligible = self._eligible(query)
        quote_timestamp = pd.Timestamp(query.quote_created_at)
        if quote_timestamp.tzinfo is None:
            quote_timestamp = quote_timestamp.tz_localize("UTC")
        else:
            quote_timestamp = quote_timestamp.tz_convert("UTC")
        window_start = quote_timestamp - pd.DateOffset(months=6)
        recent = eligible[eligible["cost_available_at"].ge(window_start)]
        older = eligible[eligible["cost_available_at"].lt(window_start)]
        nearby_support, nearby_evidence = self._nearby_support(
            eligible, query, window_start
        )
        regional_support, regional_evidence = self._regional_support(
            eligible, query, window_start
        )

        # Una coincidencia de la misma ruta, aunque sea antigua, es más útil
        # que sustituirla inmediatamente por otra ruta reciente.
        match_level, selected = self._select_level(
            recent, query, allow_peers=False
        )
        history_window = "recent_6_months"
        if selected.empty:
            match_level, selected = self._select_level(
                older, query, allow_peers=False
            )
            history_window = "older_than_6_months"
        if selected.empty:
            match_level, selected = self._select_level(recent, query)
            history_window = "recent_6_months"
        if selected.empty:
            match_level, selected = self._select_level(older, query)
            history_window = "older_than_6_months"

        if selected.empty:
            return HistoricalRetrieval(
                support=HistoricalSupport(
                    window_start_at=window_start.to_pydatetime(),
                    nearby_routes=nearby_support,
                    regional_support=regional_support,
                ),
                evidence={**nearby_evidence, **regional_evidence},
                internal_match_level="none",
            )
        older_fallback = history_window == "older_than_6_months"

        selected = selected.sort_values(
            ["cost_available_at", "evidence_id"], ascending=[False, True], kind="stable"
        )
        route_summaries: list[HistoricalRouteSummary] = []
        evidence: dict[str, dict[str, Any]] = {}
        grouped = list(selected.groupby(["route_key", "currency"], sort=False, dropna=False))
        grouped.sort(
            key=lambda item: (
                -len(item[1]),
                -item[1]["cost_available_at"].max().timestamp(),
                str(item[0]),
            )
        )
        for _, group in grouped[: self.max_route_summaries]:
            summary, citation = self._route_summary(group, match_level)
            route_summaries.append(summary)
            citation["is_stale"] = older_fallback
            evidence[summary.evidence_id] = citation

        carrier_summaries: list[CarrierRouteSummary] = []
        carrier_groups = list(
            selected.groupby(
                ["route_key", "currency", "provider"],
                sort=False,
                dropna=False,
            )
        )
        carrier_groups.sort(
            key=lambda item: (
                -len(item[1]),
                -item[1]["cost_available_at"].max().timestamp(),
                str(item[0]),
            )
        )
        for _, group in carrier_groups[: self.max_carrier_summaries]:
            carrier_summaries.append(self._carrier_summary(group))

        detailed: list[HistoricalRecord] = []
        for _, row in selected.head(self.max_records).iterrows():
            sale = (
                _number(row.get("all_in_rate_sale"))
                if row.get("all_in_rate_sale", 0) > 0
                else None
            )
            margin_amount = _number(row.get("calculated_margin_amount")) if sale is not None else None
            margin_percentage = _number(row.get("calculated_margin_pct")) if sale is not None else None
            reference_id = str(row.get("load_id") or row["evidence_id"])
            record = HistoricalRecord(
                evidence_id=reference_id,
                carrier=str(row.get("provider") or "") or None,
                shipment_date=(
                    row["quote_created_at"].to_pydatetime()
                    if not pd.isna(row["quote_created_at"])
                    else None
                ),
                origin=str(row.get("origin") or ""),
                destination=str(row.get("destination") or ""),
                division=str(row.get("division") or ""),
                equipment=str(row.get("equipment") or ""),
                service_type=str(row.get("range") or "") or None,
                operational_category=str(row.get("route_type") or "") or None,
                flow=str(row.get("flow") or "") or None,
                distance_km=_number(row.get("distance_km")),
                currency=str(row.get("currency") or "MXN").upper(),
                cost=float(row["all_in_rate_cost"]),
                all_in_rate_sale=sale,
                margin_amount=margin_amount,
                margin_percentage=margin_percentage,
                has_negative_margin=bool(
                    margin_percentage is not None and margin_percentage < 0
                ),
            )
            detailed.append(record)
            evidence[reference_id] = {
                "evidence_id": reference_id,
                "type": "historical_record",
                "title": f"Viaje histórico {reference_id}",
                "source": "Histórico de viajes facturados VAX",
                "excerpt": (
                    f"{record.origin} a {record.destination}; costo "
                    f"{_number(record.cost)}, venta all-in "
                    f"{record.all_in_rate_sale} y margen "
                    f"{record.margin_percentage}% {record.currency}."
                ),
                "url": None,
                "verified_at": (
                    row["cost_available_at"].date().isoformat()
                    if not pd.isna(row["cost_available_at"])
                    else None
                ),
                "is_stale": False,
                # No incluye cliente ni transportista: esos nombres permanecen
                # únicamente en la respuesta local de la interfaz.
                "prompt_payload": {
                    "evidence_id": reference_id,
                    "shipment_date": (
                        record.shipment_date.isoformat()
                        if record.shipment_date
                        else None
                    ),
                    "origin": record.origin,
                    "destination": record.destination,
                    "division": record.division,
                    "equipment": record.equipment,
                    "service_type": record.service_type,
                    "operational_category": record.operational_category,
                    "flow": record.flow,
                    "currency": record.currency,
                    "cost": _number(record.cost),
                    "sale_all_in": record.all_in_rate_sale,
                    "margin_amount": record.margin_amount,
                    "margin_percentage": record.margin_percentage,
                },
            }
            evidence[reference_id]["is_stale"] = older_fallback

        valid_sale_count = int(selected["all_in_rate_sale"].gt(0).sum())
        latest = selected["cost_available_at"].max()
        fluctuation = self._older_trend(selected) if older_fallback else None
        support = HistoricalSupport(
            comparison_basis=self._basis(match_level),
            comparable_count=int(len(selected)),
            cost_record_count=int(selected["all_in_rate_cost"].notna().sum()),
            sale_margin_record_count=valid_sale_count,
            carrier_count=int(selected["provider"].replace("", np.nan).nunique()),
            routes=route_summaries,
            carriers=carrier_summaries,
            records=detailed,
            latest_available_at=latest.to_pydatetime() if not pd.isna(latest) else None,
            history_window=history_window,
            window_start_at=window_start.to_pydatetime(),
            older_history_fallback=older_fallback,
            fluctuation=fluctuation,
            nearby_routes=nearby_support,
            regional_support=regional_support,
            message=(
                fluctuation.message
                if fluctuation is not None
                else self._message(match_level, len(selected))
            ),
        )
        return HistoricalRetrieval(
            support=support,
            evidence={**evidence, **nearby_evidence, **regional_evidence},
            internal_match_level=match_level,
        )
