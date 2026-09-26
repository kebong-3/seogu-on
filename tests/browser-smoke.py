"""Optional offline UI regression test. No live map/API validation.
Run after: node scripts/make-preview.mjs
Requires Python Playwright and a locally installed Chromium browser.
"""
from pathlib import Path
import json, os, tempfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PREVIEW = ROOT.parent / 'seo-on-design-preview.html'
OUTPUT = ROOT / 'docs' / 'browser-test-results.json'
checks = []
errors = []

def ok(name, condition=True):
    if not condition:
        raise AssertionError(name)
    checks.append({'name': name, 'passed': True})

with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
    browser = playwright.chromium.launch(headless=True, executable_path=executable,
                                        args=['--no-sandbox', '--disable-dev-shm-usage'])
    context = browser.new_context(viewport={'width': 1600, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    # set_content intentionally tests standalone rendering without bypassing browser navigation policy.
    page.set_content(PREVIEW.read_text(), wait_until='load')
    page.wait_for_selector('#map-stage canvas')
    ok('initial facility count is 48', '48' in page.locator('.metric strong').nth(0).inner_text())
    ok('initial synthetic total is 3732', '3,732' in page.locator('.metric strong').nth(1).inner_text())
    ok('synthetic geometry and data disclosure visible', '가상 도시' in page.locator('#map-disclosure').inner_text() and '합성 시연' in page.locator('#map-disclosure').inner_text())

    page.locator('#layers-panel label').filter(has=page.locator('[data-category="park"]')).click()
    ok('category filter updates linked count', '36' in page.locator('.metric strong').nth(0).inner_text())
    page.locator('#layers-panel label').filter(has=page.locator('[data-category="park"]')).click()
    page.locator('#search-input').fill('시연 01')
    page.locator('#search-input').press('Enter')
    ok('registered name search narrows result', page.locator('.metric strong').nth(0).inner_text().strip() == '1개')
    page.locator('[data-act="clear-search"]').click()
    page.locator('#timeline [data-month="2026-02"]').click()
    ok('month drives timeline and analysis', '2026.02' in page.locator('#timeline').inner_text() and '2026-02' in page.locator('.insight-card').inner_text())
    page.locator('#timeline [data-month="2026-07"]').click()

    page.locator('[data-act="3d"]').click()
    ok('top-down switch changes dimension state', page.locator('#dimension-button').inner_text() == '2D')
    page.locator('[data-act="3d"]').click()
    page.locator('[data-act="theme"]').click()
    ok('light theme changes html state', page.locator('html').get_attribute('data-theme') == 'light')
    page.locator('[data-act="theme"]').click()

    page.locator('[data-workspace="access"]').click()
    page.locator('#insights [data-act="pick-radius"]').click()
    page.locator('#map-stage canvas').click(position={'x': 820, 'y': 430})
    ok('map click creates radius condition', '반경 해제' in page.locator('#insights').inner_text())
    ok('radius is explicitly straight-line', '직선거리' in page.locator('#insights').inner_text())
    page.locator('[data-radius="800"]').click()
    ok('radius buttons update selected state', 'active' in page.locator('[data-radius="800"]').get_attribute('class'))
    page.locator('[data-act="clear-radius"]').click()
    page.locator('[data-act="scenario"]').click()
    page.locator('#map-stage canvas').click(position={'x': 790, 'y': 380})
    ok('scenario is explicitly not demand prediction', '수요 예측이 아닙니다' in page.locator('#toast').inner_text())
    page.locator('[data-act="scenario"]').click()
    ok('scenario can be removed', '가상 시설을 지웠습니다' in page.locator('#toast').inner_text())

    page.locator('.icon-rail [data-act="compare"]').click()
    ok('snapshot A stored', 'VIEW A' in page.locator('#dialog-body').inner_text())
    page.locator('[data-act="close-dialog"]').click()
    page.locator('#timeline [data-month="2026-08"]').click()
    page.locator('.icon-rail [data-act="compare"]').click()
    ok('snapshot B compares explicit conditions', 'VIEW B' in page.locator('#dialog-body').inner_text())
    with page.expect_download() as dl:
        page.locator('[data-act="save-comparison"]').click()
    snapshots = json.loads(Path(dl.value.path()).read_text())
    ok('JSON export keeps both condition snapshots and demo flag', len(snapshots) == 2 and all(s['demo'] for s in snapshots))
    page.locator('[data-act="close-dialog"]').click()

    page.locator('[data-workspace="projects"]').click()
    ok('project method discloses representative point not polygon overlap', '실제 사업구역 중첩 판정이 아닙니다' in page.locator('#insights').inner_text())
    page.locator('[data-act="list"]').click()
    ok('facility table linked to current count', page.locator('.data-table tbody tr').count() == 48)
    with page.expect_download() as dl:
        page.locator('#dialog [data-act="csv"]').click()
    csv = Path(dl.value.path()).read_text(encoding='utf-8-sig')
    ok('CSV includes disclosure and source columns', '합성 시연' in csv and '기준일' in csv)
    page.locator('.data-table [data-feature]').first.click()
    ok('facility row opens selection details', page.locator('.selection-card').count() == 1)

    with page.expect_download() as dl:
        page.locator('.header-actions [data-act="report"]').click()
    report = Path(dl.value.path()).read_text()
    ok('HTML report contains map image and synthetic disclosure', 'data:image/png' in report and '실제 서구 시설' in report and '가상 도시' in report)
    page.locator('[data-act="home"]').click()
    page.locator('.icon-rail [data-act="data"]').click()
    ok('missing API settings visible without secrets', '미설정' in page.locator('#dialog-body').inner_text() and 'VWORLD_BROWSER_KEY' in page.locator('#dialog-body').inner_text())
    page.locator('[data-act="close-dialog"]').click()

    def upload(features):
        payload = json.dumps({'type': 'FeatureCollection', 'features': features}, ensure_ascii=False).encode()
        page.locator('#file-input').set_input_files({'name': 'browser-fixture.geojson', 'mimeType': 'application/geo+json', 'buffer': payload})
        page.wait_for_function("document.querySelector('#toast').textContent.includes('불러오기 완료')")

    point = {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [126.859, 35.151]}, 'properties': {
        'id': 'ui-fixture-1', 'name': '<img src=x onerror=window.injected=true>', 'category': 'park',
        'sourceName': '자동시험 fixture · 실제시설 아님', 'sourceDate': '2026-09-01', 'monthly': {'2026-07': None, '2026-08': 0},
        'metricName': '이용건수', 'metricUnit': '건'
    }}
    upload([point])
    page.locator('#timeline [data-month="2026-07"]').click()
    ok('uploaded data replaces demo, no mixed datasets', page.locator('.metric strong').nth(0).inner_text().strip() == '1개' and '사용자 자료' in page.locator('#insights').inner_text())
    ok('null observations stay missing', '—' in page.locator('.metric strong').nth(1).inner_text())
    page.locator('#timeline [data-month="2026-08"]').click()
    ok('zero observations remain zero', page.locator('.metric strong').nth(1).inner_text().strip() == '0건')
    ok('untrusted facility name is text not image or executed JS', page.locator('#insights img').count() == 0 and page.evaluate('window.injected === undefined'))

    # Re-render from bundled source for deterministic screenshots and mobile state.
    page.set_content(PREVIEW.read_text(), wait_until='load')
    page.wait_for_selector('#map-stage canvas')
    page.wait_for_timeout(300)
    if page.locator('html').get_attribute('data-theme') != 'dark':
        page.locator('[data-act="theme"]').click()
    page.screenshot(path=str(ROOT.parent / 'seo-on-preview-dark.png'), full_page=True)
    page.locator('[data-act="theme"]').click()
    page.screenshot(path=str(ROOT.parent / 'seo-on-preview-light.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(ROOT.parent / 'seo-on-preview-mobile.png'), full_page=True)
    ok('mobile has no horizontal overflow', not page.evaluate('document.documentElement.scrollWidth > innerWidth'))
    page.locator('[data-act="mobile-panel"]').click()
    ok('mobile analysis opens', page.locator('#insights').is_visible())
    page.locator('[data-act="mobile-panel"]').click()
    page.locator('[data-act="mobile-settings"]').click()
    ok('mobile map/layer settings reachable', page.locator('#mobile-layer-settings').is_visible())
    page.locator('#mobile-layer-settings label').filter(has=page.locator('[data-category="park"]')).click()
    ok('mobile category filter persists after render', not page.locator('#mobile-layer-settings [data-category="park"]').is_checked())
    page.locator('[data-act="close-dialog"]').click()
    ok('no unhandled browser errors', not errors)
    context.close()
    browser.close()

OUTPUT.write_text(json.dumps({'environment': 'Chromium via Playwright set_content; synthetic renderer only',
                             'liveMapTested': False, 'liveApiTested': False, 'vercelDeploymentTested': False,
                             'passed': len(checks), 'checks': checks, 'browserErrors': errors}, ensure_ascii=False, indent=2))
print(f'{len(checks)} offline browser checks passed. No live map/API/deployment validation.')
