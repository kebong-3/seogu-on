import {decisionPurposeHtml} from './decision-purpose.js';

/** Documents use the same immutable calculation result shown on the map. */
export const escapeDecisionHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e = escapeDecisionHtml;
const number = value => Number.isFinite(value) ? value.toLocaleString('ko-KR') : '미제공';
const array = value => Array.isArray(value) ? value : [];
const xy = item => Array.isArray(item?.coordinates) && item.coordinates.length >= 2 && item.coordinates.slice(0, 2).every(Number.isFinite) ? item.coordinates : null;
const label = value => typeof value === 'string' ? value : value?.name || value?.title || value?.label || value?.id || '';
const safeUrl = value => /^https?:\/\//i.test(String(value || '')) ? value : '';
export const decisionWorkflowTitle = value => ({coverage:'시설 배치 대안 비교',inspection:'점검 후보 목록',site:'사업 후보지 주변 비교'})[value] || '공간행정 의사결정';

export function decisionSources(result, manifest) {
  const supplied = Array.isArray(result?.sourceStatus) ? result.sourceStatus : result?.sourceStatus && typeof result.sourceStatus === 'object' ? Object.entries(result.sourceStatus).map(([id, value]) => typeof value === 'object' ? {id, ...value} : {id, state:value}) : [];
  const datasets = Array.isArray(manifest?.datasets) ? manifest.datasets : Object.entries(manifest?.datasets || {}).map(([id, item]) => ({id, ...item}));
  return supplied.length ? supplied.map(item => ({...datasets.find(d => d.id === item.id || d.id === item.datasetId), ...item})) : datasets;
}

export function decisionAiText(ai) {
  if (!ai) return '';
  if(typeof ai.answer==='string'&&ai.answer.trim())return ai.answer;
  const parts = [ai.answer || ai.summary || ''];
  for (const section of array(ai.sections)) {
    if (typeof section === 'string') parts.push(section);
    else parts.push([section.title || section.heading, section.text || section.body || section.content, ...array(section.items).map(label)].filter(Boolean).join('\n'));
  }
  return parts.filter(Boolean).join('\n\n');
}

