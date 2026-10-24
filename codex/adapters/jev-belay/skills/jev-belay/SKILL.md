---
name: jev-belay
description: Explain or troubleshoot the Codex Jev completion verification hook, including recorded mutations, completed checks, missing evidence and one-block retry behavior.
---

This Codex adapter records UserPromptSubmit and completed PostToolUse evidence
under PLUGIN_DATA or $CODEX_HOME/jev/belay. Stop uses upstream Jev questions and
decisions to block an unverified completion claim once per mutation cycle.
Actual hook execution requires trusted hooks and a TypeSafe key. Missing keys,
missing session/prompt/final-message evidence and API failures fail open.

It does not inspect or modify live transcripts, inherit checks from subagents,
or count arbitrary shell file mutations. A completed named test/build/lint after
the last recorded patch supplies verification; a still-running command does not.
Run meaningful checks and report their actual results. When checks cannot run,
state the reason rather than claiming verification. Source or state inspection
must never reveal API keys or raw private tool results.
