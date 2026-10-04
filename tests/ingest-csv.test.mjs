// CSV 읽기와 값 정리 도구 시험
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CsvParser, csvRows, detectDelimiter, detectEncoding, koreanDecoder, parseCsvText } from '../scripts/data/lib/csv.mjs';
import {
  addressMentionsDistrict, dateFromFileName, findColumn, findCoordinateColumn, normalizeDate, normalizeHeader, publicPhone, resolveCoordinates,
} from '../scripts/data/lib/normalize.mjs';

const fixture = name => fileURLToPath(new URL(`./fixtures/ingest/${name}`, import.meta.url));

test('ingest csv: quoted commas, escaped quotes and embedded newlines stay inside one cell', () => {
  const rows = parseCsvText('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', 'line1\nline2'], ['1', '2', '3']]);
});

test('ingest csv: BOM is removed, blank lines are skipped, last line without newline is kept', () => {
  assert.deepEqual(parseCsvText('\uFEFF이름,값\n\n가,1\n,\n나,2'), [['이름', '값'], ['가', '1'], ['나', '2']]);
});

test('ingest csv: parser gives the same rows when text arrives one character at a time', () => {
  const text = 'a,b\r\n"q ""1"", x","multi\r\nline"\r\nlast,row\r\n';
  const parser = new CsvParser(',');
  const rows = [];
  for (const char of text) rows.push(...parser.push(char));
  rows.push(...parser.finish());
  assert.deepEqual(rows, parseCsvText(text));
  assert.deepEqual(rows[1], ['q "1", x', 'multi\r\nline']);
});

test('ingest csv: delimiter is detected outside quotes', () => {
  assert.equal(detectDelimiter('"a,b"\tc\td'), '\t');
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.equal(detectDelimiter('단일열'), ',');
});

test('ingest csv: this Node can decode CP949 (EUC-KR)', () => {
  assert.equal(koreanDecoder().decode(Uint8Array.from([0xb1, 0xd7, 0xb4, 0xc3, 0xb8, 0xb7])), '그늘막');
});

test('ingest csv: CP949 file is detected and decoded, including a quoted multi-line cell', () => {
  const path = fixture('standard-heat-cp949.csv');
  assert.equal(detectEncoding(path), 'euc-kr');
  const rows = [...csvRows(path)];
  assert.equal(rows[0][0], '쉼터명칭');
  assert.equal(rows.length, 10);
  assert.equal(rows[2][0], '시험용 쉼터, 2호 "별관"\r\n(줄바꿈 포함)');
  assert.equal(rows[2][2], '광주광역시 서구 시험로 2, 2층');
});

test('ingest csv: UTF-8 with BOM is detected and the BOM never reaches the first header', () => {
  const path = fixture('swapped-columns_20260106.csv');
  assert.equal(detectEncoding(path), 'utf-8');
  assert.deepEqual([...csvRows(path)][0], ['연번', '종류', '경도', '위도']);
});

test('ingest normalize: header aliases ignore spaces, brackets and case', () => {
  assert.equal(normalizeHeader(' 위도 (WGS84) '), '위도wgs84');
  const headers = ['시설 명', 'WGS84위도', 'WGS84경도'].map(normalizeHeader);
  assert.equal(findColumn(headers, ['시설명']), 0);
  assert.equal(findCoordinateColumn(headers, ['위도'], '위도'), 1);
  assert.equal(findCoordinateColumn(['a위도b', 'c위도d'], ['위도'], '위도'), -1, '후보가 둘이면 추측하지 않음');
});

test('ingest normalize: coordinates are only swapped back when unambiguous', () => {
  assert.deepEqual(resolveCoordinates('126.88', '35.15'), { ok: true, lon: 126.88, lat: 35.15, swapped: false });
  assert.deepEqual(resolveCoordinates('35.15', ' 126.88 '), { ok: true, lon: 126.88, lat: 35.15, swapped: true });
  assert.equal(resolveCoordinates('', '35.15').reason, 'noCoordinates');
  assert.equal(resolveCoordinates('0', '0').reason, 'noCoordinates');
  assert.equal(resolveCoordinates('없음', '35.15').reason, 'invalidCoordinates');
  assert.equal(resolveCoordinates('35.15', '35.16').reason, 'invalidCoordinates', '둘 다 위도 범위면 고치지 않음');
  assert.equal(resolveCoordinates('189000.2', '283000.5').reason, 'projectedCoordinates');
});

test('ingest normalize: dates, file-name dates, phones and district text', () => {
  assert.equal(normalizeDate('20260106'), '2026-01-06');
  assert.equal(normalizeDate('2026.1.6.'), '2026-01-06');
  assert.equal(normalizeDate('2026-02-30'), null);
  assert.equal(normalizeDate(''), null);
  assert.equal(dateFromFileName('광주광역시_서구_그늘막설치현황_20260106.csv'), '2026-01-06');
  assert.equal(dateFromFileName('download(1).csv'), null);
  assert.deepEqual(publicPhone('062-360-7512'), { phone: '062-360-7512', dropped: false });
  assert.deepEqual(publicPhone('062)370-5805'), { phone: '062)370-5805', dropped: false });
  assert.deepEqual(publicPhone('1588-0000'), { phone: '1588-0000', dropped: false });
  assert.deepEqual(publicPhone('010-1234-5678'), { phone: '', dropped: true });
  assert.deepEqual(publicPhone(''), { phone: '', dropped: false });
  assert.equal(addressMentionsDistrict('전남광주통합특별시 서구 시험로 1'), true);
  assert.equal(addressMentionsDistrict('광주광역시 서구'), true);
  assert.equal(addressMentionsDistrict('부산광역시 서구 시험로 1'), false);
});
