/**
 * AI 연동용 단일 서버리스 함수. Vercel Hobby 의 함수 12개 제한 때문에
 * 여러 공개 경로를 이 파일 하나로 받는다(vercel.json rewrites 참고).
 *
 *   /api/mcp  → /api/ai?route=mcp   MCP 서버(읽기 전용 공간 질의)
 *   /api/ask  → /api/ai?route=ask   "지도에게 묻기"(같은 출처의 POST 만)
 *
 * 새 경로를 붙일 때는 처리기를 import 해서 ROUTES 에 한 줄만 추가하면 된다.
 * 각 처리기는 (req, res) 를 받아 스스로 메서드·CORS·요청 제한을 책임진다.
 */
import { handleAsk } from '../server/ai/ask.js';
import { handleMcp } from '../server/spatial/mcp.js';

const ROUTES = {
  mcp: handleMcp,
  ask: handleAsk,
};

/** rewrite 를 거친 요청(?route=)과 원래 경로(/api/mcp) 어느 쪽으로 와도 같은 경로를 고른다. */
function routeOf(req) {
  const url = new URL(req.url || '/', 'https://local.invalid');
  const fromQuery = url.searchParams.get('route') || (typeof req.query?.route === 'string' ? req.query.route : '');
  if (fromQuery) return fromQuery;
  const match = url.pathname.match(/^\/api\/([a-z-]+)\/?$/);
  return match && match[1] !== 'ai' ? match[1] : '';
}

export default async function handler(req, res) {
  const route = routeOf(req);
  const handle = Object.hasOwn(ROUTES, route) ? ROUTES[route] : null;
  if (!handle) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(JSON.stringify({ ok: false, error: '지원하지 않는 경로입니다.', code: 'ROUTE_NOT_FOUND' }));
    return;
  }
  await handle(req, res);
}
