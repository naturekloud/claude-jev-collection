#!/usr/bin/env python3
"""Claude Code PreToolUse hook: stops secrets before they are written, committed or sent.

Three layers:
  1. Known key formats (GitHub, AWS, OpenAI, Anthropic, Stripe...) -> blocked locally, no API call.
  2. Unknown high-entropy strings -> Jev judges a MASKED version (the secret never leaves your machine).
  3. Jev unsure, slow or down -> you get asked. A guard fails toward a human, never toward silence.
"""
import json
import math
import os
import re
import sys
import urllib.request

API_URL = "https://api.typesafe.ai/v1/systemone"
MODEL = os.environ.get("JEV_MODEL", "jev-latest")
BLOCK_AT = float(os.environ.get("JEV_SECRET_BLOCK", "0.80"))
ASK_AT = float(os.environ.get("JEV_SECRET_ASK", "0.30"))
TIMEOUT_S = float(os.environ.get("JEV_SECRET_TIMEOUT", "3"))

KNOWN = [
    ("GitHub token", r"\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})"),
    ("AWS access key", r"\b(AKIA|ASIA)[A-Z0-9]{16}\b"),
    ("Anthropic key", r"\bsk-ant-[A-Za-z0-9_\-]{20,}"),
    ("OpenAI key", r"\bsk-(proj-)?[A-Za-z0-9_\-]{32,}"),
    ("Stripe live key", r"\b[rs]k_live_[A-Za-z0-9]{20,}"),
    ("Slack token", r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"),
    ("Google API key", r"\bAIza[A-Za-z0-9_\-]{35}\b"),
    ("Private key", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
]
KNOWN = [(n, re.compile(p)) for n, p in KNOWN]

TOKEN = re.compile(r"[A-Za-z0-9_\-+/.]{20,}={0,2}")  # "=" only as base64 padding, so KEY=value splits
PLACEHOLDER = re.compile(r"your|example|sample|dummy|placeholder|changeme|xxxx|<|>|\*\*\*|test|fake|redacted", re.I)
LOOKS_LIKE_PATH_OR_HASH = re.compile(r"^[a-f0-9]{40}$|^[a-f0-9]{64}$|/|\\|\.(py|js|ts|md|json|png|html)$", re.I)
# One word of a code identifier: ACRONYM, Word or word, then at most a 2-digit suffix (V1, Scheduler2)
IDENT_PART = re.compile(r"(?:[A-Z]{2,}(?=[A-Z][a-z]|[^A-Za-z]|$)|[A-Z]?[a-z]{2,}|[A-Za-z](?=[0-9]))[0-9]{0,2}")
CRED_WORD = re.compile(r"passw|pwd|secret|token|api[_\-]?key|auth|credential|bearer|private", re.I)

QUESTION = {
    "type": "noul",
    "instructions": (
        "The string shown as MASKED is hidden for safety; you see its shape and the text around it. "
        "Is it most likely a real credential (API key, token, password, secret) rather than "
        "a placeholder, hash, ID, file path or ordinary text?"
    ),
    "criteria": {
        "true": "A real secret credential that should not be written, committed or sent",
        "false": "A placeholder, commit hash, UUID, ID, path, or harmless text",
    },
}


def entropy(s):
    return -sum(s.count(c) / len(s) * math.log2(s.count(c) / len(s)) for c in set(s))


def mask(tok):
    kinds = "".join(k for k, test in (("a", str.islower), ("A", str.isupper), ("9", str.isdigit)) if any(map(test, tok)))
    return f"{tok[:3]}…MASKED({len(tok)} chars, charset {kinds or 'symbols'})"


def looks_like_identifier(tok):
    """METADATA_SCHEMA_V1_Channel, AbstractJobScheduler2Impl: words, digits only as a short suffix
    followed by a separator or a Capitalized word. Random keys break into scraps and fail this."""
    count = 0
    for chunk in re.split(r"[_\-.]", tok):
        parts = IDENT_PART.findall(chunk)
        if "".join(parts) != chunk:
            return False
        for prev, part in zip(parts, parts[1:]):
            if part[0].islower() or (prev[-1].isdigit() and not part[1:2].islower()):
                return False
        count += len(parts)
    return count >= 2 and len(tok) / count >= 4


def line_of(text, m):
    line_start = text.rfind("\n", 0, m.start()) + 1
    line_end = text.find("\n", m.end())
    return text[line_start: line_end if line_end != -1 else len(text)]


def candidates(text):
    """High-entropy tokens that are not obvious placeholders, hashes, paths or code identifiers."""
    out = []
    for m in TOKEN.finditer(text):
        tok = m.group()
        if PLACEHOLDER.search(tok) or LOOKS_LIKE_PATH_OR_HASH.search(tok):
            continue
        # a word-shaped passphrase still gets checked when the line talks about credentials
        if looks_like_identifier(tok) and not CRED_WORD.search(line_of(text, m).replace(tok, "")):
            continue
        if entropy(tok) >= 3.8 and any(c.isdigit() for c in tok) and any(c.isalpha() for c in tok):
            out.append(m)
    return out


def masked_context(text, m):
    return line_of(text, m).replace(m.group(), mask(m.group()))[:300]


def ask_jev(context, key):
    body = json.dumps({"model": MODEL, "state": {"text": context}, "questions": {"secret": QUESTION}}).encode()
    req = urllib.request.Request(API_URL, data=body, headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return float(json.load(r)["answers"]["secret"]["noul"])


def outgoing_text(event):
    tool, inp = event.get("tool_name"), event.get("tool_input") or {}
    if tool == "Write":
        return inp.get("content", "")
    if tool == "Edit":
        return inp.get("new_string", "")
    if tool == "Bash":
        return inp.get("command", "")
    return ""


def decide(event, key, jev=ask_jev):
    """Returns (decision, reason). decision is 'deny', 'ask' or None (no opinion)."""
    text = outgoing_text(event)
    if not text:
        return None, "nothing to check"
    for name, rx in KNOWN:
        for m in rx.finditer(text):
            tok = m.group()
            if name != "Private key" and (PLACEHOLDER.search(tok) or entropy(tok) < 3.0):
                continue  # sk-xxxx..., AKIAEXAMPLE... and friends
            return "deny", f"Blocked: looks like a {name}. Use an environment variable instead."
    worst = None
    for m in candidates(text)[:5]:
        ctx = masked_context(text, m)
        if not key:
            return "ask", f"Possible secret ({mask(m.group())}) and no Jev key to judge it"
        try:
            p = jev(ctx, key)
        except Exception as e:
            return "ask", f"Possible secret ({mask(m.group())}); Jev unavailable ({type(e).__name__})"
        if p >= BLOCK_AT:
            return "deny", f"Blocked: Jev rates {mask(m.group())} as a real secret (p={p:.2f})"
        if p >= ASK_AT and (worst is None or p > worst[0]):
            worst = (p, m.group())
    if worst:
        return "ask", f"Possible secret {mask(worst[1])} (Jev p={worst[0]:.2f}). Check before continuing."
    return None, "clean"


def main():
    try:
        event = json.load(sys.stdin)
    except Exception:
        return 0
    decision, reason = decide(event, os.environ.get("TYPESAFE_API_KEY"))
    if decision:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
