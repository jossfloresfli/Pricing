"""Guardrails and abstention policy for the shadow protected-cost challenger."""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Iterable

import numpy as np
import pandas as pd


MISSING_VALUES = {"", "__missing__", "missing", "unknown", "nan", "none", "null"}
SPECIAL_EQUIPMENT = {
    "pipa": ("pipa", "tanker", "tank trailer", "cisterna"),
    "hazmat": ("hazmat", "material peligroso", "dangerous goods"),
    "full_container_40": (
        "full container 40",
        "container 40",
        "contenedor 40",
        "fcl 40",
        "40ft",
        "40 ft",
        "40 pies",
    ),
}


@dataclass(frozen=True)
class GuardrailConfig:
    critical_features: tuple[str, ...] = (
        "ORIGEN_key",
        "DESTINO_key",
        "route_key",
        "Tipo de Equipo_key",
        "DIVISION_key",
    )
    special_equipment_min_route_history: int = 4
    minimum_confidence_pct: float = 45.0
    maximum_relative_interval_width: float = 1.25
    maximum_model_disagreement_ratio: float = 0.40
    maximum_protection_uplift_ratio: float = 0.50
    maximum_cost_per_km_mxn: float = 500.0
    minimum_cost_per_km_mxn: float = 1.0
    require_fitted_calibrator_for_auto_quote: bool = True
    supported_currencies: tuple[str, ...] = ("mxn", "mexican peso", "peso mexicano")


def _normalise(value: object) -> str:
    if pd.isna(value):
        return "__missing__"
    text = str(value).strip().lower()
    return text or "__missing__"


def _truthy(value: object) -> bool:
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, float)) and not pd.isna(value):
        return float(value) != 0.0
    return _normalise(value) in {"true", "yes", "si", "sí", "1", "hazmat"}


def equipment_guardrail(quotes: pd.DataFrame) -> pd.Series:
    equipment = quotes.get("Tipo de Equipo_key", pd.Series("__missing__", index=quotes.index)).map(_normalise)
    output = pd.Series("standard", index=quotes.index, dtype="object")
    for guardrail, tokens in SPECIAL_EQUIPMENT.items():
        mask = equipment.map(lambda value: any(token in value for token in tokens))
        output.loc[mask] = guardrail
    for hazmat_column in ("hazmat", "is_hazmat", "HAZMAT", "Material Peligroso"):
        if hazmat_column in quotes:
            output.loc[quotes[hazmat_column].map(_truthy)] = "hazmat"
    return output


