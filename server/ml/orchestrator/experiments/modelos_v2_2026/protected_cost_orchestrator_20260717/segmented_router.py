"""Policy router for the experimental protected-cost interface.

The router is deliberately separated from model inference.  It consumes only
point-in-time prediction diagnostics and never a realized cost.  Its output is
advisory, shadow-only and always requires a person to approve the quote.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Mapping

import numpy as np


@dataclass(frozen=True)
class RouterConfig:
    decile_edges_mxn: tuple[float, ...]
    protected_deciles: tuple[str, ...] = ("D7", "D8", "D10")
    low_history_max: int = 3
    policy_version: str = "shadow_segmented_v1"
    decile_status: str = "provisional_posthoc_2026"

    @classmethod
    def from_json(cls, path: str | Path) -> "RouterConfig":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(
            decile_edges_mxn=tuple(float(value) for value in payload["decile_edges_mxn"]),
            protected_deciles=tuple(payload.get("protected_deciles", ("D7", "D8", "D10"))),
            low_history_max=int(payload.get("low_history_max", 3)),
            policy_version=str(payload.get("policy_version", "shadow_segmented_v1")),
            decile_status=str(payload.get("decile_status", "provisional_posthoc_2026")),
        )

    def validate(self) -> None:
        if len(self.decile_edges_mxn) != 9:
            raise ValueError("decile_edges_mxn must contain the nine D1-D10 boundaries")
        if any(right <= left for left, right in zip(self.decile_edges_mxn, self.decile_edges_mxn[1:])):
            raise ValueError("decile_edges_mxn must be strictly increasing")


def _finite_positive(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) and number > 0 else None


def _finite(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def _normalise(value: object) -> str:
    return str(value or "").strip().lower().replace("_", " ")


def predicted_decile(prediction_mxn: object, config: RouterConfig) -> str:
    """Assign a frozen prediction decile without consulting the realized cost."""
    config.validate()
    prediction = _finite_positive(prediction_mxn)
    if prediction is None:
        return "unavailable"
    number = int(np.searchsorted(np.asarray(config.decile_edges_mxn), prediction, side="right") + 1)
    return f"D{number}"


def route_shadow_decision(
    quote: Mapping[str, object],
    prediction: Mapping[str, object],
    *,
    config: RouterConfig,
    hybrid_prediction_mxn: object = None,
) -> dict[str, object]:
    """Combine Geo central routing, P67 protection and strict abstention.

    Precedence is explicit: Crossborder stays with the incumbent; National uses
    the Geo model exclusively (100 %) for new/low-history routes with coordinates;
    P67 is an overlay for selected commercial-risk segments. All outcomes remain
    shadow decisions pending prospective proof.
    """
    champion = _finite_positive(prediction.get("champion_prediction_mxn"))
    geo = _finite_positive(prediction.get("geo_prediction_mxn"))
    q67 = _finite_positive(prediction.get("raw_q67_mxn"))
    integration_central = _finite_positive(prediction.get("central_prediction_mxn"))
    integration_protected = _finite_positive(prediction.get("protected_cost_mxn"))
    hybrid = _finite_positive(hybrid_prediction_mxn)

    division = _normalise(quote.get("DIVISION_key"))
    equipment_guardrail = str(prediction.get("equipment_guardrail") or "standard")
    try:
        history = max(int(float(prediction.get("route_history_count", 0))), 0)
    except (TypeError, ValueError):
        history = 0

    reasons: list[str] = []
    coordinates = [
        _finite(quote.get("origin_lat")),
        _finite(quote.get("origin_lng")),
        _finite(quote.get("destination_lat")),
        _finite(quote.get("destination_lng")),
    ]
    coordinates_available = all(value is not None for value in coordinates)
    if division == "national" and geo is not None and history <= config.low_history_max and coordinates_available:
        central = integration_central or champion
        central_model = "lightgbm_geo_hierarchical"
        reasons.append("national_geo_hierarchical_support")
    else:
        central = champion or integration_central
        central_model = "lightgbm_incumbent"
        reasons.append("lightgbm_incumbent")
        if division == "national" and history <= config.low_history_max and not coordinates_available:
            reasons.append("geo_coordinates_unavailable")

    decile = predicted_decile(champion or central, config)
    use_p67 = False
    if division == "crossborder":
        reasons.append("crossborder_keeps_incumbent")
    else:
        if equipment_guardrail != "standard":
            use_p67 = True
            reasons.append(f"special_equipment:{equipment_guardrail}")
        if division in {"port freight", "portfreight", "port-freight"}:
            use_p67 = True
            reasons.append("division:port_freight")
        if history == 0:
            use_p67 = True
            reasons.append("route:new")
        elif history <= config.low_history_max:
            use_p67 = True
            reasons.append("route:low_history")
        if decile in config.protected_deciles:
            use_p67 = True
            reasons.append(f"protected_prediction_decile:{decile}")

    calibrated_protected = (
        max([value for value in (central, integration_protected) if value is not None], default=None)
        if integration_protected is not None
        else max([value for value in (central, q67) if value is not None], default=None)
    )
    candidates = [value for value in (central, calibrated_protected) if value is not None]
    if not candidates:
        selected = None
    elif use_p67:
        selected = max(candidates)
    else:
        selected = central

    full_combination = integration_protected
    selected_model = f"{central_model}+p67" if use_p67 else central_model

    try:
        strict_reasons = json.loads(str(prediction.get("guardrail_reasons") or "[]"))
        if not isinstance(strict_reasons, list):
            strict_reasons = [str(strict_reasons)]
    except json.JSONDecodeError:
        strict_reasons = [str(prediction.get("guardrail_reasons"))]

    strict_review = bool(strict_reasons)
    market_review = history == 0 or equipment_guardrail != "standard" or strict_review or not coordinates_available
    if selected is None:
        market_review = True
        reasons.append("prediction_unavailable")
    if q67 is None and use_p67:
        market_review = True
        reasons.append("p67_unavailable")

    action = (
        "No emitir una tarifa desde esta salida. Resolver primero las abstenciones estrictas y documentar la revision humana."
        if strict_review
        else
        "Solicitar validacion de Operaciones/Procurement antes de emitir una tarifa; "
        "la ruta es nueva o tiene un guardrail especial."
        if market_review
        else "Comparar contra la tarifa del carrier y registrar la decision; no enviar automaticamente."
    )
    return {
        "policy_version": config.policy_version,
        "mode": "shadow_only",
        "auto_quote": False,
        "review_required": True,
        "market_review_required": market_review,
        "strict_review_required": strict_review,
        "decision_blocked": strict_review,
        "selected_model": selected_model,
        "selected_cost_mxn": selected,
        "central_cost_mxn": central,
        "central_model": central_model,
        "full_combination_mxn": full_combination,
        "p67_applied": use_p67,
        "prediction_decile": decile,
        "decile_status": config.decile_status,
        "route_history_count": history,
        "history_level": "new" if history == 0 else "low_history" if history <= config.low_history_max else "supported",
        "equipment_guardrail": equipment_guardrail,
        "reasons": sorted(set(reasons)),
        "strict_guardrail_reasons": sorted(set(str(item) for item in strict_reasons)),
        "action": action,
        "components": {
            "lightgbm_mxn": champion,
            "national_geo_mxn": geo,
            "quantile_p67_mxn": q67,
            "national_hybrid_mxn": hybrid,
            "integration_blend_mxn": integration_central,
            "integration_protected_mxn": integration_protected,
            "full_combination_mxn": full_combination,
        },
    }
