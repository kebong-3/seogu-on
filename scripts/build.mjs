import {ensureRuntime} from './ensure-runtime.mjs';
await ensureRuntime();
import {createHash} from 'node:crypto';
import { mkdir, cp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
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
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const digest=createHash('sha256');
async function hashFiles(dir){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=resolve(dir,entry.name);if(entry.isDirectory())await hashFiles(path);else{digest.update(path.slice(root.length));digest.update(await readFile(path));}}}
for(const dir of ['src','server','api'])await hashFiles(resolve(root,dir));
await writeFile(resolve(out,'data/release.json'),JSON.stringify({version:pkg.version,builtAt:new Date().toISOString(),codeSha256:digest.digest('hex'),datasetVersion:'0.4.0 + civic/address review 0.4.1',meaning:'Build identifier only. Not proof of deployed API authentication or source data freshness.'},null,2));
// Never copy .env, server source, test fixtures or development files to the public bundle.
console.log('SEO:ON static build complete: dist/ (zero build dependencies).');
console.log('Vercel handles root api/*.js separately. Map rendering requires external map/CDN access.');
