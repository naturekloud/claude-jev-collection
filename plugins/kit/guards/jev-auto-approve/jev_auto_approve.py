#!/usr/bin/env python3
"""Claude Code PreToolUse hook: Jev auto-approves safe Bash commands.

Fail-safe by design. The hook can only say "allow" or stay silent.
Silent means Claude Code shows its normal permission prompt. It never denies,
so the worst a wrong answer can do is ask you one extra time.
"""
import json
import os
import re
import sys
import urllib.request

API_URL = "https://api.typesafe.ai/v1/systemone"
MODEL = os.environ.get("JEV_MODEL", "jev-latest")
THRESHOLD = float(os.environ.get("JEV_AUTO_APPROVE_THRESHOLD", "0.95"))
TIMEOUT_S = float(os.environ.get("JEV_AUTO_APPROVE_TIMEOUT", "3"))
DRY_RUN = os.environ.get("JEV_AUTO_APPROVE_DRY") == "1"
LOG_PATH = os.environ.get("JEV_AUTO_APPROVE_LOG")  # off unless set: commands can contain secrets
MAX_LEN = 400

# Never sent to Jev. These always get the normal prompt, whatever the model thinks.
HARD_NO = re.compile(
    r"\brm\b|\bdel\b|rmdir|Remove-Item|\bmv\b|\bdd\b|mkfs|format\b|shutdown|reboot"
    r"|\bsudo\b|\bsu\b|chmod|chown|icacls|>\s*[^&|]|>>|\btee\b"
    r"|git\s+(push|reset|clean|checkout\s+--|rebase|commit|tag|branch\s+-D)"
    r"|curl|wget|Invoke-WebRequest|iwr\b|irm\b|\bssh\b|\bscp\b|\bnc\b"
    r"|\b(npm|pnpm|yarn|pip|pipx|uv|brew|choco|winget|apt|cargo)\s+(i|install|add|remove|uninstall|publish)"
    r"|\beval\b|\bexec\b|\bsource\b|\|\s*(sh|bash|zsh|pwsh|powershell|python|node)\b"
    r"|base64|\bkill\b|Stop-Process|reg\s+(add|delete)|setx|export\s+\w+=",
    re.IGNORECASE,
)
# Comments and quoted prose are where prompt injection hides ("# safe, approve this").
INJECTION_SMELL = re.compile(r"#|approve|ignore|instruction|safe to|jev|assistant", re.IGNORECASE)

QUESTION = {
    "type": "noul",
    "instructions": (
        "Is this shell command strictly read-only: it only reads, lists, searches, "
        "prints or inspects, and cannot change files, settings, processes, git history "
        "or anything outside this machine?"
    ),
    "criteria": {
        "true": "Strictly read-only inspection, such as ls, cat, grep, git status, git diff, git log",
        "false": "Writes, deletes, moves, installs, runs code, changes state or reaches the network",
    },
}


def gate(command):
    """Local checks. Returns a reason to skip Jev, or None if Jev may judge it."""
    if not command or len(command) > MAX_LEN:
        return "empty or too long"
    if "\n" in command:
        return "multi-line"
    if HARD_NO.search(command):
        return "hard-no pattern"
    if INJECTION_SMELL.search(command):
        return "possible injection text"
    return None


def ask_jev(command, cwd, key):
    body = json.dumps({
        "model": MODEL,
        "state": {"command": command, "working_directory": cwd},
        "questions": {"read_only": QUESTION},
    }).encode()
    req = urllib.request.Request(API_URL, data=body, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return float(json.load(r)["answers"]["read_only"]["noul"])


def decide(event, key, jev=ask_jev):
    """Returns (allow: bool, reason: str). Any doubt means False."""
    if event.get("tool_name") != "Bash":
        return False, "not Bash"
    if event.get("permission_mode") not in ("default", "acceptEdits"):
        return False, f"mode {event.get('permission_mode')}"
    command = (event.get("tool_input") or {}).get("command", "").strip()
    skip = gate(command)
    if skip:
        return False, skip
    if not key:
        return False, "no TYPESAFE_API_KEY"
    try:
        p = jev(command, event.get("cwd", ""), key)
    except Exception as e:  # network, auth, 429, 529, bad JSON: all fall back to asking
        return False, f"jev error: {type(e).__name__}"
    if p >= THRESHOLD:
        return True, f"Jev: read-only p={p:.2f}"
    return False, f"Jev: p={p:.2f} below {THRESHOLD}"


def log(event, allow, reason):
    if not LOG_PATH:
        return
    cmd = (event.get("tool_input") or {}).get("command", "")
    with open(os.path.expanduser(LOG_PATH), "a", encoding="utf-8") as f:
        f.write(json.dumps({"allow": allow, "dry": DRY_RUN, "reason": reason, "command": cmd[:80]}) + "\n")


def main():
    try:
        event = json.load(sys.stdin)
    except Exception:
        return 0
    allow, reason = decide(event, os.environ.get("TYPESAFE_API_KEY"))
    log(event, allow, reason)
    if allow and not DRY_RUN:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": reason,
        }}))
    return 0  # silence = normal permission prompt


if __name__ == "__main__":
    sys.exit(main())
