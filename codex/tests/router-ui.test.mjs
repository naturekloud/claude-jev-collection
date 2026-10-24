import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { get as httpGet } from 'node:http';

const plugin = resolve(process.env.JEV_TEST_DIST || 'codex/dist', 'plugins/router');
const { createRouterService, validateRoutes } = await import(pathToFileURL(join(plugin, 'scripts/settings.mjs')).href);
const { dispatch, TOOLS, RESOURCE_URI, RESOURCE_MIME } = await import(pathToFileURL(join(plugin, 'scripts/mcp.mjs')).href);
const { routes: defaults } = await import(pathToFileURL(join(plugin, 'scripts/route.mjs')).href);
const fixture = t => {
  const home = mkdtempSync(join(tmpdir(), 'jev-router-ui-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
};
const keyedEnv = home => Object.fromEntries([['CODEX_HOME', home], ['TYPESAFE_API_KEY', 'fixture-api-value']]);
const answer = { answers: { route: { type: 'choice', choice: 'high', confidence: 0.9,
  probabilities: { micro: 0, low: 0, medium: 0.1, high: 0.9, uncertain: 0 } } } };

test('saved settings survive restart and change recommendations without persisting task or key', async t => {
  const home = fixture(t);
  let scored;
  const env = keyedEnv(home);
  const service = createRouterService({ env, fetchImpl: async (_, options) => {
    scored = JSON.parse(options.body);
    return { ok: true, json: async () => answer };
  } });
  const initial = await service.call('router_status');
  assert.equal(initial.keyConfigured, true);
  assert.equal(existsSync(join(home, 'jev/router/config.json')), false);
  const changed = structuredClone(defaults);
  changed.high.model = 'gpt-custom';
  await service.call('save_settings', { routes: changed });
  const output = await service.call('classify_task', { task: 'RAW_TASK_should_not_persist' });
  assert.equal(output.result.recommendation.model, 'gpt-custom');
  assert.equal(scored.questions.route.criteria.high.route.model, 'gpt-custom');
  assert.equal(output.history.length, 1);
  const persisted = readFileSync(join(home, 'jev/router/config.json'), 'utf8');
  assert.ok(!persisted.includes('RAW_TASK_should_not_persist'));
  assert.ok(!persisted.includes('fixture-api-value'));
  const restarted = createRouterService({ env });
  assert.equal((await restarted.call('router_status')).routes.high.model, 'gpt-custom');
  assert.equal((await restarted.call('reset_settings')).history.length, 1);
  assert.equal((await restarted.call('clear_history')).history.length, 0);
});

test('settings validation rejects unknown fields and invalid model IDs before writing', async t => {
  const home = fixture(t);
  const service = createRouterService({ env: { CODEX_HOME: home } });
  const changed = structuredClone(defaults);
  changed.high.model = 'bad model\nvalue';
  assert.throws(() => validateRoutes(changed), /model identifier/);
  await assert.rejects(service.call('save_settings', { routes: changed }), /model identifier/);
  await assert.rejects(service.call('save_settings', { routes: defaults, extra: true }), /Unexpected/);
  assert.equal(existsSync(join(home, 'jev/router/config.json')), false);
  assert.equal((await service.call('show_router')).keyConfigured, false);
});

test('corrupt config is surfaced and never overwritten by reset', async t => {
  const home = fixture(t);
  const file = join(home, 'jev/router/config.json');
  mkdirSync(join(home, 'jev/router'), { recursive: true });
  writeFileSync(file, '{broken');
  const service = createRouterService({ env: { CODEX_HOME: home } });
  await assert.rejects(service.call('router_status'), /settings are invalid/);
  await assert.rejects(service.call('reset_settings'), /settings are invalid/);
  assert.equal(readFileSync(file, 'utf8'), '{broken');
});

test('classification failures return safe tool errors without upstream details', async t => {
  const home = fixture(t);
  const service = createRouterService({ env: keyedEnv(home), fetchImpl: async () => { throw new Error('internal-sensitive-diagnostic'); } });
  const output = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'classify_task', arguments: { task: 'Fix bug' } } }, { service });
  assert.equal(output.result.isError, true);
  assert.ok(!JSON.stringify(output).includes('internal-sensitive-diagnostic'));
  assert.equal(existsSync(join(home, 'jev/router/config.json')), false);
  const tooLong = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'classify_task', arguments: { task: 'a'.repeat(8001) } } }, { service });
  assert.equal(tooLong.result.isError, true);
});

