import { buildRequest, parseAnswers } from '../lib/classifier-apis.mjs';
import { DEFAULTS } from '../lib/config.mjs';
import { isMain, keyEnv, scrub } from './shared.mjs';

export const routes = {
  micro: { model: 'gpt-6-luna', effort: 'low', agent_type: 'jev-scout' },
  low: { model: 'gpt-6-luna', effort: 'low', agent_type: 'jev-builder' },
  medium: { model: 'gpt-6.1-sol', effort: 'medium', agent_type: 'jev-engineer' },
  high: { model: 'gpt-6.1-sol', effort: 'xhigh', agent_type: 'jev-architect' },
};

export async function route(task, { env = keyEnv(), fetchImpl = fetch, routes: selectedRoutes = routes } = {}) {
  if (typeof task !== 'string' || !task.trim()) throw new Error('Pass the task as a quoted argument');
  if (task.length > 8000) throw new Error('Task must be at most 8000 characters');
  if (!env.TYPESAFE_API_KEY) throw new Error('Configure TYPESAFE_API_KEY or ~/.config/typesafe/.env');
  const config = { ...DEFAULTS, routes: selectedRoutes, classifier: 'codex-jev',
    classifiers: { 'codex-jev': { api: 'system-one', model: 'jev-latest' } } };
  const response = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequest(config, scrub(task).slice(0, 8000), [])),
  });
  if (!response.ok) throw new Error(`Jev request failed: HTTP ${response.status}`);
  const advice = parseAnswers(config, await response.json());
  const recommendation = selectedRoutes[advice.choice] ?? null;
  return { mode: 'advisory', advice, recommendation, main_model_changed: false,
    note: 'Advice only. For actual Jev delegation use jev-kit preflight/route, including its escalation policy.' };
}

async function main() {
  try {
    const { createRouterService } = await import('./settings.mjs');
    const output = await createRouterService().call('classify_task', { task: process.argv.slice(2).join(' ') });
    console.log(JSON.stringify(output.result, null, 2));
  }
  catch (error) { console.error(error.name === 'Error' ? error.message : 'Routing failed'); process.exitCode = 1; }
}

if (isMain(import.meta.url)) void main();
