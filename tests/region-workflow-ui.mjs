/**
 * Real browser integration check against an already running, keyless local server.
 * Run: SEOON_UI_BASE=http://127.0.0.1:4173 SEOON_UI_OUT=/tmp/seogu-v0100-ui node tests/region-workflow-ui.mjs
 * External browser requests and unrelated upstream API routes are blocked.
 * All entered observation/scenario data are explicitly fictional test records.
 */
import {createRequire} from 'node:module';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium} = createRequire(import.meta.url)('playwright');
const base = process.env.SEOON_UI_BASE || 'http://127.0.0.1:4173';
const out = resolve(process.env.SEOON_UI_OUT || '/tmp/seogu-v0100-ui');
const executablePath = process.env.SEOON_CHROMIUM || '/tmp/seogu-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell';
const fontconfig = process.env.SEOON_UI_FONTCONFIG;
const checks = [], runs = [];
await mkdir(out, {recursive: true});
function check(name, condition, detail = null) {
  checks.push({name, passed: !!condition, detail});
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
  if (!condition) throw Error(`${name}: ${JSON.stringify(detail)}`);
}
const browser = await chromium.launch({executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(fontconfig ? {env: {...process.env, FONTCONFIG_FILE: fontconfig}} : {})});

async function inspect(page, tag, stage) {
  const metrics = await page.evaluate(() => {
    const visible = node => {const rect = node.getBoundingClientRect(); return !node.closest('[hidden]') && rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';};
    const panel = document.querySelector('#detail-panel');
    const rect = panel && visible(panel) ? panel.getBoundingClientRect().toJSON() : null;
    const selector = '.space-twin p,.space-twin td,.space-twin th,.space-twin label,.space-twin small,.ask-panel p,.ask-panel li,.ask-panel small';
    const text = [...document.querySelectorAll(selector)].filter(node => visible(node) && !node.closest('details:not([open])')).map(node => ({text: node.textContent.trim().slice(0, 65), size: parseFloat(getComputedStyle(node).fontSize)}));
    const inputs = [...document.querySelectorAll('.space-twin input:not([type=checkbox]),.space-twin select,.space-twin textarea,.ask-panel input,#ask-quick-question')].filter(visible).map(node => ({id: node.id, size: parseFloat(getComputedStyle(node).fontSize), height: node.getBoundingClientRect().height}));
    const action = document.querySelector('[data-action="space-apply-query-draft"]') || document.querySelector('[data-action="ask-prepare-space"]');
    const actionRect = action?.getBoundingClientRect().toJSON();
    return {width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, panel: rect, smallText: text.filter(item => item.size < 14), inputs, action: actionRect,
      detailScrollHeight: document.querySelector('#detail-body')?.scrollHeight, detailClientHeight: document.querySelector('#detail-body')?.clientHeight};
  });
  await page.screenshot({path: `${out}/${tag}-${stage}.png`, fullPage: false});
  await writeFile(`${out}/${tag}-${stage}.json`, JSON.stringify(metrics, null, 2));
  check(`${tag}/${stage}: viewport has no horizontal overflow`, metrics.scrollWidth <= metrics.width + 1, metrics);
  if (metrics.panel) check(`${tag}/${stage}: detail panel fits viewport`, metrics.panel.x >= -1 && metrics.panel.right <= metrics.width + 1 && metrics.panel.bottom <= metrics.height + 1, metrics.panel);
  check(`${tag}/${stage}: visible workflow text is at least 14px`, !metrics.smallText.length, metrics.smallText);
  check(`${tag}/${stage}: workflow inputs remain 16px`, metrics.inputs.every(item => item.size >= 16), metrics.inputs);
  return metrics;
}

async function waitForRegion(page, region) {
  await page.waitForFunction(region => document.body.dataset.region === region && !!document.querySelector('.boundary-canvas'), region, {timeout: 30000});
  await page.locator('.region-menu-button').waitFor({state: 'visible'});
}
async function chooseRegion(page, region) {
  await page.locator('.region-menu-button').click();
  await page.locator(`.region-open[href*="region=${region}"]`).click();
  await waitForRegion(page, region);
}
async function openSpace(page) {
  let target = page.locator('[data-action="space-twin"]:visible').first();
  if (!await target.count()) {await page.locator('#show-panels').click(); target = page.locator('[data-action="space-twin"]:visible').first();}
  await target.click();
  await page.locator('.space-twin').waitFor();
}

for (const viewport of [{width: 1366, height: 768}, {width: 360, height: 800}]) {
  const tag = `${viewport.width}x${viewport.height}`, errors = [], blocked = [], requests = [];
  const context = await browser.newContext({viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true, reducedMotion: 'reduce'});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin && ['http:', 'https:'].includes(url.protocol)) {blocked.push(url.origin); return route.abort();}
    if (url.pathname.startsWith('/api/') && !['/api/region-profile', '/api/ask', '/api/space-review', '/api/city-config'].includes(url.pathname)) return route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({ok: false, code: 'NOT_CONFIGURED', error: '로컬 통합시험: 외부 API 미사용'})});
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (['/api/ask', '/api/space-review'].includes(new URL(request.url()).pathname)) requests.push({path: new URL(request.url()).pathname, data: request.postDataJSON()});});
  let stage = 'start';
  try {
    await page.goto(`${base}/?map=boundary`, {waitUntil: 'domcontentloaded'});
    await waitForRegion(page, 'seogu');
    check(`${tag}: Seogu boundary mode starts`, await page.locator('.dong-button').count() === 18);
    await inspect(page, tag, 'seogu-home');
    stage = 'region-menu';
    await page.locator('.region-menu-button').click();
    check(`${tag}: second region is a real selectable menu`, await page.locator('.region-open[href*="region=suncheon"]').count() === 1);
    await page.screenshot({path: `${out}/${tag}-region-menu.png`});
    await page.locator('.region-open[href*="region=suncheon"]').click();
    await waitForRegion(page, 'suncheon');
    check(`${tag}: Suncheon loads 24 districts`, await page.locator('.dong-button').count() === 24);
    check(`${tag}: Suncheon quick question is enabled`, await page.locator('#ask-quick-submit').isEnabled());
    await inspect(page, tag, 'suncheon-home');

    stage = 'question';
    const question = '장천동에서 토요일 10시부터 12시까지 주민 모임을 열 공간을 검토해줘';
    await page.locator('#ask-quick-question').fill(question);
    const askResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ask' && response.request().method() === 'POST');
    await page.locator('#ask-quick-submit').click();
    const answer = await (await askResponse).json();
    await page.locator('.ask-answer').waitFor();
    check(`${tag}: actual ask API uses Suncheon data`, answer.ok && answer.regionId === 'suncheon' && answer.map.highlight.features.length > 0, {mode: answer.mode, code: answer.code, count: answer.map?.highlight?.features?.length});
    check(`${tag}: keyless server reports rules fallback`, answer.mode === 'rules', {mode: answer.mode, code: answer.code});
    check(`${tag}: first result includes facts, missing evidence, next action`, await page.locator('.ask-decision-summary h3').allTextContents().then(values => values.join('|').includes('자료로 확인한 사실|아직 확인할 핵심|다음 행동')));
    await inspect(page, tag, 'question-result');

    stage = 'condition-draft';
    await page.locator('[data-action="ask-prepare-space"]').first().click();
    await page.locator('.space-query-draft').waitFor();
    const draft = await Promise.all(['#space-draft-day', '#space-draft-start', '#space-draft-end'].map(id => page.locator(id).inputValue()));
    check(`${tag}: question arrives as Saturday 10–12 draft`, JSON.stringify(draft) === JSON.stringify(['6', '10:00', '12:00']), draft);
    check(`${tag}: draft does not auto-confirm comparison`, await page.evaluate(() => JSON.parse(sessionStorage.getItem('seoon.space-twin.draft.v1.suncheon')).query.dayOfWeek === null));
    const draftMetrics = await inspect(page, tag, 'condition-draft');
    check(`${tag}: condition confirmation is visible without panel scrolling`, draftMetrics.action && draftMetrics.action.top >= draftMetrics.panel.top && draftMetrics.action.bottom <= draftMetrics.panel.bottom, {action: draftMetrics.action, panel: draftMetrics.panel});
    await page.locator('[data-action="space-apply-query-draft"]').click();
    await page.locator('[data-action="space-toggle"]').first().click();
    const selectedName = await page.locator('.space-candidate.is-selected strong').innerText();
    await page.locator('.space-steps [data-step="state"]').click();

    stage = 'draft-refresh';
    const evidence = `브라우저 통합시험 ${tag} 전용 가상 확인값. 실제 시설 운영 확인 아님.`;
    await page.locator('#space-observation-status').selectOption('closed');
    await page.locator('#space-observation-evidence').fill(evidence);
    check(`${tag}: unsaved observation is only a session draft`, await page.evaluate(() => !!JSON.parse(sessionStorage.getItem('seoon.space-twin.draft.v1.suncheon')).observations.length && !localStorage.getItem('seoon.space-twin.v1.suncheon')));
    await page.reload({waitUntil: 'domcontentloaded'});
    await waitForRegion(page, 'suncheon');
    await openSpace(page);
    check(`${tag}: unsaved observation survives refresh`, await page.locator('#space-observation-evidence').inputValue() === evidence);
    check(`${tag}: restored draft is clearly unconfirmed`, await page.locator('.space-local-note').first().innerText().then(text => text.includes('입력 초안을 복구')));
    await page.locator('#space-observation-form button[type="submit"]').click();
    await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('seoon.space-twin.v1.suncheon'))?.history?.length);
    check(`${tag}: explicit confirmation stores source fingerprint`, await page.evaluate(() => /^fnv1a64:/.test(Object.values(JSON.parse(localStorage.getItem('seoon.space-twin.v1.suncheon')).observations)[0].assetFingerprint)));

    stage = 'scenarios';
    await page.locator('#space-scenario-name').fill('가상시험 · 토요일 개방안');
    await page.locator('#space-scenario-opens').fill('10:00');
    await page.locator('#space-scenario-closes').fill('12:00');
    await page.locator('#space-scenario-note').fill('브라우저 시험용 운영 가정. 실제 운영안·사업효과가 아님.');
    await page.locator('#space-scenario-form button[type="submit"]').click();
    await page.locator('[data-action="space-new-scenario"]').click();
    await page.locator('#space-scenario-name').fill('가상시험 · 일부 시간 개방안');
    await page.locator('#space-scenario-opens').fill('11:00');
    await page.locator('#space-scenario-closes').fill('12:00');
    await page.locator('#space-scenario-form button[type="submit"]').click();
    await page.locator('.space-steps [data-step="compare"]').click();
    check(`${tag}: scenario editing retains requested comparison time`, JSON.stringify(await Promise.all(['#space-query-day', '#space-query-start', '#space-query-end'].map(id => page.locator(id).inputValue()))) === JSON.stringify(['6', '10:00', '12:00']));
    await page.locator('#space-query-form button[type="submit"]').click();
    check(`${tag}: baseline and two operating alternatives are separate`, await page.locator('.space-comparison thead th').count() === 4);
    check(`${tag}: omitted operating cost remains unpriced`, await page.locator('.space-comparison').innerText().then(text => text.includes('미산정') && !text.includes('0만원')));
    await page.locator('#space-current-result').scrollIntoViewIfNeeded();
    await inspect(page, tag, 'comparison');
    const table = await page.locator('.space-table-wrap').evaluate(node => ({scroll: node.scrollWidth, client: node.clientWidth, overflow: getComputedStyle(node).overflowX}));
    check(`${tag}: alternatives table can scroll without overflowing page`, ['auto', 'scroll'].includes(table.overflow) && (viewport.width > 400 || table.scroll > table.client), table);

    stage = 'explanation-snapshot-report';
    const reviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/space-review' && response.request().method() === 'POST');
    await page.locator('[data-action="space-explain"]').click();
    const review = await (await reviewResponse).json();
    await page.locator('.space-ai-result').waitFor();
    check(`${tag}: actual comparison API returns grounded fallback`, review.ok && review.mode === 'rules' && review.comparison.query.dayOfWeek === 6, {mode: review.mode, code: review.code, day: review.comparison?.query?.dayOfWeek});
    await page.locator('[data-action="space-save-snapshot"]').click();
    const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('seoon.space-twin.v1.suncheon')).snapshots.at(-1));
    check(`${tag}: snapshot retains original explanation`, snapshot.ai.answer === review.answer && snapshot.ai.evidenceId === review.evidenceId && snapshot.ai.comparisonFingerprint === review.comparisonFingerprint);
    const downloadEvent = page.waitForEvent('download');
    await page.locator('[data-action="space-report"]').click();
    const download = await downloadEvent;
    const reportPath = `${out}/${tag}-report.html`;
    await download.saveAs(reportPath);
    const report = await readFile(reportPath, 'utf8');
    check(`${tag}: downloaded report contains original space, evidence and explanation`, report.includes(selectedName) && report.includes(evidence) && report.includes(snapshot.ai.evidenceId) && report.includes('토요일 10:00–12:00'));
    const beforeRequests = requests.filter(request => request.path === '/api/space-review').length;
    await page.locator('summary').filter({hasText: '저장한 비교 결과'}).click();
    await page.locator('[data-action="space-restore-snapshot"]').first().click();
    check(`${tag}: restored snapshot does not call AI again`, beforeRequests === requests.filter(request => request.path === '/api/space-review').length);
    check(`${tag}: historical explanation is explicit`, await page.locator('.space-ai h3').innerText() === '저장 당시 설명');
    await page.locator('#detail-body').evaluate(node => {node.scrollTop = 0;});
    await inspect(page, tag, 'saved-report');

    stage = 'region-isolation';
    await chooseRegion(page, 'seogu');
    await openSpace(page);
    check(`${tag}: Suncheon records never populate Seogu workflow`, await page.locator('.space-twin').innerText().then(text => !text.includes(evidence) && !text.includes('가상시험 · 토요일 개방안')));
    check(`${tag}: regional confirmed records use separate keys`, await page.evaluate(() => !!localStorage.getItem('seoon.space-twin.v1.suncheon') && !localStorage.getItem('seoon.space-twin.v1.seogu')));
    await chooseRegion(page, 'suncheon');
    await openSpace(page);
    check(`${tag}: returning to Suncheon retains the original saved result`, await page.evaluate(() => JSON.parse(localStorage.getItem('seoon.space-twin.v1.suncheon')).snapshots.length === 1));
    check(`${tag}: no uncaught client errors`, !errors.length, errors);
    runs.push({viewport, passed: true, selectedName, requests, blockedOrigins: [...new Set(blocked)], errors});
  } catch (error) {
    console.error(`${tag} stopped at ${stage}: ${error.message}`);
    checks.push({name: `${tag}: workflow completion`, passed: false, stage, error: error.message});
    await page.screenshot({path: `${out}/${tag}-failure-${stage}.png`}).catch(() => {});
    await writeFile(`${out}/${tag}-failure-${stage}.html`, await page.content()).catch(() => {});
    runs.push({viewport, passed: false, stage, error: error.message, requests, blockedOrigins: [...new Set(blocked)], errors});
  } finally {await context.close();}
}
await browser.close();
await writeFile(`${out}/results.json`, JSON.stringify({base, scope: 'Local keyless server, boundary map, external browser services blocked. Fictional observations only; not an actual-user study.', generatedAt: new Date().toISOString(), checks, runs}, null, 2));
console.log(`Results: ${out}/results.json; ${checks.filter(item => item.passed).length}/${checks.length} checks passed.`);
if (checks.some(item => !item.passed)) process.exitCode = 1;
