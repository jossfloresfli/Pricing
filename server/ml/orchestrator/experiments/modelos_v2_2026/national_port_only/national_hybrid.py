from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

try:  # Persistence is training-only in the ONNX inference package.
    import joblib
except ImportError:  # pragma: no cover
    joblib = None

import national_port_pipeline as pipeline


HYBRID_WEIGHT = 0.50
MIN_ROUTE_EQUIPMENT_HISTORY = 1
EXCLUDED_EQUIPMENT = ("ltl",)
ALLOWED_DIVISIONS = ("national", "port freight")


def build_bundle(base_bundle: dict, experiment_bundle: dict) -> dict:
    return {
        "artifact_type": "national_route_equipment_hybrid_challenger",
        "status": "shadow_challenger",
        "target": pipeline.TARGET,
        "allowed_divisions": list(ALLOWED_DIVISIONS),
        "blocked_policy": "manual quote; no automatic price",
        "base_bundle": base_bundle,
        "national_specialist": experiment_bundle["models"]["separate_equipment"]["national"],
        "support_maps": experiment_bundle["support_maps"],
        "uncertainty_q95_mxn": experiment_bundle["uncertainty_q95_mxn"],
        "routing": {
            "division": "national",
            "minimum_route_equipment_history": MIN_ROUTE_EQUIPMENT_HISTORY,
            "excluded_equipment": list(EXCLUDED_EQUIPMENT),
            "base_weight": 1.0 - HYBRID_WEIGHT,
            "specialist_weight": HYBRID_WEIGHT,
            "port_freight": "base_only",
            "other_divisions": "manual_review",
        },
        "required_features": pipeline.CATEGORICAL_INPUTS + pipeline.NUMERIC_INPUTS,
        "training_end": experiment_bundle["training_end"],
        "validation_note": "National 2026 is post-hoc audit and is not an untouched promotion holdout",
    }


def save_bundle(bundle: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, path)


def load_bundle(path: Path) -> dict:
    return joblib.load(path)