/** Spreadsheet software must never interpret a facility name as a formula. */
export function decisionCsv(result) {
  const cell = value => {
    let text = String(value ?? '').replace(/[\r\n]+/g, ' ');
    if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const rows = result.workflow==='site' ? [['업무','지역','구역','후보명','후보 ID','경도','위도','자료','반경(m)','수록 대상 수','고유좌표 수','단위','최근접 시설','최근접 직선거리(m)','연결 상태']] : [['업무','지역','구역','대상명','대상 ID','경도','위도','최근접 기존 시설','직선거리(m)','현재 조건 이내','변경안 조건 이내','새로 연결','연결 해제','원문 점검사항','자료 기준일','자료 출처 URL','주변자료 조회 결과']];
  for (const row of array(result.rows)) {
    if(result.workflow==='site')for(const data of array(row.datasets))rows.push([decisionWorkflowTitle(result.workflow),result.regionId,label(result.scope),row.name,row.id,xy(row)?.[0],xy(row)?.[1],data.title||data.datasetId,result.parameters?.radiusM,data.count,data.uniqueLocations,data.unit,data.nearest?.name,data.nearest?.distanceM,data.state]);
    else rows.push([decisionWorkflowTitle(result.workflow), result.regionId, label(result.scope), row.name, row.id, xy(row)?.[0], xy(row)?.[1], row.nearest?.name, row.nearest?.distanceM ?? '', row.baselineCovered === true ? '예' : row.baselineCovered === false ? '아니오' : '', row.scenarioCovered === true ? '예' : row.scenarioCovered === false ? '아니오' : '', row.newlyCovered ? '예' : '', row.lostCovered ? '예' : '',array(row.inspectionFlags).map(f=>f.text||f.label).join(' / '),[...new Set(array(row.sourceRefs).map(ref=>ref.date).filter(Boolean))].join(' / '),[...new Set(array(row.sourceRefs).map(ref=>ref.url).filter(Boolean))].join(' / '),array(row.context).map(data=>`${data.title||data.datasetId}: ${Number.isFinite(data.count)?data.count+' '+(data.unit||'수록 대상'):'미연결'}${Number.isFinite(data.uniqueLocations)?' / 고유좌표 '+data.uniqueLocations+'곳':''}${data.nearest?' / 최근접 '+data.nearest.name+' '+data.nearest.distanceM+'m':''}`).join(' | ')]);
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}

function overviewSvg(result) {
  const targets = array(result.rows).filter(xy);
  const proposed = array(result.scenario?.proposedSites).filter(xy);
  const sites = array(result.sites || result.context?.sites).filter(xy);
  const all = [...targets, ...proposed, ...sites];
  if (!all.length) return '';
  const points = all.map(xy), minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0])), minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
  const cos = Math.cos((minY + maxY) / 2 * Math.PI / 180), width = Math.max((maxX-minX)*cos, .001), height = Math.max(maxY-minY, .001), scale = Math.min(630/width, 280/height);
  const project = item => {const p=xy(item); return [350+(p[0]-(minX+maxX)/2)*cos*scale, 165-(p[1]-(minY+maxY)/2)*scale];};
  const circles = targets.map(row => {const p=project(row); const color=row.lostCovered?'#b83b51':row.newlyCovered?'#007b71':row.scenarioCovered?'#6e8095':'#a34b60'; return `<circle cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="4" fill="${color}"><title>${e(row.name)}</title></circle>`;}).join('');
  const marks = [...proposed,...sites].map((row,i)=>{const p=project(row);return `<rect x="${(p[0]-7).toFixed(2)}" y="${(p[1]-7).toFixed(2)}" width="14" height="14" rx="3" fill="#174ec4" stroke="white" stroke-width="2"/><text x="${(p[0]+10).toFixed(2)}" y="${(p[1]-8).toFixed(2)}" font-size="12" fill="#12335b">${i+1}</text>`;}).join('');
  return `<figure><svg viewBox="0 0 700 330" role="img" aria-label="계산에 사용한 실제 좌표의 분포도"><rect width="700" height="330" rx="12" fill="#f0f5fa"/>${circles}${marks}</svg><figcaption>좌표 분포도 · 배경지도·도로·지형을 표시하지 않은 도식입니다. 파랑: 신규 또는 비교 후보 / 청록: 새로 연결 / 회색: 연결 유지 / 자주: 남은 거리 조건 밖·연결 해제.</figcaption></figure>`;
}

