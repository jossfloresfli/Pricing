from pathlib import Path
from types import SimpleNamespace
import unittest
from uuid import uuid4

from vax_pricing.copilot.openai_client import OpenAICopilotGenerator
from vax_pricing.copilot.settings import CopilotSettings


class FakeResponses:
    def __init__(self) -> None:
        self.request = None

    def create(self, **kwargs):
        self.request = kwargs
        return SimpleNamespace(
            output_text=(
                '{"evidence_status":"grounded","answer":"Precio sustentado.",'
                '"evidence_ids":["hist-1"],"limitations":[]}'
            ),
            model="gpt-5.4-mini-2026-07-01",
            usage=SimpleNamespace(
                input_tokens=100,
                output_tokens=20,
                input_tokens_details=SimpleNamespace(cached_tokens=10),
            ),
        )


class OpenAICopilotTests(unittest.TestCase):
    def test_responses_request_preserves_contract_and_has_no_tools(self) -> None:
        responses = FakeResponses()
        client = SimpleNamespace(responses=responses)
        usage_path = Path("tmp") / f"test_openai_copilot_{uuid4().hex}.sqlite3"
        self.addCleanup(usage_path.unlink, missing_ok=True)
        settings = CopilotSettings(
            enabled=True,
            api_key="test",
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
            usage_db_path=usage_path,
            embedding_usage_db_path=Path("tmp/test_embedding_usage.sqlite3"),
        )
        result = OpenAICopilotGenerator(settings, client=client).generate(
            {
                "request": {},
                "pricing_result": {},
                "historical_support": {},
                "documentary_context": [],
            },
            budget_subject="sales-user-1",
        )
        request = responses.request
        self.assertEqual(request["model"], "gpt-5.4-mini")
        self.assertEqual(request["reasoning"], {"effort": "none"})
        self.assertFalse(request["store"])
        self.assertEqual(request["max_output_tokens"], 300)
        self.assertNotIn("tools", request)
        self.assertTrue(request["text"]["format"]["strict"])
        self.assertEqual(
            set(request["text"]["format"]["schema"]["required"]),
            {"evidence_status", "answer", "evidence_ids", "limitations"},
        )
        self.assertEqual(result.usage.cached_input_tokens, 10)
        self.assertLessEqual(result.estimated_input_tokens, 3000)


if __name__ == "__main__":
    unittest.main()
