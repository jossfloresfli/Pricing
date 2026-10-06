from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch
from uuid import uuid4

from vax_pricing.copilot.budget import BudgetExceededError, UsageBudget
from vax_pricing.copilot.openai_client import SYSTEM_PROMPT
from vax_pricing.copilot.schemas import GeneratedCopilotAnswer
from vax_pricing.copilot.settings import CopilotSettings
from vax_pricing.copilot.token_limits import prepare_evidence


class CopilotBudgetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.path = Path("tmp") / f"copilot_budget_{uuid4().hex}.sqlite3"

    def tearDown(self) -> None:
        self.path.unlink(missing_ok=True)

    def test_daily_request_limit_blocks_before_another_call(self) -> None:
        budget = UsageBudget(
            self.path,
            daily_token_limit=10000,
            daily_request_limit=1,
        )
        reservation = budget.reserve(
            estimated_input_tokens=1000,
            max_output_tokens=200,
        )
        budget.settle(reservation, input_tokens=900, output_tokens=100)
        with self.assertRaises(BudgetExceededError):
            budget.reserve(estimated_input_tokens=1000, max_output_tokens=200)
        snapshot = budget.snapshot()
        self.assertEqual(snapshot["requests_used"], 1)
        self.assertEqual(snapshot["tokens_used_or_reserved"], 1000)

    def test_failed_call_keeps_conservative_token_reservation(self) -> None:
        budget = UsageBudget(
            self.path,
            daily_token_limit=1500,
            daily_request_limit=10,
        )
        reservation = budget.reserve(
            estimated_input_tokens=1000,
            max_output_tokens=300,
        )
        budget.fail(reservation)
        with self.assertRaises(BudgetExceededError):
            budget.reserve(estimated_input_tokens=1000, max_output_tokens=300)

    def test_daily_token_limit_is_independent_per_user(self) -> None:
        budget = UsageBudget(
            self.path,
            daily_token_limit=1500,
            daily_request_limit=10,
        )
        first = budget.reserve(
            estimated_input_tokens=1000,
            max_output_tokens=300,
            subject_key="sales-user-a",
        )
        budget.settle(first, input_tokens=900, output_tokens=100)
        with self.assertRaises(BudgetExceededError):
            budget.reserve(
                estimated_input_tokens=500,
                max_output_tokens=100,
                subject_key="sales-user-a",
            )
        second = budget.reserve(
            estimated_input_tokens=1000,
            max_output_tokens=300,
            subject_key="sales-user-b",
        )
        budget.settle(second, input_tokens=900, output_tokens=100)
        self.assertEqual(
            budget.snapshot("sales-user-a")["tokens_used_or_reserved"], 1000
        )
        self.assertEqual(
            budget.snapshot("sales-user-b")["tokens_used_or_reserved"], 1000
        )
        self.assertEqual(budget.snapshot("sales-user-a")["scope"], "per_user")

    def test_existing_global_budget_database_is_migrated(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        try:
            connection.execute(
                """
                CREATE TABLE copilot_usage (
                    reservation_id TEXT PRIMARY KEY,
                    usage_day TEXT NOT NULL,
                    status TEXT NOT NULL,
                    reserved_tokens INTEGER NOT NULL,
                    input_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    settled_at TEXT
                )
                """
            )
            connection.commit()
        finally:
            connection.close()
        budget = UsageBudget(
            self.path,
            daily_token_limit=85000,
            daily_request_limit=25,
        )
        reservation = budget.reserve(
            estimated_input_tokens=1000,
            max_output_tokens=300,
            subject_key="sales-user-a",
        )
        budget.settle(reservation, input_tokens=900, output_tokens=100)
        self.assertEqual(
            budget.snapshot("sales-user-a")["tokens_used_or_reserved"], 1000
        )

    def test_large_evidence_is_trimmed_to_input_limit(self) -> None:
        blocks = {
            "request": {"origin": "Monterrey", "destination": "Querétaro"},
            "pricing_result": {"selected_cost": 10000},
            "historical_support": {
                "route_summaries": [
                    {"evidence_id": f"hist-{index}", "notes": "ruta " * 150}
                    for index in range(4)
                ]
            },
            "documentary_context": [
                {"evidence_id": f"doc-{index}", "text": "contexto " * 300}
                for index in range(6)
            ],
        }
        prepared = prepare_evidence(
            blocks,
            system_prompt=SYSTEM_PROMPT,
            schema=GeneratedCopilotAnswer.model_json_schema(),
            model="gpt-5.4-mini",
            max_input_tokens=3000,
        )
        self.assertLessEqual(prepared.estimated_input_tokens, 3000)
        self.assertLess(
            len(prepared.blocks["documentary_context"]),
            len(blocks["documentary_context"]),
        )

    def test_environment_cannot_raise_hard_cost_ceilings(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "COPILOT_MAX_INPUT_TOKENS": "999999",
                "COPILOT_MAX_OUTPUT_TOKENS": "999999",
                "COPILOT_DAILY_TOKEN_LIMIT": "999999",
                "COPILOT_DAILY_REQUEST_LIMIT": "999999",
                "COPILOT_EMBEDDING_DAILY_TOKEN_LIMIT": "999999",
                "COPILOT_EMBEDDING_DAILY_REQUEST_LIMIT": "999999",
            },
        ):
            settings = CopilotSettings.from_env()
        self.assertEqual(settings.max_input_tokens, 3000)
        self.assertEqual(settings.max_output_tokens, 300)
        self.assertEqual(settings.daily_token_limit, 85000)
        self.assertEqual(settings.daily_request_limit, 25)
        self.assertEqual(settings.embedding_daily_token_limit, 5000)
        self.assertEqual(settings.embedding_daily_request_limit, 30)


if __name__ == "__main__":
    unittest.main()
