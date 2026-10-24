import { readFileSync } from 'node:fs';
import { compact, JevClient } from '../dist/index.js';
import { isMain, keyEnv, scrub } from './shared.mjs';

export async function compactExport(input, { env = keyEnv(), asker } = {}) {
  const messages = Array.isArray(input) ? input : input.messages;
  if (!Array.isArray(messages) || messages.some(m => !['user', 'assistant'].includes(m?.role) ||
      typeof m.text !== 'string' || !Array.isArray(m.toolUses))) {
    throw new Error('Expected normalized messages: {role:user|assistant,text:string,toolUses:[],toolResults?:[]}');
  }
  // Redact the scored state, keeping retained output verbatim in the exported artifact.
  const client = asker ?? new JevClient({ apiKey: env.TYPESAFE_API_KEY });
  const redactedAsker = { ask: (state, questions) => client.ask(JSON.parse(scrub(JSON.stringify(state))), questions) };
  const result = await compact(messages, redactedAsker, Array.isArray(input) ? {} : input.options ?? {});
  return { ...result, live_history_changed: false, mode: 'export-only' };
}

if (isMain(import.meta.url)) {
  try {
    const file = process.argv[2];
    if (!file) throw new Error('Usage: node compact.mjs exported-messages.json > compacted.json');
    console.log(JSON.stringify(await compactExport(JSON.parse(readFileSync(file, 'utf8'))), null, 2));
  } catch (error) { console.error(error.name === 'Error' ? error.message : 'Compaction failed'); process.exitCode = 1; }
}
