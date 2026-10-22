"""Offline UI rendering: actual application, CSS and local BI/data; explicit API/storage fixtures.
No provider WebGL or live API claim. Network navigation is prohibited in this sandbox.
"""
from pathlib import Path
import json,re,base64,shutil,traceback
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];OUT=R/'docs/v061/ui';OUT.mkdir(parents=True,exist_ok=True)
sources={'/'+p.relative_to(R).as_posix():p.read_text() for folder in ('src','shared') for p in (R/folder).rglob('*.js')}
fixtures={'/data/'+p.relative_to(R/'public/data').as_posix():json.loads(p.read_text()) for p in (R/'public/data').rglob('*') if p.suffix in ['.json','.geojson']}
fixtures['/api/region-profile']={'ok':True,'profile':fixtures['/data/regions/seogu.json']}
brands=json.loads((R/'public/brand/dongs.json').read_text())
def image(path):return 'data:image/png;base64,'+base64.b64encode((R/'public'/path.lstrip('/')).read_bytes()).decode()
for b in brands['items']:b['asset']=image(b['asset'])
fixtures['/brand/dongs.json']=brands
fixtures['/api/city-config']={'version':'0.6.0','configured':{'vworld3d':False,'vworldRest':False,'sd-cold':True,'sd-heat':True,'sd-road':True}}
html=(R/'index.html').read_text()
# Preserve the deployed stylesheet order, including the current layout and work panels.
css_paths=re.findall(r'''<link\b[^>]*href=["'](/[^"']+\.css)["'][^>]*>''',html)
css='\n'.join((R/path.lstrip('/')).read_text() for path in css_paths)
html=re.sub(r'<link[^>]*>','',html);html=re.sub(r'<script[^>]*></script>','',html);html=html.replace('</head>','<style>'+css+'</style></head>')
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
 const urls={};function build(path){if(urls[path])return urls[path];let code=sources[path];if(code===undefined)throw Error('Missing module '+path);code=code.replace(/(\b(?:import|export)\s+(?:[^;'"]*?\s+from\s*)?)(['"])(\.[^'"]+)\2/g,(m,p,q,s)=>p+q+build(new URL(s,'https://test.invalid'+path).pathname)+q);return urls[path]=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));}
 window.__modules=urls;window.__build=build;await import(build('/src/city/app.js'));
}'''

results=[]
def ck(name,ok,detail=None):
 results.append({'name':name,'passed':bool(ok),'detail':detail});print(name,bool(ok),flush=True)
 if not ok:raise AssertionError(name+' '+str(detail))
def click(p,selector):
 if not p.locator(selector+':visible').count() and p.locator('#home-more-list').locator(selector).count():
  if not p.locator('#district-panel').is_visible():
   if p.locator('#detail-panel').is_visible():p.locator('[data-action=close-detail]').click()
   p.locator('#show-panels').click()
  if p.locator('#home-more-toggle').get_attribute('aria-expanded')!='true':p.locator('#home-more-toggle').click()
 p.locator(selector+':visible').first.click();p.wait_for_timeout(100)
def boot(p):
 p.set_default_timeout(6000);p.set_content(html,wait_until='domcontentloaded');p.evaluate(loader,{'sources':sources,'fixtures':fixtures});p.wait_for_selector('#start-card:not([hidden])');click(p,'#start-card [data-engine=boundary]');p.wait_for_selector('.boundary-canvas');p.wait_for_timeout(250)
def box(p,sel):return p.locator(sel).bounding_box()
def visible_inside(p,sel):
 b=box(p,sel)
 return b is not None and b['x']>=-1 and b['y']>=-1 and b['x']+b['width']<=p.viewport_size['width']+1 and b['y']+b['height']<=p.viewport_size['height']+1
def check_caption(p,name,max_height,max_width,min_font_size):
 # The readable title/BI now use a taller, wider caption. Keep compactness and
 # viewport checks, and ensure the extra room actually prevents clipped content.
 layout=p.locator('.scene-caption').evaluate(r'''e=>{
  const rect=e.getBoundingClientRect(),title=e.querySelector('h2'),bi=e.querySelector('#selected-bi'),img=bi?.querySelector('img');
  const inside=(child,parent)=>{const r=child.getBoundingClientRect(),b=parent.getBoundingClientRect();return r.left>=b.left-1&&r.top>=b.top-1&&r.right<=b.right+1&&r.bottom<=b.bottom+1;};
  const children=[...e.children].filter(child=>child.getClientRects().length>0);
  return {width:rect.width,height:rect.height,fontSize:parseFloat(getComputedStyle(title).fontSize),
   contentFits:children.every(child=>inside(child,e)),
   titleFits:title.scrollWidth<=title.clientWidth+1&&title.scrollHeight<=title.clientHeight+1,
   imageFits:!bi?.getClientRects().length||!!img&&inside(img,bi)};
 }''')
 ck(name,visible_inside(p,'.scene-caption') and layout['height']<=max_height and layout['width']<=max_width and layout['fontSize']>=min_font_size and layout['contentFits'] and layout['titleFits'] and layout['imageFits'],layout)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);p=browser.new_page(viewport={'width':1440,'height':900});errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 try:
  boot(p)
  ck('Korean document title','서구:온' in p.title() and 'SEO:ON' not in p.title())
  ck('Korean brand name',p.locator('.brand-name').get_attribute('aria-label')=='서구:온')
  ck('brand tagline present','서구의 오늘을 한눈에' in p.locator('.brand').inner_text())
  ck('original vector emblem loaded',p.locator('.brand-emblem').evaluate('(e)=>e.complete&&e.naturalWidth>0'))
  ck('no visible English district heading','DISTRICT VIEW' not in p.locator('body').inner_text())
  ck('old attribution ribbon removed',p.locator('.map-attribution').count()==0)
  ck('short map source control exists',p.locator('#map-credits summary').is_visible())
  ck('OpenStreetMap credit still legible',p.locator('.osm-minicredit').is_visible())
  ck('metrics not in visible region caption',not any(x in p.locator('.scene-caption').inner_text() for x in ['0개','위치','탐색','도형','가까이']))
  ck('internal renderer metrics hidden',p.locator('#render-diagnostics').is_hidden())
  check_caption(p,'city overview caption compact and legible',88,470,22)
  ck('18 administrative neighborhoods retained',p.locator('.dong-button').count()==18)
  p.screenshot(path=str(OUT/'overview-2D.png'))
  for i in range(1,19):
   id='seogu-'+str(i).zfill(2);b=brands['items'][i-1]
   click(p,f'.dong-button[data-id="{id}"]');p.wait_for_timeout(60)
   ck('name and original BI linked '+id,p.locator('#scope-title').inner_text()==b['name'] and p.locator('.scene-caption #selected-bi img').get_attribute('alt')==b['title'])
   ck('original BI image loads '+id,p.locator('.scene-caption #selected-bi img').evaluate('(e)=>e.complete&&e.naturalWidth>0'))
  click(p,'.dong-button[data-id="seogu-13"]')
  check_caption(p,'district caption compact without clipped title or BI',88,470,22)
  p.screenshot(path=str(OUT/'district-2D.png'))
  p.locator('.brand').screenshot(path=str(OUT/'brand-detail.png'))
  p.locator('.scene-caption').screenshot(path=str(OUT/'district-detail.png'))
  click(p,'[data-action=appearance]')
  ck('3 themes retained',p.locator('.theme-choice').count()==3)
  ck('raised finish default',p.locator('html').get_attribute('data-ui-finish')=='depth')
  p.screenshot(path=str(OUT/'appearance-2D.png'))
  click(p,'[data-action=ui-finish][data-id=flat]');ck('flat finish option',p.locator('html').get_attribute('data-ui-finish')=='flat')
  ck('flat removes panel shadow',p.locator('.district-panel').evaluate('(e)=>getComputedStyle(e).boxShadow')=='none')
  click(p,'[data-action=ui-finish][data-id=depth]');ck('depth restores panel shadow',p.locator('.district-panel').evaluate('(e)=>getComputedStyle(e).boxShadow')!='none')
  click(p,'[data-action=ui-theme][data-id=night]');ck('night theme retained',p.locator('html').get_attribute('data-ui-theme')=='night');p.screenshot(path=str(OUT/'night-2D.png'))
  click(p,'[data-action=ui-theme][data-id=sky]');ck('sky theme retained',p.locator('html').get_attribute('data-ui-theme')=='sky')
  click(p,'[data-action=ui-theme][data-id=day]')
  p.locator('#map-brightness').fill('1.25');p.locator('#map-brightness').dispatch_event('input');ck('brightness value preserved','125%' in p.locator('#brightness-value').inner_text())
  p.locator('#show-brands').uncheck();ck('BI visibility preference disables caption image',p.locator('#selected-bi').is_hidden());p.locator('#show-brands').check();ck('BI preference restores caption image',p.locator('#selected-bi').is_visible())
  ck('preferences saved to explicit test storage','"finish":"depth"' in p.evaluate("window.__fixtureStorage.get('seoon:appearance:v06')"))
  click(p,'[data-action=close-detail]')
  click(p,'#map-credits summary');ck('credit popover opens',p.locator('#map-credits').get_attribute('open') is not None)
  ck('provider and boundary attribution preserved','국토교통부·브이월드' in p.locator('#map-credits').text_content() and 'CC BY 4.0' in p.locator('#map-credits').text_content())
  ck('credit popover inside viewport',visible_inside(p,'.credit-popover'))
  p.screenshot(path=str(OUT/'sources-2D.png'))
  p.keyboard.press('Escape');ck('Esc closes attribution panel',p.locator('#map-credits').get_attribute('open') is None)
  click(p,'#map-credits summary');click(p,'[data-action=credits]');ck('complete source information opens',not p.locator('#detail-panel').is_hidden() and '국토교통부·브이월드' in p.locator('#detail-body').inner_text())
  click(p,'[data-action=close-detail]');click(p,'.brand');ck('Korean logo returns to overview',p.locator('#scope-title').inner_text()=='서구 전체')
  click(p,'#tab-layers');ck('layer tab remains functional',not p.locator('#sidebar-layers').is_hidden());click(p,'#tab-regions')
  click(p,'[data-action=native-sun]');ck('existing5min control preserved','5분 단위 재생' in p.locator('#detail-body').inner_text());click(p,'[data-action=close-detail]')
  for w,h in [(1920,1080),(1440,900),(1280,720),(1024,640),(844,390),(390,844),(360,740),(320,640)]:
   p.set_viewport_size({'width':w,'height':h});p.wait_for_timeout(150)
   if w<=820 and p.locator('.district-panel').is_hidden():click(p,'#show-panels')
   ck(f'sidebar vertical fit {w}x{h}',visible_inside(p,'.district-panel'),box(p,'.district-panel'))
   p.locator('.dong-button[data-id="seogu-18"]').scroll_into_view_if_needed();ck(f'last neighborhood reachable {w}x{h}',visible_inside(p,'.dong-button[data-id="seogu-18"]'))
   ck(f'brand tagline visible {w}x{h}',p.locator('.brand-tagline').is_visible())
   ck(f'header emblem and actions do not overlap {w}x{h}',p.locator('.brand').bounding_box()['x']+p.locator('.brand').bounding_box()['width']<=p.locator('.top-actions').bounding_box()['x']+1)
   ck(f'footer source control reachable {w}x{h}',visible_inside(p,'#map-credits summary'))
   ck(f'no horizontal overflow {w}x{h}',p.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   if w<=600:
    click(p,'.dong-button[data-id="seogu-13"]');check_caption(p,f'compact and legible caption on mobile {w}',72,w-72,18)
    if w==390:p.screenshot(path=str(OUT/'mobile-2D.png'))
   if w==1280:p.screenshot(path=str(OUT/'laptop-2D.png'))
  ck('no unhandled JavaScript errors',not errors,errors)
 finally:
  (OUT/'results.json').write_text(json.dumps({'mode':'Actual app/modules/CSS/BI/local data rendered in 2D BoundaryView; explicit network and storage fixtures; no WebGL or live API claim','results':results,'errors':errors},ensure_ascii=False,indent=2));browser.close()
