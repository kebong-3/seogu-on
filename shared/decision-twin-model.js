/** Reproducible spatial comparisons. Counts describe published points, never people or risk. */
import {pointInGeometry} from '../src/admin.js';

export const DECISION_VERSION = 'decision-twin-1';
const EARTH = 6371008.8, RAD = Math.PI / 180;
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const order = (a,b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const text = (value,max=240) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const coordinateOK = p => Array.isArray(p) && p.length===2 && p.every(Number.isFinite) && Math.abs(p[0])<=180 && Math.abs(p[1])<=90;
const coordinateKey = p => p.join(',');
const uniqueLocations = points => new Set(points.map(p=>coordinateKey(p.coordinates))).size;
const fc = features => ({type:'FeatureCollection',features});
const SOURCE_ATTRIBUTE_KEYS=['facilityType','registeredStatus','operationStatus','operationalStatus','capacity','enrolled','ageRange','openingHours','serviceHours','access','installationType','installedYear'];
const sourceAttributes=p=>Object.fromEntries(SOURCE_ATTRIBUTE_KEYS.flatMap(key=>{
  const value=p[key];
  return typeof value==='string'&&value.trim()?[[key,value.trim().slice(0,240)]]:typeof value==='number'&&Number.isFinite(value)?[[key,value]]:[];
}));
const INSPECTION_FIELDS = Object.freeze([
  {key:'loweredCurb',label:'턱낮춤',core:true},
  {key:'tactilePaving',label:'점자블록',core:true},
  {key:'pedestrianSignal',label:'보행자 신호등',core:false},
  {key:'dedicatedLighting',label:'횡단보도 전용조명',core:false},
]);
const failure = (message,code='INVALID_DECISION_REQUEST') => Object.assign(new Error(message),{code,status:400});
const checkedNumber = (v,min,max,fallback,integer=false) => {
  const n=v===undefined?fallback:v;
  if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n))) throw failure(`검토 수치는 ${min}~${max}${integer?' 정수':''} 범위여야 합니다.`);
  return n;
};

export function decisionDistance(a,b) {
  const dLat=(b[1]-a[1])*RAD,dLon=(b[0]-a[0])*RAD;
  const h=Math.sin(dLat/2)**2+Math.cos(a[1]*RAD)*Math.cos(b[1]*RAD)*Math.sin(dLon/2)**2;
  return 2*EARTH*Math.asin(Math.min(1,Math.sqrt(h)));
}

export function normalizeDecisionRequest(raw={},manifest={}) {
  if(!object(raw)) throw failure('검토 요청은 객체여야 합니다.');
  const allowed=new Set(['regionId','workflow','presetId','scopeId','radiusM','maxNew','proposedSites','excludedServiceIds','sites']);
  if(Object.keys(raw).some(k=>!allowed.has(k))) throw failure('지원하지 않는 검토 요청 항목입니다.');
  const workflow=raw.workflow??'coverage';
  if(!['coverage','inspection','site'].includes(workflow)) throw failure('검토 업무를 확인하세요.');
  const presetId=raw.presetId??manifest.defaultPreset;
  const preset=(manifest.presets||[]).find(p=>p.id===presetId);
  if(!preset) throw failure('현재 지역에 등록되지 않은 검토 조건입니다.');
  const scopeId=raw.scopeId??'all';
  if(typeof scopeId!=='string'||!scopeId||scopeId.length>120) throw failure('검토 구역을 확인하세요.');
  const result={workflow,presetId,scopeId,radiusM:checkedNumber(raw.radiusM,50,2000,preset.radiusM??300),maxNew:checkedNumber(raw.maxNew,0,5,3,true)};
  for(const [key,limit] of [['proposedSites',5],['sites',2]]) if(own(raw,key)) {
    if(!Array.isArray(raw[key])||raw[key].length>limit) throw failure(`지도 선택 위치는 ${limit}개까지 사용할 수 있습니다.`);
    const ids=new Set(),locations=new Set();
    result[key]=raw[key].map((site,i)=>{
      if(!object(site)||Object.keys(site).some(k=>!['id','name','coordinates'].includes(k))||!coordinateOK(site.coordinates)) throw failure('지도 위치는 유효한 경도·위도 한 쌍이어야 합니다.');
      const id=site.id===undefined?`${key}-${i+1}`:text(site.id,180);
      if(!id||ids.has(id)) throw failure('지도 위치 식별자는 중복 없이 입력하세요.');
      const keyXY=coordinateKey(site.coordinates);
      if(locations.has(keyXY)) throw failure('같은 위치를 중복 추가할 수 없습니다.');
      ids.add(id);locations.add(keyXY);
      return {id,name:text(site.name,180)||`선택 위치 ${i+1}`,coordinates:[...site.coordinates]};
    });
  }
  const excluded=raw.excludedServiceIds??[];
  if(!Array.isArray(excluded)||excluded.length>100||excluded.some(id=>typeof id!=='string'||!id||id.length>240)||new Set(excluded).size!==excluded.length) throw failure('제외할 기존 시설 식별자를 확인하세요.');
  result.excludedServiceIds=[...excluded].sort(order);
  return result;
}

