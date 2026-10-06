"""Capa regional del copiloto basada en la segmentación congelada National Geo.

Reglas clave (no negociables):
- Reutiliza el artefacto congelado ``artifacts/states/national_geo.json``.
  Nunca reentrena, renombra ni recalcula centros.
- Verifica el checksum contra ``artifacts/manifest.json``; si falta el artefacto
  o el checksum no coincide, la capa regional queda ``unavailable`` sin romper
  el resto del copiloto.
- La asignación de región es determinista: centro más cercano (euclidiano
  lat/lng), idéntica al runtime de inferencia (KMeansRuntime).
- Los estados provienen únicamente de la etiqueta estructurada
  ``ciudad, estado`` del histórico o de la solicitud; nunca de OpenAI ni de
  texto libre.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
from typing import Any

import numpy as np

REGIONAL_MODEL_VERSION = "national-geo-2026-frozen"

# Contrato congelado: la segmentación validada tiene exactamente 14 regiones.
EXPECTED_REGION_COUNT = 14


def state_from_location(value: object) -> str | None:
    """Extrae el estado del formato estructurado ``ciudad, estado``.

    Devuelve ``None`` cuando la etiqueta no tiene el formato canónico; el
    registro se excluye con motivo auditado en la capa derivada.
    """

    if value is None:
        return None
    text = str(value).strip()
    if "," not in text:
        return None
    state = text.rsplit(",", 1)[1].strip()
    return state or None


@dataclass(frozen=True)
class RegionalAssignment:
    origin_state: str
    destination_state: str
    origin_region: int
    destination_region: int

    @property
    def regional_corridor(self) -> str:
        return f"{self.origin_region}->{self.destination_region}"

    @property
    def state_corridor(self) -> str:
        return f"{self.origin_state} -> {self.destination_state}"


class RegionalSegmentation:
    """Asignador congelado de regiones (14 grupos) para la división National."""

    def __init__(
        self,
        *,
        centers: np.ndarray,
        checksum: str,
        region_labels: dict[str, str] | None = None,
    ) -> None:
        self.centers = np.asarray(centers, dtype=float)
        self.checksum = checksum
        self.region_labels = dict(region_labels or {})

    @property
    def region_count(self) -> int:
        return int(len(self.centers))

    @classmethod
    def load(
        cls,
        artifacts_dir: Path,
        *,
        region_labels: dict[str, str] | None = None,
    ) -> "RegionalSegmentation | None":
        """Carga y verifica el artefacto congelado. ``None`` => unavailable."""

        state_path = artifacts_dir / "states" / "national_geo.json"
        manifest_path = artifacts_dir / "manifest.json"
        if not state_path.exists() or not manifest_path.exists():
            return None
        try:
            raw = state_path.read_bytes()
            checksum = sha256(raw).hexdigest()
            manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
            expected = (
                manifest.get("bundles", {})
                .get("national_geo", {})
                .get("state_sha256")
            )
            if not expected or expected != checksum:
                return None
            payload = json.loads(raw.decode("utf-8"))
            geo = payload["models"][0]["state"]["geo"]
            centers = np.asarray(geo["model"]["cluster_centers"], dtype=float)
            if (
                centers.ndim != 2
                or centers.shape[1] != 2
                or len(centers) != EXPECTED_REGION_COUNT
            ):
                return None
        except (OSError, ValueError, KeyError, IndexError, TypeError):
            return None
        return cls(centers=centers, checksum=checksum, region_labels=region_labels)

    def assign_point(self, lat: float, lng: float) -> int:
        point = np.asarray([[float(lat), float(lng)]], dtype=float)
        distances = ((point[:, None, :] - self.centers[None, :, :]) ** 2).sum(axis=2)
        return int(distances.argmin(axis=1)[0])

    def assign_points(self, lats: Any, lngs: Any) -> np.ndarray:
        values = np.column_stack(
            [np.asarray(lats, dtype=float), np.asarray(lngs, dtype=float)]
        )
        distances = ((values[:, None, :] - self.centers[None, :, :]) ** 2).sum(axis=2)
        return distances.argmin(axis=1)

    def label(self, region: int | str) -> str:
        """Etiqueta comercial provisional (derivada de estados dominantes).

        Si no hay etiqueta derivada disponible se devuelve una descripción
        neutra sin exponer números de grupo como clasificación oficial.
        """

        key = str(int(region))
        return self.region_labels.get(key) or f"zona regional {key}"


def corpus_fingerprint(
    historical_path: Path, route_cache_path: Path
) -> dict[str, str | None]:
    """Huella (sha256) de las fuentes de la capa derivada regional.

    Si las huellas actuales no coinciden con las registradas en el manifest de
    asignaciones, la capa está desfasada y debe regenerarse.
    """

    def _sha(path: Path) -> str | None:
        try:
            return sha256(path.read_bytes()).hexdigest() if path.exists() else None
        except OSError:
            return None

    return {
        "historical_loads_sha256": _sha(historical_path),
        "route_cache_sha256": _sha(route_cache_path),
    }


def assignments_status(
    manifest_path: Path, fingerprint: dict[str, str | None]
) -> str:
    """Estado de la capa derivada: ``missing`` | ``fresh`` | ``stale``.

    ``stale`` incluye manifests antiguos sin huella registrada (no se puede
    demostrar que están al día) y huellas que ya no coinciden.
    """

    if not manifest_path.exists():
        return "missing"
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return "missing"
    recorded = payload.get("source_fingerprint")
    if not isinstance(recorded, dict):
        return "stale"
    for key, value in fingerprint.items():
        if recorded.get(key) != value:
            return "stale"
    return "fresh"


def regenerate_assignments(root: Path, *, timeout_seconds: int = 300) -> bool:
    """Regenera la capa derivada ejecutando el script offline oficial.

    Devuelve ``True`` sólo si el script terminó exitosamente. Nunca lanza:
    ante cualquier falla se conserva la capa existente (posiblemente
    desfasada) y el estado se reporta en /health.
    """

    import subprocess
    import sys

    script = root / "scripts" / "build_regional_assignments.py"
    if not script.exists():
        return False
    try:
        completed = subprocess.run(
            [sys.executable, str(script)],
            cwd=str(root),
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
        return completed.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


RELATED_CORRIDORS_SCHEMA = "copilot-related-corridors-v1"


def load_related_corridors(path: Path) -> dict[str, list[str]] | None:
    """Carga el catálogo aprobado de corredores relacionados (dirigidos).

    El nivel "related_corridor" sólo se habilita cuando existe un catálogo
    explícitamente aprobado por Pricing/Operaciones/Procurement. Formato
    (``rag/structured/related_corridors.json``)::

        {
          "schema_version": "copilot-related-corridors-v1",
          "status": "approved",
          "approved_by": ["Pricing", "Operaciones", "Procurement"],
          "approved_at": "2026-08-04",
          "corridors": {
            "estado origen -> estado destino": [
              "estado origen relacionado -> estado destino relacionado"
            ]
          }
        }

    Los corredores son DIRIGIDOS (la inversa no cuenta) y se normalizan en
    minúsculas. Devuelve ``None`` (nivel deshabilitado) si el archivo falta,
    está mal formado, no está marcado ``approved`` o queda vacío. Nunca se
    inventan relaciones fuera del catálogo.
    """

    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("schema_version") != RELATED_CORRIDORS_SCHEMA:
        return None
    if str(payload.get("status", "")).strip().lower() != "approved":
        return None
    corridors = payload.get("corridors")
    if not isinstance(corridors, dict):
        return None

    def _normalize_corridor(value: object) -> str | None:
        parts = str(value or "").split("->")
        if len(parts) != 2:
            return None
        origin = parts[0].strip().lower()
        destination = parts[1].strip().lower()
        if not origin or not destination:
            return None
        return f"{origin} -> {destination}"

    catalog: dict[str, list[str]] = {}
    for key, values in corridors.items():
        corridor = _normalize_corridor(key)
        if corridor is None or not isinstance(values, list):
            continue
        related = []
        for value in values:
            normalized = _normalize_corridor(value)
            if normalized is not None and normalized != corridor:
                related.append(normalized)
        if related:
            catalog[corridor] = related
    return catalog or None


def load_region_labels(path: Path) -> dict[str, str]:
    """Lee las etiquetas derivadas (estados dominantes) de la capa offline."""

    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}
    labels = payload.get("region_labels", {})
    return {str(key): str(value) for key, value in labels.items() if value}
