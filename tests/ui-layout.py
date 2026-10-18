"""오프라인 화면 배치 검사 (v0.8 UI 정리분).

실행:  python3 tests/ui-layout.py            (저장소 최상위에서)
필요:  pip install playwright && python -m playwright install chromium

- 로컬 개발 서버(scripts/dev.mjs)를 임시 포트로 띄우고 '경계도 보기'(?map=boundary)만 확인한다.
- 외부 주소(브이월드·OSM 타일·CDN)는 모두 차단한다. 실제 3D 지도·외부 API 검증이 아니다.
- 화면 캡처는 evidence/ui-layout/ 에 저장한다(.gitignore 대상).
"""
import json, os, socket, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('SEOON_TEST_OUTPUT', ROOT / 'evidence' / 'ui-layout'))
OUT.mkdir(parents=True, exist_ok=True)
SIZES = [(360, 740), (414, 896), (672, 900), (1024, 768), (1440, 900)]
COMPACT = 820
results = []


def check(name, ok, detail=None):
    results.append({'name': name, 'passed': bool(ok), 'detail': detail})
    print(('ok   ' if ok else 'FAIL ') + name + ('' if ok else f'  {detail}'), flush=True)


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


MEASURE = '''() => {
  const iw = innerWidth, visible = e => { if (e.closest('[hidden]')) return false; const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.right > 0 && r.left < iw; };
  const clipped = e => { for (let p = e.parentElement; p && p.id !== 'app'; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return true; return false; };
  const closedDetails = e => { const d = e.closest('details'); return d && !d.open && e.tagName !== 'SUMMARY' && !e.closest('summary'); };
  const outside = [...document.querySelectorAll('#app *')].filter(e => visible(e) && !clipped(e) && (e.getBoundingClientRect().right > iw + 1 || e.getBoundingClientRect().left < -1)).map(e => e.id || e.className).slice(0, 8);
  const small = [...document.querySelectorAll('#app button, #app summary, #app a')].filter(e => visible(e) && !closedDetails(e)).map(e => [e.dataset.action || e.id || e.textContent.trim().slice(0, 10), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]).filter(v => v[1] < 40 || v[2] < 40);
  const box = s => { const e = document.querySelector(s); if (!e || !visible(e)) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); };
  const ribbon = document.querySelector('.live-ribbon');
  return { scrollWidth: document.documentElement.scrollWidth, iw, outside, small,
    ribbon: [ribbon.scrollWidth, ribbon.clientWidth], readings: [...ribbon.querySelectorAll('.live-reading')].map(e => box('#' + (e.querySelector('strong').id))).filter(Boolean).length,
    dock: box('.bottom-dock'), camera: box('.camera-controls'), panel: box('#district-panel'), detail: box('#detail-panel'), opener: box('#show-panels'),
    primary: [...document.querySelectorAll('.home-primary .home-card')].filter(visible).map(e => e.dataset.action) };
}'''


def overlap(a, b):
    return bool(a and b and a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3])


