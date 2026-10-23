import {registerAction} from './actions.js';
import {decisionPurposeHtml} from './decision-purpose.js';
import {frameFor} from './camera.js';
import {inside} from './geometry.js';
import {escapeDecisionHtml as e, decisionWorkflowTitle, decisionSources, decisionAiText, decisionCsv, decisionReportHtml} from './decision-report.js';

const VIEW='decision-twin',LAYER='decision-twin-results';
const LIVING_TOPICS={care:{title:'돌봄·육아 생활지도',label:'돌봄·육아',preset:'childcare',intro:'어린이집의 공개 위치를 확인하고, 프로그램에 활용할 주변 활동공간 연계를 검토하세요.',fallback:['childcare','kindergarten','kindergartens','childcare-centres','care-centres','childcare-official']},safety:{title:'여성안심 생활지도',label:'여성안심',preset:'women-safety',intro:'공개된 비상벨·보안등·경찰관서 등의 위치와 자료 기준일을 함께 보고 현장 점검을 준비하세요.',fallback:['emergency-bells','emergency-bell','police','police-official','security-lights','security-light','toilets','toilet','cctv']}};
const LIVING_COLORS=['#be5382','#1d7f78','#6f5ab4','#b17813','#2f69ac','#963d54'];
const COLORS={covered:'#687f96',uncovered:'#a74862',new:'#008575',lost:'#bd344b',service:'#bd7a17',proposed:'#205bd4'};
const workflows=[['coverage','시설 추가','어디에 추가하면 공백이 줄어들까요?'],['inspection','점검 목록','어느 위치부터 살펴보면 좋을까요?'],['site','후보지 비교','같은 조건으로 주변 여건을 비교하세요.']];
const list=value=>Array.isArray(value)?value:[];
const num=value=>Number.isFinite(value)?value.toLocaleString('ko-KR'):'—';
const label=value=>typeof value==='string'?value:value?.name||value?.title||value?.label||value?.id||'';
const coord=value=>Array.isArray(value?.coordinates)&&value.coordinates.length>=2&&value.coordinates.slice(0,2).every(Number.isFinite)?value.coordinates.slice(0,2):null;
const siteInput=value=>({id:String(value.id),name:String(value.name||'지도에서 정한 후보'),coordinates:coord(value)});
const distanceText=value=>Number.isFinite(value)?`${num(Math.round(value))}m`:'수록 없음';
const safeUrl=value=>/^https?:\/\//i.test(String(value||''))?String(value):'';
const asFeatures=features=>({type:'FeatureCollection',features});
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function radiusFeature(item,meters){
  const center=coord(item);if(!center||!Number.isFinite(meters)||meters<=0)return null;
  const rad=Math.PI/180,lat=center[1]*rad,lon=center[0]*rad,arc=meters/6371008.8,coordinates=[];
  for(let index=0;index<32;index++){
    const bearing=index*Math.PI/16;
    const nextLat=Math.asin(Math.sin(lat)*Math.cos(arc)+Math.cos(lat)*Math.sin(arc)*Math.cos(bearing));
    const nextLon=lon+Math.atan2(Math.sin(bearing)*Math.sin(arc)*Math.cos(lat),Math.cos(arc)-Math.sin(lat)*Math.sin(nextLat));
    coordinates.push([nextLon/rad,nextLat/rad]);
  }
  coordinates.push([...coordinates[0]]);
  return {type:'Feature',geometry:{type:'LineString',coordinates},properties:{id:`radius:${item.id}`,name:`${item.name||'선택 후보'} · 직선 반경 ${meters}m`,displayColor:COLORS.proposed,decisionRole:'radius',role:'radius',category:'검토 반경',note:'이번 비교에 사용한 직선거리 조건 · 실제 보행거리나 시설의 물리적 영향 범위가 아님'}};
}

