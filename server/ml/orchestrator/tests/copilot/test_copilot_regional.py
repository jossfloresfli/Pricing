"""Pruebas de la capa regional del copiloto (segmentación congelada)."""

from datetime import datetime, timezone
import json
from pathlib import Path
import unittest
from uuid import uuid4

import numpy as np

from vax_pricing.copilot.history import HistoricalQuery, HistoricalRepository
from vax_pricing.copilot.regional import (
    RegionalSegmentation,
    state_from_location,
)
from vax_pricing.copilot.token_limits import _evidence_ids, prepare_evidence


CENTERS = [[32.6, -115.4], [20.6, -103.3], [25.7, -100.3]]
CHECKSUM = "test-checksum"


def segmentation() -> RegionalSegmentation:
    return RegionalSegmentation(
        centers=np.asarray(CENTERS),
        checksum=CHECKSUM,
        region_labels={"0": "Región Baja California", "1": "Región Jalisco", "2": "Región Nuevo León"},
    )


def load_row(
    *,
    evidence_id: str,
    origin: str = "Tijuana, Baja California",
    destination: str = "Zapopan, Jalisco",
    division: str = "National",
    equipment: str = "DryVan 53",
    cost: float = 100.0,
    sale: float | None = 125.0,
    distance_km: float = 2000.0,
    available_at: str = "2026-06-02T00:00:00+00:00",
) -> dict[str, object]:
    return {
        "evidence_id": evidence_id,
        "load_id": evidence_id,
        "origin": origin,
        "destination": destination,
        "route_key": f"{origin.lower()} -> {destination.lower()}",
        "equipment": equipment,
        "equipment_key": equipment.lower(),
        "division": division,
        "division_key": division.lower(),
        "range": "Contracted",
        "range_key": "contracted",
        "route_type": "national",
        "flow": "Local",
        "provider": "Transportista A",
        "currency": "MXN",
        "all_in_rate_cost": cost,
        "all_in_rate_sale": sale,
        "distance_km": distance_km,
        "distance_band": "2000_plus_km",
        "quote_created_at": "2026-05-20T00:00:00+00:00",
        "cost_available_at": available_at,
        "eligible_for_point_in_time": True,
    }


def assignment_row(
    row: dict[str, object],
    *,
    origin_region: int = 0,
    destination_region: int = 1,
    checksum: str = CHECKSUM,
) -> dict[str, object]:
    origin_state = state_from_location(row["origin"]).lower()
    destination_state = state_from_location(row["destination"]).lower()
    return {
        "evidence_id": row["evidence_id"],
        "resolution_status": "resolved",
        "artifact_checksum": checksum,
        "origin_state": origin_state,
        "destination_state": destination_state,
        "origin_region": origin_region,
        "destination_region": destination_region,
        "regional_corridor": f"{origin_region}->{destination_region}",
        "state_corridor": f"{origin_state} -> {destination_state}",
    }


