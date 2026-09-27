"""User-requested, bounded public spatial-data audit. Never exports credentials or page HTML.
Browser requests remain on the owner's registered origin and use only the browser SDK key
already intentionally provided to that origin; no private keys or third-party sample keys.
"""
import json, re, time, hashlib, subprocess, urllib.request
from pathlib import Path
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
OUT=Path('v05-evidence');OUT.mkdir(exist_ok=True)
ORIGIN='https://seogu-on.vercel.app'
def write(name,body):
 (OUT/name).write_text(json.dumps(body,ensure_ascii=False,indent=2),encoding='utf8')
manifest={'retrievedAt':datetime.now(timezone.utc).isoformat(),'requests':[],'credentialsRecorded':False}
doc='https://www.vworld.kr/dev/v4dv_wmsguide2_s001.do'
try:
 data=urllib.request.urlopen(doc,timeout=25).read(); soup=BeautifulSoup(data,'html.parser');tables=[]
 for t in soup.select('table'):
  text=t.get_text(' ',strip=True)
  if 'lt_c_' in text or 'typename' in text.lower():
   rows=[];spans={}
   for tr in t.select('tr'):
    cells=[];i=0
    for cell in tr.find_all(['td','th'],recursive=False):
     while i in spans:
      val,left=spans.pop(i);cells.append(val)
      if left>1:spans[i]=(val,left-1)
      i+=1
     val=cell.get_text(' ',strip=True);cs=int(cell.get('colspan',1));rs=int(cell.get('rowspan',1))
     for _ in range(cs):
      cells.append(val)
      if rs>1:spans[i]=(val,rs-1)
      i+=1
    while i in spans:
     val,left=spans.pop(i);cells.append(val)
     if left>1:spans[i]=(val,left-1)
     i+=1
    if cells:rows.append(cells)
   tables.append(rows)
 write('official-wms-catalog.json',{'sourceUrl':doc,'sha256':hashlib.sha256(data).hexdigest(),'tables':tables})
 manifest['requests'].append({'source':'official WMS/WFS reference','status':'received','bytes':len(data)})
except Exception as e:manifest['requests'].append({'source':'official WMS/WFS reference','status':type(e).__name__})
write('baseline.json',{'commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'origin':ORIGIN})
THEMES=['lt_c_up201','lt_c_up401','lt_c_uq125','lt_c_uq124','lt_c_usfsffb','lt_c_wkmstrm','lt_c_asitsoildra','lt_c_kfdrssigugrade','lt_c_upisuq156','lt_c_upisuq153','lt_c_upisuq155','lt_p_smalllibrary','lt_p_dgmuseumart','lt_p_tradsijang','lt_p_bycracks','lt_c_desch','lt_c_dmsch','lt_c_bldginfo','lt_c_uo101','lt_c_fsdifrsts']
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':960},device_scale_factor=1)
 try:
  page.goto(ORIGIN,wait_until='domcontentloaded',timeout=45000)
  cfg=page.evaluate("async()=>{try {const r=await fetch('/api/city-config');let b=await r.json();return {http:r.status,version:b.version,configured:b.configured};}catch{return {error:'unavailable'}}}")
  write('production-config.json',cfg)
  page.goto(ORIGIN+'/api/city-scene',wait_until='domcontentloaded',timeout=45000)
  # Only boolean presence is returned. The SDK credential never leaves this browser page.
  present=page.evaluate("()=>!!Array.from(document.scripts).find(s=>s.src.includes('webglMapInit.js.do'))")
  if present:
   for theme in THEMES:
    result=page.evaluate("""async theme=>{
      const sdk=Array.from(document.scripts).find(s=>s.src.includes('webglMapInit.js.do'));
      const k=sdk&&new URL(sdk.src).searchParams.get('apiKey');
      if(!k)return {state:'sdk-key-unavailable'};
      const url=new URL('https://api.vworld.kr/req/wfs');
      const pars={service:'WFS',request:'GetFeature',version:'2.0.0',typename:theme,output:'application/json',srsname:'EPSG:3857',bbox:'14112441,4176746,14134664,4197269',count:'1000',startindex:'0',key:k,domain:location.origin};
      for(const [a,b]of Object.entries(pars))url.searchParams.set(a,b);
      try{const r=await fetch(url,{signal:AbortSignal.timeout(9000)});const text=await r.text();let b;try{b=JSON.parse(text)}catch{return {state:'non-json-response',http:r.status}};
       const fs=b.features||b.response?.result?.featureCollection?.features;
       if(!Array.isArray(fs))return {state:'api-error',http:r.status,code:String(b.response?.error?.code||b.error?.code||b.code||'unknown').slice(0,70)};
       const safe=['name','uname','nm','fac_nm','fclty_nm','fclty_nam','buld_nm','sigg_name','sido_name','sigungu_cd','dyear','ucode','grade','risk','grd','adres','road_nm','addr','full_nm','lib_nm','muse_nm','market_nm','height','buld_hg','buldhg','grnd_flr','groundfloor','bldg_nm'];
       return {state:'received',http:r.status,crs:b.crs||null,numberMatched:b.numberMatched??b.totalFeatures??null,timeStamp:b.timeStamp??null,features:fs.map((f,i)=>({type:'Feature',id:String(f.id||theme+'-'+i),geometry:f.geometry,properties:Object.fromEntries(Object.entries(f.properties||{}).filter(([k])=>safe.includes(k.toLowerCase())).map(([k,v])=>[k,typeof v==='string'?v.slice(0,300):typeof v==='number'?v:null]))}))};
      }catch{return {state:'request-unavailable'}}
     }""",theme)
    write(theme+'.json',result);manifest['requests'].append({'theme':theme,'state':result['state'],'count':len(result.get('features',[]))});print(theme,result['state'],len(result.get('features',[])))
    time.sleep(.25)
   page.wait_for_timeout(5000)
   info=page.evaluate("""()=>{const v=window.ws3d?.viewer,C=window.Cesium;if(!v)return {ready:false};const c=v.scene.canvas;return {ready:true,cesiumVersion:C?.VERSION,css:[c.clientWidth,c.clientHeight],buffer:[c.width,c.height],light:v.scene.light?.constructor?.name,shadowMap:v.shadowMap?{enabled:v.shadowMap.enabled,maximumDistance:v.shadowMap.maximumDistance}:null,viewerShadows:v.shadows,terrainShadows:v.terrainShadows,globeLighting:v.scene.globe.enableLighting,rayFunction:typeof v.scene.pickFromRay,rayDetailed:typeof v.scene.pickFromRayMostDetailed,primitiveCount:v.scene.primitives.length};}""")
   write('native-viewer-before.json',info)
  else:manifest['requests'].append({'source':'owner registered origin','state':'sdk-key-unavailable'})
 except Exception as e:manifest['requests'].append({'source':'owner browser audit','state':type(e).__name__})
 browser.close()
write('manifest.json',manifest)
