# 구조

빌드 도구와 외부 패키지가 없는 Node 22 ESM 프로젝트입니다. 브라우저가 `src/`의 모듈을 그대로 읽습니다.

```
index.html            첫 화면(뼈대와 고정 버튼)
classic.html          v0.2 자료 검수 화면(src/app.js)
src/city/             첫 화면의 모듈
api/*.js              Vercel 서버 함수(읽기 전용 GET, api/ai.js만 POST)
server/**             서버 함수가 쓰는 코드(브라우저로 나가지 않음)
public/               정적 자료(행정동 경계, 공개자료 GeoJSON, 브랜드 이미지)
vendor/               3D 엔진(Cesium) 압축본. 빌드 때 public/vendor/로 풀림
scripts/              dev 서버, 빌드, 점검
tests/                node:test 단위시험(*.test.mjs)과 오프라인 화면시험(*.py)
```

## 화면(src/city)

| 파일 | 역할 |
|---|---|
| `app.js` | 상태(`state`), 지도 엔진 전환, 클릭 위임, 기본 동작 |
| `actions.js` | **버튼 동작 등록소.** 새 기능은 여기에 등록 |
| `home-panel.js` | 왼쪽 홈 패널(주요 카드 · 더 보기)과 좁은 화면 서랍 |
| `heat-scenario.js` | 대표 시나리오 "폭염 그늘" |
| `ask-ai.js`, `ask-examples.js` | "지도에게 묻기" 패널과 예시 질문. 결과 지점은 `ask-result` 지도층으로 그림(`docs/AI_PANEL.md`) |
| `live-status.js`, `live-diagnostics.js` | 상단 관측정보와 미수신 원인 설명 |
| `label-layout.js` | 동 이름표 배치 계산(엔진 공통, 순수 함수). 선택 동 우선, 겹친 이름은 숨김 |
| `dong-labels-3d.js`, `dong-labels-dom.js` | 3D·OSM 지도의 동 이름 표시와 카메라 이동 시 재배치 |
| `viewer.js` | 지도 엔진 3종: 브이월드/도시모형(iframe), 경계도(canvas), OSM 경량지도(MapLibre) |
| `scene.js` | iframe 안에서 도는 Cesium 장면(브이월드 3D와 밝은 도시모형이 함께 씀) |
| `enhancements.js` → `experience.js`, `resilience-tools.js`, `finish-tools.js`, `safety-hub.js` | 인프라·기후·주제도·상황판·기록·재난안전 API 패널 |
| `style.css` → `appearance.css` → `identity.css` → `layout.css` | 뒤에 읽히는 파일이 앞의 것을 덮어씀. 배치 보정은 `layout.css` |

### 동 이름표 배치

`label-layout.js`는 화면 좌표를 받아 `name` 또는 `hidden` 상태를 돌려줍니다. 선택한 동의 전체 이름을 먼저 배치하고, 가까운 후보 위치에도 자리가 없으면 해당 이름을 숨깁니다. 확대·이동 시 각 엔진이 다시 계산하므로 읽을 공간이 생기면 이름이 나타납니다. 브이월드·밝은 도시모형에서 화면 좌표를 구하지 못하는 경우에는 선택한 동 이름만 표시합니다.

0.8.1에서 동 카드 숫자 배지, 번호표 범례 DOM·CSS, `dong-legend.js`, 번호 변환 함수와 범례 전달 이벤트를 제거했습니다. 동 카드의 공식 마을 BI와 이름, 동 선택 기능은 유지합니다.

### 버튼이 동작하는 순서

1. 화면의 모든 버튼은 `data-action="이름"`을 갖습니다. `app.js`가 `#app`의 클릭을 한 곳에서 받습니다.
2. `actions.js`에 등록된 동작이 있으면 그것을 실행합니다.
3. 없으면 `enhancements.action()`(인프라·기후·주제도 등), 그다음 `app.js`의 기본 `switch`로 넘어갑니다.

### 새 패널·동작 추가하기

```js
// src/city/my-feature.js
import {registerAction} from './actions.js';
export function installMyFeature(api) {
  registerAction('my-action', (button, api) => {
    api.show('패널 제목', '<p>내용 HTML</p>', 'my-view'); // 오른쪽 상세 패널을 연다
  });
}
```