test('MCP tools and UI resource expose embedded metadata only on the render tool', async t => {
  const service = createRouterService({ env: { CODEX_HOME: fixture(t) } });
  const listed = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { service });
  assert.equal(listed.result.tools.length, 6);
  assert.equal(TOOLS.find(tool => tool.name === 'show_router')._meta.ui.resourceUri, RESOURCE_URI);
  assert.equal(TOOLS.filter(tool => tool._meta?.ui?.resourceUri).length, 1);
  const shown = await dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'show_router', arguments: {} } }, { service });
  assert.equal(shown.result._meta.ui.resourceUri, RESOURCE_URI);
  assert.equal(shown.result._meta['openai/outputTemplate'], TOOLS.find(tool => tool.name === 'show_router')._meta['openai/outputTemplate']);
  assert.match(shown.result.content[0].text, /rendering requested/);
  for (const name of ['router_status', 'reset_settings', 'clear_history']) {
    const data = await dispatch({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name, arguments: {} } }, { service });
    assert.equal(data.result._meta, undefined);
  }
  const failed = await dispatch({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'show_router', arguments: {} } }, {
    service: { call: async () => { throw new Error('Panel data unavailable.'); } },
  });
  assert.equal(failed.result.isError, true);
  assert.equal(failed.result._meta, undefined);
  const resource = await dispatch({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: RESOURCE_URI } }, { service });
  assert.equal(resource.result.contents[0].mimeType, RESOURCE_MIME);
  assert.deepEqual(resource.result.contents[0]._meta['openai/ui'].availableDisplayModes, ['inline']);
  assert.ok(!resource.result.contents[0].text.includes('<!-- ROUTER_APP_SCRIPT -->'));
  assert.ok(resource.result.contents[0].text.includes('<script>'));
  assert.deepEqual(await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }, { service }), null);
});

test('stdio server speaks JSON-RPC and answers initialize/status requests without logging keys', t => {
  const env = { ...process.env, ...keyedEnv(fixture(t)) };
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'router_status', arguments: {} } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n';
  const child = spawnSync(process.execPath, [join(plugin, 'scripts/mcp.mjs')], { input, env, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
  const replies = child.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(replies.length, 2);
  assert.equal(replies[0].result.serverInfo.name, 'codex-jev-router');
  assert.equal(replies[1].result.structuredContent.keyConfigured, true);
  assert.ok(!child.stdout.includes('fixture-api-value'));
});

test('CLI rejects empty task normally without an unsettled top-level import cycle', t => {
  const child = spawnSync(process.execPath, [join(plugin, 'scripts/route.mjs')], {
    env: { ...process.env, CODEX_HOME: fixture(t) }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(child.status, 1, child.stderr);
  assert.match(child.stderr, /Enter a task/);
  assert.ok(!child.stderr.includes('unsettled'));
});

test('preview requires same-origin and per-run nonce before calling the service', async t => {
  const { createPreview } = await import(pathToFileURL(join(plugin, 'scripts/preview.mjs')).href);
  const calls = [];
  const server = createPreview({ service: { call: async (name, args) => { calls.push({ name, args }); return { mode: 'advisory' }; } } });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const page = await fetch(server.url + '/');
  assert.equal(page.status, 200);
  const html = await page.text();
  const config = JSON.parse(/window\.__ROUTER_PREVIEW__=(\{[^;]+\});/.exec(html)[1]);
  const request = headers => fetch(server.url + '/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'router_status', args: {} }) });
  assert.equal((await request({ Origin: server.url })).status, 403);
  assert.equal((await request({ Origin: 'https://other.example', 'X-Router-Nonce': config.nonce })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await request({ Origin: server.url, 'X-Router-Nonce': config.nonce })).status, 200);
  assert.equal(calls.length, 1);
  const rebindingStatus = await new Promise((resolve, reject) => {
    httpGet(server.url + '/', { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(rebindingStatus, 403);
});
