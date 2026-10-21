import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewDetailsHtml, reviewMemo, answerHtml, panelHtml} from '../src/city/ask-ai.js';
import {reviewFormHtml, notesListHtml, noteEditorHtml, noteReportHtml} from '../src/city/civic-review.js';
import {makeNote} from '../src/city/civic-review-model.js';

const payload = '<img src=x onerror=alert(1)> & "제안"';
const context = {theme: 'agenda', text: payload, alternatives: [payload]};
const review = {inputText: payload, scopeNote: '동 단위 수록자료', sourceScope: '입력에서 확인한 시설 종류', commonCriteria: ['접근성'], alternatives: [{title: payload, origin: 'user', focus: payload, checks: [payload]}], departments: [{name: payload, checks: [payload]}], discussionQuestions: [payload], missingData: ['운영시간']};
const result = {ok: true, mode: 'rules', answer: payload, brief: {title: '마을의제 검토자료', evidence: [{title: '공원', summary: '수록 2곳'}], review}, sources: [{name: '공개자료', url: 'javascript:alert(1)', date: '2026-10-21'}], steps: [], caveats: ['부분 수록자료'], map: {highlight: {type: 'FeatureCollection', features: []}}};
const snapshot = {question: payload, queryScope: '풍암동', dongId: '29140740', completedAt: '2026. 10. 21. (한국시간)', reviewContext: context, result};
const note = makeNote(snapshot, {id: 'test-note', now: '2026-10-21T00:00:00.000Z'});

test('review input, alternative and report markup keep supplied text inert', () => {
  const surfaces = [reviewFormHtml(context, '풍암동'), reviewDetailsHtml(review), notesListHtml([note]), noteEditorHtml(note), noteReportHtml(note), answerHtml({...snapshot, status: 'done', features: []})];
  for (const html of surfaces) {
    assert.doesNotMatch(html, /<img src=x|<script/i);
    assert.match(html, /&lt;img src=x/);
  }
  assert.doesNotMatch(answerHtml({...snapshot, status: 'done', features: []}), /href="javascript:/i);
  assert.match(noteReportHtml(note), /default-src 'none'/);
});

test('saved report retains evidence, user context and editable notes as separate sections', () => {
  const edited = {...note, owner: '주민자치 담당', due: '2026-11-04', status: '확인 필요', fieldNotes: '운영시간 현장 확인 예정'};
  const html = noteReportHtml(edited);
  for (const term of ['담당자 현장확인 메모', '주민자치 담당', '2026-11-04', '운영시간 현장 확인 예정', '사용자 제공 검토내용', '대안별 확인사항', '부서 협의 준비', '출처와 기준일', '부분 수록자료']) assert.ok(html.includes(term), term);
  const memo = reviewMemo(snapshot);
  assert.ok(memo.includes(payload));
  assert.ok(memo.includes('동 단위 수록자료'));
  assert.ok(memo.includes('검토 예시') === false);
});

test('linked review, restored result and local-only notes are explicit in the UI', () => {
  const linked = panelHtml({...snapshot, draft: '', status: 'done'}, '풍암동');
  assert.match(linked, /이 검토에 이어서 질문/);
  assert.match(linked, /새 질문으로 전환/);
  const plain = panelHtml({status: 'idle'}, '서구 전체');
  assert.doesNotMatch(plain, /이 검토에 이어서 질문/);
  assert.match(answerHtml({...snapshot, status: 'done', restored: true}), /현재 자료로 다시 조회한 결과가 아닙니다/);
  assert.match(notesListHtml([note]), /이 브라우저에만 저장/);
  assert.match(reviewDetailsHtml({...review, alternatives: [{title: '운영 조정', origin: 'template', checks: []}]}), /검토 예시/);
});