class RegionalSupportTests(unittest.TestCase):
    def setUp(self) -> None:
        Path("tmp").mkdir(exist_ok=True)
        token = uuid4().hex
        self.loads_path = Path("tmp") / f"regional_loads_{token}.jsonl"
        self.assignments_path = Path("tmp") / f"regional_assignments_{token}.jsonl"
        self.addCleanup(lambda: self.loads_path.unlink(missing_ok=True))
        self.addCleanup(lambda: self.assignments_path.unlink(missing_ok=True))

    def build(self, rows, assignments, **kwargs) -> HistoricalRepository:
        self.loads_path.write_text(
            "\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8"
        )
        self.assignments_path.write_text(
            "\n".join(json.dumps(row) for row in assignments) + "\n",
            encoding="utf-8",
        )
        return HistoricalRepository(
            self.loads_path,
            regional_assignments_path=self.assignments_path,
            regional_segmentation=kwargs.pop("segmentation", segmentation()),
            **kwargs,
        )

    @staticmethod
    def query(**overrides) -> HistoricalQuery:
        params = dict(
            origin="Mexicali, Baja California",
            destination="Guadalajara, Jalisco",
            equipment="DryVan 53",
            division="National",
            service_range=None,
            currency="MXN",
            quote_created_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
            distance_km=2050.0,
            origin_lat=32.62,
            origin_lng=-115.45,
            destination_lat=20.67,
            destination_lng=-103.35,
        )
        params.update(overrides)
        return HistoricalQuery(**params)

    def test_related_corridor_level_uses_approved_catalog_directed(self) -> None:
        related = load_row(
            evidence_id="VXS-REL-1",
            origin="Hermosillo, Sonora",
            destination="Zapopan, Jalisco",
        )
        reverse_related = load_row(
            evidence_id="VXS-REL-2",
            origin="Zapopan, Jalisco",
            destination="Hermosillo, Sonora",
        )
        repo = self.build(
            [related, reverse_related],
            [
                assignment_row(related, origin_region=2, destination_region=1),
                assignment_row(
                    reverse_related, origin_region=1, destination_region=2
                ),
            ],
            related_corridors={
                "baja california -> jalisco": ["sonora -> jalisco"],
            },
        )
        result = repo.search(self.query())
        support = result.support.regional_support
        self.assertTrue(support.related_corridors_enabled)
        self.assertEqual(support.comparison_level, "related_corridor")
        self.assertEqual(support.comparable_count, 1)
        self.assertEqual(
            support.routes[0].reference_ids, ["VXS-REL-1"]
        )

    def test_related_corridor_disabled_without_catalog(self) -> None:
        related = load_row(
            evidence_id="VXS-REL-3",
            origin="Hermosillo, Sonora",
            destination="Zapopan, Jalisco",
        )
        repo = self.build(
            [related],
            [assignment_row(related, origin_region=2, destination_region=1)],
        )
        result = repo.search(self.query())
        support = result.support.regional_support
        self.assertFalse(support.related_corridors_enabled)
        self.assertNotEqual(support.comparison_level, "related_corridor")

    def test_same_state_pair_level_directed(self) -> None:
        matching = load_row(evidence_id="VXS-1")
        reverse = load_row(
            evidence_id="VXS-2",
            origin="Zapopan, Jalisco",
            destination="Tijuana, Baja California",
        )
        repo = self.build(
            [matching, reverse],
            [
                assignment_row(matching),
                assignment_row(reverse, origin_region=1, destination_region=0),
            ],
        )
        support = repo.search(self.query()).support.regional_support
        self.assertEqual(support.status, "applicable")
        self.assertEqual(support.comparison_level, "same_state_pair")
        # Dirigido: el corredor inverso NO cuenta como el mismo par.
        self.assertEqual(support.comparable_count, 1)
        self.assertEqual(support.routes[0].origin_state, "baja california")
        # 1 viaje < mínimo aprobado (3) → insufficient_evidence
        self.assertEqual(support.regional_cost_level, "insufficient_evidence")
        self.assertFalse(support.related_corridors_enabled)

    def test_corridor_level_when_no_state_pair(self) -> None:
        other_state = load_row(
            evidence_id="VXS-3",
            origin="Ensenada, Baja California Sur",
            destination="Tlaquepaque, Jalisco",
        )
        repo = self.build([other_state], [assignment_row(other_state)])
        support = repo.search(self.query()).support.regional_support
        self.assertEqual(support.comparison_level, "same_regional_corridor")
        self.assertEqual(support.comparable_count, 1)

    def test_comparable_distance_fallback_and_tolerance(self) -> None:
        far = load_row(
            evidence_id="VXS-4",
            origin="Monterrey, Nuevo Leon",
            destination="Merida, Yucatan",
            distance_km=2100.0,
        )
        out_of_tolerance = load_row(
            evidence_id="VXS-5",
            origin="Monterrey, Nuevo Leon",
            destination="Saltillo, Coahuila",
            distance_km=90.0,
        )
        repo = self.build(
            [far, out_of_tolerance],
            [
                assignment_row(far, origin_region=2, destination_region=2),
                assignment_row(out_of_tolerance, origin_region=2, destination_region=2),
            ],
        )
        support = repo.search(self.query()).support.regional_support
        self.assertEqual(support.comparison_level, "comparable_distance_equipment")
        self.assertEqual(support.comparable_count, 1)

    def test_not_applicable_gates(self) -> None:
        row = load_row(evidence_id="VXS-6")
        repo = self.build([row], [assignment_row(row)])
        self.assertEqual(
            repo.search(self.query(division="Intermex")).support.regional_support.reason,
            "division_not_national",
        )
        self.assertEqual(
            repo.search(self.query(equipment="LTL")).support.regional_support.reason,
            "equipment_ltl",
        )
        self.assertEqual(
            repo.search(
                self.query(origin_lat=None)
            ).support.regional_support.reason,
            "missing_coordinates",
        )
        self.assertEqual(
            repo.search(
                self.query(origin="Mexicali")
            ).support.regional_support.reason,
            "state_not_in_structured_label",
        )

    def test_temporal_cutoff_excludes_future_costs(self) -> None:
        future = load_row(
            evidence_id="VXS-7", available_at="2026-09-01T00:00:00+00:00"
        )
        repo = self.build([future], [assignment_row(future)])
        support = repo.search(self.query()).support.regional_support
        self.assertEqual(support.comparable_count, 0)
        # 0 viajes < mínimo aprobado (3) → insufficient_evidence
        self.assertEqual(support.regional_cost_level, "insufficient_evidence")

    def test_older_history_fallback_flag(self) -> None:
        old = load_row(
            evidence_id="VXS-8", available_at="2025-06-02T00:00:00+00:00"
        )
        repo = self.build([old], [assignment_row(old)])
        support = repo.search(self.query()).support.regional_support
        self.assertTrue(support.older_history_fallback)
        self.assertEqual(support.history_window, "older_than_6_months")

    def test_checksum_mismatch_makes_layer_unavailable(self) -> None:
        row = load_row(evidence_id="VXS-9")
        repo = self.build(
            [row], [assignment_row(row, checksum="otro-checksum")]
        )
        support = repo.search(self.query()).support.regional_support
        self.assertEqual(support.status, "unavailable")

    def test_no_segmentation_makes_layer_unavailable(self) -> None:
        row = load_row(evidence_id="VXS-10")
        repo = self.build([row], [assignment_row(row)], segmentation=None)
        support = repo.search(self.query()).support.regional_support
        self.assertEqual(support.status, "unavailable")

    def test_prompt_payload_excludes_carriers_and_evidence_ids_registered(self) -> None:
        row = load_row(evidence_id="VXS-11")
        repo = self.build([row], [assignment_row(row)])
        retrieval = repo.search(self.query())
        support = retrieval.support.regional_support
        regional_id = support.routes[0].evidence_id
        payload = retrieval.evidence[regional_id]["prompt_payload"]
        self.assertNotIn("carriers", payload)
        for key in ("origin_lat", "origin_lng", "destination_lat", "destination_lng"):
            self.assertNotIn(key, payload)
        blocks = {
            "historical_support": {
                "regional_support": {"route_summaries": [payload]},
            }
        }
        self.assertIn(regional_id, _evidence_ids(blocks))
        # La interfaz sí recibe transportistas y folios.
        self.assertTrue(support.routes[0].carriers)
        self.assertTrue(support.routes[0].reference_ids)

    def test_token_drop_removes_regional_before_exact(self) -> None:
        blocks = {
            "historical_support": {
                "route_summaries": [{"evidence_id": "exact-1", "x": "y" * 50}],
                "reference_records": [],
                "nearby_routes": {"route_summaries": []},
                "regional_support": {
                    "route_summaries": [
                        {"evidence_id": f"reg-{i}", "x": "y" * 400}
                        for i in range(3)
                    ]
                },
            },
            "documentary_context": [{"evidence_id": "doc-1", "x": "y"}],
        }
        prepared = prepare_evidence(
            blocks,
            system_prompt="s",
            schema={},
            model="gpt-test",
            max_input_tokens=400,
        )
        remaining = prepared.blocks["historical_support"]["regional_support"][
            "route_summaries"
        ]
        self.assertLess(len(remaining), 3)
        self.assertEqual(
            len(prepared.blocks["historical_support"]["route_summaries"]), 1
        )


if __name__ == "__main__":
    unittest.main()
