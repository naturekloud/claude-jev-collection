import importlib.util
import unittest
from pathlib import Path


path = Path(__file__).resolve().parents[1] / "adapters/router/scripts/startup.py"
spec = importlib.util.spec_from_file_location("router_startup", path)
startup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(startup)


class RouterStartupTests(unittest.TestCase):
    def test_new_root_sessions_request_panel_once(self):
        for source in ("startup", "clear"):
            output = startup.startup_context({"hook_event_name": "SessionStart", "source": source})
            context = output["hookSpecificOutput"]["additionalContext"]
            self.assertIn("mcp__router__show_router", context)
            self.assertIn("first assistant response", context)
            self.assertIn("Do not reopen", context)

    def test_resume_compaction_forks_and_other_events_are_ignored(self):
        for source in ("resume", "compact", "fork", "unknown", None):
            self.assertEqual(startup.startup_context({"hook_event_name": "SessionStart", "source": source}), {})
        self.assertEqual(startup.startup_context({"hook_event_name": "UserPromptSubmit", "source": "startup"}), {})
        self.assertEqual(startup.startup_context(None), {})


if __name__ == "__main__":
    unittest.main()