export function decisionReportHtml({result, manifest, ai, question = '', regionName = ''}) {
  const baseline=result.baseline||{},scenario=result.scenario||{},parameters=result.parameters||{};
  const title=decisionWorkflowTitle(result.workflow),sources=decisionSources(result,manifest),created=result.generatedAt||new Date().toISOString();
  const isSite=result.workflow==='site',isInspection=result.workflow==='inspection',sites=array(result.context?.sites),locations=Number.isFinite(baseline.totalLocations);
  const targetUnit=sources.find(s=>s.id===result.preset?.target)?.unit||'수록 대상';
  const candidates=isSite?sites:array(scenario.proposedSites);
  const candidateRows=candidates.map((row,i)=>`<tr><td>${i+1}. ${e(row.name)}</td><td>${e(row.id)}</td><td>${e(xy(row)?.map(v=>v.toFixed(6)).join(', ')||'미제공')}</td>${isSite?'':`<td>${number(row.exclusiveLocationGain)}곳 / 원문 ${number(row.exclusiveGain)}개</td>`}</tr>`).join('');
  const allRows=array(result.rows),displayRows=allRows.slice(0,50);
  const rows=displayRows.map(row=>`<tr><td>${e(row.name)}<br><small>${e(row.id)}</small></td><td>${e(row.nearest?.name||'수록 없음')}<br>${Number.isFinite(row.nearest?.distanceM)?number(Math.round(row.nearest.distanceM))+'m':''}</td><td>${row.baselineCovered===true?'조건 이내':row.baselineCovered===false?'조건 밖':'미산정'}</td><td>${row.newlyCovered?'새로 연결':row.lostCovered?'연결 해제':row.scenarioCovered===true?'연결 유지':row.scenarioCovered===false?'남은 거리 조건 밖':'미산정'}${array(row.inspectionFlags).some(f=>f.state==='not-installed')?`<br>${e(array(row.inspectionFlags).filter(f=>f.state==='not-installed').map(f=>f.text||f.label).join(' / '))}`:''}</td><td>${e(xy(row)?.map(v=>v.toFixed(6)).join(', ')||'')}</td></tr>`).join('');
  const siteDetails=sites.flatMap((site,i)=>array(site.datasets).map(d=>`<tr><th>${i===0?'A':'B'} · ${e(site.name)}</th><td>${e(d.title||d.datasetId)}</td><td>${Number.isFinite(d.count)?number(d.count)+' '+e(d.unit||'수록 대상'):'미연결'}</td><td>${number(d.uniqueLocations)}</td><td>${e(d.nearest?.name||'수록 없음')}<br>${Number.isFinite(d.nearest?.distanceM)?number(d.nearest.distanceM)+'m':''}</td></tr>`)).join('');
  const evidence=array(result.evidence).slice(0,20).map(item=>`<li>${e(typeof item==='string'?item:item.text||item.summary||label(item))}</li>`).join('');
  const sourceHtml=sources.map(source=>{const url=safeUrl(source.sourceUrl||source.url||source.source?.url);return `<li><strong>${e(source.title||source.name||source.sourceName||source.id||source.datasetId)}</strong> · 기준 ${e(source.sourceDate||source.asOf||source.date||source.source?.date||'미제공')} · ${e(({available:'자료 수록','empty-complete':'제공 범위 내 0건',unavailable:'미연결'})[source.state]||source.status||'수록자료')}${Number.isFinite(source.acceptedPoints)?`<br>원자료 전체 ${number(source.acceptedPoints)}개 기록 · 고유좌표 ${number(source.uniqueLocations)}곳`:''} ${url?`· <a href="${e(url)}" rel="noreferrer">원자료</a>`:''}${source.coverageNote||source.coverage?`<br>${e(source.coverageNote||source.coverage)}`:''}</li>`;}).join('');
  const aiText=decisionAiText(ai);
  const metric=(name,value)=>`<div class="metric">${name}<b>${value}</b></div>`;
  const outcome=isSite?`<p>후보지 ${number(sites.length)}곳의 직선 반경 ${number(parameters.radiusM)}m에 있는 수록자료를 같은 조건으로 조회했습니다.</p>`:isInspection?`<div class="metrics">${metric('수록 대상',number(baseline.total)+'개')}${metric('거리 조건 밖',number(baseline.uncovered)+'개')}</div><p>거리 조건과 원문에 제공된 확인사항을 바탕으로 점검 후보를 정리했습니다. 실제 시설 상태와 통행 여건은 현장에서 확인해야 합니다.</p>`:`<div class="metrics">${metric('현재 거리 조건 이내',number(locations?baseline.coveredLocations:baseline.covered)+' / '+number(locations?baseline.totalLocations:baseline.total))}${metric('변경안 거리 조건 이내',number(locations?scenario.coveredLocations:scenario.covered))}${metric('새로 조건에 포함된 위치',number(locations?scenario.newlyCoveredLocations:scenario.newlyCovered))}${metric('남은 거리 조건 밖 위치',number(locations?scenario.uncoveredLocations:scenario.uncovered))}</div><p>${locations?'동일 좌표를 한 곳으로 묶은 결과입니다. ':''}원문 ${e(targetUnit)} 기준: 현재 ${number(baseline.covered)}개 → 변경안 ${number(scenario.covered)}개 / 전체 ${number(baseline.total)}개. 새로운 연결 ${number(scenario.newlyCovered)}개, 연결 해제 ${number(scenario.lostCovered)}개.</p><p>직선거리 조건 ${number(parameters.radiusM)}m · 추가 후보 ${number(candidates.length)}곳. 대상 위치와 등록시설 사이의 거리를 다시 계산했습니다. 실제 이용자 수·보행시간·온도 저감·사업 효과를 뜻하지 않습니다.</p>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · ${e(regionName||result.regionId)}</title><style>body{font:15px/1.7 system-ui,"Noto Sans KR",sans-serif;color:#162c43;max-width:1040px;margin:36px auto;padding:0 24px}h1{font-size:28px;line-height:1.3}h2{font-size:20px;margin-top:30px}p,li,td{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px;border:1px solid #b9cad9;text-align:left;vertical-align:top}th{background:#edf3f8}small,figcaption{color:#41566b;font-size:12px}figure{margin:20px 0}svg{width:100%;max-height:360px}.callout{padding:16px;border-left:4px solid #067a71;background:#eaf6f2}.memo{white-space:pre-wrap}.metrics{display:flex;gap:14px;flex-wrap:wrap}.metric{flex:1;min-width:160px;border:1px solid #c2d2e0;border-radius:10px;padding:15px}.metric b{display:block;font-size:28px}.meta{color:#41566b}a{color:#154fb1}.dt-purpose-guide{margin:22px 0;padding:18px;border:1px solid #bed2df;border-radius:12px;background:#f5f9fc}.dt-purpose-guide h3{font-size:20px;margin:0 0 8px}.dt-purpose-guide h4{font-size:16px;margin:16px 0 6px}.dt-purpose-guide details{margin-top:14px}.dt-purpose-guide summary{font-weight:700}@media print{body{margin:0;padding:0;max-width:none}h2{break-after:avoid}tr,figure,.metric{break-inside:avoid}thead{display:table-header-group}@page{size:A4;margin:15mm}}</style></head><body><p class="meta">${e(regionName||result.regionId)} · 공개자료 기반 행정 검토</p><h1>${e(title)}</h1><p>${e(label(result.scope)||'선택 구역')} · 작성 ${e(created)} · 계산 ${e(result.version||'미제공')}</p>${question?`<p class="callout"><strong>검토 목적</strong><br>${e(question)}</p>`:''}${decisionPurposeHtml(result, result.preset, {expanded:true})}<h2>1. ${isSite?'후보지 비교':'현재와 변경안'}</h2>${outcome}${overviewSvg(result)}${!isInspection?`<h2>2. ${isSite?'비교한':'변경한'} 후보 위치</h2><table><thead><tr><th>후보</th><th>ID</th><th>경도, 위도</th>${isSite?'':'<th>이 후보만 빼면 다시 거리 조건 밖</th>'}</tr></thead><tbody>${candidateRows||`<tr><td colspan="${isSite?3:4}">신규 후보 없음</td></tr>`}</tbody></table>`:''}${!isSite&&!isInspection?`<p>이번 안에서 제외한 기존시설 ID: ${e(array(scenario.excludedServiceIds).join(', ')||'없음')}. 원자료의 실제 시설 상태는 변경하지 않았습니다.</p>`:''}${aiText?`<h2>${ai?.mode==='llm'?'AI 근거 검토메모':'계산 근거 검토메모'}</h2><p class="meta">현재 계산 결과에 근거한 담당자 검토용 초안</p><div class="memo">${e(aiText)}</div>`:''}${isSite?`<h2>후보별 주변자료</h2><table><thead><tr><th>후보</th><th>자료</th><th>반경 내 원문 대상</th><th>고유좌표</th><th>최근접 지점 / 직선거리</th></tr></thead><tbody>${siteDetails||'<tr><td colspan="5">주변 조회자료 없음</td></tr>'}</tbody></table>`:`<h2>대상별 위치와 선정 근거</h2><p>${number(allRows.length)}개 수록 대상 중 처음 ${number(displayRows.length)}개를 싣습니다. 전체 대상·출처·주변자료는 앱의 <strong>좌표 목록 CSV</strong>에 포함됩니다.</p><table><thead><tr><th>대상</th><th>최근접 기존시설</th><th>현재</th><th>변경안 / 점검 근거</th><th>경도, 위도</th></tr></thead><tbody>${rows||'<tr><td colspan="5">이 조건에서 비교할 대상 없음</td></tr>'}</tbody></table>`}${evidence?`<h2>계산의 주요 근거</h2><ul>${evidence}</ul><p class="meta">주요 근거를 최대 20개 수록했습니다. 대상 전체의 값은 CSV에서 확인할 수 있습니다.</p>`:''}<h2>자료와 적용 범위</h2><ul>${sourceHtml||'<li>출처 정보가 응답에 제공되지 않았습니다.</li>'}</ul><ul>${array(result.limitations).map(item=>`<li>${e(typeof item==='string'?item:label(item))}</li>`).join('')}</ul></body></html>`;
}
