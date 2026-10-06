from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

try:  # Training-only dependencies; not needed by the ONNX inference package.
    import joblib
    import lightgbm as lgb
    from sklearn.metrics import mean_absolute_error, mean_squared_error
except ImportError:  # pragma: no cover - expected in minimal production images
    joblib = lgb = mean_absolute_error = mean_squared_error = None


TARGET = "cost_mxn"
DATE = "FECHA CREACIÓN_dt"
MISSING = "__MISSING__"
SEEDS = [42, 2026, 9001]

CATEGORICAL = [
    "CLIENTE_key",
    "PROVEEDOR_key",
    "ORIGEN_key",
    "DESTINO_key",
    "route_key",
    "Tipo de Equipo_key",
    "DIVISION_key",
    "RANGO_key",
    "route_type",
]
NUMERIC = ["mes_creacion", "trimestre_creacion", "dia_semana_creacion", "google_distance_km"]
EXPLICIT_CATEGORICAL = [
    "DIVISION_key",
    "Tipo de Equipo_key",
    "route_type",
    "division_equipment",
    "division_distance_band",
    "route_type_equipment",
]
DIVISION_ALIASES = {
    "crossboarder": "crossborder",
    "cross border": "crossborder",
    "port_freight": "port freight",
    "portfreight": "port freight",
}
SPECIALIST_SEGMENTS = ["national", "crossborder", "domestic"]

CONFIG = {
    "name": "lgb_m9_robust",
    "months": 9,
    "trim_low": 0.005,
    "trim_high": 0.995,
    "half_life_days": 180,
    "params": {"num_leaves": 24, "min_child_samples": 35},
}
BASE_PARAMS = {
    "objective": "regression_l1",
    "n_estimators": 450,
    "learning_rate": 0.035,
    "num_leaves": 24,
    "max_depth": -1,
    "min_child_samples": 35,
    "subsample": 0.85,
    "colsample_bytree": 0.85,
    "subsample_freq": 1,
    "reg_alpha": 0.2,
    "reg_lambda": 2.0,
    "n_jobs": 1,
    "verbosity": -1,
}


@dataclass(frozen=True)
class Fold:
    name: str
    start: pd.Timestamp
    end: pd.Timestamp


FOLDS = [
    Fold("2025_Q2", pd.Timestamp("2025-04-01"), pd.Timestamp("2025-07-01")),
    Fold("2025_Q3", pd.Timestamp("2025-07-01"), pd.Timestamp("2025-10-01")),
    Fold("2025_Q4", pd.Timestamp("2025-10-01"), pd.Timestamp("2026-01-01")),
]


def normalize_division(value: object) -> str:
    text = MISSING if pd.isna(value) else str(value).strip().lower()
    if not text:
        return MISSING
    return DIVISION_ALIASES.get(text, text)


def prepare_data(data_path: Path) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    raw = pd.read_csv(data_path, encoding="utf-8-sig", low_memory=False)
    raw[DATE] = pd.to_datetime(raw[DATE], errors="coerce")
    candidate = raw["is_training_candidate"].astype(str).str.lower().eq("true")
    target = pd.to_numeric(raw[TARGET], errors="coerce")
    raw = raw.loc[candidate & raw[DATE].notna() & target.gt(0)].copy()
    raw[TARGET] = pd.to_numeric(raw[TARGET], errors="coerce")
    for column in CATEGORICAL:
        raw[column] = raw[column].fillna(MISSING).astype(str).str.strip().replace("", MISSING)
    raw["DIVISION_key"] = raw["DIVISION_key"].map(normalize_division)
    for column in NUMERIC:
        raw[column] = pd.to_numeric(raw[column], errors="coerce")
    raw = raw.sort_values(DATE).reset_index(drop=True)
    pre2026 = raw[raw[DATE] < "2026-01-01"].copy()
    audit2026 = raw[raw[DATE] >= "2026-01-01"].copy()
    metadata = {
        "data_min_date": str(raw[DATE].min().date()),
        "data_max_date": str(raw[DATE].max().date()),
        "pre2026_rows": int(len(pre2026)),
        "audit2026_rows": int(len(audit2026)),
    }
    return pre2026, audit2026, metadata


