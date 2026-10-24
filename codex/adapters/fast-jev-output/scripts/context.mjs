import { saveContext } from '../dist/codex/context.js';
import { stdinJSON } from './shared.mjs';
try {
  const event = stdinJSON();
  if (event.tool_name === 'exec_command') event.tool_name = 'Bash';
  await saveContext(event);
} catch { /* Context collection must not block shell execution. */ }
console.log('{}');
