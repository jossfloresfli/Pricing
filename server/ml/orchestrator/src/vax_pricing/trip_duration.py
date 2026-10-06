from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd


RULE_VERSION = "NOM-087-SCT-2-2017_v1"


@dataclass(frozen=True)
class DurationRules:
    continuous_drive_hours: float = 5.0
    short_break_hours: float = 0.5
    daily_drive_hours: float = 14.0
    daily_rest_hours: float = 8.0


@dataclass(frozen=True)
class TripDurationEstimate:
    equipment_family: str
    speed_kmh: float
    driving_hours: float
    short_break_count: int
    short_break_hours: float
    daily_rest_count: int
    daily_rest_hours: float
    total_hours: float
    total_days: float
    used_speed_fallback: bool
    rule_version: str = RULE_VERSION

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


EQUIPMENT_SPEED_RULES = (
    ("heavy_special", 50.0, ("hazmat", "pipa", "tanker", "lowboy", "double drop", "full ")),
    ("light_or_ltl", 65.0, ("ltl", "1.5", "3.5", "sprinter", "cargo van")),
    ("medium_truck", 60.0, ("rabon", "torton")),
    ("temperature_controlled", 55.0, ("reefer", "refriger")),
    ("open_deck", 55.0, ("flatbed", "stepdeck")),
    ("container", 55.0, ("container", "contenedor")),
    ("dry_van", 60.0, ("dryvan", "dry van", "caja seca")),
)
DEFAULT_SPEED_KMH = 55.0


def _normalize(value: object) -> str:
    text = "" if value is None else str(value).strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", text)


def speed_for_equipment(equipment: object) -> tuple[str, float, bool]:
    normalized = _normalize(equipment)
    for family, speed_kmh, patterns in EQUIPMENT_SPEED_RULES:
        if any(pattern in normalized for pattern in patterns):
            return family, speed_kmh, False
    return "unknown", DEFAULT_SPEED_KMH, True


def estimate_trip_duration(
    distance_km: float,
    equipment: object,
    rules: DurationRules = DurationRules(),
) -> TripDurationEstimate:
    distance = float(distance_km)
    if not math.isfinite(distance) or distance < 0:
        raise ValueError("La distancia debe ser un numero finito mayor o igual a cero.")
    if min(
        rules.continuous_drive_hours,
        rules.short_break_hours,
        rules.daily_drive_hours,
        rules.daily_rest_hours,
    ) <= 0:
        raise ValueError("Las reglas de duracion deben ser mayores a cero.")

    family, speed_kmh, used_fallback = speed_for_equipment(equipment)
    driving_hours = distance / speed_kmh
    remaining = driving_hours
    continuous_drive = 0.0
    daily_drive = 0.0
    daily_elapsed = 0.0
    short_break_count = 0
    daily_rest_count = 0
    accumulated_daily_rest_hours = 0.0
    epsilon = 1e-9

    while remaining > epsilon:
        available_continuous = rules.continuous_drive_hours - continuous_drive
        available_daily = rules.daily_drive_hours - daily_drive
        drive_block = min(remaining, available_continuous, available_daily)
        remaining -= drive_block
        continuous_drive += drive_block
        daily_drive += drive_block
        daily_elapsed += drive_block

        if remaining <= epsilon:
            break
        if daily_drive >= rules.daily_drive_hours - epsilon:
            daily_rest_count += 1
            required_rest = max(rules.daily_rest_hours, 24.0 - daily_elapsed)
            accumulated_daily_rest_hours += required_rest
            daily_drive = 0.0
            daily_elapsed = 0.0
            continuous_drive = 0.0
        elif continuous_drive >= rules.continuous_drive_hours - epsilon:
            short_break_count += 1
            daily_elapsed += rules.short_break_hours
            continuous_drive = 0.0

    short_break_hours = short_break_count * rules.short_break_hours
    daily_rest_hours = accumulated_daily_rest_hours
    total_hours = driving_hours + short_break_hours + daily_rest_hours
    return TripDurationEstimate(
        equipment_family=family,
        speed_kmh=speed_kmh,
        driving_hours=driving_hours,
        short_break_count=short_break_count,
        short_break_hours=short_break_hours,
        daily_rest_count=daily_rest_count,
        daily_rest_hours=daily_rest_hours,
        total_hours=total_hours,
        total_days=total_hours / 24.0,
        used_speed_fallback=used_fallback,
    )


def add_trip_duration_features(
    frame: pd.DataFrame,
    distance_column: str = "google_distance_km",
    equipment_column: str = "Tipo de Equipo",
) -> pd.DataFrame:
    if distance_column not in frame.columns or equipment_column not in frame.columns:
        missing = [column for column in (distance_column, equipment_column) if column not in frame.columns]
        raise KeyError(f"Faltan columnas para calcular duracion: {missing}")

    enriched = frame.copy()
    estimates: list[TripDurationEstimate | None] = []
    for distance, equipment in zip(enriched[distance_column], enriched[equipment_column]):
        numeric_distance = pd.to_numeric(distance, errors="coerce")
        if pd.isna(numeric_distance) or float(numeric_distance) < 0:
            estimates.append(None)
        else:
            estimates.append(estimate_trip_duration(float(numeric_distance), equipment))

    columns = {
        "estimated_equipment_family": "equipment_family",
        "estimated_avg_speed_kmh": "speed_kmh",
        "estimated_driving_hours": "driving_hours",
        "estimated_short_break_count": "short_break_count",
        "estimated_short_break_hours": "short_break_hours",
        "estimated_daily_rest_count": "daily_rest_count",
        "estimated_daily_rest_hours": "daily_rest_hours",
        "estimated_trip_duration_hours": "total_hours",
        "estimated_trip_duration_days": "total_days",
        "duration_speed_fallback": "used_speed_fallback",
        "duration_rule_version": "rule_version",
    }
    for output_column, attribute in columns.items():
        enriched[output_column] = [
            np.nan if estimate is None else getattr(estimate, attribute) for estimate in estimates
        ]
    return enriched
