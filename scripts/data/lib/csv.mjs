// CSV 읽기 도구: 인코딩 판별(UTF-8 / CP949) + 따옴표·줄바꿈을 견디는 스트리밍 파서.
// 외부 패키지 없이 Node 22 내장 기능만 사용합니다.
import { openSync, readSync, closeSync } from 'node:fs';

const CHUNK_BYTES = 1024 * 1024;

/** 파일을 1MB씩 읽어 바이트 조각을 차례로 돌려줍니다. */
function* fileChunks(path) {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    for (;;) {
      const read = readSync(fd, buffer, 0, CHUNK_BYTES, null);
      if (!read) break;
      yield Uint8Array.prototype.slice.call(buffer, 0, read);
    }
  } finally {
    closeSync(fd);
  }
}

function startsWith(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

/** CP949(EUC-KR) 변환기. 일부 축소판 Node에는 없으므로 실패 사유를 한국어로 알려줍니다. */
export function koreanDecoder() {
  try {
    return new TextDecoder('euc-kr');
  } catch {
    throw new Error(
      '이 Node.js에는 한글(CP949/EUC-KR) 변환 기능이 들어 있지 않습니다. ' +
      '공식 Node.js 22를 설치하거나, 엑셀에서 파일을 "CSV UTF-8(쉼표로 분리)"로 다시 저장한 뒤 넣어 주세요.'
    );
  }
}

/**
 * 인코딩 판별. BOM이 있으면 그대로 따르고, 없으면 파일 전체가 올바른 UTF-8인지 확인합니다.
 * UTF-8이 아니면 한국 공공기관 CSV의 관행대로 CP949로 봅니다.
 */
export function detectEncoding(path) {
  const strict = new TextDecoder('utf-8', { fatal: true });
  let first = true;
  try {
    for (const chunk of fileChunks(path)) {
      if (first) {
        first = false;
        if (startsWith(chunk, [0xef, 0xbb, 0xbf])) return 'utf-8';
        if (startsWith(chunk, [0xff, 0xfe])) return 'utf-16le';
      }
      strict.decode(chunk, { stream: true });
    }
    strict.decode();
    return 'utf-8';
  } catch {
    return 'euc-kr';
  }
}

function decoderFor(encoding) {
  if (encoding === 'euc-kr') return koreanDecoder();
  return new TextDecoder(encoding);
}

/** 첫 줄에서 구분자를 고릅니다(쉼표가 기본, 탭·세미콜론·세로선 파일도 허용). */
export function detectDelimiter(firstLine) {
  const counts = { ',': 0, '\t': 0, ';': 0, '|': 0 };
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/**
 * 글자 조각을 받아 행(문자열 배열)을 만들어 내는 상태기계.
 * - "따옴표 안의 쉼표·줄바꿈", "" (따옴표 이스케이프), CRLF/LF/CR 모두 처리
 * - 형식이 조금 어긋난 파일도 멈추지 않고 최대한 그대로 읽습니다.
 */
export class CsvParser {
  constructor(delimiter = ',') {
    this.delimiter = delimiter;
    this.row = [];
    this.cell = '';
    this.state = 'start'; // start | plain | quoted | quoteEnd
    this.skipLineFeed = false;
    this.rows = [];
  }

  endCell() {
    this.row.push(this.cell);
    this.cell = '';
    this.state = 'start';
  }

  endRow() {
    this.endCell();
    if (this.row.some(value => value.trim() !== '')) this.rows.push(this.row);
    this.row = [];
  }

  push(text) {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (this.skipLineFeed) {
        this.skipLineFeed = false;
        if (char === '\n') continue;
      }
      if (this.state === 'quoted') {
        if (char === '"') this.state = 'quoteEnd';
        else this.cell += char;
        continue;
      }
      if (this.state === 'quoteEnd' && char === '"') {
        this.cell += '"';
        this.state = 'quoted';
        continue;
      }
      if (char === this.delimiter) this.endCell();
      else if (char === '\n') this.endRow();
      else if (char === '\r') { this.endRow(); this.skipLineFeed = true; }
      else if (char === '"' && this.state !== 'quoteEnd' && this.cell.trim() === '') { this.cell = ''; this.state = 'quoted'; }
      else { this.cell += char; this.state = 'plain'; }
    }
    const done = this.rows;
    this.rows = [];
    return done;
  }

  finish() {
    if (this.cell !== '' || this.row.length) this.endRow();
    const done = this.rows;
    this.rows = [];
    return done;
  }
}

/** 파일의 모든 행을 차례로 돌려줍니다(첫 행 = 제목행). 큰 전국 파일도 메모리에 통째로 올리지 않습니다. */
export function* csvRows(path, encoding = detectEncoding(path)) {
  const decoder = decoderFor(encoding);
  let parser = null;
  let head = '';
  for (const chunk of fileChunks(path)) {
    let text = decoder.decode(chunk, { stream: true });
    if (!parser) {
      head += text;
      if (!/[\r\n]/.test(head) && head.length < 65536) continue;
      head = head.replace(/^﻿/, '');
      parser = new CsvParser(detectDelimiter(head.split(/\r?\n|\r/)[0]));
      text = head;
    }
    yield* parser.push(text);
  }
  const tail = decoder.decode();
  if (!parser) {
    head = (head + tail).replace(/^﻿/, '');
    parser = new CsvParser(detectDelimiter(head.split(/\r?\n|\r/)[0]));
    yield* parser.push(head);
  } else if (tail) {
    yield* parser.push(tail);
  }
  yield* parser.finish();
}

/** 문자열 하나를 통째로 파싱(시험·작은 자료용). */
export function parseCsvText(text) {
  const clean = text.replace(/^﻿/, '');
  const parser = new CsvParser(detectDelimiter(clean.split(/\r?\n|\r/)[0] || ''));
  return [...parser.push(clean), ...parser.finish()];
}