function prepareDataset(descriptor,raw,regionContains) {
  const metadata=object(raw?.metadata)?raw.metadata:{};
  const features=Array.isArray(raw?.features)?raw.features:[];
  const explicitlyMissing=['not-connected','unavailable','error'].includes(metadata.state)||raw?.type!=='FeatureCollection'||!Array.isArray(raw?.features);
  const complete=metadata.complete===true||descriptor.complete===true;
  const ids=new Set(),points=[];let invalid=0,duplicates=0,nonPoint=0,outsideRegion=0,generatedIds=0;
  if(!explicitlyMissing) for(let index=0;index<features.length;index++) {
    const feature=features[index],geometry=feature?.geometry;
    if(geometry?.type!=='Point'){nonPoint++;continue;}
    const xy=geometry.coordinates?.slice?.(0,2);
    if(!coordinateOK(xy)){invalid++;continue;}
    if(!regionContains(xy)){outsideRegion++;continue;}
    const p=object(feature.properties)?feature.properties:{};
    const original=p.id??feature.id;
    const id=original===undefined?`${descriptor.id}:row-${index+1}`:String(original);
    if(!id||id.length>240){invalid++;continue;}
    if(ids.has(id)){duplicates++;continue;}ids.add(id);
    if(original===undefined)generatedIds++;
    const hasFlags=INSPECTION_FIELDS.some(({key})=>own(p,key));
    const sourceFlags=hasFlags?Object.fromEntries(INSPECTION_FIELDS.map(({key})=>[key,typeof p[key]==='boolean'?p[key]:null])):undefined;
    const sourceRef={datasetId:descriptor.id,featureId:id,name:text(p.sourceName)||text(metadata.sourceName)||descriptor.sourceName||descriptor.title,
      url:text(p.sourceUrl,1000)||text(metadata.sourceUrl,1000)||descriptor.sourceUrl||null,
      date:p.sourceDate||metadata.sourceDate||descriptor.sourceDate||null,
      collectedAt:p.collectedAt||metadata.collectedAt||metadata.retrievedAt||descriptor.collectedAt||null,
      sourceRow:p.sourceRow??index+1};
    points.push({id,name:text(p.name,180)||text(p.facilityName,180)||descriptor.title||id,coordinates:[...xy],sourceRefs:[sourceRef],
      geometryMeaning:text(p.geometryMeaning,400)||null,address:text(p.address,240)||null,
      sourceAttributes:sourceAttributes(p),
      eventYear:p.eventYear??null,sectionSourceId:p.sectionSourceId??null,dongId:p.dongId??null,
      ...(sourceFlags?{sourceFlags}:{})});
  }
  points.sort((a,b)=>order(a.id,b.id));
  const state=explicitlyMissing?'unavailable':points.length?'available':complete&&features.length===0?'empty-complete':'unavailable';
  const sourceStatus={...descriptor,state,complete,rawRecords:features.length,acceptedPoints:points.length,uniqueLocations:new Set(points.map(p=>coordinateKey(p.coordinates))).size,
    invalid,duplicates,nonPoint,outsideRegion,generatedIds,omitted:invalid+duplicates+nonPoint+outsideRegion,
    sourceName:metadata.sourceName||descriptor.sourceName||descriptor.title,
    sourceUrl:metadata.sourceUrl||descriptor.sourceUrl||null,sourceDate:metadata.sourceDate||descriptor.sourceDate||null,
    collectedAt:metadata.collectedAt||metadata.retrievedAt||descriptor.collectedAt||null,
    coverage:metadata.coverage||descriptor.coverage||'수록 자료 기준 · 완전성 미확인',sha256:raw?.sha256||metadata.sha256||descriptor.sha256||null};
  return {points,sourceStatus,available:state!=='unavailable'};
}

