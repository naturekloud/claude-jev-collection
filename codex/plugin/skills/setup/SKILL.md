---
name: setup
description: Install or repair the nine Jev custom agents for the Codex Jev kit after plugin installation.
---

Resolve the plugin root two directories above this skill. Run
`python3 <plugin>/scripts/setup.py` to preview agent installation, then
`python3 <plugin>/scripts/setup.py --apply` when installation is requested.
The script preserves existing differing agents; inspect conflicts before using
`--force`, which backs them up under `$CODEX_HOME/jev/backup/`.
It leaves config.toml, AGENTS.md, permissions and the user's status line intact.
Run `python3 <plugin>/scripts/jev.py preflight --all --json` after setup.
Restart Codex to discover the installed agents. Review and trust plugin hooks
in Codex before relying on them; installation alone does not trust hooks.
External Claude marketplace dependencies are not installed by this setup.
