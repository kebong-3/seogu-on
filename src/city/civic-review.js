/** 마을·공간 검토: 사용자 의견 → 공개자료 근거 → 담당자 검토노트. */
import {registerAction} from './actions.js';
import {esc} from './catalog.js';
import {reviewMemo, highlightFeatures} from './ask-ai.js';
import {MAX_NOTES, makeNote, updateNote, readNotes, writeNotes, serializeNotes, parseNotes, mergeNotes} from './civic-review-model.js';

export const REVIEW_THEMES = Object.freeze([
  {id: 'agenda', title: '마을의제', hint: '주민 의견을 지도 자료와 연결해 회의 안건으로 정리합니다.',
    example: '작성 예시: 주민들이 산책 중 쉴 곳과 세대가 함께 이용할 공간이 부족하다는 의견을 냈습니다. 마을회의에서 먼저 확인할 자료와 질문을 정리하고 싶습니다.',
    alternatives: ['기존 공원에 쉼터 보완', '기존 공공공간의 이용시간 확대']},
  {id: 'space', title: '공간 비교', hint: '후보지·사업 대안을 같은 기준으로 비교할 준비를 합니다.',
    example: '작성 예시: 주민이 잠시 쉬어 갈 공간을 마련하려 합니다. 공원 가장자리와 공공시설 앞 공간을 후보로 논의 중이며, 이용 대상과 접근성·관리 조건을 비교하고 싶습니다.',
    alternatives: ['공원 가장자리 활용', '공공시설 앞 공간 활용']},
  {id: 'reuse', title: '기존 공간 활용', hint: '새로 만들기 전에 기존 시설을 활용할 조건을 살펴봅니다.',
    example: '작성 예시: 주민 모임을 위한 공간이 필요합니다. 기존 공공시설의 빈 시간대를 함께 쓰는 안과 소규모 공간을 추가 마련하는 안을 검토하고 싶습니다.',
    alternatives: ['기존 공공시설 공동 이용', '소규모 공간 추가 마련']},
  {id: 'coordination', title: '사업 연계', hint: '사업 내용을 함께 놓고 부서 간 확인할 일을 정리합니다.',
    example: '작성 예시: 같은 생활권에서 보행환경 정비와 공원 개선을 검토 중입니다. 공사 범위와 시기는 아직 확정되지 않았고, 설계·일정·유지관리 협의가 필요합니다.',
    alternatives: ['일정·현장 점검 함께 조정', '사업별 시행 후 연결 부분 점검']},
]);
const VIEW = 'civic-review', NOTES_VIEW = 'civic-notes', NOTE_VIEW = 'civic-note';
const STATUSES = ['검토 중', '확인 필요', '검토 완료'];
const themeById = id => REVIEW_THEMES.find(item => item.id === id) || REVIEW_THEMES[0];
const shortDate = date => { try { return new Date(date).toLocaleDateString('ko-KR', {timeZone: 'Asia/Seoul'}); } catch { return ''; } };
const localNotice = '<p class="small civic-local-note">이 브라우저에만 저장됩니다. 다른 기기에서 이어가거나 보관하려면 JSON 백업을 내려받으세요.</p>';

