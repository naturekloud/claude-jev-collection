import { keyEnv } from './shared.mjs';
const env = keyEnv();
if (env.TYPESAFE_API_KEY) process.env.TYPESAFE_API_KEY = env.TYPESAFE_API_KEY;
await import('../dist/codex/run.js');
