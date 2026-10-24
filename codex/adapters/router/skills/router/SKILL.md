---
name: router
description: Open the interactive Codex Router panel to classify tasks, inspect model recommendations, edit routing mappings and view recent results.
---

Resolve the plugin root two directories above this skill directory.
When invoked without a task, or asked for the UI, call the router MCP tool
`show_router` to render its interactive MCP App. Do not substitute a text-only
classification for opening the panel. If the tool is unavailable, explain that
Codex must reload the newly installed plugin, and offer the local panel fallback:
`node <plugin>/scripts/preview.mjs`. Open the printed loopback URL using the
available browser when requested. The preview must stay running while in use.

When forwarding `show_router` through a tool wrapper, preserve its complete
CallToolResult envelope, including `_meta` and `structuredContent`. Printing only
the text content loses the resource metadata needed by the embedded renderer.
The result requests rendering; it does not prove the panel is visible. An already
running MCP server may still use the previous plugin version until Codex reloads.

The panel has task classification, four editable difficulty mappings and local
metadata-only history. Settings also apply to the CLI. Never claim the embedded
UI is visible unless the host actually renders it. Hosts without MCP Apps support
can use the same functional UI through the loopback preview.

Run `node <plugin>/scripts/route.mjs "<task>"` for an explicit routing recommendation.
The bounded, redacted task is sent to TypeSafe using TYPESAFE_API_KEY or the
existing ~/.config/typesafe/.env key. Never print the key.
For GUI-launched MCP sessions, the launcher first uses inherited credentials or
the existing TypeSafe file. If absent, it reads only the two supported key names
from a bounded interactive login zsh/bash process. Shell startup output and keys
are captured internally, never printed or saved. Shell startup failures retain
the normal missing-key behavior. Reload the plugin after launcher updates.

This adapter uses upstream classifier questions and parsing. It does not switch
the main conversation model, install Claude function hooks, or spawn an agent.
For actual execution use jev-kit routing with its preflight and escalation rules,
or let the user select the suggested model. Report unavailable/uncertain results.
