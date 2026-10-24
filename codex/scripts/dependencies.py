#!/usr/bin/env python3
"""Prepare pinned, self-contained Codex dependency packages; installation is opt-in."""
import argparse
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "dependencies.json"
DEFAULT_CACHE = Path.home() / ".claude/plugins/cache"
FORBIDDEN = {".git", "node_modules", ".env", ".DS_Store", "__pycache__"}


def registry():
    return json.loads(REGISTRY.read_text())["dependencies"]


def package_version(spec):
    return spec["version"] + "-codex." + str(spec.get("codex_revision", 1))


def select(names=None):
    specs = registry()
    if not names:
        return specs
    found = [s for s in specs if s["name"] in names or s["codex_name"] in names]
    missing = set(names) - {v for s in found for v in (s["name"], s["codex_name"])}
    if missing:
        raise ValueError("Unknown dependencies: " + ", ".join(sorted(missing)))
    return found


def resolve_source(spec, sources=None, cache=None, fetch=False):
    sources = sources or {}
    explicit = sources.get(spec["name"], sources.get(spec["codex_name"]))
    source = Path(explicit) if explicit else Path(cache or DEFAULT_CACHE) / spec["marketplace"] / spec["name"] / spec["version"]
    if not source.is_dir() and fetch and not explicit:
        commit = spec.get("commit", "")
        if len(commit) != 40 or any(c not in "0123456789abcdef" for c in commit.lower()):
            raise ValueError("Fetch requires a pinned commit: " + spec["name"])
        source = ROOT / ".sources" / spec["name"]
        if not source.exists():
            source.parent.mkdir(parents=True, exist_ok=True)
            repo = spec["repo"]
            if ":" not in repo:
                repo = "https://github.com/" + repo + ".git"
            subprocess.run(["git", "clone", "--no-checkout", repo, str(source)], check=True)
        subprocess.run(["git", "-C", str(source), "checkout", "--detach", commit], check=True)
        source = source / spec.get("subdir", ".")
    if source.is_symlink():
        raise ValueError("Source directory must not be a symlink: " + str(source))
    if not source.is_dir():
        raise ValueError("Missing source for " + spec["name"] + ": " + str(source))
    manifests = [source / p for p in (".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json")]
    manifest = next((p for p in manifests if p.is_file()), None)
    if not manifest or manifest.is_symlink() or manifest.parent.is_symlink() or json.loads(manifest.read_text()).get("version") != spec["version"]:
        raise ValueError("Source manifest version mismatch: " + spec["name"])
    return source


def safe_relative(value):
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or any(p in FORBIDDEN or p.startswith(".env") for p in path.parts):
        raise ValueError("Unsafe package path: " + str(value))
    return path


def copy_clean(source, destination):
    if source.is_symlink():
        raise ValueError("Symlinks are not package resources: " + str(source))
    if source.is_dir():
        destination.mkdir(parents=True, exist_ok=True)
        for child in source.iterdir():
            if child.name not in FORBIDDEN and not child.name.startswith(".env"):
                copy_clean(child, destination / child.name)
    elif source.is_file():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    else:
        raise ValueError("Missing package resource: " + str(source))


