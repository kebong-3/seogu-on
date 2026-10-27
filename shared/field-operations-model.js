/** Personal field-review records. No institution approval, access control, or server sync is implied. */
export const FIELD_STATUSES=['접수','검토','조치중','조치완료','현장확인'];
export const AVAILABILITY={available:'이용 가능 확인',unavailable:'이용 불가 확인',unknown:'미확인'};
export const FIELD_LIMITS={issues:200,history:100,bytes:2*1024*1024};
const fail=message=>{throw Error(message);};
const clone=value=>JSON.parse(JSON.stringify(value));
function obj(value,keys,label){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(`${label} 형식을 확인하세요.`);
 for(const k of Reflect.ownKeys(value))if(typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value'))fail(`${label}에 허용하지 않은 항목이 있습니다.`);
 return value;
}
function str(value,label,max=200,required=true){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||required&&!value.trim())fail(`${label}을 확인하세요.`);return value.trim();}
function id(value,label='식별자'){if(typeof value!=='string'||!/^[a-zA-Z0-9_:.\/-]{1,160}$/.test(value)||value.includes('..'))fail(`${label} 형식을 확인하세요.`);return value;}
function region(value){if(typeof value!=='string'||!/^[a-z0-9-]{1,60}$/.test(value))fail('지역을 확인하세요.');return value;}
export function fieldDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value&&Number(value.slice(0,4))>=2000&&Number(value.slice(0,4))<=2100;}
function stamp(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail('기록 시각 형식을 확인하세요.');return value;}
export const fieldToday=(now=new Date().toISOString())=>new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10);
function role(value){const v=str(value,'담당 역할',80,false);if(/@|\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4}/.test(v))fail('담당 역할에는 개인 연락처 대신 부서·업무 역할을 적으세요.');return v;}
function publicUrl(value){if(value===null)return null;try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||value.length>1200)throw Error();return value;}catch{fail('시설 출처 링크를 확인하세요.');}}
export function validateFieldFacility(value){
 obj(value,['kind','id','name','address','coordinates','sourceName','sourceUrl','sourceDate'],'시설');
 if(!['catalogue','unverified'].includes(value.kind))fail('시설 확인 구분을 확인하세요.');
 const out={kind:value.kind,id:id(value.id),name:str(value.name,'시설·장소 이름',180),address:str(value.address,'주소',300,false),coordinates:value.coordinates,sourceName:str(value.sourceName,'자료 출처',200,false),sourceUrl:publicUrl(value.sourceUrl),sourceDate:value.sourceDate};
 if(out.coordinates!==null&&(!Array.isArray(out.coordinates)||out.coordinates.length!==2||!out.coordinates.every(Number.isFinite)||Math.abs(out.coordinates[0])>180||Math.abs(out.coordinates[1])>90))fail('시설 좌표를 확인하세요.');
 if(out.kind==='unverified'&&out.coordinates!==null)fail('직접 입력한 장소에는 미검증 좌표를 넣을 수 없습니다.');
 if(out.kind==='catalogue'&&(!out.sourceName||!out.sourceUrl))fail('공개시설은 출처가 필요합니다.');
 if(out.sourceDate!==null&&!fieldDate(out.sourceDate))fail('시설 기준일을 확인하세요.');
 return out;
}
function observation(value,at){
 if(value===null)return null;obj(value,['checkedOn','basis','availability','validThrough'],'확인기록');
 if(!fieldDate(value.checkedOn)||value.checkedOn>fieldToday(at))fail('확인일은 오늘 이전의 실제 날짜로 입력하세요.');
 if(!Object.hasOwn(AVAILABILITY,value.availability))fail('이용 확인 구분을 확인하세요.');
 if(value.validThrough!==null&&(!fieldDate(value.validThrough)||value.validThrough<value.checkedOn))fail('확인 유효 종료일을 확인하세요.');
 return {checkedOn:value.checkedOn,basis:str(value.basis,'확인 근거',1500),availability:value.availability,validThrough:value.validThrough};
}
const HISTORY_KEYS=['revision','action','at','from','to','role','note','observation'];
function validateIssue(value){
 obj(value,['id','revision','regionId','scopeId','title','description','role','facility','status','observation','createdAt','updatedAt','history'],'과제');
 id(value.id);region(value.regionId);id(value.scopeId,'구역');str(value.title,'과제 이름',120);str(value.description,'과제 내용',2000,false);role(value.role);validateFieldFacility(value.facility);
 if(!FIELD_STATUSES.includes(value.status))fail('진행 상태를 확인하세요.');stamp(value.createdAt);stamp(value.updatedAt);if(value.createdAt>value.updatedAt)fail('기록 시각 순서를 확인하세요.');
 if(!Number.isInteger(value.revision)||value.revision<1||!Array.isArray(value.history)||value.history.length!==value.revision||value.history.length>FIELD_LIMITS.history)fail('수정 이력이 일치하지 않습니다.');
 let previous=null,lastAt=value.createdAt,lastObservation=null;
 for(const [i,h] of value.history.entries()){
  obj(h,HISTORY_KEYS,'이력');stamp(h.at);role(h.role);str(h.note,'이력 사유',1500,false);
  if(h.revision!==i+1||h.at<lastAt||h.from!==previous||!FIELD_STATUSES.includes(h.to))fail('이력 순서가 일치하지 않습니다.');
  if(i===0){if(h.action!=='create'||h.from!==null||h.to!=='접수'||h.at!==value.createdAt)fail('접수 이력을 확인하세요.');}
  else if(h.action==='edit'){if(h.to!==h.from)fail('수정 이력에서 상태를 바꿀 수 없습니다.');}
  else if(h.action==='status'){if(FIELD_STATUSES.indexOf(h.to)!==FIELD_STATUSES.indexOf(h.from)+1||!h.observation)fail('상태 전환 순서·근거를 확인하세요.');}
  else if(h.action==='reopen'){if(!['조치완료','현장확인'].includes(h.from)||h.to!=='검토'||!h.note.trim()||!h.observation)fail('재개 사유·근거를 확인하세요.');}
  else fail('지원하지 않는 이력입니다.');
  if(['status','reopen'].includes(h.action)&&!h.role.trim())fail('상태 변경 이력에 담당 역할이 필요합니다.');
  observation(h.observation,h.at);if(h.observation)lastObservation=h.observation;previous=h.to;lastAt=h.at;
 }
 if(previous!==value.status||lastAt!==value.updatedAt||JSON.stringify(lastObservation)!==JSON.stringify(value.observation))fail('현재 상태·확인기록과 이력이 일치하지 않습니다.');
 if(value.history.at(-1).role!==value.role)fail('담당 역할과 이력이 일치하지 않습니다.');
 observation(value.observation,value.updatedAt);return clone(value);
}
export function emptyFieldBook(regionId,now=new Date().toISOString()){return {schemaVersion:1,regionId:region(regionId),revision:0,updatedAt:stamp(now),issues:[]};}
export function validateFieldBook(value,expectedRegion){
 obj(value,['schemaVersion','regionId','revision','updatedAt','issues'],'백업');if(value.schemaVersion!==1||value.regionId!==region(expectedRegion))fail('이 지역의 지원되는 백업이 아닙니다.');
 stamp(value.updatedAt);if(!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.issues)||value.issues.length>FIELD_LIMITS.issues)fail('백업 크기·수정번호를 확인하세요.');
 const seen=new Set();for(const issue of value.issues){validateIssue(issue);if(issue.regionId!==value.regionId||seen.has(issue.id)||issue.updatedAt>value.updatedAt)fail('지역·중복 과제·기록 시각을 확인하세요.');seen.add(issue.id);}
 return clone(value);
}
export function parseFieldBackup(text,regionId){if(typeof text!=='string'||new TextEncoder().encode(text).length>FIELD_LIMITS.bytes)fail('백업 파일은 2MB 이하여야 합니다.');let value;try{value=JSON.parse(text);}catch{fail('백업 파일을 읽을 수 없습니다.');}return validateFieldBook(value,regionId);}
function revise(book,issue,now){const out=clone(book);out.issues=out.issues.filter(x=>x.id!==issue.id);out.issues.unshift(issue);out.revision++;out.updatedAt=stamp(now);return validateFieldBook(out,book.regionId);}
function findIssue(book,issueId,expectedRevision){validateFieldBook(book,book.regionId);const found=book.issues.find(x=>x.id===issueId);if(!found||found.revision!==expectedRevision)fail('다른 수정과 충돌했습니다. 최신 기록을 다시 열어 주세요.');if(found.history.length>=FIELD_LIMITS.history)fail('이 과제의 이력이 100개입니다. 백업 후 후속 과제를 접수하세요.');return clone(found);}
export function saveFieldIssue(book,input,{now=new Date().toISOString(),issueId,expectedRevision}={}){
 validateFieldBook(book,book.regionId);obj(input,['title','description','role','facility','scopeId','observation'],'입력');
 let issue;if(issueId)issue=findIssue(book,issueId,expectedRevision);else{if(book.issues.length>=FIELD_LIMITS.issues)fail('과제는 최대 200개입니다.');issue={id:'issue-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),regionId:book.regionId,status:'접수',revision:0,createdAt:stamp(now),history:[],observation:null};}
 const previous=clone(issue),check=observation(input.observation??null,now),action=issue.revision?'edit':'create';
 if(action==='edit'&&JSON.stringify(validateFieldFacility(input.facility))!==JSON.stringify(issue.facility))fail('대상 시설을 바꾸려면 새 과제를 접수하세요. 이전 시설의 확인기록을 옮기지 않습니다.');
 Object.assign(issue,{title:str(input.title,'과제 이름',120),description:str(input.description??'','과제 내용',2000,false),role:role(input.role??''),facility:validateFieldFacility(input.facility),scopeId:id(input.scopeId||'all','구역'),revision:issue.revision+1,updatedAt:stamp(now)});
 if(check)issue.observation=check;
 issue.history.push({revision:issue.revision,action,at:now,from:action==='create'?null:issue.status,to:issue.status,role:issue.role,note:action==='create'?'개인 검토과제 접수':[previous.title!==issue.title?`과제 이름: ${previous.title} → ${issue.title}`:'',previous.description!==issue.description?'확인할 일 내용 수정':'',previous.role!==issue.role?`담당 역할: ${previous.role||'미기록'} → ${issue.role||'미기록'}`:'',check?'확인 근거 추가':''].filter(Boolean).join(' · ')||'과제 내용 재저장',observation:check});
 return revise(book,issue,now);
}
export function transitionFieldIssue(book,issueId,{toStatus,role:ownerRole,checkedOn,basis,availability='unknown',validThrough=null,reopenReason=''},expectedRevision,now=new Date().toISOString()){
 const issue=findIssue(book,issueId,expectedRevision),isReopen=['조치완료','현장확인'].includes(issue.status)&&toStatus==='검토';
 if(!isReopen&&FIELD_STATUSES.indexOf(toStatus)!==FIELD_STATUSES.indexOf(issue.status)+1)fail('다음 상태로 진행하거나 완료된 과제를 재개하세요.');
 if(isReopen&&!String(reopenReason).trim())fail('재개 사유가 필요합니다.');
 const check=observation({checkedOn,basis,availability,validThrough},now),previous=issue.status;
 issue.status=toStatus;issue.role=role(ownerRole??issue.role);if(!issue.role)fail('상태를 바꾸기 전에 담당 역할을 기록하세요.');issue.observation=check;issue.revision++;issue.updatedAt=stamp(now);
 issue.history.push({revision:issue.revision,action:isReopen?'reopen':'status',at:now,from:previous,to:toStatus,role:issue.role,note:isReopen?str(reopenReason,'재개 사유',1500):'확인 근거를 첨부해 상태 변경',observation:check});
 return revise(book,issue,now);
}
export function restoreFieldBackup(current,incoming,now=new Date().toISOString()){
 validateFieldBook(current,current.regionId);validateFieldBook(incoming,current.regionId);
 const byId=new Map(current.issues.map(x=>[x.id,x]));for(const item of incoming.issues){const old=byId.get(item.id);if(old&&JSON.stringify(old)!==JSON.stringify(item))fail('같은 과제의 다른 수정본이 있습니다. 기존 기록을 덮어쓰지 않았습니다.');if(!old)byId.set(item.id,item);}
 return validateFieldBook({...current,issues:[...byId.values()],revision:current.revision+1,updatedAt:stamp(now)},current.regionId);
}
export const fieldCsvCell=value=>{let s=String(value??'').replace(/[\r\n]+/g,' ');if(/^[\s\uFEFF]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
export function fieldBookCsv(book){validateFieldBook(book,book.regionId);return '\uFEFF'+[['과제','시설','주소','위치확인','진행상태','담당역할','확인일','이용확인','확인근거','수정번호'],...book.issues.map(i=>[i.title,i.facility.name,i.facility.address,i.facility.kind==='catalogue'?'선택 당시 공개목록':'직접 입력·위치 미검증',i.status,i.role,i.observation?.checkedOn||'미확인',i.observation?AVAILABILITY[i.observation.availability]:'미확인',i.observation?.basis||'미확인',i.revision])].map(row=>row.map(fieldCsvCell).join(',')).join('\r\n');}
function localInstant(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)||!fieldDate(value.slice(0,10)))fail('비교 일시를 확인하세요.');const d=new Date(value+':00+09:00');if(!Number.isFinite(+d)||new Date(+d+9*3600000).toISOString().slice(0,16)!==value)fail('비교 일시를 확인하세요.');return +d;}
/** Same facility set, same instant. Counts describe observations/assumptions, never demand or safety. */
export function compareFieldAlternatives({facilities,issues,at,planA=[],planB=[]}){
 const instant=localInstant(at),day=at.slice(0,10);if(!Array.isArray(facilities)||facilities.length>FIELD_LIMITS.issues)fail('비교 시설을 확인하세요.');
 const unique=new Map();for(const f of facilities){validateFieldFacility(f);if(unique.has(f.id))fail('비교 시설이 중복되었습니다.');unique.set(f.id,f);}
 const observations=new Map();for(const issue of issues||[]){
  validateIssue(issue);if(!issue.observation)continue;
  const old=observations.get(issue.facility.id),recordedAt=[...issue.history].reverse().find(h=>h.observation)?.at||issue.updatedAt;
  if(!old||old.observation.checkedOn<issue.observation.checkedOn||old.observation.checkedOn===issue.observation.checkedOn&&old.recordedAt<recordedAt)observations.set(issue.facility.id,{observation:issue.observation,recordedAt});
 }
 const evaluate=plan=>{
  if(!Array.isArray(plan)||plan.length>unique.size)fail('가정 목록을 확인하세요.');const assumptions=new Map();
  for(const a of plan){obj(a,['facilityId','kind','startsAt','endsAt','reason'],'대안 가정');if(!unique.has(a.facilityId)||assumptions.has(a.facilityId)||!['closed','temporary-open'].includes(a.kind))fail('가정 시설·종류가 일치하지 않습니다.');str(a.reason,'가정 이유',300);const start=localInstant(a.startsAt),end=localInstant(a.endsAt);if(end<=start)fail('임시 운영 종료는 시작보다 늦어야 합니다.');assumptions.set(a.facilityId,{...a,start,end});}
  const result={total:unique.size,available:0,unavailable:0,unknown:0,assumed:0,rows:[]};
  for(const [facilityId,facility]of unique){const record=observations.get(facilityId),check=record?.observation,a=assumptions.get(facilityId);let state='unknown',basis='이 일시에 유효한 확인기록 없음',origin='unconfirmed';
   if(check&&check.checkedOn<=day&&(check.validThrough||check.checkedOn)>=day){state=check.availability;basis=check.basis;origin='observation';}
   if(a&&instant>=a.start&&instant<a.end){state=a.kind==='closed'?'unavailable':'available';basis=a.reason;origin='assumption';result.assumed++;}
   result[state]++;result.rows.push({facilityId,name:facility.name,state,basis,origin});
  }return result;
 };
 const a=evaluate(planA),b=evaluate(planB);return {at,plans:{a:clone(planA),b:clone(planB)},facilityCount:unique.size,a,b,availableDifference:b.available-a.available,meaning:'같은 시설·같은 일시의 확인기록 및 사용자 가정 분류. 수요·안전도·실제 개방이나 사업효과를 의미하지 않음.'};
}
