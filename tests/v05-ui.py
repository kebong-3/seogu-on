"""Final integration checks: real application/2D renderer; network + storage are explicit fixtures.
This does NOT verify WebGL, production authentication, or real browser storage permission.
"""
from pathlib import Path
import json,re,os,shutil,io,csv,traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/v06/ui-evidence';OUT.mkdir(parents=True,exist_ok=True)
SOURCES={'/'+p.relative_to(ROOT).as_posix():p.read_text() for folder in ('src','shared') for p in (ROOT/folder).rglob('*.js')}
FIXTURES={'/data/'+p.relative_to(ROOT/'public/data').as_posix():json.loads(p.read_text()) for p in (ROOT/'public/data').rglob('*') if p.is_file() and p.suffix in ['.json','.geojson']}
FIXTURES['/api/region-profile']={'ok':True,'profile':FIXTURES['/data/regions/seogu.json']}
FIXTURES['/api/city-config']={'version':'0.4.1','configured':{'vworld3d':False,'vworldRest':True,'weather':False,'air':False}}
HTML=(ROOT/'index.html').read_text()
# Preserve the deployed stylesheet order, including the current layout and work panels.
CSS_PATHS=re.findall(r'''<link\b[^>]*href=["'](/[^"']+\.css)["'][^>]*>''',HTML)
CSS='\n'.join((ROOT/path.lstrip('/')).read_text() for path in CSS_PATHS)
HTML=re.sub(r'<link[^>]*>','',HTML);HTML=re.sub(r'<script[^>]*></script>','',HTML);HTML=HTML.replace('</head>','<style>'+CSS+'</style></head>')
LOADER=r'''async ({sources,fixtures})=>{
window.__fixtureStorage=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>window.__fixtureStorage.get(k)||null,setItem:(k,v)=>window.__fixtureStorage.set(k,v),removeItem:k=>window.__fixtureStorage.delete(k)}});
window.__testRequests=[];window.__testWfsMode='ok';
window.fetch=async u=>{const url=new URL(String(u),'https://test.invalid');window.__testRequests.push(url.pathname+url.search);let b=fixtures[url.pathname];
if(url.pathname==='/api/city-data'&&url.searchParams.get('kind')?.startsWith('vw-')){
 if(window.__testWfsMode==='failure')return new Response(JSON.stringify({ok:false,error:'TEST ONLY upstream failed'}),{status:502});
 if(window.__testWfsMode==='delayed')await new Promise(r=>setTimeout(r,700));
 const dong=url.searchParams.get('dong'),id=url.searchParams.get('kind'),f=fixtures['/data/admin-dongs.geojson'].features.find(f=>f.properties.dongId===(dong==='all'?'seogu-07':dong)),p=f.properties.labelPoint;
 const feature={type:'Feature',properties:{id:id+':TEST_ONLY',name:'TEST ONLY 주제도 도형',sourceName:'TEST FIXTURE NOT ACTUAL HAZARD',sourceDate:null},geometry:{type:'Polygon',coordinates:[[[p[0]-.0003,p[1]-.0003],[p[0]+.0003,p[1]-.0003],[p[0]+.0003,p[1]+.0003],[p[0]-.0003,p[1]+.0003],[p[0]-.0003,p[1]-.0003]]]}};
 b={ok:true,geojson:{type:'FeatureCollection',features:window.__testWfsMode==='empty'?[]:[feature]},complete:true,totalScanned:window.__testWfsMode==='empty'?0:1,totalCount:window.__testWfsMode==='empty'?0:1,collectedAt:'2026-09-28T00:00:00Z',sourceDate:null};
}
return new Response(JSON.stringify(b||{ok:false,error:'TEST FIXTURE no configured API'}),{status:b?200:503,headers:{'content-type':'application/json'}});};
const urls={};function build(path){if(urls[path])return urls[path];let code=sources[path];if(code===undefined)throw Error('Missing module '+path);code=code.replace(/(\b(?:import|export)\s+(?:[^;'"]*?\s+from\s*)?)(['"])(\.[^'"]+)\2/g,(m,p,q,s)=>{const resolved=new URL(s,'https://test.invalid'+path).pathname;return p+q+build(resolved)+q;});return urls[path]=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));}
window.__testModules=urls;window.__data=fixtures;await import(build('/src/city/app.js'));
}'''
results=[]
def ck(name,ok,detail=None):
 results.append({'name':name,'passed':bool(ok),'detail':detail});print(name,bool(ok),flush=True)
 if not ok:raise AssertionError(name+' '+str(detail))