def _support_values(bundle: dict, data: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    route_equipment_key = data["route_key"] + "|" + data["Tipo de Equipo_key"]
    route_equipment = route_equipment_key.map(bundle["support_maps"]["route_equipment"]).fillna(0).to_numpy(int)
    route = data["route_key"].map(bundle["support_maps"]["route_key"]).fillna(0).to_numpy(int)
    client = data["CLIENTE_key"].map(bundle["support_maps"]["CLIENTE_key"]).fillna(0).to_numpy(int)
    equipment = data["Tipo de Equipo_key"].map(bundle["support_maps"]["Tipo de Equipo_key"]).fillna(0).to_numpy(int)
    return route_equipment, route, client, equipment


def _confidence(
    data: pd.DataFrame,
    route_equipment: np.ndarray,
    route: np.ndarray,
    client: np.ndarray,
    equipment: np.ndarray,
    disagreement: np.ndarray,
    hybrid_mask: np.ndarray,
) -> np.ndarray:
    support = (
        0.35 * np.minimum(route / 8.0, 1.0)
        + 0.20 * np.minimum(client / 20.0, 1.0)
        + 0.20 * np.minimum(equipment / 20.0, 1.0)
        + 0.25 * np.minimum(route_equipment / 5.0, 1.0)
    )
    confidence = 25.0 + 70.0 * support
    relative_disagreement = disagreement / np.maximum(1.0, 0.5 * disagreement + 30000.0)
    confidence = confidence - np.where(hybrid_mask, np.minimum(20.0, 100.0 * relative_disagreement), 0.0)
    important = data[["ORIGEN_key", "DESTINO_key", "route_key", "Tipo de Equipo_key"]].eq(pipeline.MISSING).sum(axis=1).to_numpy()
    confidence = confidence * np.maximum(0.4, 1.0 - 0.15 * important)
    return np.round(np.clip(confidence, 15.0, 95.0), 1)


def predict(bundle: dict, quotes: pd.DataFrame) -> pd.DataFrame:
    data = pipeline.prepare_inference(quotes)
    for column in bundle["base_bundle"]["categorical"]:
        if column not in data:
            data[column] = pipeline.MISSING
        else:
            data[column] = data[column].map(pipeline.normalize_text)
    for column in bundle["base_bundle"]["numeric"]:
        if column not in data:
            data[column] = np.nan
        else:
            data[column] = pd.to_numeric(data[column], errors="coerce")
    allowed = data["DIVISION_key"].isin(bundle["allowed_divisions"]).to_numpy()
    national = data["DIVISION_key"].eq("national").to_numpy()
    port_freight = data["DIVISION_key"].eq("port freight").to_numpy()

    route_equipment, route, client, equipment = _support_values(bundle, data)
    excluded_equipment = data["Tipo de Equipo_key"].isin(bundle["routing"]["excluded_equipment"]).to_numpy()
    hybrid_mask = (
        national
        & (route_equipment >= bundle["routing"]["minimum_route_equipment_history"])
        & ~excluded_equipment
    )

    base_prediction = np.full(len(data), np.nan)
    specialist_prediction = np.full(len(data), np.nan)
    final_prediction = np.full(len(data), np.nan)
    specialist_weight = np.zeros(len(data), dtype=float)
    model_path = np.full(len(data), "manual_review", dtype=object)
    fallback_reason = np.full(len(data), "division_out_of_model_scope", dtype=object)

    if allowed.any():
        base_prediction[allowed] = pipeline.predict_incumbent_bundle(bundle["base_bundle"], data[allowed])
        final_prediction[allowed] = base_prediction[allowed]
        model_path[allowed] = "base_only"
        fallback_reason[allowed] = "base_policy"
    if hybrid_mask.any():
        specialist_prediction[hybrid_mask] = pipeline.predict_ensemble(bundle["national_specialist"], data[hybrid_mask])
        weight = float(bundle["routing"]["specialist_weight"])
        final_prediction[hybrid_mask] = (
            (1.0 - weight) * base_prediction[hybrid_mask]
            + weight * specialist_prediction[hybrid_mask]
        )
        specialist_weight[hybrid_mask] = weight
        model_path[hybrid_mask] = "national_hybrid_50_50"
        fallback_reason[hybrid_mask] = "supported_route_equipment"

    national_unseen = national & (route_equipment < bundle["routing"]["minimum_route_equipment_history"])
    national_ltl = national & excluded_equipment
    model_path[national_unseen] = "base_route_equipment_fallback"
    fallback_reason[national_unseen] = "insufficient_route_equipment_history"
    model_path[national_ltl] = "base_equipment_guardrail"
    fallback_reason[national_ltl] = "excluded_equipment_ltl"
    model_path[port_freight] = "base_port_freight"
    fallback_reason[port_freight] = "port_freight_base_policy"

    disagreement = np.nan_to_num(np.abs(specialist_prediction - base_prediction), nan=0.0)
    confidence = np.zeros(len(data), dtype=float)
    if allowed.any():
        confidence[allowed] = _confidence(
            data[allowed], route_equipment[allowed], route[allowed], client[allowed], equipment[allowed],
            disagreement[allowed], hybrid_mask[allowed],
        )

    uncertainty = bundle["uncertainty_q95_mxn"]
    q95 = np.full(len(data), np.nan)
    augmented = pipeline.add_interactions(data)
    for position, (_, row) in enumerate(augmented.iterrows()):
        if not allowed[position]:
            continue
        value = uncertainty["equipment_family"].get(row["equipment_family"])
        if value is None:
            value = uncertainty["division"].get(row["DIVISION_key"], uncertainty["global"])
        q95[position] = float(value) + (0.5 * disagreement[position] if hybrid_mask[position] else 0.0)
    interval_low = np.maximum(final_prediction - q95, 0.0)
    interval_high = final_prediction + q95

    return pd.DataFrame({
        "cost_mxn_prediction": final_prediction,
        "base_prediction_mxn": base_prediction,
        "specialist_prediction_mxn": specialist_prediction,
        "specialist_weight": specialist_weight,
        "route_equipment_history": route_equipment,
        "interval_low_mxn": interval_low,
        "interval_high_mxn": interval_high,
        "confidence_pct": confidence,
        "requires_manual_quote": ~allowed,
        "division_used": data["DIVISION_key"].to_numpy(),
        "model_path": model_path,
        "fallback_reason": fallback_reason,
    }, index=quotes.index)
