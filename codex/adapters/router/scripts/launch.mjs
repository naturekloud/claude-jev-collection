import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { keyEnv, isMain } from './shared.mjs';

const KEY_NAMES = ['TYPESAFE_API_KEY', 'JEV_API_KEY'];
const SHELLS = ['/bin/zsh', '/usr/bin/zsh', '/bin/bash', '/usr/bin/bash'];
const READ_KEYS = `const names = ${JSON.stringify(KEY_NAMES)};
const selected = Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]]));
process.stdout.write('\\n' + process.argv[1] + '\\n' + JSON.stringify(selected) + '\\n');`;

export function importShellCredentials({ env = process.env, spawnImpl = spawnSync, resolveEnv = keyEnv,
  marker = randomUUID(), nodePath = process.execPath, platform = process.platform } = {}) {
  const resolved = resolveEnv(env);
  if (KEY_NAMES.some(name => resolved[name])) return resolved;
  const shell = resolved.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  if (!SHELLS.includes(shell)) return resolved;
  try {
    // Startup output stays in captured pipes; only the framed selected fields are read.
    const child = spawnImpl(shell, ['-ilc', 'exec "$1" -e "$2" "$3"', 'router-shell-env', nodePath, READ_KEYS, marker], {
      env: resolved, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000, maxBuffer: 64 * 1024, killSignal: 'SIGKILL', windowsHide: true,
    });
    if (child.error || child.status !== 0 || typeof child.stdout !== 'string') return resolved;
    const frame = `\n${marker}\n`;
    const offset = child.stdout.lastIndexOf(frame);
    if (offset < 0) return resolved;
    const selected = JSON.parse(child.stdout.slice(offset + frame.length).split('\n', 1)[0]);
    if (!selected || typeof selected !== 'object' || Array.isArray(selected)) return resolved;
    const imported = { ...resolved };
    for (const name of KEY_NAMES) {
      if (!imported[name] && typeof selected[name] === 'string' && selected[name].trim()) imported[name] = selected[name];
    }
    return resolveEnv(imported);
  } catch {
    // Missing keys use the normal Router error; captured diagnostics may contain secrets.
    return resolved;
  }
}

export async function launch() {
  const env = importShellCredentials();
  for (const name of KEY_NAMES) if (env[name] && !process.env[name]) process.env[name] = env[name];
  const { startStdio } = await import('./mcp.mjs');
  startStdio();
}

if (isMain(import.meta.url)) void launch();
