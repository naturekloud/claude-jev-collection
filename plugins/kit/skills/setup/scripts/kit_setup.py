#!/usr/bin/env python3
"""Apply the parts of the kit a plugin cannot ship: status line, env, global rules, jev agents,
official plugins, the skillpick clone, and removal of the pre-kit copies that would otherwise run twice.

Dry run by default: prints the plan. --apply makes the changes (backups go to ~/.claude/kit/backup/<time>/).
--force also overwrites files that already exist but differ from the kit (CLAUDE.md, rules, agents, statusline.sh).
Never prints secret values.
"""
import argparse
import filecmp
import json
import os
import shutil
import subprocess
import sys
import time

KIT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))))
ASSETS = os.path.join(KIT, "assets")
CLAUDE = os.path.expanduser("~/.claude")
SETTINGS = os.path.join(CLAUDE, "settings.json")
INSTALLED = os.path.join(CLAUDE, "plugins", "installed_plugins.json")
BACKUP = os.path.join(CLAUDE, "kit", "backup", time.strftime("%Y%m%d-%H%M%S"))

ENV = {"JEV_SECRET_ASK": "0.5", "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"}
STATUS_LINE = {"type": "command", "command": "~/.claude/statusline.sh"}
OFFICIAL = ["context7", "frontend-design", "claude-md-management"]
# settings.json hook commands the kit's hooks/hooks.json now provides
LEGACY_HOOKS = ["jev-orchestrator/hooks/", "jev-secret-guard/jev_secret_guard.py", "jev-auto-approve/jev_auto_approve.py",
                "skillpick/src/cli.ts"]
SKILLPICK_REPO = "https://github.com/govindup63/skillpick.git"
SKILLPICK = os.environ.get("SKILLPICK_HOME") or os.path.expanduser("~/skillpick")
# same search order as hooks/skillpick-hook.sh
BUN_CANDIDATES = ["~/.bun/bin/bun", "/home/linuxbrew/.linuxbrew/bin/bun", "/opt/homebrew/bin/bun", "/usr/local/bin/bun"]
# user-level skills the kit now ships as kit:<name>
LEGACY_SKILLS = ["jev-orchestrator", "context7-mcp"]
# agents point at the skill through the link the SessionStart hook keeps (sync.sh rewrites them)
OLD_SKILL_PATH = "~/.claude/skills/jev-orchestrator/"
NEW_SKILL_PATH = "~/.claude/kit/current/skills/jev-orchestrator/"


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def backup(path):
    if not os.path.lexists(path):
        return
    dest = os.path.join(BACKUP, os.path.relpath(path, CLAUDE))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(path, dest)


def file_plan(src, dst, force, kit_installed):
    """('copy'|'replace'|None, note) for one asset file."""
    if not os.path.exists(dst):
        return "copy", "없음 → 복사"
    if filecmp.cmp(src, dst, shallow=False):
        return None, "같음"
    with open(src, encoding="utf-8") as a, open(dst, encoding="utf-8") as b:
        if a.read() == b.read().replace(OLD_SKILL_PATH, NEW_SKILL_PATH):
            # the new path only exists once the kit's SessionStart hook has run
            if kit_installed:
                return "replace", "스킬 경로만 다름 → 백업 후 교체"
            return None, "스킬 경로만 다름 → kit 설치 후 교체"
    return ("replace", "다름 → 백업 후 교체") if force else (None, "다름 → 유지 (--force로 교체)")


FAILED = []


def run(cmd):
    """Run a command; False (with the reason printed) when it is missing or fails."""
    try:
        if subprocess.run(cmd, check=False).returncode == 0:
            return True
        print(f"    실패: {' '.join(cmd[:3])}")
    except OSError as e:
        print(f"    실행 불가: {cmd[0]} ({type(e).__name__})")
    FAILED.append(" ".join(c for c in cmd[:4] if not c.startswith("-")))
    return False


def file_actions(force, kit_installed):
    pairs = [(os.path.join(ASSETS, "statusline.sh"), os.path.join(CLAUDE, "statusline.sh")),
             (os.path.join(ASSETS, "CLAUDE.md"), os.path.join(CLAUDE, "CLAUDE.md"))]
    for sub in ("rules", "agents"):
        for name in sorted(os.listdir(os.path.join(ASSETS, sub))):
            pairs.append((os.path.join(ASSETS, sub, name), os.path.join(CLAUDE, sub, name)))
    out = []
    for src, dst in pairs:
        kind, note = file_plan(src, dst, force, kit_installed)
        out.append((kind, src, dst, note))
    return out


def strip_legacy_hooks(hooks):
    """Returns (new hooks dict, removed commands)."""
    removed, new = [], {}
    for event, groups in (hooks or {}).items():
        kept_groups = []
        for g in groups:
            kept = []
            for h in g.get("hooks", []):
                cmd = h.get("command", "")
                if any(p in cmd for p in LEGACY_HOOKS):
                    removed.append(f"{event}: {cmd}")
                else:
                    kept.append(h)
            if kept:
                kept_groups.append(dict(g, hooks=kept))
        if kept_groups:
            new[event] = kept_groups
    return new, removed


def installed_ids():
    data = load_json(INSTALLED, {})
    return set((data.get("plugins") or {}).keys())


def api_key_present():
    if os.environ.get("TYPESAFE_API_KEY"):
        return True
    env_file = os.path.expanduser("~/.config/typesafe/.env")
    try:
        with open(env_file, encoding="utf-8") as f:
            return any(line.strip().startswith("TYPESAFE_API_KEY=") for line in f)
    except OSError:
        return False


