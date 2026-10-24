#!/usr/bin/env python3
"""Normalize Codex tools; enforce deterministic Jev rules without approval bypass."""
import json
import re
import sys
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN / "scripts"))
from jev import engine
sys.path.insert(0, str(PLUGIN / "runtime/skills/jev-orchestrator/hooks"))
import permission_gate as gate


def deny(reason):
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
            "permissionDecision": "deny", "permissionDecisionReason": reason}}


def handle(event):
    if event.get("hook_event_name") == "UserPromptSubmit":
        return {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext":
                "For multipart Jev work use the jev-orchestrator skill. Skip routing trivial tasks. "
                "Codex permissions and approval policy remain authoritative."}}
    tool = event.get("tool_name", "")
    args = event.get("tool_input") or {}
    if not isinstance(args, dict):
        return deny("Jev: expected a JSON tool-input object.")
    cwd = event.get("cwd") or str(Path.cwd())
    if tool in ("Agent", "spawn_agent"):
        role = args.get("agent_type") or args.get("subagent_type") or ""
        if not role.startswith("jev-"):
            return {}
        cfg = engine.load_config()
        task = engine.task_marker(args.get("prompt") or args.get("message") or "")
        result = engine.check_dispatch(cfg, role, args.get("model"), task,
                                       routes=engine.load_routes(), project_dir=cwd)
        effort = args.get("reasoning_effort")
        if effort and effort != engine.agent_effort(cfg, role):
            return deny("Jev: explicit reasoning effort differs from routing config.")
        engine.routing_log({"task_id": task, "role": role, "allow": result["allow"], "errors": result["errors"]})
        if not result["allow"]:
            return deny("; ".join(result["errors"]))
        return {}
    command = args.get("command", args.get("cmd", ""))
    if tool in ("Bash", "exec_command") and isinstance(command, str):
        normalized = gate.normalize(command)
        hard = gate.hard_rules(normalized)
        reason = hard[1] if hard else gate.ask_rules(normalized, cwd)
        if reason:
            return deny("Jev: " + reason + " (Codex hooks do not support ask; review this operation explicitly.)")
    if tool in ("apply_patch", "Edit", "Write"):
        paths = re.findall(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$", command, re.M) if isinstance(command, str) else []
        names = [a or b for a, b in paths]
        if args.get("file_path"):
            names.append(args["file_path"])
        for name in names:
            result = gate.check_file_tool({"file_path": str(Path(cwd) / name)})
            if result:
                return deny("Jev: " + result[1])
    # Recognize literal credentials without echoing them in output or logs.
    payload = json.dumps(args)
    if engine.jevlib.redact(payload) != payload:
        return deny("Jev: possible literal credential in tool arguments; use an environment variable or secret store.")
    return {}


if __name__ == "__main__":
    try:
        event = json.load(sys.stdin)
        if not isinstance(event, dict):
            raise ValueError("event must be an object")
        print(json.dumps(handle(event)))
    except Exception as error:
        print(json.dumps(deny("Jev hook could not validate this call: " + type(error).__name__)))
