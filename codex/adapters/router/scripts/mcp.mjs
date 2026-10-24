import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouterService, TIERS, EFFORTS, AGENTS } from './settings.mjs';
import { isMain } from './shared.mjs';

export const RESOURCE_URI = 'ui://router/panel-v1.html';
export const RESOURCE_MIME = 'text/html;profile=mcp-app';
const RENDER_META = { ui: { resourceUri: RESOURCE_URI }, 'openai/outputTemplate': RESOURCE_URI };
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));
const routeSchema = { type: 'object', additionalProperties: false, required: ['model', 'effort', 'agent_type'],
  properties: { model: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' },
    effort: { type: 'string', enum: EFFORTS }, agent_type: { type: 'string', enum: AGENTS } } };
const empty = { type: 'object', additionalProperties: false, properties: {} };
const schema = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });
const annotate = readOnlyHint => ({ readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint, openWorldHint: false });
export const TOOLS = [
  { name: 'show_router', title: 'Open Router', description: 'Open the interactive Router panel: classify tasks, inspect recommendations and edit advisory routing settings.', inputSchema: empty,
    annotations: annotate(true), _meta: { ...RENDER_META,
      'openai/toolInvocation/invoking': 'Opening Router…', 'openai/toolInvocation/invoked': 'Router ready' } },
  { name: 'router_status', title: 'Router status', description: 'Read router mappings, metadata-only history and whether credentials are configured. Never returns API keys.', inputSchema: empty, annotations: annotate(true) },
  { name: 'classify_task', title: 'Recommend a route', description: 'Send a bounded redacted task to TypeSafe for an advisory model and role recommendation; persist only timestamp/tier/model/effort history.',
    inputSchema: schema({ task: { type: 'string', minLength: 1, maxLength: 8000 } }, ['task']), annotations: { ...annotate(false), openWorldHint: true } },
  { name: 'save_settings', title: 'Save routing settings', description: 'Save the four advisory router mappings. Does not change Codex global settings, agent definitions or the current model.',
    inputSchema: schema({ routes: { type: 'object', additionalProperties: false, required: TIERS, properties: Object.fromEntries(TIERS.map(tier => [tier, routeSchema])) } }, ['routes']), annotations: { ...annotate(false), idempotentHint: true } },
  { name: 'reset_settings', title: 'Reset routing settings', description: 'Reset advisory mappings to plugin defaults while preserving history. Does not change Codex model.', inputSchema: empty, annotations: { ...annotate(false), idempotentHint: true } },
  { name: 'clear_history', title: 'Clear routing history', description: 'Clear the metadata-only local router history, keeping routing settings.', inputSchema: empty, annotations: { ...annotate(false), idempotentHint: true } },
];
export const TOOL_NAMES = TOOLS.map(tool => tool.name);

export function panelHTML() {
  const html = readFileSync(join(PLUGIN, 'ui/panel.html'), 'utf8');
  const script = readFileSync(join(PLUGIN, 'ui/app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  return html.replace('<!-- ROUTER_APP_SCRIPT -->', `<script>${script}</script>`);
}

const resource = () => ({ uri: RESOURCE_URI, name: 'router-panel', title: 'Router', mimeType: RESOURCE_MIME,
  description: 'Interactive advisory routing controls and task recommendations.' });

export async function dispatch(request, { service = createRouterService() } = {}) {
  const id = request?.id ?? null;
  const result = value => ({ jsonrpc: '2.0', id, result: value });
  const error = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return error(-32600, 'Invalid JSON-RPC request.');
  if (!Object.hasOwn(request, 'id')) return null;
  if (request.method === 'initialize') return result({ protocolVersion: '2025-06-18',
    capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [RESOURCE_MIME] } } },
    serverInfo: { name: 'codex-jev-router', version: '1.0.0' }, instructions: 'Use show_router to open the router panel. Recommendations are advisory and never change the main conversation model.' });
  if (request.method === 'ping') return result({});
  if (request.method === 'tools/list') return result({ tools: TOOLS });
  if (request.method === 'resources/list') return result({ resources: [resource()] });
  if (request.method === 'resources/read') {
    if (request.params?.uri !== RESOURCE_URI) return error(-32602, 'Unknown router resource.');
    try { return result({ contents: [{ ...resource(), text: panelHTML(), _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } }, 'openai/ui': { availableDisplayModes: ['inline'] } } }] }); }
    catch { return error(-32603, 'Router panel resources are unavailable. Reinstall the plugin.'); }
  }
  if (request.method === 'tools/call') {
    const name = request.params?.name;
    if (!TOOL_NAMES.includes(name)) return error(-32602, 'Unknown router tool.');
    try {
      const data = await service.call(name, request.params?.arguments ?? {});
      return result({ structuredContent: data,
        content: [{ type: 'text', text: name === 'show_router' ? 'Router panel rendering requested. Model recommendations are advisory.' : JSON.stringify(data) }],
        ...(name === 'show_router' ? { _meta: RENDER_META } : {}) });
    } catch (failure) {
      return result({ isError: true, content: [{ type: 'text', text: failure.message }] });
    }
  }
  return error(-32601, 'Method not found.');
}

export function startStdio({ input = process.stdin, output = process.stdout, service = createRouterService() } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let pending = Promise.resolve();
  lines.on('line', line => {
    pending = pending.then(async () => {
      let response;
      try { response = await dispatch(JSON.parse(line), { service }); }
      catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } }; }
      if (response) output.write(JSON.stringify(response) + '\n');
    });
  });
  return lines;
}

if (isMain(import.meta.url)) startStdio();
