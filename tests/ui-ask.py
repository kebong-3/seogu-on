"""오프라인 화면 검사: "지도에게 묻기" 패널.

실행:  python3 tests/ui-ask.py            (저장소 최상위에서)
필요:  pip install playwright && python -m playwright install chromium

- 로컬 개발 서버(scripts/dev.mjs)를 띄우고(기본 포트 4173, 사용 중이면 빈 포트) 외부 주소는 모두 차단한다.
- GEMINI_API_KEY 를 비워 규칙 기반 모드로 실제 /api/ask 를 부른다. AI 답변·오류 화면은 가짜 응답으로 확인한다.
- 지도는 오프라인 엔진만 본다: 경계도(?map=boundary)와 밝은 도시모형(?map=clean). 브이월드 3D·OSM 경량지도 검증이 아니다.
- 화면 캡처는 SEOON_TEST_OUTPUT(기본 evidence/ui-ask/)에 ask-{폭}.png 로 저장한다.
"""
import json, os, socket, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('SEOON_TEST_OUTPUT', ROOT / 'evidence' / 'ui-ask'))
OUT.mkdir(parents=True, exist_ok=True)
SIZES = [(360, 740), (414, 896), (1440, 900)]
COMPACT = 820
CHIP = '풍암동에서 그늘막이 150m 안에 없는 버스정류장은?'
results = []


def check(name, ok, detail=None):
    results.append({'name': name, 'passed': bool(ok), 'detail': detail})
    print(('ok   ' if ok else 'FAIL ') + name + ('' if ok else f'  {detail}'), flush=True)


def pick_port():
    with socket.socket() as s:
        try:
            s.bind(('127.0.0.1', 4173))
            return 4173
        except OSError:
            pass
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


# 경계도 캔버스에서 결과 지점 색(#ff6a3d)에 가까운 화소 수
ORANGE = '''() => { const c = document.querySelector('.boundary-canvas'); if (!c) return -1;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 255) < 12 && Math.abs(d[i + 1] - 106) < 14 && Math.abs(d[i + 2] - 61) < 14) n++;
  return n; }'''

LAYOUT = '''() => { const iw = innerWidth, box = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); };
  const body = document.getElementById('detail-body');
  const small = [...document.querySelectorAll('#detail-panel button')].filter(e => e.offsetParent).map(e => [e.dataset.action || e.textContent.trim().slice(0, 8), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]).filter(v => v[1] < 40 || v[2] < 40);
  return { scrollWidth: document.documentElement.scrollWidth, iw, detail: box('#detail-panel'), input: box('#ask-question'), submit: box('#ask-submit'),
    bodyOverflow: body.scrollWidth - body.clientWidth, small }; }'''


def open_panel(page, base, width, height, engine='boundary'):
    page.set_viewport_size({'width': width, 'height': height})
    page.goto(f'{base}/?map={engine}', wait_until='domcontentloaded')
    page.evaluate("try { localStorage.clear() } catch (e) {}")
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('.boundary-canvas' if engine == 'boundary' else 'iframe.city-frame')
    page.wait_for_timeout(1500)
    if width <= COMPACT:
        page.click('#show-panels')
        page.wait_for_timeout(200)
    page.click('[data-action=ask-ai]')
    page.wait_for_selector('#ask-question')