function nearestPoint(point,points) {
  let best=null;
  for(const item of points) {
    const distance=decisionDistance(point,item.coordinates);
    if(!best||distance<best.distance||(distance===best.distance&&order(item.id,best.point.id)<0)) best={point:item,distance};
  }
  return best;
}
// Context already identifies its dataset. The nearest feature ID resolves within that source hash.
const nearestOutput = (item,{compactRefs=false}={}) => item?{id:item.point.id,name:item.point.name,distanceM:Math.round(item.distance),...(compactRefs?{}:{coordinates:[...item.point.coordinates],sourceRefs:item.point.sourceRefs||[]})}:null;
const pointFeature = (point,role,displayColor,extra={}) => ({type:'Feature',geometry:{type:'Point',coordinates:[...point.coordinates]},properties:{id:`${role}:${point.id}`,sourceId:point.id,name:point.name,role,displayColor,...extra}});

/** Greedy maximum additional published-point coverage; stable gain, distance, then ID tie breaks. */
function recommend(targets,services,radiusM,maxNew) {
  let uncovered=targets.filter(p=>{const n=nearestPoint(p.coordinates,services);return !n||n.distance>radiusM;});
  const chosen=[],chosenCoordinates=new Set();
  for(let step=0;step<maxNew&&uncovered.length;step++) {
    let best=null;
    for(const target of targets) {
      const key=coordinateKey(target.coordinates);if(chosenCoordinates.has(key))continue;
      const added=uncovered.filter(p=>decisionDistance(target.coordinates,p.coordinates)<=radiusM);
      if(!added.length)continue;
      const locationGain=uniqueLocations(added);
      const existingDistance=nearestPoint(target.coordinates,[...services,...chosen])?.distance??Infinity;
      if(!best||locationGain>best.marginalLocationGain||(locationGain===best.marginalLocationGain&&(added.length>best.targetIds.length||(added.length===best.targetIds.length&&(existingDistance>best.existingDistance||(existingDistance===best.existingDistance&&order(target.id,best.targetId)<0)))))) {
        best={id:`proposal:${target.id}`,targetId:target.id,name:`${target.name} 인근 추가 후보`,coordinates:[...target.coordinates],marginalGain:added.length,marginalLocationGain:locationGain,targetIds:added.map(p=>p.id).sort(order),existingDistance};
      }
    }
    if(!best)break;
    chosenCoordinates.add(coordinateKey(best.coordinates));
    const affected=new Set(best.targetIds);uncovered=uncovered.filter(p=>!affected.has(p.id));
    const {existingDistance,...suggestion}=best;chosen.push(suggestion);
  }
  return chosen;
}

function contextAt(site,descriptors,prepared,radiusM,{includeRows=false}={}) {
  return descriptors.map(descriptor=>{
    const data=prepared.get(descriptor.id);
    if(!data?.available)return {datasetId:descriptor.id,title:descriptor.title,unit:descriptor.unit||'수록 지점',state:'unavailable',count:null,uniqueLocations:null,nearest:null,rows:[]};
    const near=data.points.map(point=>({point,distance:decisionDistance(site.coordinates,point.coordinates)})).filter(p=>p.distance<=radiusM).sort((a,b)=>a.distance-b.distance||order(a.point.id,b.point.id));
    return {datasetId:descriptor.id,title:descriptor.title,unit:descriptor.unit||'수록 지점',state:data.sourceStatus.state,count:near.length,
      uniqueLocations:new Set(near.map(p=>coordinateKey(p.point.coordinates))).size,
      uniqueSections:near.some(p=>p.point.sectionSourceId!==null)?new Set(near.map(p=>p.point.sectionSourceId).filter(v=>v!==null)).size:null,
      nearest:nearestOutput(nearestPoint(site.coordinates,data.points),{compactRefs:true}),
      rowsIncluded:includeRows,rows:includeRows?near.map(({point,distance})=>({...point,distanceM:Math.round(distance)})):[]};
  });
}

