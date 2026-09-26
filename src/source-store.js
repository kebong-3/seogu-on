import { validateImport } from './data.js';
function safeStorage(){try{return globalThis.localStorage;}catch{return null;}}
/** Local last-good cache is per browser. Serverless process memory is not advertised as durable storage. */
export class SourceStore {
  constructor(fetcher=fetch,storage=safeStorage()){this.fetcher=fetcher;this.storage=storage;this.sources=new Map();this.flights=new Map();this.onChange=()=>{};}
  notify(){this.onChange();}
  list(){return [...this.sources.values()];}
  features(){return this.list().filter(s=>s.enabled).flatMap(s=>s.features||[]);}
  restore(id){try{const text=this.storage?.getItem(`seoon:v2:source:${id}`);if(!text||text.length>2500000)return null;const s=JSON.parse(text);if(s.schema!==2)return null;const v=validateImport({type:'FeatureCollection',features:s.features});return {...s,features:v.accepted,state:'cached',error:null};}catch{return null;}}
  persist(source){try{const text=JSON.stringify({...source,schema:2});if(text.length<=2500000)this.storage?.setItem(`seoon:v2:source:${source.id}`,text);}catch{/* Quota/private browsing: in-memory data remains usable. */}}
  async init(){
    let snapshot=[];try{const r=await this.fetcher('/data/source-catalog.json',{signal:AbortSignal.timeout(7000)});if(r.ok)snapshot=(await r.json()).sources||[];}catch{}
    for(const meta of snapshot){const cached=this.restore(meta.id);this.sources.set(meta.id,{id:meta.id,name:meta.name,category:meta.category,enabled:true,state:'not-loaded',features:[],...cached,...meta});}
    let api=[];try{const r=await this.fetcher('/api/layers',{signal:AbortSignal.timeout(7000)});if(r.ok)api=(await r.json()).sources||[];}catch{}
    for(const meta of api){const old=this.sources.get(meta.id)||this.restore(meta.id);this.sources.set(meta.id,{enabled:true,state:'unconfigured',features:[],...old,...meta});}
    await Promise.all(this.list().filter(s=>s.snapshot).map(s=>this.loadSnapshot(s.id)));
    this.notify();
  }
  async loadSnapshot(id){
    const s=this.sources.get(id);if(!s?.snapshot?.startsWith('/data/'))return;
    try{const r=await this.fetcher(s.snapshot,{signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error();const raw=await r.json(),p=validateImport(raw);
      if(p.errors.length||(!p.accepted.length&&!raw.metadata?.verifiedEmpty))throw Error();
      // Do not replace a newer successfully fetched cache with an older bundled snapshot.
      if(s.lastSuccessAt&&raw.metadata?.retrievedAt&&s.lastSuccessAt>raw.metadata.retrievedAt&&s.features?.length){s.state='cached';return;}
      Object.assign(s,{features:p.accepted.map(f=>({...f,properties:{...f.properties,dataKind:'official-snapshot',layerId:id}})),state:'snapshot',lastSuccessAt:raw.metadata?.retrievedAt||null,coverage:raw.metadata?.coverage||'공개본의 제공범위만 표시',sourceDate:raw.metadata?.sourceDate||null,sourceName:raw.metadata?.sourceName||s.sourceName,error:null});
      this.persist(s);
    }catch{if(s.features?.length)s.state='stale';else s.state='error';s.error='공개본 읽기 실패. 기존 자료가 있으면 유지합니다.';}
    this.notify();
  }
  async refresh(id){
    if(this.flights.has(id))return this.flights.get(id);
    const s=this.sources.get(id);if(!s?.configured)throw new Error('이 자료는 API 활용신청·키 설정이 필요합니다.');
    s.state='loading';s.error=null;this.notify();
    const promise=(async()=>{const collected=[],seen=new Set(),pageFingerprints=new Set();let page=1,total=null,complete=false,rejected=0,missingCoordinates=0,earliest=null;
      try {
        for(let n=0;n<50&&page;n++){
          const r=await this.fetcher(`/api/layers?id=${encodeURIComponent(id)}&page=${page}`,{signal:AbortSignal.timeout(14000)}),data=await r.json();
          if(!r.ok||!data.ok||data.state==='stale')throw new Error(data.error||'API 조회에 실패했습니다.');
          if(total!==null&&data.total!==null&&total!==data.total)throw new Error('수집 중 전체 건수가 변경되어 이전 자료를 유지했습니다. 다시 갱신하세요.');
          total=data.total;
          const parsed=validateImport(data.geojson);if(parsed.errors.length)throw new Error('API 자료 형식 검증 실패');
          const fingerprint=parsed.accepted.map(f=>f.properties.id).sort().join('|');
          if(fingerprint&&pageFingerprints.has(fingerprint))throw new Error('제공기관이 같은 페이지를 반복 반환했습니다. 이전 자료를 유지합니다.');
          if(fingerprint)pageFingerprints.add(fingerprint);
          for(const f of parsed.accepted)if(!seen.has(f.properties.id)){seen.add(f.properties.id);collected.push({...f,properties:{...f.properties,dataKind:'external',layerId:id}});}
          rejected+=Number(data.rejected)||0;missingCoordinates+=Number(data.missingCoordinates)||0;
          earliest=!earliest||data.lastSuccessAt<earliest?data.lastSuccessAt:earliest;
          complete=data.complete===true;
          s.progress=`${page}페이지 · 좌표 유효 ${collected.length}개`;this.notify();
          page=data.nextPage;
          if(collected.length>5000)throw new Error('자료가 5,000개를 넘습니다. 서버 조회조건을 서구로 좁히세요.');
        }
        if(collected.length===0&&s.features?.length)throw new Error('조회 결과가 0건으로 바뀌어 기존 자료를 유지했습니다. 조회조건·공급 상태를 확인하세요.');
        if(!complete)throw new Error('일부 페이지만 수신되어 기존 공개본을 유지했습니다. API의 전체건수·페이지 설정을 확인하세요.');
        Object.assign(s,{features:collected,state:'ready',lastSuccessAt:earliest||null,total,complete,rejected,missingCoordinates,error:null,progress:null,coverage:'설정된 API 조회조건의 전 페이지 수신. 서구 전체 시설의 완전성을 보증하지 않습니다.'});
        this.persist(s);
      }catch(e){s.state=s.features?.length?'stale':'error';s.error=e.message||'갱신 실패';s.progress=null;}
      finally{this.flights.delete(id);this.notify();}
      return s;
    })();this.flights.set(id,promise);return promise;
  }
  toggle(id,enabled){const s=this.sources.get(id);if(s){s.enabled=!!enabled;this.notify();}}
  importLayer(id,name,features){this.sources.set(id,{id,name,enabled:true,state:'local',features:features.map(f=>({...f,properties:{...f.properties,id:`${id}:${f.properties.id}`,layerId:id}})),configured:false,lastSuccessAt:null,coverage:'사용자 파일 · 이 브라우저 메모리에만 보관 · 미검수'});this.notify();}
}
