"""Offline UI integration tests. Real app, camera director, geometry and bundled data.
Transport is explicitly replaced with in-memory fixtures; BoundaryView is used.
This does NOT test VWorld authentication, terrain, GPU rendering, or live APIs.
Run: pip install playwright; set CHROMIUM_PATH or install Playwright Chromium.
"""
from pathlib import Path
import os, json, re, sys, traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/v03/ui-evidence'; OUT.mkdir(parents=True,exist_ok=True)
SOURCES={'/'+p.relative_to(ROOT).as_posix():p.read_text() for p in (ROOT/'src').rglob('*.js')}
FIXTURES={}
for p in (ROOT/'public/data').rglob('*'):
    if p.is_file() and p.suffix in ('.json','.geojson'):
        FIXTURES['/data/'+p.relative_to(ROOT/'public/data').as_posix()]=json.loads(p.read_text())
FIXTURES['/api/city-config']={'version':'0.3.0','configured':{},'accidentYear':'2024'}
HTML=(ROOT/'index.html').read_text()
HTML=re.sub(r'<link[^>]*>','',HTML)
HTML=re.sub(r'<script[^>]*></script>','',HTML)
HTML=HTML.replace('</head>','<style>'+(ROOT/'src/city/style.css').read_text()+'</style></head>')
LOADER=r'''async ({sources,fixtures})=>{
window.__transportFixture=true;window.__testRequests=[];window.__testFixtures=fixtures;
window.fetch=async u=>{const url=new URL(String(u),'https://test.invalid'),k=url.pathname;window.__testRequests.push(url.pathname+url.search);
const b=window.__testFixtures[k];return new Response(JSON.stringify(b||{ok:false,error:'TEST ONLY: API not configured'}),{status:b?200:503,headers:{'content-type':'application/json'}});};
const urls={};function build(path){if(urls[path])return urls[path];let code=sources[path];if(code===undefined)throw Error('Missing test module '+path);code=code.replace(/(\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?)(['"])(\.[^'"]+)\2/g,(m,p,q,s)=>{const resolved=new URL(s,'https://test.invalid'+path).pathname;return p+q+build(resolved)+q;});return urls[path]=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));} await import(build('/src/city/app.js'));
}'''
RESULTS=[]
def check(name,condition,detail=None):
    RESULTS.append({'name':name,'passed':bool(condition),'detail':detail})
    if not condition: raise AssertionError(name+' '+str(detail or ''))

def click(page,selector):
    page.locator(selector).first.click()

def open_boundary(page):
    page.set_content(HTML);page.evaluate(LOADER,{'sources':SOURCES,'fixtures':FIXTURES})
    page.wait_for_selector('#start-card:not([hidden])');
    click(page,'#start-card [data-engine="boundary"]')
    page.wait_for_selector('.boundary-canvas');page.wait_for_timeout(2200)

def count(page,which):return int(re.search(r'\d+',page.locator('#'+which+'-count').inner_text()).group())

