// 실행 결과를 한국어로 읽기 쉽게 출력합니다.
import { REASON_LABELS } from './pipeline.mjs';

const STATE_TEXT = {
  written: '저장 완료',
  unchanged: '변경 없음(이미 같은 내용)',
  'dry-run': '미리보기(저장하지 않음)',
  'nothing-accepted': '반영 없음',
  'needs-confirmation': '확인 필요(저장하지 않음)',
  failed: '실패',
};
const VERIFIED_TEXT = {
  'real-file': '실제 원본 파일로 확인된 연결',
  memory: '기억에 의존한 연결(실제 파일 미검증)',
  'memory-uncertain': '기억에 의존한 연결(표준 파일 존재 자체가 미확인)',
};

function number(value) {
  return Number(value || 0).toLocaleString('ko-KR');
}

function printUnrecognised(file, log) {
  log(`\n✗ ${file.name}`);
  if (file.status === 'skipped' || file.status === 'failed') {
    log(`  ${file.message}`);
    return;
  }
  log(file.status === 'ambiguous'
    ? '  두 가지 이상의 자료와 똑같이 맞아 자동으로 고르지 못했습니다.'
    : '  어떤 자료인지 알아보지 못했습니다. 아무것도 저장하지 않았습니다.');
  log(`  읽은 인코딩: ${file.encoding}`);
  log(`  이 파일의 제목행(${file.headers.length}개 열): ${file.headers.join(' | ')}`);
  if (!file.detection.candidates.length) log('  · 열 이름이 비슷한 자료가 연결표에 없습니다.');
  for (const candidate of file.detection.candidates) {
    const missing = candidate.missing.map(group => group.slice(0, 3).join('/')).join(', ');
    log(`  · 후보 [${candidate.source.key}] ${candidate.source.title}` + (missing ? ` → 없는 열: ${missing}` : ' → 열은 맞음'));
  }
  log('  해결: 파일 이름 맨 앞에 [자료키] 를 붙이면 그 자료로 처리합니다. 예) [toilet]내려받은파일.csv');
  log('        열 이름이 달라서라면 scripts/data/sources.mjs 의 별칭 목록에 위 제목을 추가하세요.');
}

function printResult(result, log) {
  log(`\n■ ${result.title}  [${result.key}]`);
  log(`  파일: ${result.files.map(file => `${file.name} (${file.encoding})`).join(', ')}`);
  log(`  판별 근거: ${result.detectedBy} · ${VERIFIED_TEXT[result.verified] || result.verified}`);
  if (result.state === 'failed') {
    log(`  결과: 실패 — ${result.message}`);
    log(`  이 파일의 제목행: ${result.headers.join(' | ')}`);
    return;
  }
  const meta = result.metadata;
  log(`  원본 ${number(result.sourceRows)}행 → 서구 안 ${number(result.accepted)}개 채택 / ${number(meta.rejected)}행 제외`);
  for (const [reason, count] of Object.entries(meta.rejectedReasons)) log(`    - ${REASON_LABELS[reason] || reason}: ${number(count)}행`);
  if (meta.swappedCoordinatesFixed) log(`    - 경도·위도가 뒤바뀐 행을 바로잡음: ${number(meta.swappedCoordinatesFixed)}행`);
  if (meta.noCoordinatesButDistrictAddress) log(`    - 서구 자료인데 좌표가 없어 지도에 못 올린 행: ${number(meta.noCoordinatesButDistrictAddress)}행 (좌표를 만들어 넣지 않습니다)`);
  if (meta.generatedNames) log(`    - 이름 열이 비어 번호로 이름을 붙인 행: ${number(meta.generatedNames)}행`);
  if (meta.phonesDropped) log(`    - 휴대전화 등 대표번호가 아닌 연락처를 싣지 않은 행: ${number(meta.phonesDropped)}행`);
  if (meta.coincidentGroupCount) log(`    - 좌표가 완전히 같은 점 묶음: ${number(meta.coincidentGroupCount)}곳 (지우지 않고 기록만)`);
  if (meta.nearExisting) log(`    - ${meta.nearExisting.label}과 ${meta.nearExisting.withinMeters}m 이내인 점: ${number(meta.nearExisting.count)}개 (겹쳐 세지 않도록 주의)`);
  const dates = meta.sourceDate || (meta.sourceDateRange ? meta.sourceDateRange.join(' ~ ') : '확인 못함');
  log(`  자료 기준일: ${dates} (${meta.sourceDateBasis})`);
  log(`  내려받은 시각: ${meta.collectedAt}`);
  log(`  읽은 열: ${Object.entries(result.columns.used).map(([field, header]) => `${field}←${header}`).join(', ')}`);
  if (result.columns.unused.length) log(`  쓰지 않은 열: ${result.columns.unused.join(', ')}`);
  const before = result.before === null ? '없음' : `${number(result.before)}개`;
  log(`  저장 위치: ${result.target}  (이전 ${before} → 이번 ${number(result.accepted)}개)`);
  log(`  결과: ${STATE_TEXT[result.state]}${result.message ? ' — ' + result.message : ''}`);
  for (const example of meta.excludedExamples.slice(0, 5)) {
    log(`    제외 예시: ${example.sourceRow}행 ${example.name || ''} (${example.longitude}, ${example.latitude}) — ${example.reason}`);
  }
  for (const warning of result.warnings) log(`  ※ ${warning}`);
}

export function printSummary(summary, log = console.log) {
  log('서구:온 공공데이터 수집');
  log(`받은 파일 폴더: ${summary.inbox}${summary.dryRun ? '  (미리보기: 파일을 쓰지 않습니다)' : ''}`);
  if (!summary.files.length) {
    log('\n폴더에 처리할 CSV 파일이 없습니다. docs/DATA_INBOX.md 의 내려받기 목록을 참고하세요.');
    return;
  }
  for (const result of summary.results) printResult(result, log);
  for (const file of summary.files.filter(file => file.status !== 'matched')) printUnrecognised(file, log);
  const ok = summary.results.filter(result => ['written', 'unchanged', 'dry-run'].includes(result.state)).length;
  const problems = summary.results.length - ok + summary.files.filter(file => file.status !== 'matched').length;
  log(`\n요약: 파일 ${summary.files.length}개 중 자료 ${ok}종 처리, 확인 필요 ${problems}건`);
  log('주의: 개수는 공개본에 실린 행의 수이며 서구 시설 전체 목록이 아닙니다. 현장 확인·현재 운영 여부를 뜻하지 않습니다.');
}
