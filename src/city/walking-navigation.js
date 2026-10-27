import {registerAction} from './actions.js';
import {inside} from './geometry.js';
import {buildWalkNavigation,createWalkNavigationState,updateWalkNavigation,projectWalkPosition} from '../../shared/walk-navigation-model.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const meters=value=>!Number.isFinite(value)?'확인 중':value>=1000?`${(value/1000).toFixed(1)}km`:`${Math.max(0,Math.round(value))}m`;
const safePoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
const fixOf=position=>({coordinate:[position.coords.longitude,position.coords.latitude],accuracy:position.coords.accuracy,timestamp:position.timestamp,heading:position.coords.heading,speed:position.coords.speed});
const permissionMessage=error=>error?.code===1?'위치 사용이 허용되지 않았어요. 브라우저와 기기의 위치 설정을 확인한 뒤 다시 시작하세요.':error?.code===3?'현재 위치를 찾는 시간이 길어졌어요. 하늘이 보이는 곳에서 다시 시작하세요.':'현재 위치를 읽지 못했어요. 기기의 위치 기능과 연결 상태를 확인하세요.';

/** Location and provider geometry are kept only in memory. No position history is saved. */
export function installWalkingNavigation({api,getRoute,getDestination,getStops=()=>[],requestReroute,onRerouted=()=>{},onUpdate=()=>{},geolocation=globalThis.navigator?.geolocation,speech=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance,now=Date.now}){
 let index=null,tracking=null,progress=null,status='idle',message='',watchId=null,sequence=0,voice=false,follow=true,autoReroute=true,preview=false,previewStep=0,previewTime=0,lastFix=null,lastFrame=0,lastSpoken='',lastSpeechAt=0,rerouteController=null,wakeLock=null,destroyed=false,requestingLocation=false,locationTimer=null,freshnessTimer=null,lastMode=false;
 const region=()=>api.state.district||api.state.scope;
 const validRegion=point=>safePoint(point)&&region()&&inside(point,region());
 function clearPosition(){api.send?.({type:'layer',id:'walk-position',features:[],visible:false});}
 function releaseWake(){wakeLock?.release?.().catch?.(()=>{});wakeLock=null;}
 function quiet(){speech?.cancel?.();lastSpoken='';}
 function endWatch(){clearInterval(freshnessTimer);freshnessTimer=null;if(watchId!==null)geolocation?.clearWatch?.(watchId);watchId=null;clearTimeout(locationTimer);locationTimer=null;requestingLocation=false;releaseWake();}
 function update(){if(destroyed)return;const mode=['requesting','active','off-route','rerouting','reroute-error','preview'].includes(status);if(mode!==lastMode){lastMode=mode;api.setWalkingMode?.(mode);}onUpdate();const host=document.getElementById('walk-navigation');if(host)host.innerHTML=htmlContent();}
 function stop(reason='',next='idle'){
  sequence++;endWatch();quiet();rerouteController?.abort();rerouteController=null;status=next;message=reason;preview=false;lastFix=null;progress=null;tracking=null;index=null;clearPosition();update();
 }
 function speak(text,key,force=false){
  if(!voice||preview||!speech||!Utterance||!text)return;
  const at=now();if(!force&&(key===lastSpoken||at-lastSpeechAt<8000))return;
  const utterance=new Utterance(text);utterance.lang='ko-KR';utterance.rate=1;const available=speech.getVoices?.().find(v=>/^ko(?:-|_)/i.test(v.lang));if(available)utterance.voice=available;
  quiet();lastSpoken=key;lastSpeechAt=at;speech.speak(utterance);
 }
 function drawPosition(fix){
  if(!safePoint(fix?.coordinate))return;
  const [lon,lat]=fix.coordinate,accuracy=Math.min(100,Math.max(3,fix.accuracy||8)),xScale=111320*Math.cos(lat*Math.PI/180),ring=Array.from({length:33},(_,i)=>{const angle=i*Math.PI/16;return [lon+Math.cos(angle)*accuracy/xScale,lat+Math.sin(angle)*accuracy/111320];});
  api.send?.({type:'layer',id:'walk-position',color:'#168bff',visible:true,features:[{type:'Feature',geometry:{type:'LineString',coordinates:ring},properties:{id:'walk-location-accuracy',name:'기기 위치의 정확도 범위',displayColor:'#168bff',sourceName:'기기 위치',ephemeral:true}},{type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{id:'walk-current-location',name:preview?'미리보기 위치':'현재 위치',displayColor:'#168bff',sourceName:preview?'경로 안내 미리보기':'기기 위치',ephemeral:true}}]});
 }
 function setIndex(route){
  const lastRerouteAt=tracking?.lastRerouteAt??null,next=buildWalkNavigation(route,{destination:getDestination()?.coordinate});
  if(!next?.segments?.length)throw Error('안내할 보행 경로가 없어요. 경로를 다시 찾아 주세요.');
  if(next.continuous===false)throw Error('제공받은 경로에 연결이 확인되지 않은 구간이 있어 실시간 안내를 시작하지 않았어요. 경로를 다시 찾아 주세요.');
  index=next;tracking=createWalkNavigationState(index,{lastRerouteAt});progress=null;
 }
 function remainingStops(){
  return getStops().filter(stop=>{if(!lastFix||!index||!progress)return true;try{const at=projectWalkPosition(index,stop.coordinate);return at?.ambiguous||!Number.isFinite(at?.progressMeters)||at.progressMeters>(progress.progressMeters||0)+20;}catch{return true;}}).map(stop=>stop.id);
 }
 async function reroute(manual=false){
  if(preview||!lastFix||!validRegion(lastFix.coordinate)||rerouteController||!['active','off-route','reroute-error'].includes(status))return;
  if(now()-lastFix.timestamp>15000||lastFix.timestamp>now()+5000||lastFix.accuracy>40){lastFix=null;clearPosition();message='정확한 최신 위치를 기다린 뒤 새 길을 찾아요.';update();return;}
  if(!manual&&!autoReroute)return;
  const token=sequence,fix=lastFix,controller=new AbortController();rerouteController=controller;status='rerouting';message='현재 위치에서 도보길을 다시 찾고 있어요.';update();speak(message,'rerouting',true);
  try{
   const route=await requestReroute(fix,{signal:controller.signal,viaIds:remainingStops()});
   if(token!==sequence||controller.signal.aborted||destroyed)return;
   const latest=lastFix;setIndex(route);status='active';message='현재 위치에서 새 길을 찾았어요.';onRerouted();if(latest&&now()-latest.timestamp<=15000)receive(latest,token);speak('현재 위치에서 새 길을 찾았어요.','rerouted',true);
  }catch(error){if(token!==sequence||controller.signal.aborted)return;status='reroute-error';message=error?.message||'새 경로를 받지 못했어요. 위치와 연결 상태를 확인하고 다시 찾으세요.';}
  finally{if(token===sequence){rerouteController=null;update();}}
 }
 function receive(fix,token=sequence){
  if(token!==sequence||destroyed||!index||!['active','off-route','rerouting','reroute-error','preview'].includes(status))return;
  if(!validRegion(fix.coordinate)){lastFix=null;progress=null;clearPosition();message='현재 위치가 선택 지역 밖에 있어 안내를 보류했어요.';status='off-route';update();return;}
  const reading=updateWalkNavigation(index,tracking,fix,{now:preview?previewTime:now(),maxMatchIntervalMs:preview?86400000:60000});
  tracking=reading.state||tracking;progress=reading;
  if(!reading.accepted){lastFix=null;clearPosition();message=reading.message||'위치 정확도가 낮아 안내를 기다리고 있어요.';update();return;}
  lastFix=fix;message=reading.message||'';if(!preview&&status!=='rerouting')status=reading.offRoute?'off-route':'active';drawPosition(fix);
  if(follow&&(preview||now()-lastFrame>1800)){lastFrame=now();api.followWalkPosition?.(fix.coordinate,reading.bearing);}
  if(reading.arrived&&!preview){sequence++;rerouteController?.abort();rerouteController=null;status='arrived';message='설정한 도착지 근처에 도착했어요. 실제 출입구를 확인하세요.';endWatch();speak(message,'arrived',true);}
  else if(reading.offRoute){message='안내 경로에서 벗어났어요. 위치를 확인하고 새 길을 찾아요.';if(!preview&&reading.shouldReroute&&autoReroute)void reroute();}
  else if(reading.wrongWay){speak(reading.message||'경로의 반대 방향으로 이동하고 있어요. 방향을 확인하세요.','wrong-way');}
  else if(Number.isFinite(reading.nextTurnDistanceMeters)&&reading.nextTurnDistanceMeters<60){const zone=reading.nextTurnDistanceMeters<20?'near':'ahead';speak(`${meters(reading.nextTurnDistanceMeters)} 앞, ${reading.nextInstruction||'경로를 따라 이동하세요.'}`,`${reading.nextStepIndex??reading.nextInstruction}:${zone}`);}
  update();
 }
 async function start(){
  stop();follow=true;const route=getRoute();if(!route){message='먼저 도보경로를 찾아 주세요.';update();return;}
  try{setIndex(route);}catch(error){status='error';message=error.message;update();return;}
  if(!geolocation?.watchPosition){status='error';message='이 브라우저에서는 현재 위치 안내를 사용할 수 없어요. 경로와 회전 안내 목록을 확인하세요.';update();return;}
  const token=++sequence;status='requesting';message='기기의 현재 위치를 기다리고 있어요.';requestingLocation=true;update();
  locationTimer=setTimeout(()=>{if(token===sequence&&requestingLocation){stop('위치를 확인하지 못해 안내를 멈췄어요. 기기 위치 설정을 확인하고 다시 시작하세요.','error');}},30000);
  try{
   const assigned=geolocation.watchPosition(position=>{if(token!==sequence)return;requestingLocation=false;clearTimeout(locationTimer);if(status==='requesting')status='active';receive(fixOf(position),token);},error=>{if(token!==sequence)return;stop(permissionMessage(error),'error');},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
   if(token===sequence){watchId=assigned;freshnessTimer=setInterval(()=>{if(token!==sequence||!lastFix||now()-lastFix.timestamp<=15000)return;lastFix=null;progress=progress?{...progress,accepted:false}:null;clearPosition();quiet();message='위치 갱신을 기다리고 있어요. 현재 위치가 확인될 때까지 이동 방향을 다시 확인하세요.';update();},2000);freshnessTimer?.unref?.();}else geolocation.clearWatch?.(assigned);
   globalThis.navigator?.wakeLock?.request?.('screen').then(lock=>{if(token!==sequence)lock.release?.();else wakeLock=lock;}).catch(()=>{});
  }catch{stop('위치 안내를 시작하지 못했어요. 위치 권한과 보안 연결을 확인하세요.','error');}
 }
 function startPreview(){
  stop();try{setIndex(getRoute());}catch(error){status='error';message=error.message;update();return;}
  preview=true;follow=true;status='preview';previewStep=0;previewTime=now();message='실제 위치를 사용하지 않는 경로 안내 미리보기예요.';
  receive({coordinate:[...index.start],accuracy:5,timestamp:previewTime});update();
 }
 function nextPreview(){
  if(!preview||!index)return;previewStep=Math.min(previewStep+1,index.steps.length-1);const step=index.steps[previewStep];if(!step)return;
  previewTime+=Math.max(15000,((step.progressMeters||0)-(progress?.progressMeters||0))/1.2*1000);
  receive({coordinate:step.coordinate||step.point||index.end,accuracy:5,timestamp:previewTime});message='미리보기 · 실제 보행이나 GPS 실측 결과가 아니에요.';update();
 }
 function htmlContent(){
  const active=['requesting','active','off-route','rerouting','reroute-error','preview'].includes(status),route=getRoute();
  if(!route)return '';
  const reading=progress,steps=index?.steps||[],turn={11:'↑',12:'↰',13:'↱',14:'↶',16:'↙',17:'↖',18:'↗',19:'↘'}[reading?.nextStep?.turnType]||'•',remainingTime=Number.isFinite(reading?.remainingSeconds)?reading.remainingSeconds<60?'1분 미만':`약 ${Math.ceil(reading.remainingSeconds/60)}분`:'미산정';
  return `<div class="walking-navigation${preview?' is-preview':''}" aria-label="도보 길안내">${globalThis.navigator?.onLine===false?'<p class="walking-nav-status">연결이 끊겼어요. 받은 경로의 위치 안내는 이어질 수 있지만 재탐색은 연결 후 가능해요.</p>':''}<div class="walking-nav-heading"><strong>${preview?'안내 미리보기':status==='arrived'?'도착지 근처':'도보 길안내'}</strong><span>${status==='requesting'?'위치 확인 중':active?preview?'위치 사용 안 함':'현재 위치 사용 중':'위치 사용 전'}</span></div>${message?`<p class="walking-nav-status" role="status">${escape(message)}</p>`:''}${reading?.accepted?`<div class="walking-next"><span>다음 안내 · ${meters(reading.nextTurnDistanceMeters)}</span><strong><b class="walking-turn" aria-hidden="true">${turn}</b>${escape(reading.nextInstruction||'경로를 따라 이동하세요.')}</strong></div><div class="walking-progress"><span>남은 거리 <b>${meters(reading.remainingMeters)}</b></span><span>남은 예상시간 <b>${remainingTime}</b></span><span>위치 오차 <b>약 ${meters(lastFix?.accuracy)}</b></span></div>`:'<p>현재 위치를 따라 다음 회전과 남은 거리를 안내해요.</p>'}<div class="walking-nav-actions">${active?`<button data-action="walk-nav-stop">안내 종료</button>${preview?'<button data-action="walk-nav-next">다음 안내 미리보기</button>':`<button data-action="walk-nav-follow" aria-pressed="${follow}">${follow?'현재 위치 따라가는 중':'현재 위치로 보기'}</button><button data-action="walk-nav-reroute"${status==='rerouting'||!lastFix?' disabled':''}>여기서 다시 찾기</button>`}`:'<button class="walking-start" data-action="walk-nav-start">현재 위치로 길안내 시작</button><button data-action="walk-nav-preview">안내 미리보기</button>'}</div><div class="walking-nav-options"><button data-action="walk-nav-voice" aria-pressed="${voice}">음성 안내 ${voice?'켜짐':'꺼짐'}</button><button data-action="walk-nav-auto" aria-pressed="${autoReroute}">이탈 시 자동 재탐색 ${autoReroute?'켜짐':'꺼짐'}</button></div><p class="walking-nav-privacy">시작할 때 위치 사용을 허용해 주세요. 앱에는 위치이력을 저장하지 않으며, 재탐색할 때 현재 좌표를 TMAP에 전송해요. 앱을 열어두어야 안내가 이어져요.</p>${steps.length?`<details class="walking-steps"><summary>전체 회전 안내 · ${steps.length}개</summary><ol>${steps.map(step=>`<li><span>${meters(step.progressMeters)}</span> ${escape(step.instruction||step.description||'경로를 따라 이동하세요.')}</li>`).join('')}</ol></details>`:''}</div>`;
 }
 const offs=[registerAction('walk-nav-start',start),registerAction('walk-nav-stop',()=>stop('길안내를 종료했어요.')),registerAction('walk-nav-preview',startPreview),registerAction('walk-nav-next',nextPreview),registerAction('walk-nav-reroute',()=>reroute(true)),registerAction('walk-nav-follow',()=>{follow=!follow;if(follow&&lastFix)api.followWalkPosition?.(lastFix.coordinate,progress?.bearing);update();}),registerAction('walk-nav-voice',()=>{voice=!voice;if(!voice)quiet();else if(progress?.nextInstruction)speak(progress.nextInstruction,'voice-on',true);update();}),registerAction('walk-nav-auto',()=>{autoReroute=!autoReroute;update();})];
 const hidden=()=>{if(document.hidden&&['requesting','active','off-route','rerouting','reroute-error','preview'].includes(status))stop('화면이 닫혀 위치 안내를 멈췄어요. 앱을 다시 열고 시작하세요.','paused');};
 document.addEventListener?.('visibilitychange',hidden);
 return {html:()=>`<section id="walk-navigation">${htmlContent()}</section>`,prepare(){try{setIndex(getRoute());message=index.warnings?.join(' ')||'';status='idle';}catch(error){status='error';message=error.message;}},stop,onEvent(event){if(event.type==='interaction'&&follow){follow=false;update();}if(event.type==='ready'&&lastFix)drawPosition(lastFix);},getState:()=>({status,preview,watching:watchId!==null,progress}),destroy(){stop();destroyed=true;offs.forEach(off=>off());document.removeEventListener?.('visibilitychange',hidden);}};
}