class GuardrailPolicy:
    """Translate model diagnostics into eligibility or human-review abstention.

    ``auto_quote`` is counterfactual eligibility for a future pilot.  The
    orchestrator remains shadow-only and never sends or mutates a quote.
    """

    def __init__(self, config: GuardrailConfig | None = None) -> None:
        self.config = config or GuardrailConfig()

    @staticmethod
    def _number(row: pd.Series, column: str) -> float:
        try:
            value = float(row.get(column, np.nan))
        except (TypeError, ValueError):
            return float("nan")
        return value

    def _reasons(self, quote: pd.Series, prediction: pd.Series, calibrator_fitted: bool) -> list[str]:
        reasons: list[str] = []
        for column in self.config.critical_features:
            if _normalise(quote.get(column, "__missing__")) in MISSING_VALUES:
                reasons.append(f"missing_critical:{column}")

        currency = _normalise(quote.get("currency", "__missing__"))
        if currency in MISSING_VALUES:
            reasons.append("currency_unconfirmed")
        elif currency not in self.config.supported_currencies:
            reasons.append("currency_not_mxn")

        champion = self._number(prediction, "champion_prediction_mxn")
        central = self._number(prediction, "central_prediction_mxn")
        protected = self._number(prediction, "protected_cost_mxn")
        interval_low = self._number(prediction, "interval_low_mxn")
        interval_high = self._number(prediction, "interval_high_mxn")
        route_history = self._number(prediction, "route_history_count")

        if not np.isfinite(champion) or champion <= 0:
            reasons.append("champion_prediction_unavailable")
        if not np.isfinite(central) or central <= 0:
            reasons.append("central_prediction_unavailable")
        if not np.isfinite(protected) or protected <= 0:
            reasons.append("protected_cost_unavailable")
        elif np.isfinite(central) and protected + 1e-9 < central:
            reasons.append("protected_below_central")

        if np.isfinite(interval_low) and np.isfinite(interval_high) and np.isfinite(central) and central > 0:
            if interval_low < 0 or interval_high < interval_low:
                reasons.append("invalid_prediction_interval")
            elif (interval_high - interval_low) / central > self.config.maximum_relative_interval_width:
                reasons.append("prediction_interval_too_wide")
        else:
            reasons.append("prediction_interval_unavailable")

        confidence = self._number(prediction, "hybrid_confidence_pct")
        if np.isfinite(confidence) and confidence < self.config.minimum_confidence_pct:
            reasons.append("low_hybrid_confidence")

        geo = self._number(prediction, "geo_prediction_mxn")
        hybrid = self._number(prediction, "hybrid_prediction_mxn")
        alternatives = [value for value in (geo, hybrid) if np.isfinite(value) and value > 0]
        if np.isfinite(champion) and champion > 0 and alternatives:
            disagreement = max(abs(value - champion) / champion for value in alternatives)
            if disagreement > self.config.maximum_model_disagreement_ratio:
                reasons.append("model_disagreement_too_high")

        if np.isfinite(central) and central > 0 and np.isfinite(protected):
            if (protected - central) / central > self.config.maximum_protection_uplift_ratio:
                reasons.append("protection_uplift_too_high")

        distance = self._number(quote, "google_distance_km")
        if np.isfinite(distance) and distance > 0 and np.isfinite(protected):
            cost_per_km = protected / distance
            if cost_per_km > self.config.maximum_cost_per_km_mxn:
                reasons.append("cost_per_km_above_guardrail")
            if cost_per_km < self.config.minimum_cost_per_km_mxn:
                reasons.append("cost_per_km_below_guardrail")

        guardrail = str(prediction.get("equipment_guardrail", "standard"))
        if guardrail != "standard" and (not np.isfinite(route_history) or route_history < self.config.special_equipment_min_route_history):
            reasons.append(f"{guardrail}:insufficient_route_history")
        if guardrail != "standard" and str(prediction.get("prediction_decile", "unavailable")) == "unavailable":
            reasons.append(f"{guardrail}:uncalibrated_segment")

        if bool(prediction.get("hybrid_requires_manual_quote", False)):
            reasons.append("national_hybrid_manual_review")
        if prediction.get("component_errors"):
            reasons.append("component_failure")
        if self.config.require_fitted_calibrator_for_auto_quote and not calibrator_fitted:
            reasons.append("calibrator_not_fitted")
        return sorted(set(reasons))

    def evaluate(
        self,
        quotes: pd.DataFrame,
        predictions: pd.DataFrame,
        *,
        calibrator_fitted: bool,
    ) -> pd.DataFrame:
        if len(quotes) != len(predictions):
            raise ValueError("quotes and predictions must have the same length")
        quote_rows = quotes.reset_index(drop=True)
        prediction_rows = predictions.reset_index(drop=True).copy()
        guards = equipment_guardrail(quote_rows).reset_index(drop=True)
        prediction_rows["equipment_guardrail"] = guards
        reasons = [
            self._reasons(quote_rows.iloc[position], prediction_rows.iloc[position], calibrator_fitted)
            for position in range(len(quote_rows))
        ]
        if "quote_row_id" not in quote_rows:
            for item in reasons:
                item.append("stable_row_id_missing")
        else:
            stable_ids = quote_rows["quote_row_id"].map(_normalise)
            invalid = stable_ids.isin(MISSING_VALUES) | stable_ids.duplicated(keep=False)
            for position in np.flatnonzero(invalid.to_numpy()):
                reasons[position].append("stable_row_id_missing")
        reasons = [sorted(set(item)) for item in reasons]
        review = np.asarray([bool(item) for item in reasons], dtype=bool)
        return pd.DataFrame(
            {
                "equipment_guardrail": guards.to_numpy(),
                "auto_quote": ~review,
                "review_required": review,
                "decision_status": np.where(review, "review_required", "shadow_auto_eligible"),
                "guardrail_reasons": [json.dumps(item, ensure_ascii=False, separators=(",", ":")) for item in reasons],
            },
            index=quotes.index,
        )
