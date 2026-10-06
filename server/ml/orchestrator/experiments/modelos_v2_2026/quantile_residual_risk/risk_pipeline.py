from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

try:  # Training-only dependencies; not needed by the ONNX inference package.
    import joblib
    import lightgbm as lgb
except ImportError:  # pragma: no cover
    joblib = lgb = None


ROOT = Path(__file__).resolve().parents[3]
HYBRID_DIR = ROOT / "experiments/modelos_v2_2026/segmentation_hybrid"
if str(HYBRID_DIR) not in sys.path:
    sys.path.insert(0, str(HYBRID_DIR))

import hybrid_pipeline as hp


TARGET = hp.TARGET
DATE = hp.DATE
MISSING = hp.MISSING
SEEDS = hp.SEEDS
CATEGORICAL = hp.CATEGORICAL
NUMERIC = hp.NUMERIC
FOLDS = hp.FOLDS
CONFIG = hp.CONFIG

HISTORY_KEYS = [
    "route_key",
    "CLIENTE_key",
    "PROVEEDOR_key",
    "route_equipment",
    "division_equipment",
]
QUANTILE_ASYMMETRIC = 2.0 / 3.0


def prepare_data(data_path: Path) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    return hp.prepare_data(data_path)


def augment_history_keys(data: pd.DataFrame) -> pd.DataFrame:
    augmented = hp.add_interactions(data)
    augmented["route_equipment"] = augmented["route_key"] + "|" + augmented["Tipo de Equipo_key"]
    return augmented


def temporal_history_feature(
    data: pd.DataFrame,
    column: str,
    value_kind: str,
    smoothing: float = 20.0,
    blocks: int = 6,
) -> pd.Series:
    ordered = data.sort_values(DATE)
    output = pd.Series(index=data.index, dtype=float)
    chunks = np.array_split(np.arange(len(ordered)), blocks)
    cold_prior = float(np.log1p(30000.0))
    for position, chunk in enumerate(chunks):
        index = ordered.index[chunk]
        if position == 0:
            output.loc[index] = cold_prior if value_kind == "target" else 0.0
            continue
        history = ordered.iloc[np.concatenate(chunks[:position])]
        if value_kind == "count":
            mapping = history[column].value_counts().to_dict()
            output.loc[index] = np.log1p(ordered.loc[index, column].map(mapping).fillna(0.0))
            continue
        prior = float(np.log1p(history[TARGET]).median())
        stats = history.assign(_target=np.log1p(history[TARGET])).groupby(column)["_target"].agg(["mean", "count"])
        mapping = ((stats["mean"] * stats["count"] + prior * smoothing) / (stats["count"] + smoothing)).to_dict()
        output.loc[index] = ordered.loc[index, column].map(mapping).fillna(prior)
    return output.reindex(data.index)


def fit_risk_state(train: pd.DataFrame) -> dict:
    augmented = augment_history_keys(train)
    state = {
        "base": hp.fit_feature_state(train, enhanced=True),
        "history_te_maps": {},
        "history_count_maps": {},
        "history_prior": float(np.log1p(train[TARGET]).median()),
    }
    for column in HISTORY_KEYS:
        stats = augmented.assign(_target=np.log1p(augmented[TARGET])).groupby(column)["_target"].agg(["mean", "count"])
        state["history_te_maps"][column] = (
            (stats["mean"] * stats["count"] + state["history_prior"] * 20.0) / (stats["count"] + 20.0)
        ).to_dict()
        state["history_count_maps"][column] = augmented[column].value_counts().to_dict()
    return state


def make_risk_features(data: pd.DataFrame, state: dict, training: bool = False) -> pd.DataFrame:
    augmented = augment_history_keys(data)
    features = hp.make_features(data, state["base"], training=training)
    for column in HISTORY_KEYS:
        if training:
            features[f"{column}__history_te"] = temporal_history_feature(augmented, column, "target")
            features[f"{column}__history_count_log1p"] = temporal_history_feature(augmented, column, "count")
        else:
            features[f"{column}__history_te"] = (
                augmented[column].map(state["history_te_maps"][column]).fillna(state["history_prior"])
            )
            features[f"{column}__history_count_log1p"] = np.log1p(
                augmented[column].map(state["history_count_maps"][column]).fillna(0.0)
            )
    return features.astype(float)


