"""Real WebGL regression using SYNTHETIC boxes; separately attempts owner's VWorld.
No key, request URL query, HTML source, browser storage, or network body is recorded.
"""
from pathlib import Path
import json,os,subprocess,time,urllib.request
from playwright.sync_api import sync_playwright
from PIL import Image,ImageChops,ImageStat
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/v05/gpu-evidence';OUT.mkdir(parents=True,exist_ok=True)
results={'mode':'Real WebGL with clearly synthetic box fixture; VWorld live separately identified','checks':[],'native':{}}
HTML='''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/vendor/cesium/Widgets/widgets.css"><style>html,body,#vmap{margin:0;width:100%;height:100%;overflow:hidden}.tag{position:absolute;z-index:4;top:8px;left:8px;color:white;background:#234;padding:8px;font:13px sans-serif}</style><script>window.CESIUM_BASE_URL='/vendor/cesium/'</script><script src='/vendor/cesium/Cesium.js'></script></head><body><div id='vmap'></div><div class='tag'>GPU TEST FIXTURE — SYNTHETIC BOXES, NOT REAL SEO-GU BUILDINGS</div></body></html>'''
SETUP='''async()=>{
const C=window.Cesium,{createSunController}=await import('/src/city/sun-engine.js');
const v=new C.Viewer('vmap',{baseLayer:false,terrainProvider:new C.EllipsoidTerrainProvider(),animation:false,timeline:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,skyBox:false,skyAtmosphere:false,scene3DOnly:true,requestRenderMode:true,shadows:false,contextOptions:{webgl:{antialias:true}}});
v.scene.globe.baseColor=C.Color.fromCssColorString('#bbc8bd');v.scene.globe.show=false;
let boxCount=0;
for(const [lon,lat,height] of [[126.86,35.145,60],[126.8607,35.1452,85],[126.8595,35.1456,40]]){
const p=v.scene.primitives.add(new C.Primitive({geometryInstances:new C.GeometryInstance({geometry:C.BoxGeometry.fromDimensions({dimensions:new C.Cartesian3(30,25,height),vertexFormat:C.PerInstanceColorAppearance.VERTEX_FORMAT}),modelMatrix:C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(lon,lat,height/2)),attributes:{color:C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString('#edf2eb'))}}),appearance:new C.PerInstanceColorAppearance({closed:true,translucent:false}),asynchronous:false,shadows:C.ShadowMode.ENABLED}));boxCount++;}
const ground=new C.Primitive({geometryInstances:new C.GeometryInstance({geometry:new C.PolygonGeometry({polygonHierarchy:new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray([126.856,35.141,126.864,35.141,126.864,35.149,126.856,35.149,126.856,35.141])),height:0,vertexFormat:C.PerInstanceColorAppearance.VERTEX_FORMAT}),attributes:{color:C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString('#b9c8b8'))}}),appearance:new C.PerInstanceColorAppearance({closed:false,translucent:false}),asynchronous:false,shadows:C.ShadowMode.ENABLED});v.scene.primitives.add(ground);
v.camera.lookAt(C.Cartesian3.fromDegrees(126.860,35.145,0),new C.HeadingPitchRange(C.Math.toRadians(335),C.Math.toRadians(-48),550));v.camera.lookAtTransform(C.Matrix4.IDENTITY);
window.__gpuViewer=v;window.__sun=createSunController(v,C,{getPose:()=>({center:[126.86,35.145],range:550}),emit:(type,data)=>window.__sunState=data});window.__renderErrors=0;v.scene.renderError.addEventListener(()=>window.__renderErrors++);window.__renderFrames=0;v.scene.postRender.addEventListener(()=>window.__renderFrames++);v.scene.requestRender();return {boxCount,cesium:C.VERSION};}'''
def check(name,passed,detail=None):results['checks'].append({'name':name,'passed':bool(passed),'detail':detail})
def image_diff(a,b):
 x=Image.open(a).convert('RGB').crop((0,55,1000,740));y=Image.open(b).convert('RGB').crop((0,55,1000,740));d=ImageChops.difference(x,y);return {'meanDifference':sum(ImageStat.Stat(d).mean)/3,'changedPixels':sum(1 for p in d.getdata() if max(p)>12)}
