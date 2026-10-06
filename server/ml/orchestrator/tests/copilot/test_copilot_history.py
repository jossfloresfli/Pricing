from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path
import unittest
from uuid import uuid4

from vax_pricing.copilot.history import (
    HistoricalQuery,
    HistoricalRepository,
)


def historical_record(
    *,
    evidence_id: str,
    origin: str = "A, MX",
    destination: str = "B, MX",
    cost: float = 100.0,
    sale: float | None = 125.0,
    provider: str = "Transportista A",
    available_at: str = "2026-01-02T00:00:00+00:00",
) -> dict[str, object]:
    route = f"{origin.lower()} -> {destination.lower()}"
    return {
        "evidence_id": evidence_id,
        "load_id": evidence_id,
        "origin": origin,
        "destination": destination,
        "route_key": route,
        "equipment": "DryVan 53",
        "equipment_key": "dryvan 53",
        "division": "National",
        "division_key": "national",
        "range": "Contracted",
        "range_key": "contracted",
        "route_type": "national",
        "flow": "Local",
        "provider": provider,
        "currency": "MXN",
        "all_in_rate_cost": cost,
        "all_in_rate_sale": sale,
        "distance_km": 300,
        "distance_band": "0250_0499_km",
        "quote_created_at": "2025-12-20T00:00:00+00:00",
        "cost_available_at": available_at,
        "eligible_for_point_in_time": True,
    }