def run(page, base, width, height):
    tag = f'{width}px'
    compact = width <= COMPACT
    open_panel(page, base, width, height)
    check(f'{tag}: home card opens the panel titled 지도에게 묻기', page.inner_text('#detail-title') == '지도에게 묻기')
    scope = page.inner_text('.ask-scope')
    check(f'{tag}: panel says it answers from 수록 자료 only and counts are not a full inventory', '수록 자료만' in scope and '전체 시설 수가 아니' in scope, scope)
    check(f'{tag}: question box has a label, a length cap and 4–6 example chips', page.get_attribute('label[for=ask-question]', 'class') == 'ask-label' and page.get_attribute('#ask-question', 'maxlength') == '300' and 4 <= page.locator('.ask-chip').count() <= 6)
    m = page.evaluate(LAYOUT)
    check(f'{tag}: input stays usable (at least 150px wide, inside the panel, 묻기 button beside it)', m['input'] and m['submit'] and m['input'][2] - m['input'][0] >= 150 and m['submit'][2] <= m['detail'][2] and m['input'][0] >= m['detail'][0], m)
    check(f'{tag}: no horizontal scroll before asking', m['scrollWidth'] <= width and m['bodyOverflow'] <= 1, m)
    check(f'{tag}: tap targets in the panel are at least 40px', not m['small'], m['small'])
    before = page.evaluate(ORANGE)

    # 예시 단추 → 규칙 기반 답
    page.locator('.ask-chip', has_text=CHIP).click()
    page.wait_for_selector('.ask-answer', timeout=15000)
    page.wait_for_timeout(700)
    answer = page.inner_text('.ask-text')
    check(f'{tag}: example chip fills the box and returns an answer with tool numbers', page.input_value('#ask-question') == CHIP and '수록 지점' in answer and '현장 확인 전 후보' in answer, answer[:120])
    check(f'{tag}: badge says 규칙 기반 (no key on the local server)', page.inner_text('.ask-badge') == '규칙 기반' and '규칙 기반 답변입니다' in page.inner_text('.ask-notice'))
    evidence = page.inner_text('.ask-evidence')
    check(f'{tag}: 근거 lists the tool step, sources with dates and caveats', all(t in evidence for t in ['근거', '서비스 사각지대 분석', '출처와 기준일', '자료의 한계', '기준']) and page.locator('.ask-caveats li').count() >= 3, evidence[:160])
    rows = page.locator('.ask-point').count()
    listed = page.inner_text('.ask-results')
    check(f'{tag}: result list is shown in the panel and labelled as not a full inventory', rows >= 1 and '전체 목록 아님' in listed and '지도에' in listed, listed[:120])
    check(f'{tag}: scope switched to 풍암동 and the result layer is registered', page.inner_text('#scope-title') == '풍암동' and '지도에게 묻기 결과' in page.inner_text('#layer-options') if not compact else page.inner_text('#scope-title') == '풍암동')
    after = page.evaluate(ORANGE)
    check(f'{tag}: boundary map draws the highlighted points', after > before + 20, [before, after])
    m = page.evaluate(LAYOUT)
    check(f'{tag}: no horizontal scroll with the answer shown', m['scrollWidth'] <= width and m['bodyOverflow'] <= 1, m)
    check(f'{tag}: answer panel fits the viewport', m['detail'][0] >= 0 and m['detail'][2] <= width, m['detail'])
    check(f'{tag}: tap targets stay at least 40px with results', not m['small'], m['small'])
    page.screenshot(path=str(OUT / f'ask-{width}.png'))

    if compact:
        # 좁은 화면: 패널이 지도를 덮으므로 '지도에서 보기'로 닫아 결과를 본다.
        page.click('[data-action=ask-show-map]')
        page.wait_for_timeout(400)
        check(f'{tag}: 지도에서 보기 closes the panel and keeps the highlight', page.is_hidden('#detail-panel') and page.evaluate(ORANGE) > before + 20)
        page.screenshot(path=str(OUT / f'ask-{width}-map.png'))
        page.click('#show-panels')
        page.click('[data-action=ask-ai]')
        page.wait_for_selector('.ask-answer')
        check(f'{tag}: reopening the panel keeps the last answer and question', page.input_value('#ask-question') == CHIP and page.locator('.ask-point').count() == rows)

    # Enter 로 묻기 + 답변 중 표시 + 이전 강조 지우기
    held = []
    page.route('**/api/ask', lambda r: held.append(r))  # 응답을 잠시 붙잡아 '답변 중' 상태를 본다.
    page.fill('#ask-question', '여권 발급은 어떻게 해?')
    page.press('#ask-question', 'Enter')
    page.wait_for_selector('.ask-status')
    busy = page.inner_text('.ask-status')
    check(f'{tag}: Enter submits and shows 답변 중 with the button disabled', '답변 중' in busy and page.is_disabled('#ask-submit') and len(held) == 1, busy)
    check(f'{tag}: the previous highlight is cleared as soon as a new question is asked', page.evaluate(ORANGE) <= before + 2, page.evaluate(ORANGE))
    sent = json.loads(held[0].request.post_data)
    check(f'{tag}: request carries the question, the selected dong and earlier questions only', sent.get('question') == '여권 발급은 어떻게 해?' and sent.get('dongId') == 'seogu-17' and sent.get('history') == [{'role': 'user', 'text': CHIP}], sent)
    held[0].continue_()
    page.wait_for_selector('.ask-answer')
    page.unroute('**/api/ask')
    helped = page.inner_text('.ask-text')
    check(f'{tag}: an unanswerable question gets guidance with examples, not an error', '답하는 방법을 찾지 못했습니다' in helped and '예:' in helped and page.locator('.ask-error').count() == 0, helped[:100])
    check(f'{tag}: no result list is shown for an answer without map points', page.locator('.ask-point').count() == 0)

    # AI 답변 표시(가짜 응답)와 오류 화면
    fake = {'ok': True, 'mode': 'llm', 'model': 'test', 'answer': '시험용 AI 답입니다 <b>굵게</b>.', 'steps': [{'tool': 'dong_profile', 'args': {'dong': '풍암동'}, 'summary': '요약', 'ok': True}],
            'map': {'focus': {'dongId': 'seogu-17'}}, 'sources': [{'name': '시험 출처', 'date': '2026-01-01', 'dateBasis': '자료 기준일'}], 'caveats': ['시험 한계']}
    page.route('**/api/ask', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(fake)))
    page.fill('#ask-question', '풍암동 요약')
    page.click('#ask-submit')
    page.wait_for_selector('.ask-badge.llm')
    check(f'{tag}: AI answers get the AI 답변 badge and text is escaped', page.inner_text('.ask-badge') == 'AI 답변' and '<b>굵게</b>' in page.inner_text('.ask-text') and page.locator('.ask-text b').count() == 0)
    page.unroute('**/api/ask')
    page.route('**/api/ask', lambda r: r.fulfill(status=429, content_type='application/json', body=json.dumps({'ok': False, 'error': '질문이 많습니다. 1분 뒤에 다시 시도하세요.', 'code': 'RATE_LIMITED'})))
    page.click('#ask-submit')
    page.wait_for_selector('.ask-error')
    check(f'{tag}: errors are shown in Korean inside the panel', '질문이 많습니다' in page.inner_text('.ask-error') and page.get_attribute('.ask-error', 'role') == 'alert')
    page.unroute('**/api/ask')
    m = page.evaluate(LAYOUT)
    check(f'{tag}: no horizontal scroll in the error state', m['scrollWidth'] <= width and m['bodyOverflow'] <= 1, m)

    # 밤 테마에서도 글자가 배경과 구분된다.
    page.evaluate("document.documentElement.dataset.uiTheme = 'night'")
    page.route('**/api/ask', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(fake)))
    page.click('#ask-submit')
    page.wait_for_selector('.ask-answer')
    page.unroute('**/api/ask')
    contrast = page.evaluate('''() => { const lum = c => { const [r, g, b] = c.match(/[\\d.]+/g).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
      const text = getComputedStyle(document.querySelector('.ask-text')).color, bg = getComputedStyle(document.querySelector('.ask-answer')).backgroundColor;
      const a = lum(text), b = lum(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }''')
    check(f'{tag}: night theme keeps readable contrast for the answer text', contrast >= 4.5, round(contrast, 2))
    page.screenshot(path=str(OUT / f'ask-{width}-night.png'))
    page.evaluate("document.documentElement.dataset.uiTheme = 'day'")


