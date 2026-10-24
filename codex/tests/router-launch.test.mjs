import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const plugin = resolve(process.env.JEV_TEST_DIST || 'codex/dist', 'plugins/router');
const { importShellCredentials } = await import(pathToFileURL(join(plugin, 'scripts/launch.mjs')).href);
const names = ['TYPESAFE_API_KEY', 'JEV_API_KEY'];
const identity = env => ({ ...env });
const base = () => ({ SHELL: '/bin/zsh', PATH: '/usr/bin:/bin', KEEP: 'original' });
const framed = data => `startup chatter\nfixture-marker\n${JSON.stringify(data)}\nignored exit chatter`;

test('existing inherited or resolved credentials skip shell startup', () => {
  const inherited = Object.fromEntries([[names[0], 'fixture-inherited']]);
  const run = () => { throw new Error('must not start shell'); };
  assert.equal(importShellCredentials({ env: inherited, spawnImpl: run, resolveEnv: identity })[names[0]], 'fixture-inherited');
  const resolved = importShellCredentials({ env: {}, spawnImpl: run,
    resolveEnv: env => ({ ...env, [names[1]]: 'fixture-config' }) });
  assert.equal(resolved[names[1]], 'fixture-config');
});

test('noisy shell imports only selected fields and passes fixed bounded command', () => {
  const env = base();
  let invoked = false;
  const output = importShellCredentials({ env, resolveEnv: identity, marker: 'fixture-marker', nodePath: '/absolute/node',
    spawnImpl: (shell, args, options) => {
      invoked = true;
      assert.equal(shell, '/bin/zsh');
      assert.deepEqual(args.slice(0, 4), ['-ilc', 'exec "$1" -e "$2" "$3"', 'router-shell-env', '/absolute/node']);
      assert.equal(typeof args[4], 'string');
      assert.equal(args[5], 'fixture-marker');
      assert.equal(options.timeout, 5000);
      assert.equal(options.maxBuffer, 64 * 1024);
      assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
      return { status: 0, stdout: framed({ [names[0]]: 'fixture-imported', PATH: '/untrusted/path', EXTRA: 'discard' }), stderr: 'discard diagnostics' };
    } });
  assert.equal(invoked, true);
  assert.equal(output[names[0]], 'fixture-imported');
  assert.equal(output.PATH, env.PATH);
  assert.equal(output.EXTRA, undefined);
  assert.equal(env[names[0]], undefined);
});

test('unsupported shell and failed malformed or oversized startup safely retain environment', () => {
  const env = base();
  const results = [
    { status: null, error: Object.assign(new Error('fixture-sensitive-diagnostic'), { code: 'ETIMEDOUT' }) },
    { status: 1, stdout: framed({ [names[0]]: 'must-not-import' }) },
    { status: 0, stdout: 'unframed output' },
    { status: 0, stdout: 'noise\nfixture-marker\nnot-json\n' },
    { status: 0, stdout: framed([]) },
    { status: 0, stdout: framed({ [names[0]]: 123, [names[1]]: '  ' }) },
    { status: null, error: Object.assign(new Error('buffer full'), { code: 'ENOBUFS' }) },
  ];
  for (const result of results) assert.deepEqual(importShellCredentials({ env, resolveEnv: identity,
    marker: 'fixture-marker', spawnImpl: () => result }), env);
  assert.deepEqual(importShellCredentials({ env, resolveEnv: identity, spawnImpl: () => { throw new Error('spawn failed'); } }), env);
  const unsupported = { ...env, SHELL: '/bin/fish' };
  assert.deepEqual(importShellCredentials({ env: unsupported, resolveEnv: identity,
    spawnImpl: () => { throw new Error('must not run'); } }), unsupported);
});

test('launcher captures interactive zsh startup output and emits only MCP JSON', { skip: process.platform !== 'darwin' }, t => {
  const home = mkdtempSync(join(tmpdir(), 'router-launch-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const fixtureValue = 'fixture-shell-credential';
  writeFileSync(join(home, '.zshrc'), `print 'startup noise must stay captured'\nprint -u2 'startup error must stay captured'\nexport ${names[0]}=${fixtureValue}\n`);
  const env = { ...process.env, HOME: home, ZDOTDIR: home, CODEX_HOME: home, SHELL: '/bin/zsh' };
  for (const name of names) delete env[name];
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'router_status', arguments: {} } };
  const child = spawnSync(process.execPath, [join(plugin, 'scripts/launch.mjs')], {
    env, input: JSON.stringify(request) + '\n', encoding: 'utf8', timeout: 10000,
  });
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  const lines = child.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).result.structuredContent.keyConfigured, true);
  assert.ok(!child.stdout.includes(fixtureValue));
  assert.ok(!child.stdout.includes('startup noise'));
});
