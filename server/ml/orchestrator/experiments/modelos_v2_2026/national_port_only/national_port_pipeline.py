from __future__ import annotations

import json
import math
import platform
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

try:  # Training-only dependencies; not needed by the ONNX inference package.
    import joblib
    import lightgbm as lgb
    from sklearn.metrics import mean_absolute_error, mean_squared_error
except ImportError:  # pragma: no cover
    joblib = lgb = mean_absolute_error = mean_squared_error = None


TARGET = "cost_mxn"
DATE = "FECHA CREACI\u00d3N_dt"
MISSING = "__MISSING__"
ALLOWED_DIVISIONS = ("national", "port freight")
BLOCKED_DIVISIONS = ("crossborder", "domestic", "maritime")
SEEDS = (42, 2026, 9001)

CATEGORICAL_INPUTS = [
    "CLIENTE_key",
    "ORIGEN_key",
    "DESTINO_key",
    "route_key",
    "Tipo de Equipo_key",
    "DIVISION_key",
    "RANGO_key",
    "route_type",
]
NUMERIC_INPUTS = ["mes_creacion", "trimestre_creacion", "dia_semana_creacion", "google_distance_km"]
INTERACTIONS = [
    "equipment_family",
    "division_equipment",
    "route_equipment",
    "origin_equipment",
    "destination_equipment",
]
TE_COLUMNS = [
    "route_key",
    "ORIGEN_key",
    "DESTINO_key",
    "CLIENTE_key",
    "Tipo de Equipo_key",
    "equipment_family",
    "division_equipment",
    "route_equipment",
    "origin_equipment",
    "destination_equipment",
]
DIVISION_ALIASES = {
    "crossboarder": "crossborder",
    "cross border": "crossborder",
    "port_freight": "port freight",
    "portfreight": "port freight",
    "port-freight": "port freight",
}
CONFIG = {
    "months": 9,
    "trim_low": 0.005,
    "trim_high": 0.995,
    "half_life_days": 180,
    "te_smoothing": 20.0,
    "te_blocks": 5,
    "underprediction_cost": 2.0,
}
BASE_PARAMS = {
    "objective": "regression_l1",
    "n_estimators": 500,
    "learning_rate": 0.03,
    "num_leaves": 24,
    "min_child_samples": 30,
    "subsample": 0.85,
    "colsample_bytree": 0.85,
    "subsample_freq": 1,
    "reg_alpha": 0.3,
    "reg_lambda": 2.5,
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


def normalize_text(value: object) -> str:
    if pd.isna(value):
        return MISSING
    value = str(value).strip().lower()
    return value or MISSING


def normalize_division(value: object) -> str:
    value = normalize_text(value)
    return DIVISION_ALIASES.get(value, value)


def equipment_family(value: object) -> str:
    value = normalize_text(value)
    if value == MISSING:
        return MISSING
    if "dryvan" in value or "dry van" in value or "caja seca" in value:
        return "dryvan"
    if "container" in value or "contenedor" in value:
        if "reefer" in value or "refriger" in value:
            return "container_reefer"
        return "container"
    if "flatbed" in value or "plataforma" in value:
        return "flatbed"
    if "reefer" in value or "refriger" in value:
        return "refrigerated"
    if "ltl" in value:
        return "ltl"
    if "pipa" in value or "tanker" in value:
        return "tanker"
    if "torton" in value or "rabon" in value or "3.5" in value or "1.5" in value:
        return "local_truck"
    return "other"


def add_interactions(data: pd.DataFrame) -> pd.DataFrame:
    frame = data.copy()
    frame["equipment_family"] = frame["Tipo de Equipo_key"].map(equipment_family)
    frame["division_equipment"] = frame["DIVISION_key"] + "|" + frame["Tipo de Equipo_key"]
    frame["route_equipment"] = frame["route_key"] + "|" + frame["Tipo de Equipo_key"]
    frame["origin_equipment"] = frame["ORIGEN_key"] + "|" + frame["Tipo de Equipo_key"]
    frame["destination_equipment"] = frame["DESTINO_key"] + "|" + frame["Tipo de Equipo_key"]
    return frame


def prepare_data(data_path: Path) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    raw = pd.read_csv(data_path, encoding="utf-8-sig", low_memory=False)
    raw[DATE] = pd.to_datetime(raw[DATE], errors="coerce")
    candidate = raw["is_training_candidate"].astype(str).str.lower().eq("true")
    target = pd.to_numeric(raw[TARGET], errors="coerce")
    raw = raw.loc[candidate & raw[DATE].notna() & target.gt(0)].copy()
    raw[TARGET] = pd.to_numeric(raw[TARGET], errors="coerce")
    for column in CATEGORICAL_INPUTS:
        raw[column] = raw[column].map(normalize_text)
    raw["DIVISION_key"] = raw["DIVISION_key"].map(normalize_division)
    for column in NUMERIC_INPUTS:
        raw[column] = pd.to_numeric(raw[column], errors="coerce")

    all_counts = raw["DIVISION_key"].value_counts().to_dict()
    scoped = raw[raw["DIVISION_key"].isin(ALLOWED_DIVISIONS)].sort_values(DATE).reset_index(drop=True)
    assert set(scoped["DIVISION_key"].unique()).issubset(ALLOWED_DIVISIONS)
    assert not scoped["DIVISION_key"].isin(BLOCKED_DIVISIONS).any()

    pre2026 = scoped[scoped[DATE] < "2026-01-01"].copy()
    audit2026 = scoped[scoped[DATE] >= "2026-01-01"].copy()
    metadata = {
        "raw_candidate_division_counts": {str(k): int(v) for k, v in all_counts.items()},
        "allowed_divisions": list(ALLOWED_DIVISIONS),
        "blocked_divisions": list(BLOCKED_DIVISIONS),
        "pre2026_rows": int(len(pre2026)),
        "audit2026_rows": int(len(audit2026)),
        "pre2026_division_counts": {str(k): int(v) for k, v in pre2026["DIVISION_key"].value_counts().items()},
        "audit2026_division_counts": {str(k): int(v) for k, v in audit2026["DIVISION_key"].value_counts().items()},
        "data_min_date": str(scoped[DATE].min().date()),
        "data_max_date": str(scoped[DATE].max().date()),
    }
    return pre2026, audit2026, metadata


def window_train(data: pd.DataFrame, valid_start: pd.Timestamp) -> pd.DataFrame:
    lower = valid_start - pd.DateOffset(months=CONFIG["months"])
    train = data[(data[DATE] < valid_start) & (data[DATE] >= lower)].copy()
    assert set(train["DIVISION_key"].unique()).issubset(ALLOWED_DIVISIONS)
    return train


def trim_training(data: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    pieces = []
    bounds = {}
    for division, group in data.groupby("DIVISION_key"):
        lower, upper = group[TARGET].quantile([CONFIG["trim_low"], CONFIG["trim_high"]])
        pieces.append(group[group[TARGET].between(lower, upper)])
        bounds[division] = [float(lower), float(upper)]
    trimmed = pd.concat(pieces).sort_values(DATE).copy()
    assert set(trimmed["DIVISION_key"].unique()).issubset(ALLOWED_DIVISIONS)
    return trimmed, bounds


def temporal_weights(data: pd.DataFrame) -> np.ndarray:
    age = (data[DATE].max() - data[DATE]).dt.days.clip(lower=0)
    weights = np.exp(-np.log(2.0) * age / CONFIG["half_life_days"])
    division_count = data["DIVISION_key"].value_counts()
    division_balance = data["DIVISION_key"].map(lambda x: len(data) / (2.0 * division_count[x]))
    return (weights * division_balance).to_numpy(float)


def _smoothed_maps(data: pd.DataFrame, columns: list[str], prior: float) -> dict:
    mapped = {}
    target_log = np.log1p(data[TARGET])
    for column in columns:
        stats = data.assign(_target=target_log).groupby(column)["_target"].agg(["mean", "count"])
        smooth = CONFIG["te_smoothing"]
        mapped[column] = ((stats["mean"] * stats["count"] + prior * smooth) / (stats["count"] + smooth)).to_dict()
    return mapped


def fit_feature_state(train: pd.DataFrame, mode: str) -> dict:
    augmented = add_interactions(train)
    use_equipment = mode != "without_equipment"
    categorical = ["DIVISION_key", "RANGO_key", "route_type"]
    te_columns = ["route_key", "ORIGEN_key", "DESTINO_key", "CLIENTE_key"]
    freq_columns = ["CLIENTE_key", "ORIGEN_key", "DESTINO_key", "route_key", "DIVISION_key", "RANGO_key", "route_type"]
    if mode == "incumbent":
        freq_columns.append("Tipo de Equipo_key")
        te_columns = ["ORIGEN_key", "DESTINO_key"]
    elif use_equipment:
        categorical += ["Tipo de Equipo_key"] + INTERACTIONS
        te_columns += [column for column in TE_COLUMNS if column not in te_columns]
        freq_columns += ["Tipo de Equipo_key"] + INTERACTIONS

    prior = float(np.log1p(train[TARGET]).median())
    state = {
        "mode": mode,
        "prior": prior,
        "categorical": categorical,
        "te_columns": te_columns,
        "freq_columns": freq_columns,
        "numeric_medians": {},
        "freq_maps": {},
        "te_maps": _smoothed_maps(augmented, te_columns, prior),
        "category_maps": {},
    }
    for column in NUMERIC_INPUTS:
        state["numeric_medians"][column] = float(train[column].median()) if train[column].notna().any() else 0.0
    for column in freq_columns:
        state["freq_maps"][column] = augmented[column].value_counts(normalize=True, dropna=False).to_dict()
    for column in categorical:
        values = sorted(augmented[column].astype(str).unique())
        state["category_maps"][column] = {value: index for index, value in enumerate(values)}
    return state


def _te_fallback(frame: pd.DataFrame, state: dict, column: str) -> pd.Series:
    prior = state["prior"]
    if column in {"route_equipment", "origin_equipment", "destination_equipment"}:
        family = frame["equipment_family"].map(state["te_maps"].get("equipment_family", {}))
        return family.fillna(prior)
    if column in {"Tipo de Equipo_key", "division_equipment"}:
        family = frame["equipment_family"].map(state["te_maps"].get("equipment_family", {}))
        return family.fillna(prior)
    return pd.Series(prior, index=frame.index, dtype=float)


def make_features(data: pd.DataFrame, state: dict) -> pd.DataFrame:
    augmented = add_interactions(data)
    features = pd.DataFrame(index=data.index)
    for column in NUMERIC_INPUTS:
        features[column] = pd.to_numeric(data[column], errors="coerce").fillna(state["numeric_medians"][column])
    features["distance_log1p"] = np.log1p(features["google_distance_km"].clip(lower=0))
    for column in state["freq_columns"]:
        features[f"{column}__freq"] = augmented[column].map(state["freq_maps"][column]).fillna(0.0).astype(float)
    for column in state["te_columns"]:
        encoded = augmented[column].map(state["te_maps"][column])
        features[f"{column}__te"] = encoded.fillna(_te_fallback(augmented, state, column)).fillna(state["prior"])
    for column in state["categorical"]:
        features[f"{column}__code"] = augmented[column].map(state["category_maps"][column]).fillna(-1).astype("int32")
    return features


def temporal_training_features(train: pd.DataFrame, mode: str) -> tuple[pd.DataFrame, dict]:
    final_state = fit_feature_state(train, mode)
    features = make_features(train, final_state)
    ordered = train.sort_values(DATE)
    blocks = np.array_split(np.arange(len(ordered)), CONFIG["te_blocks"])
    te_names = [f"{column}__te" for column in final_state["te_columns"]]
    for position, block in enumerate(blocks):
        index = ordered.index[block]
        if position == 0:
            features.loc[index, te_names] = final_state["prior"]
            continue
        history_positions = np.concatenate(blocks[:position])
        history = ordered.iloc[history_positions]
        historical_state = fit_feature_state(history, mode)
        block_features = make_features(ordered.loc[index], historical_state)
        features.loc[index, te_names] = block_features[te_names]
    return features, final_state


def fit_component(train: pd.DataFrame, seed: int, mode: str) -> dict:
    trimmed, bounds = trim_training(train)
    features, state = temporal_training_features(trimmed, mode)
    categorical_names = [f"{column}__code" for column in state["categorical"]]
    params = {
        **BASE_PARAMS,
        "random_state": seed,
        "bagging_seed": seed,
        "feature_fraction_seed": seed,
        "data_random_seed": seed,
    }
    model = lgb.LGBMRegressor(**params)
    model.fit(
        features,
        np.log1p(trimmed[TARGET]),
        sample_weight=temporal_weights(trimmed),
        categorical_feature=categorical_names,
    )
    return {
        "model": model,
        "state": state,
        "features": features.columns.tolist(),
        "seed": seed,
        "mode": mode,
        "trim_bounds": bounds,
        "n_train": int(len(trimmed)),
        "trained_through": str(trimmed[DATE].max().date()),
    }


def fit_ensemble(train: pd.DataFrame, mode: str, seeds: tuple[int, ...] = SEEDS) -> list[dict]:
    if len(train) < 100:
        raise ValueError(f"Insufficient training rows for {mode}: {len(train)}")
    assert set(train["DIVISION_key"].unique()).issubset(ALLOWED_DIVISIONS)
    return [fit_component(train, seed, mode) for seed in seeds]


def predict_ensemble(models: list[dict], data: pd.DataFrame) -> np.ndarray:
    predictions = []
    for component in models:
        features = make_features(data, component["state"]).reindex(columns=component["features"], fill_value=0)
        predictions.append(np.maximum(np.expm1(component["model"].predict(features)), 0.0))
    return np.vstack(predictions).mean(axis=0)


def predict_incumbent_bundle(bundle: dict, data: pd.DataFrame) -> np.ndarray:
    predictions = []
    for component in bundle["models"]:
        state = component["state"]
        features = pd.DataFrame(index=data.index)
        for column in bundle["numeric"]:
            features[column] = pd.to_numeric(data[column], errors="coerce").fillna(state["numeric_medians"][column])
        for column in bundle["categorical"]:
            features[f"{column}__freq"] = data[column].map(state["freq_maps"][column]).fillna(0.0).astype(float)
        features["distance_log1p"] = np.log1p(features["google_distance_km"].clip(lower=0))
        for column in ["ORIGEN_key", "DESTINO_key"]:
            features[f"{column}__te"] = data[column].map(state["te_maps"][column]).fillna(state["te_prior"])
        features = features.reindex(columns=component["features"], fill_value=0)
        predictions.append(np.maximum(np.expm1(component["model"].predict(features)), 0.0))
    return np.vstack(predictions).mean(axis=0)


def row_loss(y: np.ndarray, prediction: np.ndarray) -> np.ndarray:
    y = np.asarray(y, dtype=float)
    prediction = np.asarray(prediction, dtype=float)
    return CONFIG["underprediction_cost"] * np.maximum(y - prediction, 0.0) + np.maximum(prediction - y, 0.0)


def metrics(y: pd.Series | np.ndarray, prediction: np.ndarray) -> dict:
    y = np.asarray(y, dtype=float)
    prediction = np.asarray(prediction, dtype=float)
    error = prediction - y
    under = np.maximum(y - prediction, 0.0)
    return {
        "ASYM_LOSS": float(row_loss(y, prediction).mean()),
        "MAE": float(mean_absolute_error(y, prediction)),
        "RMSE": float(mean_squared_error(y, prediction) ** 0.5),
        "WAPE_%": float(100 * np.abs(error).sum() / np.abs(y).sum()),
        "Bias": float(error.mean()),
        "P90_UNDER": float(np.quantile(under, 0.90)),
        "UNDER_RATE_%": float(100 * np.mean(error < 0)),
    }


def balanced_score(rows: pd.DataFrame) -> float:
    scores = []
    for division in ALLOWED_DIVISIONS:
        group = rows[rows["division"].eq(division)]
        if group.empty:
            return math.inf
        scores.append(float(row_loss(group["y"], group["pred"]).mean()))
    return float(np.mean(scores))


def _prediction_rows(validation: pd.DataFrame, fold: str, candidate: str, prediction: np.ndarray) -> pd.DataFrame:
    augmented = add_interactions(validation)
    return pd.DataFrame({
        "fold": fold,
        "row_id": validation.index,
        "route_key": validation["route_key"].to_numpy(),
        "division": validation["DIVISION_key"].to_numpy(),
        "equipment": validation["Tipo de Equipo_key"].to_numpy(),
        "equipment_family": augmented["equipment_family"].to_numpy(),
        "y": validation[TARGET].to_numpy(),
        "candidate": candidate,
        "pred": prediction,
    })


def run_backtests(pre2026: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    assert set(pre2026["DIVISION_key"].unique()).issubset(ALLOWED_DIVISIONS)
    prediction_rows = []
    fold_rows = []
    for fold in FOLDS:
        train = window_train(pre2026, fold.start)
        validation = pre2026[(pre2026[DATE] >= fold.start) & (pre2026[DATE] < fold.end)].copy()
        assert set(validation["DIVISION_key"].unique()).issubset(ALLOWED_DIVISIONS)

        incumbent = fit_ensemble(train, "incumbent")
        joint = fit_ensemble(train, "equipment")
        ablation = fit_ensemble(train, "without_equipment")
        separate_models = {
            division: fit_ensemble(train[train["DIVISION_key"].eq(division)], "equipment")
            for division in ALLOWED_DIVISIONS
        }
        incumbent_pred = predict_ensemble(incumbent, validation)
        joint_pred = predict_ensemble(joint, validation)
        ablation_pred = predict_ensemble(ablation, validation)
        separate_pred = np.zeros(len(validation), dtype=float)
        for division, models in separate_models.items():
            mask = validation["DIVISION_key"].eq(division).to_numpy()
            separate_pred[mask] = predict_ensemble(models, validation[mask])

        candidates = {
            "incumbent_retrained": incumbent_pred,
            "joint_equipment": joint_pred,
            "separate_equipment": separate_pred,
            "joint_without_equipment": ablation_pred,
        }
        for candidate, prediction in candidates.items():
            rows = _prediction_rows(validation, fold.name, candidate, prediction)
            prediction_rows.append(rows)
            fold_rows.append({
                "fold": fold.name,
                "candidate": candidate,
                "n_train": int(len(train)),
                "n_valid": int(len(validation)),
                "balanced_asym_loss": balanced_score(rows),
                **metrics(validation[TARGET], prediction),
            })
    return pd.concat(prediction_rows, ignore_index=True), pd.DataFrame(fold_rows)


def candidate_summary(oof: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for candidate, group in oof.groupby("candidate"):
        fold_scores = [balanced_score(fold) for _, fold in group.groupby("fold")]
        rows.append({
            "candidate": candidate,
            "balanced_asym_loss": balanced_score(group),
            "balanced_fold_median": float(np.median(fold_scores)),
            "balanced_fold_max": float(np.max(fold_scores)),
            **metrics(group["y"], group["pred"]),
        })
    return pd.DataFrame(rows).sort_values("balanced_fold_median").reset_index(drop=True)


def segment_summary(oof: pd.DataFrame, segment: str, minimum: int = 1) -> pd.DataFrame:
    rows = []
    for (candidate, value), group in oof.groupby(["candidate", segment]):
        if len(group) >= minimum:
            rows.append({"candidate": candidate, segment: value, "n": int(len(group)), **metrics(group["y"], group["pred"])})
    return pd.DataFrame(rows)


def temporal_stability_diagnostics(fold_metrics: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for candidate, group in fold_metrics.groupby("candidate"):
        scores = group.sort_values("fold")["balanced_asym_loss"].to_numpy(float)
        mean = float(scores.mean())
        fold_cv = float(100 * scores.std(ddof=0) / mean) if mean else 0.0
        worst_to_best = float(scores.max() / scores.min()) if scores.min() else math.inf
        rows.append({
            "candidate": candidate,
            "folds": int(len(scores)),
            "balanced_loss_mean": mean,
            "balanced_loss_std": float(scores.std(ddof=0)),
            "fold_cv_%": fold_cv,
            "worst_to_best_ratio": worst_to_best,
            "generalization_instability_flag": bool(fold_cv > 15 or worst_to_best > 1.35),
            "interpretation": "temporal backtest stability; not proof of absence of overfitting",
        })
    return pd.DataFrame(rows).sort_values("balanced_loss_mean").reset_index(drop=True)


def route_bootstrap(oof: pd.DataFrame, candidate: str, iterations: int = 1000, seed: int = 2026) -> dict:
    baseline = oof[oof["candidate"].eq("incumbent_retrained")]
    challenger = oof[oof["candidate"].eq(candidate)][["fold", "row_id", "pred"]].rename(columns={"pred": "challenger"})
    paired = baseline.merge(challenger, on=["fold", "row_id"], how="inner")
    paired["delta"] = row_loss(paired["y"], paired["challenger"]) - row_loss(paired["y"], paired["pred"])
    rng = np.random.default_rng(seed)
    samples = []
    route_tables = {division: group.groupby("route_key")["delta"].agg(["sum", "count"]) for division, group in paired.groupby("division")}
    for _ in range(iterations):
        division_means = []
        for table in route_tables.values():
            positions = rng.choice(np.arange(len(table)), size=len(table), replace=True)
            division_means.append(float(table["sum"].to_numpy()[positions].sum() / table["count"].to_numpy()[positions].sum()))
        samples.append(float(np.mean(division_means)))
    delta = balanced_score(oof[oof["candidate"].eq(candidate)]) - balanced_score(baseline)
    return {
        "candidate": candidate,
        "delta_balanced_asym_loss": delta,
        "ci95_low": float(np.quantile(samples, 0.025)),
        "ci95_high": float(np.quantile(samples, 0.975)),
        "probability_improvement_%": float(100 * np.mean(np.asarray(samples) < 0)),
        "iterations": iterations,
    }


def evaluate_acceptance(oof: pd.DataFrame, fold_metrics: pd.DataFrame, bootstrap: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    summary = candidate_summary(oof).set_index("candidate")
    divisions = segment_summary(oof, "division").set_index(["candidate", "division"])
    equipment = segment_summary(oof, "equipment", minimum=100).set_index(["candidate", "equipment"])
    baseline = summary.loc["incumbent_retrained"]
    rows = []
    for candidate in ("joint_equipment", "separate_equipment"):
        current = summary.loc[candidate]
        base_folds = fold_metrics[fold_metrics["candidate"].eq("incumbent_retrained")].set_index("fold")
        current_folds = fold_metrics[fold_metrics["candidate"].eq(candidate)].set_index("fold")
        fold_ratio = current_folds["balanced_asym_loss"] / base_folds["balanced_asym_loss"]
        base_port = divisions.loc[("incumbent_retrained", "port freight")]
        current_port = divisions.loc[(candidate, "port freight")]
        base_national = divisions.loc[("incumbent_retrained", "national")]
        current_national = divisions.loc[(candidate, "national")]
        equipment_ratios = []
        for equipment_name in equipment.loc["incumbent_retrained"].index:
            if (candidate, equipment_name) in equipment.index:
                equipment_ratios.append(equipment.loc[(candidate, equipment_name), "MAE"] / equipment.loc[("incumbent_retrained", equipment_name), "MAE"])
        boot = bootstrap[bootstrap["candidate"].eq(candidate)].iloc[0]
        checks = {
            "balanced_loss_improves_5pct": current["balanced_fold_median"] <= 0.95 * baseline["balanced_fold_median"],
            "port_mae_or_p90_improves_5pct": bool(
                current_port["MAE"] <= 0.95 * base_port["MAE"] or current_port["P90_UNDER"] <= 0.95 * base_port["P90_UNDER"]
            ),
            "national_mae_not_worse_2pct": current_national["MAE"] <= 1.02 * base_national["MAE"],
            "no_fold_worse_5pct": float(fold_ratio.max()) <= 1.05,
            "no_supported_equipment_worse_5pct": not equipment_ratios or float(max(equipment_ratios)) <= 1.05,
            "bootstrap_ci_below_zero": float(boot["ci95_high"]) < 0.0,
        }
        rows.append({
            "candidate": candidate,
            "accepted": bool(all(checks.values())),
            "worst_fold_ratio": float(fold_ratio.max()),
            "worst_equipment_ratio": float(max(equipment_ratios)) if equipment_ratios else np.nan,
            **checks,
        })
    acceptance = pd.DataFrame(rows)
    accepted = acceptance[acceptance["accepted"]]
    selected = "incumbent_retrained" if accepted.empty else summary.loc[accepted["candidate"]].sort_values("balanced_fold_median").index[0]
    challenger = summary.loc[["joint_equipment", "separate_equipment"]].sort_values("balanced_fold_median").index[0]
    decision = {
        "selected_candidate": selected,
        "best_new_challenger": challenger,
        "promote_new_architecture": selected != "incumbent_retrained",
        "status": "accepted_for_shadow" if selected != "incumbent_retrained" else "guardrails_not_met",
        "selection_period": "pre-2026 temporal backtests only",
        "audit_2026_used_for_selection": False,
        "primary_metric": "balanced 50/50 division loss: 2*underprediction + overprediction",
    }
    return acceptance, decision


def fit_final_models(pre2026: pd.DataFrame) -> dict:
    train = window_train(pre2026, pd.Timestamp("2026-01-01"))
    models = {
        "incumbent_retrained": fit_ensemble(train, "incumbent"),
        "joint_equipment": fit_ensemble(train, "equipment"),
        "joint_without_equipment": fit_ensemble(train, "without_equipment"),
        "separate_equipment": {
            division: fit_ensemble(train[train["DIVISION_key"].eq(division)], "equipment")
            for division in ALLOWED_DIVISIONS
        },
    }
    models["training_frame"] = train
    return models


def predict_candidate(models: dict, candidate: str, data: pd.DataFrame) -> np.ndarray:
    if candidate != "separate_equipment":
        return predict_ensemble(models[candidate], data)
    prediction = np.zeros(len(data), dtype=float)
    for division, division_models in models[candidate].items():
        mask = data["DIVISION_key"].eq(division).to_numpy()
        if mask.any():
            prediction[mask] = predict_ensemble(division_models, data[mask])
    return prediction


def audit_models(models: dict, audit2026: pd.DataFrame, incumbent_bundle: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    predictions = {
        candidate: predict_candidate(models, candidate, audit2026)
        for candidate in ("incumbent_retrained", "joint_equipment", "separate_equipment", "joint_without_equipment")
    }
    predictions["existing_bundle_reference"] = predict_incumbent_bundle(incumbent_bundle, audit2026)
    rows = []
    segments = []
    for candidate, prediction in predictions.items():
        rows.append({"candidate": candidate, "n": int(len(audit2026)), **metrics(audit2026[TARGET], prediction)})
        for division, group in audit2026.assign(_pred=prediction).groupby("DIVISION_key"):
            segments.append({"candidate": candidate, "division": division, "n": int(len(group)), **metrics(group[TARGET], group["_pred"])})
    return pd.DataFrame(rows), pd.DataFrame(segments)


def _support_maps(train: pd.DataFrame) -> dict:
    augmented = add_interactions(train)
    return {
        column: {str(k): int(v) for k, v in augmented[column].value_counts().items()}
        for column in ("route_key", "CLIENTE_key", "Tipo de Equipo_key", "route_equipment")
    }


def _uncertainty(oof: pd.DataFrame, candidate: str) -> dict:
    selected = oof[oof["candidate"].eq(candidate)].copy()
    selected["absolute_error"] = np.abs(selected["y"] - selected["pred"])
    result = {"global": float(selected["absolute_error"].quantile(0.95)), "division": {}, "equipment_family": {}}
    for division, group in selected.groupby("division"):
        result["division"][division] = float(group["absolute_error"].quantile(0.95))
    for family, group in selected.groupby("equipment_family"):
        if len(group) >= 100:
            result["equipment_family"][family] = float(group["absolute_error"].quantile(0.95))
    return result


def build_bundle(models: dict, oof: pd.DataFrame, decision: dict, metadata: dict) -> dict:
    train = models.pop("training_frame")
    selected = decision["selected_candidate"]
    return {
        "artifact_type": "national_port_only_experimental",
        "target": TARGET,
        "selected_candidate": selected,
        "models": models,
        "allowed_divisions": list(ALLOWED_DIVISIONS),
        "blocked_policy": "manual quote; no automatic price",
        "required_features": CATEGORICAL_INPUTS + NUMERIC_INPUTS,
        "optional_unknown_features": ["PROVEEDOR_key"],
        "support_maps": _support_maps(train),
        "uncertainty_q95_mxn": _uncertainty(oof, selected),
        "decision": decision,
        "metadata": metadata,
        "configuration": CONFIG,
        "seeds": list(SEEDS),
        "training_start": str(train[DATE].min().date()),
        "training_end": str(train[DATE].max().date()),
        "training_rows": int(len(train)),
    }


def prepare_inference(data: pd.DataFrame) -> pd.DataFrame:
    frame = data.copy()
    for column in CATEGORICAL_INPUTS:
        if column not in frame:
            frame[column] = MISSING
        frame[column] = frame[column].map(normalize_text)
    frame["DIVISION_key"] = frame["DIVISION_key"].map(normalize_division)
    for column in NUMERIC_INPUTS:
        if column not in frame:
            frame[column] = np.nan
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame


def _confidence(bundle: dict, data: pd.DataFrame) -> tuple[np.ndarray, list[str]]:
    supports = bundle["support_maps"]
    values = []
    reasons = []
    for _, row in data.iterrows():
        route = supports["route_key"].get(row["route_key"], 0)
        client = supports["CLIENTE_key"].get(row["CLIENTE_key"], 0)
        equipment = supports["Tipo de Equipo_key"].get(row["Tipo de Equipo_key"], 0)
        route_equipment = supports["route_equipment"].get(f"{row['route_key']}|{row['Tipo de Equipo_key']}", 0)
        support = (
            0.30 * min(route / 8, 1)
            + 0.20 * min(client / 20, 1)
            + 0.25 * min(equipment / 20, 1)
            + 0.25 * min(route_equipment / 5, 1)
        )
        important = ["ORIGEN_key", "DESTINO_key", "route_key", "Tipo de Equipo_key"]
        missing = sum(row[column] == MISSING for column in important)
        availability = max(0.35, 1 - 0.15 * missing)
        confidence = float(np.clip(100 * (0.25 + 0.75 * support) * availability, 15, 95))
        row_reasons = []
        if route == 0:
            row_reasons.append("unseen_route")
        if route_equipment == 0:
            row_reasons.append("unseen_route_equipment")
        if equipment == 0:
            row_reasons.append("unseen_equipment")
        if missing:
            row_reasons.append("missing_important_variables")
        values.append(round(confidence, 1))
        reasons.append("|".join(row_reasons) if row_reasons else "supported_history")
    return np.asarray(values), reasons


def predict_bundle(bundle: dict, new_quotes: pd.DataFrame) -> pd.DataFrame:
    data = prepare_inference(new_quotes)
    allowed = data["DIVISION_key"].isin(bundle["allowed_divisions"]).to_numpy()
    prediction = np.full(len(data), np.nan)
    interval_low = np.full(len(data), np.nan)
    interval_high = np.full(len(data), np.nan)
    confidence = np.zeros(len(data))
    fallback_reason = np.full(len(data), "division_out_of_model_scope", dtype=object)
    model_used = np.full(len(data), "manual_review", dtype=object)
    if allowed.any():
        scoped = data[allowed]
        scoped_prediction = predict_candidate(bundle["models"], bundle["selected_candidate"], scoped)
        scoped_confidence, scoped_reasons = _confidence(bundle, scoped)
        uncertainty = bundle["uncertainty_q95_mxn"]
        augmented = add_interactions(scoped)
        q95 = []
        for index, row in augmented.iterrows():
            value = uncertainty["equipment_family"].get(row["equipment_family"])
            if value is None:
                value = uncertainty["division"].get(row["DIVISION_key"], uncertainty["global"])
            q95.append(value)
        q95 = np.asarray(q95, dtype=float)
        prediction[allowed] = scoped_prediction
        interval_low[allowed] = np.maximum(scoped_prediction - q95, 0)
        interval_high[allowed] = scoped_prediction + q95
        confidence[allowed] = scoped_confidence
        fallback_reason[allowed] = scoped_reasons
        model_used[allowed] = bundle["selected_candidate"]
    return pd.DataFrame({
        "cost_mxn_prediction": prediction,
        "interval_low_mxn": interval_low,
        "interval_high_mxn": interval_high,
        "confidence_pct": confidence,
        "requires_manual_quote": ~allowed,
        "division_used": data["DIVISION_key"].to_numpy(),
        "model_used": model_used,
        "fallback_reason": fallback_reason,
    }, index=new_quotes.index)


def write_role_reviews(directory: Path, decision: dict, summary: pd.DataFrame, acceptance: pd.DataFrame) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    selected = decision["selected_candidate"]
    challenger = decision["best_new_challenger"]
    selected_score = float(summary.set_index("candidate").loc[selected, "balanced_fold_median"])
    challenger_score = float(summary.set_index("candidate").loc[challenger, "balanced_fold_median"])
    documents = {
        "01_lider_modelado.md": f"# Lider de modelado\n\nSe implemento el filtro estricto National/Port Freight antes de todo ajuste. El candidato operativo es `{selected}` con perdida balanceada mediana {selected_score:,.2f} MXN.\n",
        "02_asistente_tecnico.md": "# Asistente tecnico\n\nSe verificaron aliases, ventanas temporales, trimming por fold, target encodings causales, tres semillas y bloqueo de divisiones fuera de alcance.\n",
        "03_revisor_independiente.md": f"# Revisor independiente\n\nEl mejor modelo nuevo fue `{challenger}` con perdida balanceada mediana {challenger_score:,.2f} MXN. La promocion solo se recomienda si todos los guardrails son verdaderos; la auditoria 2026 no altera la seleccion.\n\n```text\n{acceptance.to_string(index=False)}\n```\n",
        "04_mercadologo.md": "# Validacion del mercadologo\n\nEl cotizador solo debe automatizar National y Port Freight. Crossborder, Domestic y Maritime deben mostrar revision manual sin precio. La confianza baja en rutas o combinaciones ruta-equipo sin historia y el intervalo debe mostrarse junto con el precio.\n",
    }
    for name, content in documents.items():
        (directory / name).write_text(content, encoding="utf-8")


def save_experiment(
    artifact_dir: Path,
    oof: pd.DataFrame,
    fold_metrics: pd.DataFrame,
    acceptance: pd.DataFrame,
    decision: dict,
    metadata: dict,
    bundle: dict,
    audit_overall: pd.DataFrame,
    audit_segments: pd.DataFrame,
) -> None:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    summary = candidate_summary(oof)
    division_metrics = segment_summary(oof, "division")
    equipment_metrics = segment_summary(oof, "equipment", minimum=20)
    family_metrics = segment_summary(oof, "equipment_family", minimum=20)
    stability = temporal_stability_diagnostics(fold_metrics)
    bootstrap = pd.DataFrame([route_bootstrap(oof, candidate) for candidate in ("joint_equipment", "separate_equipment")])
    summary.to_csv(artifact_dir / "candidate_summary_pre2026.csv", index=False, encoding="utf-8-sig")
    fold_metrics.to_csv(artifact_dir / "fold_metrics_pre2026.csv", index=False, encoding="utf-8-sig")
    division_metrics.to_csv(artifact_dir / "division_metrics_pre2026.csv", index=False, encoding="utf-8-sig")
    equipment_metrics.to_csv(artifact_dir / "equipment_metrics_pre2026.csv", index=False, encoding="utf-8-sig")
    family_metrics.to_csv(artifact_dir / "equipment_family_metrics_pre2026.csv", index=False, encoding="utf-8-sig")
    stability.to_csv(artifact_dir / "temporal_stability_diagnostics.csv", index=False, encoding="utf-8-sig")
    acceptance.to_csv(artifact_dir / "acceptance_checks.csv", index=False, encoding="utf-8-sig")
    bootstrap.to_csv(artifact_dir / "route_bootstrap.csv", index=False, encoding="utf-8-sig")
    audit_overall.to_csv(artifact_dir / "audit_2026_overall.csv", index=False, encoding="utf-8-sig")
    audit_segments.to_csv(artifact_dir / "audit_2026_divisions.csv", index=False, encoding="utf-8-sig")
    joblib.dump(bundle, artifact_dir / "national_port_only_bundle.joblib")
    (artifact_dir / "decision.json").write_text(json.dumps(decision, indent=2, ensure_ascii=False), encoding="utf-8")
    (artifact_dir / "data_scope_audit.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    contract = {
        "artifact": "national_port_only_bundle.joblib",
        "accepted_divisions": list(ALLOWED_DIVISIONS),
        "blocked_divisions": list(BLOCKED_DIVISIONS),
        "blocked_response": {"requires_manual_quote": True, "cost_mxn_prediction": None, "fallback_reason": "division_out_of_model_scope"},
        "outputs": ["cost_mxn_prediction", "interval_low_mxn", "interval_high_mxn", "confidence_pct", "requires_manual_quote", "division_used", "model_used", "fallback_reason"],
    }
    (artifact_dir / "inference_contract.json").write_text(json.dumps(contract, indent=2), encoding="utf-8")
    versions = {"python": platform.python_version(), "pandas": pd.__version__, "numpy": np.__version__, "lightgbm": lgb.__version__}
    (artifact_dir / "versions.json").write_text(json.dumps(versions, indent=2), encoding="utf-8")
    write_role_reviews(artifact_dir.parent / "reviews", decision, summary, acceptance)
