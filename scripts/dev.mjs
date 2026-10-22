import {ensureRuntime} from './ensure-runtime.mjs';
// 배포본 미리보기는 빌드에 포함된 실행자료를 그대로 사용한다.
if (!process.argv.includes('--dist')) await ensureRuntime();
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv.includes('--dist') ? resolve(root, 'dist') : root;
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg':'image/jpeg', '.wasm':'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'); const path = decodeURIComponent(url.pathname);
    if (path.startsWith('/api/')) {
      let name = path.slice(5);
      // vercel.json 의 rewrites 와 같은 규칙: /api/mcp, /api/ask → api/ai.js?route=...
      if (['mcp', 'ask', 'space-review', 'region-profile'].includes(name)) {
        req.url = `/api/ai?route=${name}${url.search ? `&${url.search.slice(1)}` : ''}`;
        name = 'ai';
      }
      if (!['config', 'vworld', 'vworld-scene', 'public-data', 'layers', 'weather', 'geocode', 'city-config', 'city-scene', 'city-data', 'city-wms', 'ai'].includes(name)) { res.writeHead(404); res.end('Not found'); return; }
      const mod = await import(pathToFileURL(resolve(root, 'api', `${name}.js`)).href);
      await mod.default(req, res); return;
    }
    let filePath;
    if (path === '/') filePath = resolve(base, 'index.html');
    else if (/^\/(src|shared|data|vendor|brand)\//.test(path) || path === '/favicon.svg' || path === '/index.html' || path === '/classic.html' || path === '/model.html') {
      const isPublic = path.startsWith('/brand/') || path.startsWith('/vendor/') || path === '/model.html' || path.startsWith('/data/') || path === '/favicon.svg';
      filePath = resolve(base, process.argv.includes('--dist') || !isPublic ? `.${path}` : `public${path}`);
    } else { res.writeHead(404); res.end('Not found'); return; }
    const rel = relative(base, filePath);
    if (rel.startsWith(`..${sep}`) || rel === '..') { res.writeHead(403); res.end('Forbidden'); return; }
    if (!(await stat(filePath)).isFile()) throw new Error('not file');
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(await readFile(filePath));
  } catch (error) { if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('요청한 자료를 찾지 못했습니다.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`SEO:ON running: http://127.0.0.1:${port}\nOffline design preview: http://127.0.0.1:${port}/?preview=1`));
