// 수집 흐름의 본체: 받은 CSV → 판별 → 검증 → 서구 경계 필터 → 중복 정리 → GeoJSON 쓰기.
// 좌표를 만들어 내거나(지오코딩) 추정하지 않습니다. 좌표가 없는 행은 세어서 보고만 합니다.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { csvRows, detectEncoding } from './csv.mjs';
import { detectSource, resolveColumns } from './detect.mjs';
import { loadDongIndex, locate, metersBetween } from './geo.mjs';
import {
  addressMentionsDistrict, cleanText, dateFromFileName, normalizeAddress, normalizeDate, publicPhone, resolveCoordinates,
} from './normalize.mjs';
import { SOURCES, placeholderFor } from '../sources.mjs';

const SAMPLE_ROWS = 200;
const EXAMPLE_LIMIT = 20;
const HEAVY_LAYER_FEATURES = 3000;
const PERSONAL_COLUMN = /성명|이름|담당자|대표자|원장|휴대|핸드폰|주민등록|생년|이메일|e-?mail/i;
const CSV_EXTENSIONS = new Set(['.csv', '.txt', '.tsv']);

export const REASON_LABELS = {
  otherRegion: '다른 지역(서구 경계 밖) 행',
  outsideDistrict: '주소·자료는 서구인데 좌표가 서구 경계 밖',
  noCoordinates: '좌표 없음',
  invalidCoordinates: '좌표 값 오류(숫자 아님·한국 범위 밖)',
  projectedCoordinates: '경위도가 아닌 좌표계로 보임(변환하지 않음)',
  closedInSource: '원자료에 폐지·폐교로 표시',
  duplicate: '중복 행',
};

// ── 작은 도구들 ────────────────────────────────────────────────

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function shortHash(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 20);
}

