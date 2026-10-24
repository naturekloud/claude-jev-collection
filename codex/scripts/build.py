#!/usr/bin/env python3
"""Build a self-contained Codex marketplace from the maintained Jev sources."""
import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def build(destination):
    kit = ROOT / "plugins/kit"
    source = ROOT / "codex"
    plugin = destination / "plugins/jev-kit"
    shutil.copytree(source / "plugin", plugin, dirs_exist_ok=True)
    shutil.copytree(kit / "skills/context7-mcp", plugin / "skills/context7-mcp", dirs_exist_ok=True)
    runtime = plugin / "runtime"
    scripts = runtime / "skills/jev-orchestrator/scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    for name in ("jev.py", "jevlib.py", "jevctx.py", "jevpack.py", "jevqa.py"):
        shutil.copy2(kit / "skills/jev-orchestrator/scripts" / name, scripts / name)
    shutil.copytree(kit / "config/schemas", runtime / "config/schemas", dirs_exist_ok=True)
    shutil.copy2(kit / "licenses/jev-harness.LICENSE", runtime / "LICENSE")
    hooks = runtime / "skills/jev-orchestrator/hooks"
    hooks.mkdir(parents=True, exist_ok=True)
    shutil.copy2(kit / "skills/jev-orchestrator/hooks/permission_gate.py", hooks / "permission_gate.py")
    cfg = json.loads((kit / "config/agents.json").read_text())
    cfg["_comment"] = "Codex routing. Edit models and per-role effort before setup to customize."
    cfg["models"] = {"opus": "gpt-6-astra", "sonnet": "gpt-6.1-sol"}
    for spec in cfg["agents"].values():
        if spec["effort"] == "max":
            spec["effort"] = "xhigh"
    config = plugin / "config"
    config.mkdir(exist_ok=True)
    (config / "agents.json").write_text(json.dumps(cfg, indent=2) + "\n")
    agents = plugin / "agents"
    agents.mkdir(exist_ok=True)
    for name, spec in cfg["agents"].items():
        text = (kit / "assets/agents" / (name + ".md")).read_text()
        body = text.split("---", 2)[2].strip()
        body = body.replace("~/.claude/kit/current/skills/jev-orchestrator/scripts/", "the installed jev-kit runtime scripts directory: ")
        if name == "jev-qa":
            body = ("Review UI evidence and report findings with screenshots, viewport, severity and reproduction steps. "
                    "Remain read-only. Ask the parent to create scenarios and run the packaged runtime/skills/"
                    "jev-orchestrator/scripts/jevqa.py using its configured jev-ultrafast environment, then inspect "
                    "report.json and screenshots. If browser tooling is available, use it only within the task's "
                    "authorized hosts and actions. Report BLOCKED when evidence or tooling is missing. "
                    "Return the qa handoff contract from jev.py handoff template --kind qa.")
        values = {"name": name, "description": spec["role"],
                  "model": cfg["models"][spec["model"]],
                  "model_reasoning_effort": spec["effort"],
                  "sandbox_mode": "workspace-write" if spec["write"] else "read-only",
                  "developer_instructions": body}
        (agents / (name + ".toml")).write_text("\n".join(k + " = " + json.dumps(v, ensure_ascii=False) for k, v in values.items()) + "\n")
    catalog = destination / ".agents/plugins"
    catalog.mkdir(parents=True, exist_ok=True)
    catalog_path = catalog / "marketplace.json"
    metadata = json.loads(catalog_path.read_text()) if catalog_path.exists() else {"name": "codex-jev-collection", "plugins": []}
    metadata["plugins"] = [p for p in metadata["plugins"] if p["name"] != "jev-kit"]
    metadata["plugins"].insert(0, {"name": "jev-kit", "source": {"source": "local", "path": "./plugins/jev-kit"},
                                 "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}})
    catalog_path.write_text(json.dumps(metadata, indent=2) + "\n")
    return plugin


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "codex/dist")
    args = parser.parse_args()
    print(build(args.out.resolve()))