def run(page, base, width, height):
    tag = f'{width}px'
    page.set_viewport_size({'width': width, 'height': height})
    page.goto(base + '/?map=boundary', wait_until='domcontentloaded')
    page.evaluate("try { localStorage.clear() } catch (e) {}")  # 폭마다 처음 방문한 상태에서 시작
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('.boundary-canvas')
    page.wait_for_timeout(1500)
    m = page.evaluate(MEASURE)
    page.screenshot(path=str(OUT / f'overview-{width}.png'))
    check(f'{tag}: no horizontal page scroll', m['scrollWidth'] <= width, m['scrollWidth'])
    check(f'{tag}: nothing sticks out of the viewport', not m['outside'], m['outside'])
    check(f'{tag}: status ribbon is not cut off', m['ribbon'][0] <= m['ribbon'][1] + 1 and m['readings'] == 4, m['ribbon'])
    check(f'{tag}: tap targets are at least 40px', not m['small'], m['small'])
    check(f'{tag}: category dock stays inside the map and off the side panel', m['dock'] and m['dock'][2] <= width and not overlap(m['dock'], m['panel']), [m['dock'], m['panel']])
    check(f'{tag}: dong BI and names remain without number badges or legend', page.evaluate("document.querySelectorAll('.dong-button img').length === 18 && document.querySelectorAll('.dong-button span').length === 18 && !document.querySelector('.dong-no, #dong-legend, .dong-label.number')"))

    compact = width <= COMPACT
    if compact:
        check(f'{tag}: side panel starts closed with an opener button', m['panel'] is None and m['opener'] is not None, [m['panel'], m['opener']])
        page.click('#show-panels')
        page.wait_for_timeout(250)
        m = page.evaluate(MEASURE)
        check(f'{tag}: open drawer hides dock and camera buttons instead of overlapping', m['panel'] and m['dock'] is None and m['camera'] is None, [m['dock'], m['camera']])
        check(f'{tag}: drawer fits the viewport', m['panel'][0] >= 0 and m['panel'][2] <= width, m['panel'])
    check(f'{tag}: at most three primary entry points, heat planning first', m['primary'] == ['heat-plan', 'ask-ai', 'infra'], m['primary'])
    check(f'{tag}: side panel list scrolls independently', page.evaluate("(() => { const e = document.getElementById('sidebar-scroll'); return getComputedStyle(e).overflowY === 'auto' && e.scrollHeight > e.clientHeight; })()"))

    check(f'{tag}: 더 보기 starts collapsed', page.get_attribute('#home-more-toggle', 'aria-expanded') == 'false' and not page.is_visible('#home-more-list'))
    page.click('#home-more-toggle')
    page.wait_for_timeout(150)
    more = page.evaluate("[...document.querySelectorAll('#home-more-list button')].filter(e => e.offsetParent).map(e => e.dataset.action)")
    check(f'{tag}: 더 보기 reveals the remaining tools', all(a in more for a in ['native-sun', 'safety-hub', 'themes', 'city-questions', 'list', 'tools', 'report', 'settings']), more)
    check(f'{tag}: opened tools keep 40px tap targets', not page.evaluate(MEASURE)['small'], page.evaluate(MEASURE)['small'])
    page.screenshot(path=str(OUT / f'home-{width}.png'))

    # 대표 업무: 대안 비교 → 담당자 기록 → 보고서. 비용 미입력은 미산정.
    page.click('[data-action=heat-plan]')
    page.select_option('#heat-plan-form [name=scopeId]', label='풍암동')
    page.click('[data-action=heat-plan-calculate]')
    page.wait_for_selector('#hp-results-title')
    comparison = page.inner_text('.hp-table')
    check(f'{tag}: heat comparison uses real Pungam data and unknown costs', '17지점 / 7개 쉼터' in comparison and '3지점' in comparison and '미산정' in comparison, comparison)
    page.click('.hp-candidate summary >> nth=0')
    first = page.locator('.hp-candidate').first
    first.locator('textarea').fill('시험 기록: 보도 폭 확인 전 보류')
    first.locator('[data-field=choice]').select_option('exclude')
    page.click('[data-action=heat-plan-report]')
    report = page.locator('.hp-report').get_attribute('srcdoc')
    check(f'{tag}: report preserves review reason, comparison and source fingerprint', '시험 기록: 보도 폭 확인 전 보류' in report and 'SHA-256' in report and '담당자 검토용 초안' in report)
    page.screenshot(path=str(OUT / f'heat-report-{width}.png'))
    page.click('#detail-panel [data-action=heat-plan]')

    # 기존 그림자 검토 기능도 계속 도달할 수 있다.
    page.click('[data-action=heat-shade]')
    page.wait_for_selector('.scenario-summary')
    page.wait_for_timeout(300)
    summary = page.inner_text('.scenario-summary')
    check(f'{tag}: heat-shade opens the 5-minute shadow panel with layer summary', '3D 그림자' in page.inner_text('#detail-title') and '그늘막' in summary and '쿨링포그' in summary, summary[:80])
    check(f'{tag}: unreceived shelter data is shown as 미수신, not zero', '미수신' in summary and '0곳' not in summary, summary)
    m = page.evaluate(MEASURE)
    check(f'{tag}: detail panel fits and nothing overlaps it', m['detail'] and m['detail'][0] >= 0 and m['detail'][2] <= width and not overlap(m['detail'], m['dock']) and not overlap(m['detail'], m['camera']), [m['detail'], m['dock'], m['camera']])
    check(f'{tag}: detail panel scrolls independently', page.evaluate("getComputedStyle(document.getElementById('detail-body')).overflowY") in ('auto', 'scroll'))
    check(f'{tag}: no horizontal scroll with a panel open', m['scrollWidth'] <= width, m['scrollWidth'])
    page.screenshot(path=str(OUT / f'heat-shade-{width}.png'))

    # 관측자료 미수신 원인(키가 없는 로컬 서버이므로 NOT_CONFIGURED가 나와야 한다)
    page.click('[data-action=close-detail]')
    page.click('#live-air')
    page.wait_for_function("document.getElementById('detail-body').innerText.includes('NOT_CONFIGURED')")
    body = page.inner_text('#detail-body')
    check(f'{tag}: PM10 chip explains why it is 미수신 without leaking keys or URLs', '미수신' in body and 'AIRKOREA_SERVICE_KEY' in body and 'serviceKey' not in body and 'apis.data.go.kr' not in body, body[:120])
    check(f'{tag}: PM10 value itself stays 미수신', page.inner_text('#live-air') == '미수신' and 'NOT_CONFIGURED' in page.get_attribute('#live-air', 'title'))
    page.click('[data-action=close-detail]')


def main():
    port = free_port()
    env = {**os.environ, 'PORT': str(port)}
    for key in ['KMA_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY', 'AIRKOREA_SERVICE_KEY', 'VWORLD_BROWSER_KEY', 'VWORLD_API_KEY']:
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
            page = browser.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.route('**/*', lambda r: r.continue_() if r.request.url.startswith(base) else r.abort())
            for width, height in SIZES:
                try:
                    run(page, base, width, height)
                except Exception as e:  # 한 폭에서 멈춰도 나머지 폭을 계속 본다.
                    check(f'{width}px: flow completed', False, repr(e)[:300])
            check('no uncaught page errors', not errors, errors[:3])
            browser.close()
    finally:
        server.terminate()
    passed = sum(r['passed'] for r in results)
    (OUT / 'results.json').write_text(json.dumps({'scope': 'offline boundary view only; NOT live 3D or live API', 'checks': len(results), 'passed': passed, 'results': results}, ensure_ascii=False, indent=2))
    print(json.dumps({'checks': len(results), 'passed': passed}))
    sys.exit(0 if passed == len(results) else 1)


if __name__ == '__main__':
    main()