class HistoricalRepositoryTests(unittest.TestCase):
    def setUp(self) -> None:
        Path("tmp").mkdir(exist_ok=True)
        self.path = Path("tmp") / f"test_copilot_history_{uuid4().hex}.jsonl"
        self.cache_path = Path("tmp") / f"test_route_cache_{uuid4().hex}.csv"
        self.addCleanup(lambda: self.path.unlink(missing_ok=True))
        self.addCleanup(lambda: self.cache_path.unlink(missing_ok=True))

    def write(self, records: list[dict[str, object]]) -> None:
        self.path.write_text(
            "\n".join(json.dumps(record) for record in records) + "\n",
            encoding="utf-8",
        )

    def query(self) -> HistoricalQuery:
        return HistoricalQuery(
            origin="A, MX",
            destination="B, MX",
            equipment="DryVan 53",
            division="National",
            service_range="Contracted",
            currency="MXN",
            quote_created_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
            distance_km=300,
        )

    def write_route_cache(self, rows: list[dict[str, object]]) -> None:
        columns = [
            "route_key",
            "google_origin_lat",
            "google_origin_lng",
            "google_destination_lat",
            "google_destination_lng",
        ]
        self.cache_path.write_text(
            ",".join(columns)
            + "\n"
            + "\n".join(
                ",".join(str(row[column]) for column in columns) for row in rows
            )
            + "\n",
            encoding="utf-8",
        )

    def test_point_in_time_direction_sale_and_margin(self) -> None:
        self.write(
            [
                historical_record(evidence_id="positive", cost=100, sale=125),
                historical_record(evidence_id="negative", cost=130, sale=120),
                historical_record(
                    evidence_id="missing-sale",
                    cost=90,
                    sale=None,
                    provider="Transportista B",
                ),
                historical_record(
                    evidence_id="future",
                    available_at="2026-03-01T00:00:00+00:00",
                ),
                historical_record(
                    evidence_id="reverse",
                    origin="B, MX",
                    destination="A, MX",
                ),
            ]
        )
        result = HistoricalRepository(self.path).search(self.query())
        self.assertEqual(result.internal_match_level, "exact")
        self.assertEqual(result.support.comparable_count, 3)
        self.assertEqual(result.support.sale_margin_record_count, 2)
        self.assertEqual(len(result.support.routes), 1)
        route = result.support.routes[0]
        self.assertEqual(route.margin.negative_record_count, 1)
        self.assertEqual(route.all_in_rate_sale.usual, 122.5)
        self.assertEqual(result.support.carrier_count, 2)
        carriers = {
            summary.carrier: summary for summary in result.support.carriers
        }
        self.assertEqual(carriers["Transportista A"].shipment_count, 2)
        self.assertEqual(carriers["Transportista A"].cost.usual, 115.0)
        self.assertEqual(
            carriers["Transportista A"].reference_ids,
            ["negative", "positive"],
        )
        records = {record.evidence_id: record for record in result.support.records}
        self.assertEqual(records["positive"].carrier, "Transportista A")
        self.assertIsNone(records["missing-sale"].margin_percentage)
        self.assertAlmostEqual(records["positive"].margin_percentage or 0, 20.0)
        self.assertTrue(records["negative"].has_negative_margin)
        self.assertNotIn("reverse", records)
        self.assertNotIn("future", records)
        self.assertEqual(
            result.evidence["positive"]["type"],
            "historical_record",
        )
        self.assertNotIn(
            "Transportista A",
            json.dumps(result.evidence["positive"]["prompt_payload"]),
        )

    def test_reverse_route_is_only_available_as_peer_route(self) -> None:
        self.write(
            [
                historical_record(
                    evidence_id="reverse",
                    origin="B, MX",
                    destination="A, MX",
                )
            ]
        )
        result = HistoricalRepository(self.path).search(self.query())
        self.assertEqual(result.internal_match_level, "peer_segment")
        self.assertEqual(result.support.comparison_basis.value, "comparable_routes")

    def test_same_route_other_equipment_beats_comparable_routes(self) -> None:
        other_equipment = historical_record(evidence_id="misma-ruta-otro-equipo")
        other_equipment["equipment"] = "Flatbed 48"
        other_equipment["equipment_key"] = "flatbed 48"
        peer = historical_record(
            evidence_id="ruta-comparable",
            origin="C, MX",
            destination="D, MX",
        )
        self.write([other_equipment, peer])
        result = HistoricalRepository(self.path).search(self.query())
        self.assertEqual(result.internal_match_level, "route_any_equipment")
        self.assertEqual(result.support.comparison_basis.value, "same_route")
        self.assertEqual(result.support.comparable_count, 1)
        routes = result.support.routes
        self.assertTrue(routes)
        self.assertTrue(all(r.origin == "A, MX" and r.destination == "B, MX" for r in routes))
        self.assertIn("misma ruta con otro equipo", result.support.message)

    def test_comparable_routes_only_when_route_has_no_history(self) -> None:
        peer = historical_record(
            evidence_id="solo-comparable",
            origin="C, MX",
            destination="D, MX",
        )
        self.write([peer])
        result = HistoricalRepository(self.path).search(self.query())
        self.assertEqual(result.internal_match_level, "peer_segment")
        self.assertEqual(result.support.comparison_basis.value, "comparable_routes")

    def test_recent_window_excludes_older_route_records(self) -> None:
        self.write(
            [
                historical_record(
                    evidence_id="recent",
                    available_at="2026-01-15T00:00:00+00:00",
                ),
                historical_record(
                    evidence_id="older",
                    available_at="2025-06-01T00:00:00+00:00",
                ),
            ]
        )
        result = HistoricalRepository(self.path).search(self.query())
        self.assertEqual(result.support.history_window, "recent_6_months")
        self.assertFalse(result.support.older_history_fallback)
        self.assertEqual(
            [record.evidence_id for record in result.support.records],
            ["recent"],
        )

    def test_older_route_fallback_reports_fluctuation(self) -> None:
        self.write(
            [
                historical_record(
                    evidence_id="old-1",
                    cost=100,
                    sale=125,
                    available_at="2025-03-01T00:00:00+00:00",
                ),
                historical_record(
                    evidence_id="old-2",
                    cost=120,
                    sale=150,
                    available_at="2025-06-01T00:00:00+00:00",
                ),
            ]
        )
        result = HistoricalRepository(self.path).search(self.query())
        self.assertEqual(result.support.history_window, "older_than_6_months")
        self.assertTrue(result.support.older_history_fallback)
        self.assertIsNotNone(result.support.fluctuation)
        self.assertIn("seis meses", result.support.message)
        self.assertIn("fluctuado", result.support.message)

    def test_exact_route_and_nearby_routes_are_returned_separately(self) -> None:
        self.write(
            [
                historical_record(evidence_id="exact"),
                historical_record(
                    evidence_id="nearby",
                    origin="C MX",
                    destination="D MX",
                    provider="Transportista Cercano",
                ),
                historical_record(
                    evidence_id="far-destination",
                    origin="E MX",
                    destination="F MX",
                ),
            ]
        )
        self.write_route_cache(
            [
                {
                    "route_key": "c mx -> d mx",
                    "google_origin_lat": 20.1,
                    "google_origin_lng": -103.0,
                    "google_destination_lat": 25.1,
                    "google_destination_lng": -100.0,
                },
                {
                    "route_key": "e mx -> f mx",
                    "google_origin_lat": 20.1,
                    "google_origin_lng": -103.0,
                    "google_destination_lat": 25.4,
                    "google_destination_lng": -100.0,
                },
            ]
        )
        query = replace(
            self.query(),
            origin_lat=20.0,
            origin_lng=-103.0,
            destination_lat=25.0,
            destination_lng=-100.0,
        )
        result = HistoricalRepository(
            self.path,
            route_cache_path=self.cache_path,
            nearby_radius_km=30,
        ).search(query)

        self.assertEqual(result.internal_match_level, "exact")
        self.assertEqual(result.support.records[0].evidence_id, "exact")
        nearby = result.support.nearby_routes
        self.assertEqual(nearby.route_count, 1)
        self.assertEqual(nearby.comparable_count, 1)
        self.assertEqual(nearby.routes[0].origin, "C MX")
        self.assertLess(nearby.routes[0].origin_distance_km, 30)
        self.assertLess(nearby.routes[0].destination_distance_km, 30)
        self.assertEqual(
            nearby.routes[0].carriers[0].carrier,
            "Transportista Cercano",
        )
        self.assertNotIn("far-destination", json.dumps(nearby.model_dump(mode="json")))
        self.assertTrue(
            any(
                item.get("prompt_payload", {}).get("comparison") == "nearby_routes"
                for item in result.evidence.values()
            )
        )

    def test_nearby_routes_require_request_coordinates(self) -> None:
        self.write(
            [
                historical_record(evidence_id="exact"),
                historical_record(
                    evidence_id="nearby", origin="C MX", destination="D MX"
                ),
            ]
        )
        self.write_route_cache(
            [
                {
                    "route_key": "c mx -> d mx",
                    "google_origin_lat": 20.1,
                    "google_origin_lng": -103.0,
                    "google_destination_lat": 25.1,
                    "google_destination_lng": -100.0,
                }
            ]
        )
        result = HistoricalRepository(
            self.path, route_cache_path=self.cache_path
        ).search(self.query())
        self.assertEqual(result.support.nearby_routes.route_count, 0)


if __name__ == "__main__":
    unittest.main()
