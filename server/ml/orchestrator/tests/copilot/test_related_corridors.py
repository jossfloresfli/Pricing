"""Pruebas del catálogo aprobado de corredores relacionados (dirigidos)."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from vax_pricing.copilot.regional import (
    RELATED_CORRIDORS_SCHEMA,
    load_related_corridors,
)


def _write(path: Path, payload: dict) -> Path:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


class RelatedCorridorsCatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "related_corridors.json"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _payload(self, **overrides: object) -> dict:
        payload: dict = {
            "schema_version": RELATED_CORRIDORS_SCHEMA,
            "status": "approved",
            "approved_by": ["Pricing", "Operaciones", "Procurement"],
            "approved_at": "2026-08-04",
            "corridors": {
                "Baja California -> Jalisco": [
                    "Sonora -> Jalisco",
                    "baja california -> nayarit",
                ]
            },
        }
        payload.update(overrides)
        return payload

    def test_missing_file_disables_level(self) -> None:
        self.assertIsNone(load_related_corridors(self.path))

    def test_unapproved_catalog_is_rejected(self) -> None:
        _write(self.path, self._payload(status="draft"))
        self.assertIsNone(load_related_corridors(self.path))

    def test_wrong_schema_version_is_rejected(self) -> None:
        _write(self.path, self._payload(schema_version="otro"))
        self.assertIsNone(load_related_corridors(self.path))

    def test_approved_catalog_normalizes_directed_corridors(self) -> None:
        _write(self.path, self._payload())
        catalog = load_related_corridors(self.path)
        self.assertIsNotNone(catalog)
        assert catalog is not None
        self.assertEqual(
            catalog["baja california -> jalisco"],
            ["sonora -> jalisco", "baja california -> nayarit"],
        )
        # La inversa NO se agrega automáticamente (relaciones dirigidas).
        self.assertNotIn("jalisco -> baja california", catalog)

    def test_self_relations_and_empty_entries_are_dropped(self) -> None:
        _write(
            self.path,
            self._payload(
                corridors={
                    "Sonora -> Sinaloa": ["Sonora -> Sinaloa"],
                    "mal formato": ["Sonora -> Sinaloa"],
                }
            ),
        )
        self.assertIsNone(load_related_corridors(self.path))


if __name__ == "__main__":
    unittest.main()
