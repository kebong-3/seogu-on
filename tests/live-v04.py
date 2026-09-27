"""Optional production/preview browser probe. Run on a WebGL-capable user PC.
No credentials, source HTML, full URLs or network logs are saved. Never counts SDK ready as model quality validation.
Usage: python tests/live-v04.py https://your-domain.example --headed
Requires: pip install playwright; python -m playwright install chromium
"""
import argparse,json
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser();parser.add_argument('url');parser.add_argument('--headed',action='store_true');parser.add_argument('--wait',type=int,default=30);a=parser.parse_args()
u=urlsplit(a.url)
if u.scheme not in ('http','https') or not u.netloc or u.username or u.password or u.query or u.fragment:raise SystemExit('Use the deployment origin only, without credentials/query/fragment.')
origin=f'{u.scheme}://{u.netloc}'
report={'kind':'USER-RUN live probe','origin':origin,'credentialsRecorded':False,'results':[]}
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=not a.headed);page=browser.new_page(viewport={'width':1440,'height':960});page.goto(origin,wait_until='domcontentloaded');page.wait_for_timeout(max(5,min(a.wait,90))*1000)
 report['version']=page.evaluate("async()=>{try{const r=await fetch('/api/city-config');const b=await r.json();return b.version||'unknown';}catch{return 'unavailable'}}")
 for mode in ('vworld','clean'):
  page.goto(origin+'/?map='+mode,wait_until='domcontentloaded');page.wait_for_timeout(max(5,min(a.wait,90))*1000)
  info={'engineRequested':mode,'iframeCount':len(page.frames)-1,'uiStatus':page.locator('#engine-state').inner_text()}
  for frame in page.frames[1:]:
   try:
    info['viewer']=frame.evaluate("""()=>{const v=window.seoCleanViewer||window.ws3d?.viewer;if(!v)return {present:false};const c=v.scene?.canvas;return {present:true,canvasCss:[c?.clientWidth,c?.clientHeight],canvasBuffer:[c?.width,c?.height],resolutionScale:v.resolutionScale,primitiveCount:v.scene?.primitives?.length,dataSourceCount:v.dataSources?.length,terrainType:v.terrainProvider?.constructor?.name};}""")
   except Exception:info['viewer']={'present':False,'reason':'Viewer inspection unavailable'}
  info['notVerified']='Visual quality, model completeness, terrain accuracy and API entitlements require manual checks.'
  report['results'].append(info)
 browser.close()
out=Path('live-v04-result.json');out.write_text(json.dumps(report,ensure_ascii=False,indent=2));print(f'Wrote {out}. Inspect actual scenes manually; this is not an accuracy certificate.')
