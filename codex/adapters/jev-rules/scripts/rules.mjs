import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadRules } from '../hooks/lib/rules.mjs';
import { decide, render } from '../hooks/lib/run.mjs';
import { readConfig } from '../hooks/lib/config.mjs';
import { isMain, keyEnv, scrub, stdinJSON } from './shared.mjs';

export async function handle(event, { env = keyEnv(), fetchImpl = fetch } = {}) {
  const kind = event.hook_event_name;
  if (!['UserPromptSubmit', 'PreToolUse'].includes(kind)) return {};
  const cwd = event.cwd || process.cwd();
  const base = env.PLUGIN_DATA || join(env.CODEX_HOME || join(homedir(), '.codex'), 'jev/rules');
  const id = createHash('sha256').update(`${cwd}:${event.session_id ?? ''}`).digest('hex');
  const file = join(base, id + '.json');
  let state = { delivered: {} };
  if (event.session_id) {
    try { state = { ...state, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { /* first event */ }
  }
  let query;
  if (kind === 'UserPromptSubmit') {
    state.prompt = scrub(event.prompt ?? '').slice(0, 4000);
    query = state.prompt;
  } else {
    const input = event.tool_input ?? {};
    const patch = typeof input.command === 'string' ? input.command : '';
    const files = [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)].map(m => m[1] || m[2]);
    if (typeof input.file_path === 'string') files.push(input.file_path);
    if (!files.length) return {};
    query = `${state.prompt ?? ''}\nFiles about to change: ${files.join(', ')}`;
  }
  const all = loadRules(join(cwd, '.codex', 'jev-rules'));
  const hash = rule => createHash('sha256').update(`${rule.name}:${rule.body}`).digest('hex');
  const rules = all.filter(rule => state.delivered[rule.name] !== hash(rule));
  if (!rules.length) return {};
  const decision = await decide({ rules, prompt: scrub(query), config: readConfig(env), fetch: fetchImpl });
  const rendered = render(decision, rules.length, { subject: 'this Codex request' });
  for (const rule of rendered.shown) state.delivered[rule.name] = hash(rule);
  if (event.session_id) {
    mkdirSync(dirname(file), { recursive: true });
    const temp = file + `.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    renameSync(temp, file);
  }
  return rendered.text ? { hookSpecificOutput: { hookEventName: kind, additionalContext: rendered.text } } : {};
}

if (isMain(import.meta.url)) {
  try { console.log(JSON.stringify(await handle(stdinJSON()))); }
  catch { console.log('{}'); }
}