server=subprocess.Popen(['node','scripts/dev.mjs'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 for _ in range(50):
  try:urllib.request.urlopen('http://127.0.0.1:4173/',timeout=1);break
  except:time.sleep(.3)
 with sync_playwright() as pw:
  b=pw.chromium.launch(headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage'])
  p=b.new_page(viewport={'width':1000,'height':740},device_scale_factor=1)
  p.route('**/gpu-fixture',lambda route:route.fulfill(status=200,body=HTML,content_type='text/html'))
  p.goto('http://127.0.0.1:4173/gpu-fixture',wait_until='networkidle')
  try:
   init=p.evaluate(SETUP);check('Actual Cesium WebGL initialized',True,init);p.wait_for_timeout(2500);check('Canvas fills test viewport',p.evaluate('()=>window.__gpuViewer.scene.canvas.width>=900&&window.__gpuViewer.scene.canvas.height>=650'))
   for name,at in [('winter-morning','2026-12-22T09:00'),('winter-noon','2026-12-22T12:00'),('winter-afternoon','2026-12-22T15:00'),('summer-noon','2026-06-21T12:00')]:
    p.evaluate('(at)=>window.__sun.apply({time:at,shadows:true})',at);p.wait_for_timeout(1400);p.screenshot(path=str(OUT/('GPU-FIXTURE-'+name+'.png')));s=p.evaluate('()=>window.__sunState');results.setdefault('sunStates',{})[name]=s;check('Clock/shadow render '+name,s.get('enabled') and s.get('shadowMapEnabled') and s.get('phase')=='rendered',{'time':s.get('time'),'phase':s.get('phase'),'angles':s.get('angles')})
   diff=image_diff(OUT/'GPU-FIXTURE-winter-morning.png',OUT/'GPU-FIXTURE-winter-afternoon.png');check('Real rendered image changes by time',diff['changedPixels']>300,diff)
   alt=results['sunStates']['summer-noon']['angles']['altitude']-results['sunStates']['winter-noon']['angles']['altitude'];check('Summer solar altitude higher than winter',alt>35,alt)
   p.evaluate("()=>{window.__gpuViewer.shadows=false;window.__gpuViewer.shadowMap.enabled=false;window.__gpuViewer.scene.requestRender();}");p.wait_for_timeout(800);p.screenshot(path=str(OUT/'GPU-FIXTURE-shadow-disabled.png'));diff=image_diff(OUT/'GPU-FIXTURE-summer-noon.png',OUT/'GPU-FIXTURE-shadow-disabled.png');check('Shadow-map on/off changes actual pixels',diff['changedPixels']>50,diff)
   check('No renderer errors',p.evaluate('()=>window.__renderErrors')==0)
   p.evaluate("()=>window.__sun.apply({time:'2026-06-21T12:00',shadows:false})");check('Off state restored',not p.evaluate('()=>window.__sun.active'))
  except Exception as e:check('GPU execution','',type(e).__name__+': '+str(e)[:250])
  native=b.new_page(viewport={'width':1440,'height':960});network=[]
  native.on('requestfailed',lambda r:network.append({'host':r.url.split('/')[2] if '://' in r.url else 'unknown','failure':str(r.failure)[:65]}))
  native.route('**/src/city/sun-engine.js',lambda r:r.fulfill(path=str(ROOT/'src/city/sun-engine.js'),content_type='application/javascript'))
  try:
   native.goto('https://seogu-on.vercel.app/api/city-scene',wait_until='domcontentloaded',timeout=40000);native.wait_for_function('!!window.ws3d?.viewer?.scene',timeout=15000)
   s=native.evaluate("async()=>{const v=ws3d.viewer,C=Cesium;const {createSunController}=await import('/src/city/sun-engine.js');window.__nativeSun=createSunController(v,C,{getPose:()=>({center:[126.86,35.145],range:1800}),emit:(t,s)=>window.__nativeState=s});v.camera.lookAt(C.Cartesian3.fromDegrees(126.86,35.145,30),new C.HeadingPitchRange(0,-.8,1800));v.camera.lookAtTransform(C.Matrix4.IDENTITY);return {cesium:C.VERSION};}")
   for name,t in [('winter','2026-12-22T12:00'),('summer','2026-06-21T12:00')]:
    native.evaluate('(time)=>window.__nativeSun.apply({time,shadows:true})',t);native.wait_for_timeout(5000);native.screenshot(path=str(OUT/('VWORLD-LIVE-'+name+'.png')))
   results['native']={'initialized':True,'info':s,'state':native.evaluate('()=>window.__nativeState')}
  except Exception as e:results['native']={'initialized':False,'reason':type(e).__name__,'networkFailures':network[:12]}
  b.close()
finally:
 server.terminate();server.wait(timeout=10);(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps({'checks':len(results['checks']),'passed':sum(c['passed'] for c in results['checks']),'nativeInitialized':results['native'].get('initialized')},ensure_ascii=False))
raise SystemExit(1 if any(not c['passed'] for c in results['checks']) else 0)
