import {OP_LAYERS,importOperational,OP_STATES,timestamp} from './operations.js';
import {RECORDS_KEY,encodeRecords,decodeRecords} from './local-records.js';
import {INFRA_CATEGORIES,infrastructureCounts} from './infrastructure.js';
import {LAYER_BY_ID,esc} from './catalog.js';
import {inside,distance} from './geometry.js';

const $=id=>document.getElementById(id);
const titles={'infra-snow-routes':'제설 작업구간','infra-snow-priority':'제설 검토구간','infra-grit':'적사함·제설함','infra-cold':'한파쉼터','infra-shade-structures':'그늘막·그늘쉼터'};
const save=(name,body)=>{const url=URL.createObjectURL(new Blob([typeof body==='string'?body:JSON.stringify(body,null,2)],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

export function createFinishTools(api) {
 const s=api.state;
 const restoreBox=document.createElement('div');restoreBox.hidden=true;const restoreInput=document.createElement('input');restoreInput.type='file';restoreInput.accept='.json';restoreInput.id='records-file';restoreBox.append(restoreInput);document.body.append(restoreBox);
 restoreInput.addEventListener('change',async()=>{try{const f=restoreInput.files[0];if(!f)return;if(f.size>3*1024*1024)throw Error('백업파일은 3MB 이하로 준비하세요.');const loaded=decodeRecords(await f.text(),s.district);for(const[id,e]of loaded){s.entries.set(id,{...e,title:titles[id]});s.enabled.add(id);}api.drawData();records();api.toast('백업 파일을 현재 화면에 불러왔습니다. PC에 저장하려면 별도 저장 버튼을 누르세요.');}catch(e){api.toast(e.message);}finally{restoreInput.value='';}});
 let draft=null,capturing=false,renderer=null,buildingStyle=null,styleMode='detailed',checkTimer=null,addressRows=[],candidate=null;
 const recordLayers=()=>OP_LAYERS.filter(id=>s.entries.get(id)?.metadata?.userRegistered&&s.entries.get(id)?.features?.length);
 function diagnostic() {
  return {version:'0.4.1',checkedAt:new Date().toISOString(),scope:api.label(),dongCount:s.dongs.length,engine:s.engine,
   sdkReady:!!s.ready,renderer,buildingStyle,configured:s.config?.configured||{},
   softwareOnlyChecks:['UI·입력자료·출처·원본상태 보존'],
   remainingChecks:['원본 건물 품질과 제공범위','신규 서비스별 인증·실수신','시설의 현재 위치·운영 상태','실측 기반 그늘 검증'],
   datasets:INFRA_CATEGORIES.map(c=>{const n=infrastructureCounts(c,new Map(c.layers.map(id=>[id,{features:api.scoped(id)}])));return {category:c.title,...n,ids:c.layers,completeCensus:false,sources:c.layers.map(id=>({id,state:s.entries.get(id)?.state||'not-connected',error:s.entries.get(id)?.error||null,loadedAt:s.entries.get(id)?.loadedAt||null}))};})};
 }
 function renderDiagnostics() {
  const target=$('live-diagnostic');if(!target)return;
  target.innerHTML=renderer?`<b>${esc(renderer.engine||s.engine)}</b> · ${renderer.rendered===true?'실제 렌더 프레임 확인':renderer.webgl===false?'WebGL 미사용':'실제 렌더 프레임 미확인'}<br>캔버스 ${esc(renderer.buffer?.join(' × ')||'해당 없음')} · 렌더 프레임 ${esc(renderer.renderFrames??'해당 없음')}<br>${esc(renderer.note||'')}`:'현재 렌더러의 응답을 확인하는 중입니다. 설정됨은 인증·화질 검증 완료와 다릅니다.';
 }
 function readiness() {
  const d=diagnostic();api.show('적용·자료 연결 점검',`<p><b>서구온 0.4.1</b> · ${esc(api.label())} · ${s.dongs.length}개 행정동</p><div id="live-diagnostic" class="note"></div><div class="detail-actions"><button class="primary" data-action="finish-check">화면 다시 점검</button><button class="secondary" data-action="finish-export">점검 결과 저장</button></div><p class="note warning">렌더 프레임 확인은 화면이 실제로 그려졌다는 뜻입니다. 건물 정확성·화질 만족도·시설 전수 확보·서비스 인증은 각각 따로 확인해야 합니다.</p><h3>API 환경변수 인식</h3><div class="coverage-table">${Object.entries(d.configured).map(([id,on])=>`<div><strong>${esc(id)}</strong><span>${on?'설정값 인식 · 인증 미확정':'미설정'}</span></div>`).join('')}</div><h3>자료 범위</h3><div class="coverage-table">${d.datasets.map(c=>`<div><strong>${esc(c.category)}</strong><span>${c.points||c.areas||c.lines?`${c.points}위치 · ${c.areas}면 · ${c.lines}선`:'미확보·연결 필요'}</span></div>`).join('')}</div><p class="small">위치·면을 합산한 시설 수가 아닙니다. API 미연결 항목은 빈 도형이나 가짜 숫자로 채우지 않습니다. 공개 관리기록은 ‘기록 보관함’에서 별도로 저장하세요.</p><button class="secondary full" data-action="records">기록 보관함</button>`,'readiness');
  renderer=null;renderDiagnostics();api.send({type:'diagnostics'});clearTimeout(checkTimer);checkTimer=setTimeout(()=>{if(s.view==='readiness'&&!renderer){renderer={engine:s.engine,note:'렌더러 응답을 확인하지 못했습니다. 지도가 준비되었는지 확인하세요.'};renderDiagnostics();}},5000);
 }
 function styleControls(){return `<h3>브이월드 건물 원본</h3><div class="detail-actions"><button class="${styleMode==='detailed'?'primary':'secondary'}" data-action="build-style" data-id="detailed">상세 모델 요청</button><button class="${styleMode==='standard'?'primary':'secondary'}" data-action="build-style" data-id="standard">기본 모델 요청</button></div><p id="building-style-info" class="note">${esc(buildingStyle?.note||'공식 활용예제의 공개 건물 레이어를 사용합니다. SDK가 지원하지 않으면 원래 표시를 유지합니다.')}</p><button class="secondary full" data-action="finish-check">실제 렌더·자료 연결 점검</button>`;}
 async function civicIndex(){const b=await api.fetchJSON('/data/city/civic-index.json');api.show('18개 동 행정복지센터 대조',`<p><b>${b.matchedDongCount}개 동 명칭에 대응하는 자료</b>가 포함되어 있습니다. 점 11개와 면 7개를 대조한 결과이며, 새로운 좌표를 만들어 추가한 것이 아닙니다.</p><p class="note warning">명칭 대응은 현장 위치·이전·업무시간 검수가 아닙니다. 점과 면은 서로 다른 표현입니다.</p><div class="record-list">${b.rows.map(r=>`<button class="record" data-action="civic-open" data-id="${esc(r.matches[0]?.id||'')}"><strong>${esc(r.dongName)} 행정복지센터</strong><small>${esc(r.matches[0]?.geometryType||'미확인')} · ${esc(r.matches[0]?.address||'주소 미수록')}</small></button>`).join('')}</div>`,'civic-index');}
 async function addressReview(){const b=await api.fetchJSON('/data/address-records.json');addressRows=b.records||[];api.show('공개시설 주소 검수 대기',`<p>출처가 있는 공개시설 ${addressRows.length}항목입니다. 아직 좌표 검수가 끝나지 않아 지도에 자동으로 넣지 않았습니다.</p><p class="note">특히 임시이전한 복지기관은 과거 주소를 그대로 사용하지 않습니다. 원자료 확인 → 좌표 후보 조회 → 화면 위치 확인 → 반영 순서로 처리하세요. 브이월드 REST 키가 필요합니다.</p><div class="record-list">${addressRows.map(r=>`<button class="record" data-action="address-candidate" data-id="${esc(r.id)}"><strong>${esc(r.name)}</strong><small>${esc(r.address)} · ${esc(r.sourceDate||'기준일 미확인')}</small></button>`).join('')}</div>`,'address-review');}
 async function addressCandidate(id){const row=addressRows.find(r=>r.id===id);if(!row)throw Error('공개시설 목록에서 선택하세요.');const b=await api.fetchJSON('/api/geocode?id='+encodeURIComponent(id));if(!Array.isArray(b.coordinates)||!inside(b.coordinates,s.district))throw Error('서구 경계 안의 좌표 후보를 확인하지 못했습니다.');candidate={row,point:b.coordinates};s.entries.set('address-candidate',{features:[{type:'Feature',geometry:{type:'Point',coordinates:b.coordinates},properties:{id:'candidate',name:'위치 검수 대기 · '+row.name,sourceName:row.sourceName,mapLabel:'좌표 후보 · 미등록',displayColor:'#e2b875'}}],state:'candidate',title:'주소 좌표 후보 · 미등록'});s.enabled.add('address-candidate');s.isolate=false;api.drawData();api.selectFeature?.('address-candidate','candidate',true);api.show('이 위치가 맞는지 확인하세요',`<h3>${esc(row.name)}</h3><p>${esc(row.address)}</p><p class="note">${esc(row.note||'주소에 대응한 좌표 후보입니다. 실제 시설 위치·출입구를 확인하세요.')}</p><p class="small">${esc(row.sourceName)} · ${esc(row.sourceDate||'기준일 미확인')}</p><label class="field-label"><input type="checkbox" id="address-confirmed"> 원자료와 지도 위치를 대조했습니다.</label><button class="primary full" data-action="address-accept">확인한 위치 반영</button><button class="secondary full" data-action="address-review">반영하지 않고 돌아가기</button><p class="small">위치 확인은 현재 브라우저에만 반영됩니다. 기록의 현장 검수 완료나 운영 중임을 보증하지 않습니다.</p>`,'address-candidate');}
 function addressAccept(){if(!candidate||!$('address-confirmed')?.checked)throw Error('원자료와 지도 위치 대조 확인란을 체크하세요.');const {row,point}=candidate,id=row.layerId||(row.category==='care'?'infra-welfare':'reviewed-evacuation'),f={type:'Feature',geometry:{type:'Point',coordinates:point},properties:{id:'reviewed-'+row.id,name:row.name,address:row.address,sourceName:row.sourceName,sourceUrl:row.sourceUrl,sourceDate:row.sourceDate,phone:row.phone,note:'사용자 화면 위치 확인 · 지오코딩 후보를 반영한 자료입니다. 현장·출입구·현재 운영 여부는 별도 확인해야 합니다.',reviewedAt:new Date().toISOString()}};const old=s.entries.get(id)||{features:[],title:id==='infra-welfare'?'복지기관':'좌표 확인한 대피시설'};s.entries.set(id,{...old,features:[...old.features.filter(x=>x.properties.id!==f.properties.id),f],state:'loaded'});s.enabled.add(id);s.enabled.delete('address-candidate');s.entries.delete('address-candidate');candidate=null;api.drawData();api.toast('확인한 좌표를 현재 브라우저에 반영했습니다. 공유하려면 반영자료 파일을 내보내세요.');save(row.id+'-reviewed.geojson',{type:'FeatureCollection',features:[f]});}
 function editor(start=false) {
  if(start||!draft)draft={layer:'infra-snow-routes',name:'',sourceName:'',status:'planned',observedAt:'',expiresAt:'',points:[]};
  const isLine=['infra-snow-routes','infra-snow-priority'].includes(draft.layer);
  api.show('공개 관리기록 직접 작성',`<p class="note warning">기관 공인 현황으로 자동 게시되지 않습니다. 실제 확인한 공개 시설·작업기록만 등록하세요. 민감한 위치·개인정보는 입력하지 마세요.</p><label class="field-label">자료 종류<select id="editor-kind">${OP_LAYERS.map(id=>`<option value="${id}" ${id===draft.layer?'selected':''}>${titles[id]}</option>`).join('')}</select></label><label class="field-label">기록명<input id="editor-name" maxlength="160" value="${esc(draft.name)}" placeholder="예: 현장 확인한 제설 작업구간명"></label><label class="field-label">자료 출처<input id="editor-source" maxlength="250" value="${esc(draft.sourceName)}" placeholder="공개자료명 또는 확인 부서·대장"></label><label class="field-label">등록할 상태<select id="editor-status">${['planned','working','completed','unknown'].map(id=>`<option value="${id}" ${id===draft.status?'selected':''}>${OP_STATES[id].label}</option>`).join('')}</select></label><label class="field-label">확인한 시각 · 한국시간<input id="editor-observed" type="datetime-local" value="${esc(draft.observedAt)}"></label><label class="field-label">상태 유효기한 · 한국시간<input id="editor-expires" type="datetime-local" value="${esc(draft.expiresAt)}"></label><p class="small">시각을 비워 두면 상태 미확인으로 기록합니다. 오래된 완료 상태는 현재 완료로 표시하지 않습니다.</p><div class="detail-actions"><button class="primary" data-action="editor-capture">${isLine?'지도에서 구간 그리기':'지도에서 위치 지정'}</button><button class="secondary" data-action="editor-undo">마지막 점 취소</button><button class="secondary" data-action="editor-cancel">그리기 중지</button></div><p id="editor-count" class="note"></p><div class="detail-actions"><button class="primary" data-action="editor-save">검수 후 기록 반영</button><button class="secondary" data-action="records">기록 보관함</button></div><p class="small">구간은 지도를 순서대로 눌러 선을 만듭니다. 빈 지도의 아무 곳에나 자동 제설 노선을 생성하지 않습니다. 저장 전에는 임시 도형입니다.</p>`,'operation-editor');preview();
 }
 function readDraft(){if(!draft||!$('editor-name'))return;draft.name=$('editor-name').value.trim();draft.sourceName=$('editor-source').value.trim();draft.status=$('editor-status').value;draft.observedAt=$('editor-observed').value;draft.expiresAt=$('editor-expires').value;}
 function preview() {
  if(!draft)return;
  const line=['infra-snow-routes','infra-snow-priority'].includes(draft.layer),n=draft.points.length;
  const geometry=n?(line&&n>1?{type:'LineString',coordinates:draft.points}:{type:'Point',coordinates:draft.points[0]}):null;
  s.entries.set('operation-draft',{features:geometry?[{type:'Feature',geometry,properties:{id:'draft',name:'작성 중 · 실제 운영자료 아님',sourceName:'사용자 작성 중',mapLabel:'작성 중',displayColor:'#e2b875'}}]:[],state:'draft',title:'작성 중 도형 · 미등록'});
  s.enabled.add('operation-draft');s.isolate=false;api.drawData();
  if($('editor-count'))$('editor-count').textContent=`${n}개 지점${line&&n>1?' · 약 '+Math.round(draft.points.slice(1).reduce((sum,p,i)=>sum+distance(draft.points[i],p),0))+'m 선':''} · ${capturing?'지도에서 선택 중':'그리기 중지'} · 아직 저장되지 않았습니다.`;
 }
 function stop(){capturing=false;api.send({type:'stop'});}
 function reflect(){readDraft();if(!draft?.name||!draft.sourceName)throw Error('기록명과 실제 출처를 입력하세요.');const line=['infra-snow-routes','infra-snow-priority'].includes(draft.layer);if(draft.points.length<(line?2:1))throw Error(line?'구간은 지도에서 두 지점 이상 선택하세요.':'지도에서 실제 위치를 선택하세요.');
  const id='user-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const kst=v=>v?(v.length===16?v+':00':v)+'+09:00':null;
  const p={id,name:draft.name,sourceName:draft.sourceName,sourceDate:draft.observedAt?.slice(0,10)||null,status:draft.status,observedAt:kst(draft.observedAt),expiresAt:kst(draft.expiresAt)};
  if((draft.observedAt&&!draft.expiresAt)||(!draft.observedAt&&draft.expiresAt))throw Error('확인시각과 유효기한을 둘 다 입력하거나 둘 다 비워 두세요.');
  if(p.observedAt&&(timestamp(p.observedAt)===null||timestamp(p.expiresAt)===null))throw Error('확인시각과 유효기한을 올바른 날짜로 입력하세요.');
  if(p.observedAt&&Date.parse(p.observedAt)>Date.now()+300000)throw Error('현장 확인시각을 미래로 입력할 수 없습니다. 미래 작업 계획은 확인시각을 비워두세요.');
  if(p.observedAt&&Date.parse(p.expiresAt)<=Date.parse(p.observedAt))throw Error('유효기한은 확인시각보다 뒤여야 합니다.');
  const f={type:'Feature',geometry:line?{type:'LineString',coordinates:draft.points}:{type:'Point',coordinates:draft.points[0]},properties:p};
  const old=s.entries.get(draft.layer)?.features||[],result=importOperational({type:'FeatureCollection',features:[...old,f]},draft.layer,s.district);
  if(result.rejected.length)throw Error('기존자료와의 병합에 오류가 있어 저장하지 않았습니다. 자료를 내보내어 확인하세요.');
  result.metadata={...result.metadata,userRegistered:true};s.entries.set(draft.layer,{...result,title:titles[draft.layer]});s.enabled.add(draft.layer);s.enabled.delete('operation-draft');s.entries.delete('operation-draft');stop();draft=null;api.drawData();records();api.toast('현재 화면에 기록을 반영했습니다. 새로고침 전 이 브라우저에 저장하거나 파일로 내보내세요.');
 }
 function records() {
  stop();let saved=false;try{saved=!!localStorage.getItem(RECORDS_KEY);}catch{}
  api.show('공개 관리기록 보관함',`<p>현재 화면의 작성·가져오기 기록을 내보내거나 <b>이 브라우저에만</b> 저장합니다. 직원 간 공유·서버 저장이 아닙니다.</p><p class="note">이 PC에 저장하면 같은 브라우저 사용자도 볼 수 있습니다. 공개 가능한 자료만 저장하세요. 저장은 아래 버튼을 눌렀을 때만 수행합니다.</p><div class="detail-actions"><button class="primary" data-action="records-save">이 브라우저에 저장</button><button class="secondary" data-action="records-load">저장본 불러오기</button><button class="secondary" data-action="records-export">전체 백업 파일</button><button class="secondary" data-action="records-import">백업 파일 가져오기</button></div><p>${saved?'이 브라우저에 저장본 있음':'브라우저 저장본 미확인 또는 없음'}</p><div class="coverage-table">${recordLayers().map(id=>`<div><strong>${titles[id]} · ${s.entries.get(id).features.length}항목</strong><button class="secondary" data-action="records-layer" data-id="${id}">GeoJSON</button></div>`).join('')||'<p>아직 사용자 관리기록이 없습니다.</p>'}</div><button class="secondary full" data-action="editor-new">지도에서 새 기록 작성</button><label class="field-label"><input id="records-delete-confirm" type="checkbox"> 이 PC의 저장본을 지우는 데 동의합니다.</label><button class="secondary full" data-action="records-delete">브라우저 저장본 삭제</button><p class="small">불러오기는 저장된 종류만 바꾸며 다른 종류의 자료는 유지합니다. 유효기한은 불러올 때 다시 검사합니다. 파일 내보내기는 실제 서버 게시가 아닙니다.</p>`,'records');
 }
 return {
  styleControls,
  onEvent(m){if(m.type==='diagnostics'){renderer=m;clearTimeout(checkTimer);renderDiagnostics();}if(m.type==='building-style-result'){buildingStyle=m;if($('building-style-info'))$('building-style-info').textContent=m.note;}if(m.type==='ready')api.send({type:'building-style',mode:styleMode});
   if(m.type==='point'&&capturing&&draft&&['operation-route','operation-point'].includes(m.tool)){if(!Array.isArray(m.point)||!inside(m.point,s.scope))return;
    const isLine=draft.layer.includes('snow-');if(draft.points.length>=500){api.toast('한 구간은 최대 500개 지점입니다.');return;}
    if(draft.points.length&&distance(draft.points.at(-1),m.point)<1){api.toast('앞 지점과 너무 가깝습니다.');return;}
    if(isLine)draft.points.push(m.point.slice(0,2));else{draft.points=[m.point.slice(0,2)];capturing=false;}preview();
   }
  },
  scopeChanged(){if(capturing)stop();draft=null;s.enabled.delete('operation-draft');s.entries.delete('operation-draft');renderer=null;buildingStyle=null;},
  change(e){if(e.target.id==='editor-kind'){readDraft();stop();draft.layer=e.target.value;draft.points=[];editor();}},
  async action(button){const a=button.dataset.action,id=button.dataset.id;
   switch(a){case'civic-index':await civicIndex();break;case'civic-open':s.enabled.clear();s.enabled.add('infra-civic');api.chooseDong?.('all',false);api.selectFeature?.('infra-civic',id,true);break;case'address-review':s.enabled.delete('address-candidate');s.entries.delete('address-candidate');candidate=null;api.drawData();await addressReview();break;case'address-candidate':await addressCandidate(id);break;case'address-accept':addressAccept();break;case'finish-check':readiness();break;case'finish-export':save('서구온_연결점검.json',diagnostic());break;
   case'build-style':styleMode=id;for(const b of document.querySelectorAll('[data-action=build-style]')){b.className=b.dataset.id===id?'primary':'secondary';b.setAttribute('aria-pressed',String(b.dataset.id===id));}api.send({type:'building-style',mode:id});break;
   case'editor-new':stop();s.enabled.delete('operation-draft');editor(true);break;
   case'editor-capture':readDraft();capturing=true;api.send({type:'tool',tool:draft.layer.includes('snow-')?'operation-route':'operation-point'});preview();api.toast('선택한 구역 안에서 지도를 눌러 위치를 지정하세요.');break;
   case'editor-undo':readDraft();draft?.points.pop();preview();break;
   case'editor-cancel':stop();preview();break;
   case'editor-save':reflect();break;
   case'records':readDraft();records();break;
   case'records-save':localStorage.setItem(RECORDS_KEY,encodeRecords(s.entries,s.district));records();api.toast('공개 관리기록을 이 브라우저에 저장했습니다.');break;
   case'records-load':{const loaded=decodeRecords(localStorage.getItem(RECORDS_KEY),s.district);for(const[id,result]of loaded){s.entries.set(id,{...result,title:titles[id]});s.enabled.add(id);}api.drawData();records();api.toast('저장본을 불러오고 상태 유효시각을 다시 검사했습니다.');break;}
   case'records-import':restoreInput.click();break;
   case'records-export':save('서구온_공개관리기록_백업.json',encodeRecords(s.entries,s.district));break;
   case'records-layer':if(!OP_LAYERS.includes(id))throw Error('관리자료 종류 오류');save(id.replace('infra-','')+'.geojson',{type:'FeatureCollection',features:s.entries.get(id)?.features||[],metadata:{userRegistered:true,exportedAt:new Date().toISOString(),coverage:'사용자가 등록한 공개 관리기록, 전수 아님'}});break;
   case'records-delete':if(!$('records-delete-confirm')?.checked)throw Error('삭제 동의 체크박스를 확인하세요.');localStorage.removeItem(RECORDS_KEY);records();api.toast('이 브라우저 저장본을 삭제했습니다. 현재 지도와 서버자료는 변경하지 않았습니다.');break;
   default:if(['close-detail','engine','overview','dong','infra','climate','preset'].includes(a)&&capturing)stop();return false;
   }return true;
  },destroy(){clearTimeout(checkTimer);restoreBox.remove();}
 };
}