`app.js`의 "확장 모듈 등록 위치" 주석 아래에 `installMyFeature(api);` 한 줄을 더하고, 버튼에 `data-action="my-action"`을 붙이면 됩니다.
`api`에는 `state, show, close, toast, fetchJSON, label, scoped, drawData, loadAPI, chooseDong, selectFeature, send, run`이 있습니다.
`api.run('다른-동작', {id: '값'})`으로 이미 있는 동작을 부를 수 있습니다.
패널 안의 입력값은 `document.getElementById`로 읽습니다. 패널 HTML에 넣는 외부 문자열은 반드시 `esc()`(catalog.js)로 감쌉니다.

### 지도 엔진과 주고받는 메시지

`app.js`는 `view.send({type, ...})`로 지도에 지시하고, 지도는 `onEvent({type, ...})`로 알립니다.
주요 메시지: `boundaries`(동 경계), `layer`(지도층), `camera`, `raster`, `sun`, `tool` / `ready`, `dong`, `select`, `point`.

## 서버(api, server)

| 경로 | 역할 |
|---|---|
| `api/city-config` | 버전과 "어떤 키가 설정됐는지"(true/false만) |
| `api/city-data?kind=…` | 제공기관 자료 조회. `server/city/providers.js`가 종류별로 분기 |
| `api/weather` | 기상청 초단기실황(`server/weather-service.js`) |
| `api/city-scene` | 브이월드 3D용 HTML(SDK 주소에 브라우저용 키 포함) |
| `api/city-wms` | 주제도 이미지 중계(허용된 호스트만) |
| `api/ai` | `/api/mcp`(MCP 서버, `server/spatial/mcp.js`)와 `/api/ask`(지도에게 묻기, `server/ai/ask.js`)를 한 함수로 받음. 둘 다 POST |

- `server/city/common.js`: 요청 제한(`gate`), 허용 호스트, 응답 크기·시간 제한, 결과코드 검사.
- `server/city/air-quality.js`: 에어코리아 측정소·측정값. `server/diagnostics.js`: 실패 원인 코드와 키 정리.
- `src/city/safety-catalog.js`, `server/city/safetydata.js`: 재난안전 API 10종의 공식 식별자·필드와 서버 조회·결과코드·위치 검수. 서비스별 키는 환경변수에서 읽습니다.
- 서버는 사용자가 준 주소로 요청하지 않습니다. 키는 환경변수에서만 읽고 응답·로그에 남기지 않습니다.

### 상습결빙구간 조회

전용 메뉴는 `safety-hub.js`에서 서구 전체를 우선 대상으로 열고 `/api/city-data?kind=sd-icing&dong=all`로 조회합니다. 서버는 Secret `SAFETYDATA_00120_KEY`를 사용해 공식 `DSSP-IF-00120` 엔드포인트를 호출합니다. 전국 원자료를 페이지별로 받아 지역명과 실제 서구 행정경계를 검수하며, 다른 지역의 서구 자료가 섞이지 않게 처리합니다.

API 원자료의 구간번호(`SCTN_NO`)와 지점 구분(`SE`)을 보존하고, 지점 수와 고유 구간번호 수를 분리합니다. 원자료가 점으로 제공되면 점으로 표시하며 이를 임의로 이어 구간 선형을 만들지 않습니다. 별도로 확보한 공개 구간 도형은 출처를 구분합니다. 키 설정, 인증 결과, 자료 수신, 위치 검수 상태도 각각 유지합니다. HTTP 200 안의 `resultCode: 32`는 등록 IP 오류로 처리합니다.

공식 명세: [재난안전데이터공유플랫폼 상습결빙구간](https://www.safetydata.go.kr/disaster-data/view?dataSn=111). 실제 확보자료·수신 검증은 [0.8.1 기록](v081/RELEASE.md), 환경변수 안내는 [API 설정](API_SETUP.md)을 참고하세요.

## 하지 않는 것

로그인·공동 데이터베이스·정기 자동수집은 없습니다. 사용자가 가져온 자료와 검토 기록은 브라우저 메모리에만 있습니다.