def build_typescript(package, source):
    modules = source / "node_modules"
    linked = False
    if (modules / "typescript/bin/tsc").is_file():
        (package / "node_modules").symlink_to(modules, target_is_directory=True)
        linked = True
    else:
        subprocess.run(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=package, check=True)
    try:
        subprocess.run(["node", str(package / "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], cwd=package, check=True)
    finally:
        if linked:
            (package / "node_modules").unlink()
        elif (package / "node_modules").exists():
            shutil.rmtree(package / "node_modules")


def validate_package(package, spec):
    manifest = json.loads((package / ".codex-plugin/plugin.json").read_text())
    if manifest.get("name") != spec["codex_name"] or manifest.get("version") != package_version(spec):
        raise ValueError("Codex manifest identity mismatch: " + spec["name"])
    for key in ("skills", "hooks", "mcpServers"):
        if key in manifest:
            value = manifest[key]
            if not isinstance(value, str) or not (package / safe_relative(value)).exists():
                raise ValueError("Missing Codex " + key + ": " + spec["name"])
    if "mcpServers" in manifest:
        servers = json.loads((package / manifest["mcpServers"]).read_text())["mcpServers"]
        for server in servers.values():
            for argument in server.get("args", []):
                if argument.startswith("./") and not (package / safe_relative(argument)).is_file():
                    raise ValueError("Missing MCP runtime: " + argument)
        for resource in ("ui/panel.html", "ui/app.js"):
            if spec["name"] == "router" and not (package / resource).is_file():
                raise ValueError("Missing router UI resource: " + resource)
    if "hooks" in manifest:
        hook_config = json.loads((package / manifest["hooks"]).read_text())
        def validate_commands(value):
            if isinstance(value, dict):
                if isinstance(value.get("command"), str):
                    for reference in re.findall(r'\$\{(?:CODEX_)?PLUGIN_ROOT\}/([^\s"\x27]+)', value["command"]):
                        if not (package / safe_relative(reference)).is_file():
                            raise ValueError("Missing hook runtime: " + reference)
                for item in value.values():
                    validate_commands(item)
            elif isinstance(value, list):
                for item in value:
                    validate_commands(item)
        validate_commands(hook_config)
    if spec["name"] in ("fast-jev-output", "fast-jev-compaction") and not (package / "dist").is_dir():
        raise ValueError("Missing runtime dist; use --build-runtime: " + spec["name"])


def prepare(names=None, out=ROOT / "dist", sources=None, cache=None, build_runtime=False, fetch=False):
    specs = select(names)
    resolved = [(s, resolve_source(s, sources, cache, fetch)) for s in specs]
    out = Path(out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="jev-dependencies-", dir=out.parent) as temporary:
        stage = Path(temporary)
        for spec, source in resolved:
            package = stage / "plugins" / spec["codex_name"]
            package.mkdir(parents=True)
            for item in spec["include"]:
                relative = safe_relative(item)
                # Reject symlink ancestors as well as the selected resource itself.
                current = source
                for part in relative.parts:
                    current = current / part
                    if current.is_symlink():
                        raise ValueError("Symlink source resource: " + str(current))
                copy_clean(source / relative, package / relative)
            overlay = ROOT / "adapters" / spec["name"]
            if overlay.is_dir():
                copy_clean(overlay, package)
                if (overlay / "scripts").is_dir():
                    copy_clean(ROOT / "adapters/shared.mjs", package / "scripts/shared.mjs")
            manifest_path = package / ".codex-plugin/plugin.json"
            if not manifest_path.exists():
                manifest = {"name": spec["codex_name"], "version": package_version(spec), "description": spec["notes"]}
                if (package / "skills").is_dir():
                    manifest["skills"] = "./skills"
                if (package / "hooks/hooks.json").is_file():
                    manifest["hooks"] = "./hooks/hooks.json"
                manifest_path.parent.mkdir(parents=True, exist_ok=True)
                manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
            manifest = json.loads(manifest_path.read_text())
            manifest["version"] = package_version(spec)
            manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
            if build_runtime and (package / "tsconfig.json").is_file():
                build_typescript(package, source)
            validate_package(package, spec)
            provenance = {k: spec.get(k) for k in ("name", "codex_name", "version", "repo", "commit", "subdir", "mode", "notes")}
            # Installed Claude caches do not carry Git metadata. A version match
            # must not be presented as proof of the registry's expected commit.
            provenance["source_verification"] = "manifest-version"
            provenance["verified_commit"] = None
            git_root = source if (source / ".git").exists() else ROOT / ".sources" / spec["name"]
            if (git_root / ".git").exists() and source.resolve().is_relative_to(git_root.resolve()):
                git = subprocess.run(["git", "-C", str(git_root), "rev-parse", "HEAD"], capture_output=True, text=True)
                if git.returncode == 0:
                    provenance["verified_commit"] = git.stdout.strip()
                    provenance["source_verification"] = "git-head-and-manifest-version"
                    status = subprocess.run(["git", "-C", str(git_root), "status", "--porcelain"], capture_output=True, text=True)
                    provenance["git_dirty"] = bool(status.stdout.strip()) if status.returncode == 0 else None
            (package / "PROVENANCE.json").write_text(json.dumps(provenance, indent=2) + "\n")
        catalog_path = out / ".agents/plugins/marketplace.json"
        catalog = json.loads(catalog_path.read_text()) if catalog_path.exists() else {"name": "codex-jev-collection", "plugins": []}
        replacements = {s["codex_name"] for s in specs}
        catalog["plugins"] = [p for p in catalog["plugins"] if p["name"] not in replacements]
        for spec in specs:
            name = spec["codex_name"]
            catalog["plugins"].append({"name": name, "source": {"source": "local", "path": "./plugins/" + name}, "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}})
        # All source and manifest validation completes before any published file changes.
        for spec in specs:
            target = out / "plugins" / spec["codex_name"]
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                shutil.rmtree(target)
            shutil.move(str(stage / "plugins" / spec["codex_name"]), target)
        catalog_path.parent.mkdir(parents=True, exist_ok=True)
        catalog_path.write_text(json.dumps(catalog, indent=2) + "\n")
    return specs


def install(names=None, out=ROOT / "dist", apply=False):
    specs = select(names)
    out = Path(out).resolve()
    catalog = json.loads((out / ".agents/plugins/marketplace.json").read_text())
    available = {p["name"] for p in catalog["plugins"]}
    for spec in specs:
        if spec["codex_name"] not in available:
            raise ValueError("Prepare package first: " + spec["name"])
        validate_package(out / "plugins" / spec["codex_name"], spec)
    commands = [["codex", "plugin", "marketplace", "add", str(out)]]
    commands += [["codex", "plugin", "add", s["codex_name"] + "@" + catalog["name"]] for s in specs]
    if apply:
        for command in commands:
            subprocess.run(command, check=True)
    return commands


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("list", "prepare", "install"), default="list")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--only", action="append")
    parser.add_argument("--out", type=Path, default=ROOT / "dist")
    parser.add_argument("--source", action="append", default=[], metavar="NAME=PATH")
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--build-runtime", action="store_true")
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--json", action="store_true", help="Emit JSON (also the default output format)")
    args = parser.parse_args()
    try:
        if args.all and args.only:
            raise ValueError("Choose --all or --only")
        if args.command == "list":
            result = select(args.only)
        elif args.command == "prepare":
            result = prepare(args.only, args.out, dict(s.split("=", 1) for s in args.source), args.cache, args.build_runtime, args.fetch)
        else:
            result = install(args.only, args.out, args.apply)
        print(json.dumps(result, indent=2))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + "\n")


if __name__ == "__main__":
    main()
