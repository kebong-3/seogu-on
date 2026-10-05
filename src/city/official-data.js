/** Sources and counts for the official public snapshots included in this release. */
import {LAYER_BY_ID,esc} from './catalog.js';
import {validGeometry} from './geometry.js';

export function createOfficialDataPanel(api) {
  const s=api.state;
  let manifest=null, pending=null;
  const safeUrl=value=>{
    try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}
    catch {return null;}
  };
  async function load() {
    if(manifest)return manifest;
    if(!pending)pending=api.fetchJSON('/data/city/official-collection.json').then(data=>{
      if(!Array.isArray(data.datasets))throw Error('공식 자료 수집목록을 확인하지 못했습니다.');
      manifest=data;return data;
    }).finally(()=>{pending=null;});
    return pending;
  }
  const dateText=d=>{
    const first=d.sourceDateMin||d.sourceDate,last=d.sourceDateMax||d.sourceDate;
    const date=first?(first!==last&&last?`${first} ~ ${last}`:first):'원자료 기준일 미제공';
    return first&&d.missingSourceDateCount?`${date} · ${d.missingSourceDateCount}건 미제공`:date;
  };
  const unitText=d=>d.countUnit==='관리지점'?'개 관리지점':d.countUnit==='위치'?'곳':d.countUnit||'곳';
  const collectedText=value=>{const date=new Date(value);return Number.isFinite(+date)?date.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'미확인';};
  function card(d) {
    const layer=LAYER_BY_ID[d.layerId],entry=s.entries.get(d.layerId);
    const count=entry?.state==='loaded'?api.scoped(d.layerId).length:null;
    const source=safeUrl(d.sourceUrl),unit=unitText(d);
    return `<article class="query-card" data-official-layer="${esc(d.layerId)}">`
      +`<h3>${esc(d.title||layer?.title||d.key)}</h3>`
      +`<p><b>서구 수록 ${Number(d.accepted||0).toLocaleString()}${esc(unit)}</b> · 현재 구역 ${count===null?'불러오는 중':count.toLocaleString()+esc(unit)}</p>`
      +`<dl class="info-grid"><dt>원자료 기준·수정일</dt><dd>${esc(dateText(d))}</dd>`
      +`<dt>수집 시각</dt><dd>${esc(collectedText(d.collectedAt||manifest.collectedAt))}</dd>`
      +`<dt>제공기관</dt><dd>${esc(d.sourceName||'공식 원문 참조')}</dd></dl>`
      +`<p class="small">${esc(d.coverage||'공개 자료를 수집해 서구 경계 안 좌표만 수록했습니다.')}</p>`
      +(d.sourceDateBasis?`<p class="small">${esc(d.sourceDateBasis)}</p>`:'')
      +(d.geometryMeaning?`<p class="small">${esc(d.geometryMeaning)}</p>`:'')
      +`<div class="detail-actions"><button class="primary" data-action="official-data-view" data-id="${esc(d.layerId)}">지도에 표시</button>`
      +(source?`<a class="secondary" href="${esc(source)}" target="_blank" rel="noopener noreferrer">공식 출처</a>`:'')
      +(layer?.url?`<a class="secondary" href="${esc(layer.url)}" download>자료 내려받기</a>`:'')
      +`</div></article>`;
  }
  async function show() {
    api.show('직접 수집한 공식자료','<p class="note" role="status">수집목록을 불러오고 있습니다.</p>','official-data');
    try {
      const data=await load();
      if(s.view!=='official-data')return;
      const datasets=data.datasets.filter(d=>LAYER_BY_ID[d.layerId]);
      api.show('직접 수집한 공식자료',
        `<p class="muted">${esc(api.label())} · ${datasets.length}종의 공개 원자료</p>`
        +'<p class="note">공식 누리집에서 직접 수집한 자료를 배포본에 포함했습니다. 외부 API가 응답하지 않아도 이 공개본은 조회할 수 있습니다. 서로 다른 자료의 건수를 더해 전체 시설 수로 계산하지 않습니다.</p>'
        +'<div class="detail-actions"><button class="secondary" data-action="official-data-all">서구 전체 기준으로 보기</button><button class="secondary" data-action="icing">상습결빙구간</button><button class="secondary" data-action="infra">생활 인프라</button></div>'
        +datasets.map(card).join('')
        +(data.collectedNotPublished?.length?'<details><summary>이번 수집에서 반영하지 못한 자료</summary>'+data.collectedNotPublished.map(d=>`<p><b>${esc(d.title)}</b><br>${esc(d.reason)}</p>`).join('')+'</details>':'')
        +'<p class="small">기준일이 없는 자료는 수집일을 기준일로 바꾸지 않았습니다. 위치가 경계 밖이거나 확인되지 않은 항목은 지도 수록에서 제외했습니다. 시설의 현재 개방·운영 여부는 별도 확인이 필요합니다.</p>',
        'official-data');
    } catch(error) {
      if(s.view==='official-data')api.show('직접 수집한 공식자료',`<p class="note">${esc(error.message)}</p><button class="secondary" data-action="official-data">다시 보기</button>`,'official-data');
    }
  }
  async function display(id) {
    const data=await load(),d=data.datasets.find(d=>d.layerId===id),layer=LAYER_BY_ID[id];
    if(!d||!layer?.url)return;
    if(s.entries.get(id)?.state!=='loaded') {
      const b=await api.fetchJSON(layer.url);
      if(b.type!=='FeatureCollection'||!Array.isArray(b.features))throw Error('공식 자료의 지도 형식이 올바르지 않습니다.');
      const features=b.features.filter(f=>validGeometry(f.geometry));
      s.entries.set(id,{state:'loaded',title:layer.title,features,metadata:b.metadata||{},loadedAt:new Date().toISOString()});
    }
    for(const old of s.enabled)if(LAYER_BY_ID[old]?.kind==='raster')api.send({type:'raster',id:old,visible:false});
    s.enabled=new Set([id]);s.isolate=false;s.selected=null;s.activePreset=null;
    api.drawData();
    const count=api.scoped(id).length;
    api.toast(`${layer.title} · ${api.label()} ${count}${unitText(d)} 표시`);
    await show();
  }
  return {
    async action(button) {
      switch(button.dataset.action) {
        case 'official-data':await show();return true;
        case 'official-data-all':api.chooseDong('all');await show();return true;
        case 'official-data-view':await display(button.dataset.id);return true;
        default:return false;
      }
    },
    scopeChanged(){if(s.view==='official-data')show();},
  };
}
