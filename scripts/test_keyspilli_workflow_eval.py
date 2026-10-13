import importlib.util
import unittest
from pathlib import Path
from types import ModuleType


class WorkflowEvaluationTests(unittest.TestCase):
    module = ModuleType("not_loaded")

    def setUp(self):
        path = Path(__file__).with_name("evaluate-keyspilli-workflow.py")
        self.assertTrue(path.is_file(), "bounded workflow harness command is not implemented")
        spec = importlib.util.spec_from_file_location("workflow_evaluation", path)
        assert spec is not None and spec.loader is not None
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_matrix_has_disjoint_complete_arms(self):
        cells = self.module.matrix()
        self.assertEqual(len({c["id"] for c in cells}), len(cells))
        for model in ["gpt-6-luna", "B.AI/mimo-v2.6-flash"]:
            for skill in ["old", "new"]:
                for repetition in [1, 2]:
                    arm = [c for c in cells if c["model"] == model and c["skill"] == skill and c["repetition"] == repetition]
                    self.assertEqual({c["task"] for c in arm}, set(self.module.TASKS))
                    self.assertEqual(sum(c["expected"] == "complete-provisional" for c in arm), 6)
                    self.assertEqual(sum(c["expected"] == "refused-or-incomplete" for c in arm), 6)

    def test_budget_refuses_before_a_request_and_reserves_unknown_usage(self):
        budget = self.module.Budget(0.015)
        reserve = budget.reserve("B.AI/mimo-v2.6-flash", 65536, 2048)
        budget.settle(reserve, None, "B.AI/mimo-v2.6-flash")
        with self.assertRaisesRegex(ValueError, "budget"):
            budget.reserve("B.AI/mimo-v2.6-flash", 65536, 2048)
        self.assertGreater(budget.spent, 0)
        self.assertEqual(budget.unknown_usage_calls, 1)

    def test_paid_price_does_not_credit_caching_or_promotional_discounts(self):
        budget = self.module.Budget(5)
        reserve = budget.reserve("B.AI/mimo-v2.6-flash", 10000, 1000)
        budget.settle(reserve, {"prompt_tokens": 4000, "completion_tokens": 500}, "B.AI/mimo-v2.6-flash")
        self.assertAlmostEqual(budget.spent, 4000 * .14 / 1e6 + 500 * .28 / 1e6)
        with self.assertRaises(ValueError):
            budget.reserve("unknown-route", 100, 100)

    def test_invalid_token_bounds_cannot_poison_or_bypass_currency_admission(self):
        for bad in [True, float("nan"), -1]:
            budget = self.module.Budget(5)
            with self.assertRaises(ValueError):
                budget.reserve("B.AI/mimo-v2.6-flash", bad, 100)
            self.assertEqual(budget.spent, 0)

    def test_reservation_settlement_cannot_be_replayed_or_use_another_model(self):
        budget = self.module.Budget(5)
        reserve = budget.reserve("B.AI/mimo-v2.6-flash", 1000, 1000)
        with self.assertRaises(ValueError):
            budget.settle(reserve, {"prompt_tokens": 1, "completion_tokens": 1}, "gpt-6-luna")
        budget.settle(reserve, {"prompt_tokens": 10, "completion_tokens": 10}, "B.AI/mimo-v2.6-flash")
        spent = budget.spent
        with self.assertRaises(ValueError):
            budget.settle(reserve, {"prompt_tokens": 10, "completion_tokens": 10}, "B.AI/mimo-v2.6-flash")
        self.assertEqual(budget.spent, spent)

    def test_unexecuted_cells_never_become_completions(self):
        summary = self.module.summarize([{"status": "not-run", "attempted_calls": 0}, {"status": "unavailable", "attempted_calls": 0},
                                         {"status": "failed", "attempted_calls": 1}, {"status": "complete-provisional", "verified": False, "attempted_calls": 1}])
        self.assertEqual(summary["verifiedDeliveries"], 0)
        self.assertEqual(summary["executed"], 2)
        self.assertEqual(summary["notRunOrUnavailable"], 2)


if __name__ == "__main__":
    unittest.main()
