from __future__ import annotations

import json
import math
import platform
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

try:  # Training-only dependencies; not needed by the ONNX inference package.
    import joblib
    import lightgbm as lgb
    from sklearn.cluster import KMeans
    from sklearn.metrics import mean_absolute_error, mean_squared_error
except ImportError:  # pragma: no cover
    joblib = lgb = KMeans = mean_absolute_error = mean_squared_error = None


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src"))
from vax_pricing.trip_duration import RULE_VERSION, add_trip_duration_features


TARGET_SOURCE = "All in rate costo total_num"
TARGET = "all_in_transport_cost_total"
DATE = "FECHA CREACIÓN_dt"
DIVISION = "national"
MISSING = "__missing__"
SEEDS = (42, 2026, 9001)
EXCLUDED_EQUIPMENT = frozenset({"ltl"})

RAW_CATEGORICAL = [
    "CLIENTE_key", "PROVEEDOR_key", "ORIGEN_key", "DESTINO_key", "route_key",
    "Tipo de Equipo_key", "DIVISION_key", "RANGO_key", "route_type",
]
BASE_NUMERIC = ["mes_creacion", "trimestre_creacion", "dia_semana_creacion", "google_distance_km"]
COORDINATES = ["origin_lat", "origin_lng", "destination_lat", "destination_lng"]
ELEVATION_NUMERIC = [
    "origin_elevation_m", "destination_elevation_m", "elevation_delta_m",
    "elevation_gain_m", "elevation_loss_m", "elevation_change_per_km",
]
DURATION_NUMERIC = [
    "estimated_avg_speed_kmh", "estimated_driving_hours",
    "estimated_short_break_count", "estimated_short_break_hours",
    "estimated_daily_rest_count", "estimated_daily_rest_hours",
    "estimated_trip_duration_hours",
]
FORBIDDEN_TOKENS = ("peso", "weight", "volumen", "volume", "accesorial", "accessorial")

CONFIG = {
    "months": 12,
    "trim_low": 0.005,
    "trim_high": 0.995,
    "half_life_days": 240,
    "clusters": 14,
    "history_smoothing": 12.0,
    "history_blocks": 6,
    "provider_dropout": 0.65,
    "underprediction_cost": 2.0,
}
PARAMS = {
    "objective": "regression_l1",
    "n_estimators": 650,
    "learning_rate": 0.025,
    "num_leaves": 20,
    "min_child_samples": 35,
    "subsample": 0.85,
    "subsample_freq": 1,
    "colsample_bytree": 0.85,
    "reg_alpha": 0.5,
    "reg_lambda": 3.0,
    "n_jobs": 1,
    "verbosity": -1,
}


@dataclass(frozen=True)
class Fold:
    name: str
    start: pd.Timestamp
    end: pd.Timestamp


FOLDS = (
    Fold("2025_Q2", pd.Timestamp("2025-04-01"), pd.Timestamp("2025-07-01")),
    Fold("2025_Q3", pd.Timestamp("2025-07-01"), pd.Timestamp("2025-10-01")),
    Fold("2025_Q4", pd.Timestamp("2025-10-01"), pd.Timestamp("2026-01-01")),
)


def normalize(value: object) -> str:
    if pd.isna(value):
        return MISSING
    text = str(value).strip().lower()
    return text or MISSING


def equipment_family(value: object) -> str:
    value = normalize(value)
    if "dryvan" in value or "dry van" in value or "caja seca" in value:
        return "dryvan"
    if "reefer" in value or "refriger" in value:
        return "refrigerated"
    if "flatbed" in value or "plataforma" in value:
        return "flatbed"
    if "container" in value or "contenedor" in value:
        return "container"
    if "ltl" in value:
        return "ltl"
    if any(token in value for token in ("torton", "rabon", "3.5", "1.5")):
        return "local_truck"
    return "other"


