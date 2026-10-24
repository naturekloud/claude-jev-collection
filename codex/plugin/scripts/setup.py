#!/usr/bin/env python3
"""Install Jev agents without replacing Codex configuration. Dry-run by default."""
import argparse
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
try:
    import tomllib
except ImportError:
    import tomli as tomllib

PLUGIN = Path(__file__).resolve().parents[1]


def install(home, apply=False, force=False):
    changes = []
    for source in sorted((PLUGIN / "agents").glob("*.toml")):
        tomllib.loads(source.read_text())
        target = home / "agents" / source.name
        if target.exists() and target.read_bytes() == source.read_bytes():
            continue
        if target.exists() and not force:
            raise ValueError(f"Existing agent differs: {target}; review it and use --force to back up and replace.")
        changes.append((source, target))
    # Resolve every conflict before writing anything.
    backup = home / "jev/backup" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    for source, target in changes:
        print(("INSTALL " if apply else "WOULD INSTALL ") + str(target))
        if apply:
            if target.exists():
                backup.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, backup / target.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    return len(changes)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    try:
        install(args.home, args.apply, args.force)
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + "\n")
