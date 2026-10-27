import {escapeDecisionHtml as e} from './decision-report.js';
const url=value=>/^https?:\/\//.test(String(value||''))?String(value):'';

export function safeReturnGuide(reference){
 if(!reference?.routes?.length)return '';
 return `<details class="living-route-guide"><summary>여성안심 귀갓길 공식 지도 · ${reference.routes.length}개소</summary><p>광주경찰청이 2026년 8월 공개한 서부경찰서 지정길입니다. 공식 지도는 확인했으며, 정확한 구간 좌표는 공개자료에서 확보하지 못해 지도 위 경로선으로 표시하지 않습니다.</p><p><a href="${e(url(reference.sourceUrl))}" target="_blank" rel="noopener noreferrer">경찰청 공식 안내·지도 열기 ↗</a> · <a href="${e(url(reference.attachmentUrl))}" target="_blank" rel="noopener noreferrer">공식 지도 내려받기 (.show) ↗</a></p><ul>${reference.routes.map(r=>`<li><strong>${e(r.name)}</strong> · ${e(r.area||'공식 지도를 확인하세요.')}</li>`).join('')}</ul><h4>구간 데이터를 확보하려면</h4><p>서구청 양성아동복지과 또는 광주서부경찰서 여성안심귀갓길 담당자에게 다음 자료를 요청하세요. 공공데이터포털의 데이터 제공 신청이나 정보공개청구로도 요청할 수 있습니다.</p><p>요청 자료: 최신 여성안심귀갓길 구간명·관리번호, 시작점·종료점·경유점, 지정·변경일, 좌표계가 명시된 GeoJSON/SHP 또는 경위도 CSV, 공개·재이용 범위.</p><p>좌표자료를 받으면 공식 구간과 보행경로를 대조할 수 있습니다. 현재 비상벨·보안등 위치와 도보 경로는 공식 지정길 또는 안전도 판정이 아닙니다.</p></details>`;
}

export function careDirectoryRows(directory,{query='',datasetId='all'}={}){
 const records=directory?.entries||directory?.facilities||[];
 return records.filter(r=>!Array.isArray(r.coordinates)&&!(Number.isFinite(r.lat)&&Number.isFinite(r.lng))).filter(r=>datasetId==='all'||r.datasetId===datasetId).filter(r=>`${r.name} ${r.address} ${r.category}`.toLocaleLowerCase('ko-KR').includes(query.toLocaleLowerCase('ko-KR')));
}
export function careDirectoryHtml(directory,{query='',datasetId='all',scopeIsAll=true,limit=30}={}){
 const rows=careDirectoryRows(directory,{query,datasetId});
 if(!rows.length)return '';
 return `<section class="dt-section living-address-directory"><h3>주소로 찾는 돌봄·육아시설 <span>${rows.length}곳</span></h3><p class="dt-help">공식 목록에서 주소를 확인한 시설입니다. 지도 위치를 확정하지 못해 마커는 표시하지 않습니다.${scopeIsAll?'':' 아래 목록은 서구 전체이며, 선택 동의 시설 수에 포함하지 않습니다.'}</p>${rows.slice(0,limit).map(r=>`<article class="dt-row living-card"><h4>${e(r.name)}</h4><span class="living-kind">${e(r.category)}</span><p>${e(r.address)}</p>${r.phone?`<p>기관 연락처 ${e(r.phone)}</p>`:''}<p class="living-data-date">${e(r.sourceName)} · 자료 기준 ${e(r.sourceDate||'미제공')} · 확인 ${e(r.verifiedAt||directory.verifiedAt||'2026-10-27')}</p>${url(r.sourceUrl)?`<a href="${e(url(r.sourceUrl))}" target="_blank" rel="noopener noreferrer">공식 시설정보 확인 ↗</a>`:''}</article>`).join('')}${rows.length>limit?'<button class="dt-add-site" data-action="decision-living-more">주소 목록 더 보기</button>':''}</section>`;
}
