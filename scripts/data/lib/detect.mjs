// 파일 알아보기: 제목행(열 이름)을 먼저 보고, 파일 이름·값의 생김새로 보조 판정합니다.
import { normalizeHeader, findColumn, findCoordinateColumn } from './normalize.mjs';

/** 연결표의 fields 를 실제 열 번호로 바꿉니다. */
export function resolveColumns(source, headers) {
  const normalized = headers.map(normalizeHeader);
  const columns = {};
  for (const [field, aliases] of Object.entries(source.fields)) {
    columns[field] = field === 'lat' ? findCoordinateColumn(normalized, aliases, '위도')
      : field === 'lon' ? findCoordinateColumn(normalized, aliases, '경도')
      : findColumn(normalized, aliases);
  }
  const details = {};
  for (const [label, aliases] of Object.entries(source.details || {})) {
    const index = findColumn(normalized, aliases);
    if (index >= 0) details[label] = index;
  }
  return { columns, details };
}

function fileNameHit(name, keywords = []) {
  const plain = name.normalize('NFC').toLowerCase();
  return keywords.some(keyword => plain.includes(keyword.toLowerCase()));
}

function sampleHit(rule, source, headers, sampleRows) {
  const normalized = headers.map(normalizeHeader);
  const index = findColumn(normalized, source.fields[rule.field] || []);
  return index >= 0 && sampleRows.some(row => rule.pattern.test(row[index] || ''));
}

/** 한 자료(연결표 항목)가 이 파일과 얼마나 맞는지 점수로 계산합니다. */
export function scoreSource(source, fileName, headers, sampleRows) {
  const normalized = headers.map(normalizeHeader);
  const detect = source.detect;
  const missing = detect.headers.filter(group => findColumn(normalized, group) < 0 &&
    !(group.includes('위도') && findCoordinateColumn(normalized, group, '위도') >= 0) &&
    !(group.includes('경도') && findCoordinateColumn(normalized, group, '경도') >= 0));
  const blocked = (detect.absent || []).some(group => findColumn(normalized, group) >= 0);
  const headerMatch = missing.length === 0 && !blocked;
  const nameMatch = fileNameHit(fileName, detect.filename);
  let score = 0;
  if (headerMatch) score += 100 + detect.headers.length;
  if (nameMatch) score += 60;
  if (fileNameHit(fileName, detect.filenameAgainst)) score -= 200;
  for (const rule of detect.values || []) if (sampleHit(rule, source, headers, sampleRows)) score += 20;
  for (const rule of detect.valuesAgainst || []) if (sampleHit(rule, source, headers, sampleRows)) score -= 40;
  const isCoordinateGroup = group => group.includes('위도') || group.includes('경도');
  const signatureHits = detect.headers.filter(group => !isCoordinateGroup(group) && !missing.includes(group)).length;
  return { source, score, headerMatch, nameMatch, missing, blocked, signatureHits };
}

/** 파일 이름 맨 앞에 [키] 또는 키__ 를 붙이면 자동 판정 대신 그 자료로 처리합니다. */
function forcedKey(fileName, sources) {
  const match = /^\[([a-z0-9-]+)\]|^([a-z0-9-]+)__/i.exec(fileName);
  const key = match?.[1] || match?.[2];
  return sources.find(source => source.key === key) || null;
}

/**
 * 반환: { status: 'matched' | 'ambiguous' | 'unknown', source?, candidates }
 * candidates 는 사람이 읽을 안내문을 만들 때 씁니다.
 */
export function detectSource(sources, fileName, headers, sampleRows) {
  const forced = forcedKey(fileName, sources);
  if (forced) return { status: 'matched', source: forced, forced: true, candidates: [] };
  const scored = sources.map(source => scoreSource(source, fileName, headers, sampleRows))
    .sort((a, b) => b.score - a.score);
  const usable = scored.filter(item => item.score >= 60 && (item.headerMatch || item.nameMatch));
  if (!usable.length) {
    const close = scored.filter(item => item.signatureHits > 0).sort((a, b) => b.signatureHits - a.signatureHits);
    return { status: 'unknown', candidates: close.slice(0, 3) };
  }
  if (usable.length > 1 && usable[0].score === usable[1].score) return { status: 'ambiguous', candidates: usable.slice(0, 3) };
  return { status: 'matched', source: usable[0].source, candidates: usable.slice(0, 3), partial: !usable[0].headerMatch, missing: usable[0].missing };
}