def find_bun():
    for b in [shutil.which("bun")] + [os.path.expanduser(c) for c in BUN_CANDIDATES]:
        if b and os.access(b, os.X_OK):
            return b
    return None


def skillpick_plan(apply):
    """Clone skillpick and install its packages when missing. Returns the number of changes."""
    short = SKILLPICK.replace(os.path.expanduser("~"), "~")
    bun = find_bun()
    steps = []
    if not os.path.exists(os.path.join(SKILLPICK, "src", "cli.ts")):
        steps.append(("git clone", ["git", "clone", "-q", SKILLPICK_REPO, SKILLPICK]))
    if steps or not os.path.isdir(os.path.join(SKILLPICK, "node_modules")):
        steps.append(("bun install", [bun or "bun", "install", "--cwd", SKILLPICK]))
    if not steps:
        print(f"    {short}: 설치됨")
    for label, cmd in steps:
        print(f"  * {short}: {label}")
        if apply:
            if cmd[0] == "bun" and not bun:
                print("    bun이 없어 건너뜀 → https://bun.sh 설치 후 /kit:setup 다시 실행")
                break
            if not run(cmd):
                break
    if not bun:
        print("    bun: 없음 → 설치 전까지 skillpick 훅은 아무것도 하지 않음")
    key_file = os.path.expanduser("~/.config/skillpick/config.json")
    if not (os.environ.get("TYPESAFE_API_KEY") or os.path.exists(key_file)):
        print("    skillpick 키: 없음 → TYPESAFE_API_KEY를 셸에 두거나 skillpick set-key 실행")
    return len(steps)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--apply", action="store_true", help="실제로 반영 (기본은 계획만 출력)")
    ap.add_argument("--force", action="store_true", help="내용이 다른 기존 파일도 백업 후 교체")
    args = ap.parse_args()

    settings = load_json(SETTINGS, {})
    ids = installed_ids()
    kit_installed = any(i.startswith("kit@") for i in ids)
    changes = 0
    print(f"kit: {KIT}")
    print("모드: " + ("적용" if args.apply else "드라이런 (--apply로 적용)"))

    print("\n[파일]")
    for kind, src, dst, note in file_actions(args.force, kit_installed):
        print(f"  {'*' if kind else ' '} {dst.replace(os.path.expanduser('~'), '~')}: {note}")
        if kind and args.apply:
            if kind == "replace":
                backup(dst)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
        changes += bool(kind)

    print("\n[settings.json]")
    new = json.loads(json.dumps(settings))
    if new.get("statusLine") != STATUS_LINE:
        print(f"  * statusLine → {STATUS_LINE['command']}")
        new["statusLine"] = STATUS_LINE
    env = new.setdefault("env", {})
    for k, v in ENV.items():
        if k not in env:
            print(f"  * env.{k} 추가")
            env[k] = v
        elif env[k] != v:
            print(f"    env.{k}: 기존 값 유지 (kit 기본값과 다름)")
    if kit_installed:
        new["hooks"], removed = strip_legacy_hooks(new.get("hooks"))
        for r in removed:
            print(f"  * 중복 훅 제거: {r}")
    else:
        print("    kit 플러그인이 아직 설치되지 않아 기존 훅은 그대로 둡니다")
    if not new.get("hooks"):
        new.pop("hooks", None)
    if new != settings:
        changes += 1
        if args.apply:
            if os.path.exists(SETTINGS):
                os.makedirs(BACKUP, exist_ok=True)
                shutil.copy2(SETTINGS, os.path.join(BACKUP, "settings.json"))
            with open(SETTINGS, "w", encoding="utf-8") as f:
                json.dump(new, f, indent=2, ensure_ascii=False)
                f.write("\n")

    print("\n[중복 스킬]")
    for name in LEGACY_SKILLS:
        path = os.path.join(CLAUDE, "skills", name)
        if not os.path.lexists(path):
            continue
        if not kit_installed:
            print(f"    ~/.claude/skills/{name}: kit 설치 전이라 유지")
            continue
        print(f"  * ~/.claude/skills/{name}: kit:{name}와 중복 → 백업 폴더로 이동")
        changes += 1
        if args.apply:
            backup(path)

    print("\n[공식 플러그인]")
    for name in OFFICIAL:
        if any(i.split("@")[0] == name for i in ids):
            print(f"    {name}: 설치됨")
            continue
        print(f"  * {name}: claude plugin install {name}@claude-plugins-official")
        changes += 1
        if args.apply:
            run(["claude", "plugin", "install", f"{name}@claude-plugins-official"])

    print("\n[skillpick]")
    changes += skillpick_plan(args.apply)

    print("\n[확인]")
    print("    TYPESAFE_API_KEY: " + ("있음" if api_key_present() else "없음 → ~/.config/typesafe/.env 또는 셸 환경에 설정"))
    print(f"    ~/.claude/kit/current: {'있음' if os.path.exists(os.path.join(CLAUDE, 'kit', 'current')) else '다음 세션 시작 때 생성'}")

    if args.apply and changes:
        if FAILED:
            print(f"\n실패 {len(FAILED)}건: {', '.join(FAILED)} (원인은 위 메시지 참고, 해결 후 다시 실행)")
        print(f"\n적용 끝. 백업: {BACKUP.replace(os.path.expanduser('~'), '~')} (변경 전 파일이 있을 때만 생성)")
        print("새 세션부터 반영됩니다.")
    elif changes:
        print(f"\n변경 {changes}건 예정. 적용하려면 --apply")
    else:
        print("\n변경 없음")
    return 0


if __name__ == "__main__":
    sys.exit(main())