def load_data(data_path: Path, cache_path: Path) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    raw = pd.read_csv(data_path, encoding="utf-8-sig", low_memory=False)
    cache = pd.read_csv(cache_path, encoding="utf-8-sig", low_memory=False)
    raw[DATE] = pd.to_datetime(raw[DATE], errors="coerce")
    source = pd.to_numeric(raw[TARGET_SOURCE], errors="coerce")
    alias = pd.to_numeric(raw["cost_mxn"], errors="coerce")
    comparable = source.notna() & alias.notna()
    assert np.allclose(source[comparable], alias[comparable]), "cost_mxn no coincide con el target fuente"
    candidate = raw["is_training_candidate"].astype(str).str.lower().eq("true")
    national = raw["DIVISION_key"].map(normalize).eq(DIVISION)
    equipment = raw["Tipo de Equipo_key"].map(normalize)
    excluded_equipment = equipment.isin(EXCLUDED_EQUIPMENT)
    excluded_rows = int((candidate & national & excluded_equipment & raw[DATE].notna() & source.gt(0)).sum())
    raw = raw.loc[
        candidate & national & ~excluded_equipment & raw[DATE].notna() & source.gt(0)
    ].copy()
    raw[TARGET] = pd.to_numeric(raw[TARGET_SOURCE], errors="coerce")
    for column in RAW_CATEGORICAL:
        raw[column] = raw[column].map(normalize)
    for column in BASE_NUMERIC:
        raw[column] = pd.to_numeric(raw[column], errors="coerce")

    geo_columns = [
        "route_key", "google_origin_lat", "google_origin_lng",
        "google_destination_lat", "google_destination_lng",
        "google_origin_elevation_m", "google_destination_elevation_m",
    ]
    cache = cache[geo_columns].drop_duplicates("route_key", keep="last").rename(columns={
        "google_origin_lat": "origin_lat",
        "google_origin_lng": "origin_lng",
        "google_destination_lat": "destination_lat",
        "google_destination_lng": "destination_lng",
        "google_origin_elevation_m": "origin_elevation_m",
        "google_destination_elevation_m": "destination_elevation_m",
    })
    raw = raw.merge(cache, on="route_key", how="left", validate="many_to_one")
    for column in COORDINATES:
        raw[column] = pd.to_numeric(raw[column], errors="coerce")
    raw = add_elevation(raw)
    raw = add_trip_duration_features(
        raw,
        distance_column="google_distance_km",
        equipment_column="Tipo de Equipo_key",
    )
    raw = raw.sort_values(DATE).reset_index(drop=True)
    assert raw["DIVISION_key"].eq(DIVISION).all()
    assert not any(token in column.lower() for column in RAW_CATEGORICAL + BASE_NUMERIC + COORDINATES for token in FORBIDDEN_TOKENS)
    pre2026 = raw[raw[DATE] < "2026-01-01"].copy()
    audit2026 = raw[raw[DATE] >= "2026-01-01"].copy()
    metadata = {
        "target_source": TARGET_SOURCE,
        "target_alias": TARGET,
        "target_exact_match_with_legacy_alias": True,
        "division": DIVISION,
        "pre2026_rows": int(len(pre2026)),
        "audit2026_rows": int(len(audit2026)),
        "route_cache_rows": int(len(cache)),
        "coordinate_coverage_pct": float(100 * raw["origin_lat"].notna().mean()),
        "elevation_coverage_pct": float(100 * raw["origin_elevation_m"].notna().mean()),
        "duration_coverage_pct": float(100 * raw["estimated_trip_duration_hours"].notna().mean()),
        "duration_rule_version": RULE_VERSION,
        "excluded_equipment": sorted(EXCLUDED_EQUIPMENT),
        "excluded_equipment_rows": excluded_rows,
        "forbidden_feature_tokens": list(FORBIDDEN_TOKENS),
        "accessorials_in_target": False,
    }
    return pre2026, audit2026, metadata


def window_train(data: pd.DataFrame, start: pd.Timestamp) -> pd.DataFrame:
    return data[(data[DATE] < start) & (data[DATE] >= start - pd.DateOffset(months=CONFIG["months"]))].copy()


