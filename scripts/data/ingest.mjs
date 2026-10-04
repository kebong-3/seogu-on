#!/usr/bin/env node
// 받은 CSV를 지도 자료로 바꾸는 한 줄 명령.
//   node scripts/data/ingest.mjs            → data-inbox/ 의 CSV를 읽어 public/data/ 아래에 저장
//   node scripts/data/ingest.mjs --dry-run  → 무엇이 바뀔지만 보여 주고 저장하지 않음
//   node scripts/data/ingest.mjs --inbox=다른폴더
//   node scripts/data/ingest.mjs --list     → 알아볼 수 있는 자료 목록
//   node scripts/data/ingest.mjs --force    → 이전보다 개수가 크게 줄어도 저장
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIngest } from './lib/pipeline.mjs';
import { printSummary } from './lib/report.mjs';
import { SOURCES } from './sources.mjs';
import { writeCoverage } from './build-coverage.mjs';
import { writeQualityReport } from './audit-quality.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

function printHelp() {
  console.log('사용법: node scripts/data/ingest.mjs [--dry-run] [--force] [--inbox=폴더] [--list]');
  console.log('자세한 안내: docs/DATA_INBOX.md');
}

function printList() {
  console.log('알아볼 수 있는 자료 (우선순위 순)');
  for (const source of [...SOURCES].sort((a, b) => a.priority - b.priority)) {
    const verified = source.verified === 'real-file' ? '실제 파일 확인' : '미검증(기억 기반)';
    console.log(`  [${source.key}] ${source.title} · ${verified}\n      ${source.sourceUrl}\n      → ${source.target}`);
  }
}

function main() {
  if (args.includes('--help') || args.includes('-h')) return printHelp();
  if (args.includes('--list')) return printList();
  const dryRun = args.includes('--dry-run');
  const inboxDir = resolve(root, option('inbox') || 'data-inbox');
  const summary = runIngest({ root, inboxDir, dryRun, force: args.includes('--force') });
  printSummary(summary);
  if (summary.changed) {
    const coverage = writeCoverage(root);
    const quality = writeQualityReport(root);
    console.log(`\n자료 현황표를 다시 만들었습니다: ${coverage.file} (${coverage.changed ? '갱신' : '변경 없음'})`);
    console.log(`자료 품질 점검표를 다시 만들었습니다: ${quality.file} (${quality.changed ? '갱신' : '변경 없음'})`);
  }
  const problems = summary.files.some(file => file.status !== 'matched') ||
    summary.results.some(result => ['failed', 'needs-confirmation'].includes(result.state));
  if (problems) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`수집을 끝내지 못했습니다: ${error.message}`);
  process.exitCode = 2;
}