/** A decision begins with a calculated result; field work is never an input gate. */
export function installDecisionTwin(api){
  let regionId='',workflow='coverage',scopeId='all',presetId='',radiusM=null,maxNew=3,proposedSites,excludedServiceIds=[],sites,question='';
  let result=null,manifest=null,ai=null,busy=false,explaining=false,error='',mapMode='scenario',pick=null,requestId=0,controller=null,suppressScope=false,destroyed=false;
  let conditionsOpen=false,selectedId='',showAll=false,interpretQuestion=false,planner=null,planNotice=null;
  let living=false,livingTopic='care',livingData=[],livingQuery='',livingDataset='all',livingLimit=30;
  const host=()=>document.getElementById('detail-body');
  const openNow=()=>api.state.view===VIEW;
  const regionName=()=>api.state.regionProfile?.name||regionId||'선택 지역';
  const scopeName=()=>label(result?.scope)||(scopeId==='all'?`${regionName()} 전체`:api.state.dongs?.find(f=>f.properties.dongId===scopeId)?.properties.dongName)||'선택 구역';
  const presets=()=>list(manifest?.presets);
  const currentProposed=()=>list(proposedSites===undefined?result?.scenario?.proposedSites:proposedSites).filter(coord).map(siteInput);
  const currentSites=()=>list(sites===undefined?result?.context?.sites||result?.sites:sites).filter(coord).slice(0,2).map(siteInput);
  const currentRadius=()=>radiusM??result?.parameters?.radiusM??presets().find(p=>p.id===(presetId||result?.preset?.id))?.radiusM??150;
  const targetUnit=()=>list(result?.sourceStatus).find(d=>d.id===currentPreset().target)?.unit||'수록 대상';
  const currentPreset=()=>presets().find(p=>p.id===(presetId||result?.preset?.id))||result?.preset||{};
  const disabled=()=>busy?' disabled':'';
  const cleanFilename=value=>String(value).replace(/[\\/:*?"<>|]/g,'_').slice(0,100);

  function reset(){
    controller?.abort();requestId++;regionId=api.state.regionProfile?.id||'seogu';scopeId=api.state.dong||'all';
    living=false;livingData=[];livingQuery='';livingDataset='all';livingLimit=30;
    presetId='';radiusM=null;maxNew=3;proposedSites=undefined;excludedServiceIds=[];sites=undefined;result=null;manifest=null;ai=null;error='';question='';pick=null;busy=false;explaining=false;showAll=false;selectedId='';interpretQuestion=false;planner=null;planNotice=null;
    api.state.enabled.delete(LAYER);api.state.entries.delete(LAYER);document.body.classList.remove('decision-picking');
  }
  function inputs(explain=false){
    const params={regionId,workflow,scopeId,maxNew,explain};
    if(presetId)params.presetId=presetId;
    if(radiusM!==null)params.radiusM=radiusM;
    if(proposedSites!==undefined)params.proposedSites=currentProposed();
    if(excludedServiceIds.length)params.excludedServiceIds=[...excludedServiceIds];
    if(sites!==undefined)params.sites=currentSites();
    if(question.trim()&&(interpretQuestion||explain))params.question=question.trim().slice(0,300);
    if(workflow==='inspection')params.proposedSites=[];
    // An explanation must describe the exact currently displayed proposal, not a new automatic plan.
    if(explain&&result){params.presetId=result.preset?.id||presetId||undefined;params.radiusM=result.parameters?.radiusM??currentRadius();params.proposedSites=list(result.scenario?.proposedSites).filter(coord).map(siteInput);params.excludedServiceIds=list(result.scenario?.excludedServiceIds);if(workflow==='site')params.sites=currentSites();}
    return params;
  }
  async function calculate({explain=false,reopen=false}={}){
    if(destroyed)return;
    if(!api.state.regionProfile||!api.state.scope){error='지역 자료를 준비하고 있습니다. 잠시 뒤 다시 계산하세요.';render();return;}
    controller?.abort();controller=new AbortController();const activeController=controller,sequence=++requestId;
    busy=true;explaining=explain;error='';if(!explain)ai=null;
    if(reopen||openNow())render();
    const timer=setTimeout(()=>activeController.abort(),explain?45000:25000);
    try{
      const response=await fetch('/api/decision-twin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(inputs(explain)),signal:activeController.signal});
      let payload;try{payload=await response.json();}catch{throw Error('계산 결과를 읽지 못했습니다. 다시 시도하세요.');}
      if(!response.ok||payload.ok===false||!payload.result)throw Error(typeof payload.error==='string'?payload.error:payload.error?.message||payload.message||`자료 조회에 실패했습니다 (${response.status}).`);
      if(destroyed||sequence!==requestId)return;
      if(payload.result.regionId&&payload.result.regionId!==regionId)throw Error('선택 지역과 계산 지역이 일치하지 않아 결과를 표시하지 않았습니다.');
      result=payload.result;manifest=payload.manifest||manifest;ai=payload.ai||null;
      if(payload.planner||payload.planNotice){planner=payload.planner||{mode:'rules'};planNotice=payload.planNotice||null;}
      const parsed=payload.request||{};
      workflow=result.workflow||parsed.workflow||workflow;
      proposedSites=Object.hasOwn(parsed,'proposedSites')?list(parsed.proposedSites).filter(coord).map(siteInput):undefined;
      sites=Object.hasOwn(parsed,'sites')?list(parsed.sites).filter(coord).map(siteInput):undefined;
      excludedServiceIds=list(parsed.excludedServiceIds||result.scenario?.excludedServiceIds);
      interpretQuestion=false;
      if(result.preset?.id)presetId=result.preset.id;
      if(Number.isFinite(result.parameters?.radiusM))radiusM=result.parameters.radiusM;
      if(Number.isFinite(result.parameters?.maxNew))maxNew=result.parameters.maxNew;
      if(result.scope?.id)scopeId=result.scope.id;
      if(scopeId!==api.state.dong){suppressScope=true;try{api.chooseDong?.(scopeId,false);}finally{suppressScope=false;}}
      paintMap();
    }catch(cause){if(sequence!==requestId||destroyed)return;error=cause.name==='AbortError'?'자료 조회 시간이 길어졌습니다. 다시 계산해 주세요.':cause.message||'결과를 만들지 못했습니다.';}
    finally{clearTimeout(timer);if(sequence===requestId&&!destroyed){busy=false;explaining=false;if(reopen||openNow()){render();if(explain&&!error)host()?.querySelector('.dt-memo')?.scrollIntoView({block:'start',behavior:'smooth'});}}}
  }

  function livingRows(){
    const query=livingQuery.toLocaleLowerCase('ko-KR'),scope=api.state.scope;
    return livingData.filter(d=>livingDataset==='all'||d.id===livingDataset).flatMap(d=>d.features.map(feature=>({descriptor:d,feature}))).filter(({feature})=>{
      const p=feature.properties||{};
      return (!scope||inside(feature.geometry.coordinates,scope))&&(!query||`${p.name||''} ${p.address||''} ${p.roadAddress||''} ${p.lotAddress||''} ${p.facilityName||''}`.toLocaleLowerCase('ko-KR').includes(query));
    });
  }
  function livingCollectedDate(value){const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date):String(value||'미제공');}
  function livingSourceDate(d){return d.meta.sourceDate||d.sourceDate||(Array.isArray(d.sourceDateRange)?d.sourceDateRange.join(' ~ '):'기준일 미제공');}
  async function openLiving(topic='care',requestedScope=''){
    if(requestedScope&&(requestedScope==='all'||list(api.state.dongs).some(f=>f.properties.dongId===requestedScope))&&api.state.dong!==requestedScope){suppressScope=true;try{api.chooseDong?.(requestedScope,true);}finally{suppressScope=false;}}
    if(!regionId||regionId!==(api.state.regionProfile?.id||'seogu'))reset();
    controller?.abort();const sequence=++requestId;controller=new AbortController();const activeController=controller;
    living=true;livingTopic=Object.hasOwn(LIVING_TOPICS,topic)?topic:'care';livingQuery='';livingDataset='all';livingLimit=30;livingData=[];selectedId='';error='';busy=true;scopeId=api.state.dong||'all';pick=null;document.body.classList.remove('decision-picking');renderLiving();
    const timer=setTimeout(()=>activeController.abort(),25000);
    const read=async path=>{const response=await fetch(path,{signal:activeController.signal});if(!response.ok)throw Error(`자료를 불러오지 못했습니다 (${response.status}).`);return response.json();};
    try{
      if(!api.state.regionProfile||!api.state.scope)throw Error('지역 자료를 준비하고 있습니다. 잠시 뒤 다시 열어 주세요.');
      if(!/^[a-z0-9-]+$/.test(regionId))throw Error('지역 식별자를 확인할 수 없습니다.');
      const body=await read(`/data/decision/${regionId}/manifest.json`);
      if(body.regionId!==regionId||!Array.isArray(body.datasets))throw Error('선택 지역과 자료의 지역이 일치하지 않습니다.');
      manifest=body;const config=LIVING_TOPICS[livingTopic];
      const descriptors=body.datasets.filter(d=>d.topic===livingTopic||Array.isArray(d.topics)&&d.topics.includes(livingTopic)||config.fallback.includes(d.id));
      const loaded=await Promise.all(descriptors.map(async(d,index)=>{
        const item={...d,color:d.color||LIVING_COLORS[index%LIVING_COLORS.length],meta:{},features:[],error:''};
        try{
          // Static files stay inside this region's declared pack. A copied URL cannot read another region.
          if(typeof d.path!=='string'||d.path.includes('..')||d.path.includes('?')||d.path.includes('#')||!(d.path.startsWith(`/data/decision/${regionId}/`)||d.path.startsWith(`/data/regions/${regionId}/`)||regionId==='seogu'&&d.path.startsWith('/data/city/')))throw Error('현재 지역의 공개자료 경로가 아닙니다.');
          const raw=await read(d.path),meta=raw.metadata||{};
          if(raw.type!=='FeatureCollection'||!Array.isArray(raw.features))throw Error('위치자료 형식이 올바르지 않습니다.');
          if(meta.regionId&&meta.regionId!==regionId)throw Error('현재 지역과 다른 자료입니다.');
          item.meta=meta;
          if(['not-connected','unavailable','error'].includes(meta.state)){item.error='자료 연결 필요';return item;}
          for(const [i,feature] of raw.features.entries()){
            const point=feature.geometry?.coordinates;
            if(feature.geometry?.type!=='Point'||!Array.isArray(point)||point.length<2||!point.slice(0,2).every(Number.isFinite)||!inside(point,api.state.district))continue;
            const p=feature.properties||{},id=`living:${d.id}:${String(p.id??feature.id??i)}`;
            item.features.push({...feature,geometry:{type:'Point',coordinates:point.slice(0,2)},properties:{...p,id,name:p.name||p.facilityName||d.title,category:d.title,displayColor:item.color,sourceName:p.sourceName||meta.sourceName||d.sourceName,sourceUrl:p.sourceUrl||meta.sourceUrl||d.sourceUrl,sourceDate:p.sourceDate||meta.sourceDate||d.sourceDate,datasetId:d.id}});
          }
          if(!item.features.length)item.error=meta.complete===true?'공개 제공범위 내 수록 위치 없음':'검증된 위치자료 미수록';
        }catch(cause){if(cause.name==='AbortError')throw cause;item.error=cause.message||'자료 조회 실패';}
        return item;
      }));
      if(destroyed||sequence!==requestId)return;livingData=loaded;paintLivingMap();
    }catch(cause){if(sequence!==requestId||destroyed)return;error=cause.name==='AbortError'?'자료를 가져오는 시간이 길어졌습니다. 다시 열어 주세요.':cause.message||'생활자료를 읽지 못했습니다.';}
    finally{clearTimeout(timer);if(sequence===requestId&&!destroyed){busy=false;if(openNow())renderLiving();}}
  }
  function paintLivingMap(){
    if(!living)return;
    const features=livingRows().map(({feature})=>feature);
    api.state.isolate=false;api.state.selected=null;
    api.state.entries.set(LAYER,{state:'loaded',title:LIVING_TOPICS[livingTopic].title,features,metadata:{regionId,mode:'living',topic:livingTopic}});api.state.enabled.add(LAYER);api.drawData();
  }
  function focusLiving(id){
    const found=livingRows().find(({feature})=>feature.properties.id===id);if(!found)return;
    selectedId=id;api.send({type:'camera',pose:frameFor(found.feature.geometry,'facility',{width:Math.max(320,innerWidth-750),height:Math.max(350,innerHeight-180)})});renderLiving();
  }
  function exportLivingCsv(){
    const cell=value=>{let valueText=String(value??'').replace(/[\r\n]+/g,' ');if(/^[\s\uFEFF]*[=+\-@]/.test(valueText))valueText="'"+valueText;return '"'+valueText.replace(/"/g,'""')+'"';};
    const rows=[['종류','시설명','주소','경도','위도','자료 기준일','출처','출처 URL','확인 범위'],...livingRows().map(({descriptor:d,feature:f})=>{const p=f.properties;return [d.title,p.name,p.address||p.roadAddress||p.lotAddress||'',...f.geometry.coordinates,p.sourceDate||livingSourceDate(d),p.sourceName,p.sourceUrl,'공개 수록 위치 · 현재 운영/설비 작동 별도 확인'];})];
    download(cleanFilename(`${regionName()}_${LIVING_TOPICS[livingTopic].label}_생활시설.csv`),'\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
  }
  function renderLiving(){
    if(destroyed)return;const scroll=host()?.scrollTop||0,config=LIVING_TOPICS[livingTopic],rows=livingRows(),selected=rows.find(row=>row.feature.properties.id===selectedId),shown=(selected?[selected,...rows.filter(row=>row!==selected)]:rows).slice(0,livingLimit),missing=livingData.filter(d=>d.error),hasPreset=presets().some(p=>p.id===config.preset);
    const scopedCount=d=>d.features.filter(f=>!api.state.scope||inside(f.geometry.coordinates,api.state.scope)).length;
    api.show(config.title,`<div class="decision-twin living-map" aria-busy="${busy}"><nav class="living-topic-tabs" aria-label="생활정보 분야">${Object.entries(LIVING_TOPICS).map(([id,c])=>`<button data-action="decision-living-topic" data-topic="${id}" aria-pressed="${livingTopic===id}">${e(c.label)}</button>`).join('')}</nav><p class="dt-purpose">${e(config.intro)}</p><section class="living-summary"><span class="dt-kicker">${e(scopeId==='all'?`${regionName()} 전체`:api.state.dongs?.find(f=>f.properties.dongId===scopeId)?.properties.dongName||'선택 구역')} · 공개 수록 위치</span><h3>${busy?'자료를 읽고 있습니다…':!livingData.some(d=>!d.error)?'이 지역의 자료 연결이 필요합니다':`확인한 위치 <strong>${num(rows.length)}곳</strong>`}</h3><p>${livingTopic==='care'?'정원·대기인원·연장보육·실제 모집은 해당 기관에 확인하세요.':'시설 위치로 현재 안전도나 안전한 경로를 판정하지 않습니다. 안심벨 작동·야간 조도·실제 통행로는 현장 확인하세요.'}</p></section>${busy?'<p class="dt-status" role="status">공개자료의 시설 위치와 기준일을 확인하고 있습니다.</p>':''}${error?`<div class="dt-error" role="alert"><p>${e(error)}</p><button data-action="decision-living-retry">다시 불러오기</button></div>`:''}<div class="living-filters"><label for="living-scope">어느 동네를 볼까요?<select id="living-scope"><option value="all">${e(regionName())} 전체</option>${list(api.state.dongs).map(f=>`<option value="${e(f.properties.dongId)}"${scopeId===f.properties.dongId?' selected':''}>${e(f.properties.dongName)}</option>`).join('')}</select></label><label for="living-dataset">시설 종류<select id="living-dataset"><option value="all">함께 보기</option>${livingData.map(d=>`<option value="${e(d.id)}"${livingDataset===d.id?' selected':''}>${e(d.title)} · ${d.error?'자료 확인 필요':`${num(scopedCount(d))}곳`}</option>`).join('')}</select></label></div><form id="living-search" class="dt-question"><label class="dt-sr-only" for="living-query">시설 이름 또는 주소 검색</label><input id="living-query" name="query" value="${e(livingQuery)}" maxlength="100" placeholder="시설 이름·도로명으로 찾기" autocomplete="off"><button type="submit">찾기</button></form><div class="living-legend" aria-label="지도 시설 종류">${livingData.filter(d=>!d.error).map(d=>`<span><i style="--dt-dot:${e(d.color)}"></i>${e(d.title)} ${num(scopedCount(d))}곳</span>`).join('')}</div>${!busy&&!livingData.length?'<p class="dt-empty">이 지역은 해당 생활정보 자료 연결 전입니다. 시설이 없다는 뜻은 아닙니다.</p>':''}${missing.length?`<details class="living-missing"><summary>아직 확인할 수 없는 자료 ${num(missing.length)}종</summary><ul>${missing.map(d=>`<li><strong>${e(d.title)}</strong> · ${e(d.error)}</li>`).join('')}</ul><p class="dt-help">미연결 자료는 0곳으로 계산하지 않습니다.</p></details>`:''}<section class="living-next"><h3>이 지도로 시작할 다음 업무</h3><p>${livingTopic==='care'?'어린이집 주변의 활동공간을 찾고, 프로그램 연계 후보지의 주변 여건을 같은 기준으로 비교하세요.':'공개 안전시설을 함께 보며 점검할 위치를 정리하고 추가 설치안을 비교하세요.'}</p><div class="living-next-actions">${hasPreset?`<button data-action="decision-living-compare" data-workflow="coverage">${livingTopic==='care'?'주변 활동공간 연계안':'비상벨 추가안'} 비교</button><button data-action="decision-living-compare" data-workflow="inspection">현장 점검 후보 보기</button><button data-action="decision-living-compare" data-workflow="site">사업 후보지 A·B 비교</button>`:'<span class="dt-help">이 지역의 비교용 자료 연결 후 추가·이전안을 검토할 수 있습니다.</span>'}<button data-action="decision-api-guide">생활정보 API 연결 안내 ↗</button></div></section><section class="dt-section"><div class="dt-section-heading"><h3>시설 목록 <span>${num(rows.length)}곳</span></h3><button class="dt-link" data-action="decision-living-csv"${rows.length?'':' disabled'}>목록 CSV</button></div><div class="dt-result-list">${shown.map(({descriptor:d,feature:f})=>{const p=f.properties,url=safeUrl(p.sourceUrl||d.meta.sourceUrl||d.sourceUrl);return `<article class="dt-row living-card${selectedId===p.id?' is-focused':''}" data-living-card="${e(p.id)}"><div><h4>${e(p.name)}</h4><span class="living-kind" style="--living-color:${e(d.color)}">${e(d.title)}</span></div><p>${e(p.address||p.roadAddress||p.lotAddress||'주소 미제공 · 지도에서 위치 확인')}</p>${p.facilityType||p.registeredStatus?`<p>${e([p.facilityType,p.registeredStatus&&`원문 상태 ${p.registeredStatus}`].filter(Boolean).join(' · '))}</p>`:''}${Number.isFinite(p.capacity)||Number.isFinite(p.enrolled)?`<p>공시 정원 ${Number.isFinite(p.capacity)?num(p.capacity)+'명':'미제공'} · 현원 ${Number.isFinite(p.enrolled)?num(p.enrolled)+'명':'미제공'}<br><small>입소 가능 인원이 아닙니다. 실제 모집은 기관에 확인하세요.</small></p>`:''}${p.phone?`<p>기관 연락처 ${e(p.phone)}</p>`:''}${p.operationalStatus?`<p class="living-data-date">${e(p.operationalStatus)}</p>`:''}<p class="living-data-date">자료 기준 ${e(p.sourceDate||livingSourceDate(d))}${!p.sourceDate&&!d.meta.sourceDate&&!d.sourceDate&&(p.collectedAt||d.meta.collectedAt||d.collectedAt)?` · 수집 ${e(livingCollectedDate(p.collectedAt||d.meta.collectedAt||d.collectedAt))}`:''}</p><div class="living-card-actions"><button data-action="decision-living-focus" data-id="${e(p.id)}">지도에서 보기</button>${hasPreset?`<button data-action="decision-living-review" data-id="${e(p.id)}">이 시설 주변 검토</button>`:''}${url?`<a href="${e(url)}" target="_blank" rel="noreferrer">원자료 ↗</a>`:''}</div></article>`;}).join('')||(!busy?'<p class="dt-empty">선택한 동네·종류·검색어에 해당하는 수록 위치가 없습니다. 검색 조건을 바꾸거나 자료 범위를 확인하세요.</p>':'')}</div>${rows.length>shown.length?`<button class="dt-add-site" data-action="decision-living-more">시설 30곳 더 보기 (${num(shown.length)} / ${num(rows.length)})</button>`:''}</section><details class="dt-sources"><summary>자료 출처와 수록 범위</summary><ul>${livingData.map(d=>{const url=safeUrl(d.meta.sourceUrl||d.sourceUrl);return `<li><strong>${e(d.title)}</strong><span>${e(d.meta.sourceName||d.sourceName||'출처 미제공')} · ${e(livingSourceDate(d))}${d.meta.collectedAt||d.collectedAt?` · 수집 ${e(livingCollectedDate(d.meta.collectedAt||d.collectedAt))}`:''}</span><p>${e(d.meta.coverage||d.coverage||'공개 자료 중 위치를 검증한 기록입니다. 누락은 시설 부재를 뜻하지 않습니다.')}</p>${url?`<a href="${e(url)}" target="_blank" rel="noreferrer">공식 원자료 보기 ↗</a>`:''}</li>`;}).join('')||'<li>이 지역의 해당 자료를 연결하면 출처와 기준일을 표시합니다.</li>'}</ul><p class="dt-help">가정폭력·성폭력 피해자 보호시설 등 비공개 시설 위치는 수록하지 않습니다.</p></details></div>`,VIEW);
    if(host())host().scrollTop=scroll;
  }

  function conditionsHtml(){
    return `<details class="dt-conditions"${conditionsOpen?' open':''}><summary>비교 조건 바꾸기 <span>${e(scopeName())} · ${num(currentRadius())}m</span></summary><form id="decision-conditions"><div class="dt-fields"><label>검토 구역<select name="scopeId"><option value="all">${e(regionName())} 전체</option>${list(api.state.dongs).map(f=>`<option value="${e(f.properties.dongId)}"${scopeId===f.properties.dongId?' selected':''}>${e(f.properties.dongName)}</option>`).join('')}</select></label><label>직선거리 조건 (m)<input name="radiusM" type="number" min="50" max="2000" step="10" required value="${e(currentRadius())}"></label>${workflow==='coverage'?`<label>추가 후보 최대 (곳)<input name="maxNew" type="number" min="0" max="5" step="1" required value="${e(maxNew)}"></label>`:''}</div><p class="dt-help">거리 조건은 이번 검토의 가정입니다. 실제 보행시간이나 법정 설치기준이 아닙니다.</p><button type="submit" class="primary"${disabled()}>이 조건으로 다시 비교</button></form></details>`;
  }
  function metricsHtml(){
    if(!result)return '';
    if(workflow==='site')return `<section class="dt-outcome"><p class="dt-kicker">같은 거리 · 같은 자료로 비교</p><h3>후보지 주변 여건을 한눈에</h3><p>${num(currentSites().length)}개 후보지의 반경 ${num(currentRadius())}m 자료를 조회했습니다.</p></section>`;
    const base=result.baseline||{},after=result.scenario||{};
    if(workflow==='inspection')return `<section class="dt-outcome"><p class="dt-kicker">점검 동선을 준비할 공개자료 근거</p><h3>${num(base.total)}개 대상 중 <strong>${num(base.uncovered)}개</strong>가 거리 조건 밖입니다.</h3><p>거리 조건 밖의 대상부터 점검 후보로 정리했습니다. 원문에 미설치 표기가 있으면 함께 표시합니다. 실제 시설 상태와 통행 여건은 현장에서 확인하세요.</p></section>`;
    const locations=Number.isFinite(base.totalLocations),total=locations?base.totalLocations:base.total,before=locations?base.coveredLocations:base.covered,afterCount=locations?after.coveredLocations:after.covered,gain=locations?after.newlyCoveredLocations:after.newlyCovered,remaining=locations?after.uncoveredLocations:after.uncovered;
    return `<section class="dt-outcome" aria-label="현재와 변경안 비교"><p class="dt-kicker">${e(currentPreset().title||'시설 위치 비교')} · ${e(scopeName())}</p><div class="dt-before-after"><div><span>현재 조건 이내 ${locations?'위치':'대상'}</span><strong>${num(before)}<small> / ${num(total)}</small></strong></div><span class="dt-arrow" aria-hidden="true">→</span><div><span>변경안 조건 이내 ${locations?'위치':'대상'}</span><strong>${num(afterCount)}<small> / ${num(total)}</small></strong></div></div><div class="dt-outcome-footer"><span class="dt-gain">새로 연결 <b>${num(gain)}${locations?'곳':'개'}</b></span><span>남은 거리조건 밖 <b>${num(remaining)}${locations?'곳':'개'}</b></span>${after.lostCovered?`<span class="dt-loss">연결 해제 ${num(locations?after.lostCoveredLocations:after.lostCovered)}${locations?'곳':'개'}</span>`:''}</div><p>${locations?`같은 좌표를 한 곳으로 묶었습니다. 원문 ${e(targetUnit())} 기준: ${num(base.covered)} → ${num(after.covered)}개 / 전체 ${num(base.total)}개.`:`${e(targetUnit())} 기준입니다. 같은 식별자는 한 번만 셉니다.`} 전체 대상과의 거리를 다시 계산한 결과입니다.</p></section>`;
  }
  function mapControlsHtml(){
    if(!result)return '';
    return `<section class="dt-map-controls"><div class="dt-segment" aria-label="지도에 표시할 상태"><button data-action="decision-map-mode" data-mode="baseline" aria-pressed="${mapMode==='baseline'}">현재 지도</button><button data-action="decision-map-mode" data-mode="scenario" aria-pressed="${mapMode==='scenario'}">변경안 지도</button></div><div class="dt-legend"><span><i style="--dt-dot:${COLORS.service}"></i>기존 시설</span><span><i style="--dt-dot:${COLORS.proposed}"></i>${workflow==='site'?'비교 후보':'추가 후보'}</span><span><i style="--dt-dot:${COLORS.new}"></i>새 연결</span><span><i style="--dt-dot:${COLORS.uncovered}"></i>거리조건 밖</span></div></section>`;
  }
  function proposalsHtml(){
    const chosen=currentProposed(),recommendations=list(result.recommendations),byId=new Map(chosen.map(p=>[p.id,p]));
    const candidates=[...chosen,...recommendations.filter(p=>!byId.has(p.id))].slice(0,12);
    return `<section class="dt-section"><div class="dt-section-heading"><h3>추가 후보 ${num(chosen.length)}곳</h3><button class="dt-link" data-action="decision-auto"${disabled()}>자동 제안 다시</button></div><p class="dt-help">후보를 빼거나 지도에서 옮기면 새로 연결되는 대상이 달라집니다.</p><div class="dt-candidates">${candidates.map((p,index)=>{const selected=byId.has(p.id),rec=selected?(list(result.scenario?.proposedSites).find(r=>r.id===p.id)||p):(recommendations.find(r=>r.id===p.id)||p);return `<article class="dt-candidate${selected?' is-selected':''}${selectedId===p.id?' is-focused':''}" data-decision-card="${e(p.id)}"><div class="dt-candidate-title"><span class="dt-order">${index+1}</span><h4>${e(p.name||'추가 후보')}</h4><span class="dt-state">${selected?'반영 중':'후보'}</span></div>${Number.isFinite(rec.exclusiveLocationGain)&&selected?`<p class="dt-candidate-value">이 후보를 빼면 다시 거리조건 밖 <b>${num(rec.exclusiveLocationGain)}곳</b><br><small>고유좌표 기준 · 원문 대상 ${num(rec.exclusiveGain)}개</small></p>`:Number.isFinite(rec.exclusiveGain)&&selected?`<p class="dt-candidate-value">이 후보를 빼면 다시 거리조건 밖 <b>${num(rec.exclusiveGain)}개</b></p>`:Number.isFinite(rec.marginalGain)?`<p class="dt-candidate-value">제안 순서에서 추가 연결 <b>${num(rec.marginalGain)}개</b></p>`:'<p class="dt-candidate-value">직접 정한 위치 · 전체 결과에서 변화 확인</p>'}<div class="dt-card-actions"><button data-action="decision-toggle-candidate" data-id="${e(p.id)}" aria-pressed="${selected}"${disabled()}>${selected?'이번 안에서 제외':'이번 안에 추가'}</button><button data-action="decision-focus" data-id="${e(p.id)}">지도 보기</button>${selected?`<button data-action="decision-move-candidate" data-id="${e(p.id)}"${disabled()}>위치 옮기기</button>`:''}</div></article>`;}).join('')||'<p class="dt-empty">현재 조건에서 새로 연결할 후보가 없습니다. 지도에서 위치를 직접 정해 비교할 수 있습니다.</p>'}</div><button class="dt-add-site" data-action="decision-add-site"${disabled()}>＋ 지도에서 추가 위치 정하기</button></section>`;
  }
  function services(){
    const items=list(result?.context?.services);
    if(items.length)return items.filter(coord);
    const found=new Map();for(const row of list(result?.rows)){if(row.nearest?.id&&coord(row.nearest))found.set(row.nearest.id,row.nearest);}return [...found.values()];
  }
  function servicesHtml(){
    const all=services();if(!all.length)return '';
    return `<details class="dt-services"><summary>기존 시설을 옮기거나 중단하는 안도 비교 <span>${num(excludedServiceIds.length)}곳 제외</span></summary><p class="dt-help">이 변경안에서만 제외합니다. 등록된 시설의 실제 운영 상태는 바뀌지 않습니다.</p><label>변경할 기존 시설<select id="decision-service-id">${all.map(s=>`<option value="${e(s.id)}">${e(s.name)}${excludedServiceIds.includes(s.id)?' · 이번 안 제외':''}</option>`).join('')}</select></label><button data-action="decision-toggle-service"${disabled()}>선택 시설 제외 / 복원</button>${excludedServiceIds.length?`<p class="dt-help">제외 중: ${e(excludedServiceIds.map(id=>all.find(s=>s.id===id)?.name||id).join(', '))}</p>`:''}</details>`;
  }
  function contextSummary(row){return list(row.context).map(item=>`${item.title||item.datasetId}: ${!Number.isFinite(item.count)?'미연결':`${num(item.count)}${item.unit||'곳'}`}`).join(' · ');}
  function rowsHtml(){
    const all=list(result?.rows),ordered=all;
    const shown=showAll?ordered.slice(0,200):ordered.slice(0,10);
    return `<section class="dt-section"><div class="dt-section-heading"><h3>${workflow==='inspection'?'점검 후보와 선정 근거':'대상별 변화'}</h3><span>${num(all.length)}개</span></div>${workflow==='inspection'?'<p class="dt-help">거리 조건과 원문에 제공된 확인사항으로 조사 순서를 정리했습니다. 현재 위험도·위법 여부를 판정하지 않습니다.</p>':''}<div class="dt-result-list">${shown.map(row=>`<article class="dt-row${selectedId===row.id?' is-focused':''}" data-decision-card="${e(row.id)}"><div><h4>${e(row.name||row.id)}</h4><span class="dt-row-state${row.newlyCovered?' is-new':''}">${row.newlyCovered?'새로 연결':row.lostCovered?'연결 해제':row.scenarioCovered===true?'조건 이내':row.scenarioCovered===false?'거리 조건 밖':'미산정'}</span></div><p>최근접 시설 ${e(row.nearest?.name||'수록 없음')} · ${distanceText(row.nearest?.distanceM)}</p>${list(row.inspectionFlags).filter(f=>f.state==='not-installed').length?`<p class="dt-inspection-flags">${e(list(row.inspectionFlags).filter(f=>f.state==='not-installed').map(f=>f.text||`${f.label}: 원문 미설치 표기`).join(' · '))}</p>`:''}${row.context?.length?`<p class="dt-context">${e(contextSummary(row))}</p>`:''}<div class="dt-row-bottom"><small>${coord(row)?.map(n=>n.toFixed(5)).join(', ')||'좌표 미제공'}</small><button data-action="decision-focus" data-id="${e(row.id)}">지도 보기</button></div></article>`).join('')||'<p class="dt-empty">이 구역에서 비교할 대상 자료가 없습니다. 구역이나 자료를 바꿔 주세요.</p>'}</div>${all.length>10?`<button class="dt-link" data-action="decision-show-all">${showAll?'처음 10개만 보기':`목록 더 보기 (${num(Math.min(all.length,200))}개)`}</button>`:''}${all.length>200&&showAll?'<p class="dt-help">화면에는 200개까지 표시합니다. 전체 목록은 CSV로 내려받으세요.</p>':''}</section>`;
  }
  function siteHtml(){
    const comparisons=list(result?.context?.sites||result?.sites),chosen=currentSites(),datasets=new Map();
    for(const p of comparisons)for(const d of list(p.datasets))if(!datasets.has(d.datasetId))datasets.set(d.datasetId,d);
    return `<section class="dt-section"><h3>비교할 후보 위치</h3><p class="dt-help">${sites===undefined?'수록 공공공간 두 곳을 먼저 비교했습니다. 지도에서 실제 검토 후보로 바꿔 보세요.':'지도에서 정한 두 후보를 같은 반경으로 비교합니다.'}</p><div class="dt-site-choices">${[0,1].map(i=>`<article><span class="dt-site-letter">${i===0?'A':'B'}</span><div><h4>${e(chosen[i]?.name||'후보를 정해 주세요')}</h4><small>${coord(chosen[i])?.map(n=>n.toFixed(5)).join(', ')||'지도에서 한 번 클릭'}</small></div><button data-action="decision-pick-review-site" data-index="${i}"${disabled()}>${chosen[i]?'위치 바꾸기':'지도에서 선택'}</button></article>`).join('')}</div>${comparisons.length?`<div class="dt-table-wrap"><table class="dt-comparison"><caption>반경 ${num(currentRadius())}m의 수록자료 비교</caption><thead><tr><th>비교 자료</th>${comparisons.map((p,i)=>`<th>${i===0?'A':'B'} · ${e(p.name)}</th>`).join('')}</tr></thead><tbody>${[...datasets].map(([id,d])=>`<tr><th>${e(d.title||id)}</th>${comparisons.map(p=>{const v=list(p.datasets).find(x=>x.datasetId===id);return `<td>${v&&Number.isFinite(v.count)?`<b>${num(v.count)}</b> ${e(v.unit||'곳')}`:'미연결'}${v?.nearest?`<small>최근접 ${distanceText(v.nearest.distanceM)}<br>${e(v.nearest.name)}</small>`:''}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="dt-empty">후보지를 선택하면 주변 시설 자료가 여기에 나옵니다.</p>'}</section>`;
  }
  function sourcesHtml(){
    const sources=decisionSources(result,manifest);
    return `<details class="dt-sources"><summary>사용한 자료와 계산 범위 <span>${num(sources.length)}개 자료</span></summary><ul>${sources.map(s=>{const url=safeUrl(s.sourceUrl||s.url||s.source?.url);return `<li><strong>${e(s.title||s.name||s.sourceName||s.id||s.datasetId)}</strong><span>기준 ${e(s.sourceDate||s.asOf||s.date||s.source?.date||'미제공')} · ${e(({'available':'자료 수록','empty-complete':'제공 범위 내 0건','unavailable':'미연결'})[s.state]||s.status||'수록자료')}</span>${Number.isFinite(s.acceptedPoints)?`<span>원자료 전체 ${num(s.acceptedPoints)}개 기록 · 고유좌표 ${num(s.uniqueLocations)}곳</span>`:''}${s.coverageNote||s.coverage?`<p>${e(s.coverageNote||s.coverage)}</p>`:''}${url?`<a href="${e(url)}" target="_blank" rel="noreferrer">원자료 보기 ↗</a>`:''}</li>`;}).join('')}</ul>${list(result?.evidence).length?`<h4>이번 계산의 주요 근거 (최대 40개)</h4><ul>${list(result.evidence).slice(0,40).map(item=>`<li>${e(typeof item==='string'?item:item.text||item.summary||'')}</li>`).join('')}</ul>`:''}<h4>적용 범위</h4><ul>${list(result?.limitations).map(item=>`<li>${e(typeof item==='string'?item:label(item))}</li>`).join('')}</ul></details>`;
  }
  function memoHtml(){
    const text=decisionAiText(ai);
    return `<section class="dt-memo"><div class="dt-section-heading"><h3>바로 쓸 검토자료</h3><span>계산 근거 포함</span></div><p>후보의 차이와 다음 판단에 필요한 내용을 행정 검토메모로 정리합니다.</p><button class="primary dt-ai-button" data-action="decision-explain"${disabled()}>${explaining?'AI가 계산 근거를 읽고 있습니다…':ai?.mode==='llm'?'현재 결과로 AI 메모 다시 작성':'AI 근거 검토메모 만들기'}</button>${text?ai?.mode==='llm'?`<div class="dt-ai-result"><p class="dt-ai-label">AI가 현재 계산 근거로 작성 · 담당자 검토용</p><div>${e(text)}</div></div>`:`<details class="dt-rule-memo"><summary>계산 근거 요약 펼치기</summary><div class="dt-ai-result"><div>${e(text)}</div></div></details>`:''}<div class="dt-export"><button data-action="decision-report"${busy||error?' disabled':''}>검토서 내려받기</button><button data-action="decision-csv"${busy||error?' disabled':''}>좌표 목록 CSV</button></div></section>`;
  }
  function render(){
    if(destroyed)return;
    if(living){renderLiving();return;}
    const scroll=host()?.scrollTop||0;
    api.show(decisionWorkflowTitle(workflow),`<div class="decision-twin" aria-busy="${busy}"><nav class="dt-tabs" aria-label="행정 업무 선택">${workflows.map(([id,title])=>`<button data-action="decision-workflow" data-workflow="${id}" aria-pressed="${workflow===id}">${title}</button>`).join('')}</nav>${presets().length?`<div class="dt-visible-preset"><label for="decision-preset">무엇을 검토하나요?<select id="decision-preset"${disabled()}>${presets().map(p=>`<option value="${e(p.id)}"${p.id===(presetId||result?.preset?.id)?' selected':''}>${e(p.title||p.id)}</option>`).join('')}</select></label>${currentPreset().description?`<p>${e(currentPreset().description)}</p>`:''}</div>`:''}<p class="dt-purpose">${e(workflows.find(w=>w[0]===workflow)?.[2])}</p><form id="decision-question" class="dt-question"><label class="dt-sr-only" for="decision-question-input">검토 목적 또는 바꿀 조건</label><input id="decision-question-input" name="question" maxlength="300" value="${e(question)}" placeholder="예: 추가 후보를 2곳으로 줄여줘" autocomplete="off"><button type="submit"${disabled()}>적용</button></form>${busy?`<p class="dt-status" role="status">${explaining?'AI가 실제 계산 결과를 검토하고 있습니다.':'공개자료의 위치를 비교하고 있습니다…'}</p>`:''}${error?`<div class="dt-error" role="alert"><strong>이번 계산을 완료하지 못했습니다.</strong><p>${e(error)}</p>${result?'<p>아래는 이전 결과입니다. 다시 계산하면 현재 조건으로 갱신합니다.</p>':''}<button data-action="decision-retry">다시 계산</button></div>`:''}${pick?`<div class="dt-pick-notice" role="status"><strong>지도에서 ${pick.type==='move'?'옮길 위치':pick.type==='review'?'비교 후보 위치':'추가할 위치'}를 클릭하세요.</strong><button data-action="decision-cancel-pick">선택 취소</button></div>`:''}${result?`${result.status==='unavailable'?'<p class="dt-status">대상 또는 시설 자료가 없어 공백·증가량을 계산하지 않았습니다. 아래 자료 범위를 확인하세요.</p>':''}${planner?`<p class="dt-plan-label">${planner.mode==='llm'?'AI가 질문을 비교 조건으로 바꿨습니다.':'질문에 적힌 거리·개수·시설을 규칙으로 적용했습니다.'}</p>`:''}${metricsHtml()}${decisionPurposeHtml(result,currentPreset())}<button class="dt-ai-short" data-action="decision-explain"${disabled()}>${explaining?'AI가 근거를 정리하고 있습니다…':'AI로 근거와 다음 업무 정리'}</button>${conditionsHtml()}${mapControlsHtml()}${workflow==='coverage'?proposalsHtml()+servicesHtml():workflow==='site'?siteHtml():''}${memoHtml()}${workflow!=='site'?rowsHtml():''}${sourcesHtml()}`:busy?'<div class="dt-loading"><div></div><div></div><div></div><p>처음 결과에는 별도 입력이 필요하지 않습니다.</p></div>':conditionsHtml()}</div>`,VIEW);
    if(host())host().scrollTop=scroll;
  }
  function marker(item,prefix,color,name){return {type:'Feature',geometry:{type:'Point',coordinates:coord(item)},properties:{id:`${prefix}:${item.id}`,name:name||item.name||item.id,displayColor:color,category:'행정 검토',decisionRole:prefix==='proposed'?'proposal':prefix,role:prefix==='proposed'?'proposal':prefix,note:prefix==='proposed'?'이번 비교안에서만 추가한 가상 시설 위치':'수록 자료의 대표좌표'}};}
  function paintMap(){
    if(!result)return;
    let features=[];
    if(workflow==='site'){
      features=list(result.map?.highlight?.features).filter(f=>f.geometry&&f.properties&&f.properties.role!=='site'&&f.properties.decisionRole!=='site'&&!String(f.properties.id||f.id||'').startsWith('site:')).map(f=>({...f,properties:{...f.properties,displayColor:f.properties.displayColor||COLORS.covered}}));
      for(const item of currentSites())features.push(marker(item,'site',COLORS.proposed));
    }else{
      for(const row of list(result.rows).filter(coord)){
        const color=mapMode==='baseline'?(row.baselineCovered?COLORS.covered:COLORS.uncovered):row.newlyCovered?COLORS.new:row.lostCovered?COLORS.lost:row.scenarioCovered?COLORS.covered:COLORS.uncovered;
        features.push(marker(row,'target',color,`${row.name} · ${mapMode==='baseline'?(row.baselineCovered?'현재 조건 이내':'현재 공백'):row.newlyCovered?'새로 연결':row.lostCovered?'연결 해제':row.scenarioCovered?'조건 이내':'거리조건 밖'}`));
      }
      for(const item of services())if(mapMode==='baseline'||!excludedServiceIds.includes(item.id))features.push(marker(item,'service',COLORS.service));
      if(mapMode==='scenario')for(const item of currentProposed())features.push(marker(item,'proposed',COLORS.proposed,`${item.name} · 추가 후보`));
    }
    const radiusSites=workflow==='site'?currentSites():mapMode==='scenario'?currentProposed():[];
    for(const site of radiusSites){const ring=radiusFeature(site,currentRadius());if(ring)features.push(ring);}
    // Model context and UI markers may describe the same feature. Entity IDs must be unique in every map engine.
    features=[...new Map(features.map((feature,index)=>[String(feature.properties?.id??feature.id??`decision-${index}`),feature])).values()];
    api.state.isolate=false;api.state.selected=null;
    api.state.entries.set(LAYER,{state:'loaded',title:mapMode==='baseline'?'의사결정 · 현재 위치':'의사결정 · 변경안 위치',features,metadata:{regionId,workflow,version:result.version}});
    api.state.enabled.add(LAYER);api.drawData();
  }
  function focus(id){
    const item=[...currentProposed(),...currentSites(),...list(result?.recommendations),...list(result?.rows),...services()].find(p=>p.id===id);
    if(!coord(item))return;
    selectedId=id;api.send({type:'camera',pose:frameFor({type:'Point',coordinates:coord(item)},'facility',{width:Math.max(320,innerWidth-750),height:Math.max(350,innerHeight-180)})});
    if(openNow())render();
  }
  function cancelPick(){pick=null;document.body.classList.remove('decision-picking');api.send({type:'stop'});if(openNow())render();}
  function beginPick(mode){
    if(busy)return;if(!api.state.ready){api.toast('지도 연결이 끝난 뒤 위치를 정할 수 있습니다.');return;}
    pick=mode;document.body.classList.add('decision-picking');api.send({type:'tool',tool:'decision-site'});render();
    if(innerWidth<=820)api.close();api.toast('선택 구역 안에서 지도 위치를 클릭하세요. 클릭하면 바로 다시 비교합니다.');
  }
  async function open(next='coverage',draft=''){
    living=false;
    if(!regionId||regionId!==(api.state.regionProfile?.id||'seogu'))reset();
    const changed=workflow!==next;workflow=['coverage','inspection','site'].includes(next)?next:'coverage';
    if(changed){radiusM=workflow==='site'?500:presets().find(p=>p.id===presetId)?.radiusM??null;result=null;ai=null;error='';showAll=false;planner=null;planNotice=null;interpretQuestion=false;question='';proposedSites=undefined;sites=undefined;excludedServiceIds=[];pick=null;selectedId='';}
    if(draft){question=String(draft).slice(0,300);interpretQuestion=true;proposedSites=undefined;sites=undefined;}
    scopeId=api.state.dong||'all';render();await calculate();
  }
  async function changePreset(id,nextWorkflow=workflow,reviewSite=null){
    if(busy)return;living=false;
    if(!regionId||regionId!==(api.state.regionProfile?.id||'seogu'))reset();
    workflow=nextWorkflow;presetId=String(id||'');radiusM=workflow==='site'?500:presets().find(p=>p.id===presetId)?.radiusM??null;
    proposedSites=undefined;excludedServiceIds=[];sites=reviewSite?[siteInput(reviewSite)]:undefined;question=reviewSite?`${reviewSite.name} 주변의 공개 시설 여건을 비교합니다.`:'';interpretQuestion=false;planner=null;planNotice=null;result=null;ai=null;error='';showAll=false;selectedId='';scopeId=api.state.dong||'all';render();await calculate();
  }
  async function handleSubmit(event){
    if(event.target.matches('#living-search')){event.preventDefault();livingQuery=String(new FormData(event.target).get('query')||'').trim().slice(0,100);livingLimit=30;paintLivingMap();renderLiving();return;}
    if(!event.target.matches('#decision-conditions,#decision-question'))return;event.preventDefault();if(busy)return;
    if(event.target.id==='decision-question'){question=String(new FormData(event.target).get('question')||'').trim().slice(0,300);interpretQuestion=true;proposedSites=undefined;await calculate();return;}
    if(!event.target.reportValidity())return;
    const values=Object.fromEntries(new FormData(event.target)),nextScope=values.scopeId||'all';
    const changedPreset=values.presetId&&values.presetId!==presetId;
    presetId=values.presetId||presetId;radiusM=Number(values.radiusM);maxNew=values.maxNew!==undefined?Number(values.maxNew):maxNew;
    proposedSites=undefined;excludedServiceIds=[];interpretQuestion=false;planner=null;planNotice=null;if(changedPreset)sites=undefined;
    if(nextScope!==scopeId){scopeId=nextScope;sites=undefined;suppressScope=true;try{api.chooseDong?.(scopeId,false);}finally{suppressScope=false;}}
    conditionsOpen=false;await calculate();
  }
  const offs=[
    registerAction('decision-living-map',button=>openLiving(button?.topic||button?.dataset?.topic||'care',button?.scopeId||button?.dataset?.scopeId||'')),
    registerAction('decision-living-topic',button=>openLiving(button.dataset.topic)),
    registerAction('decision-living-retry',()=>openLiving(livingTopic)),
    registerAction('decision-living-more',()=>{livingLimit+=30;renderLiving();}),
    registerAction('decision-living-focus',button=>focusLiving(button.dataset.id)),
    registerAction('decision-living-review',button=>{const found=livingRows().find(({feature})=>feature.properties.id===button.dataset.id);if(!found)return;const p=found.feature.properties;return changePreset(LIVING_TOPICS[livingTopic].preset,'site',{id:'site-1',name:p.name,coordinates:found.feature.geometry.coordinates});}),
    registerAction('decision-living-compare',button=>changePreset(LIVING_TOPICS[livingTopic].preset,button.dataset.workflow||'coverage')),
    registerAction('decision-living-csv',exportLivingCsv),
    registerAction('decision-twin',()=>open('coverage')),
    registerAction('decision-inspection',()=>open('inspection')),
    registerAction('decision-site-review',()=>open('site')),
    registerAction('decision-from-question',button=>open(button?.workflow||button?.dataset?.workflow||'coverage',button?.question||button?.dataset?.question||'')),
    registerAction('decision-workflow',button=>open(button.dataset.workflow)),
    registerAction('decision-preset',button=>changePreset(button.dataset.id||button.dataset.presetId,['coverage','inspection','site'].includes(button.dataset.workflow)?button.dataset.workflow:'coverage')),
    registerAction('decision-retry',()=>calculate()),
    registerAction('decision-map-mode',button=>{mapMode=button.dataset.mode==='baseline'?'baseline':'scenario';paintMap();render();}),
    registerAction('decision-show-all',()=>{showAll=!showAll;render();}),
    registerAction('decision-focus',button=>focus(button.dataset.id)),
    registerAction('decision-auto',()=>{if(busy)return;proposedSites=undefined;calculate();}),
    registerAction('decision-toggle-candidate',button=>{if(busy)return;const id=button.dataset.id,current=currentProposed(),found=current.find(p=>p.id===id);if(found)proposedSites=current.filter(p=>p.id!==id);else{const candidate=list(result?.recommendations).find(p=>p.id===id);if(!coord(candidate))return;if(current.length>=5){api.toast('한 번에 최대 5곳까지 비교할 수 있습니다.');return;}proposedSites=[...current,siteInput(candidate)];maxNew=Math.max(maxNew,proposedSites.length);}calculate();}),
    registerAction('decision-add-site',()=>{if(currentProposed().length>=5){api.toast('한 번에 최대 5곳까지 비교할 수 있습니다.');return;}beginPick({type:'add'});}),
    registerAction('decision-move-candidate',button=>beginPick({type:'move',id:button.dataset.id})),
    registerAction('decision-pick-review-site',button=>beginPick({type:'review',index:Number(button.dataset.index)===1?1:0})),
    registerAction('decision-cancel-pick',cancelPick),
    registerAction('decision-toggle-service',()=>{if(busy)return;const id=document.getElementById('decision-service-id')?.value;if(!id)return;proposedSites=currentProposed();excludedServiceIds=excludedServiceIds.includes(id)?excludedServiceIds.filter(s=>s!==id):[...excludedServiceIds,id];calculate();}),
    registerAction('decision-explain',()=>{if(!busy&&result&&!error)calculate({explain:true});}),
    registerAction('decision-report',()=>{if(!result||busy||error)return;download(cleanFilename(`${regionName()}온_${decisionWorkflowTitle(workflow)}_${new Date().toISOString().slice(0,10)}.html`),decisionReportHtml({result,manifest,ai,question,regionName:regionName()}),'text/html;charset=utf-8');}),
    registerAction('decision-csv',()=>{if(!result||busy||error)return;download(cleanFilename(`${regionName()}온_검토위치_${new Date().toISOString().slice(0,10)}.csv`),decisionCsv(result),'text/csv;charset=utf-8');}),
  ];
  host()?.addEventListener('submit',handleSubmit);
  const change=event=>{if(event.target.id==='decision-preset')changePreset(event.target.value);if(event.target.id==='living-dataset'){livingDataset=event.target.value;livingLimit=30;paintLivingMap();renderLiving();}if(event.target.id==='living-scope'){const next=event.target.value;suppressScope=true;try{api.chooseDong?.(next,true);}finally{suppressScope=false;}scopeId=next;livingLimit=30;paintLivingMap();renderLiving();}};host()?.addEventListener('change',change);
  const toggle=event=>{if(event.target.matches?.('.dt-conditions'))conditionsOpen=event.target.open;};host()?.addEventListener('toggle',toggle,true);
  return {
    open,
    homeSummary(){return result?{title:currentPreset().title||decisionWorkflowTitle(workflow),covered:result.baseline?.covered,newlyCovered:result.scenario?.newlyCovered,scope:scopeName()}:null;},
    scopeChanged(){if(suppressScope||!regionId)return;if(living){scopeId=api.state.dong||'all';livingLimit=30;paintLivingMap();if(openNow())renderLiving();return;}cancelPick();scopeId=api.state.dong||'all';proposedSites=undefined;excludedServiceIds=[];sites=undefined;result=null;ai=null;if(openNow())calculate();else{controller?.abort();requestId++;busy=false;api.state.enabled.delete(LAYER);api.state.entries.delete(LAYER);api.drawData();}},
    onEvent(message){
      if(message.type==='point'&&message.tool==='decision-site'){
        if(!pick)return true;const point=Array.isArray(message.point)?message.point.slice(0,2):null;
        if(!point||point.length!==2||!point.every(Number.isFinite)||!api.state.scope||!inside(point,api.state.scope)){api.toast('선택 구역 안의 위치를 정해 주세요.');return true;}
        const action=pick;pick=null;document.body.classList.remove('decision-picking');api.send({type:'stop'});
        const id=`planned-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
        if(action.type==='review'){
          const current=currentSites(),next={id:`site-${action.index+1}`,name:`후보지 ${action.index===0?'A':'B'}`,coordinates:point};
          if(action.index===1&&!current[0]){sites=[{...next,id:'site-1',name:'후보지 A'}];api.toast('첫 번째 위치를 후보지 A로 정했습니다. B도 선택할 수 있습니다.');}else{current[action.index]=next;sites=current.filter(Boolean);}
        }else if(action.type==='move')proposedSites=currentProposed().map(p=>p.id===action.id?{...p,name:p.name.replace(/ · 이동$/,'')+' · 이동',coordinates:point}:p);
        else{proposedSites=[...currentProposed(),{id,name:`직접 지정 후보 ${currentProposed().length+1}`,coordinates:point}];maxNew=Math.max(maxNew,proposedSites.length);}
        mapMode='scenario';calculate({reopen:true});return true;
      }
      if(message.type==='select'&&message.layer===LAYER&&living){selectedId=String(message.id||'');if(!selectedId.startsWith('living:'))return true;renderLiving();const node=[...host()?.querySelectorAll('[data-living-card]')||[]].find(item=>item.dataset.livingCard===selectedId);node?.scrollIntoView({block:'nearest',behavior:'smooth'});return true;}
      if(message.type==='select'&&message.layer===LAYER&&result){
        const id=String(message.id||'').replace(/^(target|service|proposed|site):/,'');selectedId=id;render();
        const node=[...host()?.querySelectorAll('[data-decision-card]')||[]].find(item=>item.dataset.decisionCard===id);node?.scrollIntoView({block:'nearest',behavior:'smooth'});return true;
      }
      if(message.type==='ready'&&living)paintLivingMap();else if(message.type==='ready'&&result)paintMap();return false;
    },
    destroy(){destroyed=true;controller?.abort();requestId++;offs.forEach(off=>off());host()?.removeEventListener('submit',handleSubmit);host()?.removeEventListener('change',change);host()?.removeEventListener('toggle',toggle,true);document.body.classList.remove('decision-picking');api.state.enabled.delete(LAYER);api.state.entries.delete(LAYER);},
  };
}