// A file hash and count ground aggregate calculations without repeating thousands of row references.
function datasetReference(source) {
  return {datasetId:source?.id,name:source?.sourceName,url:source?.sourceUrl,date:source?.sourceDate||null,
    collectedAt:source?.collectedAt||null,sha256:source?.sha256,records:source?.acceptedPoints,coverage:source?.coverage};
}

function contextEvidence(site,context,prefix,prepared,radiusM) {
  return context.filter(data=>data.count!==null).map(data=>{
    const source=prepared.get(data.datasetId)?.sourceStatus;
    return {id:`${prefix}:${data.datasetId}`,text:`${site.name} 반경 ${radiusM}m의 ${data.title}: 수록 원문 ${data.count}개, 고유 좌표 ${data.uniqueLocations}곳${data.uniqueSections===null?'':`, 구간 식별자 ${data.uniqueSections}개`}.`,sourceRefs:[datasetReference(source)]};
  });
}

function inspectionDetails(point) {
  if(!point.sourceFlags)return {};
  const inspectionFlags=INSPECTION_FIELDS.filter(({key})=>point.sourceFlags[key]!==true).map(({key,label})=>({key,label,
    state:point.sourceFlags[key]===false?'not-installed':'unknown',
    text:point.sourceFlags[key]===false?`${label}: 원문 미설치 표기, 현장 적정성 확인`:`${label}: 원문 설치 여부 미확인, 추가 확인`}));
  return {inspectionFlags,
    inspectionCoreCount:INSPECTION_FIELDS.filter(({key,core})=>core&&point.sourceFlags[key]===false).length,
    inspectionFlagCount:inspectionFlags.filter(f=>f.state==='not-installed').length,
    inspectionUnknownCount:inspectionFlags.filter(f=>f.state==='unknown').length};
}

function inspectionSummary(row) {
  if(!row.inspectionFlags?.length)return '';
  const missing=row.inspectionFlags.filter(f=>f.state==='not-installed').map(f=>f.label);
  const unknown=row.inspectionFlags.filter(f=>f.state==='unknown').map(f=>f.label);
  return `${missing.length?` 원문 미설치 표기: ${missing.join('·')}; 현장 적정성 확인.`:''}${unknown.length?` 원문 미확인: ${unknown.join('·')}.`:''} 미설치 표기만으로 위법·위험·설치 의무를 판단하지 않습니다.`;
}

function sortRows(rows,workflow) {
  const flagPriority=workflow==='inspection'&&rows.some(row=>row.sourceFlags);
  return rows.sort((a,b)=>(flagPriority?((b.inspectionCoreCount||0)-(a.inspectionCoreCount||0)||(b.inspectionFlagCount||0)-(a.inspectionFlagCount||0)):0)
    ||Number(a.baselineCovered)-Number(b.baselineCovered)||((b.nearest?.distanceM??Infinity)-(a.nearest?.distanceM??Infinity)||0)||order(a.id,b.id));
}

/** Marginal gain depends on order. Exclusive gain keeps every other current proposal in place. */
function proposalMetrics(proposals,targets,retained,original,radiusM) {
  const inRadius=(point,services)=>services.some(site=>decisionDistance(point.coordinates,site.coordinates)<=radiusM);
  return proposals.map((proposal,index)=>{
    const nearby=targets.filter(target=>decisionDistance(target.coordinates,proposal.coordinates)<=radiusM);
    const previous=[...retained,...proposals.slice(0,index)];
    const without=[...retained,...proposals.filter((_,i)=>i!==index)];
    const marginal=nearby.filter(target=>!inRadius(target,previous));
    const exclusive=nearby.filter(target=>!inRadius(target,without));
    const baselineNew=nearby.filter(target=>!inRadius(target,original));
    return {...proposal,
      marginalGain:marginal.length,marginalLocationGain:uniqueLocations(marginal),
      exclusiveGain:exclusive.length,exclusiveLocationGain:uniqueLocations(exclusive),
      baselineNewCount:baselineNew.length,baselineNewLocationCount:uniqueLocations(baselineNew)};
  });
}

