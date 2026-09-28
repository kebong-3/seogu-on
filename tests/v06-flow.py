"""Isolated five-minute playback/controller and local key-helper tests.
Explicit mocked renderer acknowledgements, dummy key strings. NOT WebGL/authentication.
"""
from pathlib import Path
import json,shutil
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];OUT=R/'docs/v06';OUT.mkdir(exist_ok=True)
sources={'/'+p.relative_to(R).as_posix():p.read_text() for p in (R/'src').rglob('*.js')}
results=[]
def ck(name,value):
 results.append({'name':name,'passed':bool(value)});print(name,bool(value),flush=True)
 if not value:raise AssertionError(name)
loader=r'''async sources=>{
 const urls={};function build(path){if(urls[path])return urls[path];let code=sources[path];if(code===undefined)throw Error('Missing test module');code=code.replace(/(\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?)(['"])(\.[^'"]+)\2/g,(m,p,q,s)=>p+q+build(new URL(s,'https://fixture.invalid'+path).pathname)+q);return urls[path]=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));}
 const {createResilienceTools}=await import(build('/src/city/resilience-tools.js'));
 window.sent=[];window.ack=true;window.fetchCalls=0;window.fetch=()=>{window.fetchCalls++;throw Error('Unexpected external request');};
 const state={view:'',engine:'clean',ready:true,dong:'all',entries:new Map(),enabled:new Set(),rasterStates:new Map()};window.fakeState=state;
 const api={state,show(title,html,view){state.view=view;document.body.innerHTML='<h1>'+title+'</h1>'+html;},send(m){window.sent.push(m);if(window.ack&&m.type==='sun')setTimeout(()=>window.tools.onEvent({type:'sun-state',phase:m.shadows?'rendered':'off',requestId:m.requestId,time:m.time,appliedTime:m.time,enabled:m.shadows}),15);},label:()=> 'TEST FIXTURE',scoped:()=>[],drawData(){},toast(){}};
 window.tools=createResilienceTools(api);
 document.body.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b){tools.beforeAction(b);tools.action(b);}});
 document.body.addEventListener('input',e=>tools.input(e));document.body.addEventListener('change',e=>tools.change(e));
 await tools.action({dataset:{action:'native-sun'}});
}'''
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);p=browser.new_page();p.set_default_timeout(4000)
 try:
  p.set_content('<html><body></body></html>');p.evaluate(loader,sources)
  p.locator('#native-sun-date').fill('2026-12-22');p.locator('#native-sun-date').dispatch_event('change')
  p.locator('#native-sun-time').fill('09:00');p.locator('#native-sun-time').dispatch_event('change')
  p.locator('#native-play-speed').select_option('800');p.locator('[data-action=native-play]').click()
  p.wait_for_function('window.sent.length>=3');p.locator('[data-action=native-play]').click()
  times=p.evaluate('window.sent.filter(m=>m.type==="sun"&&m.shadows).map(m=>m.time)')
  ck('actual playback controller sends09:0009:0509:10',times[:3]==['2026-12-22T09:00','2026-12-22T09:05','2026-12-22T09:10'])
  count=p.evaluate('window.sent.length');p.wait_for_timeout(1000);ck('pause stops interval messages',p.evaluate('window.sent.length')==count)
  ck('simulation playback makes zero external API requests',p.evaluate('window.fetchCalls')==0)
  p.evaluate('window.ack=false');p.locator('[data-action=native-play]').click();count=p.evaluate('window.sent.length');p.wait_for_timeout(1000)
  ck('waits for renderer acknowledgement before advancing',p.evaluate('window.sent.length')==count)
  p.evaluate("tools.onEvent({type:'sun-state',phase:'rendered',requestId:0,time:'WRONG'});")
  p.wait_for_timeout(850);ck('stale renderer acknowledgement is ignored',p.evaluate('window.sent.length')==count)
  p.evaluate("const m=sent[sent.length-1];tools.onEvent({type:'sun-state',phase:'rendered',requestId:m.requestId,time:m.time});")
  p.wait_for_function('window.sent.length>'+str(count));ck('valid acknowledgement permits next5minute step',True)
  p.evaluate("fakeState.view='other'");count=p.evaluate('window.sent.length');p.wait_for_timeout(1000);ck('leaving simulation panel stops playback',p.evaluate('window.sent.length')==count)
  p.evaluate("tools.action({dataset:{action:'native-sun'}});window.ack=true")
  p.locator('#native-sun-time').fill('23:55');p.locator('#native-sun-time').dispatch_event('change');p.wait_for_timeout(200)
  p.locator('[data-action=native-play]').click();count=p.evaluate('window.sent.length');p.wait_for_timeout(1000);ck('playback stops at day boundary rather than looping',p.evaluate('window.sent.length')==count)
  p.locator('[data-action=native-off]').click();ck('off requests original lighting restoration',p.evaluate('sent[sent.length-1].shadows')==False)
  p.evaluate('tools.destroy()')
  # No issued secret values are read by this test; dummy tokens only.
  q=browser.new_page();network=[];q.on('request',lambda req:network.append(req.url));q.set_content((R/'tools/safety-key-import.html').read_text())
  codes=['10804','10942','00117','00058','00026','00242','10926','00195','10005']
  fixture='\n'.join('/V2/api/DSSP-IF-'+c+'?serviceKey=xxxx\n서비스키 값\nTESTKEY'+str(i).zfill(9) for i,c in enumerate(codes))
  q.locator('#source').fill(fixture);q.locator('#parse').click()
  ck('helper recognizes9dummy issuance records','9개' in q.locator('#status').inner_text())
  ck('helper erases pasted issuance text',q.locator('#source').input_value()=='')
  ck('all9key inputs usepassword masking',q.locator('input[type=password]').count()==9)
  q.locator('#reveal').click();result=json.loads(q.locator('#json').input_value());ck('oneJSON preserves9provider identifiers',set(result)=={'DSSP-IF-'+c for c in codes})
  ck('local helper makes zero network requests',network==[])
  ck('CSP forbids transmitting toexternal endpoints',"connect-src 'none'" in q.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute('content'))
  q.locator('#clear').click();ck('clear removes9keyvalues andresult',q.locator('input').evaluate_all('(es)=>es.every(e=>e.value==="")') and q.locator('#json').input_value()=='')
 finally:
  (OUT/'FLOW_TEST_RESULTS.json').write_text(json.dumps({'scope':'Actual isolated UI controllers, dummy keys and explicit renderer acknowledgements; NOT native rendering or live authentication','checks':len(results),'passed':sum(x['passed'] for x in results),'results':results},ensure_ascii=False,indent=2))
  browser.close()
