---
name: jev-pruner
description: Prune lengthy stdout from explicitly selected noninteractive shell commands using the upstream Codex Jev pruner. Use for noisy builds, tests and searches.
---

Resolve the plugin root three directories above this skill directory.
Run `node <plugin-root>/scripts/run.mjs -- <executable> <args...>` through the
normal shell tool, keeping its workdir, sandbox and approval requirements.
The wrapper loads TYPESAFE_API_KEY or the existing ~/.config/typesafe/.env key,
then runs the upstream Codex wrapper unchanged. Only explicitly wrapped commands
are pruned. The trusted hook normalizes Bash/exec_command to record context.

Use ordinary shell calls for interactive commands, servers, live-progress tasks,
whole-file reads, diffs, structured output, and commands involving secrets.
The wrapper buffers stdout (up to 8 MiB), forwards stderr and preserves exit status.
Only output above 10,000 estimated tokens is eligible. Missing session history,
credentials, API access or scoring results returns the original output.
An omission marker proves pruning happened; inspect its archive pointer to recover
omitted output. Do not claim automatic filtering of every Codex tool result.
