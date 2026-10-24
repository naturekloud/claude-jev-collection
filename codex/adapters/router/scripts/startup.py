"""Ask the first root-session response to open Router; never launch a browser."""
import json
import sys


def startup_context(event):
    if not isinstance(event, dict):
        return {}
    if event.get("hook_event_name") != "SessionStart" or event.get("source") not in ("startup", "clear"):
        return {}
    return {"hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": (
            "Router auto-open is enabled by the user. On the first assistant response "
            "in this new root conversation, call the router MCP tool show_router "
            "(mcp__router__show_router) once to open its panel, then continue the user's task. "
            "Do not reopen it on later turns. If the user asks not to open it, respect that. "
            "If the tool is unavailable, continue the task and briefly report that the "
            "Router panel could not be opened; do not retry on subsequent turns. "
            "Do not launch a browser, classify the user's task, send task text to an API, "
            "or change the conversation model as part of auto-open."
        ),
    }}


if __name__ == "__main__":
    try:
        event = json.load(sys.stdin)
    except (ValueError, OSError):
        event = None
    print(json.dumps(startup_context(event)))