def window_train(data: pd.DataFrame, valid_start: pd.Timestamp, months: int = 9) -> pd.DataFrame:
    lower = valid_start - pd.DateOffset(months=months)
    return data[(data[DATE] < valid_start) & (data[DATE] >= lower)].copy()


def add_interactions(frame: pd.DataFrame) -> pd.DataFrame:
    augmented = frame.copy()
    distance = pd.to_numeric(augmented["google_distance_km"], errors="coerce")
    bins = [-np.inf, 250, 500, 1000, 2000, 4000, np.inf]
    labels = ["lt250", "250_500", "500_1000", "1000_2000", "2000_4000", "ge4000"]
    distance_band = pd.cut(distance, bins=bins, labels=labels).astype("object").fillna(MISSING).astype(str)
    augmented["division_equipment"] = augmented["DIVISION_key"] + "|" + augmented["Tipo de Equipo_key"]
    augmented["division_distance_band"] = augmented["DIVISION_key"] + "|" + distance_band
    augmented["route_type_equipment"] = augmented["route_type"] + "|" + augmented["Tipo de Equipo_key"]
    return augmented


def temporal_te_train(data: pd.DataFrame, column: str, smoothing: float = 20.0, blocks: int = 5) -> pd.Series:
    ordered = data.sort_values(DATE)
    output = pd.Series(index=data.index, dtype=float)
    chunks = np.array_split(np.arange(len(ordered)), blocks)
    cold_prior = float(np.log1p(30000.0))
    for position, chunk in enumerate(chunks):
        index = ordered.index[chunk]
        if position == 0:
            output.loc[index] = cold_prior
            continue
        history_positions = np.concatenate(chunks[:position])
        history = ordered.iloc[history_positions]
        prior = float(np.log1p(history[TARGET]).median())
        stats = history.assign(_target=np.log1p(history[TARGET])).groupby(column)["_target"].agg(["mean", "count"])
        mapping = ((stats["mean"] * stats["count"] + prior * smoothing) / (stats["count"] + smoothing)).to_dict()
        output.loc[index] = ordered.loc[index, column].map(mapping).fillna(prior)
    return output.reindex(data.index)


def fit_feature_state(train: pd.DataFrame, enhanced: bool) -> dict:
    augmented = add_interactions(train) if enhanced else train
    state = {
        "enhanced": enhanced,
        "numeric_medians": {},
        "freq_maps": {},
        "te_maps": {},
        "te_prior": float(np.log1p(train[TARGET]).median()),
        "category_maps": {},
        "categorical_feature_names": [],
    }
    for column in NUMERIC:
        state["numeric_medians"][column] = float(train[column].median()) if train[column].notna().any() else 0.0
    for column in CATEGORICAL:
        state["freq_maps"][column] = train[column].value_counts(normalize=True, dropna=False).to_dict()
    for column in ["ORIGEN_key", "DESTINO_key"]:
        stats = train.assign(_target=np.log1p(train[TARGET])).groupby(column)["_target"].agg(["mean", "count"])
        state["te_maps"][column] = (
            (stats["mean"] * stats["count"] + state["te_prior"] * 20.0) / (stats["count"] + 20.0)
        ).to_dict()
    if enhanced:
        for column in EXPLICIT_CATEGORICAL:
            values = sorted(augmented[column].fillna(MISSING).astype(str).unique().tolist())
            state["category_maps"][column] = {value: index for index, value in enumerate(values)}
            state["categorical_feature_names"].append(f"{column}__code")
    return state


def make_features(data: pd.DataFrame, state: dict, training: bool = False) -> pd.DataFrame:
    augmented = add_interactions(data) if state["enhanced"] else data
    features = pd.DataFrame(index=data.index)
    for column in NUMERIC:
        features[column] = pd.to_numeric(data[column], errors="coerce").fillna(state["numeric_medians"][column])
    for column in CATEGORICAL:
        features[f"{column}__freq"] = data[column].map(state["freq_maps"][column]).fillna(0.0).astype(float)
    features["distance_log1p"] = np.log1p(features["google_distance_km"].clip(lower=0))
    for column in ["ORIGEN_key", "DESTINO_key"]:
        if training:
            features[f"{column}__te"] = temporal_te_train(data, column)
        else:
            features[f"{column}__te"] = data[column].map(state["te_maps"][column]).fillna(state["te_prior"])
    if state["enhanced"]:
        for column in EXPLICIT_CATEGORICAL:
            features[f"{column}__code"] = (
                augmented[column].fillna(MISSING).astype(str).map(state["category_maps"][column]).fillna(-1).astype("int32")
            )
    return features


