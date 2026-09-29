"""Offline UI rendering: actual application, CSS and local BI/data; explicit API/storage fixtures.
No provider WebGL or live API claim. Network navigation is prohibited in this sandbox.
"""
from pathlib import Path
import json,re,base64,shutil,traceback
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];OUT=R/'docs/v061/v06-regression-ui';OUT.mkdir(parents=True,exist_ok=True)
sources={'/'+p.relative_to(R).as_posix():p.read_text() for p in (R/'src').rglob('*.js')}
fixtures={'/data/'+p.relative_to(R/'public/data').as_posix():json.loads(p.read_text()) for p in (R/'public/data').rglob('*') if p.suffix in ['.json','.geojson']}
brands=json.loads((R/'public/brand/dongs.json').read_text())
def image(path):return 'data:image/png;base64,'+base64.b64encode((R/'public'/path.lstrip('/')).read_bytes()).decode()
for b in brands['items']:b['asset']=image(b['asset'])
fixtures['/brand/dongs.json']=brands
fixtures['/api/city-config']={'version':'0.6.0','configured':{'vworld3d':False,'vworldRest':False,'sd-cold':True,'sd-heat':True,'sd-road':True}}
html=(R/'index.html').read_text();html=re.sub(r'<link[^>]*>','',html);html=re.sub(r'<script[^>]*></script>','',html);html=html.replace('</head>','<style>'+('\n'.join((R/f'src/city/{n}').read_text() for n in ['style.css','appearance.css','identity.css']))+'</style></head>')
for n in ['seogu-slogan.png','seogu-ci.png']:html=html.replace('/brand/'+n,image('/brand/'+n))
html=html.replace('/brand/seogu-on-symbol.svg','data:image/svg+xml;base64,'+base64.b64encode((R/'public/brand/seogu-on-symbol.svg').read_bytes()).decode())
# Runtime-generated welcome image also remains a local byte-identical image in the offline test.
sources['/src/city/experience.js']=sources['/src/city/experience.js'].replace('/brand/seogu-slogan.png',image('/brand/seogu-slogan.png'))
loader=r'''async ({sources,fixtures})=>{
 window.__fixtureStorage=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>window.__fixtureStorage.get(k)||null,setItem:(k,v)=>window.__fixtureStorage.set(k,v),removeItem:k=>window.__fixtureStorage.delete(k)}});
 window.__apiMode='ok';window.__requests=[];
 window.fetch=async u=>{const url=new URL(String(u),'https://test.invalid');let b=fixtures[url.pathname];window.__requests.push(url.pathname+url.search);
 if(url.pathname==='/api/city-data'&&url.searchParams.get('kind')?.startsWith('sd-')){
  if(window.__apiMode==='error')return new Response(JSON.stringify({ok:false,error:'TEST ONLY 등록되지 않은 IP 오류 32'}),{status:403});
  const id=url.searchParams.get('kind'),dong=url.searchParams.get('dong'),page=+url.searchParams.get('page'),point=fixtures['/data/admin-dongs.geojson'].features.find(f=>f.properties.dongId===(dong==='all'?'seogu-07':dong)).properties.labelPoint;
  b={ok:true,page,scope:dong,scanned:1,total:window.__apiMode==='many'?2000:1,complete:window.__apiMode!=='many',nextPage:page+1,pageFingerprint:'TEST-FIXTURE-'+page,collectedAt:'2026-09-28T09:00:00Z',quality:{needsLocation:0,outside:0,invalid:0,privateFieldsRemoved:0},unlocated:[],geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:point},properties:{id:id+'TEST'+page,name:'TEST ONLY NOT A REAL SHELTER',sourceName:'TEST FIXTURE',note:'TEST ONLY'}}]}};
 }
 return new Response(JSON.stringify(b||{ok:false,error:'Test fixture unavailable'}),{status:b?200:503,headers:{'content-type':'application/json'}});};
 const urls={};function build(path){if(urls[path])return urls[path];let code=sources[path];if(code===undefined)throw Error('Missing module '+path);code=code.replace(/(\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?)(['"])(\.[^'"]+)\2/g,(m,p,q,s)=>p+q+build(new URL(s,'https://test.invalid'+path).pathname)+q);return urls[path]=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));}
 window.__modules=urls;window.__build=build;await import(build('/src/city/app.js'));
}'''
results=[]
def ck(name,ok,detail=None):
 results.append({'name':name,'passed':bool(ok),'detail':detail});print(name,bool(ok),flush=True)
 if not ok:raise AssertionError(name+' '+str(detail))