def fit_geo_state(train: pd.DataFrame) -> dict:
    endpoints = pd.concat([
        train[["origin_lat", "origin_lng"]].rename(columns={"origin_lat": "lat", "origin_lng": "lng"}),
        train[["destination_lat", "destination_lng"]].rename(columns={"destination_lat": "lat", "destination_lng": "lng"}),
    ]).dropna().drop_duplicates()
    n_clusters = min(CONFIG["clusters"], max(2, len(endpoints) // 5))
    model = KMeans(n_clusters=n_clusters, random_state=2026, n_init=20).fit(endpoints[["lat", "lng"]].to_numpy())
    medians = {column: float(train[column].median()) for column in COORDINATES}
    return {"model": model, "medians": medians, "n_clusters": n_clusters}


def add_geo(data: pd.DataFrame, geo_state: dict) -> pd.DataFrame:
    frame = data.copy()
    for column in COORDINATES:
        frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(geo_state["medians"][column])
    model = geo_state["model"]
    frame["origin_region"] = model.predict(frame[["origin_lat", "origin_lng"]].to_numpy()).astype(str)
    frame["destination_region"] = model.predict(frame[["destination_lat", "destination_lng"]].to_numpy()).astype(str)
    frame["regional_corridor"] = frame["origin_region"] + "->" + frame["destination_region"]
    frame["equipment_family"] = frame["Tipo de Equipo_key"].map(equipment_family)
    frame["route_equipment"] = frame["route_key"] + "|" + frame["Tipo de Equipo_key"]
    frame["client_route_equipment"] = (
        frame["CLIENTE_key"] + "|" + frame["route_key"] + "|" + frame["Tipo de Equipo_key"]
    )
    frame["corridor_equipment"] = frame["regional_corridor"] + "|" + frame["equipment_family"]
    return frame


def add_elevation(data: pd.DataFrame) -> pd.DataFrame:
    frame = data.copy()
    aliases = {
        "origin_elevation_m": "google_origin_elevation_m",
        "destination_elevation_m": "google_destination_elevation_m",
    }
    for canonical, google_column in aliases.items():
        if canonical not in frame:
            frame[canonical] = frame[google_column] if google_column in frame else np.nan
        frame[canonical] = pd.to_numeric(frame[canonical], errors="coerce")
    frame["elevation_delta_m"] = frame["destination_elevation_m"] - frame["origin_elevation_m"]
    frame["elevation_gain_m"] = frame["elevation_delta_m"].clip(lower=0)
    frame["elevation_loss_m"] = (-frame["elevation_delta_m"]).clip(lower=0)
    distance = pd.to_numeric(frame["google_distance_km"], errors="coerce").where(lambda value: value.gt(1))
    frame["elevation_change_per_km"] = frame["elevation_delta_m"] / distance
    return frame


def add_duration(data: pd.DataFrame) -> pd.DataFrame:
    return add_trip_duration_features(
        data,
        distance_column="google_distance_km",
        equipment_column="Tipo de Equipo_key",
    )


HISTORY_KEYS = ["route_equipment", "client_route_equipment", "corridor_equipment"]


def _smooth_map(frame: pd.DataFrame, key: str, value: str, prior: float) -> tuple[dict, dict]:
    stats = frame.groupby(key)[value].agg(["mean", "count"])
    smooth = CONFIG["history_smoothing"]
    encoded = ((stats["mean"] * stats["count"] + prior * smooth) / (stats["count"] + smooth)).to_dict()
    return encoded, stats["count"].astype(float).to_dict()


def fit_history_state(frame: pd.DataFrame) -> dict:
    work = frame.copy()
    work["_log_target"] = np.log1p(work[TARGET])
    target_prior = float(work["_log_target"].median())
    target_maps, count_maps = {}, {}
    for key in HISTORY_KEYS:
        target_maps[key], count_maps[key] = _smooth_map(work, key, "_log_target", target_prior)
    return {
        "target_prior": target_prior,
        "target_maps": target_maps,
        "count_maps": count_maps,
    }


def add_history_features(frame: pd.DataFrame, state: dict) -> pd.DataFrame:
    features = pd.DataFrame(index=frame.index)
    for key in HISTORY_KEYS:
        features[f"{key}__target_history"] = frame[key].map(state["target_maps"][key]).fillna(state["target_prior"])
        features[f"{key}__support"] = np.log1p(frame[key].map(state["count_maps"][key]).fillna(0.0))
    return features


def fit_feature_state(train: pd.DataFrame, candidate: str) -> dict:
    geo_state = fit_geo_state(train)
    augmented = add_duration(add_elevation(add_geo(train, geo_state)))
    use_geo = candidate in {
        "geo", "geo_history", "geo_duration_elevation", "geo_history_duration_elevation",
    }
    use_history = candidate in {
        "history_only", "geo_history", "geo_history_duration_elevation",
    }
    use_duration = candidate in {"geo_duration_elevation", "geo_history_duration_elevation"}
    use_elevation = candidate in {"geo_duration_elevation", "geo_history_duration_elevation"}
    categorical = ["DIVISION_key", "RANGO_key", "route_type", "Tipo de Equipo_key", "equipment_family"]
    if use_geo:
        categorical += ["origin_region", "destination_region", "regional_corridor", "corridor_equipment"]
    frequency = RAW_CATEGORICAL + ["equipment_family", "route_equipment", "client_route_equipment"]
    state = {
        "candidate": candidate,
        "geo": geo_state,
        "use_geo": use_geo,
        "use_history": use_history,
        "use_duration": use_duration,
        "use_elevation": use_elevation,
        "categorical": categorical,
        "frequency": frequency,
        "numeric_medians": {},
        "frequency_maps": {},
        "category_maps": {},
        "history": fit_history_state(augmented) if use_history else None,
    }
    for column in BASE_NUMERIC + COORDINATES + ELEVATION_NUMERIC + DURATION_NUMERIC:
        state["numeric_medians"][column] = float(augmented[column].median()) if augmented[column].notna().any() else 0.0
    for column in frequency:
        state["frequency_maps"][column] = augmented[column].value_counts(normalize=True).to_dict()
    for column in categorical:
        state["category_maps"][column] = {value: i for i, value in enumerate(sorted(augmented[column].astype(str).unique()))}
    return state


def make_features(data: pd.DataFrame, state: dict, history_state: dict | None = None) -> pd.DataFrame:
    frame = add_duration(add_elevation(add_geo(data, state["geo"])))
    features = pd.DataFrame(index=data.index)
    for column in BASE_NUMERIC:
        features[column] = pd.to_numeric(frame[column], errors="coerce").fillna(state["numeric_medians"][column])
    features["distance_log1p"] = np.log1p(features["google_distance_km"].clip(lower=0))
    if state["use_geo"]:
        for column in COORDINATES:
            features[column] = frame[column]
    if state["use_elevation"]:
        for column in ELEVATION_NUMERIC:
            features[column] = pd.to_numeric(frame[column], errors="coerce").fillna(state["numeric_medians"][column])
    if state["use_duration"]:
        for column in DURATION_NUMERIC:
            features[column] = pd.to_numeric(frame[column], errors="coerce").fillna(state["numeric_medians"][column])
    for column in state["frequency"]:
        features[f"{column}__freq"] = frame[column].map(state["frequency_maps"][column]).fillna(0.0)
    for column in state["categorical"]:
        features[f"{column}__code"] = frame[column].map(state["category_maps"][column]).fillna(-1).astype("int32")
    if state["use_history"]:
        history = add_history_features(frame, history_state or state["history"])
        features = pd.concat([features, history], axis=1)
    features["provider_missing"] = frame["PROVEEDOR_key"].eq(MISSING).astype("int8")
    return features


def temporal_training_features(train: pd.DataFrame, state: dict) -> pd.DataFrame:
    features = make_features(train, state)
    if state["use_history"]:
        ordered = train.sort_values(DATE)
        blocks = np.array_split(np.arange(len(ordered)), CONFIG["history_blocks"])
        history_columns = [column for column in features if "history" in column or column.endswith("__support")]
        for position, block in enumerate(blocks):
            index = ordered.index[block]
            if position == 0:
                empty = {
                    "target_prior": state["history"]["target_prior"],
                    "target_maps": {key: {} for key in HISTORY_KEYS},
                    "count_maps": {key: {} for key in HISTORY_KEYS},
                }
                block_features = make_features(ordered.loc[index], state, empty)
            else:
                history_positions = np.concatenate(blocks[:position])
                history_frame = add_geo(ordered.iloc[history_positions], state["geo"])
                block_state = fit_history_state(history_frame)
                block_features = make_features(ordered.loc[index], state, block_state)
            features.loc[index, history_columns] = block_features[history_columns]
    return features


def deterministic_provider_dropout(features: pd.DataFrame, train: pd.DataFrame, seed: int, rate: float) -> pd.DataFrame:
    if rate <= 0:
        return features
    result = features.copy()
    rng = np.random.default_rng(seed)
    mask = rng.random(len(result)) < rate
    provider_columns = [column for column in result if column.startswith("PROVEEDOR_key")]
    result.loc[mask, provider_columns] = 0.0
    result.loc[mask, "provider_missing"] = 1
    return result


def temporal_weights(train: pd.DataFrame) -> np.ndarray:
    age = (train[DATE].max() - train[DATE]).dt.days.clip(lower=0)
    return np.exp(-np.log(2.0) * age / CONFIG["half_life_days"]).to_numpy(float)


def fit_component(train: pd.DataFrame, candidate: str, seed: int) -> dict:
    lower, upper = train[TARGET].quantile([CONFIG["trim_low"], CONFIG["trim_high"]])
    trimmed = train[train[TARGET].between(lower, upper)].copy()
    state = fit_feature_state(trimmed, candidate)
    features = temporal_training_features(trimmed, state)
    dropout = CONFIG["provider_dropout"] if candidate != "reference" else 0.0
    fit_features = deterministic_provider_dropout(features, trimmed, seed, dropout)
    categorical = [f"{column}__code" for column in state["categorical"]]
    model = lgb.LGBMRegressor(**PARAMS, random_state=seed, bagging_seed=seed, feature_fraction_seed=seed)
    model.fit(fit_features, np.log1p(trimmed[TARGET]), sample_weight=temporal_weights(trimmed), categorical_feature=categorical)
    return {
        "model": model, "state": state, "features": features.columns.tolist(), "seed": seed,
        "candidate": candidate, "provider_dropout": dropout, "n_train": int(len(trimmed)),
        "trained_through": str(trimmed[DATE].max().date()), "trim_bounds": [float(lower), float(upper)],
    }


def fit_ensemble(train: pd.DataFrame, candidate: str) -> list[dict]:
    return [fit_component(train, candidate, seed) for seed in SEEDS]


def predict_ensemble(models: list[dict], data: pd.DataFrame, force_missing_provider: bool = False) -> np.ndarray:
    if "Tipo de Equipo_key" not in data:
        raise ValueError("Tipo de Equipo_key is required for National Geo inference")
    excluded = data["Tipo de Equipo_key"].map(normalize).isin(EXCLUDED_EQUIPMENT)
    if excluded.any():
        values = sorted(data.loc[excluded, "Tipo de Equipo_key"].map(normalize).unique())
        raise ValueError(
            "Equipment outside National Geo pricing scope: " + ", ".join(values)
        )
    predictions = []
    for component in models:
        features = make_features(data, component["state"]).reindex(columns=component["features"], fill_value=0)
        if force_missing_provider:
            provider_columns = [column for column in features if column.startswith("PROVEEDOR_key")]
            features.loc[:, provider_columns] = 0.0
            features.loc[:, "provider_missing"] = 1
        predictions.append(np.maximum(np.expm1(component["model"].predict(features)), 0))
    return np.vstack(predictions).mean(axis=0)


def row_loss(y: np.ndarray, prediction: np.ndarray) -> np.ndarray:
    y = np.asarray(y, float)
    prediction = np.asarray(prediction, float)
    return CONFIG["underprediction_cost"] * np.maximum(y - prediction, 0) + np.maximum(prediction - y, 0)


def metrics(y: pd.Series | np.ndarray, prediction: np.ndarray) -> dict:
    y = np.asarray(y, float)
    prediction = np.asarray(prediction, float)
    error = prediction - y
    under = np.maximum(y - prediction, 0)
    return {
        "MAE": float(mean_absolute_error(y, prediction)),
        "ASYM_LOSS": float(row_loss(y, prediction).mean()),
        "RMSE": float(mean_squared_error(y, prediction) ** 0.5),
        "WAPE_%": float(100 * np.abs(error).sum() / y.sum()),
        "Bias": float(error.mean()),
        "P90_UNDER": float(np.quantile(under, 0.90)),
        "UNDER_RATE_%": float(100 * np.mean(error < 0)),
    }


def run_backtests(pre2026: pd.DataFrame, candidates: tuple[str, ...]) -> tuple[pd.DataFrame, pd.DataFrame]:
    rows, predictions = [], []
    for fold in FOLDS:
        train = window_train(pre2026, fold.start)
        valid = pre2026[(pre2026[DATE] >= fold.start) & (pre2026[DATE] < fold.end)].copy()
        for candidate in candidates:
            models = fit_ensemble(train, candidate)
            pred = predict_ensemble(models, valid)
            pred_missing = predict_ensemble(models, valid, force_missing_provider=True)
            rows.append({"fold": fold.name, "candidate": candidate, "scenario": "full", "n_train": len(train), "n_valid": len(valid), **metrics(valid[TARGET], pred)})
            rows.append({"fold": fold.name, "candidate": candidate, "scenario": "provider_missing", "n_train": len(train), "n_valid": len(valid), **metrics(valid[TARGET], pred_missing)})
            predictions.append(pd.DataFrame({
                "fold": fold.name, "candidate": candidate, "row_id": valid.index, "route_key": valid["route_key"].to_numpy(),
                "equipment": valid["Tipo de Equipo_key"].to_numpy(), "y": valid[TARGET].to_numpy(), "pred": pred,
                "pred_provider_missing": pred_missing,
            }))
    return pd.concat(predictions, ignore_index=True), pd.DataFrame(rows)


def summary(oof: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame([
        {"candidate": candidate, "n": len(group), **metrics(group["y"], group["pred"]),
         "MAE_PROVIDER_MISSING": metrics(group["y"], group["pred_provider_missing"])["MAE"],
         "provider_missing_degradation_%": 100 * (metrics(group["y"], group["pred_provider_missing"])["MAE"] / metrics(group["y"], group["pred"])["MAE"] - 1)}
        for candidate, group in oof.groupby("candidate")
    ]).sort_values("ASYM_LOSS").reset_index(drop=True)


def route_bootstrap(oof: pd.DataFrame, baseline: str, candidate: str, iterations: int = 5000) -> dict:
    base = oof[oof["candidate"].eq(baseline)][["fold", "row_id", "route_key", "y", "pred"]].rename(columns={"pred": "base"})
    challenger = oof[oof["candidate"].eq(candidate)][["fold", "row_id", "pred"]].rename(columns={"pred": "challenger"})
    paired = base.merge(challenger, on=["fold", "row_id"])
    paired["delta_mae"] = np.abs(paired["y"] - paired["challenger"]) - np.abs(paired["y"] - paired["base"])
    paired["delta_asym"] = row_loss(paired["y"], paired["challenger"]) - row_loss(paired["y"], paired["base"])
    table = paired.groupby("route_key")[["delta_mae", "delta_asym"]].agg(["sum", "count"])
    rng = np.random.default_rng(2026)
    samples = []
    for _ in range(iterations):
        selected = rng.choice(np.arange(len(table)), len(table), replace=True)
        samples.append([
            table[("delta_mae", "sum")].to_numpy()[selected].sum() / table[("delta_mae", "count")].to_numpy()[selected].sum(),
            table[("delta_asym", "sum")].to_numpy()[selected].sum() / table[("delta_asym", "count")].to_numpy()[selected].sum(),
        ])
    samples = np.asarray(samples)
    return {
        "candidate": candidate, "baseline": baseline, "routes": len(table),
        "delta_mae": float(paired["delta_mae"].mean()), "mae_ci95_low": float(np.quantile(samples[:, 0], .025)),
        "mae_ci95_high": float(np.quantile(samples[:, 0], .975)), "probability_mae_improvement_%": float(100 * (samples[:, 0] < 0).mean()),
        "delta_asym": float(paired["delta_asym"].mean()), "asym_ci95_low": float(np.quantile(samples[:, 1], .025)),
        "asym_ci95_high": float(np.quantile(samples[:, 1], .975)), "probability_asym_improvement_%": float(100 * (samples[:, 1] < 0).mean()),
    }


def select_candidate(oof: pd.DataFrame) -> tuple[str, pd.DataFrame, dict]:
    scores = summary(oof).set_index("candidate")
    baseline = scores.loc["reference"]
    checks = []
    for candidate in scores.index:
        if candidate == "reference":
            continue
        boot = route_bootstrap(oof, "reference", candidate)
        current = scores.loc[candidate]
        checks.append({
            **boot,
            "mae_improvement_%": float(100 * (1 - current["MAE"] / baseline["MAE"])),
            "asym_improvement_%": float(100 * (1 - current["ASYM_LOSS"] / baseline["ASYM_LOSS"])),
            "provider_missing_mae_improvement_%": float(100 * (1 - current["MAE_PROVIDER_MISSING"] / baseline["MAE_PROVIDER_MISSING"])),
            "passes_materiality": bool(current["MAE"] <= .95 * baseline["MAE"] or current["ASYM_LOSS"] <= .95 * baseline["ASYM_LOSS"]),
            "passes_missing_provider": bool(current["MAE_PROVIDER_MISSING"] <= .98 * baseline["MAE_PROVIDER_MISSING"]),
            "passes_bootstrap": bool(boot["mae_ci95_high"] < 0 or boot["asym_ci95_high"] < 0),
        })
    checks_frame = pd.DataFrame(checks)
    accepted = checks_frame[checks_frame[["passes_materiality", "passes_missing_provider", "passes_bootstrap"]].all(axis=1)]
    selected = "reference" if accepted.empty else scores.loc[accepted["candidate"]].sort_values("ASYM_LOSS").index[0]
    decision = {
        "selected_pre2026": selected,
        "best_new_challenger": str(scores.drop(index="reference").sort_values("ASYM_LOSS").index[0]),
        "status": "guardrails_not_met" if selected == "reference" else "accepted_for_shadow",
        "selection_uses_2026": False,
        "primary_metric": "asymmetric loss in MXN; underestimation costs 2x",
        "materiality_threshold": "5% MAE or asymmetric-loss improvement",
    }
    return selected, checks_frame, decision


def save_bundle(models: list[dict], path: Path, metadata: dict, decision: dict) -> dict:
    all_features = models[0]["features"]
    assert not any(token in feature.lower() for feature in all_features for token in FORBIDDEN_TOKENS)
    bundle = {
        "artifact_type": "national_geo_history_experiment", "target": TARGET,
        "target_source": TARGET_SOURCE, "division": DIVISION, "models": models,
        "features": all_features, "metadata": metadata, "decision": decision,
        "configuration": CONFIG, "seeds": list(SEEDS),
        "duration_rule_version": RULE_VERSION,
        "excluded_equipment": sorted(EXCLUDED_EQUIPMENT),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, path)
    return bundle


def versions() -> dict:
    return {"python": platform.python_version(), "pandas": pd.__version__, "numpy": np.__version__, "lightgbm": lgb.__version__}