def temporal_weights(data: pd.DataFrame, half_life_days: int) -> np.ndarray:
    age = (data[DATE].max() - data[DATE]).dt.days.clip(lower=0)
    return np.exp(-np.log(2.0) * age / half_life_days).to_numpy()


def fit_component(train: pd.DataFrame, seed: int, enhanced: bool) -> dict:
    lower, upper = train[TARGET].quantile([CONFIG["trim_low"], CONFIG["trim_high"]])
    trimmed = train[train[TARGET].between(lower, upper)].copy()
    state = fit_feature_state(trimmed, enhanced=enhanced)
    features = make_features(trimmed, state, training=True)
    params = {
        **BASE_PARAMS,
        **CONFIG["params"],
        "random_state": seed,
        "bagging_seed": seed,
        "feature_fraction_seed": seed,
        "data_random_seed": seed,
    }
    model = lgb.LGBMRegressor(**params)
    fit_kwargs = {}
    if state["categorical_feature_names"]:
        fit_kwargs["categorical_feature"] = state["categorical_feature_names"]
    model.fit(
        features,
        np.log1p(trimmed[TARGET]),
        sample_weight=temporal_weights(trimmed, CONFIG["half_life_days"]),
        **fit_kwargs,
    )
    return {
        "model": model,
        "state": state,
        "features": features.columns.tolist(),
        "seed": seed,
        "enhanced": enhanced,
        "trim_bounds": [float(lower), float(upper)],
        "trained_through": str(trimmed[DATE].max().date()),
        "n_train": int(len(trimmed)),
    }


def fit_ensemble(train: pd.DataFrame, enhanced: bool, seeds: list[int]) -> list[dict]:
    return [fit_component(train, seed, enhanced=enhanced) for seed in seeds]


def predict_component(component: dict, data: pd.DataFrame) -> np.ndarray:
    features = make_features(data, component["state"], training=False)
    features = features.reindex(columns=component["features"], fill_value=0)
    return np.maximum(np.expm1(component["model"].predict(features)), 0.0)


def predict_ensemble(components: list[dict], data: pd.DataFrame) -> np.ndarray:
    predictions = np.vstack([predict_component(component, data) for component in components])
    return predictions.mean(axis=0)


def predict_legacy_bundle(bundle: dict, data: pd.DataFrame) -> np.ndarray:
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
    return 2.0 * np.maximum(y - prediction, 0.0) + np.maximum(prediction - y, 0.0)


def metrics(y: pd.Series | np.ndarray, prediction: np.ndarray) -> dict:
    y = np.asarray(y, dtype=float)
    prediction = np.maximum(np.asarray(prediction, dtype=float), 0.0)
    error = prediction - y
    under = np.maximum(y - prediction, 0.0)
    return {
        "ASYM_LOSS": float(row_loss(y, prediction).mean()),
        "MAE": float(mean_absolute_error(y, prediction)),
        "RMSE": float(mean_squared_error(y, prediction) ** 0.5),
        "WAPE_%": float(100.0 * np.abs(error).sum() / np.abs(y).sum()),
        "Bias": float(error.mean()),
        "P90_AE": float(np.quantile(np.abs(error), 0.90)),
        "P90_UNDER": float(np.quantile(under, 0.90)),
        "UNDER_RATE_%": float(100.0 * np.mean(error < 0.0)),
    }


def learn_weight(history: pd.DataFrame, regularization: float = 0.02) -> float:
    if history.empty or len(history) < 100:
        return 0.0
    grid = np.linspace(0.0, 1.0, 21)
    scale = max(float(row_loss(history["y"], history["global_pred"]).mean()), 1.0)
    scores = []
    for alpha in grid:
        blended = (1.0 - alpha) * history["global_pred"].to_numpy() + alpha * history["specialist_pred"].to_numpy()
        score = float(row_loss(history["y"], blended).mean()) + regularization * scale * alpha**2
        scores.append(score)
    return float(grid[int(np.argmin(scores))])


