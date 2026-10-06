"""Hierarchical calibration for the protected-cost shadow challenger.

The calibrator is deliberately separate from the model bundles.  It must be fit
only with out-of-fold, point-in-time predictions.  An unfitted instance is a
valid, conservative runtime state: it contributes zero MXN and marks every
segment as unavailable so the policy layer can abstain.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable, Mapping, Sequence

import numpy as np
import pandas as pd


UNAVAILABLE = "unavailable"


def _normalise_equipment(values: Iterable[object]) -> pd.Series:
    series = pd.Series(values, copy=False)
    return series.fillna("__missing__").astype(str).str.strip().str.lower().replace("", "__missing__")


def history_level(route_history_count: Iterable[object]) -> pd.Series:
    count = pd.to_numeric(pd.Series(route_history_count, copy=False), errors="coerce").fillna(0.0).clip(lower=0)
    return pd.Series(
        np.select([count.eq(0), count.lt(4)], ["new", "low_history"], default="supported"),
        index=count.index,
        dtype="object",
    )


@dataclass(frozen=True)
class CalibrationConfig:
    quantile: float = 2.0 / 3.0
    cost_band_quantiles: tuple[float, ...] = (0.20, 0.40, 0.60, 0.80)
    prediction_deciles: int = 10
    shrinkage_strength: float = 30.0
    minimum_rows: int = 100
    minimum_cell_rows: int = 5
    maximum_adjustment_ratio: float = 0.50

    def __post_init__(self) -> None:
        if not 0.0 < self.quantile < 1.0:
            raise ValueError("quantile must be between zero and one")
        if self.prediction_deciles < 2:
            raise ValueError("prediction_deciles must be at least two")
        if self.shrinkage_strength < 0 or self.minimum_rows < 1 or self.minimum_cell_rows < 1:
            raise ValueError("calibration counts and shrinkage must be positive")
        if self.maximum_adjustment_ratio < 0:
            raise ValueError("maximum_adjustment_ratio must be non-negative")


class HierarchicalProtectedCostCalibrator:
    """Residual-quantile calibration with hierarchical empirical-Bayes shrinkage.

    Operational cost bands are learned from the point-in-time central prediction
    and assigned from that same variable at inference.  Realised-cost bands are
    evaluation strata only; using them to fit operational cells would introduce
    train-serving skew and target leakage.
    """

    LEVELS: tuple[tuple[str, ...], ...] = (
        ("equipment", "cost_band", "prediction_decile", "history_level"),
        ("equipment", "cost_band", "prediction_decile"),
        ("equipment", "cost_band"),
        ("cost_band", "prediction_decile"),
        ("cost_band",),
        ("equipment",),
        (),
    )

    def __init__(self, config: CalibrationConfig | None = None) -> None:
        self.config = config or CalibrationConfig()
        self.fitted_ = False
        self.cost_band_edges_: list[float] = []
        self.prediction_edges_: list[float] = []
        self.tables_: dict[tuple[str, ...], dict[tuple[str, ...], dict[str, float]]] = {}
        self.fit_rows_ = 0

    @staticmethod
    def _strict_edges(values: np.ndarray, quantiles: Sequence[float]) -> list[float]:
        finite = np.asarray(values, dtype=float)
        finite = finite[np.isfinite(finite)]
        if finite.size == 0:
            return []
        edges = np.quantile(finite, quantiles)
        return sorted({float(edge) for edge in np.atleast_1d(edges) if np.isfinite(edge)})

    @staticmethod
    def _labels(values: np.ndarray, edges: Sequence[float], prefix: str) -> pd.Series:
        values = np.asarray(values, dtype=float)
        if not edges:
            return pd.Series([f"{prefix}_all"] * len(values), dtype="object")
        positions = np.searchsorted(np.asarray(edges), values, side="right")
        positions[~np.isfinite(values)] = -1
        return pd.Series(
            [UNAVAILABLE if position < 0 else f"{prefix}_{position + 1:02d}" for position in positions],
            dtype="object",
        )

    def _segment_frame(
        self,
        central_prediction: Iterable[object],
        equipment: Iterable[object],
        route_history_count: Iterable[object],
    ) -> pd.DataFrame:
        central = pd.to_numeric(pd.Series(central_prediction, copy=False).reset_index(drop=True), errors="coerce")
        frame = pd.DataFrame(
            {
                "equipment": _normalise_equipment(equipment).reset_index(drop=True),
                "history_level": history_level(route_history_count).reset_index(drop=True),
                "prediction_decile": self._labels(central.to_numpy(float), self.prediction_edges_, "d"),
            }
        )
        frame["cost_band"] = self._labels(central.to_numpy(float), self.cost_band_edges_, "b")
        return frame

    def fit(
        self,
        realised_cost_mxn: Iterable[object],
        central_prediction_mxn: Iterable[object],
        equipment: Iterable[object],
        route_history_count: Iterable[object],
        protected_prediction_mxn: Iterable[object] | None = None,
    ) -> "HierarchicalProtectedCostCalibrator":
        actual = pd.to_numeric(pd.Series(realised_cost_mxn, copy=False).reset_index(drop=True), errors="coerce")
        central = pd.to_numeric(pd.Series(central_prediction_mxn, copy=False).reset_index(drop=True), errors="coerce")
        protected = central if protected_prediction_mxn is None else pd.to_numeric(
            pd.Series(protected_prediction_mxn, copy=False).reset_index(drop=True), errors="coerce"
        )
        if not (len(actual) == len(central) == len(protected) == len(pd.Series(equipment)) == len(pd.Series(route_history_count))):
            raise ValueError("all calibration inputs must have the same length")
        valid = actual.notna() & central.notna() & protected.notna() & actual.ge(0) & central.ge(0) & protected.ge(0)
        if int(valid.sum()) < self.config.minimum_rows:
            self.fitted_ = False
            self.fit_rows_ = int(valid.sum())
            self.tables_ = {}
            self.cost_band_edges_ = []
            self.prediction_edges_ = []
            return self

        actual = actual.loc[valid].reset_index(drop=True)
        central = central.loc[valid].reset_index(drop=True)
        protected = protected.loc[valid].reset_index(drop=True)
        equipment_series = pd.Series(equipment, copy=False).reset_index(drop=True).loc[valid].reset_index(drop=True)
        history_series = pd.Series(route_history_count, copy=False).reset_index(drop=True).loc[valid].reset_index(drop=True)

        self.cost_band_edges_ = self._strict_edges(central.to_numpy(float), self.config.cost_band_quantiles)
        prediction_quantiles = np.linspace(0, 1, self.config.prediction_deciles + 1)[1:-1]
        self.prediction_edges_ = self._strict_edges(central.to_numpy(float), prediction_quantiles)
        work = self._segment_frame(central, equipment_series, history_series)
        work["residual"] = (actual - protected).to_numpy(float)

        parent_lookup: dict[tuple[str, ...], dict[tuple[str, ...], dict[str, float]]] = {}
        parent_default = 0.0
        for level in reversed(self.LEVELS):
            table: dict[tuple[str, ...], dict[str, float]] = {}
            if not level:
                raw = max(0.0, float(work["residual"].quantile(self.config.quantile)))
                table[()] = {"raw": raw, "adjustment": raw, "count": float(len(work)), "parent": 0.0}
                parent_default = raw
            else:
                grouped = work.groupby(list(level), dropna=False, sort=False)
                parent_level = self.LEVELS[self.LEVELS.index(level) + 1]
                parent_table = parent_lookup[parent_level]
                for key, group in grouped:
                    key_tuple = key if isinstance(key, tuple) else (key,)
                    raw = max(0.0, float(group["residual"].quantile(self.config.quantile)))
                    row = group.iloc[0]
                    parent_key = tuple(str(row[column]) for column in parent_level)
                    parent = parent_table.get(parent_key, {"adjustment": parent_default})["adjustment"]
                    count = float(len(group))
                    if count < self.config.minimum_cell_rows:
                        weight = 0.0
                    else:
                        weight = count / (count + self.config.shrinkage_strength)
                    adjustment = max(0.0, weight * raw + (1.0 - weight) * float(parent))
                    table[tuple(str(value) for value in key_tuple)] = {
                        "raw": raw,
                        "adjustment": adjustment,
                        "count": count,
                        "parent": float(parent),
                    }
            parent_lookup[level] = table

        self.tables_ = parent_lookup
        self.fit_rows_ = len(work)
        self.fitted_ = True
        return self

    def segment_labels(
        self,
        central_prediction_mxn: Iterable[object],
        equipment: Iterable[object],
        route_history_count: Iterable[object],
    ) -> pd.DataFrame:
        central = pd.Series(central_prediction_mxn, copy=False)
        if not self.fitted_:
            return pd.DataFrame(
                {
                    "cost_band": [UNAVAILABLE] * len(central),
                    "prediction_decile": [UNAVAILABLE] * len(central),
                    "history_level": history_level(route_history_count).to_numpy(),
                }
            )
        frame = self._segment_frame(central, equipment, route_history_count)
        return frame[["cost_band", "prediction_decile", "history_level"]]

    def predict_adjustment(
        self,
        central_prediction_mxn: Iterable[object],
        equipment: Iterable[object],
        route_history_count: Iterable[object],
    ) -> np.ndarray:
        central = pd.to_numeric(pd.Series(central_prediction_mxn, copy=False).reset_index(drop=True), errors="coerce")
        if not self.fitted_:
            return np.zeros(len(central), dtype=float)
        segments = self._segment_frame(central, equipment, route_history_count)
        adjustments = np.zeros(len(segments), dtype=float)
        for position, row in segments.iterrows():
            value = 0.0
            for level in self.LEVELS:
                key = tuple(str(row[column]) for column in level)
                result = self.tables_.get(level, {}).get(key)
                if result is not None:
                    value = float(result["adjustment"])
                    break
            cap = max(0.0, float(central.iloc[position])) * self.config.maximum_adjustment_ratio
            adjustments[position] = min(max(0.0, value), cap)
        return adjustments

    def metadata(self) -> dict:
        return {
            "fitted": self.fitted_,
            "fit_rows": self.fit_rows_,
            "config": asdict(self.config),
            "cost_band_edges_mxn": self.cost_band_edges_,
            "prediction_decile_edges_mxn": self.prediction_edges_,
            "operational_band_source_train": "point_in_time_central_prediction_mxn",
            "operational_band_source_inference": "central_prediction_mxn",
            "realised_cost_band_policy": "evaluation_only_never_an_inference_or_calibration_key",
            "leakage_requirement": "fit only on point-in-time out-of-fold predictions",
        }

    def to_state(self) -> dict:
        tables = {
            "|".join(level) or "__global__": {
                "\u241f".join(key): value for key, value in table.items()
            }
            for level, table in self.tables_.items()
        }
        return {
            "artifact_type": "hierarchical_protected_cost_calibrator",
            "version": 1,
            "fitted": self.fitted_,
            "fit_rows": self.fit_rows_,
            "config": asdict(self.config),
            "cost_band_edges_mxn": self.cost_band_edges_,
            "prediction_decile_edges_mxn": self.prediction_edges_,
            "tables": tables,
            "metadata": self.metadata(),
        }

    @classmethod
    def from_state(cls, state: Mapping[str, object]) -> "HierarchicalProtectedCostCalibrator":
        if state.get("artifact_type") != "hierarchical_protected_cost_calibrator":
            raise ValueError("unsupported calibrator artifact")
        config_data = dict(state.get("config", {}))
        if "cost_band_quantiles" in config_data:
            config_data["cost_band_quantiles"] = tuple(config_data["cost_band_quantiles"])
        result = cls(CalibrationConfig(**config_data))
        result.fitted_ = bool(state.get("fitted", False))
        result.fit_rows_ = int(state.get("fit_rows", 0))
        result.cost_band_edges_ = [float(value) for value in state.get("cost_band_edges_mxn", [])]
        result.prediction_edges_ = [float(value) for value in state.get("prediction_decile_edges_mxn", [])]
        decoded: dict[tuple[str, ...], dict[tuple[str, ...], dict[str, float]]] = {}
        for level_name, table in dict(state.get("tables", {})).items():
            level = () if level_name == "__global__" else tuple(level_name.split("|"))
            decoded[level] = {
                (() if key == "" else tuple(key.split("\u241f"))): {name: float(value) for name, value in values.items()}
                for key, values in dict(table).items()
            }
        result.tables_ = decoded
        return result