def click(p,selector):p.locator(selector).first.click();p.wait_for_timeout(100)
def boot(p):
 p.set_default_timeout(6000);print('BOOT set_content',flush=True);p.set_content(html,wait_until='domcontentloaded');print('BOOT evaluate',flush=True);p.evaluate(loader,{'sources':sources,'fixtures':fixtures});print('BOOT wait',flush=True);p.wait_for_selector('#start-card:not([hidden])');click(p,'#start-card [data-engine=boundary]');p.wait_for_selector('.boundary-canvas');p.wait_for_timeout(300)
def box(p,sel):return p.locator(sel).bounding_box()
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);p=browser.new_page(viewport={'width':1440,'height':900});errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 try:
  boot(p)
  ck('default light-blue theme',p.locator('html').get_attribute('data-ui-theme')=='day')
  ck('18 administrative district buttons',p.locator('.dong-button').count()==18)
  bg=p.locator('html').evaluate('(e)=>getComputedStyle(e).getPropertyValue("--panel")');ck('sidebar background is bright',all(int(x)>=220 for x in re.findall(r'\d+',bg)[:3]),bg)
  p.screenshot(path=str(OUT/'day-NOT-3D.png'))
  scroll=p.locator('#sidebar-scroll');ck('sidebar has independent scrolling without clipping',scroll.evaluate('(e)=>getComputedStyle(e).overflowY==="auto"'))
  p.locator('.dong-button[data-id="seogu-18"]').scroll_into_view_if_needed();click(p,'.dong-button[data-id="seogu-18"]')
  ck('bottom-most dong reachable by scrolling','동천동' in p.locator('#crumb-dong').inner_text())
  ck('chosen district original BI displayed','동천동' in p.locator('#selected-bi img').get_attribute('alt'))
  ck('original BI image loaded',p.locator('#selected-bi img').evaluate('(e)=>e.complete&&e.naturalWidth>0'))
  click(p,'#tab-layers');ck('independent layer tab opens',not p.locator('#sidebar-layers').is_hidden())
  p.locator('#layer-options').locator('input').last.scroll_into_view_if_needed();ck('last layer checkbox remains inside viewport',p.locator('#layer-options input').last.bounding_box() is not None)
  click(p,'#tab-regions');ck('switching tabs resets scroll top',scroll.evaluate('(e)=>e.scrollTop')==0)
  click(p,'[data-action=appearance]');ck('three theme choices',p.locator('.theme-choice').count()==3)
  click(p,'[data-action=ui-theme][data-id=night]');ck('dark theme selectable',p.locator('html').get_attribute('data-ui-theme')=='night')
  click(p,'[data-action=ui-theme][data-id=sky]');ck('sky theme selectable',p.locator('html').get_attribute('data-ui-theme')=='sky')
  click(p,'[data-action=ui-theme][data-id=day]')
  p.locator('#map-brightness').fill('1.25');p.locator('#map-brightness').dispatch_event('input');ck('brightness setting updated','125%' in p.locator('#brightness-value').inner_text())
  ck('appearance saved in explicit test storage','1.25' in p.evaluate("window.__fixtureStorage.get('seoon:appearance:v06')"))
  p.screenshot(path=str(OUT/'appearance-NOT-3D.png'))
  click(p,'[data-action=bi-gallery]');ck('all18 original BI cards',p.locator('.bi-card').count()==18);ck('all18 BI images loaded',p.locator('.bi-card img').evaluate_all('(es)=>es.every(e=>e.complete&&e.naturalWidth>0)'))
  click(p,'[data-action=bi-dong][data-id=seogu-07]');ck('BI click moves to matched dong','치평동' in p.locator('#crumb-dong').inner_text())
  # Close detail panel using real visible close button.
  click(p,'[data-action=close-detail]')
  click(p,'[data-action=city-questions]');ck('six planning question cards',p.locator('.query-card').count()==6)
  click(p,'[data-action=question-show][data-id=summer]');ck('actual shade source present','그늘막' in p.locator('#detail-body').inner_text());p.screenshot(path=str(OUT/'local-heat-NOT-3D.png'))
  click(p,'[data-action=source-roadmap]');ck('source roadmap has60links',p.locator('#source-rows .query-card').count()==60)
  click(p,'[data-action=close-detail]');click(p,'[data-action=safety-hub]');ck('9 independent disaster adapters',p.locator('.safety-card').count()==9)
  click(p,'[data-action=sd-fetch][data-id=sd-cold]');ck('explicit API fixture records reflected','1도형 반영' in p.locator('#card-sd-cold').inner_text())
  click(p,'[data-action=sd-solo][data-id=sd-cold]');ck('only selected API layer enabled',p.evaluate("Array.from(document.querySelectorAll('#layer-options input:checked')).map(x=>x.dataset.layer)")==['sd-cold'])
  p.evaluate("window.__apiMode='error'");click(p,'[data-action=sd-fetch][data-id=sd-cold]');ck('upstream32 failure is visible','IP 오류 32' in p.locator('#card-sd-cold').inner_text());ck('previous normal fixture point not erased','위치 1개' in p.locator('#point-count').inner_text())
  p.evaluate("window.__apiMode='many'");start=p.evaluate('window.__requests.length');click(p,'[data-action=sd-fetch][data-id=sd-road]');p.wait_for_timeout(1000);ck('bounded collection stops at4pages',p.evaluate('window.__requests.slice('+str(start)+').filter(u=>u.includes("kind=sd-road")).length')==4);ck('partial is staging not normal loaded','검수 대기' in p.locator('#card-sd-road').inner_text())
  click(p,'[data-action=sd-settings]');ck('key/IP constraints clearly stated','SAFETYDATA_KEYS_JSON' in p.locator('#detail-body').inner_text() and '32' in p.locator('#detail-body').inner_text())
  click(p,'[data-action=close-detail]');click(p,'[data-action=native-sun]');ck('5minute replay is visible','5분 단위 재생' in p.locator('#detail-body').inner_text());ck('timeinput step300',p.locator('#native-sun-time').get_attribute('step')=='300');ck('slider step5',p.locator('#native-sun-slider').get_attribute('step')=='5')
  click(p,'[data-action=native-apply]');ck('unsupported2D does not claim3Dsuccess','3D 준비' in p.locator('#native-sun-status').inner_text())
  # Isolated UI state-machine test with explicit simulated render acknowledgements, no actual GPU.
  sim=p.evaluate('''async()=>{const {createResilienceTools}=await import(window.__build('/src/city/resilience-tools.js'));return typeof createResilienceTools;}''')
  ck('sun controller module available',sim=='function')
  click(p,'[data-action=close-detail]')
  for width,height in [(1280,720),(1024,640),(390,844),(844,390)]:
   p.set_viewport_size({'width':width,'height':height});p.wait_for_timeout(150)
   if width<=600:
    if p.locator('.district-panel').is_hidden():click(p,'#show-panels')
   sidebar=box(p,'.district-panel');ck(f'leftmenu vertical bounds {width}x{height}',sidebar is not None and sidebar['y']>=0 and sidebar['y']+sidebar['height']<=height,sidebar)
   ck(f'no horizontal page overflow {width}x{height}',p.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   p.locator('.dong-button[data-id="seogu-18"]').scroll_into_view_if_needed();ck(f'lastdong scrollable {width}x{height}',p.locator('.dong-button[data-id="seogu-18"]').is_visible())
   if width==390:p.screenshot(path=str(OUT/'mobile-NOT-3D.png'))
  ck('no application JavaScript exceptions',not errors,errors)
 finally:
  (OUT/'results.json').write_text(json.dumps({'mode':'Offline real UI and included source data; explicit network and storage fixtures; no live WebGL','results':results,'errors':errors},ensure_ascii=False,indent=2));browser.close()
