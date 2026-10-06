"""Construye la capa derivada regional del corpus del copiloto (offline).

No modifica el histórico fuente. Para cada viaje elegible de
``rag/structured/historical_loads.jsonl`` calcula:

- estado de origen/destino (sólo desde la etiqueta estructurada ``ciudad, estado``)
- región de origen/destino (segmentación congelada National Geo, 14 grupos)
- corredor regional dirigido y corredor de estados dirigido
- coordenadas usadas, versión del modelo y checksum del artefacto
- estado de resolución y motivo auditado cuando no es resoluble

Salidas (versionadas, regenerables):
- ``rag/structured/regional_assignments.jsonl``
- ``rag/structured/regional_assignments_manifest.json`` (conteos, motivos de
  exclusión, etiquetas provisionales por región derivadas de estados
  dominantes — pendientes de aprobación comercial).

Uso: ``python scripts/build_regional_assignments.py``
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vax_pricing.copilot.history import normalize_key  # noqa: E402
from vax_pricing.copilot.regional import (  # noqa: E402
    REGIONAL_MODEL_VERSION,
    RegionalSegmentation,
    corpus_fingerprint,
    state_from_location,
)

STRUCTURED_DIR = ROOT / "rag" / "structured"
ARTIFACTS_DIR = ROOT / "artifacts"
ROUTE_CACHE = ROOT / "data" / "processed" / "google_maps_route_cache.csv"
OUTPUT_PATH = STRUCTURED_DIR / "regional_assignments.jsonl"
MANIFEST_PATH = STRUCTURED_DIR / "regional_assignments_manifest.json"
SCHEMA_VERSION = "copilot-regional-assignments-v1"


def _read_jsonl(path: Path) -> list[dict]:
    records = []
    with path.open("r", encoding="utf-8-sig") as stream:
        for line in stream:
            if line.strip():
                records.append(json.loads(line))
    return records


def _normalized_route_key(value: object) -> str:
    parts = str(value or "").split("->", maxsplit=1)
    if len(parts) != 2:
        return ""
    return " -> ".join(normalize_key(part) for part in parts)


def main() -> int:
    segmentation = RegionalSegmentation.load(ARTIFACTS_DIR)
    if segmentation is None:
        print(
            "ERROR: artefacto regional congelado no disponible o checksum "
            "inválido; no se genera la capa derivada."
        )
        return 1

    loads = pd.DataFrame.from_records(
        _read_jsonl(STRUCTURED_DIR / "historical_loads.jsonl")
    )
    total = len(loads)

    # Coordenadas: fuente geográfica interna (caché de rutas), unida por route_key.
    coords = pd.DataFrame(
        columns=["route_key", "origin_lat", "origin_lng", "destination_lat", "destination_lng"]
    )
    if ROUTE_CACHE.exists():
        cache = pd.read_csv(ROUTE_CACHE, encoding="utf-8-sig", low_memory=False)
        mapping = {
            "google_origin_lat": "origin_lat",
            "google_origin_lng": "origin_lng",
            "google_destination_lat": "destination_lat",
            "google_destination_lng": "destination_lng",
        }
        if "route_key" in cache and all(column in cache for column in mapping):
            coords = cache[["route_key", *mapping]].copy()
            coords["route_key"] = coords["route_key"].map(_normalized_route_key)
            coords = coords.drop_duplicates("route_key", keep="last").rename(columns=mapping)

    loads["route_key_norm"] = loads["route_key"].map(_normalized_route_key)
    merged = loads.merge(
        coords, how="left", left_on="route_key_norm", right_on="route_key",
        suffixes=("", "_cache"),
    )

    rows: list[dict] = []
    reasons: Counter[str] = Counter()
    region_state_counts: dict[int, Counter[str]] = {}

    for _, row in merged.iterrows():
        record: dict = {
            "evidence_id": row["evidence_id"],
            "schema_version": SCHEMA_VERSION,
            "model_version": REGIONAL_MODEL_VERSION,
            "artifact_checksum": segmentation.checksum,
        }
        if normalize_key(row.get("division")) != "national":
            record.update(resolution_status="excluded", resolution_reason="division_not_national")
            reasons["division_not_national"] += 1
            rows.append(record)
            continue
        origin_state = state_from_location(row.get("origin"))
        destination_state = state_from_location(row.get("destination"))
        if not origin_state or not destination_state:
            record.update(resolution_status="excluded", resolution_reason="state_not_in_structured_label")
            reasons["state_not_in_structured_label"] += 1
            rows.append(record)
            continue
        values = [
            row.get("origin_lat_cache", row.get("origin_lat")),
            row.get("origin_lng_cache", row.get("origin_lng")),
            row.get("destination_lat_cache", row.get("destination_lat")),
            row.get("destination_lng_cache", row.get("destination_lng")),
        ]
        numeric = pd.to_numeric(pd.Series(values), errors="coerce")
        if numeric.isna().any() or not np.isfinite(numeric.astype(float)).all():
            record.update(resolution_status="excluded", resolution_reason="missing_coordinates")
            reasons["missing_coordinates"] += 1
            rows.append(record)
            continue
        origin_region = segmentation.assign_point(numeric[0], numeric[1])
        destination_region = segmentation.assign_point(numeric[2], numeric[3])
        record.update(
            resolution_status="resolved",
            resolution_reason=None,
            origin_state=normalize_key(origin_state),
            destination_state=normalize_key(destination_state),
            origin_region=origin_region,
            destination_region=destination_region,
            regional_corridor=f"{origin_region}->{destination_region}",
            state_corridor=f"{normalize_key(origin_state)} -> {normalize_key(destination_state)}",
            origin_lat_used=float(numeric[0]),
            origin_lng_used=float(numeric[1]),
            destination_lat_used=float(numeric[2]),
            destination_lng_used=float(numeric[3]),
        )
        reasons["resolved"] += 1
        region_state_counts.setdefault(origin_region, Counter())[normalize_key(origin_state)] += 1
        region_state_counts.setdefault(destination_region, Counter())[normalize_key(destination_state)] += 1
        rows.append(record)

    with OUTPUT_PATH.open("w", encoding="utf-8") as stream:
        for record in rows:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")

    # Etiquetas provisionales por región: estados dominantes observados.
    # Deterministas y derivadas de datos; el nombre comercial definitivo
    # requiere aprobación de Pricing/Comercial (documentado como pendiente).
    region_labels: dict[str, str] = {}
    for region, counts in sorted(region_state_counts.items()):
        top = [state.title() for state, _ in counts.most_common(2)]
        region_labels[str(region)] = "Región " + " y ".join(top)

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "model_version": REGIONAL_MODEL_VERSION,
        "artifact_checksum": segmentation.checksum,
        "region_count": segmentation.region_count,
        "source_fingerprint": corpus_fingerprint(
            STRUCTURED_DIR / "historical_loads.jsonl", ROUTE_CACHE
        ),
        "source_rows": total,
        "resolved_rows": reasons.get("resolved", 0),
        "excluded_rows": {k: v for k, v in reasons.items() if k != "resolved"},
        "region_labels": region_labels,
        "region_labels_status": "provisional_pending_commercial_approval",
        "related_corridor_catalog": {
            "status": "disabled_no_approved_catalog",
            "note": (
                "No existe catálogo aprobado de corredores relacionados; el "
                "nivel permanece deshabilitado hasta aprobación de "
                "Pricing/Operaciones/Procurement."
            ),
        },
    }
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({k: manifest[k] for k in ("source_rows", "resolved_rows", "excluded_rows")}, ensure_ascii=False))
    print(f"OK -> {OUTPUT_PATH.name}, {MANIFEST_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
