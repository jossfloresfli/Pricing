"""Shadow orchestrator for champion, protected quantile, Geo and Hybrid bundles.

This module performs inference only.  It does not train, persist, publish or
promote a model and it never uses ``realized_cost_mxn`` as an inference feature.
"""

from __future__ import annotations

from dataclasses import dataclass
import importlib
import json
from pathlib import Path
import sys
from typing import Callable

import numpy as np
import pandas as pd
from protected_cost.onnx_bundle import load_bundle

try:  # package import
    from .calibration import HierarchicalProtectedCostCalibrator, history_level
    from .policy import GuardrailPolicy, equipment_guardrail
except ImportError:  # direct module import used by the local unittest suite
    from calibration import HierarchicalProtectedCostCalibrator, history_level
    from policy import GuardrailPolicy, equipment_guardrail


Predictor = Callable[[pd.DataFrame], object]


@dataclass(frozen=True)
class BundlePaths:
    champion: Path
    quantile_risk: Path
    national_geo: Path
    national_hybrid: Path

    @classmethod
    def default(cls, repo_root: Path | None = None) -> "BundlePaths":
        root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[3]
        base = root / "artifacts" / "states"
        return cls(
            champion=base / "champion.json",
            quantile_risk=base / "quantile_risk.json",
            national_geo=base / "national_geo.json",
            national_hybrid=base / "national_hybrid.json",
        )

    def validate(self) -> None:
        missing = [str(path) for path in (self.champion, self.quantile_risk, self.national_geo, self.national_hybrid) if not path.is_file()]
        if missing:
            raise FileNotFoundError("missing shadow bundle(s): " + ", ".join(missing))


def _as_array(result: object, length: int, preferred_column: str | None = None) -> np.ndarray:
    if isinstance(result, pd.DataFrame):
        if preferred_column is None or preferred_column not in result:
            raise ValueError(f"predictor output lacks {preferred_column!r}")
        values = result[preferred_column].to_numpy()
    elif isinstance(result, pd.Series):
        values = result.to_numpy()
    else:
        values = np.asarray(result)
    values = np.asarray(values, dtype=float).reshape(-1)
    if len(values) != length:
        raise ValueError(f"predictor returned {len(values)} rows for {length} quotes")
    return values


def _numeric_column(frame: pd.DataFrame, column: str, length: int) -> np.ndarray:
    if column not in frame:
        return np.full(length, np.nan)
    return pd.to_numeric(frame[column], errors="coerce").to_numpy(float)


