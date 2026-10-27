import test from 'node:test';
import assert from 'node:assert/strict';
import {installFieldOperations} from '../src/city/field-operations.js';
import {runRegisteredAction} from '../src/city/actions.js';
import {emptyFieldBook,fieldToday} from '../shared/field-operations-model.js';

const polygon={type:'Polygon',coordinates:[[[126,35],[128,35],[128,37],[126,37],[126,35]]]};
const fixture={type:'FeatureCollection',features:[{type:'Feature',properties:{id:'one',name:'돌봄 <img src=x onerror=alert(1)>',address:'공개로 1'},geometry:{type:'Point',coordinates:[126.88,35.15]}}]};
function harness(t,{directory=false,failedCatalogue=false}={}){
 const originals=Object.fromEntries(['document','localStorage','fetch','FormData'].map(k=>[k,globalThis[k]])),storage=new Map(),events={},elements={},errors=[],requests=[];
 const host={scrollTop:0,addEventListener:(n,fn)=>events[n]=fn,removeEventListener:n=>delete events[n],querySelector:q=>q==='.field-operations'?{prepend:n=>errors.push(n.textContent)}:null};
 globalThis.document={getElementById:id=>id==='detail-body'?host:elements[id]||null,createElement:()=>({setAttribute(){}})};
 globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.FormData=class{constructor(form){this.values=form.values;}get(k){return this.values[k]??null;}};
 globalThis.fetch=async path=>{requests.push(path);const region=path.includes('/suncheon/')?'suncheon':'seogu';let body;
  if(path.endsWith('/manifest.json'))body={regionId:region,datasets:[{id:'childcare',title:'어린이집',topic:'care',path:`/data/decision/${region}/childcare.geojson`,sourceName:'공식 공개자료',sourceUrl:'https://www.seogu.gwangju.kr/'}],...(directory?{careDirectoryPath:`/data/decision/${region}/care-directory.json`}:{})};
  else if(path.endsWith('/care-directory.json'))body={regionId:region,entries:[{id:'unlocated-one',datasetId:'childcare',regionId:region,name:'주소만 있는 돌봄시설',address:'공개로 2',coordinates:null,sourceName:'공식 공개자료',sourceUrl:'https://www.seogu.gwangju.kr/',sourceDate:null}]};
  else {if(failedCatalogue)throw Error('fetch failed');body=fixture;}
  return {ok:true,text:async()=>JSON.stringify(body)};
 };
 const api={state:{regionProfile:{id:'seogu',name:'서구'},district:polygon,scope:polygon,dong:'all',view:null},show(title,html,view){this.title=title;this.html=html;this.state.view=view;},label:()=> '서구',toast(){},frameGeometry(g){this.framed=g;}};
 const ui=installFieldOperations(api);
 t.after(()=>{ui.destroy();for(const [key,value]of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 const action=name=>runRegisteredAction({dataset:{action:name}},api);
 const submit=(id,values,button)=>events.submit({target:{id,values},submitter:{value:button},preventDefault(){}});
 return {api,ui,storage,events,elements,errors,requests,action,submit,key:'seoon:field-operations:v1:seogu',book(){return JSON.parse(storage.get(this.key));}};
}
const fields={revision:'0',facility:'catalogue:childcare:one',title:'현장 운영 확인',description:'공개 운영공지 대조',ownerRole:'시설 운영 담당'};
const check={revision:'1',checkedOn:fieldToday(),basis:'현장 안내판과 공개 운영일자를 대조',availability:'unknown',validThrough:''};

test('workbench selects source-backed facilities and escapes facility content without copying extra data',async t=>{
 const h=harness(t,{directory:true});await h.action('field-operations');
 assert.match(h.api.html,/기기의 개인 검토기록/);assert.match(h.api.html,/&lt;img/);assert.doesNotMatch(h.api.html,/<img/);
 assert.match(h.api.html,/주소만 있는 돌봄시설/);assert.match(h.api.html,/좌표 미확정/);
 h.submit('fo-edit',fields);const b=h.book();assert.equal(b.issues[0].facility.sourceName,'공식 공개자료');assert.equal(b.issues[0].facility.id,fields.facility);assert.equal(b.issues[0].status,'접수');assert.equal(b.issues[0].observation,null);assert.match(h.api.html,/대상 시설은/);assert.doesNotMatch(h.api.html,/id="fo-facility-query"/);
});
test('missing evidence blocks status changes and preserves the form until valid confirmation is submitted',async t=>{
 const h=harness(t);await h.ui.open();h.submit('fo-edit',fields);const before=h.storage.get(h.key);
 h.submit('fo-transition',{...check,basis:''},'검토');assert.equal(h.storage.get(h.key),before);assert.match(h.errors.at(-1),/근거/);
 h.submit('fo-transition',check,'검토');assert.equal(h.book().issues[0].status,'검토');assert.equal(h.book().issues[0].observation.availability,'unknown');assert.match(h.api.html,/미확인/);
});
test('another tab changing storage rejects an edit without replacing either record',async t=>{
 const h=harness(t);await h.ui.open();h.submit('fo-edit',fields);const other=h.book();other.revision++;h.storage.set(h.key,JSON.stringify(other));
 h.submit('fo-edit',{...fields,revision:'1',facility:'saved',title:'새 제목'});assert.equal(h.storage.get(h.key),JSON.stringify(other));assert.match(h.errors.at(-1),/다른 창/);
});
test('manual places remain unverified and failed catalogues do not fabricate facilities',async t=>{
 const h=harness(t,{failedCatalogue:true});await h.ui.open();assert.match(h.api.html,/일부 공개시설/);
 h.submit('fo-edit',{...fields,facility:'manual',manualName:'현장 확인 예정 장소',manualAddress:'주소 확인 전'});
 assert.equal(h.book().issues[0].facility.kind,'unverified');assert.equal(h.book().issues[0].facility.coordinates,null);assert.match(h.api.html,/직접 입력한 장소 · 위치 미검증/);assert.doesNotMatch(h.api.html,/data-action="field-locate"/);
});
test('backup restore rejects other regions and a region switch while a file is being read',async t=>{
 const h=harness(t);await h.ui.open();h.submit('fo-edit',fields);const before=h.storage.get(h.key);
 const other=JSON.stringify(emptyFieldBook('suncheon'));
 await h.events.change({target:{id:'fo-import',value:'backup',files:[{size:other.length,text:async()=>other}]}});
 assert.equal(h.storage.get(h.key),before);assert.match(h.api.html,/이 지역/);
 let complete;const pending=h.events.change({target:{id:'fo-import',value:'backup',files:[{size:before.length,text:()=>new Promise(resolve=>complete=resolve)}]}});
 h.api.state.regionProfile={id:'suncheon',name:'순천'};await h.ui.open();complete(before);await pending;
 assert.equal(h.storage.get('seoon:field-operations:v1:suncheon'),undefined);assert.equal(h.storage.get(h.key),before);assert.match(h.api.html,/지역이 바뀌어/);
});
test('corrupt storage is preserved and new writes are refused with a readable error',async t=>{
 const h=harness(t);h.storage.set(h.key,'{broken');await h.ui.open();assert.match(h.api.html,/기존 저장값은 바꾸지 않았습니다/);
 h.submit('fo-edit',fields);assert.equal(h.storage.get(h.key),'{broken');assert.match(h.errors.at(-1),/덮어쓰지 않았습니다/);
});
test('an import finishing after opening another service does not reopen the field workbench',async t=>{
 const h=harness(t);await h.ui.open();h.submit('fo-edit',fields);const before=h.storage.get(h.key);
 let complete;const pending=h.events.change({target:{id:'fo-import',value:'backup',files:[{size:before.length,text:()=>new Promise(resolve=>complete=resolve)}]}});
 h.api.state.view='walk-routes';complete(before);await pending;assert.equal(h.api.state.view,'walk-routes');
});
test('A/B UI retains the common condition and assumptions after comparison without changing observations',async t=>{
 const h=harness(t);await h.ui.open();h.submit('fo-edit',fields);const before=h.storage.get(h.key),day=fieldToday();
 h.submit('fo-compare',{at:day+'T14:00',startsAt:day+'T09:00',endsAt:day+'T18:00',facilityA:fields.facility,kindA:'closed',reasonA:'보수 가정',facilityB:fields.facility,kindB:'temporary-open',reasonB:'인력 확보 가정'});
 assert.equal(h.storage.get(h.key),before);assert.match(h.api.html,/임시 개방/);assert.match(h.api.html,/value="temporary-open" selected/);assert.match(h.api.html,/value="인력 확보 가정"/);assert.match(h.api.html,/사용자 가정/);assert.match(h.api.html,/차이 \+1곳/);
});