export function reviewFormHtml(draft, scope) {
  const theme = themeById(draft.theme);
  return `<div class="civic-panel"><div class="civic-lead"><strong>우리 동네의 의견을, 검토할 안건으로.</strong><p>주민 의견이나 사업 구상을 적으면 지도 자료를 확인하고 대안·협의 질문을 함께 정리합니다.</p></div>`
    + '<div class="civic-inline-links"><button class="text-button" data-action="space-twin">공공공간 운영 대안 비교</button><button class="text-button" data-action="civic-notes">저장한 검토노트</button><button class="text-button" data-action="ask-ai">짧게 지도에게 묻기</button></div>'
    + `<form id="civic-review-form"><fieldset class="civic-theme-picker"><legend>어떤 검토를 할까요?</legend><div>${REVIEW_THEMES.map(item => `<label><input type="radio" name="civic-theme" value="${item.id}"${theme.id === item.id ? ' checked' : ''}><span>${item.title}</span></label>`).join('')}</div></fieldset>`
    + `<p id="civic-theme-hint" class="civic-theme-hint">${esc(theme.hint)}</p><p class="civic-scope">선택 구역 <strong id="civic-scope-name">${esc(scope)}</strong><span>선택 구역의 수록 시설을 참고합니다.</span></p>`
    + `<label class="civic-label" for="civic-review-text">검토할 내용 <small>필수</small></label><textarea id="civic-review-text" maxlength="1200" rows="6" required placeholder="어디에서, 누구에게 필요한 일인가요? 주민 의견·현황·검토 이유를 적어 주세요. 개인정보는 제외해 주세요.">${esc(draft.text || '')}</textarea>`
    + `<div class="civic-input-help"><button type="button" class="text-button" data-action="civic-fill-example">작성 예시 넣기</button><span id="civic-text-count">${(draft.text || '').length} / 1,200자</span></div>`
    + `<details class="civic-options"${draft.alternatives?.some(Boolean) ? ' open' : ''}><summary>비교할 대안이 있나요? <span>선택 · 최대 3개</span></summary><p class="small">검토 중인 안을 적어 주세요. 비워 두면 검토용 예시를 제시합니다.</p>${[0, 1, 2].map(index => `<label class="civic-label" for="civic-alt-${index}">대안 ${index + 1}</label><input id="civic-alt-${index}" data-civic-alt="${index}" type="text" maxlength="140" placeholder="예: 기존 공공시설의 운영시간 확대" value="${esc(draft.alternatives?.[index] || '')}">`).join('')}</details>`
    + '<p class="small civic-method-note">입력 내용은 검토할 의견으로 사용합니다. 실제 후보지의 여건·운영시간·사업비·추진일정은 별도 확인사항으로 남깁니다.</p><button class="primary full civic-submit" type="submit">지도 자료로 검토하기 <span aria-hidden="true">↗</span></button></form></div>';
}

export function notesListHtml(notes, error = '') {
  const sorted = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return `<div class="civic-panel"><div class="civic-lead"><strong>확인한 근거와 다음 할 일을 함께 보관하세요.</strong><p>AI 결과에 담당자·확인기한·현장 메모를 덧붙일 수 있습니다.</p></div>${localNotice}${error ? `<p class="civic-error" role="alert">${esc(error)}</p>` : ''}`
    + `<div class="civic-note-tools"><button class="primary" data-action="civic-review">새 검토</button><button class="secondary" data-action="civic-backup"${notes.length ? '' : ' disabled'}>JSON 백업</button><button class="secondary" data-action="civic-import">백업 가져오기</button></div><p class="small">저장 ${notes.length} / ${MAX_NOTES}개 · 가져오기는 기존 노트와 합칩니다. 같은 노트는 최근 수정본을 유지합니다.</p>`
    + (sorted.length ? `<ul class="civic-note-list">${sorted.map(note => `<li><button data-action="civic-open-note" data-id="${esc(note.id)}"><span class="civic-note-meta"><b>${esc(note.status)}</b><span>${esc(note.queryScope)}</span></span><strong>${esc(note.title)}</strong><span class="civic-note-foot">${esc(note.owner || '담당 미기록')}${note.due ? ` · 확인기한 ${esc(note.due)}` : ''}<small>수정 ${esc(shortDate(note.updatedAt))}</small></span></button></li>`).join('')}</ul>` : '<div class="civic-empty"><strong>아직 저장한 검토노트가 없습니다.</strong><p>마을·공간 검토 또는 지도 질문의 결과에서 ‘검토노트에 저장’을 누르세요.</p></div>')
    + '</div>';
}