def click(p,selector):
 p.locator(selector).first.evaluate('(e)=>e.click()');p.wait_for_timeout(80)
def boot(p):
 p.set_default_timeout(7000);p.emulate_media(reduced_motion='reduce');p.set_content(HTML);p.evaluate(LOADER,{'sources':SOURCES,'fixtures':FIXTURES});p.wait_for_selector('#start-card:not([hidden])');click(p,'#start-card [data-engine=boundary]');p.wait_for_selector('.boundary-canvas')
def input_(p,id,value):
 p.locator('#'+id).fill(value)

with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);p=b.new_page(viewport={'width':1440,'height':960},accept_downloads=True);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 try:
  boot(p);ck('Boundary renderer is explicitly not 3D','3D 아님' in p.locator('#engine-state').inner_text())
  click(p,'[data-action=themes]');ck('66 documented topic cards',p.locator('.topic-card').count()==66);ck('No receipt claimed from catalogue','목록 등록 ≠ 데이터 수신' in p.locator('#detail-body').inner_text())
  p.locator('#theme-search').fill('하천망');ck('Theme search filters exact title',p.locator('.topic-card').count()==1);p.locator('#theme-search').fill('')
  click(p,'[data-action=theme-group][data-id="재난·방재"]');ck('Disaster group contains seven mapped topics',p.locator('.topic-card').count()==7)
  click(p,'[data-action=theme-solo][data-id="vw-c_up201"]');p.wait_for_function('document.querySelector("#theme-progress").textContent.includes("수신 1")');ck('WFS solo hides park layers',not p.locator('[data-layer=parks]').is_checked());ck('WFS actual returned polygon rendered','1개' in p.locator('#area-count').inner_text());ck('Source query uses district scope',p.evaluate('window.__testRequests.some(u=>u.includes("kind=vw-c_up201&dong=all&page=1"))'))
  click(p,'[data-action=theme-add][data-id="vw-c_up401"]');p.wait_for_timeout(100);ck('Explicit additive selection retains both sources','2개' in p.locator('#area-count').inner_text())
  p.screenshot(path=str(OUT/'themes-FIXTURE-NOT-3D.png'))
  with p.expect_download() as dl:click(p,'[data-action=theme-export]')
  exported=json.loads(Path(dl.value.path()).read_text());ck('Export is two received geometries not 66 metadata records',len(exported['features'])==2 and exported['metadata']['catalogueOnly'] is False)
  p.evaluate('window.__testWfsMode="failure"');click(p,'[data-action=theme-refresh][data-id="vw-c_up201"]');p.wait_for_timeout(100);ck('Upstream failure keeps last good geometry','2개' in p.locator('#area-count').inner_text());ck('Failure visible independently of old geometry','갱신 실패' in p.locator('#topic-cards').inner_text())
  p.evaluate('window.__testWfsMode="empty"');click(p,'[data-action=theme-refresh][data-id="vw-c_up401"]');p.wait_for_timeout(100);ck('Sudden empty response preserves last good geometry','2개' in p.locator('#area-count').inner_text());ck('Unexpected zero identified as failed replacement','이전 자료' in p.locator('#theme-progress').inner_text())
  p.evaluate('window.__testWfsMode="ok"');click(p,'[data-action=dong][data-id=seogu-07]');click(p,'[data-action=theme-refresh][data-id="vw-c_up201"]');p.wait_for_timeout(100);ck('Refresh sends selected administrative dong',p.evaluate('window.__testRequests.some(u=>u.includes("kind=vw-c_up201&dong=seogu-07"))'))
  click(p,'.overview-card');ck('Dong-only snapshot not mislabelled whole district','다른 구역 조회본' in p.locator('#topic-cards').inner_text())
  p.evaluate('window.__testWfsMode="delayed"');click(p,'[data-action=theme-refresh][data-id="vw-c_up201"]');click(p,'[data-action=theme-cancel]');p.wait_for_timeout(900);ck('Cancellation leaves no permanent loading state','조회 중' not in p.locator('.topic-state').first.inner_text())
  click(p,'[data-action=native-sun]');ck('Dedicated native sunlight panel exists',p.locator('#native-sun-slider').count()==1)
  click(p,'[data-action=sun-season][data-id=winter]');ck('Winter representative day retained',p.locator('#native-sun-date').input_value().endswith('12-22'))
  p.locator('#native-sun-slider').evaluate('(e)=>{e.value=540;e.dispatchEvent(new Event("input",{bubbles:true}));}');ck('Time slider synchronizes input and visible KST clock',p.locator('#native-sun-time').input_value()=='09:00' and p.locator('#native-sun-clock').inner_text()=='09:00')
  click(p,'[data-action=native-apply]');ck('2D engine refuses fake native-shadow success','3D 준비가 필요' in p.locator('#native-sun-status').inner_text())
  click(p,'[data-action=sun-season][data-id=summer]');ck('Season switch preserves time',p.locator('#native-sun-date').input_value().endswith('06-21') and p.locator('#native-sun-time').input_value()=='09:00')
  ck('Illumination and duration not falsely certified','총·연속 일조시간을 계산하지 않습니다' in p.locator('#detail-body').inner_text())
  p.screenshot(path=str(OUT/'solar-controls-NOT-3D.png'))
  click(p,'[data-action=resilience]');ck('Six disaster context presets',p.locator('.scenario-card').count()==6)
  click(p,'[data-action=resilience-preset][data-id=winter]');ck('Winter preset exposes missing operational sources','원자료 미확보/미수신' in p.locator('#detail-body').inner_text());ck('No fictional snow route inserted','0개' in p.locator('#line-count').inner_text())
  ck('Disaster warning states limits','공인 재난경보' in p.locator('#detail-body').inner_text());p.screenshot(path=str(OUT/'resilience-NOT-3D.png'))
  click(p,'[data-action=infra]');click(p,'[data-action=infra-select][data-id=school]');ck('Original infrastructure solo still works','52개' in p.locator('#point-count').inner_text())
  ck('Desktop no JavaScript exceptions',not errors,errors)
  m=b.new_page(viewport={'width':390,'height':844});me=[];m.on('pageerror',lambda e:me.append(str(e)));boot(m);click(m,'[data-action=themes]');ck('Mobile no horizontal document overflow',m.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));ck('Mobile can search topic list',m.locator('#theme-search').count()==1);m.locator('#theme-search').fill('방재');ck('Mobile topic search returns matches',m.locator('.topic-card').count()>0);click(m,'[data-action=native-sun]');ck('Mobile native time input available',m.locator('#native-sun-time').count()==1);ck('Mobile no exceptions',not me,me);m.screenshot(path=str(OUT/'mobile-controls-NOT-3D.png'));m.close()
 except Exception as e:
  results.append({'name':'fatal','passed':False,'error':str(e)});print(traceback.format_exc());p.screenshot(path=str(OUT/'failed-NOT-3D.png'))
 finally:
  b.close();(OUT/'results.json').write_text(json.dumps({'scope':'actual application + boundary renderer; WFS responses are explicit fixtures, not actual hazards; no GPU verification','results':results},ensure_ascii=False,indent=2));print(json.dumps({'checks':len(results),'passed':sum(r['passed'] for r in results)},ensure_ascii=False))
 if any(not r['passed'] for r in results):raise SystemExit(1)
