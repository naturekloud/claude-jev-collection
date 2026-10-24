import { handleHook } from '../src/hook.js';
import { keyEnv, stdinJSON } from './shared.mjs';
try {
  console.log(JSON.stringify(await handleHook(stdinJSON(), { agent: 'codex', env: keyEnv() }) ?? {}));
} catch {
  // Preserve a visible warning when the upstream native guard cannot assess a call.
  console.log(JSON.stringify({ systemMessage: 'jev-guard: assessment unavailable; Codex sandbox and approval policy still apply.' }));
}
