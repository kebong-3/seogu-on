"""Offline component tests: real app/data, declared mock map/API. Not a 3D rendering test."""
from pathlib import Path
import os, shutil
import re,json,time
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];out=R/'docs';out.mkdir(exist_ok=True);mods={};order=[]
MAP='''export class CityMap{constructor(c,cb){this.c=c;this.cb=cb;window.__unitMap=this;}async start(mode){this.mode=mode;this.ready=true;this.c.textContent='컴포넌트 시험 · 외부 지도 엔진은 호출하지 않음';this.c.style.padding='250px 440px';this.cb.status('connected','UI 컴포넌트 시험 · 외부 지도·3D 미검증');}update(fs,ps,state){this.features=fs;this.projects=ps;this.state=state;}setBoundary(data){this.boundary=data;}fitDong(id){this.dong=id;}flyTo(c){this.camera=c;}set3D(v){this.is3D=v;}zoomBy(){}rotate(){}screenshot(){return null;}destroy(){}}'''
def visit(name):
 if name in mods:return
 path=R/'src'/name
 source=MAP if name=='map.js' else path.read_text()
 deps=[]
 def imp(m):
  parts=m.group(1);f=m.group(2).split('/')[-1];deps.append(f)
  return 'const {'+re.sub(r'\s+as\s+',':',parts)+'}=__modules['+json.dumps(f)+'];'
 source=re.sub(r'import\s*{([^}]+)}\s*from\s*[\'"]([^\'"]+)[\'"];',imp,source)
 exports=re.findall(r'export\s+(?:async\s+)?(?:const|let|function|class)\s+(\w+)',source)
 source=re.sub(r'\bexport\s+','',source);mods[name]=source
 for d in deps:visit(d)
 order.append((name,exports))
visit('app.js')
bundle='const __modules={};\n'+'\n'.join('__modules['+json.dumps(n)+']=(()=>{\n'+mods[n]+'\nreturn {'+','.join(ex)+'};})();' for n,ex in order)
fixtures={}
for p in (R/'public/data').rglob('*'):
 if p.is_file() and p.suffix in ['.json','.geojson']:fixtures['/data/'+p.relative_to(R/'public/data').as_posix()]=json.loads(p.read_text())
fixtures['/api/config']={'version':'0.2.0','vworld3d':False,'vworldRest':False,'weather':False};fixtures['/api/layers']={'ok':True,'sources':[]}
prefix='window.__fixtures='+json.dumps(fixtures,ensure_ascii=False)+';window.fetch=async (u)=>new Response(JSON.stringify(window.__fixtures[u]||{ok:false,error:"시험: 인증키 미설정"}),{status:window.__fixtures[u]?200:503,headers:{"content-type":"application/json"}});'
checks=[];errors=[]
def ck(name,test):
 ok=bool(test);checks.append({'name':name,'passed':ok});print(name,ok)
 if not ok:raise AssertionError(name)