export function noteEditorHtml(note, draft = note) {
  return `<div class="civic-panel"><div class="civic-inline-links"><button class="text-button" data-action="civic-notes">← 저장한 검토노트</button><button class="text-button" data-action="civic-note-result" data-id="${esc(note.id)}">지도·AI 결과 보기</button></div>`
    + `<p class="civic-scope"><strong>${esc(note.queryScope)}</strong><span>자료 작성 ${esc(note.completedAt || shortDate(note.createdAt))}</span></p><p class="small">저장 당시 결과입니다. 아래 관리 메모는 원래 답변과 출처를 바꾸지 않습니다.</p>`
    + `<form id="civic-note-form" data-note-id="${esc(note.id)}"><label class="civic-label" for="civic-note-title">노트 제목</label><input id="civic-note-title" name="title" maxlength="120" value="${esc(draft.title)}" required>`
    + `<div class="civic-edit-grid"><div><label class="civic-label" for="civic-note-status">진행상태</label><select id="civic-note-status" name="status">${STATUSES.map(status => `<option${draft.status === status ? ' selected' : ''}>${status}</option>`).join('')}</select></div><div><label class="civic-label" for="civic-note-due">확인기한</label><input id="civic-note-due" name="due" type="date" value="${esc(draft.due || '')}"></div></div>`
    + `<label class="civic-label" for="civic-note-owner">담당·협의 부서</label><input id="civic-note-owner" name="owner" maxlength="80" placeholder="예: 담당팀 / 협의할 업무 분야" value="${esc(draft.owner || '')}">`
    + `<label class="civic-label" for="civic-note-field">현장확인 메모</label><textarea id="civic-note-field" name="fieldNotes" rows="5" maxlength="4000" placeholder="현장에서 확인한 내용, 회의 결과, 다음 조치를 기록하세요.">${esc(draft.fieldNotes || '')}</textarea>`
    + '<p class="small" id="civic-note-dirty" aria-live="polite">수정한 내용은 아래 저장 버튼으로 반영합니다.</p><div class="civic-note-tools"><button class="primary" type="submit">노트 수정 저장</button><button class="secondary" type="button" data-action="civic-note-report">검토보고서 HTML</button></div></form>'
    + `<details class="civic-original"><summary>저장한 근거·답변 읽기</summary><pre>${esc(reviewMemo({...note, features: highlightFeatures(note.result.map)}))}</pre></details>${localNotice}`
    + `<details class="civic-delete"><summary>노트 삭제</summary><p class="small">필요한 기록은 먼저 JSON 백업으로 보관하세요. 이 브라우저에서 해당 노트가 삭제됩니다.</p><button class="secondary" data-action="civic-delete-note" data-id="${esc(note.id)}">이 노트 삭제</button></details></div>`;
}

