"""Final integration checks: real application/2D renderer; network + storage are explicit fixtures.
This does NOT verify WebGL, production authentication, or real browser storage permission.
"""
from pathlib import Path
import json,re,os,shutil,io,csv,traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/v061/records-ui';OUT.mkdir(parents=True,exist_ok=True)
SOURCES={'/'+p.relative_to(ROOT).as_posix():p.read_text() for p in (ROOT/'src').rglob('*.js')}
FIXTURES={'/data/'+p.relative_to(ROOT/'public/data').as_posix():json.loads(p.read_text()) for p in (ROOT/'public/data').rglob('*') if p.is_file() and p.suffix in ['.json','.geojson']}
FIXTURES['/api/city-config']={'version':'0.4.1','configured':{'vworld3d':False,'weather':False,'air':False}}
HTML=(ROOT/'index.html').read_text();HTML=re.sub(r'<link[^>]*>','',HTML);HTML=re.sub(r'<script[^>]*></script>','',HTML);HTML=HTML.replace('</head>','<style>'+((ROOT/'src/city/style.css').read_text()+'\n'+(ROOT/'src/city/appearance.css').read_text()+'\n'+(ROOT/'src/city/identity.css').read_text())+'</style></head>')
LOADER=r'''async ({sources,fixtures})=>{
window.__fixtureStorage=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>window.__fixtureStorage.get(k)||null,setItem:(k,v)=>window.__fixtureStorage.set(k,v),removeItem:k=>window.__fixtureStorage.delete(k)}});
window.fetch=async u=>{const url=new URL(String(u),'https://test.invalid');const b=fixtures[url.pathname];return new Response(JSON.stringify(b||{ok:false,error:'TEST FIXTURE: API key not supplied'}),{status:b?200:503,headers:{'content-type':'application/json'}});};
const urls={};function build(path){if(urls[path])return urls[path];let code=sources[path];if(code===undefined)throw Error('Missing module '+path);code=code.replace(/(\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?)(['"])(\.[^'"]+)\2/g,(m,p,q,s)=>{const resolved=new URL(s,'https://test.invalid'+path).pathname;return p+q+build(resolved)+q;});return urls[path]=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));}
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
  boot(p);click(p,'[data-action=appearance]');click(p,'[data-action=graphics]');ck('Source model switch is visible',p.locator('[data-action=build-style]').count()==2);click(p,'[data-action=build-style][data-id=detailed]');ck('Boundary mode refuses to claim detailed source success','브이월드' in p.locator('#building-style-info').inner_text())
  click(p,'[data-action=finish-check]');p.wait_for_function('document.querySelector("#live-diagnostic").textContent.includes("WebGL 미사용")');ck('Actual renderer type, not configured flag, is reported',True)
  click(p,'[data-action=infra]');click(p,'[data-action=civic-index]');ck('18 separately named civic records',p.locator('#detail-body .record').count()==18);click(p,'#detail-body .record');ck('Civic record opens provenance panel','자료 출처' in p.locator('#detail-body').inner_text())
  click(p,'[data-action=infra]');click(p,'[data-action=address-review]');ck('Public address queue includes relocation warning','임시이전' in p.locator('#detail-body').inner_text());ck('Address records remain nonspatial until checked',p.locator('#detail-body .record').count()==33)
  click(p,'.overview-card');click(p,'[data-action=tools]');click(p,'[data-action=editor-new]');input_(p,'editor-name','TEST ONLY 작성·복원 구간');input_(p,'editor-source','TEST FIXTURE · 실제 작업 아님')
  click(p,'[data-action=editor-save]');ck('Empty geometry cannot be registered','두 지점' in p.locator('#toast').inner_text())
  click(p,'[data-action=editor-capture]')
  # Project two known Seo-gu coordinates using the same public camera and Canvas mapping.
  coords=p.evaluate('''async()=>{const g=await import(window.__testModules['/src/city/geometry.js']);const c=await import(window.__testModules['/src/city/camera.js']);const d=window.__data['/data/admin-dongs.geojson'];const district=g.unionGeometry(d.features.map(f=>f.geometry));const pose=c.frameFor(district,'overview',{width:1020,height:770});const el=document.querySelector('.boundary-canvas'),r=el.getBoundingClientRect(),w=r.width,h=r.height,scale=h/pose.range*1.3,a=pose.heading*Math.PI/180;return [[126.85,35.15],[126.86,35.15]].map(p=>{const x=(p[0]-pose.center[0])*111320*Math.cos(p[1]*Math.PI/180),y=(p[1]-pose.center[1])*111320;return {x:r.x+w/2+(x*Math.cos(a)-y*Math.sin(a))*scale,y:r.y+h/2-(x*Math.sin(a)+y*Math.cos(a))*scale*.82};});}''')
  for point in coords:p.mouse.click(point['x'],point['y']);p.wait_for_timeout(100)
  ck('Real Canvas clicks collect route points','2개 지점' in p.locator('#editor-count').inner_text(),p.locator('#editor-count').inner_text())
  click(p,'[data-action=editor-undo]');ck('Undo removes only last vertex','1개 지점' in p.locator('#editor-count').inner_text());p.mouse.click(coords[-1]['x'],coords[-1]['y']);p.wait_for_timeout(100)
  click(p,'[data-action=editor-save]');ck('Registered geometry moves to record collection','기록 보관함' in p.locator('#detail-title').inner_text());ck('No default times silently claim work complete','1항목' in p.locator('#detail-body').inner_text());ck('Line count is visible for operational route','1개' in p.locator('#line-count').inner_text())
  click(p,'[data-action=records-save]');ck('Explicit save uses versioned payload',p.evaluate('window.__fixtureStorage.size')==1)
  click(p,'[data-action=records-load]');ck('Restore succeeds with state validation','다시 검사' in p.locator('#toast').inner_text())
  with p.expect_download() as dl:click(p,'[data-action=records-layer]')
  data=json.loads(Path(dl.value.path()).read_text());ck('Export is actual GeoJSON not UI state only',data['features'][0]['geometry']['type'] in ['LineString','MultiLineString']);ck('Missing timestamps remain unknown',data['features'][0]['properties']['status']=='unknown')
  click(p,'[data-action=records-delete]');ck('Stored records require confirmation before delete',p.evaluate('window.__fixtureStorage.size')==1)
  p.locator('#records-delete-confirm').check();click(p,'[data-action=records-delete]');ck('Explicit delete clears storage only',p.evaluate('window.__fixtureStorage.size')==0)
  p.screenshot(path=str(OUT/'record-workflow-NOT-3D.png'))
  click(p,'[data-action=infra]');click(p,'[data-action=infra-select][data-id=school]');ck('After editing, solo school removes route layer',not p.locator('[data-layer=infra-snow-routes]').is_checked());ck('School source unchanged','52' in p.locator('#point-count').inner_text());p.screenshot(path=str(OUT/'school-and-source-NOT-3D.png'))
  ck('Desktop application has no JS exceptions',not errors,errors)
 except Exception as e:
  results.append({'name':'fatal','passed':False,'error':str(e)});print(traceback.format_exc());p.screenshot(path=str(OUT/'failed-NOT-3D.png'))
 finally:
  (OUT/'results.json').write_text(json.dumps({'scope':'Real application and BoundaryView; network and storage explicitly mocked; NOT WebGL/live authentication','results':results,'pageErrors':errors},ensure_ascii=False,indent=2));b.close()
if not all(x['passed'] for x in results):raise SystemExit(1)
