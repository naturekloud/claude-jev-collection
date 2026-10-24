import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class CodexKitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.base = Path(cls.temp.name)
        spec = importlib.util.spec_from_file_location("build", ROOT / "codex/scripts/build.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cls.plugin = module.build(cls.base / "dist")

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.work = tempfile.TemporaryDirectory(dir=self.base)
        self.addCleanup(self.work.cleanup)
        self.cwd = Path(self.work.name)
        self.home = self.cwd / "home"
        self.env = dict(os.environ, CODEX_HOME=str(self.home), JEV_HOME=str(self.home / "jev"))
        self.env.pop("JEV_CONFIG", None)
        self.env.pop("JEV_AGENTS_DIR", None)

    def run_script(self, script, *args, data=None, check=True):
        result = subprocess.run([sys.executable, str(self.plugin / script), *args],
                                cwd=self.cwd, env=self.env, text=True,
                                input=json.dumps(data) if data is not None else None,
                                capture_output=True)
        if check:
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        return result

    def setup_agents(self):
        self.run_script("scripts/setup.py", "--apply")

    def hook(self, tool, args):
        result = self.run_script("hooks/adapter.py", data={"hook_event_name": "PreToolUse",
                                "tool_name": tool, "tool_input": args, "cwd": str(self.cwd)})
        return json.loads(result.stdout)

    def test_setup_dry_run_install_idempotence_and_preflight(self):
        self.run_script("scripts/setup.py")
        self.assertFalse(self.home.exists())
        self.setup_agents()
        self.assertEqual(len(list((self.home / "agents").glob("*.toml"))), 9)
        self.assertEqual(self.run_script("scripts/setup.py", "--apply").stdout, "")
        result = self.run_script("scripts/jev.py", "preflight", "--all", "--json")
        self.assertTrue(json.loads(result.stdout)["ok"])

    def test_core_rebuild_preserves_external_catalog_entries(self):
        spec = importlib.util.spec_from_file_location("rebuild", ROOT / "codex/scripts/build.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        out = self.cwd / "dist"
        module.build(out)
        catalog = out / ".agents/plugins/marketplace.json"
        data = json.loads(catalog.read_text())
        data["plugins"].append({"name": "router", "source": {"source": "local", "path": "./plugins/router"}})
        catalog.write_text(json.dumps(data))
        module.build(out)
        self.assertEqual([p["name"] for p in json.loads(catalog.read_text())["plugins"]], ["jev-kit", "router"])

    def test_conflict_is_preserved_then_backed_up(self):
        self.setup_agents()
        target = self.home / "agents/jev-builder.toml"
        original = target.read_text() + "\n# user configuration\n"
        target.write_text(original)
        result = self.run_script("scripts/setup.py", "--apply", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(target.read_text(), original)
        self.run_script("scripts/setup.py", "--apply", "--force")
        backups = list((self.home / "jev/backup").glob("*/jev-builder.toml"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), original)

    def test_preflight_rejects_project_shadow_with_wrong_sandbox(self):
        self.setup_agents()
        target = self.cwd / ".codex/agents/jev-reviewer.toml"
        target.parent.mkdir(parents=True)
        target.write_text((self.home / "agents/jev-reviewer.toml").read_text().replace('"read-only"', '"workspace-write"'))
        result = self.run_script("scripts/jev.py", "preflight", "--all", "--json", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(json.loads(result.stdout)["ok"])

    def test_dispatch_checks_model_effort_and_route(self):
        self.setup_agents()
        args = {"agent_type": "jev-builder", "prompt": "Implement task [jev:task=T]"}
        self.assertEqual(self.hook("spawn_agent", args), {})
        denied = self.hook("spawn_agent", dict(args, model="wrong-model"))
        self.assertEqual(denied["hookSpecificOutput"]["permissionDecision"], "deny")
        denied = self.hook("spawn_agent", dict(args, reasoning_effort="high"))
        self.assertEqual(denied["hookSpecificOutput"]["permissionDecision"], "deny")
        state = self.home / "jev"
        state.mkdir(exist_ok=True)
        (state / "last_route.json").write_text(json.dumps({"T": {"allowed": ["jev-reviewer"]}}))
        denied = self.hook("spawn_agent", args)
        self.assertEqual(denied["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_shell_patch_and_secret_guards(self):
        self.assertEqual(self.hook("Bash", {"command": "git status --short"}), {})
        for tool, args in [
            ("exec_command", {"cmd": "rm -rf /"}),
            ("apply_patch", {"command": "*** Begin Patch\n*** Add File: .env\n+SECRET=value\n*** End Patch"}),
            ("apply_patch", {"command": "*** Begin Patch\n*** Update File: safe.txt\n*** Move to: .env\n*** End Patch"}),
            ("Write", {"file_path": "code.txt", "content": "ghp_abcdefghijklmnopqrstuvwx"})
        ]:
            with self.subTest(tool=tool, args=args):
                output = self.hook(tool, args)
                self.assertEqual(output["hookSpecificOutput"]["permissionDecision"], "deny")
                self.assertNotIn("ghp_abcdefghijklmnopqrstuvwx", json.dumps(output))

    def test_handoff_plan_and_ledger_work_without_claude(self):
        result = self.run_script("scripts/jev.py", "handoff", "template", "--kind", "completion", "--format", "json")
        handoff = self.cwd / "completion.json"
        handoff.write_text(result.stdout)
        self.run_script("scripts/jev.py", "handoff", "validate", "--kind", "completion", str(handoff))
        plan = self.cwd / "plan.md"
        plan.write_text("# Task\nChange one file and verify the behavior.\n")
        self.run_script("scripts/jev.py", "plan", "save", "--task", "T", "--from-file", str(plan))
        self.assertTrue((self.cwd / ".jev/plans/T.md").exists())
        self.run_script("scripts/jev.py", "dedupe", "Implement feature")
        self.assertTrue((self.cwd / ".jev/subgoals.jsonl").exists())
        self.assertFalse((self.cwd / ".claude").exists())

    @unittest.skipUnless(shutil.which("codex"), "Codex CLI is not installed")
    def test_codex_cli_installs_self_contained_package(self):
        codex = shutil.which("codex")
        self.home.mkdir()
        for args in [
            ["plugin", "marketplace", "add", str(self.base / "dist")],
            ["plugin", "add", "jev-kit@codex-jev-collection", "--json"],
        ]:
            result = subprocess.run([codex, *args], cwd=self.cwd, env=self.env,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        installed = Path(json.loads(result.stdout)["installedPath"])
        self.assertTrue((installed / "runtime/config/schemas").is_dir())
        self.assertTrue((installed / "skills/context7-mcp/SKILL.md").is_file())
        self.assertEqual(len(list((installed / "agents").glob("*.toml"))), 9)


if __name__ == "__main__":
    unittest.main()