function isoSeconds(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 한 줄에 시설 하나씩 쓰면 변경 내역(diff)을 사람이 읽기 쉽습니다. */
export function serializeCollection(collection) {
  const { features, type, ...rest } = collection;
  const head = JSON.stringify({ type: 'FeatureCollection', ...rest }).slice(0, -1);
  const body = features.map(feature => JSON.stringify(feature)).join(',\n');
  return `${head},"features":[\n${body}\n]}\n`;
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

function readCollection(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// ── 받은 파일 살펴보기 ─────────────────────────────────────────

function listInbox(inboxDir) {
  if (!existsSync(inboxDir)) return [];
  return readdirSync(inboxDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && !entry.name.startsWith('.') && !/^readme/i.test(entry.name) && !/\.md$/i.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 제목행과 앞쪽 표본 행만 읽습니다. */
function readHead(path) {
  const encoding = detectEncoding(path);
  const rows = [];
  for (const row of csvRows(path, encoding)) {
    rows.push(row);
    if (rows.length > SAMPLE_ROWS) break;
  }
  const headers = (rows.shift() || []).map(header => header.trim());
  return { encoding, headers, sampleRows: rows };
}

function inspectFile(inboxDir, name, sources) {
  const path = resolve(inboxDir, name);
  const extension = extname(name).toLowerCase();
  if (!CSV_EXTENSIONS.has(extension)) {
    const hint = ['.xlsx', '.xls'].includes(extension) ? '엑셀 파일은 읽지 않습니다. 포털에서 CSV로 받거나 엑셀에서 "CSV UTF-8"로 저장해 주세요.'
      : extension === '.zip' ? '압축 파일은 풀어서 안의 CSV를 넣어 주세요.'
      : 'CSV 파일만 처리합니다.';
    return { name, path, status: 'skipped', message: hint };
  }
  let head;
  try {
    head = readHead(path);
  } catch (error) {
    return { name, path, status: 'failed', message: error.message };
  }
  if (!head.headers.length) return { name, path, status: 'failed', message: '빈 파일이거나 제목행이 없습니다.' };
  const detection = detectSource(sources, name, head.headers, head.sampleRows);
  return { name, path, ...head, detection, status: detection.status };
}

// ── 한 행을 시설 후보로 바꾸기 ─────────────────────────────────

function buildHours(source, headers, row) {
  if (!source.hours) return undefined;
  const pick = alias => cleanText(row[headers.indexOf(alias)] ?? '', 80);
  const [start, end, closed] = source.hours.map(pick);
  const open = start && end ? `평일 ${start}~${end}` : '';
  return [open, closed ? `휴관 ${closed}` : ''].filter(Boolean).join(' / ');
}

function originalAttributes(headers, row, counters) {
  const kept = {};
  headers.forEach((header, index) => {
    if (!header) return;
    if (PERSONAL_COLUMN.test(header)) { counters.personalColumnsDropped.add(header); return; }
    kept[header] = cleanText(row[index], 300);
  });
  return kept;
}

function buildProperties(source, context) {
  const { get, id, name, date, collectedAt, place, headers, row, rowNumber, resolved, counters } = context;
  const provider = get('provider');
  const base = {
    id,
    name,
    category: source.category,
    sourceName: source.nationwide && provider ? `${source.sourceName} / ${provider}` : source.sourceName,
    sourceUrl: source.sourceUrl,
    sourceDate: date,
    collectedAt,
    note: source.note,
    dongName: place.dongName,
    dongId: place.dongId,
  };
  if (source.legacyProps) {
    return {
      ...base,
      originalAttributes: originalAttributes(headers, row, counters),
      sourceRow: rowNumber,
      address: get('address'),
      facilityType: get('type'),
      eventYear: null,
      ...(source.extraProps ? source.extraProps(context) : {}),
    };
  }
  const phone = publicPhone(get('phone'));
  if (phone.dropped) counters.phonesDropped++;
  const details = {};
  for (const [label, index] of Object.entries(resolved.details)) {
    const value = cleanText(row[index], 200);
    if (value) details[label] = value;
  }
  const props = {
    ...base,
    address: get('address') || get('addressLot'),
    phone: phone.phone,
    department: get('department'),
    [source.typeProp || 'facilityType']: get('type'),
  };
  if (source.statusProp) props[source.statusProp] = get('status');
  const hours = buildHours(source, headers, row);
  if (hours !== undefined) props.hours = hours;
  if (Object.keys(details).length) props.details = details;
  if (source.perFeatureGeometryMeaning) props.geometryMeaning = source.geometryMeaning;
  props.sourceRow = rowNumber;
  return { ...props, ...(source.staticProps || {}), ...(source.extraProps ? source.extraProps(context) : {}) };
}

function newCounters() {
  return {
    sourceRows: 0,
    swapped: 0,
    generatedNames: 0,
    phonesDropped: 0,
    noCoordinatesButDistrictAddress: 0,
    ambiguousDong: 0,
    personalColumnsDropped: new Set(),
    reasons: {},
    examples: [],
  };
}

function reject(counters, reason, example) {
  counters.reasons[reason] = (counters.reasons[reason] || 0) + 1;
  const worthShowing = reason !== 'otherRegion' && reason !== 'duplicate';
  if (worthShowing && counters.examples.length < EXAMPLE_LIMIT) counters.examples.push({ reason: REASON_LABELS[reason], ...example });
}

/** 파일 하나의 모든 행을 읽어 서구 안의 시설 후보를 모읍니다. */
function collectCandidates(source, file, dongIndex, counters) {
  const resolved = resolveColumns(source, file.headers);
  const { columns } = resolved;
  if (columns.lat < 0 || columns.lon < 0) {
    return { candidates: [], fatal: '위도·경도 열을 찾지 못했습니다. 이 도구는 주소를 좌표로 바꾸지(지오코딩) 않습니다.' };
  }
  const fileDate = dateFromFileName(file.name);
  const collectedAt = isoSeconds(statSync(file.path).mtime);
  const candidates = [];
  let rowNumber = 0;
  let headerSkipped = false;
  for (const row of csvRows(file.path, file.encoding)) {
    if (!headerSkipped) { headerSkipped = true; continue; }
    rowNumber++;
    counters.sourceRows++;
    const get = field => (columns[field] >= 0 ? cleanText(row[columns[field]]) : '');
    const address = get('address') || get('addressLot');
    const example = { file: file.name, sourceRow: rowNumber, name: get('name') || get('id'), address, longitude: cleanText(row[columns.lon], 30), latitude: cleanText(row[columns.lat], 30) };

    const coordinates = resolveCoordinates(row[columns.lon], row[columns.lat]);
    if (!coordinates.ok) {
      const inDistrictByText = addressMentionsDistrict(address);
      if (coordinates.reason === 'noCoordinates' && (inDistrictByText || !source.nationwide)) counters.noCoordinatesButDistrictAddress++;
      // 전국 파일에서 다른 지역의 좌표 누락은 서구 자료 품질과 무관하므로 예시에 올리지 않습니다.
      if (source.nationwide && !inDistrictByText) counters.reasons[coordinates.reason] = (counters.reasons[coordinates.reason] || 0) + 1;
      else reject(counters, coordinates.reason, example);
      continue;
    }
    const place = locate(dongIndex, coordinates.lon, coordinates.lat);
    if (!place.inDistrict) {
      const suspicious = !source.nationwide || addressMentionsDistrict(address);
      reject(counters, suspicious ? 'outsideDistrict' : 'otherRegion', example);
      continue;
    }
    const excluded = (source.exclude || []).find(rule => rule.pattern.test(get(rule.field)));
    if (excluded) { reject(counters, excluded.reason, example); continue; }

    if (coordinates.swapped) counters.swapped++;
    if (place.ambiguous) counters.ambiguousDong++;
    const idValue = get('id');
    const context = { get, rowNumber, id: idValue, headers: file.headers, row, resolved, counters, place, collectedAt };
    let name = get('name');
    if (!name) {
      name = source.makeName ? source.makeName(context) : `${source.title} ${rowNumber}`;
      if (source.fields.name) counters.generatedNames++;
    }
    const lon = coordinates.lon;
    const lat = coordinates.lat;
    const id = source.idPrefix + (idValue || shortHash(`${name}|${normalizeAddress(address)}|${lon.toFixed(7)}|${lat.toFixed(7)}`));
    const date = normalizeDate(get('date')) || fileDate;
    const properties = buildProperties(source, { ...context, id, name, date });
    candidates.push({
      id, name, date, address,
      dateBasis: normalizeDate(get('date')) ? 'column' : fileDate ? 'filename' : 'unknown',
      feature: { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties },
    });
  }
  return { candidates, collectedAt };
}

// ── 중복 정리 ──────────────────────────────────────────────────

function newer(a, b) {
  return (b.date || '') > (a.date || '') ? b : a;
}

/** 같은 관리번호(또는 같은 이름+주소)면 기준일이 더 최근인 행 하나만 남깁니다. */
function deduplicate(source, candidates, counters) {
  const byId = new Map();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (!existing) { byId.set(candidate.id, candidate); continue; }
    const far = metersBetween(existing.feature.geometry.coordinates, candidate.feature.geometry.coordinates) > 30;
    if (far && existing.name !== candidate.name) {
      // 번호만 우연히 같은 다른 시설: 지우지 않고 번호 뒤에 구분값을 붙입니다.
      const id = `${candidate.id}~${shortHash(candidate.name + candidate.address).slice(0, 6)}`;
      candidate.id = id;
      candidate.feature.properties.id = id;
      byId.set(id, candidate);
      continue;
    }
    byId.set(candidate.id, newer(existing, candidate));
    reject(counters, 'duplicate', {});
  }
  if (!source.dedupeNameAddress) return [...byId.values()];
  const byPlace = new Map();
  const result = [];
  for (const candidate of byId.values()) {
    const address = normalizeAddress(candidate.address);
    if (!address) { result.push(candidate); continue; }
    const key = `${candidate.name.replace(/\s+/g, '')}|${address}`;
    const existing = byPlace.get(key);
    if (!existing) { byPlace.set(key, candidate); result.push(candidate); continue; }
    reject(counters, 'duplicate', {});
    const winner = newer(existing, candidate);
    if (winner !== existing) { result[result.indexOf(existing)] = winner; byPlace.set(key, winner); }
  }
  return result;
}

function coincidentGroups(features) {
  const groups = new Map();
  for (const feature of features) {
    const key = feature.geometry.coordinates.join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature.properties.id);
  }
  return [...groups.values()].filter(ids => ids.length > 1);
}

/** 이미 있는 다른 공개본과 아주 가까운 점을 표시합니다(지우지 않고 알려만 줍니다). */
function markNearby(source, features, root) {
  if (!source.nearCheck) return null;
  const other = readCollection(resolve(root, source.nearCheck.file));
  if (!other?.features?.length) return null;
  let count = 0;
  for (const feature of features) {
    const near = other.features.find(item => item.geometry?.type === 'Point' &&
      metersBetween(item.geometry.coordinates, feature.geometry.coordinates) <= source.nearCheck.meters);
    if (near) { feature.properties.nearbyRecordId = near.properties.id; count++; }
  }
  return { comparedWith: source.nearCheck.file, label: source.nearCheck.label, withinMeters: source.nearCheck.meters, count,
    meaning: '같은 시설일 가능성이 있는 점의 수 · 자동으로 지우지 않았습니다.' };
}

// ── 메타데이터와 파일 쓰기 ─────────────────────────────────────

function byDong(features) {
  const counts = {};
  for (const feature of features) {
    const name = feature.properties.dongName || '동 경계선 위(미배정)';
    counts[name] = (counts[name] || 0) + 1;
  }
  return counts;
}

function dateSummary(candidates) {
  const dates = [...new Set(candidates.map(c => c.date).filter(Boolean))].sort();
  const bases = new Set(candidates.map(c => c.dateBasis));
  const basis = bases.has('column') ? '데이터기준일자 열'
    : bases.has('filename') ? '파일 이름의 날짜(_YYYYMMDD) · 원문 페이지의 기준일과 대조 필요'
    : '확인하지 못함 · 파일 이름 끝에 _YYYYMMDD 를 붙이면 기준일로 인식합니다';
  return {
    sourceDate: dates.length === 1 ? dates[0] : null,
    ...(dates.length > 1 ? { sourceDateRange: [dates[0], dates.at(-1)] } : {}),
    sourceDateBasis: basis,
  };
}

function buildMetadata(source, files, kept, counters, collectedAt, near) {
  const features = kept.map(candidate => candidate.feature);
  const groups = coincidentGroups(features);
  const rejectedReasons = Object.fromEntries(Object.entries(counters.reasons).sort());
  return {
    sourceName: source.metadataSourceName || source.sourceName,
    sourceUrl: source.sourceUrl,
    ...dateSummary(kept),
    collectedAt,
    collectedAtBasis: '내려받은 CSV 파일의 수정시각',
    sourceRows: counters.sourceRows,
    accepted: features.length,
    rejected: counters.sourceRows - features.length,
    rejectedReasons,
    rejectedReasonLabels: Object.fromEntries(Object.keys(rejectedReasons).map(key => [key, REASON_LABELS[key]])),
    swappedCoordinatesFixed: counters.swapped,
    noCoordinatesButDistrictAddress: counters.noCoordinatesButDistrictAddress,
    generatedNames: counters.generatedNames,
    phonesDropped: counters.phonesDropped,
    personalColumnsDropped: [...counters.personalColumnsDropped],
    state: 'published',
    scope: '18개 행정동 합집합 안 위치만',
    coverage: `공식 공개본 중 서구 행정동 경계 안 ${features.length}개 · 전수·최신성·현재 운영 여부는 확인하지 않았습니다.`,
    geometryMeaning: source.geometryMeaning,
    license: source.license,
    originalFile: files.map(file => file.name).join(', '),
    originalSha256: files.map(file => sha256Of(file.path)).join(', '),
    encoding: [...new Set(files.map(file => file.encoding))].join(', '),
    mappingVerified: source.verified,
    byDong: byDong(features),
    coincidentGroupCount: groups.length,
    coincidentGroups: groups.slice(0, 50),
    ...(near ? { nearExisting: near } : {}),
    excludedExamples: counters.examples,
    transform: '좌표는 원문 값 그대로(뒤바뀐 경도·위도만 교정) · 주소로 좌표를 만들지 않음 · 인명·개인 연락처 열 수집하지 않음',
    ingestedBy: 'scripts/data/ingest.mjs',
  };
}

function assemble(source, target, features, metadata) {
  if (!source.merge) return { type: 'FeatureCollection', metadata, features };
  const existing = readCollection(target) || { features: [], metadata: {} };
  const preserved = existing.features.filter(feature => !source.merge.replaceWhere(feature));
  const ids = new Set(features.map(feature => feature.properties.id));
  const dangling = preserved.flatMap(feature => feature.properties?.pairedOfficialIds || []).filter(id => !ids.has(id));
  return {
    type: 'FeatureCollection',
    metadata: { ...existing.metadata, officialPoints: { ...metadata, preservedOtherSourceFeatures: preserved.length, unmatchedPairedOfficialIds: [...new Set(dangling)] } },
    features: [...features, ...preserved],
  };
}

function countExisting(source, collection) {
  if (!collection?.features) return null;
  return source.merge ? collection.features.filter(source.merge.replaceWhere).length : collection.features.length;
}

function processSource(source, files, options, dongIndex) {
  const counters = newCounters();
  const target = resolve(options.outRoot, source.target);
  const result = { key: source.key, title: source.title, verified: source.verified, target: source.target, layerId: source.layerId,
    files: files.map(file => ({ name: file.name, encoding: file.encoding })), warnings: [] };
  let candidates = [];
  let collectedAt = null;
  for (const file of files) {
    const collected = collectCandidates(source, file, dongIndex, counters);
    if (collected.fatal) {
      return { ...result, state: 'failed', message: collected.fatal, headers: file.headers };
    }
    candidates = candidates.concat(collected.candidates);
    if (!collectedAt || collected.collectedAt > collectedAt) collectedAt = collected.collectedAt;
  }
  const kept = deduplicate(source, candidates, counters);
  const features = kept.map(candidate => candidate.feature);
  const near = markNearby(source, features, options.outRoot);
  const metadata = buildMetadata(source, files, kept, counters, collectedAt, near);
  const before = countExisting(source, readCollection(target));
  Object.assign(result, { metadata, sourceRows: counters.sourceRows, accepted: features.length, before });

  if (!features.length) {
    return { ...result, state: 'nothing-accepted', message: '서구 경계 안에서 쓸 수 있는 좌표 행이 없어 기존 파일을 그대로 두었습니다.' };
  }
  if (source.layerId && features.length > HEAVY_LAYER_FEATURES) result.warnings.push(`점이 ${features.length}개로 많아 지도 첫 화면이 느려질 수 있습니다.`);
  if (metadata.sourceDate === null && !metadata.sourceDateRange) result.warnings.push('기준일을 확인하지 못했습니다. 원문 페이지의 기준일을 확인해 파일 이름 끝에 _YYYYMMDD 를 붙여 다시 실행하세요.');
  if (source.verified !== 'real-file') result.warnings.push('이 자료의 열 이름 연결은 실제 파일로 검증되지 않았습니다. "읽은 열" 줄을 한 번 확인하세요.');

  // 이전보다 절반 아래로 줄면 일부만 받은 파일일 수 있으므로, --force 없이는 덮어쓰지 않습니다.
  if (before && features.length < before / 2 && !options.force) {
    return { ...result, state: 'needs-confirmation', message: `이전 ${before}개보다 크게 줄어(${features.length}개) 저장하지 않았습니다. 파일이 온전한지 확인한 뒤, 맞다면 --force 를 붙여 다시 실행하세요.` };
  }
  const text = serializeCollection(assemble(source, target, features, metadata));
  const unchanged = existsSync(target) && readFileSync(target, 'utf8') === text;
  if (options.dryRun) return { ...result, state: unchanged ? 'unchanged' : 'dry-run' };
  if (!unchanged) writeAtomic(target, text);
  return { ...result, state: unchanged ? 'unchanged' : 'written' };
}

/** 지도 목록에 올라 있는 공식 층은 자료를 받기 전에도 "미연결" 자리표시 파일이 있어야 합니다. */
export function ensurePlaceholders(outRoot, sources = SOURCES) {
  const created = [];
  for (const source of sources) {
    const target = resolve(outRoot, source.target);
    if (existsSync(target)) continue;
    writeAtomic(target, JSON.stringify(placeholderFor(source)) + '\n');
    created.push(source.target);
  }
  return created;
}

/** 어떤 열을 무엇으로 읽었는지 사람이 확인할 수 있게 정리합니다. */
function describeColumns(source, headers) {
  const { columns, details } = resolveColumns(source, headers);
  const used = {};
  for (const [field, index] of Object.entries(columns)) if (index >= 0) used[field] = headers[index];
  for (const [label, index] of Object.entries(details)) used[`details.${label}`] = headers[index];
  const usedHeaders = new Set(Object.values(used));
  return { used, unused: headers.filter(header => header && !usedHeaders.has(header)) };
}

/**
 * 수집 실행.
 * options: { root, inboxDir, outRoot, dryRun, sources }
 * 반환값은 화면 출력과 시험에서 함께 씁니다.
 */
export function runIngest(options) {
  const root = options.root;
  const settings = { outRoot: root, dryRun: false, force: false, sources: SOURCES, inboxDir: resolve(root, 'data-inbox'), ...options };
  const dongIndex = loadDongIndex(root);
  const inspected = listInbox(settings.inboxDir).map(name => inspectFile(settings.inboxDir, name, settings.sources));
  const groups = new Map();
  for (const file of inspected) {
    if (file.status !== 'matched') continue;
    const key = file.detection.source.key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  const results = [];
  for (const [key, files] of groups) {
    const source = settings.sources.find(item => item.key === key);
    const result = processSource(source, files, settings, dongIndex);
    result.columns = describeColumns(source, files[0].headers);
    result.detectedBy = files[0].detection.forced ? '파일 이름 앞의 키 지정' : files[0].detection.partial ? '파일 이름(제목행은 일부만 일치)' : '제목행';
    results.push(result);
  }
  const placeholders = settings.dryRun ? [] : ensurePlaceholders(settings.outRoot, settings.sources);
  return {
    dryRun: settings.dryRun,
    inbox: relative(root, settings.inboxDir) || basename(settings.inboxDir),
    files: inspected,
    results,
    placeholders,
    changed: results.some(result => result.state === 'written') || placeholders.length > 0,
  };
}