with sync_playwright() as p:
 executable=os.getenv('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
 b=p.chromium.launch(**({'executable_path':executable} if executable else {}),headless=True)
 page=b.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<html lang="ko"><head><meta charset="utf-8"><style>'+ (R/'src/styles.css').read_text()+'</style></head><body><div id="app"></div></body></html>')
 page.evaluate(prefix+bundle)
 page.wait_for_timeout(500)
 print('errors',errors)
 ck('initial 325 actual source records',page.locator('#insights .metric strong').first.inner_text()=='325개')
 ck('18 administrative-dong options plus district',page.locator('#dong-select option').count()==19)
 ck('five real public source layers',page.locator('.source-summary').inner_text().startswith('실제 자료 5개 층'))
 page.locator('#dong-select').select_option(label='치평동')
 n=int(page.locator('#insights .metric strong').first.inner_text().replace('개',''))
 ck('selecting administrative dong filters fewer records',0<n<325)
 ck('map adapter receives same filtered count',page.evaluate('window.__unitMap.features.length')==n)
 page.locator('[data-act="dong-table"]').first.click()
 ck('dong table 18 rows',page.locator('#dialog-body tbody tr').count()==18)
 total=sum(int(x) for x in page.locator('#dialog-body tbody tr td:nth-child(2)').all_inner_texts());ck('sum of all dong records',total==325)
 page.locator('[data-act="close-dialog"]').click()
 page.locator('[data-act="district-overview"]').first.click()
 page.locator('[data-act="sources"]').first.click()
 ck('5 layer management cards',page.locator('[data-source-toggle]').count()==5)
 page.locator('[data-source-toggle="parks"]').uncheck();page.locator('[data-act="close-dialog"]').click()
 ck('layer off preserves other four layers',page.locator('#insights .metric strong').first.inner_text()=='238개')
 page.locator('[data-act="sources"]').first.click();page.locator('[data-source-toggle="parks"]').check();page.locator('[data-act="pending"]').click()
 ck('32 address-only records remain outside map',page.locator('#dialog-body tbody tr').count()==32)
 ck('32 explicit geocode actions',page.locator('[data-geocode]').count()==32)
 page.locator('[data-act="close-dialog"]').click();page.locator('[data-act="sources"]').first.click()
 page.locator('[data-act="import"]').click()
 csv='id,name,category,longitude,latitude,sourceName,sourceDate,address\ntest-only,TEST ONLY point,care,126.859,35.151,TEST FIXTURE,2026-01-01,test\n'
 page.locator('#file-input').set_input_files({'name':'TEST_ONLY.csv','mimeType':'text/csv','buffer':csv.encode()});page.wait_for_timeout(100)
 ck('CSV import adds not replaces source',page.locator('#insights .metric strong').first.inner_text()=='326개')
 page.locator('[data-act="sources"]').first.click();page.locator('[data-act="import-stats"]').click()
 csv='dongName,month,metricName,metricUnit,value,sourceName,sourceDate\n치평동,2026-01,시험지표,건,0,TEST ONLY,2026-01-31\n상무1동,2026-01,시험지표,건,,TEST ONLY,2026-01-31\n'
 page.locator('#file-input').set_input_files({'name':'TEST_ONLY_STATS.csv','mimeType':'text/csv','buffer':csv.encode()});page.wait_for_timeout(100)
 txt=page.locator('#dialog-body').inner_text()
 ck('Imported administrative statistics shown with source', '시험지표' in txt and 'TEST ONLY' in txt)
 page.locator('[data-act="close-dialog"]').click();page.locator('[data-act="sources"]').first.click();page.locator('[data-act="import-projects"]').click()
 proj={'type':'FeatureCollection','features':[{'type':'Feature','geometry':{'type':'LineString','coordinates':[[126.85,35.15],[126.86,35.16]]},'properties':{'id':'test-project','projectId':'test-project','name':'TEST ONLY project','sourceName':'TEST FIXTURE','sourceDate':'2025-01-01','start':'2025-01-01','end':'2025-02-28'}}]}
 page.locator('#file-input').set_input_files({'name':'TEST_ONLY_PROJECT.geojson','mimeType':'application/json','buffer':json.dumps(proj).encode()});page.wait_for_timeout(150)
 ck('Project time axis contains actual project months',page.locator('[data-month="2025-01"]').count()>0)
 ck('Project polygon/line source delivered to map adapter',page.evaluate('window.__unitMap.projects.some(x=>x.properties.id==="test-project")'))
 page.set_viewport_size({'width':390,'height':844});page.locator('[data-act="mobile-panel"]').click()
 ck('mobile administrative selector visible',page.locator('#dong-select').is_visible())
 ck('mobile no horizontal page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
 page.screenshot(path=str(out/'component-mobile-test.png'))
 ck('no unhandled JavaScript errors',not errors)
 b.close()
(out/'COMPONENT_RESULTS.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'scope':'Offline UI component integration. Map adapter and API transport replaced by declared test doubles. Actual bundled public JSON and application logic used. Does NOT verify external tile rendering or credentials.'},ensure_ascii=False,indent=2))