def fit_risk_component(
    train: pd.DataFrame,
    seed: int,
    objective: str = "regression_l1",
    alpha: float | None = None,
) -> dict:
    source = train.copy()
    trim_bounds = [None, None]
    if objective == "regression_l1":
        lower, upper = source[TARGET].quantile([CONFIG["trim_low"], CONFIG["trim_high"]])
        source = source[source[TARGET].between(lower, upper)].copy()
        trim_bounds = [float(lower), float(upper)]
    state = fit_risk_state(source)
    features = make_risk_features(source, state, training=True)
    params = {
        **hp.BASE_PARAMS,
        **CONFIG["params"],
        "objective": objective,
        "random_state": seed,
        "bagging_seed": seed,
        "feature_fraction_seed": seed,
        "data_random_seed": seed,
    }
    if alpha is not None:
        params["alpha"] = alpha
    model = lgb.LGBMRegressor(**params)
    model.fit(
        features,
        np.log1p(source[TARGET]),
        sample_weight=hp.temporal_weights(source, CONFIG["half_life_days"]),
        categorical_feature=state["base"]["categorical_feature_names"],
    )
    return {
        "model": model,
        "state": state,
        "features": features.columns.tolist(),
        "objective": objective,
        "alpha": alpha,
        "seed": seed,
        "trim_bounds": trim_bounds,
        "n_train": int(len(source)),
        "trained_through": str(source[DATE].max().date()),
    }


def fit_risk_ensemble(
    train: pd.DataFrame,
    seeds: list[int],
    objective: str = "regression_l1",
    alpha: float | None = None,
) -> list[dict]:
    return [fit_risk_component(train, seed, objective=objective, alpha=alpha) for seed in seeds]


def predict_risk_component(component: dict, data: pd.DataFrame) -> np.ndarray:
    features = make_risk_features(data, component["state"], training=False)
    features = features.reindex(columns=component["features"], fill_value=0)
    return np.maximum(np.expm1(component["model"].predict(features)), 0.0)


def predict_risk_ensemble(components: list[dict], data: pd.DataFrame) -> np.ndarray:
    return np.vstack([predict_risk_component(component, data) for component in components]).mean(axis=0)


def fit_enhanced_quantile_component(train: pd.DataFrame, seed: int, alpha: float) -> dict:
    state = hp.fit_feature_state(train, enhanced=True)
    features = hp.make_features(train, state, training=True)
    params = {
        **hp.BASE_PARAMS,
        **CONFIG["params"],
        "objective": "quantile",
        "alpha": alpha,
        "random_state": seed,
        "bagging_seed": seed,
        "feature_fraction_seed": seed,
        "data_random_seed": seed,
    }
    model = lgb.LGBMRegressor(**params)
    model.fit(
        features,
        np.log1p(train[TARGET]),
        sample_weight=hp.temporal_weights(train, CONFIG["half_life_days"]),
        categorical_feature=state["categorical_feature_names"],
    )
    return {
        "model": model,
        "state": state,
        "features": features.columns.tolist(),
        "seed": seed,
        "alpha": alpha,
        "n_train": int(len(train)),
        "trained_through": str(train[DATE].max().date()),
    }


def fit_enhanced_quantile_ensemble(train: pd.DataFrame, seeds: list[int], alpha: float) -> list[dict]:
    return [fit_enhanced_quantile_component(train, seed, alpha) for seed in seeds]


