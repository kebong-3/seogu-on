"""Integration checks. Run against a locally served build with internet access.
Tests labelled mocked test fail-closed behavior; map tests use real OpenFreeMap tiles.
No VWorld or data.go.kr credentials are read or printed.
"""
import os,json,pathlib,time,sys,traceback
from playwright.sync_api import sync_playwright
BASE=os.environ.get('SEOON_TEST_URL','http://127.0.0.1:4173')
OUT=pathlib.Path(os.environ.get('SEOON_TEST_OUTPUT','evidence/browser'));OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
def check(name,ok,details=None):
 checks.append({'name':name,'passed':bool(ok),'details':details});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 if not ok:raise AssertionError(name)
def close(page):
 if page.locator('#dialog').evaluate('(x)=>x.open'):page.locator('[data-act="close-dialog"]').click()
def count(page):return int(page.locator('#insights .metric strong').first.inner_text().replace('개','').replace(',','').strip())
def waitmap(page):page.wait_for_function('window.__testMap?.isStyleLoaded() && window.__testMap?.getSource("boundary")',timeout=65000)
INSTRUMENT="""(() => {let value;Object.defineProperty(window,'maplibregl',{configurable:true,get(){return value},set(v){value=v;if(v?.Map)v.Map=new Proxy(v.Map,{construct(t,args){const m=Reflect.construct(t,args);window.__testMap=m;return m}})}})})()"""
try:
 with sync_playwright() as p:
  opts={'headless':True,'args':['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}
  if os.environ.get('CHROMIUM_EXECUTABLE'):opts['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
  browser=p.chromium.launch(**opts);ctx=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1,accept_downloads=True)
  page=ctx.new_page();page.add_init_script(INSTRUMENT);page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE,wait_until='domcontentloaded',timeout=60000)
  page.wait_for_function('document.querySelectorAll("#dong-select option").length===19',timeout=15000)
  page.wait_for_function('document.querySelector("#insights .metric strong")?.textContent.includes("325")',timeout=15000)
  check('18 administrative dong options plus district',page.locator('#dong-select option').count()==19)
  check('325 real public records; no synthetic startup facilities',count(page)==325)
  check('No fabricated monthly values', '비교값 없음' in page.locator('#insights').inner_text())
  waitmap(page)
  check('Real map boundary source has 18 geometries',page.evaluate('window.__testMap.getSource("boundary")._data.features.length')==18)
  page.locator('[data-act="district-overview"]').first.click();page.wait_for_timeout(2000)
  check('District overview is vertical',round(page.evaluate('window.__testMap.getPitch()'))==0)
  page.screenshot(path=str(OUT/'admin18-overview.png'))
  page.locator('#dong-select').select_option(label='치평동');page.wait_for_timeout(2000)
  dongcount=count(page);check('Dong selection filters records',0<dongcount<325,{'chipyeongCount':dongcount})
  check('Map and table share dong filtered records',page.evaluate('window.__testMap.getSource("facilities")._data.features.length')==dongcount)
  page.locator('[data-act="dong-table"]').first.click()
  check('Dong comparison table contains 18 rows',page.locator('#dialog-body tbody tr').count()==18)
  total=sum(int(v) for v in page.locator('#dialog-body tbody tr td:nth-child(2)').all_inner_texts())
  check('Dong table sum matches all located records',total==325,{'sum':total});close(page)
  page.locator('[data-act="closeup"]').first.click();page.wait_for_timeout(5000)
  check('Close-up is pitched 3D',page.evaluate('window.__testMap.getPitch()')>50)
  rendered=page.evaluate('window.__testMap.queryRenderedFeatures({layers:["seo-buildings"]}).length')
  check('Real building extrusions rendered',rendered>0,{'renderedGeometries':rendered})
  page.screenshot(path=str(OUT/'real-buildings-closeup.png'))
  # Actual pointer click on an uncovered rendered building.
  page.locator('[data-act="inspect-buildings"]').first.click()
  target=page.evaluate('''()=>{const m=window.__testMap;for(const f of m.queryRenderedFeatures({layers:['seo-buildings']})){const ring=f.geometry.type==='Polygon'?f.geometry.coordinates[0]:f.geometry.coordinates[0][0];const c=ring.reduce((a,x)=>[a[0]+x[0]/ring.length,a[1]+x[1]/ring.length],[0,0]);const p=m.project(c);if(p.x<440||p.x>1090||p.y<240||p.y>710)continue;if(m.queryRenderedFeatures(p,{layers:['facility-dot','metric-columns']}).length)continue;return {x:p.x,y:p.y};}return null;}''')
  if target:
   rect=page.locator('#map-stage').bounding_box();page.mouse.click(rect['x']+target['x'],rect['y']+target['y']);page.wait_for_timeout(400)
   check('Building click exposes rendering-height limitation','건물 렌더링 높이' in page.locator('#dialog-title').inner_text());close(page)
  else:check('Building click target available',False)
  page.locator('[data-act="inspect-buildings"]').first.click()
  page.locator('[data-act="theme"]').click();waitmap(page);page.wait_for_timeout(1500)
  check('Theme switch retains 18-dong geometries',page.evaluate('window.__testMap.getSource("boundary")._data.features.length')==18)
  check('Theme switch retains selected dong',page.locator('#dong-select').input_value()!='')
  page.locator('[data-act="district-overview"]').first.click();page.wait_for_timeout(2000)
  page.screenshot(path=str(OUT/'admin18-light.png'))
  page.locator('[data-act="sources"]').first.click()
  check('Five independently managed data layers',page.locator('[data-source-toggle]').count()==5)
  page.locator('[data-source-toggle="parks"]').uncheck();close(page)
  check('Disabling parks does not replace other data',count(page)==238)
  page.locator('[data-act="sources"]').first.click();page.locator('[data-source-toggle="parks"]').check()
  page.locator('[data-act="pending"]').click()
  check('32 remaining public addresses are not mapped',page.locator('#dialog-body tbody tr').count()==32)
  check('Geocoding is explicit per public address',page.locator('[data-geocode]').count()==32);close(page)
  # Test that unapproved API calls expose no credential and do not fabricate data.
  conf=page.request.get(BASE+'/api/config').json();check('Test instance exposes no key values',not any('KEY' in k for k in conf))
  weather=page.request.get(BASE+'/api/weather?lon=126.859&lat=35.151');check('Missing weather key fails closed',weather.status==503)
  geo=page.request.get(BASE+'/api/geocode?id=address-1');check('Geocode rejects unknown or unconfigured request',geo.status in [404,503])
  # Local test data never becomes a published source.
  page.locator('[data-act="sources"]').first.click();page.locator('[data-act="import"]').click()
  csv='id,name,category,longitude,latitude,sourceName,sourceDate,address\ntest-only,TEST ONLY imported point,care,126.859,35.151,TEST FIXTURE,2026-01-01,test\n'
  page.locator('#file-input').set_input_files({'name':'TEST_ONLY.csv','mimeType':'text/csv','buffer':csv.encode()});page.wait_for_timeout(600)
  check('CSV import adds one local layer without deleting public data',count(page)==326)
  with page.expect_download() as dl:page.locator('[data-act="csv"]').first.click()
  download=dl.value;download.save_as(str(OUT/'test-export.csv'))
  exported=(OUT/'test-export.csv').read_text(encoding='utf-8-sig');check('CSV export carries administrative dong and provenance','행정동' in exported and 'TEST ONLY imported point' in exported)
  page.reload(wait_until='domcontentloaded');page.wait_for_function('document.querySelector("#insights .metric strong")?.textContent.includes("325")',timeout=15000)
  check('Unpublished local import is not persisted to server',count(page)==325)
  # Failure response explicitly mocked; this test does not assert successful real API authentication.
  failure=ctx.new_page();failure.on('pageerror',lambda e:errors.append(str(e)))
  failure.route('**/api/layers',lambda route:route.fulfill(json={'ok':True,'sources':[{'id':'parks','name':'도시공원','configured':True}]}))
  failure.route('**/api/layers?*',lambda route:route.fulfill(status=502,json={'ok':False,'error':'TEST ONLY upstream failure'}))
  failure.goto(BASE,wait_until='domcontentloaded');failure.wait_for_function('document.querySelector("#insights .metric strong")?.textContent.includes("325")',timeout=15000)
  failure.locator('[data-act="sources"]').first.click();failure.locator('[data-source-refresh="parks"]').click();failure.wait_for_timeout(500)
  check('Mocked upstream failure retains last-good parks','갱신 실패·기존 유지' in failure.locator('#dialog-body').inner_text());close(failure);check('Mocked failure keeps all 325 records',count(failure)==325);failure.close()
  mobile=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
  mp=mobile.new_page();mp.on('pageerror',lambda e:errors.append(str(e)));mp.goto(BASE,wait_until='domcontentloaded');mp.wait_for_function('document.querySelectorAll("#dong-select option").length===19',timeout=15000)
  mp.locator('[data-act="mobile-panel"]').click();check('Mobile administrative selector is visible',mp.locator('#dong-select').is_visible())
  check('Mobile layout has no horizontal page overflow',mp.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
  mp.screenshot(path=str(OUT/'mobile-admin-panel.png'));mobile.close()
  check('No unhandled browser JavaScript errors',not errors,errors)
  browser.close()
except Exception as e:
 checks.append({'name':'fatal','passed':False,'details':str(e)});traceback.print_exc()
finally:
 result={'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'checks':checks,'browserErrors':errors,'scope':'Real OpenFreeMap map and bundled public snapshots. Failure fixtures explicitly mocked. VWorld authenticated models, geocoding credentials, and authenticated public-data/KMA upstream responses are NOT verified.'}
 (OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
 sys.exit(1 if result['failed'] else 0)
