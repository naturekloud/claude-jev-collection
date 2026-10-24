import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ask, buildState, classifyToolResult, decide, needsDoneCheck, nudge, QUESTIONS, redact } from '../belay.mjs';
import { isMain, keyEnv, stdinJSON } from './shared.mjs';

function location(event, env) {
  if (!event.session_id) return null;
  const id = createHash('sha256').update(`${event.cwd ?? ''}:${event.session_id}`).digest('hex');
  const base = env.PLUGIN_DATA || join(env.CODEX_HOME || join(homedir(), '.codex'), 'jev/belay');
  return join(base, id + '.json');
}

function read(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

function save(file, data) {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  const temp = file + `.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
  renameSync(temp, file);
}

export async function handle(event, { env = keyEnv(), fetchImpl = fetch } = {}) {
  const file = location(event, env);
  if (!file) return {};
  const state = read(file);
  if (event.hook_event_name === 'UserPromptSubmit') {
    save(file, { task: redact(event.prompt ?? '').slice(0, 1500), mutations: 0, checks: [], checksBeforeMutation: 0, blocked: false, pending: {} });
    return {};
  }
  if (event.hook_event_name === 'PostToolUse') {
    let tool = event.tool_name === 'exec_command' ? 'Bash' : event.tool_name === 'apply_patch' ? 'Edit' : event.tool_name;
    let input = event.tool_input ?? {};
    let result = event.tool_response ?? event.tool_result ?? {};
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch { /* Plain text is also supported. */ }
    }
    state.pending ??= {};
    const polling = event.tool_name === 'write_stdin';
    const session = polling ? input.session_id : result?.session_id;
    if (polling) {
      if (!state.pending[String(session)]) return {};
      input = { command: state.pending[String(session)] };
      tool = 'Bash';
    }
    // A running unified-exec command is not evidence that a check completed.
    if (result && typeof result === 'object' && result.session_id && result.exit_code == null) {
      if (tool === 'Bash') state.pending[String(session)] = redact(input.command ?? input.cmd ?? '').slice(0, 1000);
      save(file, state);
      return {};
    }
    if (polling) delete state.pending[String(session)];
    const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('\n') :
      value && typeof value === 'object' ? ['stdout', 'stderr', 'output', 'text', 'content'].map(k => text(value[k])).join('\n') : '';
    const output = text(result);
    const reportedExit = /(?:Process exited with code|exit(?:_| )code\s*[:=])\s*(-?\d+)/i.exec(output);
    const failed = Boolean(event.is_error || result?.is_error || (reportedExit && +reportedExit[1] !== 0) ||
      (typeof result?.exit_code === 'number' && result.exit_code !== 0));
    const outcome = classifyToolResult(tool, { ...input, command: input.command ?? input.cmd }, failed, output);
    if (outcome === 'mutation' && !failed) {
      state.mutations = (state.mutations ?? 0) + 1;
      state.checksBeforeMutation = state.checks?.length ?? 0;
      state.blocked = false;
    } else if (outcome === 'check-pass' || outcome === 'check-fail') {
      state.checks ??= [];
      state.checks.push({ call: redact(input.command ?? input.cmd ?? tool).slice(0, 200), passed: outcome === 'check-pass' });
      if (state.checks.length > 100) {
        state.checks.shift();
        state.checksBeforeMutation = Math.max(0, (state.checksBeforeMutation ?? 0) - 1);
      }
    }
    save(file, state);
    return {};
  }
  if (event.hook_event_name !== 'Stop' || event.stop_hook_active || state.blocked || !state.task) return {};
  const evidence = { mutations: state.mutations ?? 0, checks: state.checks ?? [], checksBeforeMutation: state.checksBeforeMutation ?? 0 };
  if (!needsDoneCheck(evidence) || !env.TYPESAFE_API_KEY) return {};
  const said = event.last_assistant_message;
  if (typeof said !== 'string' || !said.trim()) return {};
  const answer = await ask(buildState(state.task, said, evidence), QUESTIONS, { env, fetchImpl, timeoutMs: 8000 });
  const verdict = decide(answer.answers, evidence);
  if (!verdict.block) return {};
  state.blocked = true; // At most one block until another successful mutation or new prompt.
  save(file, state);
  return { decision: 'block', reason: nudge(verdict, evidence) };
}

if (isMain(import.meta.url)) {
  try { console.log(JSON.stringify(await handle(stdinJSON()))); }
  catch { console.log('{}'); } // Upstream belay's fail-open semantics.
}