def run_clean_model(page, base):
    """밝은 도시모형(로컬 Cesium): 화면이 뜨면 결과를 그린 모습을 캡처한다. WebGL 이 없으면 답·목록만 확인한다."""
    open_panel(page, base, 1440, 900, engine='clean')
    try:
        page.wait_for_function("document.getElementById('engine-state').textContent.includes('도시모형')", timeout=25000)
        ready = True
    except Exception:
        ready = False
    page.locator('.ask-chip', has_text=CHIP).click()
    page.wait_for_selector('.ask-answer', timeout=15000)
    check('clean model: the answer and result list show whether or not the 3D engine is ready', page.locator('.ask-point').count() >= 1 and '수록 지점' in page.inner_text('.ask-text'), f'engine ready={ready}')
    page.wait_for_timeout(4500 if ready else 500)
    page.screenshot(path=str(OUT / 'ask-1440-clean.png'))
    print(f'note clean model engine ready={ready} (screenshot must be judged by eye)', flush=True)


def main():
    port = pick_port()
    env = {**os.environ, 'PORT': str(port)}
    for key in ['GEMINI_API_KEY', 'KMA_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY', 'AIRKOREA_SERVICE_KEY', 'VWORLD_BROWSER_KEY', 'VWORLD_API_KEY']:
        env[key] = ''
    server = subprocess.Popen(['node', 'scripts/dev.mjs'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    base = f'http://127.0.0.1:{port}'
    try:
        for _ in range(60):
            try:
                socket.create_connection(('127.0.0.1', port), timeout=0.5).close()
                break
            except OSError:
                time.sleep(0.25)
        with sync_playwright() as p:
            executable = os.environ.get('SEOON_CHROMIUM') or None
            browser = p.chromium.launch(executable_path=executable) if executable else p.chromium.launch()
            for width, height in SIZES:
                # 폭마다 새 창: IP별 분당 10회 제한과 무관하게 화면 상태를 처음부터 본다.
                page = browser.new_page()
                errors = []
                page.on('pageerror', lambda e, errors=errors: errors.append(str(e)))
                page.route('**/*', lambda r: r.continue_() if r.request.url.startswith(base) else r.abort())
                try:
                    run(page, base, width, height)
                except Exception as e:
                    check(f'{width}px: flow completed', False, repr(e)[:300])
                check(f'{width}px: no uncaught page errors', not errors, errors[:3])
                page.close()
            page = browser.new_page()
            page.route('**/*', lambda r: r.continue_() if r.request.url.startswith(base) else r.abort())
            try:
                run_clean_model(page, base)
            except Exception as e:
                check('clean model: flow completed', False, repr(e)[:300])
            browser.close()
    finally:
        server.terminate()
    passed = sum(r['passed'] for r in results)
    (OUT / 'results.json').write_text(json.dumps({'scope': 'offline boundary view and local clean model only; rules mode; NOT live Gemini, VWorld 3D or OSM tiles', 'checks': len(results), 'passed': passed, 'results': results}, ensure_ascii=False, indent=2))
    print(json.dumps({'checks': len(results), 'passed': passed}))
    sys.exit(0 if passed == len(results) else 1)


if __name__ == '__main__':
    main()
