#!/usr/bin/env node
/**
 * Public sample evaluation. Offline by default; never reads provider keys.
 * Local calls exercise production code, with no substituted model/provider response.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {loadWalkCandidates} from '../server/walk-candidates.js';
import {searchWalkPlaces} from '../server/walk-place-search.js';
import {runWalkRoutes} from '../server/walk-routes.js';
import {handleAsk,resetAskLimits} from '../server/ai/ask.js';
import {pointInRegion} from '../shared/region-profile.js';
import {walkDistance,rankWalkCandidates,walkCandidateSupportsMode} from '../shared/walk-route-model.js';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const SUITE_PATH=resolve(ROOT,'public/data/evaluation/walk-questions.json');
const PUBLIC=resolve(ROOT,'public');
const KINDS=new Set(['manual','search','care','boundary','route-input','prefilter','ask']);
const OPS=new Set(['eq','gte','lte','includes','notIncludes','oneOf']);
const SHA=bytes=>createHash('sha256').update(bytes).digest('hex');
const round=n=>Math.round(n*100)/100;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const string=v=>typeof v==='string'?v:'';
const publicUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));

export function validateSuite(suite) {
  if(suite?.schemaVersion!==1||!suite.suiteId||!suite.suiteVersion||!Array.isArray(suite.cases)||suite.cases.length!==50)throw Error('평가 묶음은 schemaVersion 1과 서로 다른 50개 상황을 가져야 합니다.');
  const ids=new Set();
  for(const c of suite.cases){
    if(!/^[a-z]+-\d{2}$/.test(c.id)||ids.has(c.id))throw Error('중복되거나 잘못된 평가 ID입니다.');
    ids.add(c.id);
    if(!c.category||!c.title||typeof c.question!=='string'||!KINDS.has(c.local?.kind)||!Array.isArray(c.manualReview))throw Error(c.id+': 평가 상황 형식 오류');
    for(const mode of ['local','live']){
      if(!Array.isArray(c.expected?.[mode]))throw Error(c.id+': 코드로 확인할 조건이 필요합니다.');
      for(const rule of c.expected[mode])if(!rule.field||!OPS.has(rule.op)||!own(rule,'value'))throw Error(c.id+': 알 수 없는 검사 조건');
    }
    const ev=c.expected.evidence;
    if(!ev||typeof ev.required!=='boolean'||!Number.isInteger(ev.minimumRecords)||ev.minimumRecords<0||!Array.isArray(ev.fields)||!Array.isArray(ev.entities)||ev.fields.some(f=>!['name','url','date'].includes(f)))throw Error(c.id+': 근거 조건 형식 오류');
    if(c.local.kind==='manual'&&(!c.manualReview.length||c.expected.local.length))throw Error(c.id+': 수동 항목을 자동 통과할 수 없습니다.');
    if(c.live&&!['search','ask'].includes(c.live.kind))throw Error(c.id+': 라이브 호출은 검색과 ask만 허용합니다.');
    if(c.live?.body&&Object.keys(c.live.body).some(key=>key!=='question'))throw Error(c.id+': 라이브 본문에 인증정보나 임의 옵션을 넣을 수 없습니다.');
  }
  return suite;
}

export async function loadSuite(path=SUITE_PATH){
  const bytes=await readFile(path);
  return {suite:validateSuite(JSON.parse(bytes)),sha256:SHA(bytes)};
}

export function validateBaseUrl(value){
  let url;try{url=new URL(value);}catch{throw Error('--base-url에는 배포 주소가 필요합니다.');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(!(url.protocol==='https:'||(url.protocol==='http:'&&local))||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('배포 주소는 인증정보·경로·질의 없는 HTTPS origin 또는 로컬 HTTP origin이어야 합니다.');
  return url.origin;
}

export function parseArgs(args){
  const options={live:false,baseUrl:null,caseIds:[],timeoutMs:30000,intervalMs:6500,appVersion:null,jsonPath:null,csvPath:null};
  const valued=new Map([['--base-url','baseUrl'],['--case','caseIds'],['--timeout-ms','timeoutMs'],['--interval-ms','intervalMs'],['--app-version','appVersion'],['--json','jsonPath'],['--csv','csvPath']]);
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--help'){options.help=true;continue;}
    if(arg==='--live'){options.live=true;continue;}
    if(!valued.has(arg)||!args[i+1]||args[i+1].startsWith('--'))throw Error('알 수 없거나 값이 빠진 옵션: '+arg);
    const key=valued.get(arg),value=args[++i];
    options[key]=key==='caseIds'?value.split(',').filter(Boolean):['timeoutMs','intervalMs'].includes(key)?Number(value):value;
  }
  if(options.live!==!!options.baseUrl)throw Error('실제 호출에는 --live와 --base-url을 함께 명시하세요.');
  if(options.baseUrl)options.baseUrl=validateBaseUrl(options.baseUrl);
  if(!Number.isInteger(options.timeoutMs)||options.timeoutMs<100||options.timeoutMs>60000)throw Error('timeout-ms 범위는 100~60000입니다.');
  if(!Number.isInteger(options.intervalMs)||options.intervalMs<6500||options.intervalMs>60000)throw Error('ask 호출 간격 interval-ms는 6500~60000입니다. 제한을 우회하지 않습니다.');
  if(options.appVersion!==null&&(!options.live||!options.appVersion.trim()||options.appVersion.length>160))throw Error('--app-version은 실제 배포 실행의 운영자 기록값입니다(1~160자).');
  if(options.jsonPath&&options.csvPath&&resolve(options.jsonPath)===resolve(options.csvPath))throw Error('JSON과 CSV 저장 경로는 달라야 합니다.');
  return options;
}

function fieldValue(facts,path){return path.split('.').reduce((value,key)=>value?.[key],facts);}
export function evaluateChecks(facts,rules){
  return rules.map(rule=>{
    const actual=fieldValue(facts,rule.field),expected=rule.value;
    let pass=false;
    if(rule.op==='eq')pass=JSON.stringify(actual)===JSON.stringify(expected);
    if(rule.op==='gte')pass=typeof actual==='number'&&actual>=expected;
    if(rule.op==='lte')pass=typeof actual==='number'&&actual<=expected;
    if(rule.op==='oneOf')pass=Array.isArray(expected)&&expected.includes(actual);
    if(rule.op==='includes')pass=(Array.isArray(actual)||typeof actual==='string')&&actual.includes(expected);
    if(rule.op==='notIncludes')pass=(Array.isArray(actual)||typeof actual==='string')&&!actual.includes(expected);
    return {...rule,actual:actual??null,pass};
  });
}

function evidenceRecord(source,entity=null){
  const record={entity,name:source?.sourceName??source?.name??null,url:source?.sourceUrl??source?.url??null};
  if(own(source||{},'sourceDate'))record.date=source.sourceDate;
  else if(own(source||{},'date'))record.date=source.date;
  return record;
}
export function auditEvidence(records,expected){
  const chosen=expected.entities.length?records.filter(r=>expected.entities.includes(r.entity)):records;
  const missingEntities=expected.entities.filter(name=>!chosen.some(r=>r.entity===name));
  const missingFields=[];
  for(const [index,r]of chosen.entries())for(const field of expected.fields){
    const valid=field==='date'?own(r,'date')&&(r.date===null||typeof r.date==='string'&&r.date.length>0):field==='url'?publicUrl(r.url):typeof r.name==='string'&&r.name.trim().length>0;
    if(!valid)missingFields.push({record:index,entity:r.entity,field});
  }
  const missing=expected.required&&(chosen.length<expected.minimumRecords||missingFields.length>0||missingEntities.length>0);
  return {required:expected.required,recordCount:chosen.length,minimumRecords:expected.minimumRecords,missing,missingEntities,missingFields,
    unknownDateRecords:chosen.filter(r=>own(r,'date')&&r.date===null).length,
    missingUrlRecords:chosen.filter(r=>!publicUrl(r.url)).length,
    limitation:'필드 존재·형식 검사입니다. 출처 내용의 정확성·최신성·주장과의 일치는 수동심사가 필요합니다.'};
}

async function createLocalContext(){
  let networkCalls=0;
  const noNetwork=()=>{networkCalls++;throw Object.assign(Error('오프라인 평가의 외부 호출 차단'),{code:'EVALUATION_NETWORK_BLOCKED'});};
  const packs=new Map();
  const pack=async region=>{if(!packs.has(region))packs.set(region,loadWalkCandidates({regionId:region,env:{},publicRoot:PUBLIC}));return packs.get(region);};
  let carePromise;
  const care=()=>{
    if(!carePromise)carePromise=(async()=>{
      const manifest=await readJSON(resolve(PUBLIC,'data/decision/seogu/manifest.json'));
      const dirPath=resolve(PUBLIC,'data/decision/seogu/care-directory.json'),directoryBytes=await readFile(dirPath),directory=JSON.parse(directoryBytes);
      const entries=directory.entries,mapped=entries.filter(e=>Array.isArray(e.coordinates)),unlocated=entries.filter(e=>e.coordinates===null);
      const descriptors=manifest.datasets.filter(d=>d.id.startsWith('care-'));
      const datasets=await Promise.all(descriptors.map(async d=>{
        if(!/^\/data\/decision\/seogu\/care-[a-z-]+\.geojson$/.test(d.path))throw Error('예상 밖 돌봄 자료 경로');
        const bytes=await readFile(resolve(PUBLIC,d.path.slice(1)));return {descriptor:d,sha256:SHA(bytes),features:JSON.parse(bytes).features};
      }));
      const byId=new Map(datasets.flatMap(d=>d.features.map(f=>[f.properties.id,f])));
      const candidates=(await pack('seogu')).candidates;
      const unverifiedIds=new Set(unlocated.map(e=>e.id));
      const representatives=mapped.filter(e=>e.locationStatus==='address_reference');
      return {
        facts:{total:entries.length,mapped:mapped.length,unlocated:unlocated.length,
          countsConsistent:directory.total===entries.length&&directory.mapped===mapped.length&&directory.unlocated===unlocated.length&&mapped.length+unlocated.length===entries.length,
          unlocatedCandidateCount:candidates.filter(c=>unverifiedIds.has(c.sourceId)).length,
          unverifiedNames:unlocated.map(e=>e.name),representativeCount:representatives.length,
          representativesHaveNote:representatives.every(e=>typeof e.geometryMeaning==='string'&&e.geometryMeaning.includes('대표')),
          categoryCounts:entries.reduce((counts,e)=>(counts[e.category]=(counts[e.category]||0)+1,counts),{}),
          unknownSourceDates:entries.filter(e=>e.sourceDate===null).length,
          allHaveSourceDateField:entries.every(e=>own(e,'sourceDate')),
          allHaveSource:entries.every(e=>e.sourceName&&publicUrl(e.sourceUrl)),
          uniqueIds:new Set(entries.map(e=>e.id)).size===entries.length,
          mappedCoordinatesMatch:byId.size===mapped.length&&mapped.every(e=>JSON.stringify(e.coordinates)===JSON.stringify(byId.get(e.id)?.geometry.coordinates)),
          careDatasetCount:datasets.length,hashMismatchCount:datasets.filter(d=>d.sha256!==d.descriptor.sha256).length,
          directoryHashMatches:SHA(directoryBytes)===manifest.careDirectorySha256},
        evidence:entries.map(e=>evidenceRecord(e,e.name)),snapshots:[{path:'/data/decision/seogu/care-directory.json',sha256:SHA(directoryBytes)},...datasets.map(d=>({path:d.descriptor.path,sha256:d.sha256}))]};
    })();
    return carePromise;
  };
  return {noNetwork,pack,care,networkCount:()=>networkCalls};
}

function publicPair(pack){
  const start=pack.candidates.find(c=>c.category==='public'&&c.routeEligible);
  const end=pack.candidates.find(c=>c.category==='public'&&c.routeEligible&&walkDistance(start.coordinate,c.coordinate)>1000&&walkDistance(start.coordinate,c.coordinate)<4000);
  if(!start||!end)throw Error('평가용 공개시설 두 곳을 찾지 못했습니다.');
  return {start:[...start.coordinate],end:[...end.coordinate],sampleFacilities:[{id:start.id,name:start.name},{id:end.id,name:end.name}]};
}
function responseFacts(body,status,pack){
  const items=body.items||[],features=body.map?.highlight?.features||[];
  return {httpStatus:status,ok:body.ok??false,code:body.code??null,mode:body.mode??null,
    provider:body.provider??null,model:body.model??null,answer:string(body.answer),answerPresent:!!string(body.answer).trim(),
    stepCount:body.steps?.length??0,stepTools:(body.steps||[]).map(s=>s.tool),sourceCount:body.sources?.length??0,
    entityNames:body.items?items.map(i=>i.name):features.map(f=>f.properties?.name).filter(Boolean),
    itemCount:items.length,providerAvailable:body.providerAvailable??null,
    allInRegion:body.items?items.every(item=>pointInRegion(item.coordinate,pack.boundaries)):null};
}
function responseEvidence(body){
  return body.items?body.items.map(item=>evidenceRecord(item,item.name)):(body.sources||[]).map(source=>evidenceRecord(source));
}
async function localObservation(c,ctx){
  const before=ctx.networkCount(),kind=c.local.kind;
  if(kind==='care')return ctx.care();
  const pack=await ctx.pack('seogu');
  if(kind==='search'){
    try{const body=await searchWalkPlaces(c.local.query,pack,{env:{},fetcher:ctx.noNetwork});return {facts:{...responseFacts(body,200,pack),networkCalls:ctx.networkCount()-before},evidence:responseEvidence(body)};}
    catch(error){return {facts:{httpStatus:error.status||500,code:error.code||'LOCAL_ERROR',networkCalls:ctx.networkCount()-before},evidence:[]};}
  }
  if(kind==='boundary'){
    const other=await ctx.pack(c.local.region),points=other.candidates.filter(p=>p.category==='public'&&p.routeEligible).map(p=>p.coordinate);
    return {facts:{sampleCount:points.length,allInsideSeogu:points.every(p=>pointInRegion(p,pack.boundaries)),anyInsideSeogu:points.some(p=>pointInRegion(p,pack.boundaries))},evidence:[]};
  }
  if(kind==='route-input'){
    const pair=publicPair(pack);
    try{await runWalkRoutes({regionId:'seogu',mode:'shade',start:pair.start,end:pair.end,avoidStairs:false,viaIds:[],...c.local.patch},{env:{},fetcher:ctx.noNetwork,publicRoot:PUBLIC});return {facts:{code:null,networkCalls:ctx.networkCount()-before,sampleFacilities:pair.sampleFacilities},evidence:[]};}
    catch(error){return {facts:{code:error.code||'LOCAL_ERROR',httpStatus:error.status||500,networkCalls:ctx.networkCount()-before,sampleFacilities:pair.sampleFacilities},evidence:[]};}
  }
  if(kind==='prefilter'){
    const pair=publicPair(pack),items=rankWalkCandidates(pack.candidates,{start:pair.start,end:pair.end,mode:c.local.mode,limit:2});
    return {facts:{itemCount:items.length,categories:items.map(i=>i.category),allEligibleForMode:items.every(i=>walkCandidateSupportsMode(i,c.local.mode)),
      distinctCoordinates:new Set(items.map(i=>i.coordinate.join(','))).size===items.length,allSelectionBasisExplicit:items.every(i=>['straight-line-prefilter','straight-line-side-diversity'].includes(i.selectionBasis)),
      sampleFacilities:pair.sampleFacilities,selectedIds:items.map(i=>i.id)},evidence:items.map(i=>evidenceRecord(i,i.name))};
  }
  if(kind==='ask'){
    // In-process HTTP adapter runs the actual handler; it supplies no generated/model answer.
    resetAskLimits();
    const res={statusCode:200,setHeader(){},end(text){this.body=JSON.parse(text);}};
    await handleAsk({method:'POST',url:'/api/ask',headers:{host:'evaluation.local',origin:'https://evaluation.local','content-type':'application/json'},body:{regionId:'seogu',question:c.question,...c.local.body}},res,{env:{},fetcher:ctx.noNetwork,weatherFetcher:ctx.noNetwork});
    return {facts:{...responseFacts(res.body,res.statusCode,pack),networkCalls:ctx.networkCount()-before},evidence:responseEvidence(res.body),body:res.body};
  }
  throw Error('지원하지 않는 로컬 검사');
}

async function requestJson(base,path,{method='GET',body,fetcher,timeoutMs}){
  const started=performance.now();
  try{
    const response=await fetcher(new URL(path,base),{method,redirect:'error',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json',Origin:base}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeoutMs)});
    const text=await response.text();
    if(text.length>3*1024*1024)throw Object.assign(Error('평가 응답 크기 제한'),{code:'RESPONSE_TOO_LARGE'});
    let data;try{data=JSON.parse(text);}catch{throw Object.assign(Error('JSON 응답이 아님'),{code:'NON_JSON_RESPONSE'});}
    return {httpStatus:response.status,body:data,latencyMs:round(performance.now()-started),error:null};
  }catch(error){
    // Do not persist raw upstream errors, URLs, headers, or credentials.
    return {httpStatus:null,body:null,latencyMs:round(performance.now()-started),error:{code:error?.name==='TimeoutError'?'TIMEOUT':error?.code==='NON_JSON_RESPONSE'?'NON_JSON_RESPONSE':error?.code==='RESPONSE_TOO_LARGE'?'RESPONSE_TOO_LARGE':'REQUEST_FAILED'}};
  }
}
function costFromResponse(body){
  const value=body?.usage?.cost;
  return value&&Number.isFinite(value.amount)&&value.amount>=0&&typeof value.currency==='string'&&value.currency?{amount:value.amount,currency:value.currency,source:'response.usage.cost'}:null;
}
function modelObservation(body,execution){
  const mode=body?.mode??null,model=typeof body?.model==='string'&&body.model?body.model:null,provider=typeof body?.provider==='string'&&body.provider?body.provider:null;
  return {mode,model,provider,rulesFallback:mode==='rules',fallbackCode:mode==='rules'?body.code??null:null,
    executed:execution==='live_api'&&mode==='llm',
    identified:mode==='llm'&&!!model&&!!provider,
    displayMissing:mode==='llm'?!(model&&provider):mode==='rules'?!string(body.notice).includes('AI 미사용'):false,
    evidenceBasis:execution==='live_api'?'서버 응답의 실행모드·모델 표기; 제공기관 과금내역 독립 검증은 아님':'외부 AI를 호출하지 않은 로컬 기능검사'};
}
function percentile(values,p){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.ceil(sorted.length*p)-1];}

export function summarize(rows,modelTargets){
  const executed=rows.filter(r=>r.status!=='not_executed'),live=rows.filter(r=>r.execution==='live_api'&&r.latencyMs!==null);
  const checked=rows.filter(r=>['pass','fail'].includes(r.status));
  return {caseCount:rows.length,automaticPassed:rows.filter(r=>r.status==='pass').length,automaticFailed:rows.filter(r=>r.status==='fail').length,
    errors:rows.filter(r=>r.status==='error').length,notExecuted:rows.filter(r=>r.status==='not_executed').length,
    manualPending:rows.filter(r=>r.manualReview.status==='pending').length,
    automaticPassRate:checked.length?round(checked.filter(r=>r.status==='pass').length/checked.length):null,
    evidenceChecked:executed.filter(r=>r.evidenceAudit?.required).length,evidenceMissing:executed.filter(r=>r.evidenceAudit?.missing).length,
    modelDisplayMissing:rows.filter(r=>r.model?.displayMissing).length,
    rulesFallback:rows.filter(r=>r.model?.rulesFallback).length,liveRulesFallback:live.filter(r=>r.model?.rulesFallback).length,
    liveRequests:live.length,liveHttpErrors:live.filter(r=>r.httpStatus!==null&&r.httpStatus>=400).length,liveTransportErrors:live.filter(r=>r.transportError).length,
    liveLatencyMs:{p50:percentile(live.map(r=>r.latencyMs),0.5),p95:percentile(live.map(r=>r.latencyMs),0.95),sampleCount:live.length},
    models:modelTargets.map(target=>{
      const responses=live.filter(r=>r.model?.executed&&r.model?.provider===target.provider&&r.model?.model===target.model);
      return {...target,status:responses.length?'executed':'not_executed',statusLabel:responses.length?'실행':'미실행',responses:responses.length,
        reason:responses.length?'실제 API 응답이 해당 모델·provider를 표시함':'해당 모델의 실제 응답 없음. 키 없는 검사·규칙 응답·다른 모델을 모델 성능으로 세지 않음'};
    }),
    unrecognizedModelResponses:live.filter(r=>r.model?.executed&&!modelTargets.some(t=>t.provider===r.model.provider&&t.model===r.model.model)).length,
    cost:null,costNote:'비용은 응답별 제공값만 기록합니다. 미제공·혼합 통화의 총비용은 추정하지 않습니다.',
    conclusion:'자동검사 통과는 전체 품질·현장 안전·사용자 업무효과 또는 AI 정확도 점수가 아닙니다. 수동심사 미완료 항목을 확인하세요.'};
}

export async function runEvaluation(options={}){
  const live=options.live===true;
  if(live!==!!options.baseUrl)throw Error('실제 호출에는 live와 baseUrl을 함께 지정해야 합니다.');
  const base=live?validateBaseUrl(options.baseUrl):null;
  const timeoutMs=options.timeoutMs??30000,intervalMs=options.intervalMs??6500;
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000||!Number.isInteger(intervalMs)||intervalMs<6500||intervalMs>60000)throw Error('평가 시간 제한 범위를 확인하세요.');
  const loaded=await loadSuite(),selected=options.caseIds?.length?loaded.suite.cases.filter(c=>options.caseIds.includes(c.id)):loaded.suite.cases;
  if(options.caseIds?.some(id=>!selected.some(c=>c.id===id)))throw Error('평가 묶음에 없는 case ID입니다.');
  const startedAt=new Date().toISOString(),pkg=await readJSON(resolve(ROOT,'package.json')),ctx=await createLocalContext(),rows=[];
  const fetcher=globalThis.fetch,wait=ms=>new Promise(r=>setTimeout(r,ms));
  let lastAsk=0,health=null,externalRequests=0;
  if(live){
    externalRequests++;
    const h=await requestJson(base,'/api/config',{fetcher,timeoutMs});
    health={checkedAt:new Date().toISOString(),httpStatus:h.httpStatus,latencyMs:h.latencyMs,error:h.error,
      configVersion:h.body?.version??null,configured:h.body?{vworldRest:h.body.vworldRest===true,weather:h.body.weather===true}:null,
      meaning:'일회성 설정 응답 확인입니다. 인증 성공·정상 가동률·경로 품질·모델 건강상태를 보장하지 않습니다.'};
  }
  for(const c of selected){
    const execution=live?'live_api':'local_deterministic',manualReview={status:c.manualReview.length?'pending':'not_required',criteria:c.manualReview,reviewer:null,reviewedAt:null,result:null};
    const baseRow={id:c.id,category:c.category,title:c.title,question:c.question,checkedAt:new Date().toISOString(),execution,
      simulation:false,status:'not_executed',latencyMs:null,httpStatus:null,transportError:null,facts:null,checks:[],evidenceAudit:null,evidence:[],model:null,cost:null,manualReview};
    if(c.local.kind==='manual'||live&&!c.live){
      rows.push({...baseRow,execution:'not_executed',reason:c.local.kind==='manual'?'실제 화면·기기·현장조건에 대한 수동심사 필요':'이 항목은 로컬 결정론적 검사입니다. 로컬 실행 결과와 별도로 기록하세요.'});continue;
    }
    const start=performance.now();
    try{
      let observation;
      if(live){
        if(c.live.kind==='ask'){
          const remaining=intervalMs-(Date.now()-lastAsk);
          if(remaining>0)await wait(remaining);
          lastAsk=Date.now();
        }
        const path=c.live.kind==='search'?'/api/walk-routes?region=seogu&q='+encodeURIComponent(c.live.query):'/api/ask';
        externalRequests++;
        const response=await requestJson(base,path,{method:c.live.kind==='ask'?'POST':'GET',
          ...(c.live.kind==='ask'?{body:{regionId:'seogu',question:c.live.body?.question??c.question}}:{}),fetcher,timeoutMs});
        if(response.error){rows.push({...baseRow,status:'error',latencyMs:response.latencyMs,transportError:response.error,reason:'실제 HTTP 응답을 평가하지 못했습니다.'});continue;}
        const pack=await ctx.pack('seogu');
        observation={facts:responseFacts(response.body,response.httpStatus,pack),body:response.body,evidence:responseEvidence(response.body),latencyMs:response.latencyMs};
      }else observation=await localObservation(c,ctx);
      const checks=evaluateChecks(observation.facts,c.expected[live?'live':'local']),evidenceAudit=auditEvidence(observation.evidence||[],c.expected.evidence);
      const model=modelObservation(observation.body,execution),pass=checks.every(check=>check.pass)&&!evidenceAudit.missing&&!model.displayMissing;
      rows.push({...baseRow,status:pass?'pass':'fail',latencyMs:observation.latencyMs??round(performance.now()-start),httpStatus:observation.facts.httpStatus??null,
        facts:observation.facts,checks,evidenceAudit,evidence:observation.evidence||[],model,cost:costFromResponse(observation.body),
        ...(observation.snapshots?{dataSnapshots:observation.snapshots}:{})});
    }catch(error){
      rows.push({...baseRow,status:'error',latencyMs:round(performance.now()-start),reason:'로컬 자료 또는 검사 실행 실패',errorCode:typeof error?.code==='string'?error.code:'EVALUATION_ERROR'});
    }
  }
  return {schemaVersion:1,suiteId:loaded.suite.suiteId,suiteVersion:loaded.suite.suiteVersion,suiteSha256:loaded.sha256,
    startedAt,finishedAt:new Date().toISOString(),execution:live?'live_api':'local_deterministic',simulation:false,
    evaluator:{nodeVersion:process.version,localAppVersion:pkg.version,localAppVersionSource:'package.json'},
    deployment:live?{origin:base,appVersion:options.appVersion??null,versionSource:options.appVersion?'operator_declared_not_independently_verified':'not_provided'}:null,
    selectedCaseIds:selected.map(c=>c.id),network:{externalRequests,blockedOfflineAttempts:ctx.networkCount()},
    health,summary:summarize(rows,loaded.suite.modelTargets),rows};
}

const csvCell=value=>{
  let text=value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
  // Spreadsheet import must not execute a question or model response as a formula.
  if(/^[\s]*[=+\-@]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
};
export function toCsv(report){
  const columns=['suiteId','suiteVersion','suiteSha256','startedAt','localAppVersion','deploymentAppVersion','id','category','execution','simulation','status','httpStatus','latencyMs','mode','provider','model','rulesFallback','fallbackCode','evidenceMissing','manualStatus','costAmount','costCurrency','failedChecks','errorCode','manualCriteria','answer'];
  const lines=report.rows.map(r=>[report.suiteId,report.suiteVersion,report.suiteSha256,report.startedAt,report.evaluator.localAppVersion,report.deployment?.appVersion,r.id,r.category,r.execution,r.simulation,r.status,r.httpStatus,r.latencyMs,r.model?.mode,r.model?.provider,r.model?.model,r.model?.rulesFallback,r.model?.fallbackCode,r.evidenceAudit?.missing,r.manualReview.status,r.cost?.amount,r.cost?.currency,r.checks.filter(c=>!c.pass),r.transportError?.code||r.errorCode||null,r.manualReview.criteria,r.facts?.answer]);
  return '\uFEFF'+[columns,...lines].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
async function writeOutput(path,contents){const absolute=resolve(path);await mkdir(dirname(absolute),{recursive:true});await writeFile(absolute,contents,'utf8');}
async function main(){
  const options=parseArgs(process.argv.slice(2));
  if(options.help){process.stdout.write('node scripts/evaluate-service.mjs [--case ID,ID] [--json FILE] [--csv FILE]\n실제 호출: --live --base-url https://배포주소 [--app-version 실제빌드기록] [--timeout-ms 30000] [--interval-ms 6500]\n기본 실행은 외부 네트워크·AI 없이 로컬 기능만 검사합니다. API 키를 입력하지 마세요.\n');return;}
  const report=await runEvaluation(options);
  if(options.jsonPath)await writeOutput(options.jsonPath,JSON.stringify(report,null,2)+'\n');
  if(options.csvPath)await writeOutput(options.csvPath,toCsv(report));
  process.stdout.write(JSON.stringify(options.jsonPath?{jsonPath:resolve(options.jsonPath),csvPath:options.csvPath?resolve(options.csvPath):null,summary:report.summary}:report,null,2)+'\n');
  if(report.summary.automaticFailed||report.summary.errors)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write('평가 실행 오류: '+error.message+'\n');process.exitCode=2;});

