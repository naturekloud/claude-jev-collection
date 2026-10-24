// Shared adapter plumbing; copied beside each adapter by the dependency packager.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function keyEnv(base = process.env) {
  const env = { ...base };
  if (!env.TYPESAFE_API_KEY && !env.JEV_API_KEY) {
    try {
      const text = readFileSync(join(homedir(), '.config/typesafe/.env'), 'utf8');
      const match = /^TYPESAFE_API_KEY\s*=\s*(.+)$/m.exec(text);
      if (match) env.TYPESAFE_API_KEY = match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
    } catch { /* The normal missing-key behavior stays with the caller. */ }
  }
  env.TYPESAFE_API_KEY ||= env.JEV_API_KEY;
  env.JEV_API_KEY ||= env.TYPESAFE_API_KEY;
  return env;
}

export function scrub(text) {
  return String(text)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '<redacted>')
    .replace(/\b(?:sk-|ghp_|gho_|github_pat_|xox[baprs]-)[\w-]{8,}/g, '<redacted>')
    .replace(/(bearer\s+)[\w.~+/=-]{8,}/gi, '$1<redacted>')
    .replace(/((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"'&,;}]{4,}/gi, '$1<redacted>');
}

export function isMain(url) {
  try { return url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}

export function stdinJSON() {
  const raw = readFileSync(0, 'utf8');
  const event = JSON.parse(raw || '{}');
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Expected JSON object');
  return event;
}
