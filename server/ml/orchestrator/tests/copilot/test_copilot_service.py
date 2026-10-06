from datetime import datetime, timezone
import json
from pathlib import Path
import unittest

from protected_cost.preprocessing import canonicalize_location


class CanonicalizeLocationForCopilotTests(unittest.TestCase):
    """El copiloto debe canonizar ubicaciones Google Maps al formato del corpus."""

    def test_google_format_matches_corpus_route_key(self) -> None:
        from vax_pricing.copilot.history import route_key

        origin = canonicalize_location("Tonalá, Jal., México")
        destination = canonicalize_location("Zapopan, Jal., México")
        self.assertEqual(
            route_key(origin, destination),
            "tonala, jalisco -> zapopan, jalisco",
        )

    def test_corpus_format_is_preserved(self) -> None:
        self.assertEqual(
            canonicalize_location("Guadalajara, Jalisco"),
            "guadalajara, jalisco",
        )


class ConvertMoneyToUsdTests(unittest.TestCase):
    """Divisiones en dólares: toda la salida del copiloto se presenta en USD."""

    def test_converts_money_keys_and_currency_recursively(self) -> None:
        from vax_pricing.copilot.service import convert_money_to_usd

        node = {
            "currency": "MXN",
            "cost": {"low": 100.0, "usual": 200.0, "high": 300.0},
            "margin": {"usual_amount": 50.0, "usual_percentage": 12.5},
            "records": [
                {"currency": "MXN", "cost": 1000.0, "margin_amount": 80.0}
            ],
            "shipment_count": 38,
        }
        out = convert_money_to_usd(node, 0.05)
        self.assertEqual(out["currency"], "USD")
        self.assertEqual(out["cost"], {"low": 5.0, "usual": 10.0, "high": 15.0})
        self.assertEqual(out["margin"]["usual_amount"], 2.5)
        # Los porcentajes y conteos no se convierten.
        self.assertEqual(out["margin"]["usual_percentage"], 12.5)
        self.assertEqual(out["shipment_count"], 38)
        self.assertEqual(out["records"][0]["currency"], "USD")
        self.assertEqual(out["records"][0]["cost"], 50.0)
        self.assertEqual(out["records"][0]["margin_amount"], 4.0)

    def test_quote_request_accepts_usd_display(self) -> None:
        from vax_pricing.copilot.schemas import QuoteRequest

        request = QuoteRequest(
            origin="Huehuetoca, México",
            destination="Sycamore, Illinois",
            equipment="DryVan 53",
            division="Crossborder",
            usd_display={"rate": 0.0578},
        )
        self.assertAlmostEqual(request.usd_display.rate, 0.0578)

from vax_pricing.copilot.history import HistoricalRepository
from vax_pricing.copilot.openai_client import GenerationResult
from vax_pricing.copilot.retrieval import DocumentRepository
from vax_pricing.copilot.schemas import (
    GeneratedCopilotAnswer,
    PricingResult,
    QuoteRequest,
    RegionalPricingContext,
    TokenUsage,
)
from vax_pricing.copilot.service import PriceCopilotService
from vax_pricing.copilot.settings import CopilotSettings


class CapturingGenerator:
    def __init__(self, *, forbidden_answer: bool = False) -> None:
        self.blocks = None
        self.budget_subject = None
        self.forbidden_answer = forbidden_answer

    def generate(self, evidence_blocks, *, budget_subject):
        self.blocks = evidence_blocks
        self.budget_subject = budget_subject
        history_ids = [
            record["evidence_id"]
            for record in evidence_blocks["historical_support"]["route_summaries"]
        ]
        document_ids = [
            record["evidence_id"]
            for record in evidence_blocks["documentary_context"]
        ]
        return GenerationResult(
            output=GeneratedCopilotAnswer(
                evidence_status="grounded",
                answer=(
                    "Explicación con accesorial."
                    if self.forbidden_answer
                    else "El precio está respaldado por viajes anteriores."
                ),
                evidence_ids=(history_ids + document_ids)[:2],
                limitations=[],
            ),
            model="gpt-5.4-mini-test",
            usage=TokenUsage(input_tokens=100, output_tokens=20),
        )


class CopilotServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.settings = CopilotSettings(
            enabled=False,
            api_key=None,
            model_test="gpt-5.4-mini",
            model_target="gpt-5.6-luna",
            model_phase="test",
            embedding_model="text-embedding-3-small",
            semantic_search_enabled=False,
            timeout_seconds=20,
            max_input_tokens=3000,
            max_output_tokens=300,
            daily_token_limit=85000,
            daily_request_limit=25,
            embedding_daily_token_limit=5000,
            embedding_daily_request_limit=30,
            max_history_records=8,
            max_route_summaries=3,
            nearby_route_radius_km=30,
            nearby_route_distance_tolerance_pct=20,
            max_nearby_route_summaries=5,
            regional_support_enabled=True,
            max_regional_route_summaries=3,
            regional_cost_level_lower_pct=-10.0,
            regional_cost_level_higher_pct=10.0,
            regional_min_trips_for_level=3,
            max_documents=4,
            structured_dir=Path("rag/structured"),
            vector_dir=Path("rag/vectors"),
            usage_db_path=Path("tmp/test_copilot_service_usage.sqlite3"),
            embedding_usage_db_path=Path("tmp/test_embedding_service_usage.sqlite3"),
        )
        cls.history = HistoricalRepository(
            Path("rag/structured/historical_loads.jsonl"),
            max_records=8,
            max_route_summaries=3,
        )
        cls.documents = DocumentRepository(
            Path("rag/structured/document_chunks.jsonl"),
            max_documents=4,
        )

    def request(self) -> QuoteRequest:
        return QuoteRequest(
            quote_id="TEST-1",
            origin="Tonala, Jalisco",
            destination="Zapopan, Jalisco",
            equipment="DryVan 53",
            division="National",
            flow="Local",
            client="SECRET CLIENT",
            provider="SECRET PROVIDER",
            service_range="Contracted",
            currency="MXN",
            distance_km=25,
            created_at=datetime(2026, 7, 27, tzinfo=timezone.utc),
        )

    def pricing(self) -> PricingResult:
        return PricingResult(
            quote_id="TEST-1",
            currency="MXN",
            selected_cost=7700,
            all_in_rate_sale=9390,
            margin_amount=1690,
            margin_percentage=18,
            selected_model="lightgbm",
            review_required=True,
            decision_blocked=True,
            route_history_count=391,
            history_level="supported",
            reasons=["lightgbm_incumbent"],
            guardrail_reasons=[],
            action="Revisar antes de enviar.",
        )

    def service(self, generator) -> PriceCopilotService:
        return PriceCopilotService(
            settings=self.settings,
            history=self.history,
            documents=self.documents,
            generator=generator,
            index_version="test",
        )

    def test_without_api_key_keeps_history_and_marks_copilot_unavailable(self) -> None:
        result = self.service(None).explain(
            self.request(), self.pricing(), budget_subject="sales-user-1"
        )
        self.assertEqual(result.status.value, "unavailable")
        self.assertGreater(result.historical_support.comparable_count, 0)
        self.assertEqual(len(result.historical_support.records), 8)

    def test_prompt_is_desidentified_and_citations_are_backend_validated(self) -> None:
        generator = CapturingGenerator()
        result = self.service(generator).explain(
            self.request(), self.pricing(), budget_subject="sales-user-1"
        )
        self.assertEqual(generator.budget_subject, "sales-user-1")
        serialized = json.dumps(generator.blocks, ensure_ascii=False)
        self.assertNotIn("SECRET CLIENT", serialized)
        self.assertNotIn("SECRET PROVIDER", serialized)
        carrier = result.historical_support.records[0].carrier
        self.assertTrue(carrier)
        self.assertNotIn(carrier, serialized)
        references = generator.blocks["historical_support"]["reference_records"]
        self.assertTrue(references)
        self.assertTrue(references[0]["evidence_id"].startswith("VXS-"))
        self.assertNotIn("carrier", references[0])
        self.assertEqual(result.status.value, "grounded")
        self.assertTrue(result.citations)
        self.assertTrue(
            any(citation.type == "historical_record" for citation in result.citations)
        )
        self.assertIn("VXS-", result.answer)

    def test_forbidden_output_is_discarded(self) -> None:
        result = self.service(CapturingGenerator(forbidden_answer=True)).explain(
            self.request(), self.pricing(), budget_subject="sales-user-1"
        )
        self.assertEqual(result.status.value, "limited_evidence")
        self.assertNotIn("accesorial", result.answer.lower())

    def test_regional_context_is_sent_and_explained_when_used(self) -> None:
        generator = CapturingGenerator()
        pricing = self.pricing()
        pricing.reasons = ["national_geo_hierarchical_support"]
        pricing.regional_context = RegionalPricingContext(
            model_version="national_geo_14_regions_2025-12-31",
            region_count=14,
            origin_region="Occidente",
            destination_region="Centro metropolitano",
            regional_corridor="Occidente → Centro metropolitano",
            used_by_selected_cost=True,
            relevance="La región apoyó el costo por poca experiencia exacta.",
            boundary_note="No son límites oficiales.",
        )
        request = self.request()
        request.created_at = datetime(2026, 7, 29, tzinfo=timezone.utc)
        result = self.service(generator).explain(
            request, pricing, budget_subject="sales-user-1"
        )
        submitted = generator.blocks["pricing_result"]["regional_context"]
        self.assertTrue(submitted["used_by_selected_cost"])
        self.assertEqual(
            submitted["regional_corridor"],
            "Occidente → Centro metropolitano",
        )
        self.assertIn("Occidente → Centro metropolitano", result.answer)
        self.assertTrue(
            any(
                "segmentación" in citation.title.lower()
                or "occidente" in citation.title.lower()
                or "segmentación" in citation.source.lower()
                for citation in result.citations
            )
        )


if __name__ == "__main__":
    unittest.main()
