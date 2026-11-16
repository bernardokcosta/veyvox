import { createJunoPreview } from './junoPreview.js';

const app = createJunoPreview();
await app.listen({ host: '127.0.0.1', port: 39998 });
console.log('Pizza preview API: http://127.0.0.1:39998 (in-memory only)');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
