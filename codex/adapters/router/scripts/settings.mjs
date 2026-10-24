import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { route, routes as defaults } from './route.mjs';
import { keyEnv } from './shared.mjs';

export const TIERS = ['micro', 'low', 'medium', 'high'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
export const AGENTS = ['jev-architect', 'jev-advisor', 'jev-analyst', 'jev-builder', 'jev-engineer', 'jev-debugger', 'jev-reviewer', 'jev-qa', 'jev-scout'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);

export function validateRoutes(value) {
  if (!object(value) || Object.keys(value).length !== TIERS.length || TIERS.some(tier => !Object.hasOwn(value, tier))) {
    throw new Error('Provide exactly the micro, low, medium and high routes.');
  }
  const checked = {};
  for (const tier of TIERS) {
    const entry = value[tier];
    if (!object(entry) || Object.keys(entry).length !== 3 || !Object.keys(entry).every(k => ['model', 'effort', 'agent_type'].includes(k))) {
      throw new Error('Each route must contain model, effort and agent_type only.');
    }
    if (typeof entry.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(entry.model)) throw new Error('Use a valid model identifier of at most 128 characters.');
    if (!EFFORTS.includes(entry.effort)) throw new Error('Effort must be low, medium, high or xhigh.');
    if (!AGENTS.includes(entry.agent_type)) throw new Error('Choose one of the configured Jev agent roles.');
    checked[tier] = { model: entry.model, effort: entry.effort, agent_type: entry.agent_type };
  }
  return checked;
}

function validateHistory(history) {
  if (!Array.isArray(history) || history.length > 30) throw new Error('Invalid history');
  return history.map(row => {
    if (!object(row) || !Object.keys(row).every(k => ['timestamp', 'tier', 'model', 'effort'].includes(k)) ||
        typeof row.timestamp !== 'string' || !Number.isFinite(Date.parse(row.timestamp)) ||
        ![...TIERS, 'uncertain'].includes(row.tier) ||
        !(row.model === null || (typeof row.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(row.model))) ||
        !(row.effort === null || EFFORTS.includes(row.effort))) throw new Error('Invalid history');
    return { timestamp: row.timestamp, tier: row.tier, model: row.model, effort: row.effort };
  });
}

export function createRouterService({ env = keyEnv(), fetchImpl = fetch } = {}) {
  const credentials = { ...env };
  credentials.TYPESAFE_API_KEY ||= env.JEV_API_KEY;
  const directory = env.PLUGIN_DATA ? join(env.PLUGIN_DATA, 'router') : join(env.CODEX_HOME || join(homedir(), '.codex'), 'jev', 'router');
  const file = join(directory, 'config.json');
  const fresh = () => ({ version: 1, routes: clone(defaults), history: [] });
  function read() {
    let text;
    try {
      if (lstatSync(file).isSymbolicLink()) throw new Error('symlink');
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return fresh();
      throw new Error('Router settings could not be read. Check the settings file permissions and format.');
    }
    try {
      const data = JSON.parse(text);
      if (!object(data) || data.version !== 1 || !Object.keys(data).every(k => ['version', 'routes', 'history'].includes(k))) throw new Error('Invalid config');
      return { version: 1, routes: validateRoutes(data.routes), history: validateHistory(data.history) };
    } catch {
      throw new Error('Router settings are invalid. Repair the settings file before saving or classifying.');
    }
  }
  function save(data) {
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    } catch {
      throw new Error('Router settings could not be saved. Check the settings directory permissions.');
    }
  }
  const snapshot = data => ({ routes: clone(data.routes), keyConfigured: Boolean(credentials.TYPESAFE_API_KEY), history: clone(data.history), mode: 'advisory' });
  return {
    async call(name, args = {}) {
      if (!object(args)) throw new Error('Tool arguments must be an object.');
      const allowed = name === 'classify_task' ? ['task'] : name === 'save_settings' ? ['routes'] : [];
      if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Unexpected tool argument.');
      if (!['show_router', 'router_status', 'classify_task', 'save_settings', 'reset_settings', 'clear_history'].includes(name)) throw new Error('Unknown router tool.');
      const data = read();
      if (name === 'classify_task') {
        if (typeof args.task !== 'string' || !args.task.trim() || args.task.length > 8000) throw new Error('Enter a task between 1 and 8000 characters.');
        let result;
        try { result = await route(args.task, { env: credentials, fetchImpl, routes: data.routes }); }
        catch { throw new Error(credentials.TYPESAFE_API_KEY ? 'Jev classification is unavailable. Check API credentials and network access.' : 'Configure TYPESAFE_API_KEY or ~/.config/typesafe/.env before classifying.'); }
        const current = read();
        current.history.unshift({ timestamp: new Date().toISOString(), tier: result.advice.choice,
          model: result.recommendation?.model ?? null, effort: result.recommendation?.effort ?? null });
        current.history = current.history.slice(0, 30);
        save(current);
        return { ...snapshot(current), result };
      }
      if (name === 'save_settings') { data.routes = validateRoutes(args.routes); save(data); }
      if (name === 'reset_settings') { data.routes = clone(defaults); save(data); }
      if (name === 'clear_history') { data.history = []; save(data); }
      return snapshot(data);
    },
  };
}