export function computeDecisionTwin({profile,boundaries,datasets={},manifest,request={},generatedAt=new Date().toISOString()}={}) {
  if(!object(profile)||!object(manifest)||manifest.regionId!==profile.id||(request.regionId!==undefined&&request.regionId!==profile.id)) throw failure('지역 설정과 검토 자료가 일치하지 않습니다.','DECISION_REGION_MISMATCH');
  if(boundaries?.type!=='FeatureCollection'||!Array.isArray(boundaries.features)||!boundaries.features.length) throw failure('검토에 사용할 행정경계가 없습니다.','DECISION_BOUNDARIES_UNAVAILABLE');
  if(boundaries.metadata?.regionId&&boundaries.metadata.regionId!==profile.id) throw failure('행정경계의 지역이 일치하지 않습니다.','DECISION_REGION_MISMATCH');
  if(!Array.isArray(manifest.datasets)||new Set(manifest.datasets.map(d=>d.id)).size!==manifest.datasets.length) throw failure('검토 자료 목록 식별자가 중복되었거나 잘못되었습니다.');
  const normalized=normalizeDecisionRequest(request,manifest),preset=manifest.presets.find(p=>p.id===normalized.presetId);
  const polygonFeatures=boundaries.features.filter(f=>['Polygon','MultiPolygon'].includes(f.geometry?.type));
  const regionContains=p=>polygonFeatures.some(f=>pointInGeometry(p,f.geometry));
  const selected=normalized.scopeId==='all'?null:polygonFeatures.find(f=>String(f.properties?.dongId??f.id)===normalized.scopeId);
  if(normalized.scopeId!=='all'&&!selected) throw failure('현재 지역에 없는 행정구역입니다.','DECISION_SCOPE_MISMATCH');
  const scopeContains=p=>selected?pointInGeometry(p,selected.geometry):regionContains(p);
  const scope={id:normalized.scopeId,name:selected?.properties?.dongName||`${profile.name||profile.id} 전체`};
  for(const point of [...(normalized.proposedSites||[]),...(normalized.sites||[])]) if(!scopeContains(point.coordinates)) throw failure('제안 위치는 선택한 행정구역 안에서 지정하세요.','DECISION_SITE_OUTSIDE_SCOPE');
  const prepared=new Map();
  for(const descriptor of manifest.datasets) {
    const raw=datasets[descriptor.id];
    if(raw?.metadata?.regionId&&raw.metadata.regionId!==profile.id) throw failure('다른 지역의 자료가 포함되어 있습니다.','DECISION_REGION_MISMATCH');
    prepared.set(descriptor.id,prepareDataset(descriptor,raw,regionContains));
  }
  const sourceStatus=[...prepared.values()].map(d=>d.sourceStatus);
  const contextIds=Array.isArray(manifest.contextDatasetIds)?manifest.contextDatasetIds:manifest.datasets.map(d=>d.id);
  const contextDescriptors=manifest.datasets.filter(d=>contextIds.includes(d.id));
  const limitations=['직선거리 가정에 따른 수록 지점 비교이며 실제 보행거리·통행시간·이용인원·위험도·사업 효과를 산정하지 않습니다.',
    '자료에 없는 시설이 실제로 없다는 뜻은 아닙니다. 게시된 위치와 기준일 이후의 변경·현재 개방 여부는 현장 확인 대상입니다.',
    '제안 위치는 비교용 가정입니다. 토지 소유·보도 폭·시설 용량·법정 기준·설치 가능 여부를 확정하지 않습니다.',
    '침수는 과거 원문 기록, 결빙은 관리구간의 수록 시작·종료점입니다. 현재 발생 또는 미래 위험을 뜻하지 않습니다.',
    '대상 수는 원문 관리번호·수록 기록 수입니다. 서로 다른 기록이 같은 좌표에 놓일 수 있으므로 고유 원문 좌표 수를 함께 확인하세요. 고유 좌표도 현장의 별개 시설 수를 확정하지 않습니다.'];
  if(manifest.datasets.some(d=>d.topic==='care'))limitations.push('돌봄시설의 종류·등록상태·정원·현원은 수집한 원문값입니다. 정원에서 현원을 뺀 수를 현재 입소 가능한 자리나 실제 돌봄 수요로 해석하지 않습니다. 이용연령·자격·모집·운영시간은 관리기관에 확인하세요.');
  if(manifest.datasets.some(d=>d.topic==='safety'))limitations.push('보안등·비상벨·경찰시설의 공개 설치위치는 현재 점등·작동·관제 연계나 안전한 이동경로를 보장하지 않습니다. 수록 시설 수나 직선거리로 범죄위험·여성안전 수준을 판정하지 않습니다.');
  const result={version:DECISION_VERSION,regionId:profile.id,workflow:normalized.workflow,preset:{...preset},scope,
    parameters:{radiusM:normalized.radiusM,maxNew:normalized.maxNew,distanceKind:'straight-line',autoProposals:normalized.workflow==='coverage'&&!own(normalized,'proposedSites'),autoSites:normalized.workflow==='site'&&!own(normalized,'sites')},generatedAt,
    status:'ready',baseline:{total:null,covered:null,uncovered:null,totalLocations:null,coveredLocations:null,uncoveredLocations:null},scenario:{covered:null,uncovered:null,newlyCovered:null,lostCovered:null,netChange:null,totalLocations:null,coveredLocations:null,uncoveredLocations:null,newlyCoveredLocations:null,lostCoveredLocations:null,netLocationChange:null,proposedSites:[],excludedServiceIds:normalized.excludedServiceIds},
    rows:[],recommendations:[],sourceStatus,evidence:[],map:{highlight:fc([])},limitations};
  if(normalized.workflow==='site') {
    let sites=normalized.sites;
    if(sites===undefined) {
      const publicDescriptor=manifest.datasets.find(d=>d.path===profile.facilitiesUrl)||manifest.datasets.find(d=>/public|공공공간/.test(`${d.id} ${d.title}`));
      const seen=new Set();sites=(prepared.get(publicDescriptor?.id)?.points||[]).filter(p=>{const key=coordinateKey(p.coordinates);if(!scopeContains(p.coordinates)||seen.has(key))return false;seen.add(key);return true;}).slice(0,2).map(p=>({id:p.id,name:p.name,coordinates:[...p.coordinates],sourceRefs:p.sourceRefs}));
    }
    result.context={sites:sites.map(site=>({...site,datasets:contextAt(site,contextDescriptors,prepared,normalized.radiusM)})),services:[]};
    result.rows=result.context.sites;
    result.baseline.total=sites.length;
    result.baseline.totalLocations=uniqueLocations(sites);
    result.status=!contextDescriptors.some(d=>prepared.get(d.id)?.available)?'unavailable':contextDescriptors.some(d=>!prepared.get(d.id)?.available||!prepared.get(d.id).sourceStatus.complete)?'partial':'ready';
    for(const [index,site] of result.context.sites.entries()) result.evidence.push(...contextEvidence(site,site.datasets,`site:${index}`,prepared,normalized.radiusM));
    const nearbyFeatures=new Map();
    for(const site of result.context.sites)for(const descriptor of contextDescriptors)for(const point of prepared.get(descriptor.id)?.points||[])if(decisionDistance(site.coordinates,point.coordinates)<=normalized.radiusM)nearbyFeatures.set(`${descriptor.id}:${point.id}`,pointFeature(point,`context-${descriptor.id}`,'#386fc0',{datasetId:descriptor.id}));
    result.map.highlight=fc([...nearbyFeatures.values(),...sites.map(p=>pointFeature(p,'site','#7037bc'))]);
    if(!sites.length)result.limitations.push('선택 구역에 기본 위치 후보가 없습니다. 지도에서 검토 위치를 지정하세요.');
    return result;
  }
  const target=prepared.get(preset.target),service=prepared.get(preset.service);
  if(!target||!service)throw failure('검토 조건의 대상 또는 서비스 자료가 등록되지 않았습니다.');
  const targets=target.points.filter(p=>scopeContains(p.coordinates)),services=service.points;
  result.context={services:services.map(({id,name,coordinates})=>({id,name,coordinates:[...coordinates]}))};
  const exclusions=new Set(normalized.excludedServiceIds);
  if([...exclusions].some(id=>!services.some(p=>p.id===id)))throw failure('수록 원자료에 없는 기존 시설을 제외할 수 없습니다.');
  if((normalized.proposedSites||[]).some(p=>services.some(s=>s.id===p.id)))throw failure('제안 위치 식별자를 기존 시설과 다르게 지정하세요.');
  result.baseline.total=target.available?targets.length:null;
  result.baseline.totalLocations=target.available?uniqueLocations(targets):null;
  if(!target.available||!service.available) {
    result.status='unavailable';
    result.limitations.push('대상 또는 서비스 자료가 미연결·빈 부분자료 상태이므로 공백이나 개선량을 0으로 산정하지 않았습니다.');
    result.rows=sortRows(targets.map(p=>({...p,nearest:null,baselineCovered:null,scenarioCovered:null,newlyCovered:null,lostCovered:null,
      ...(normalized.workflow==='inspection'?{...inspectionDetails(p),context:contextAt(p,contextDescriptors,prepared,normalized.radiusM,{includeRows:false})}:{})})),normalized.workflow);
    if(normalized.workflow==='inspection')for(const [index,row] of result.rows.entries()){
      if(row.sourceFlags)result.evidence.push({id:`target:${row.id}`,text:`${row.name}.${inspectionSummary(row)}`,sourceRefs:row.sourceRefs});
      if(index<10)result.evidence.push(...contextEvidence(row,row.context,`target:${row.id}:context`,prepared,normalized.radiusM));
    }
    result.map.highlight=fc(result.rows.map(p=>pointFeature(p,'target','#6d8593')));
    return result;
  }
  const retained=services.filter(p=>!exclusions.has(p.id));
  result.recommendations=normalized.workflow==='coverage'?recommend(targets,retained,normalized.radiusM,normalized.maxNew):[];
  const selectedProposals=own(normalized,'proposedSites')?normalized.proposedSites:result.recommendations.map(({id,name,coordinates})=>({id,name,coordinates}));
  const proposals=proposalMetrics(selectedProposals,targets,retained,services,normalized.radiusM);
  const combined=[...retained,...proposals];
  let baselineCovered=0,scenarioCovered=0,newlyCovered=0,lostCovered=0;
  const rows=targets.map(point=>{
    const before=nearestPoint(point.coordinates,services),after=nearestPoint(point.coordinates,combined);
    const b=!!before&&before.distance<=normalized.radiusM,a=!!after&&after.distance<=normalized.radiusM;
    baselineCovered+=Number(b);scenarioCovered+=Number(a);newlyCovered+=Number(a&&!b);lostCovered+=Number(b&&!a);
    const row={...point,nearest:nearestOutput(before),scenarioNearest:nearestOutput(after),baselineCovered:b,scenarioCovered:a,newlyCovered:a&&!b,lostCovered:b&&!a,
      reasons:[{code:b?'within-published-service-radius':'outside-published-service-radius',evidenceIds:[`target:${point.id}`]}]};
    if(normalized.workflow==='inspection') {
      Object.assign(row,inspectionDetails(point));
      row.context=contextAt(point,contextDescriptors,prepared,normalized.radiusM,{includeRows:false});
      if(row.inspectionFlagCount>0)row.reasons.unshift({code:'source-not-installed',text:'원문 미설치 표기, 현장 적정성 확인',keys:row.inspectionFlags.filter(f=>f.state==='not-installed').map(f=>f.key),evidenceIds:[`target:${point.id}`]});
      if(row.inspectionUnknownCount>0)row.reasons.push({code:'source-installation-unknown',text:'원문 설치 여부 미확인',keys:row.inspectionFlags.filter(f=>f.state==='unknown').map(f=>f.key),evidenceIds:[`target:${point.id}`]});
    }
    return row;
  });
  sortRows(rows,normalized.workflow);
  result.rows=rows;
  const totalLocations=uniqueLocations(targets),baselineLocations=uniqueLocations(rows.filter(r=>r.baselineCovered)),scenarioLocations=uniqueLocations(rows.filter(r=>r.scenarioCovered));
  result.baseline={total:targets.length,covered:baselineCovered,uncovered:targets.length-baselineCovered,totalLocations,coveredLocations:baselineLocations,uncoveredLocations:totalLocations-baselineLocations};
  result.scenario={covered:scenarioCovered,uncovered:targets.length-scenarioCovered,newlyCovered,lostCovered,netChange:scenarioCovered-baselineCovered,
    totalLocations,coveredLocations:scenarioLocations,uncoveredLocations:totalLocations-scenarioLocations,newlyCoveredLocations:uniqueLocations(rows.filter(r=>r.newlyCovered)),lostCoveredLocations:uniqueLocations(rows.filter(r=>r.lostCovered)),netLocationChange:scenarioLocations-baselineLocations,
    proposedSites:proposals,excludedServiceIds:normalized.excludedServiceIds};
  result.status=![target,service].every(d=>d.sourceStatus.complete)||(normalized.workflow==='inspection'&&contextDescriptors.some(d=>!prepared.get(d.id)?.available))?'partial':'ready';
  const sourceRefs=[datasetReference(target.sourceStatus),datasetReference(service.sourceStatus)];
  result.evidence.push({id:'coverage:baseline',text:`${scope.name}의 수록 대상 ${targets.length}개(원문 고유 좌표 ${totalLocations}곳) 중 기존 서비스 지점과 직선 ${normalized.radiusM}m 이내 ${baselineCovered}개(${baselineLocations}좌표), 밖 ${targets.length-baselineCovered}개(${totalLocations-baselineLocations}좌표).`,sourceRefs},
    {id:'coverage:scenario',text:`기존 ${exclusions.size}개 제외·비교 위치 ${proposals.length}개 추가 가정에서 반경 내 ${scenarioCovered}개(${scenarioLocations}좌표). 새로 포함 ${newlyCovered}개(${result.scenario.newlyCoveredLocations}좌표), 제외 ${lostCovered}개(${result.scenario.lostCoveredLocations}좌표), 순변화 ${scenarioCovered-baselineCovered}개(${result.scenario.netLocationChange}좌표).`,sourceRefs});
  for(const proposal of proposals)result.evidence.push({id:`proposal:${proposal.id}`,text:`${proposal.name}: 현재 배열 순서에서 추가 연결 ${proposal.marginalGain}개(${proposal.marginalLocationGain}좌표). 다른 제안을 모두 유지하고 이 후보만 제외하면 조건 밖이 되는 대상 ${proposal.exclusiveGain}개(${proposal.exclusiveLocationGain}좌표). 기존 전체시설 조건 밖이면서 이 후보 반경 안인 대상 ${proposal.baselineNewCount}개(${proposal.baselineNewLocationCount}좌표, 후보 간 중복 가능).`,sourceRefs});
  for(const row of rows)result.evidence.push({id:`target:${row.id}`,text:`${row.name}: 기존 서비스 ${row.nearest?`최근접 직선 ${row.nearest.distanceM}m`:'수록 지점 없음'}, 기준 반경 ${normalized.radiusM}m ${row.baselineCovered?'안':'밖'}.${inspectionSummary(row)}`,sourceRefs:[...row.sourceRefs,...(row.nearest?.sourceRefs||[])]});
  if(normalized.workflow==='inspection'&&rows.some(row=>row.sourceFlags))result.limitations.push('횡단보도 점검 목록은 원문의 턱낮춤·점자블록 미설치 표기를 우선 확인 대상으로 정렬합니다. 신호등·조명 미설치만으로 위법·위험·시설 설치 의무를 판단하지 않습니다.');
  if(normalized.workflow==='inspection')for(const row of rows.slice(0,10))result.evidence.push(...contextEvidence(row,row.context,`target:${row.id}:context`,prepared,normalized.radiusM));
  if(normalized.workflow==='inspection'&&rows.length>10)result.limitations.push('주변자료 상세 근거문은 목록의 처음 10개 대상에 수록합니다. 전체 대상의 반경 내 집계·최근접 위치와 자료 해시는 각 행의 주변자료와 자료목록에 보존합니다.');
  const mapServiceIds=new Set([...rows.flatMap(row=>[row.nearest?.id,row.scenarioNearest?.id]),...normalized.excludedServiceIds].filter(Boolean));
  const highlights=[...rows.map(p=>pointFeature(p,'target',p.lostCovered?'#c73537':p.newlyCovered?'#087c66':p.baselineCovered?'#6d8593':'#b95516',{baselineCovered:p.baselineCovered,scenarioCovered:p.scenarioCovered})),
    ...services.filter(p=>mapServiceIds.has(p.id)).map(p=>pointFeature(p,exclusions.has(p.id)?'excluded-service':'service',exclusions.has(p.id)?'#a45656':'#386fc0')),
    ...proposals.map(p=>pointFeature(p,'proposal','#7037bc'))];
  result.map.highlight=fc(highlights);
  return result;
}
