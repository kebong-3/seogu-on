"""Actual app + bundled data + boundary renderer. Transport fixtures ONLY.
Does not verify WebGL rendering, VWorld authentication, or external API approval.
"""
from pathlib import Path
import json,re,os,traceback,csv,io,shutil
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/v061/regression-ui';OUT.mkdir(parents=True,exist_ok=True)
SOURCES={'/'+p.relative_to(ROOT).as_posix():p.read_text() for folder in ('src','shared') for p in (ROOT/folder).rglob('*.js')}
FIXTURES={'/data/'+p.relative_to(ROOT/'public/data').as_posix():json.loads(p.read_text()) for p in (ROOT/'public/data').rglob('*') if p.is_file() and p.suffix in ['.json','.geojson']}
FIXTURES['/api/region-profile']={'ok':True,'profile':FIXTURES['/data/regions/seogu.json']}
FIXTURES['/api/city-config']={'version':'0.4.0','configured':{'weather':True,'air':True},'accidentYear':'2024'}
HTML=(ROOT/'index.html').read_text()
# Preserve the deployed stylesheet order, including the current layout and work panels.
CSS_PATHS=re.findall(r'''<link\b[^>]*href=["'](/[^"']+\.css)["'][^>]*>''',HTML)
CSS='\n'.join((ROOT/path.lstrip('/')).read_text() for path in CSS_PATHS)
HTML=re.sub(r'<link[^>]*>','',HTML);HTML=re.sub(r'<script[^>]*></script>','',HTML);HTML=HTML.replace('</head>','<style>'+CSS+'</style></head>')
LOADER=r'''async ({sources,fixtures})=>{
window.__testRequests=[];window.__fixtureMode=true;
window.fetch=async u=>{const url=new URL(String(u),'https://test.invalid'),k=url.pathname;window.__testRequests.push(k+url.search);let b=fixtures[k];
if(k==='/api/weather')b={ok:true,grid:{nx:58,ny:74},base:{base_date:'20260927',base_time:'0300'},values:{T1H:0,REH:55,WSD:1.2,VEC:90,RN1:0},sourceName:'TEST FIXTURE 기상청',fetchedAt:'2026-09-27T03:51:00Z'};
if(k==='/api/city-data'&&url.searchParams.get('kind')==='forecast')b={ok:true,grid:{nx:58,ny:74},base:{base_date:'20260927',base_time:'0200'},sourceName:'TEST FIXTURE 기상청 예보',rows:[{time:'202609271100',temperature:21,windSpeed:1,precipitationProbability:0},{time:'202609271200',temperature:23,windSpeed:2,precipitationProbability:0}]};
if(k==='/api/city-data'&&url.searchParams.get('kind')==='air-stations')b={ok:true,geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[126.858,35.15]},properties:{id:'test-station',name:'검증용 측정소',stationName:'검증용 측정소',sourceName:'TEST FIXTURE',sourceDate:null}}]},complete:true,totalScanned:1,totalCount:1,collectedAt:'2026-09-27T03:51:00Z'};
if(k==='/api/city-data'&&url.searchParams.get('kind')==='air')b={ok:true,station:'검증용 측정소',pm10:0,pm25:null,pm25Flag:'점검',observedAt:'2026-09-27 12:00',sourceName:'TEST FIXTURE'};
return new Response(JSON.stringify(b||{ok:false,error:'TEST ONLY: missing external approval'}),{status:b?200:503,headers:{'content-type':'application/json'}});};
const urls={};function build(path){if(urls[path])return urls[path];let code=sources[path];if(code===undefined)throw Error('Missing module '+path);code=code.replace(/(\b(?:import|export)\s+(?:[^;'"]*?\s+from\s*)?)(['"])(\.[^'"]+)\2/g,(m,p,q,s)=>{const resolved=new URL(s,'https://test.invalid'+path).pathname;return p+q+build(resolved)+q;});return urls[path]=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));}await import(build('/src/city/app.js'));
}'''
results=[]
def ck(n,ok,detail=None):
 print('CHECK',n,ok,flush=True)
 results.append({'name':n,'passed':bool(ok),'detail':detail})
 if not ok:raise AssertionError(n+' '+str(detail or ''))