def predict_enhanced_quantile_ensemble(components: list[dict], data: pd.DataFrame) -> np.ndarray:
    predictions = []
    for component in components:
        features = hp.make_features(data, component["state"], training=False)
        features = features.reindex(columns=component["features"], fill_value=0)
        predictions.append(np.maximum(np.expm1(component["model"].predict(features)), 0.0))
    return np.vstack(predictions).mean(axis=0)


def route_history_count(component: dict, data: pd.DataFrame) -> np.ndarray:
    if "history_count_maps" in component["state"]:
        mapping = component["state"]["history_count_maps"]["route_key"]
        return data["route_key"].map(mapping).fillna(0.0).to_numpy(float)
    frequency = data["route_key"].map(component["state"]["freq_maps"]["route_key"]).fillna(0.0)
    return (frequency * component["n_train"]).to_numpy(float)


def base_feature_state(component: dict) -> dict:
    return component["state"].get("base", component["state"])


def residual_features(
    data: pd.DataFrame,
    central_prediction: np.ndarray,
    q67_prediction: np.ndarray,
    central_component: dict,
) -> pd.DataFrame:
    route_count = route_history_count(central_component, data)
    distance = pd.to_numeric(data["google_distance_km"], errors="coerce")
    base_state = base_feature_state(central_component)
    distance = distance.fillna(base_state["numeric_medians"]["google_distance_km"])
    equipment_frequency = data["Tipo de Equipo_key"].map(
        base_state["freq_maps"]["Tipo de Equipo_key"]
    ).fillna(0.0)
    return pd.DataFrame(
        {
            "central_prediction": central_prediction,
            "log_central_prediction": np.log1p(np.maximum(central_prediction, 0.0)),
            "q67_prediction": q67_prediction,
            "quantile_gap": q67_prediction - central_prediction,
            "google_distance_km": distance.to_numpy(),
            "distance_log1p": np.log1p(distance.clip(lower=0)).to_numpy(),
            "route_history_count_log1p": np.log1p(route_count),
            "route_new": (route_count == 0).astype(float),
            "equipment_frequency": equipment_frequency.to_numpy(float),
            "mes_creacion": pd.to_numeric(data["mes_creacion"], errors="coerce").fillna(0.0).to_numpy(),
        },
        index=data.index,
    )


def fit_residual_model(history: pd.DataFrame) -> dict | None:
    if len(history) < 250:
        return None
    feature_columns = [column for column in history.columns if column not in {"residual", DATE, "y", "row_id"}]
    params = {
        "objective": "quantile",
        "alpha": QUANTILE_ASYMMETRIC,
        "n_estimators": 250,
        "learning_rate": 0.03,
        "num_leaves": 12,
        "min_child_samples": 30,
        "subsample": 0.85,
        "subsample_freq": 1,
        "colsample_bytree": 0.9,
        "reg_lambda": 4.0,
        "random_state": 42,
        "n_jobs": 1,
        "verbosity": -1,
    }
    model = lgb.LGBMRegressor(**params)
    weights = hp.temporal_weights(history, CONFIG["half_life_days"])
    model.fit(history[feature_columns], history["residual"], sample_weight=weights)
    lower, upper = history["residual"].quantile([0.05, 0.95])
    return {"model": model, "features": feature_columns, "clip": [float(lower), float(upper)], "n_train": int(len(history))}


def apply_residual(model_bundle: dict | None, features: pd.DataFrame) -> np.ndarray:
    if model_bundle is None:
        return np.zeros(len(features))
    correction = model_bundle["model"].predict(features.reindex(columns=model_bundle["features"], fill_value=0))
    return np.clip(correction, model_bundle["clip"][0], model_bundle["clip"][1])


def prediction_rows(validation: pd.DataFrame, fold: str, candidate: str, prediction: np.ndarray) -> pd.DataFrame:
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


