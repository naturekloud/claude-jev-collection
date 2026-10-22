#!/usr/bin/env bash
# Refresh the copies inside plugins/kit from their sources on this machine.
# Run after updating jev-harness, the guard hooks, the status line or the global rules.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
KIT="$ROOT/plugins/kit"
HARNESS="${JEV_HARNESS:-$HOME/jev-harness}"
CLAUDE="$HOME/.claude"

sync_dir() {  # sync_dir <src dir> <dest dir>
  mkdir -p "$2"
  rsync -a --delete --exclude __pycache__ --exclude '*.pyc' --exclude .git "$1/" "$2/"
}

sync_file() {  # sync_file <src file> <dest file>
  mkdir -p "$(dirname "$2")"
  cp "$1" "$2"
}

# jev-harness: skill (scripts + hooks) and routing config. The scripts resolve config/ four
# levels up from skills/jev-orchestrator/scripts/, which is the plugin root.
sync_dir "$HARNESS/skill/jev-orchestrator" "$KIT/skills/jev-orchestrator"
sync_dir "$HARNESS/config" "$KIT/config"
sed -i 's#~/\.claude/skills/jev-orchestrator/#${CLAUDE_PLUGIN_ROOT}/skills/jev-orchestrator/#g' \
  "$KIT/skills/jev-orchestrator/SKILL.md"
sync_file "$HARNESS/LICENSE" "$KIT/licenses/jev-harness.LICENSE"

# Agents stay in ~/.claude/agents (plugin agents would be renamed kit:jev-*), so ship them as assets.
mkdir -p "$KIT/assets/agents"
rm -f "$KIT/assets/agents/"jev-*.md
cp "$CLAUDE"/agents/jev-*.md "$KIT/assets/agents/"
# ~/.claude/kit/current is a SessionStart-maintained link to the installed plugin root.
sed -i 's#~/\.claude/skills/jev-orchestrator/#~/.claude/kit/current/skills/jev-orchestrator/#g' "$KIT/assets/agents/"jev-*.md

# Guard hooks (MIT, Basma Nageh Abouzied)
for g in jev-secret-guard:jev_secret_guard.py jev-auto-approve:jev_auto_approve.py; do
  dir=${g%%:*} file=${g#*:}
  sync_file "$CLAUDE/hooks/$dir/$file" "$KIT/guards/$dir/$file"
  sync_file "$CLAUDE/hooks/$dir/LICENSE" "$KIT/guards/$dir/LICENSE"
done

# User-level skill, status line, global rules
sync_dir "$CLAUDE/skills/context7-mcp" "$KIT/skills/context7-mcp"
sync_file "$CLAUDE/statusline.sh" "$KIT/assets/statusline.sh"
sync_file "$CLAUDE/CLAUDE.md" "$KIT/assets/CLAUDE.md"
sync_dir "$CLAUDE/rules" "$KIT/assets/rules"

echo "synced into $KIT"