with sync_playwright() as p:
    executable=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser=p.chromium.launch(headless=True,executable_path=executable,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':960},accept_downloads=True)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    try:
        page.set_content(HTML);page.evaluate(LOADER,{'sources':SOURCES,'fixtures':FIXTURES});page.wait_for_selector('#start-card:not([hidden])')
        check('No automatic synthetic fallback when VWorld keys absent',page.locator('canvas').count()==0 and 'Production' in page.locator('#start-message').inner_text())
        click(page,'#start-card [data-engine="boundary"]');page.wait_for_selector('.boundary-canvas');page.wait_for_timeout(2200)
        check('Boundary mode clearly NOT 3D','3D 아님' in page.locator('#engine-state').inner_text())
        check('18 administrative dong buttons',page.locator('.dong-button').count()==18)
        check('18 distinct palette colors',len(set(page.locator('.dong-button').evaluate_all('(es)=>es.map(e=>e.style.getPropertyValue("--dong"))')))==18)
        check('Overview public park points 87',count(page,'point')==87)
        check('Overview sourced park polygons 94',count(page,'area')==94)
        check('No cylinder controls on new home', '원기둥' not in page.locator('body').inner_text())
        page.screenshot(path=str(OUT/'overview-boundary-NOT-3D.png'))
        click(page,'[data-action="dong"][data-id="seogu-07"]');page.wait_for_timeout(2200)
        check('Selected dong title','치평동' in page.locator('#scope-title').inner_text())
        check('Dong filter point count 11',count(page,'point')==11)
        check('Dong clipped area count 16',count(page,'area')==16)
        check('Selected dong has accessible pressed state',page.locator('[data-id="seogu-07"][data-action="dong"]').get_attribute('aria-pressed')=='true')
        page.screenshot(path=str(OUT/'chipyeong-boundary-NOT-3D.png'))
        # Fast consecutive choices exercise actual UI + CameraDirector cancellation.
        for id in ['seogu-01','seogu-10','seogu-17']:
            click(page,f'[data-action="dong"][data-id="{id}"]')
        page.wait_for_timeout(2200)
        check('Rapid district changes end at latest choice','풍암동' in page.locator('#scope-title').inner_text())
        check('Camera animation settles','탐색 중'==page.locator('#motion-state').inner_text())
        click(page,'.overview-card');page.wait_for_timeout(2200)
        check('Home resets to overview',count(page,'point')==87 and count(page,'area')==94)
        click(page,'[data-action="preset"][data-id="parking"]')
        check('Parking preset contains parking only',count(page,'point')==67 and count(page,'area')==0)
        click(page,'[data-action="list"]')
        check('Point/area not added as facility count','더해 공원 수로 계산하지 않습니다' in page.locator('#detail-body').inner_text())
        check('List count equals visible parking count',page.locator('#detail-body .record').count()==67)
        click(page,'#detail-body .record')
        check('Facility detail has source and date','자료 출처' in page.locator('#detail-body').inner_text() and '자료 기준일' in page.locator('#detail-body').inner_text())
        click(page,'[data-action="isolate"]')
        check('Isolate selected facility only',count(page,'point')==1 and count(page,'area')==0)
        click(page,'[data-action="isolate"]')
        check('Restore other facilities',count(page,'point')==67)
        click(page,'[data-action="close-detail"]');click(page,'[data-action="list"]')
        sample=page.locator('#detail-body .record strong').first.inner_text().strip()
        page.locator('#list-query').fill(sample);page.locator('#list-query').press('Enter')
        number=page.locator('#detail-body .record').count()
        check('Search filters name without inventing new records',1<=number<=67)
        with page.expect_download() as d:click(page,'[data-action="export-csv"]')
        text=Path(d.value.path()).read_text(encoding='utf-8-sig')
        import csv,io
        rows=list(csv.reader(io.StringIO(text)))
        check('CSV matches searched list not hidden rows',len(rows)-1==number)
        click(page,'[data-action="close-detail"]');click(page,'[data-action="settings"]')
        check('Settings does not claim authentication success','인증·데이터 수신 성공이 아닙니다' in page.locator('#detail-body').inner_text())
        check('Provider building hard-clip not claimed','원본 건물을 동 경계로 삭제하는 기능은 아닙니다' in page.locator('#detail-body').inner_text())
        click(page,'[data-action="close-detail"]')
        page.locator('[data-layer="heat"]').check()
        check('Missing shelter key asks setup not fabricates shelters',page.locator('#detail-title').inner_text()=='지도·자료 연결')
        check('Missing API does not add fake count',count(page,'point')==67)
        click(page,'[data-action="close-detail"]');click(page,'[data-action="clear-layers"]')
        check('All layers off',count(page,'point')==0 and count(page,'area')==0)
        click(page,'[data-action="preset"][data-id="parks"]');click(page,'[data-action="tools"]')
        check('Six analysis paths are accessible',page.locator('#detail-body [data-action]').count()>=6)
        page.screenshot(path=str(OUT/'analysis-tools-NOT-3D.png'))
        click(page,'[data-action="close-detail"]');click(page,'[data-action="list"]')
        imported={'type':'FeatureCollection','features':[{'type':'Feature','geometry':{'type':'Point','coordinates':[126.855,35.15]},'properties':{'name':'TEST FIXTURE ONLY','sourceName':'UI integration fixture','sourceDate':'2025-01-01'}}]}
        page.locator('#import-file').set_input_files({'name':'test-only.geojson','mimeType':'application/geo+json','buffer':json.dumps(imported).encode()})
        page.wait_for_timeout(200)
        check('Local GeoJSON point added to actual filtered scene',count(page,'point')==88)
        check('Local file not posted to any server',all(not r.startswith('/api/upload') for r in page.evaluate('__testRequests')))
        check('Local import explicitly says browser memory','브라우저 메모리' in page.locator('#toast').inner_text())
        # Clear imported layer and exercise geometry-less/malformed rejection.
        before=count(page,'point')
        page.locator('#import-file').set_input_files({'name':'bad.geojson','mimeType':'application/json','buffer':b'{"type":"FeatureCollection","features":[]}'});page.wait_for_timeout(100)
        check('Empty import does not delete current data',count(page,'point')==before)
        click(page,'[data-action="close-detail"]');click(page,'[data-action="credits"]')
        check('OSM + SGIS attribution retained','ODbL' in page.locator('#detail-body').inner_text() and 'vuski' in page.locator('#detail-body').inner_text())
        click(page,'[data-action="close-detail"]');click(page,'[data-action="panels"]');page.wait_for_timeout(100)
        check('Focus mode hides sidebar without resetting data',page.locator('body').evaluate('e=>e.classList.contains("map-focus")') and count(page,'point')==before)
        click(page,'#show-panels');check('Panels restored',not page.locator('body').evaluate('e=>e.classList.contains("map-focus")'))
        check('Desktop no document horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        check('No desktop JavaScript errors',not errors,errors)
        page.close()
        page=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
        mobile_errors=[];page.on('pageerror',lambda e:mobile_errors.append(str(e)));open_boundary(page)
        check('Mobile no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        check('Mobile region-open button visible',page.locator('#show-panels').is_visible())
        click(page,'#show-panels');check('Mobile district panel opens',page.locator('#district-panel').is_visible())
        click(page,'[data-action="dong"][data-id="seogu-07"]');page.wait_for_timeout(2200)
        check('Mobile selected dong and data match desktop','치평동' in page.locator('#scope-title').inner_text() and count(page,'point')==11)
        check('Mobile panel closes after dong choice',not page.locator('#district-panel').is_visible())
        click(page,'#show-panels');click(page,'#district-panel [data-action="list"]')
        check('Mobile list fits viewport',page.locator('#detail-panel').bounding_box()['width']<=390)
        check('Mobile list equals scope point+area records',page.locator('#detail-body .record').count()==27)
        page.screenshot(path=str(OUT/'mobile-boundary-NOT-3D.png'))
        click(page,'[data-action="close-detail"]');click(page,'#district-panel [data-action="tools"]')
        check('Mobile analysis tools accessible',page.locator('#detail-title').inner_text()=='도시 검토 도구' and page.locator('#detail-body [data-tool="slope"]').count()==1)
        check('No mobile JavaScript errors',not mobile_errors,mobile_errors)
    except Exception as e:
        RESULTS.append({'name':'test-run-completed','passed':False,'error':str(e)})
        traceback.print_exc()
        try:page.screenshot(path=str(OUT/'failure.png'))
        except Exception:pass
    finally:
        browser.close()
SUMMARY={'testMode':'OFFLINE UI / BoundaryView / transport fixtures; NOT authenticated VWorld, NOT live API, NOT GPU 3D','passed':sum(r['passed'] for r in RESULTS),'failed':sum(not r['passed'] for r in RESULTS),'results':RESULTS}
(OUT/'results.json').write_text(json.dumps(SUMMARY,ensure_ascii=False,indent=2))
print(json.dumps(SUMMARY,ensure_ascii=False,indent=2))
sys.exit(1 if SUMMARY['failed'] else 0)
