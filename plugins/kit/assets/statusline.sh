#!/usr/bin/env bash
input=$(cat)

IFS=$'\t' read -r model effort dir ctx h5 d7 h5r d7r < <(printf '%s' "$input" | python3 -c '
import json, sys, time
from datetime import datetime
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
def g(*path):
    v = d
    for p in path:
        if not isinstance(v, dict) or v.get(p) is None:
            return ""
        v = v[p]
    return str(v)
def pct(*path):
    v = g(*path)
    try:
        return str(round(float(v)))
    except ValueError:
        return ""
def left(*path):
    v = g(*path)
    if not v:
        return ""
    try:
        t = float(v)
    except ValueError:
        try:
            t = datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return ""
    if t > 1e12:
        t /= 1000
    s = int(t - time.time())
    if s <= 0:
        return ""
    d, s = divmod(s, 86400)
    h, s = divmod(s, 3600)
    m = s // 60
    if d:
        return f"{d}d{h}h"
    if h:
        return f"{h}h{m}m"
    return f"{m}m"
print("\t".join([
    g("model", "display_name") or "-",
    g("effort", "level") or "-",
    g("workspace", "current_dir") or g("cwd") or "-",
    pct("context_window", "used_percentage") or "-",
    pct("rate_limits", "five_hour", "used_percentage") or "-",
    pct("rate_limits", "seven_day", "used_percentage") or "-",
    left("rate_limits", "five_hour", "resets_at") or "-",
    left("rate_limits", "seven_day", "resets_at") or "-",
]))
')
for v in model effort dir ctx h5 d7 h5r d7r; do [ "${!v}" = "-" ] && printf -v "$v" ''; done

short="$dir"
case "$dir" in
  "$HOME") short="~" ;;
  "$HOME"/*) short="~${dir#"$HOME"}" ;;
esac

branch=""
if [ -n "$dir" ] && [ -d "$dir" ]; then
  branch=$(git --no-optional-locks -C "$dir" symbolic-ref --quiet --short HEAD 2>/dev/null \
    || git --no-optional-locks -C "$dir" rev-parse --short HEAD 2>/dev/null)
fi

color() {
  local label=$1 v=$2 r=$3 c
  if   [ "$v" -lt 25 ]; then c='\033[92m'        # bright green
  elif [ "$v" -lt 50 ]; then c='\033[93m'        # bright yellow
  elif [ "$v" -lt 75 ]; then c='\033[38;5;214m'  # bright orange
  else                       c='\033[91m'        # bright red
  fi
  [ -n "$r" ] && r="\033[90m($r)\033[0m$c"   # dark gray
  printf '%b%s %s%%%b used\033[0m' "$c" "$label" "$v" "$r"
}

case "${model,,}" in
  *opus*)   mc='\033[38;5;183m' ;;  # light purple
  *sonnet*) mc='\033[38;5;216m' ;;  # light orange
  *haiku*)  mc='\033[38;5;117m' ;;  # sky blue
  *)        mc='' ;;
esac
out="$model"
[ -n "$effort" ] && out="$out $effort"
[ -n "$mc" ] && out="$mc$out\033[0m"
name="$short"
[[ "$short" == */* && "$short" != "/" ]] && name="${short##*/}"
loc=""
[ -n "$name" ] && loc="\033[97m$name\033[0m"
[ -n "$branch" ] && loc="$loc \033[94m($branch)\033[0m"
[ -n "$loc" ] && out="$out | $loc"
[ -n "$ctx" ] && out="$out | $(color context "$ctx")"
[ -n "$h5" ] && out="$out | $(color 5h "$h5" "$h5r")"
[ -n "$d7" ] && out="$out | $(color 7d "$d7" "$d7r")"
printf '%b\n' "$out"
