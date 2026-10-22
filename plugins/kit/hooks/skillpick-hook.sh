#!/bin/sh
# UserPromptSubmit: run skillpick from its own clone (SKILLPICK_HOME, default ~/skillpick).
# Finds bun at run time so a bun upgrade does not break the hook. No-op when either is missing.
dir="${SKILLPICK_HOME:-$HOME/skillpick}"
[ -f "$dir/src/cli.ts" ] || exit 0
for b in "$(command -v bun 2>/dev/null)" "$HOME/.bun/bin/bun" /home/linuxbrew/.linuxbrew/bin/bun /opt/homebrew/bin/bun /usr/local/bin/bun; do
  [ -n "$b" ] && [ -x "$b" ] && exec "$b" run "$dir/src/cli.ts" hook --agent claude
done
exit 0
