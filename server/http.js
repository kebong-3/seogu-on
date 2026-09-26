/** Small read-only API utilities. No arbitrary user-supplied upstream URLs. */
const rateBuckets = new Map();
export function respond(res, status, data, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheSeconds ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=60` : 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}
export function queryValue(req, name) {
  return new URL(req.url || '/', 'https://local.invalid').searchParams.get(name) || '';
}
export function allowRead(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); respond(res, 405, { ok: false, error: 'GET 요청만 지원합니다.' }); return false; }
  const origin = req.headers?.origin, host = req.headers?.host;
  if (origin) {
    try { if (new URL(origin).host !== host) { respond(res, 403, { ok: false, error: '다른 웹사이트의 요청은 허용하지 않습니다.' }); return false; } }
    catch { respond(res, 403, { ok: false, error: '요청 출처 형식을 확인하세요.' }); return false; }
  }
  // Best-effort per-instance limit. Not a global limit on serverless deployments.
  const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'anonymous').split(',')[0].trim();
  const now = Date.now(), old = rateBuckets.get(ip);
  if (!old || now - old.start >= 60000) rateBuckets.set(ip, { start: now, count: 1 });
  else if (++old.count > 60) { res.setHeader('Retry-After', '60'); respond(res, 429, { ok: false, error: '요청이 많습니다. 잠시 후 다시 시도하세요.' }); return false; }
  if (rateBuckets.size > 5000) { for (const [key, value] of rateBuckets) if (now - value.start > 60000) rateBuckets.delete(key); }
  return true;
}
export function safeDomain(raw) {
  try { const u = new URL(raw); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.origin : ''; }
  catch { return ''; }
}
export async function fetchJsonLimited(url, timeoutMs = 8500, fetcher = fetch) {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`UPSTREAM_HTTP_${response.status}`);
  if (Number(response.headers.get('content-length') || 0) > 2 * 1024 * 1024) throw new Error('UPSTREAM_TOO_LARGE');
  const reader = response.body?.getReader();
  let text;
  if (!reader) text = await response.text();
  else {
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('UPSTREAM_TOO_LARGE'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    text = new TextDecoder().decode(bytes);
  }
  try { return JSON.parse(text); } catch { throw new Error('UPSTREAM_NOT_JSON'); }
}
export function upstreamMessage(error) {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return '제공기관 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.';
  if (error.message === 'UPSTREAM_NOT_JSON') return '제공기관이 JSON이 아닌 응답을 반환했습니다. API 명세와 인증 상태를 확인하세요.';
  if (error.message === 'UPSTREAM_TOO_LARGE') return '응답이 2MB를 넘었습니다. API 조회 범위를 줄여주세요.';
  return '제공기관 연결에 실패했습니다. API 키·서비스 승인·요청 명세를 확인하세요.';
}