class ProtectedCostOrchestrator:
    """Composable, fail-safe inference service for a shadow challenger."""

    OUTPUT_COLUMNS = (
        "quote_id",
        "row_id",
        "currency",
        "equipment",
        "champion_prediction_mxn",
        "central_prediction_mxn",
        "protected_cost_mxn",
        "raw_q67_mxn",
        "geo_prediction_mxn",
        "route_history_count",
        "history_level",
        "cost_band",
        "prediction_decile",
        "equipment_guardrail",
        "auto_quote",
        "review_required",
        "decision_status",
        "guardrail_reasons",
        "interval_low_mxn",
        "interval_high_mxn",
        "model_path",
    )

    def __init__(
        self,
        *,
        champion_predictor: Predictor,
        risk_predictor: Predictor,
        geo_predictor: Predictor | None = None,
        hybrid_predictor: Predictor | None = None,
        calibrator: HierarchicalProtectedCostCalibrator | None = None,
        policy: GuardrailPolicy | None = None,
        source_metadata: dict | None = None,
    ) -> None:
        self.champion_predictor = champion_predictor
        self.risk_predictor = risk_predictor
        self.geo_predictor = geo_predictor
        self.hybrid_predictor = hybrid_predictor
        self.calibrator = calibrator or HierarchicalProtectedCostCalibrator()
        self.policy = policy or GuardrailPolicy()
        self.source_metadata = dict(source_metadata or {})

    @classmethod
    def from_paths(
        cls,
        paths: BundlePaths | None = None,
        *,
        repo_root: Path | None = None,
        calibrator: HierarchicalProtectedCostCalibrator | None = None,
        policy: GuardrailPolicy | None = None,
    ) -> "ProtectedCostOrchestrator":
        root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[3]
        bundle_paths = paths or BundlePaths.default(root)
        bundle_paths.validate()

        module_directories = (
            root / "experiments" / "modelos_v2_2026" / "segmentation_hybrid",
            root / "experiments" / "modelos_v2_2026" / "quantile_residual_risk",
            root / "experiments" / "modelos_v2_2026" / "national_geo_history",
            root / "experiments" / "modelos_v2_2026" / "national_port_only",
        )
        for directory in reversed(module_directories):
            if str(directory) not in sys.path:
                sys.path.insert(0, str(directory))
        hybrid_pipeline = importlib.import_module("hybrid_pipeline")
        risk_pipeline = importlib.import_module("risk_pipeline")
        geo_pipeline = importlib.import_module("geo_history_pipeline")
        national_hybrid = importlib.import_module("national_hybrid")

        champion_bundle = load_bundle("champion")
        risk_bundle = load_bundle("quantile_risk")
        geo_bundle = load_bundle("national_geo")
        hybrid_bundle = load_bundle("national_hybrid")
        if risk_bundle.get("artifact_type") != "quantile_residual_risk_challenger":
            raise ValueError("unexpected quantile-risk artifact type")
        if geo_bundle.get("artifact_type") != "national_geo_history_experiment":
            raise ValueError("unexpected National Geo artifact type")
        if hybrid_bundle.get("artifact_type") != "national_route_equipment_hybrid_challenger":
            raise ValueError("unexpected National Hybrid artifact type")

        def champion_predictor(quotes: pd.DataFrame) -> np.ndarray:
            prepared = hybrid_pipeline.prepare_inference(quotes)
            return hybrid_pipeline.predict_legacy_bundle(champion_bundle, prepared)

        def risk_predictor(quotes: pd.DataFrame) -> pd.DataFrame:
            # The reference bundle's residual component calls LightGBM with an
            # empty frame when a batch contains no Crossborder rows.  Preserve
            # its public semantics while avoiding that batch-composition bug.
            data = hybrid_pipeline.prepare_inference(quotes)
            cross = data["DIVISION_key"].eq("crossborder").to_numpy()
            if cross.any():
                return risk_pipeline.predict_bundle(risk_bundle, quotes)
            models = risk_bundle["models"]
            central = hybrid_pipeline.predict_ensemble(models["enhanced_global_baseline"], data)
            q67 = risk_pipeline.predict_enhanced_quantile_ensemble(models["enhanced_quantile_067"], data)
            candidates = {
                "enhanced_global_baseline": central,
                "history_central": lambda: risk_pipeline.predict_risk_ensemble(models["history_central"], data),
                "enhanced_quantile_060": lambda: risk_pipeline.predict_enhanced_quantile_ensemble(models["enhanced_quantile_060"], data),
                "enhanced_quantile_067": q67,
                "enhanced_quantile_075": lambda: risk_pipeline.predict_enhanced_quantile_ensemble(models["enhanced_quantile_075"], data),
                "cross_residual": central,
                "adaptive_cross_risk": central,
            }
            selected_value = candidates[risk_bundle["selected_candidate"]]
            selected = selected_value() if callable(selected_value) else selected_value
            protected_q67 = np.maximum(q67, central)
            q95_map = risk_bundle["uncertainty_q95_mxn"]
            q95 = data["DIVISION_key"].map(q95_map).fillna(q95_map["__GLOBAL__"]).to_numpy(float)
            route_count = risk_pipeline.route_history_count(models["enhanced_global_baseline"][0], data)
            return pd.DataFrame(
                {
                    "cost_mxn_prediction": selected,
                    "central_prediction_mxn": central,
                    "protected_q67_mxn": protected_q67,
                    "cross_residual_prediction_mxn": central,
                    "division_used": data["DIVISION_key"].to_numpy(),
                    "route_history_count": route_count,
                    "route_risk": np.where(route_count == 0, "new", np.where(route_count < 4, "low_history", "supported")),
                    "selected_candidate": risk_bundle["selected_candidate"],
                    "interval_low_mxn": np.maximum(selected - q95, 0.0),
                    "interval_high_mxn": selected + q95,
                },
                index=quotes.index,
            )

        def geo_predictor(quotes: pd.DataFrame) -> np.ndarray:
            prepared = hybrid_pipeline.prepare_inference(quotes)
            for column in geo_pipeline.RAW_CATEGORICAL:
                prepared[column] = prepared[column].map(geo_pipeline.normalize)
            for column in geo_pipeline.COORDINATES:
                if column not in prepared:
                    prepared[column] = np.nan
            result = np.full(len(prepared), np.nan)
            national = prepared["DIVISION_key"].map(geo_pipeline.normalize).eq("national")
            excluded = prepared["Tipo de Equipo_key"].map(geo_pipeline.normalize).isin(geo_bundle.get("excluded_equipment", []))
            eligible = national & ~excluded
            if eligible.any():
                result[eligible.to_numpy()] = geo_pipeline.predict_ensemble(geo_bundle["models"], prepared.loc[eligible])
            return result

        def hybrid_predictor(quotes: pd.DataFrame) -> pd.DataFrame:
            return national_hybrid.predict(hybrid_bundle, quotes)

        return cls(
            champion_predictor=champion_predictor,
            risk_predictor=risk_predictor,
            geo_predictor=geo_predictor,
            hybrid_predictor=hybrid_predictor,
            calibrator=calibrator,
            policy=policy,
            source_metadata={
                "mode": "shadow_challenger",
                "champion_bundle": str(bundle_paths.champion),
                "risk_bundle": str(bundle_paths.quantile_risk),
                "geo_bundle": str(bundle_paths.national_geo),
                "hybrid_bundle": str(bundle_paths.national_hybrid),
            },
        )

    @staticmethod
    def _safe_call(name: str, predictor: Predictor | None, quotes: pd.DataFrame) -> tuple[object | None, str | None]:
        if predictor is None:
            return None, f"{name}:not_configured"
        try:
            return predictor(quotes.copy()), None
        except Exception as exc:  # a component failure must abstain, never leak a price decision
            return None, f"{name}:{type(exc).__name__}:{str(exc)[:160]}"

    def predict(self, quotes: pd.DataFrame) -> pd.DataFrame:
        if not isinstance(quotes, pd.DataFrame):
            raise TypeError("quotes must be a pandas DataFrame")
        if quotes.empty:
            return pd.DataFrame(columns=self.OUTPUT_COLUMNS, index=quotes.index)

        model_input = quotes.drop(columns=["realized_cost_mxn"], errors="ignore").copy()
        length = len(model_input)
        errors: list[str] = []

        champion_result, error = self._safe_call("champion", self.champion_predictor, model_input)
        if error:
            errors.append(error)
        try:
            champion = _as_array(champion_result, length) if champion_result is not None else np.full(length, np.nan)
        except Exception as exc:
            champion = np.full(length, np.nan)
            errors.append(f"champion_contract:{type(exc).__name__}:{exc}")

        risk_result, error = self._safe_call("quantile_risk", self.risk_predictor, model_input)
        if error:
            errors.append(error)
        risk = risk_result if isinstance(risk_result, pd.DataFrame) and len(risk_result) == length else pd.DataFrame(index=model_input.index)
        if risk_result is not None and risk.empty and length:
            errors.append("quantile_risk_contract:invalid_dataframe")
        risk_central = _numeric_column(risk, "central_prediction_mxn", length)
        raw_q67 = _numeric_column(risk, "protected_q67_mxn", length)
        route_count = _numeric_column(risk, "route_history_count", length)
        route_count = np.where(np.isfinite(route_count), np.maximum(route_count, 0.0), 0.0)

        geo_result, error = self._safe_call("national_geo", self.geo_predictor, model_input)
        if error:
            errors.append(error)
        try:
            geo = _as_array(geo_result, length, "cost_mxn_prediction") if geo_result is not None else np.full(length, np.nan)
        except Exception as exc:
            geo = np.full(length, np.nan)
            errors.append(f"national_geo_contract:{type(exc).__name__}:{exc}")

        hybrid_result, error = self._safe_call("national_hybrid", self.hybrid_predictor, model_input)
        if error:
            errors.append(error)
        hybrid = hybrid_result if isinstance(hybrid_result, pd.DataFrame) and len(hybrid_result) == length else pd.DataFrame(index=model_input.index)
        if hybrid_result is not None and hybrid.empty and length:
            errors.append("national_hybrid_contract:invalid_dataframe")

        central = np.where(np.isfinite(champion) & (champion > 0), champion, risk_central)
        division = model_input.get("DIVISION_key", pd.Series("__missing__", index=model_input.index)).fillna("__missing__").astype(str).str.strip().str.lower()
        national = division.eq("national").to_numpy()
        new_route = route_count == 0
        low_route = (route_count > 0) & (route_count < 4)
        # Política: sin mezcla 50/50 ni 75/25. Cuando la ruta National es nueva o
        # de bajo historial y el modelo Geo (duración + elevación) está disponible,
        # se usa únicamente la predicción Geo como estimación central.
        geo_weight = np.where(national & (new_route | low_route), 1.0, 0.0)
        usable_geo = np.isfinite(geo) & (geo > 0)
        central = np.where(usable_geo & (geo_weight > 0), geo, central)

        raw_q67 = np.where(np.isfinite(raw_q67) & (raw_q67 > 0), raw_q67, central)
        base_protected = np.maximum(central, raw_q67)
        equipment = model_input.get("Tipo de Equipo_key", pd.Series("__missing__", index=model_input.index))
        adjustment = self.calibrator.predict_adjustment(central, equipment, route_count)
        protected = np.maximum(base_protected + adjustment, central)
        labels = self.calibrator.segment_labels(central, equipment, route_count)

        risk_low = _numeric_column(risk, "interval_low_mxn", length)
        risk_high = _numeric_column(risk, "interval_high_mxn", length)
        hybrid_low = _numeric_column(hybrid, "interval_low_mxn", length)
        hybrid_high = _numeric_column(hybrid, "interval_high_mxn", length)
        lows = np.vstack([risk_low, hybrid_low])
        highs = np.vstack([risk_high, hybrid_high])
        missing_low = np.all(~np.isfinite(lows), axis=0)
        missing_high = np.all(~np.isfinite(highs), axis=0)
        interval_low = np.where(np.isfinite(lows), lows, np.inf).min(axis=0)
        interval_high = np.where(np.isfinite(highs), highs, -np.inf).max(axis=0)
        interval_low[missing_low] = np.nan
        interval_high[missing_high] = np.nan
        interval_low = np.where(np.isfinite(interval_low), np.maximum(interval_low, 0.0), np.nan)
        interval_high = np.where(np.isfinite(interval_high), np.maximum(interval_high, protected), np.nan)

        hybrid_prediction = _numeric_column(hybrid, "cost_mxn_prediction", length)
        hybrid_confidence = _numeric_column(hybrid, "confidence_pct", length)
        hybrid_manual = hybrid.get("requires_manual_quote", pd.Series(False, index=model_input.index)).fillna(True).astype(bool).to_numpy()
        error_payload = json.dumps(errors, ensure_ascii=False, separators=(",", ":")) if errors else ""
        path_rows = [
            json.dumps(
                {
                    "champion": "lightgbm",
                    "geo_weight": float(geo_weight[position]) if usable_geo[position] else 0.0,
                    "protection": "q67_floor",
                    "calibration": "hierarchical" if self.calibrator.fitted_ else "unfitted_zero_adjustment",
                    "mode": "shadow",
                },
                separators=(",", ":"),
            )
            for position in range(length)
        ]
        preliminary = pd.DataFrame(
            {
                "champion_prediction_mxn": champion,
                "central_prediction_mxn": central,
                "protected_cost_mxn": protected,
                "raw_q67_mxn": raw_q67,
                "geo_prediction_mxn": geo,
                "hybrid_prediction_mxn": hybrid_prediction,
                "hybrid_confidence_pct": hybrid_confidence,
                "hybrid_requires_manual_quote": hybrid_manual,
                "route_history_count": route_count,
                "history_level": labels["history_level"].to_numpy(),
                "cost_band": labels["cost_band"].to_numpy(),
                "prediction_decile": labels["prediction_decile"].to_numpy(),
                "equipment_guardrail": equipment_guardrail(model_input).to_numpy(),
                "interval_low_mxn": interval_low,
                "interval_high_mxn": interval_high,
                "component_errors": [error_payload] * length,
                "model_path": path_rows,
            },
            index=model_input.index,
        )
        decisions = self.policy.evaluate(model_input, preliminary, calibrator_fitted=self.calibrator.fitted_)

        output = pd.DataFrame(index=model_input.index)
        output["quote_id"] = model_input["quote_id"] if "quote_id" in model_input else None
        if "quote_row_id" in model_input:
            output["row_id"] = model_input["quote_row_id"]
        else:
            output["row_id"] = [f"shadow-index:{value}" for value in model_input.index]
        output["currency"] = model_input["currency"] if "currency" in model_input else "unknown"
        output["equipment"] = equipment
        for column in (
            "champion_prediction_mxn",
            "central_prediction_mxn",
            "protected_cost_mxn",
            "raw_q67_mxn",
            "geo_prediction_mxn",
            "route_history_count",
            "history_level",
            "cost_band",
            "prediction_decile",
        ):
            output[column] = preliminary[column]
        for column in ("equipment_guardrail", "auto_quote", "review_required", "decision_status", "guardrail_reasons"):
            output[column] = decisions[column]
        output["interval_low_mxn"] = preliminary["interval_low_mxn"]
        output["interval_high_mxn"] = preliminary["interval_high_mxn"]
        output["model_path"] = preliminary["model_path"]
        return output.loc[:, self.OUTPUT_COLUMNS]

    def metadata(self) -> dict:
        return {
            **self.source_metadata,
            "status": "shadow_challenger_not_promoted",
            "realized_cost_policy": "optional input ignored by every inference component",
            "currency_policy": "currency must be explicitly confirmed as MXN for auto eligibility",
            "row_identity_policy": "quote_row_id must be present, non-missing and unique for auto eligibility; index fallback is shadow-only",
            "calibrator": self.calibrator.metadata(),
            "outputs": list(self.OUTPUT_COLUMNS),
        }
