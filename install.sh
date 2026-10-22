#!/usr/bin/env bash
# One-shot install on a new machine: register the dependency marketplaces, install kit@claude-jev-collection
# (which pulls in its 8 dependency plugins), then run the setup plan and ask before applying it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
MARKETPLACES=(
  typesafe-ai/skills
  alexei-led/claude-router
  valentynkit/jev-belay
  tamaratran/jev-pruner
  tamaratran/fast-jev-compaction
  EliaAlberti/jev-rules
  leepokai/jev-guard
  forrestchang/andrej-karpathy-skills
)

command -v claude >/dev/null || { echo "claude CLI가 없습니다"; exit 1; }
command -v python3 >/dev/null || { echo "python3가 없습니다"; exit 1; }

for m in "${MARKETPLACES[@]}"; do
  claude plugin marketplace add "$m" || echo "  (건너뜀: $m, 이미 있거나 추가 실패)"
done
claude plugin marketplace add "$ROOT" || echo "  (건너뜀: claude-jev-collection, 이미 있음)"
claude plugin install kit@claude-jev-collection

SETUP="$ROOT/plugins/kit/skills/setup/scripts/kit_setup.py"
python3 "$SETUP"
read -r -p "위 변경을 적용할까요? [y/N] " yn
case "$yn" in
  [yY]*) python3 "$SETUP" --apply ;;
  *) echo "적용하지 않았습니다. 나중에 Claude Code에서 /kit:setup 으로 적용할 수 있습니다." ;;
esac