/** 독립 HTML 보고서는 외부 코드·데이터를 읽지 않고, 저장 당시 내용을 그대로 인쇄한다. */
export function noteReportHtml(note) {
  const memo = reviewMemo({...note, features: highlightFeatures(note.result.map)});
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'"><title>${esc(note.title)} · 서구온 검토보고서</title><style>body{font:15px/1.75 system-ui,sans-serif;color:#152c43;background:white;max-width:820px;margin:40px auto;padding:0 24px}h1{font-size:25px;line-height:1.4}h2{font-size:18px;margin-top:28px}p,pre{overflow-wrap:anywhere}pre{font:inherit;white-space:pre-wrap}dl{display:grid;grid-template-columns:100px 1fr;border-top:1px solid #acb8c2}dt,dd{margin:0;padding:8px;border-bottom:1px solid #d8dfe5}dt{font-weight:700}.note{color:#4b5e70;font-size:13px}.print-help{background:#eef3f8;padding:12px}@media print{body{margin:0;max-width:none;padding:0}h1,h2{break-after:avoid}.print-help{display:none}@page{size:A4;margin:18mm}}</style></head><body><p class="note">서구:온 · 공간행정 검토보고서</p><h1>${esc(note.title)}</h1><p class="print-help">브라우저의 인쇄(Ctrl+P 또는 ⌘P)에서 종이로 출력하거나 PDF로 저장할 수 있습니다.</p><dl><dt>선택 구역</dt><dd>${esc(note.queryScope)}</dd><dt>진행상태</dt><dd>${esc(note.status)}</dd><dt>담당·협의</dt><dd>${esc(note.owner || '미기록')}</dd><dt>확인기한</dt><dd>${esc(note.due || '미기록')}</dd><dt>노트 수정</dt><dd>${esc(new Date(note.updatedAt).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'}))} (한국시간)</dd></dl><h2>담당자 현장확인 메모</h2><pre>${esc(note.fieldNotes || '기록 없음')}</pre><h2>저장한 답변·검토사항·근거</h2><pre>${esc(memo)}</pre><p class="note">저장 당시 자료와 담당자가 입력한 검토 기록입니다. 최종 결정 전 최신 자료·현장·실제 소관 업무를 확인하세요.</p></body></html>`;
}

export function installCivicReview(api, askUi) {
  const root = document.getElementById('app');
  const draft = {theme: 'agenda', text: '', alternatives: ['', '', '']};
  const editorDrafts = new Map();
  let activeNoteId = null;
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = '.json,application/json'; fileInput.hidden = true;
  fileInput.setAttribute('aria-label', '검토노트 JSON 백업 파일');
  root?.append(fileInput);

  function show(title, html, kind) {
    api.show(title, html, kind);
    const eyebrow = document.getElementById('detail-eyebrow');
    if (eyebrow) eyebrow.textContent = kind === VIEW ? '의견 → 지도 자료 → 대안·협의 준비' : '근거와 다음 할 일';
  }
  function getNotes() {
    const current = readNotes();
    if (current.error) throw current.error;
    return current.notes;
  }
  function showReview() { show('마을·공간 검토', reviewFormHtml(draft, api.label()), VIEW); }
  function showNotes(message = '') {
    activeNoteId = null;
    const stored = readNotes();
    show('저장한 검토노트', notesListHtml(stored.notes, message || stored.error?.message || ''), NOTES_VIEW);
  }
  function showNote(id) {
    const note = getNotes().find(item => item.id === id);
    if (!note) { showNotes(); api.toast('노트를 찾지 못했습니다. 목록을 확인하세요.'); return; }
    activeNoteId = id;
    show('검토노트', noteEditorHtml(note, editorDrafts.get(id) || note), NOTE_VIEW);
  }
  function collectReview() {
    const text = document.getElementById('civic-review-text');
    if (!text) return;
    draft.text = text.value;
    draft.theme = document.querySelector('input[name="civic-theme"]:checked')?.value || draft.theme;
    draft.alternatives = [0, 1, 2].map(index => document.getElementById(`civic-alt-${index}`)?.value || '');
  }
  async function submitReview() {
    collectReview();
    if (!draft.text.trim()) { api.toast('검토할 내용을 적어 주세요.'); document.getElementById('civic-review-text')?.focus(); return; }
    const context = {theme: draft.theme, text: draft.text.trim(), alternatives: draft.alternatives.map(value => value.trim()).filter(Boolean)};
    await askUi.ask(`${api.label()} ${themeById(draft.theme).title} 검토: 입력한 내용을 지도 자료와 함께 살펴보고, 대안과 부서 확인사항을 정리해줘.`, context);
  }
  function collectEditor() {
    const form = document.getElementById('civic-note-form');
    if (!form) return null;
    const fields = Object.fromEntries(['title', 'status', 'owner', 'due', 'fieldNotes'].map(name => [name, form.elements.namedItem(name)?.value || '']));
    editorDrafts.set(form.dataset.noteId, fields);
    return fields;
  }
  function saveEditor({refresh = true} = {}) {
    const patch = collectEditor();
    if (!patch || !activeNoteId) return null;
    const notes = getNotes();
    const index = notes.findIndex(item => item.id === activeNoteId);
    if (index < 0) throw Error('다른 창에서 삭제된 노트입니다. 목록을 다시 열어 주세요.');
    const updated = updateNote(notes[index], patch);
    notes[index] = updated;
    writeNotes(notes);
    editorDrafts.delete(activeNoteId);
    if (refresh) showNote(activeNoteId);
    return updated;
  }
  function saveResult() {
    const snapshot = askUi.getReviewSnapshot();
    if (!snapshot) { api.toast('조회가 완료된 결과에서 저장할 수 있습니다.'); return; }
    const notes = getNotes();
    const existing = notes.find(note => note.question === snapshot.question && note.completedAt === snapshot.completedAt && JSON.stringify(note.reviewContext) === JSON.stringify(snapshot.reviewContext));
    if (existing) { showNote(existing.id); api.toast('이미 저장한 결과의 검토노트를 열었습니다.'); return; }
    const note = makeNote(snapshot);
    writeNotes([...notes, note]);
    showNote(note.id);
    api.toast('이 브라우저에 검토노트를 저장했습니다.');
  }
  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], {type}));
    const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const dateStamp = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Seoul'});
  const offs = [
    registerAction('civic-review', showReview),
    registerAction('civic-notes', () => showNotes()),
    registerAction('civic-open-note', button => showNote(button.dataset.id)),
    registerAction('civic-fill-example', () => {
      // 기존 작성 내용을 예시로 덮어쓰지 않는다.
      collectReview();
      if (draft.text.trim() || draft.alternatives.some(value => value.trim())) { api.toast('작성 예시는 빈 입력칸에서 사용할 수 있습니다.'); return; }
      const theme = themeById(draft.theme);
      draft.text = theme.example; draft.alternatives = [...theme.alternatives, '']; showReview();
    }),
    registerAction('civic-edit-context', () => {
      const context = askUi.getReviewContext();
      if (context) { draft.theme = context.theme; draft.text = context.text; draft.alternatives = [...(context.alternatives || []), '', '', ''].slice(0, 3); }
      showReview();
    }),
    registerAction('civic-save-result', saveResult),
    registerAction('civic-note-result', button => {
      collectEditor();
      const note = getNotes().find(item => item.id === button.dataset.id);
      if (note) askUi.restoreReview(note);
    }),
    registerAction('civic-note-report', () => {
      const note = saveEditor();
      if (!note) return;
      download(`서구온_검토보고서_${dateStamp()}.html`, noteReportHtml(note), 'text/html;charset=utf-8');
      api.toast('노트를 저장하고 인쇄용 HTML 보고서를 내려받았습니다.');
    }),
    registerAction('civic-backup', () => {
      const notes = getNotes();
      if (!notes.length) { api.toast('저장한 검토노트가 없습니다.'); return; }
      download(`서구온_검토노트_백업_${dateStamp()}.json`, serializeNotes(notes), 'application/json;charset=utf-8');
      api.toast('검토노트 JSON 백업을 내려받았습니다.');
    }),
    registerAction('civic-import', () => fileInput.click()),
    registerAction('civic-delete-note', button => {
      const notes = getNotes();
      writeNotes(notes.filter(note => note.id !== button.dataset.id));
      editorDrafts.delete(button.dataset.id); showNotes(); api.toast('선택한 검토노트를 삭제했습니다.');
    }),
  ];
  const onInput = event => {
    if (event.target.closest?.('#civic-review-form')) {
      collectReview();
      const counter = document.getElementById('civic-text-count');
      if (counter) counter.textContent = `${draft.text.length} / 1,200자`;
    }
    if (event.target.closest?.('#civic-note-form')) {
      collectEditor();
      const status = document.getElementById('civic-note-dirty');
      if (status) status.textContent = '아직 저장하지 않은 수정사항이 있습니다.';
    }
  };
  const onChange = event => {
    if (event.target.name === 'civic-theme') {
      collectReview();
      const hint = document.getElementById('civic-theme-hint');
      if (hint) hint.textContent = themeById(draft.theme).hint;
    }
    if (event.target.closest?.('#civic-note-form')) onInput(event);
  };
  const onSubmit = event => {
    if (!['civic-review-form', 'civic-note-form'].includes(event.target.id)) return;
    event.preventDefault();
    Promise.resolve().then(() => event.target.id === 'civic-review-form' ? submitReview() : saveEditor()).then(() => {
      if (event.target.id === 'civic-note-form') api.toast('검토노트 수정사항을 저장했습니다.');
    }).catch(error => api.toast(error.message || '저장하지 못했습니다. 입력 내용을 확인하세요.'));
  };
  const onImport = async () => {
    try {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) throw Error('백업 파일은 3MB 이하만 가져올 수 있습니다.');
      const imported = parseNotes(await file.text());
      const merged = mergeNotes(getNotes(), imported);
      writeNotes(merged);
      editorDrafts.clear(); showNotes(); api.toast(`백업을 합쳤습니다. 현재 ${merged.length}개의 검토노트가 있습니다.`);
    } catch (error) { api.toast(error.message || '백업을 읽지 못했습니다. 기존 노트는 유지됩니다.'); }
    finally { fileInput.value = ''; }
  };
  root?.addEventListener('input', onInput); root?.addEventListener('change', onChange); root?.addEventListener('submit', onSubmit);
  fileInput.addEventListener('change', onImport);
  return {
    scopeChanged() { const label = document.getElementById('civic-scope-name'); if (label) label.textContent = api.label(); },
    destroy() { offs.forEach(off => off()); root?.removeEventListener('input', onInput); root?.removeEventListener('change', onChange); root?.removeEventListener('submit', onSubmit); fileInput.removeEventListener('change', onImport); fileInput.remove(); },
  };
}
