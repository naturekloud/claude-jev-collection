#!/usr/bin/env python3
"""Codex entry point for the shared Jev engine (Python 3.11+)."""
import os
import sys
import importlib.util
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
os.environ["JEV_RUNTIME"] = "codex"
os.environ.setdefault("JEV_CONFIG", str(PLUGIN / "config/agents.json"))
sys.path.insert(0, str(PLUGIN / "runtime/skills/jev-orchestrator/scripts"))
spec = importlib.util.spec_from_file_location("jev_engine", PLUGIN / "runtime/skills/jev-orchestrator/scripts/jev.py")
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

engine.REGISTRY_NOTE = "File validation does not prove live registration; restart Codex after installing agents."
engine.RESTART_HINT = "Run the jev-kit setup script, then restart Codex."
original_message = engine.preflight_message


def preflight_message(*args, **kwargs):
    return original_message(*args, **kwargs).replace("Claude Code", "Codex")


engine.preflight_message = preflight_message

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "outcomes":
        sys.exit("outcomes relies on Claude transcripts and is not supported on Codex; use report/label instead.")
    engine.main()