def run_backtests(pre2026: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    oof_rows = []
    fold_rows = []
    residual_history = pd.DataFrame()
    residual_diagnostics = []
    for fold in FOLDS:
        train = hp.window_train(pre2026, fold.start, CONFIG["months"])
        validation = pre2026[(pre2026[DATE] >= fold.start) & (pre2026[DATE] < fold.end)].copy()

        baseline_models = hp.fit_ensemble(train, enhanced=True, seeds=[42])
        history_models = fit_risk_ensemble(train, seeds=[42])
        q60_models = fit_enhanced_quantile_ensemble(train, seeds=[42], alpha=0.60)
        q67_models = fit_enhanced_quantile_ensemble(train, seeds=[42], alpha=QUANTILE_ASYMMETRIC)
        q75_models = fit_enhanced_quantile_ensemble(train, seeds=[42], alpha=0.75)
        baseline = hp.predict_ensemble(baseline_models, validation)
        history_central = predict_risk_ensemble(history_models, validation)
        q60 = predict_enhanced_quantile_ensemble(q60_models, validation)
        q67 = predict_enhanced_quantile_ensemble(q67_models, validation)
        q75 = predict_enhanced_quantile_ensemble(q75_models, validation)

        cross_mask = validation["DIVISION_key"].eq("crossborder").to_numpy()
        residual_model = fit_residual_model(residual_history)
        residual_prediction = baseline.copy()
        residual_feature_frame = residual_features(validation, baseline, q67, baseline_models[0])
        correction = apply_residual(residual_model, residual_feature_frame.loc[cross_mask])
        residual_prediction[cross_mask] = np.maximum(baseline[cross_mask] + correction, 0.0)

        route_count = route_history_count(baseline_models[0], validation)
        adaptive = residual_prediction.copy()
        high_risk = cross_mask & (route_count < 4)
        adaptive[high_risk] = np.maximum(adaptive[high_risk], q67[high_risk])

        candidates = {
            "enhanced_global_baseline": baseline,
            "history_central": history_central,
            "enhanced_quantile_060": q60,
            "enhanced_quantile_067": q67,
            "enhanced_quantile_075": q75,
            "cross_residual": residual_prediction,
            "adaptive_cross_risk": adaptive,
        }
        for candidate, prediction in candidates.items():
            oof_rows.append(prediction_rows(validation, fold.name, candidate, prediction))
            fold_rows.append(
                {
                    "fold": fold.name,
                    "candidate": candidate,
                    "n_train": int(len(train)),
                    "n_valid": int(len(validation)),
                    **hp.metrics(validation[TARGET], prediction),
                }
            )

        cross_features = residual_feature_frame.loc[cross_mask].copy()
        cross_features["residual"] = validation.loc[cross_mask, TARGET].to_numpy() - baseline[cross_mask]
        cross_features["y"] = validation.loc[cross_mask, TARGET].to_numpy()
        cross_features[DATE] = validation.loc[cross_mask, DATE].to_numpy()
        cross_features["row_id"] = validation.index[cross_mask]
        residual_history = pd.concat([residual_history, cross_features], ignore_index=True)
        residual_diagnostics.append(
            {
                "fold": fold.name,
                "history_rows_before_fold": int(0 if residual_model is None else residual_model["n_train"]),
                "crossborder_validation_rows": int(cross_mask.sum()),
                "route_new_crossborder": int((high_risk & (route_count == 0)).sum()),
            }
        )
    return pd.concat(oof_rows, ignore_index=True), pd.DataFrame(fold_rows), pd.DataFrame(residual_diagnostics)


def candidate_summary(oof: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for candidate, group in oof.groupby("candidate"):
        fold_metrics = [hp.metrics(part["y"], part["pred"]) for _, part in group.groupby("fold")]
        rows.append(
            {
                "candidate": candidate,
                **hp.metrics(group["y"], group["pred"]),
                "ASYM_LOSS_fold_median": float(np.median([item["ASYM_LOSS"] for item in fold_metrics])),
                "MAE_fold_median": float(np.median([item["MAE"] for item in fold_metrics])),
                "MAE_fold_max": float(np.max([item["MAE"] for item in fold_metrics])),
            }
        )
    return pd.DataFrame(rows).sort_values("ASYM_LOSS_fold_median").reset_index(drop=True)


def segment_summary(oof: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for (candidate, division), group in oof.groupby(["candidate", "division"]):
        rows.append({"candidate": candidate, "division": division, "n": int(len(group)), **hp.metrics(group["y"], group["pred"])})
    return pd.DataFrame(rows)


def route_bootstrap(
    oof: pd.DataFrame,
    candidate: str,
    baseline: str = "enhanced_global_baseline",
    iterations: int = 1000,
) -> dict:
    base = oof[oof["candidate"].eq(baseline)].copy()
    challenger = oof[oof["candidate"].eq(candidate)][["fold", "row_id", "pred"]].rename(columns={"pred": "challenger"})
    paired = base.merge(challenger, on=["fold", "row_id"])
    paired["delta"] = hp.row_loss(paired["y"], paired["challenger"]) - hp.row_loss(paired["y"], paired["pred"])
    clusters = paired.groupby("route_key")["delta"].agg(["sum", "count"])
    rng = np.random.default_rng(2026)
    positions = np.arange(len(clusters))
    values = []
    for _ in range(iterations):
        sampled = rng.choice(positions, size=len(positions), replace=True)
        values.append(float(clusters["sum"].to_numpy()[sampled].sum() / clusters["count"].to_numpy()[sampled].sum()))
    return {
        "candidate": candidate,
        "delta_asym_loss": float(paired["delta"].mean()),
        "ci95_low": float(np.quantile(values, 0.025)),
        "ci95_high": float(np.quantile(values, 0.975)),
        "probability_improvement_%": float(100.0 * np.mean(np.asarray(values) < 0.0)),
        "routes": int(len(clusters)),
    }


def evaluate_acceptance(
    oof: pd.DataFrame,
    fold_metrics: pd.DataFrame,
    bootstrap: pd.DataFrame,
) -> tuple[pd.DataFrame, dict]:
    baseline_name = "enhanced_global_baseline"
    summary = candidate_summary(oof).set_index("candidate")
    segments = segment_summary(oof)
    baseline = summary.loc[baseline_name]
    base_folds = fold_metrics[fold_metrics["candidate"].eq(baseline_name)].set_index("fold")
    base_segments = segments[segments["candidate"].eq(baseline_name)].set_index("division")
    rows = []
    candidates = [candidate for candidate in summary.index if candidate != baseline_name]
    for candidate in candidates:
        current = summary.loc[candidate]
        candidate_folds = fold_metrics[fold_metrics["candidate"].eq(candidate)].set_index("fold")
        fold_ratio = candidate_folds["ASYM_LOSS"] / base_folds["ASYM_LOSS"]
        candidate_segments = segments[segments["candidate"].eq(candidate)].set_index("division")
        eligible = [division for division in base_segments.index if base_segments.loc[division, "n"] >= 100]
        worst_segment_ratio = max(candidate_segments.loc[d, "MAE"] / base_segments.loc[d, "MAE"] for d in eligible)
        base_cross = base_segments.loc["crossborder"]
        candidate_cross = candidate_segments.loc["crossborder"]
        boot = bootstrap[bootstrap["candidate"].eq(candidate)].iloc[0]
        checks = {
            "asym_loss_reduction_ge_5pct": current["ASYM_LOSS_fold_median"] <= 0.95 * baseline["ASYM_LOSS_fold_median"],
            "overall_mae_not_worse_2pct": current["MAE"] <= 1.02 * baseline["MAE"],
            "no_fold_worse_5pct": float(fold_ratio.max()) <= 1.05,
            "no_segment_mae_worse_5pct": float(worst_segment_ratio) <= 1.05,
            "crossborder_p90_under_improves": candidate_cross["P90_UNDER"] <= base_cross["P90_UNDER"],
            "wins_at_least_two_folds": int((candidate_folds["ASYM_LOSS"] < base_folds["ASYM_LOSS"]).sum()) >= 2,
            "bootstrap_ci_below_zero": boot["ci95_high"] < 0.0,
        }
        rows.append(
            {
                "candidate": candidate,
                "accepted": bool(all(checks.values())),
                "worst_fold_asym_ratio": float(fold_ratio.max()),
                "worst_segment_mae_ratio": float(worst_segment_ratio),
                **checks,
            }
        )
    acceptance = pd.DataFrame(rows)
    accepted = acceptance[acceptance["accepted"]]["candidate"].tolist()
    selected = (
        summary.loc[accepted].sort_values("ASYM_LOSS_fold_median").index[0]
        if accepted
        else baseline_name
    )
    decision = {
        "selected_candidate": selected,
        "promote_new_architecture": selected != baseline_name,
        "selection_basis": "pre-2026 temporal folds only",
        "primary_loss": "2 * underprediction + 1 * overprediction",
        "quantile_for_primary_loss": QUANTILE_ASYMMETRIC,
    }
    return acceptance, decision


def train_final(pre2026: pd.DataFrame, residual_oof: pd.DataFrame) -> dict:
    train = hp.window_train(pre2026, pd.Timestamp("2026-01-01"), CONFIG["months"])
    models = {
        "enhanced_global_baseline": hp.fit_ensemble(train, enhanced=True, seeds=SEEDS),
        "history_central": fit_risk_ensemble(train, seeds=SEEDS),
        "enhanced_quantile_060": fit_enhanced_quantile_ensemble(train, seeds=SEEDS, alpha=0.60),
        "enhanced_quantile_067": fit_enhanced_quantile_ensemble(train, seeds=SEEDS, alpha=QUANTILE_ASYMMETRIC),
        "enhanced_quantile_075": fit_enhanced_quantile_ensemble(train, seeds=SEEDS, alpha=0.75),
        "residual_model": fit_residual_model(residual_oof),
        "n_train": int(len(train)),
        "training_start": str(train[DATE].min().date()),
        "training_end": str(train[DATE].max().date()),
    }
    return models


def reconstruct_residual_history(pre2026: pd.DataFrame, oof: pd.DataFrame) -> pd.DataFrame:
    central = oof[oof["candidate"].eq("enhanced_global_baseline")][["fold", "row_id", "pred"]].rename(columns={"pred": "central"})
    q67 = oof[oof["candidate"].eq("enhanced_quantile_067")][["fold", "row_id", "pred"]].rename(columns={"pred": "q67"})
    paired = central.merge(q67, on=["fold", "row_id"])
    rows = []
    for fold in FOLDS:
        part = paired[paired["fold"].eq(fold.name)]
        if part.empty:
            continue
        train = hp.window_train(pre2026, fold.start, CONFIG["months"])
        component = hp.fit_ensemble(train, enhanced=True, seeds=[42])[0]
        source = pre2026.loc[part["row_id"]]
        mask = source["DIVISION_key"].eq("crossborder").to_numpy()
        source = source.loc[mask]
        part = part.loc[mask]
        features = residual_features(source, part["central"].to_numpy(), part["q67"].to_numpy(), component)
        features["residual"] = source[TARGET].to_numpy() - part["central"].to_numpy()
        features["y"] = source[TARGET].to_numpy()
        features[DATE] = source[DATE].to_numpy()
        features["row_id"] = source.index
        rows.append(features)
    return pd.concat(rows, ignore_index=True)


def predict_final_candidates(final_models: dict, data: pd.DataFrame) -> dict[str, np.ndarray]:
    baseline = hp.predict_ensemble(final_models["enhanced_global_baseline"], data)
    history_central = predict_risk_ensemble(final_models["history_central"], data)
    q60 = predict_enhanced_quantile_ensemble(final_models["enhanced_quantile_060"], data)
    q67 = predict_enhanced_quantile_ensemble(final_models["enhanced_quantile_067"], data)
    q75 = predict_enhanced_quantile_ensemble(final_models["enhanced_quantile_075"], data)
    cross = data["DIVISION_key"].eq("crossborder").to_numpy()
    residual = baseline.copy()
    residual_frame = residual_features(data, baseline, q67, final_models["enhanced_global_baseline"][0])
    residual[cross] = np.maximum(
        residual[cross] + apply_residual(final_models["residual_model"], residual_frame.loc[cross]), 0.0
    )
    route_count = route_history_count(final_models["enhanced_global_baseline"][0], data)
    adaptive = residual.copy()
    high_risk = cross & (route_count < 4)
    adaptive[high_risk] = np.maximum(adaptive[high_risk], q67[high_risk])
    return {
        "enhanced_global_baseline": baseline,
        "history_central": history_central,
        "enhanced_quantile_060": q60,
        "enhanced_quantile_067": q67,
        "enhanced_quantile_075": q75,
        "cross_residual": residual,
        "adaptive_cross_risk": adaptive,
    }


def audit_candidates(final_models: dict, audit2026: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    overall_rows = []
    segment_rows = []
    for candidate, prediction in predict_final_candidates(final_models, audit2026).items():
        overall_rows.append({"candidate": candidate, "n": int(len(audit2026)), **hp.metrics(audit2026[TARGET], prediction)})
        work = audit2026[[TARGET, "DIVISION_key"]].copy()
        work["pred"] = prediction
        for division, group in work.groupby("DIVISION_key"):
            segment_rows.append({"candidate": candidate, "division": division, "n": int(len(group)), **hp.metrics(group[TARGET], group["pred"])})
    return pd.DataFrame(overall_rows), pd.DataFrame(segment_rows)


def build_bundle(final_models: dict, oof: pd.DataFrame, decision: dict, metadata: dict) -> dict:
    selected_oof = oof[oof["candidate"].eq(decision["selected_candidate"])]
    q95 = {"__GLOBAL__": float(np.quantile(np.abs(selected_oof["y"] - selected_oof["pred"]), 0.95))}
    for division, group in selected_oof.groupby("division"):
        if len(group) >= 100:
            q95[division] = float(np.quantile(np.abs(group["y"] - group["pred"]), 0.95))
    return {
        "artifact_type": "quantile_residual_risk_challenger",
        "target": TARGET,
        "required_features": CATEGORICAL + NUMERIC,
        "models": final_models,
        "selected_candidate": decision["selected_candidate"],
        "uncertainty_q95_mxn": q95,
        "decision": decision,
        "metadata": metadata,
        "quantile_067": QUANTILE_ASYMMETRIC,
        "fallback": "central history model; residual only for crossborder; no silent division inference",
    }


def predict_bundle(bundle: dict, new_quotes: pd.DataFrame) -> pd.DataFrame:
    data = hp.prepare_inference(new_quotes)
    predictions = predict_final_candidates(bundle["models"], data)
    selected = predictions[bundle["selected_candidate"]]
    central = predictions["enhanced_global_baseline"]
    protected = np.maximum(predictions["enhanced_quantile_067"], central)
    q95_map = bundle["uncertainty_q95_mxn"]
    q95 = data["DIVISION_key"].map(q95_map).fillna(q95_map["__GLOBAL__"]).to_numpy(float)
    route_count = route_history_count(bundle["models"]["enhanced_global_baseline"][0], data)
    return pd.DataFrame(
        {
            "cost_mxn_prediction": selected,
            "central_prediction_mxn": central,
            "protected_q67_mxn": protected,
            "cross_residual_prediction_mxn": predictions["cross_residual"],
            "division_used": data["DIVISION_key"].to_numpy(),
            "route_history_count": route_count,
            "route_risk": np.where(route_count == 0, "new", np.where(route_count < 4, "low_history", "supported")),
            "selected_candidate": bundle["selected_candidate"],
            "interval_low_mxn": np.maximum(selected - q95, 0.0),
            "interval_high_mxn": selected + q95,
        },
        index=new_quotes.index,
    )


def save_bundle(bundle: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, path)