def _prediction_rows(validation: pd.DataFrame, fold: str, candidate: str, prediction: np.ndarray) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "fold": fold,
            "row_id": validation.index,
            "route_key": validation["route_key"].to_numpy(),
            "division": validation["DIVISION_key"].to_numpy(),
            "candidate": candidate,
            "y": validation[TARGET].to_numpy(),
            "pred": prediction,
        }
    )


def run_backtests(pre2026: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict[str, pd.DataFrame]]:
    prediction_rows = []
    fold_rows = []
    weight_rows = []
    history = {segment: pd.DataFrame(columns=["y", "global_pred", "specialist_pred"]) for segment in SPECIALIST_SEGMENTS}

    for fold in FOLDS:
        train = window_train(pre2026, fold.start, CONFIG["months"])
        validation = pre2026[(pre2026[DATE] >= fold.start) & (pre2026[DATE] < fold.end)].copy()
        current_global = fit_ensemble(train, enhanced=False, seeds=[42])
        enhanced_global = fit_ensemble(train, enhanced=True, seeds=[42])
        current_prediction = predict_ensemble(current_global, validation)
        enhanced_prediction = predict_ensemble(enhanced_global, validation)

        specialist_predictions = {}
        for segment in SPECIALIST_SEGMENTS:
            train_segment = train[train["DIVISION_key"].eq(segment)]
            validation_mask = validation["DIVISION_key"].eq(segment)
            values = np.full(len(validation), np.nan)
            if len(train_segment) >= 100 and validation_mask.any():
                specialist = fit_ensemble(train_segment, enhanced=True, seeds=[42])
                values[validation_mask.to_numpy()] = predict_ensemble(specialist, validation[validation_mask])
            specialist_predictions[segment] = values

        pooled_mask_train = train["DIVISION_key"].isin(["crossborder", "domestic"])
        pooled_model = fit_ensemble(train[pooled_mask_train], enhanced=True, seeds=[42])
        pooled_values = np.full(len(validation), np.nan)
        pooled_mask_valid = validation["DIVISION_key"].isin(["crossborder", "domestic"])
        pooled_values[pooled_mask_valid.to_numpy()] = predict_ensemble(pooled_model, validation[pooled_mask_valid])

        hybrid_prediction = enhanced_prediction.copy()
        hard_split_prediction = enhanced_prediction.copy()
        national_mask = validation["DIVISION_key"].eq("national").to_numpy()
        hard_split_prediction[national_mask] = specialist_predictions["national"][national_mask]
        pooled_mask = pooled_mask_valid.to_numpy()
        hard_split_prediction[pooled_mask] = pooled_values[pooled_mask]

        for segment in SPECIALIST_SEGMENTS:
            alpha = learn_weight(history[segment])
            weight_rows.append({"fold": fold.name, "segment": segment, "weight": alpha, "history_n": int(len(history[segment]))})
            mask = validation["DIVISION_key"].eq(segment).to_numpy()
            available = mask & np.isfinite(specialist_predictions[segment])
            hybrid_prediction[available] = (
                (1.0 - alpha) * enhanced_prediction[available]
                + alpha * specialist_predictions[segment][available]
            )

        candidates = {
            "current_global": current_prediction,
            "enhanced_global": enhanced_prediction,
            "hybrid_shrinkage": hybrid_prediction,
            "hard_split_two": hard_split_prediction,
        }
        for candidate, prediction in candidates.items():
            prediction_rows.append(_prediction_rows(validation, fold.name, candidate, prediction))
            fold_rows.append(
                {
                    "fold": fold.name,
                    "candidate": candidate,
                    "n_train": int(len(train)),
                    "n_valid": int(len(validation)),
                    **metrics(validation[TARGET], prediction),
                }
            )

        for segment in SPECIALIST_SEGMENTS:
            mask = validation["DIVISION_key"].eq(segment).to_numpy()
            available = mask & np.isfinite(specialist_predictions[segment])
            current_history = pd.DataFrame(
                {
                    "y": validation.loc[available, TARGET].to_numpy(),
                    "global_pred": enhanced_prediction[available],
                    "specialist_pred": specialist_predictions[segment][available],
                }
            )
            history[segment] = pd.concat([history[segment], current_history], ignore_index=True)

    return (
        pd.concat(prediction_rows, ignore_index=True),
        pd.DataFrame(fold_rows),
        pd.DataFrame(weight_rows),
        history,
    )


