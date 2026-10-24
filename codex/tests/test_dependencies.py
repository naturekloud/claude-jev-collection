import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "scripts/dependencies.py"
spec = importlib.util.spec_from_file_location("dependencies", MODULE)
deps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deps)


class DependenciesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        (self.source / ".claude-plugin").mkdir(parents=True)
        (self.source / ".claude-plugin/plugin.json").write_text('{"version":"1.0"}')
        (self.source / "skills/demo").mkdir(parents=True)
        (self.source / "skills/demo/SKILL.md").write_text("Demo")
        self.spec = dict(name="demo", codex_name="jev-demo", version="1.0", marketplace="demo-market", repo="https://example.test/demo", commit="a" * 40, subdir=".", mode="portable", notes="Portable demo", include=["skills"])
        self.out = self.root / "dist"
        self.registry = patch.object(deps, "registry", return_value=[self.spec])
        self.registry.start()

    def tearDown(self):
        self.registry.stop()
        self.temp.cleanup()

    def prepare(self):
        return deps.prepare(out=self.out, sources={"demo": self.source})

    def test_prepare_preserves_catalog_and_source(self):
        catalog = self.out / ".agents/plugins/marketplace.json"
        catalog.parent.mkdir(parents=True)
        catalog.write_text(json.dumps({"name": "codex-jev-collection", "plugins": [{"name": "jev-kit"}]}))
        self.prepare()
        self.assertEqual([p["name"] for p in json.loads(catalog.read_text())["plugins"]], ["jev-kit", "jev-demo"])
        self.assertTrue((self.out / "plugins/jev-demo/PROVENANCE.json").is_file())
        manifest = json.loads((self.out / "plugins/jev-demo/.codex-plugin/plugin.json").read_text())
        self.assertEqual(manifest["version"], "1.0-codex.1")
        provenance = json.loads((self.out / "plugins/jev-demo/PROVENANCE.json").read_text())
        self.assertEqual(provenance["version"], "1.0")
        self.assertEqual(provenance["source_verification"], "manifest-version")
        self.assertIsNone(provenance["verified_commit"])
        self.assertFalse((self.source / ".codex-plugin").exists())

    def test_install_dry_run_and_apply(self):
        self.prepare()
        with patch.object(deps.subprocess, "run") as run:
            commands = deps.install(out=self.out)
            run.assert_not_called()
            deps.install(out=self.out, apply=True)
            self.assertEqual(run.call_count, 2)
        self.assertEqual(commands[1][-1], "jev-demo@codex-jev-collection")

    def test_failure_does_not_modify_published_target(self):
        self.prepare()
        before = (self.out / ".agents/plugins/marketplace.json").read_text()
        self.spec["include"].append("missing")
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertEqual((self.out / ".agents/plugins/marketplace.json").read_text(), before)
        self.assertTrue((self.out / "plugins/jev-demo/skills/demo/SKILL.md").exists())

    def test_rejects_symlinks_and_traversal(self):
        (self.source / "skills/secret").symlink_to(self.source / ".claude-plugin/plugin.json")
        with self.assertRaises(ValueError):
            self.prepare()
        for path in ("../secret", "/secret", ".env", "a/.env.local"):
            with self.assertRaises(ValueError):
                deps.safe_relative(path)

    def test_version_and_source_resolution(self):
        with self.assertRaises(ValueError):
            deps.resolve_source(self.spec, cache=self.root)
        self.assertEqual(deps.resolve_source(self.spec, {"demo": self.source}), self.source)
        self.spec["version"] = "2.0"
        with self.assertRaises(ValueError):
            deps.resolve_source(self.spec, {"demo": self.source})

    def test_runtime_required(self):
        self.spec["name"] = "fast-jev-output"
        with self.assertRaisesRegex(ValueError, "build-runtime"):
            deps.prepare(out=self.out, sources={"fast-jev-output": self.source})

    def test_revision_and_mcp_runtime_validation(self):
        self.spec["codex_revision"] = 2
        self.prepare()
        package = self.out / "plugins/jev-demo"
        manifest_path = package / ".codex-plugin/plugin.json"
        manifest = json.loads(manifest_path.read_text())
        self.assertEqual(manifest["version"], "1.0-codex.2")
        manifest["mcpServers"] = "./.mcp.json"
        manifest_path.write_text(json.dumps(manifest))
        (package / ".mcp.json").write_text(json.dumps({"mcpServers": {"demo": {"command": "node", "args": ["./missing.mjs"]}}}))
        with self.assertRaisesRegex(ValueError, "Missing MCP runtime"):
            deps.validate_package(package, self.spec)

    def test_adapter_shared_runtime_and_missing_hook(self):
        adapter = self.root / "adapters/demo"
        (adapter / "scripts").mkdir(parents=True)
        (adapter / "scripts/run.mjs").write_text("import './shared.mjs';")
        (adapter.parent / "shared.mjs").write_text("export const shared = true;")
        (adapter / "hooks").mkdir()
        (adapter / "hooks/hooks.json").write_text(json.dumps({"hooks": {"Stop": [{"hooks": [{"type": "command", "command": 'node "${PLUGIN_ROOT}/scripts/run.mjs"'}]}]}}))
        with patch.object(deps, "ROOT", self.root):
            self.prepare()
            self.assertTrue((self.out / "plugins/jev-demo/scripts/shared.mjs").is_file())
            (adapter / "scripts/run.mjs").unlink()
            with self.assertRaisesRegex(ValueError, "Missing hook runtime"):
                self.prepare()


if __name__ == "__main__":
    unittest.main()
