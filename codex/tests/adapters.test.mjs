import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const packages = resolve(process.env.JEV_TEST_DIST || 'codex/dist', 'plugins');
const load = (name, file) => import(pathToFileURL(join(packages, name, file)).href);
const fixture = () => mkdtempSync(join(tmpdir(), 'jev-adapter-'));
const response = data => ({ ok: true, status: 200, json: async () => data });

test('router uses upstream classifier, redacts request, and only recommends a Codex role', async () => {
  const { route } = await load('router', 'scripts/route.mjs');
  let request;
  const result = await route('Review API_KEY=secret-value for architecture', {
    env: { TYPESAFE_API_KEY: 'fixture' },
    fetchImpl: async (_, args) => {
      request = JSON.parse(args.body);
      return response({ answers: { route: { type: 'choice', choice: 'high', confidence: 0.9,
        probabilities: { micro: 0, low: 0, medium: 0.1, high: 0.9, uncertain: 0 } } } });
    },
  });
  assert.equal(result.main_model_changed, false);
  assert.equal(result.recommendation.agent_type, 'jev-architect');
  assert.ok(request.questions.route.criteria.high.route.model.startsWith('gpt-'));
  assert.ok(!JSON.stringify(request).includes('secret-value'));
});

test('compaction drops obsolete exported tool output without changing input', async () => {
  const { compactExport } = await load('fast-jev-compaction', 'scripts/compact.mjs');
  const messages = [
    { role: 'user', text: 'Inspect repo', toolUses: [] },
    { role: 'assistant', text: 'Inspecting', toolUses: [{ tool_use_id: 'call1', tool: 'Bash', input: { command: 'ls' } }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'call1', text: 'obsolete '.repeat(1000) }] },
    { role: 'assistant', text: 'Continue', toolUses: [] },
  ];
  const original = JSON.stringify(messages);
  const result = await compactExport({ messages, options: { preserveRecentMessages: 0 } }, {
    asker: { ask: async (_, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(k => [k, { type: 'noul', noul: 0 }])) }) },
  });
  assert.equal(result.live_history_changed, false);
  assert.ok(result.stats.charsAfter < result.stats.charsBefore);
  assert.equal(JSON.stringify(messages), original);
});

test('belay ignores pending checks, blocks once, then accepts a completed passing check', async () => {
  const { handle } = await load('jev-belay', 'scripts/belay.mjs');
  const home = fixture();
  try {
    const env = { CODEX_HOME: home, TYPESAFE_API_KEY: 'fixture' };
    let calls = 0;
    const deps = { env, fetchImpl: async () => {
      calls++;
      return response({ answers: { claims_done: { noul: 0.99 }, claims_verified: { noul: 0.99 }, verification_applies: { noul: 0.99 }, outcome: { choice: 'complete', confidence: 0.99 } } });
    } };
    const base = { session_id: 'test-session', cwd: home };
    await handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'Fix the code' }, deps);
    await handle({ ...base, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: {}, tool_response: { exit_code: 0 } }, deps);
    await handle({ ...base, hook_event_name: 'PostToolUse', tool_name: 'exec_command', tool_input: { cmd: 'npm test' }, tool_response: { session_id: 42, exit_code: null } }, deps);
    const stop = { ...base, hook_event_name: 'Stop', last_assistant_message: 'Done, tests pass.' };
    assert.equal((await handle(stop, deps)).decision, 'block');
    assert.deepEqual(await handle(stop, deps), {});
    assert.equal(calls, 1);
    await handle({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { exit_code: 0, stdout: 'Tests: 1 passed' } }, deps);
    assert.deepEqual(await handle(stop, deps), {});
    assert.equal(calls, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('rules inject from Codex paths, dedupe within session, and reload changed rules', async () => {
  const { handle } = await load('jev-rules', 'scripts/rules.mjs');
  const home = fixture();
  try {
    const rules = join(home, '.codex/jev-rules');
    mkdirSync(rules, { recursive: true });
    const file = join(rules, 'money.md');
    writeFileSync(file, '---\nalways: true\n---\nUse decimal arithmetic.');
    const env = { CODEX_HOME: join(home, 'runtime') };
    const event = { session_id: 'test-session', cwd: home, hook_event_name: 'UserPromptSubmit', prompt: 'Calculate prices' };
    const output = await handle(event, { env });
    assert.match(output.hookSpecificOutput.additionalContext, /decimal arithmetic/);
    assert.deepEqual(await handle(event, { env }), {});
    writeFileSync(file, '---\nalways: true\n---\nRound only at the boundary.');
    const patch = { ...event, hook_event_name: 'PreToolUse', tool_input: { command: '*** Begin Patch\n*** Update File: prices.ts\n*** End Patch' } };
    assert.match((await handle(patch, { env })).hookSpecificOutput.additionalContext, /Round only/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('belay records async completion and rejects nonzero text exit codes as passing evidence', async () => {
  const { handle } = await load('jev-belay', 'scripts/belay.mjs');
  const home = fixture();
  try {
    const env = { CODEX_HOME: home, TYPESAFE_API_KEY: 'fixture' };
    const deps = { env, fetchImpl: async () => response({ answers: {
      claims_done: { noul: 1 }, claims_verified: { noul: 1 }, verification_applies: { noul: 1 },
      outcome: { choice: 'complete', confidence: 1 },
    } }) };
    const base = { cwd: home, session_id: 'async-test' };
    const prompt = { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'Fix bug' };
    const patch = { ...base, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_response: { exit_code: 0 } };
    await handle(prompt, deps);
    await handle(patch, deps);
    await handle({ ...base, hook_event_name: 'PostToolUse', tool_name: 'exec_command', tool_input: { cmd: 'npm test' }, tool_response: { session_id: 123, exit_code: null } }, deps);
    await handle({ ...base, hook_event_name: 'PostToolUse', tool_name: 'write_stdin', tool_input: { session_id: 123 }, tool_response: { exit_code: 0, output: 'Tests: 1 passed' } }, deps);
    const stop = { ...base, hook_event_name: 'Stop', last_assistant_message: 'Done and tests pass.' };
    assert.deepEqual(await handle(stop, deps), {});
    await handle(prompt, deps);
    await handle(patch, deps);
    await handle({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: 'Process exited with code 1\nNo test runner installed.' }, deps);
    assert.equal((await handle(stop, deps)).decision, 'block');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