def candidate_summary(oof: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for candidate, group in oof.groupby("candidate"):
        fold_values = [metrics(fold_group["y"], fold_group["pred"]) for _, fold_group in group.groupby("fold")]
        overall = metrics(group["y"], group["pred"])
        rows.append(
            {
                "candidate": candidate,
                **overall,
                "ASYM_LOSS_fold_median": float(np.median([value["ASYM_LOSS"] for value in fold_values])),
                "MAE_fold_median": float(np.median([value["MAE"] for value in fold_values])),
                "MAE_fold_max": float(np.max([value["MAE"] for value in fold_values])),
            }
        )
    return pd.DataFrame(rows).sort_values("ASYM_LOSS_fold_median").reset_index(drop=True)


def segment_summary(oof: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for (candidate, segment), group in oof.groupby(["candidate", "division"]):
        rows.append({"candidate": candidate, "division": segment, "n": int(len(group)), **metrics(group["y"], group["pred"])})
    return pd.DataFrame(rows)


def route_bootstrap(oof: pd.DataFrame, candidate: str, iterations: int = 1000, seed: int = 2026) -> dict:
    baseline = oof[oof["candidate"].eq("current_global")].copy()
    challenger = oof[oof["candidate"].eq(candidate)][["fold", "row_id", "pred"]].rename(columns={"pred": "challenger_pred"})
    paired = baseline.merge(challenger, on=["fold", "row_id"], how="inner")
    paired["delta"] = row_loss(paired["y"], paired["challenger_pred"]) - row_loss(paired["y"], paired["pred"])
    route_deltas = paired.groupby("route_key")["delta"].agg(["sum", "count"])
    rng = np.random.default_rng(seed)
    values = []
    positions = np.arange(len(route_deltas))
    sums = route_deltas["sum"].to_numpy()
    counts = route_deltas["count"].to_numpy()
    for _ in range(iterations):
        sampled = rng.choice(positions, size=len(positions), replace=True)
        values.append(float(sums[sampled].sum() / counts[sampled].sum()))
    return {
        "candidate": candidate,
        "delta_asym_loss": float(paired["delta"].mean()),
        "ci95_low": float(np.quantile(values, 0.025)),
        "ci95_high": float(np.quantile(values, 0.975)),
        "probability_improvement_%": float(100.0 * np.mean(np.asarray(values) < 0.0)),
        "bootstrap_routes": int(len(route_deltas)),
        "iterations": iterations,
    }


def evaluate_acceptance(oof: pd.DataFrame, fold_metrics: pd.DataFrame, bootstrap: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    summary = candidate_summary(oof).set_index("candidate")
    segments = segment_summary(oof)
    baseline = summary.loc["current_global"]
    rows = []
    for candidate in ["enhanced_global", "hybrid_shrinkage", "hard_split_two"]:
        current = summary.loc[candidate]
        base_folds = fold_metrics[fold_metrics["candidate"].eq("current_global")].set_index("fold")
        candidate_folds = fold_metrics[fold_metrics["candidate"].eq(candidate)].set_index("fold")
        fold_ratio = candidate_folds["ASYM_LOSS"] / base_folds["ASYM_LOSS"]
        fold_wins = int((candidate_folds["ASYM_LOSS"] < base_folds["ASYM_LOSS"]).sum())
        base_segments = segments[segments["candidate"].eq("current_global")].set_index("division")
        candidate_segments = segments[segments["candidate"].eq(candidate)].set_index("division")
        common = base_segments.index.intersection(candidate_segments.index)
        eligible = [segment for segment in common if base_segments.loc[segment, "n"] >= 100]
        worst_segment_ratio = max(candidate_segments.loc[segment, "MAE"] / base_segments.loc[segment, "MAE"] for segment in eligible)
        base_cross = base_segments.loc["crossborder"]
        candidate_cross = candidate_segments.loc["crossborder"]
        boot = bootstrap[bootstrap["candidate"].eq(candidate)].iloc[0]
        checks = {
            "asym_loss_reduction_ge_5pct": current["ASYM_LOSS_fold_median"] <= 0.95 * baseline["ASYM_LOSS_fold_median"],
            "overall_mae_not_worse_2pct": current["MAE"] <= 1.02 * baseline["MAE"],
            "no_fold_worse_5pct": float(fold_ratio.max()) <= 1.05,
            "no_segment_worse_5pct": float(worst_segment_ratio) <= 1.05,
            "crossborder_bias_improves": abs(candidate_cross["Bias"]) <= abs(base_cross["Bias"]),
            "crossborder_p90_under_improves": candidate_cross["P90_UNDER"] <= base_cross["P90_UNDER"],
            "wins_at_least_two_folds": fold_wins >= 2,
            "bootstrap_ci_below_zero": boot["ci95_high"] < 0.0,
        }
        rows.append(
            {
                "candidate": candidate,
                "accepted": bool(all(checks.values())),
                "fold_wins": fold_wins,
                "worst_fold_asym_ratio": float(fold_ratio.max()),
                "worst_segment_mae_ratio": float(worst_segment_ratio),
                **checks,
            }
        )
    acceptance = pd.DataFrame(rows)
    accepted = acceptance[acceptance["accepted"]]
    selected = (
        summary.loc[accepted["candidate"]].sort_values("ASYM_LOSS_fold_median").index[0]
        if not accepted.empty
        else "current_global"
    )
    challenger = summary.drop(index="current_global").sort_values("ASYM_LOSS_fold_median").index[0]
    decision = {
        "selected_candidate": selected,
        "best_new_challenger": challenger,
        "promote_new_architecture": selected != "current_global",
        "selection_basis": "pre-2026 temporal backtests only",
        "primary_loss": "2 * underprediction + 1 * overprediction",
    }
    return acceptance, decision


def final_weights(history: dict[str, pd.DataFrame]) -> dict[str, float]:
    return {segment: learn_weight(frame) for segment, frame in history.items()}


def train_final(pre2026: pd.DataFrame, weights: dict[str, float]) -> dict:
    train = window_train(pre2026, pd.Timestamp("2026-01-01"), CONFIG["months"])
    current = fit_ensemble(train, enhanced=False, seeds=SEEDS)
    enhanced = fit_ensemble(train, enhanced=True, seeds=SEEDS)
    specialists = {
        segment: fit_ensemble(train[train["DIVISION_key"].eq(segment)], enhanced=True, seeds=SEEDS)
        for segment in SPECIALIST_SEGMENTS
    }
    pooled = fit_ensemble(
        train[train["DIVISION_key"].isin(["crossborder", "domestic"])], enhanced=True, seeds=SEEDS
    )
    return {
        "current_global": current,
        "enhanced_global": enhanced,
        "specialists": specialists,
        "cross_domestic_pooled": pooled,
        "weights": weights,
        "n_train": int(len(train)),
        "training_start": str(train[DATE].min().date()),
        "training_end": str(train[DATE].max().date()),
    }


def predict_candidates(final_models: dict, data: pd.DataFrame) -> dict[str, np.ndarray]:
    current = predict_ensemble(final_models["current_global"], data)
    enhanced = predict_ensemble(final_models["enhanced_global"], data)
    hybrid = enhanced.copy()
    hard_split = enhanced.copy()
    for segment in SPECIALIST_SEGMENTS:
        mask = data["DIVISION_key"].eq(segment).to_numpy()
        if not mask.any():
            continue
        specialist = predict_ensemble(final_models["specialists"][segment], data[mask])
        alpha = final_models["weights"].get(segment, 0.0)
        hybrid[mask] = (1.0 - alpha) * enhanced[mask] + alpha * specialist
        if segment == "national":
            hard_split[mask] = specialist
    pooled_mask = data["DIVISION_key"].isin(["crossborder", "domestic"]).to_numpy()
    if pooled_mask.any():
        hard_split[pooled_mask] = predict_ensemble(final_models["cross_domestic_pooled"], data[pooled_mask])
    return {
        "current_global": current,
        "enhanced_global": enhanced,
        "hybrid_shrinkage": hybrid,
        "hard_split_two": hard_split,
    }


def audit_candidates(final_models: dict, audit2026: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    predictions = predict_candidates(final_models, audit2026)
    overall = []
    segments = []
    for candidate, prediction in predictions.items():
        overall.append({"candidate": candidate, "n": int(len(audit2026)), **metrics(audit2026[TARGET], prediction)})
        work = audit2026[[TARGET, "DIVISION_key"]].copy()
        work["pred"] = prediction
        for segment, group in work.groupby("DIVISION_key"):
            segments.append({"candidate": candidate, "division": segment, "n": int(len(group)), **metrics(group[TARGET], group["pred"])})
    return pd.DataFrame(overall), pd.DataFrame(segments)


def uncertainty_by_division(oof: pd.DataFrame, candidate: str = "hybrid_shrinkage") -> dict:
    selected = oof[oof["candidate"].eq(candidate)].copy()
    result = {"__GLOBAL__": float(np.quantile(np.abs(selected["y"] - selected["pred"]), 0.95))}
    for division, group in selected.groupby("division"):
        if len(group) >= 100:
            result[division] = float(np.quantile(np.abs(group["y"] - group["pred"]), 0.95))
    return result


def build_experimental_bundle(final_models: dict, oof: pd.DataFrame, metadata: dict, decision: dict) -> dict:
    return {
        "artifact_type": "segmentation_hybrid_challenger",
        "target": TARGET,
        "date_col": DATE,
        "required_features": CATEGORICAL + NUMERIC,
        "anchor_models": final_models["enhanced_global"],
        "specialists": final_models["specialists"],
        "weights": final_models["weights"],
        "uncertainty_q95_mxn": uncertainty_by_division(oof),
        "fallback": "enhanced_global when division is missing, unknown, port freight, or maritime",
        "division_aliases": DIVISION_ALIASES,
        "decision": decision,
        "metadata": metadata,
        "configuration": CONFIG,
        "seeds": SEEDS,
    }


def prepare_inference(data: pd.DataFrame) -> pd.DataFrame:
    frame = data.copy()
    for column in CATEGORICAL:
        if column not in frame:
            frame[column] = MISSING
        frame[column] = frame[column].fillna(MISSING).astype(str).str.strip().replace("", MISSING)
    frame["DIVISION_key"] = frame["DIVISION_key"].map(normalize_division)
    for column in NUMERIC:
        if column not in frame:
            frame[column] = np.nan
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame


def predict_hybrid(bundle: dict, new_quotes: pd.DataFrame) -> pd.DataFrame:
    data = prepare_inference(new_quotes)
    global_prediction = predict_ensemble(bundle["anchor_models"], data)
    final_prediction = global_prediction.copy()
    specialist_prediction = np.full(len(data), np.nan)
    weight_used = np.zeros(len(data))
    model_path = np.full(len(data), "global_fallback", dtype=object)
    for segment, models in bundle["specialists"].items():
        mask = data["DIVISION_key"].eq(segment).to_numpy()
        if not mask.any():
            continue
        values = predict_ensemble(models, data[mask])
        alpha = float(bundle["weights"].get(segment, 0.0))
        specialist_prediction[mask] = values
        weight_used[mask] = alpha
        final_prediction[mask] = (1.0 - alpha) * global_prediction[mask] + alpha * values
        model_path[mask] = "hybrid" if alpha > 0 else "global_weight_zero"
    q95_map = bundle["uncertainty_q95_mxn"]
    q95 = data["DIVISION_key"].map(q95_map).fillna(q95_map["__GLOBAL__"]).to_numpy(float)
    return pd.DataFrame(
        {
            "cost_mxn_prediction": final_prediction,
            "global_prediction_mxn": global_prediction,
            "specialist_prediction_mxn": specialist_prediction,
            "specialist_weight": weight_used,
            "division_used": data["DIVISION_key"].to_numpy(),
            "model_path": model_path,
            "interval_low_mxn": np.maximum(final_prediction - q95, 0.0),
            "interval_high_mxn": final_prediction + q95,
        },
        index=new_quotes.index,
    )


def save_bundle(bundle: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, path)


def load_bundle(path: Path) -> dict:
    return joblib.load(path)
