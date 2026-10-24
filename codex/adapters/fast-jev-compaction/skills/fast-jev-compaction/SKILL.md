---
name: fast-jev-compaction
description: Compact an explicitly exported conversation artifact with the upstream Jev compaction library. Use when asked to prune exported normalized message JSON, not to change the active Codex conversation.
---

Resolve the plugin root two directories above this skill directory.
Run `node <plugin>/scripts/compact.mjs <exported-messages.json>` and save stdout
to a new artifact. Never overwrite the source, active Codex session, or transcript.
Use normalized upstream message JSON: an array of
`{role: "user"|"assistant", text: "...", toolUses: [], toolResults?: []}`;
or `{messages: [...], options: {...}}`. Tool uses/results follow the upstream
types in `<plugin>/src/types.ts`. Do not pass raw Codex session JSONL as this input.

This is explicit export compaction, not automatic native history replacement.
Only send a conversation the user placed in scope; the redacted scoring state
goes to TypeSafe. Retained output stays verbatim and may still contain sensitive
data from the source artifact. Preserve the source and inspect the decisions.
For the current conversation use Codex's native compact command instead.
