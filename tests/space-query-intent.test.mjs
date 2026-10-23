import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSpaceQueryIntent, queryFromIntent} from '../shared/space-query-intent.js';

test('the actual Saturday question stays Saturday 10–12 rather than a default Monday evening', () => {
  const draft = parseSpaceQueryIntent('풍암동에서 토요일 10시부터 12시까지 주민 모임을 열 공간을 검토하고 싶어.', {regionId: 'seogu', dongId: 'pungam', scopeLabel: '풍암동'});
  assert.deepEqual(queryFromIntent(draft), {dayOfWeek: 6, start: '10:00', end: '12:00'});
  assert.equal(draft.regionId, 'seogu');
  assert.equal(draft.dongId, 'pungam');
  assert.equal(draft.ready, true);
});

test('explicit Korean periods and common time separators retain the intended hours', () => {
  for (const [question, start, end] of [
    ['토요일 오전 10시부터 오후 1시까지', '10:00', '13:00'],
    ['토요일 오전 10시부터 12시까지', '10:00', '12:00'],
    ['토요일 오후 2시부터 4시까지', '14:00', '16:00'],
    ['일요일 오후 12시~2시', '12:00', '14:00'],
    ['화요일 10~12', '10:00', '12:00'],
    ['금요일 18:30–21:00', '18:30', '21:00'],
    ['목요일 오후 2시 30분~오후 4시 15분', '14:30', '16:15'],
  ]) assert.deepEqual([parseSpaceQueryIntent(question).start, parseSpaceQueryIntent(question).end], [start, end], question);
});

test('ambiguous weekdays, multiple alternatives and unsupported overnight hours require confirmation', () => {
  assert.equal(parseSpaceQueryIntent('주말 10~12 주민 모임').dayOfWeek, null);
  assert.match(parseSpaceQueryIntent('주말 10~12 주민 모임').notices.join(' '), /토요일과 일요일/);
  assert.equal(parseSpaceQueryIntent('토요일 또는 일요일 10~12').dayOfWeek, null);
  assert.equal(parseSpaceQueryIntent('평일 오후 2~4').dayOfWeek, null);
  assert.equal(parseSpaceQueryIntent('토요일 10~12 또는 14~16').start, '');
  assert.equal(parseSpaceQueryIntent('토요일 22시부터 2시').start, '');
  assert.equal(parseSpaceQueryIntent('토요일 25~26').start, '');
  assert.deepEqual(queryFromIntent(parseSpaceQueryIntent('공간을 검토해줘')), {dayOfWeek: null, start: '', end: ''});
});

test('counts are request context, never a calculated capacity or a time range', () => {
  const draft = parseSpaceQueryIntent('순천에서 토요일 10~12시 주민 20명 모임');
  assert.equal(draft.participantCount, 20);
  assert.equal('capacity' in draft, false);
  assert.equal(parseSpaceQueryIntent('토요일 10~12명 모임').start, '');
  assert.equal(parseSpaceQueryIntent('토요일 10~12분 정도 모임').start, '');
});

test('calendar dates and ambiguous evening shorthand cannot silently change a requested time', () => {
  const dated = parseSpaceQueryIntent('2026-10-23 금요일 10~12시 주민 모임');
  assert.deepEqual(queryFromIntent(dated), {dayOfWeek: 5, start: '10:00', end: '12:00'});
  assert.equal(parseSpaceQueryIntent('금요일 저녁 7~9시 모임').start, '');
  assert.equal(parseSpaceQueryIntent('금요일 밤 10~12시 모임').start, '');
  assert.deepEqual(queryFromIntent(parseSpaceQueryIntent('금요일 저녁 18~21시 모임')), {dayOfWeek: 5, start: '18:00', end: '21:00'});
});
