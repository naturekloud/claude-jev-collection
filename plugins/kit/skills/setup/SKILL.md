---
name: setup
description: Apply the kit's machine-level settings that a plugin cannot ship (status line, env, global CLAUDE.md and rules, jev agents, official plugins) and remove the pre-kit duplicates. Use when the user runs /kit:setup or asks to set up or repair the kit.
disable-model-invocation: true
---

# kit setup

1. Run the dry run and show the user its output as is:

   ```
   python3 "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/kit_setup.py"
   ```

   Lines starting with `*` are changes. It never prints secret values.

2. If there are changes, ask the user whether to apply them. Mention any line that says a file differs and is kept; those need `--force` to be replaced (the old file is backed up first).

3. On yes, run it again with `--apply` (plus `--force` only if the user asked for it) and report the result, including the backup folder.

4. Tell the user the changes take effect in a new session.
