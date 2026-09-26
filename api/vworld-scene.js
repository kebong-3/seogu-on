import { allowRead, safeDomain } from '../server/http.js';
function attr(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export default function handler(req, res) {
  if (!allowRead(req, res)) return;
  const key = process.env.VWORLD_BROWSER_KEY, domain = safeDomain(process.env.VWORLD_DOMAIN || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  if (!key || !domain) {
    res.statusCode = 503;
    res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><body style="font-family:system-ui;background:#122332;color:#e8f2f4;padding:35px"><h2>브이월드 3D 키 미설정</h2><p>Vercel에 VWORLD_BROWSER_KEY와 VWORLD_DOMAIN을 등록하고 재배포하세요.</p></body></html>'); return;
  }
  const sdk = new URL('https://map.vworld.kr/js/webglMapInit.js.do'); sdk.searchParams.set('version', '3.0'); sdk.searchParams.set('apiKey', key); sdk.searchParams.set('domain', domain);
  // The SDK uses parser-time document.write. Isolate it in a same-origin iframe rather than dynamically injecting it into the application.
  res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>서구온 · 브이월드 3D</title><link rel="stylesheet" href="/src/vworld-frame.css"><script src="${attr(sdk.toString())}"></script></head><body><div id="vmap"></div><div id="frame-notice">브이월드 연결 중 · 제공기관 로고와 출처를 유지합니다.</div><script src="/src/vworld-frame.js"></script></body></html>`);
}
