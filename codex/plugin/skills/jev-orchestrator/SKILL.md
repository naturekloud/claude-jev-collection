---
name: jev-orchestrator
description: Route multipart coding work with Jev, delegate to configured Jev agents, preserve plans and context packs, validate handoffs, and escalate failed tasks. Use when asked for Jev orchestration or delegation; skip trivial single-step work.
---

# Jev for Codex

Resolve the plugin directory from this skill's location (two directories above).
Run `python3 <plugin>/scripts/jev.py <command>`; use Python 3.11+ or Python
3.9/3.10 with `tomli` installed.
State and logs go to `$CODEX_HOME/jev` (default `~/.codex/jev`),
and project artifacts go to `.jev/`. `JEV_HOME` and `JEV_CONFIG` override these.

1. Run `preflight --all --json`. If an agent is missing or differs from routing,
   run the setup skill; do not silently substitute a role. File checks cannot
   prove live registration. Restart Codex after installing agents.
2. Split independent work, then `dedupe "<task>"` and
   `route "<task>" --task-id T --files path1,path2`. Routing calls TypeSafe
   using `TYPESAFE_API_KEY` or `~/.config/typesafe/.env`; never print credentials.
   Only send task details the user authorized sharing with that service.
   On API failure, disclose it and use the returned fallback guidance.
3. Follow `sequence` and `next_agent`. Use Codex `spawn_agent` with the custom
   `agent_type` set to the returned `jev-*` role. Include `[jev:task=T]`, the task,
   acceptance criteria, and relevant files in the prompt. Let the agent TOML
   pin model and effort. Do not use Claude's `subagent_type`, Workflow tool,
   model aliases, or Claude plugin commands.
4. For `planned` work, ask the architect for a plan, then persist it with
   `plan save --task T --from-file FILE` before dispatching the implementer.
   For `workflow` routes, translate the proposed sequence into Codex subagents;
   there is no dependency on a separate workflow-authoring skill.
5. Run `context prepare --task-id T --role jev-builder --task "<task>"` and
   pass the returned context block or pack path. If graph tooling is unavailable,
   disclose the fallback and provide a targeted file list.
6. Keep writers sequential on overlapping files. Review substantial changes
   with `jev-reviewer`; use `jev-qa` when runnable UI needs verification.
   Validate JSON handoffs with `handoff validate --kind completion FILE`
   (also supports plan, failure, review, qa). YAML requires optional PyYAML.
7. On BLOCKED, run `escalate --task T --from jev-builder --category CATEGORY`
   with the evidence. Follow the returned role or stopping condition.
   Finish with relevant real checks, then `done <ledger-id>`.

The dispatch hook validates registered Jev roles, model/effort and task routes.
Codex sandbox and approval policies still apply. Hook errors can fail open;
hooks do not replace the sandbox. `outcomes` is unavailable because it parses
Claude transcripts. `report`, `label`, plans, packs and handoffs are supported.
