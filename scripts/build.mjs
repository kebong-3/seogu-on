import { mkdir, cp, rm, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, 'index.html'), resolve(out, 'index.html'));
await cp(resolve(root, 'classic.html'), resolve(out, 'classic.html'));
await cp(resolve(root, 'src'), resolve(out, 'src'), { recursive: true });
await cp(resolve(root, 'public'), out, { recursive: true });
// Never copy .env, server source, test fixtures or development files to the public bundle.
console.log('SEO:ON static build complete: dist/ (zero build dependencies).');
console.log('Vercel handles root api/*.js separately. Map rendering requires external map/CDN access.');