def click(p,s):
 # v0.6 moved graphics into appearance and 2D climate into the native-sun panel.
 if s=='[data-action=graphics]' and not p.locator(s).count():click(p,'[data-action=appearance]')
 if s=='[data-action=climate]' and not p.locator(s).count():click(p,'[data-action=native-sun]')
 # Tools now live in a collapsed menu; use the visible route rather than a hidden duplicate.
 if not p.locator(s+':visible').count() and p.locator('#home-more-list').locator(s).count():
  if not p.locator('#district-panel').is_visible():
   if p.locator('#detail-panel').is_visible():p.locator('[data-action=close-detail]').click()
   p.locator('#show-panels').click()
  if p.locator('#home-more-toggle').get_attribute('aria-expanded')!='true':p.locator('#home-more-toggle').click()
 p.locator(s+':visible').first.click();p.wait_for_timeout(100)
def count(p,t):return int(re.search(r'\d+',p.locator('#'+t+'-count').inner_text()).group())
def infra(p,id):click(p,'[data-action=infra]');click(p,f'[data-action=infra-select][data-id="{id}"]')
def boot(p):
 p.set_default_timeout(8000)
 p.emulate_media(reduced_motion='reduce')
 print('SETTING CONTENT',flush=True)
 p.set_content(HTML);print('LOADING MODULES',flush=True);p.evaluate(LOADER,{'sources':SOURCES,'fixtures':FIXTURES});print('MODULES READY',flush=True);p.wait_for_selector('#start-card:not([hidden])');click(p,'#start-card [data-engine=boundary]');p.wait_for_selector('.boundary-canvas');p.wait_for_timeout(100)
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 print('BROWSER READY',flush=True)
 p=b.new_page(viewport={'width':1440,'height':960},accept_downloads=True);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 try:
  boot(p);ck('Boundary clearly NOT 3D','3D 아님' in p.locator('#engine-state').inner_text());ck('All18 dong controls',p.locator('.dong-button').count()==18)
  # Boot may show received shelter snapshots; the park-data regression uses an explicit park selection.
  click(p,'[data-action=preset][data-id=parks]');ck('Park preset retains87points94areas',count(p,'point')==87 and count(p,'area')==94)
  click(p,'[data-action=infra]');ck('Infrastructure categories searchable',p.locator('.infra-card').count()>=30);p.locator('#infra-search').fill('학교');ck('Category name filter',p.locator('.infra-card').count()==2);p.locator('#infra-search').fill('');click(p,'[data-action=infra-select][data-id=school]');ck('School dataset52point52polygons',count(p,'point')==52 and count(p,'area')==52);ck('Solo selection hides park layers',not p.locator('[data-layer=parks]').is_checked());ck('Point versus area disclosure','합계가 실제 시설 수가 아닙니다' in p.locator('#detail-body').inner_text());p.screenshot(path=str(OUT/'school-boundary-NOT-3D.png'))
  click(p,'[data-action=dong][data-id=seogu-07]');p.wait_for_timeout(100);ck('Dong selection retained with infrastructure','치평동' in p.locator('#scope-title').inner_text());ck('Dong schools subset',0<count(p,'point')<52 and count(p,'area')<52);click(p,'.overview-card');p.wait_for_timeout(100);ck('Overview restores selected school layer',count(p,'point')==52)
  infra(p,'sports');ck('Sports only locations14areas110',count(p,'point')==14 and count(p,'area')==110);ck('School hidden after sports',not p.locator('[data-layer=infra-school]').is_checked())
  p.locator('#infra-multi').check();click(p,'[data-action=infra-select][data-id=school]');ck('Multi-select combines explicit categories',count(p,'point')==66 and count(p,'area')==162)
  p.locator('#infra-multi').uncheck();click(p,'[data-action=infra-select][data-id=library]');ck('Library83locations4areas',count(p,'point')==83 and count(p,'area')==4)
  click(p,'[data-action=infra-select][data-id=library]');ck('Second solo click turns category off',count(p,'point')==0 and count(p,'area')==0)
  for id,points,areas in [('childcare',10,7),('civic',11,7),('culture',6,5),('kindergarten',18,7),('medical',118,12),('bus',433,0),('parking',67,287)]:
   infra(p,id);ck('Bundled category '+id,count(p,'point')==points and count(p,'area')==areas)
  click(p,'[data-action=list]');ck('Parking point+areas not a facility census','별개' in p.locator('#detail-body').inner_text());click(p,'#detail-body .record');ck('Facility has provenance','자료 출처' in p.locator('#detail-body').inner_text());click(p,'[data-action=isolate]');ck('Facility isolate one item',count(p,'point')+count(p,'area')==1);click(p,'[data-action=isolate]');ck('Facility restore counts',count(p,'point')==67 and count(p,'area')==287)
  click(p,'[data-action=list]');p.locator('#list-query').fill('상무');p.locator('#list-query').press('Enter');p.wait_for_timeout(100);n=p.locator('#detail-body .record').count();ck('Search finds existing data',n>0)
  with p.expect_download() as dl:click(p,'[data-action=export-csv]')
  rows=list(csv.reader(io.StringIO(Path(dl.value.path()).read_text(encoding='utf-8-sig'))));ck('CSV matches filtered list',len(rows)-1==n)
  infra(p,'cold');ck('Bundled cold shelter snapshot has verified points',count(p,'point')>0);ck('Cold shelter layer shows received count',re.search('[0-9]+',p.locator('[data-layer=official-cold-shelter]').locator('..').inner_text()) is not None)
  click(p,'[data-action=coverage]');ck('Civic18 incomplete explicit','18개소가 검수된 것이 아닙니다' in p.locator('#detail-body').inner_text());ck('5779building geometry provenance','5,779' in p.locator('#detail-body').inner_text());ck('Historical childcare excluded','2019' in p.locator('#detail-body').inner_text())
  click(p,'[data-action=graphics]');ck('Clean and reality separated','지형 없음' in p.locator('#detail-body').inner_text());click(p,'[data-action=quality][data-id=crisp]');ck('NonWebGL quality is honestly unsupported','미지원' in p.locator('#quality-diagnostic').inner_text());p.locator('#dong-labels').uncheck();ck('Label toggle changes only rendering',p.locator('.dong-button').count()==18)
  click(p,'[data-action=climate]');p.locator('#shade-date').fill('2026-09-27');p.locator('#shade-time').fill('14:00');click(p,'[data-action=shade-calc]');p.wait_for_function('document.querySelector("#shade-result-text").textContent.includes("태양 고도")');ck('Actual approximate shade geometry computed',count(p,'area')>0);ck('Height missing excluded note','높이 미상 제외 3510개' in p.locator('#shade-result-text').inner_text());ck('Flat assumption explicit','평탄면' in p.locator('#detail-body').inner_text());p.screenshot(path=str(OUT/'shade-boundary-NOT-3D.png'))
  p.locator('#shade-time').fill('00:00');click(p,'[data-action=shade-calc]');p.wait_for_function('document.querySelector("#shade-result-text").textContent.includes("지평선 아래")');ck('Night is explicit no fake sun/shade',count(p,'area')==0)
  click(p,'[data-action=weather-map]');p.wait_for_function('document.querySelector("#detail-body").textContent.includes("이번 수신")');ck('Weather points on map from fixture',count(p,'point')>=1);click(p,'[data-action=list]');p.locator('#list-query').fill('기상청 격자');p.locator('#list-query').press('Enter');click(p,'#detail-body .record[data-layer=weather-observed]');ck('Zero temperature kept','기온(℃)' in p.locator('#detail-body').inner_text());ck('Observation time retained','2026-09-27T03:00' in p.locator('#detail-body').inner_text());ck('Grid not weather station disclosure','관측소가 아닙니다' in p.locator('#detail-body').inner_text())
  click(p,'[data-action=climate]');click(p,'[data-action=forecast-load]');p.wait_for_selector('[data-action=forecast-show]');ck('Forecast slots two',p.locator('[data-action=forecast-show]').count()==2);click(p,'[data-action=forecast-show][data-id="1"]');ck('Forecast becomes separate visible layer',p.locator('[data-layer=weather-forecast]').is_checked())
  click(p,'[data-action=air-map]');p.wait_for_function('document.querySelector("#detail-title").textContent.includes("미세먼지 관측")');ck('Air layer enabled',p.locator('[data-layer=air-observed]').is_checked());click(p,'[data-action=list]');p.locator('#list-query').fill('대기 관측');p.locator('#list-query').press('Enter');click(p,'#detail-body .record');ck('Air flag shown rather than normal','점검' in p.locator('#detail-body').inner_text());ck('Air observation not invented district average','다른 거리·동·건물' in p.locator('#detail-body').inner_text())
  click(p,'[data-action=climate]');click(p,'[data-action=snow]');ck('No fictional snow routes','아직 확보하지 않았습니다' in p.locator('#detail-body').inner_text());ck('Official grit metadata dated','2025-01-08' in p.locator('#detail-body').inner_text());ck('Operation stale legend','갱신 확인 필요' in p.locator('.winter-legend').inner_text())
  upload={'type':'FeatureCollection','features':[{'type':'Feature','geometry':{'type':'LineString','coordinates':[[126.85,35.145],[126.86,35.15]]},'properties':{'id':'TEST-ROUTE','name':'검증 전용 작업구간','sourceName':'TEST FIXTURE','status':'completed','observedAt':'2020-01-01T00:00:00Z','expiresAt':'2020-01-02T00:00:00Z'}}]}
  p.locator('body > input[type=file]').set_input_files({'name':'fixture.geojson','mimeType':'application/json','buffer':json.dumps(upload,ensure_ascii=False).encode()});p.wait_for_timeout(300);ck('Operational import visible',p.locator('[data-layer=infra-snow-routes]').is_checked());click(p,'[data-action=list]');p.locator('#list-query').fill('검증 전용');p.locator('#list-query').press('Enter');click(p,'#detail-body .record');ck('Expired completion shown stale','갱신 확인 필요' in p.locator('#detail-body').inner_text())
  ck('Desktop no page JS errors',not errors,errors)
  mobile=b.new_page(viewport={'width':390,'height':844});mobile_errors=[];mobile.on('pageerror',lambda e:mobile_errors.append(str(e)));boot(mobile);click(mobile,'#show-panels');click(mobile,'[data-action=infra]');ck('Mobile catalog no horizontal overflow',mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));ck('Mobile all categories navigable',mobile.locator('.infra-card').count()>=30);mobile.screenshot(path=str(OUT/'mobile-infra-NOT-3D.png'));ck('Mobile no JS errors',not mobile_errors,mobile_errors)
 except Exception as e:
  results.append({'name':'Unexpected failure','passed':False,'detail':str(e)});p.screenshot(path=str(OUT/'failed-test-NOT-3D.png'));traceback.print_exc()
 finally:
  (OUT/'results.json').write_text(json.dumps({'mode':'Boundary renderer + fixture transport, NOT live API/GPU','results':results,'pageErrors':errors},ensure_ascii=False,indent=2));b.close()
print(json.dumps({'checks':len(results),'passed':sum(x['passed'] for x in results),'failures':[x for x in results if not x['passed']]},ensure_ascii=False));sys_exit=any(not x['passed'] for x in results);raise SystemExit(sys_exit)
