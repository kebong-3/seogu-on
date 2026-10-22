# 공공공간 운영조건 디지털트윈 모델

`shared/space-twin-model.js`는 브라우저와 서버가 함께 사용하는 순수 ES 모듈이다. 공개된 실제 공간의 위치·식별자에 사용자가 기록한 현장 운영조건을 연결하고, 같은 공간에 대한 변경 가정을 다시 계산한다. AI는 이 모듈의 숫자를 설명하는 역할이며 숫자를 생성하거나 공간의 운영 여부를 확정하지 않는다.

## 1. 구현 범위와 의미

이 모델은 **공공공간 운영조건을 대상으로 한 행정 의사결정 지원 기능**이다. 다음 순환을 구현한다.

1. 공개 원자료의 공간을 실제 좌표와 원자료 ID로 연결한다.
2. 담당자가 확인일·근거·요일·시간을 기록한다.
3. 같은 요일·시간·선택 공간에 현재 기록과 최대 세 개의 변경안을 적용한다.
4. 계산 결과와 출처를 시점별로 저장한다.
5. 후속 현장 확인을 입력하면 다음 계산이 달라지고 이전 기록은 이력에 남는다.

이 범위에서 원자료–현황 기록–가정 비교–후속 확인의 연결을 제공한다. 자동 센서 동기화, 시설 제어, 수요 예측, 보행 네트워크, 예약 처리, 정책 효과의 인과 추정까지 구현한 도시 전체 모델은 아니다. 기록은 사용자가 작성한 현장 확인값이며 공식 검증이나 사용 승인과 같지 않다. 실무 도입 시 확인 책임자·공유 저장·권한·승인 절차를 별도로 연결해야 한다.

공간 수는 원자료의 **공간별 항목 수**다. 같은 건물의 회의실 여러 개가 별도 항목일 수 있다. 건물 수·이용자 수·서비스 수혜 인구로 바꾸어 표현하지 않는다.

## 2. 공개 함수

| 함수 | 역할 |
|---|---|
| `seedAssets(collectionOrFeatures, {regionId, datasetId})` | Point 원자료에서 공간 목록 생성 |
| `createWorkspace(regionId, {now}?)` | 빈 지역별 작업공간 생성 |
| `normalizeObservation(input, {now}?)` | 현장 확인값의 형식·날짜·근거 검사 |
| `observationState(observation, {now}?)` | `recorded`, `unknown`, `stale` 구분 |
| `recordObservation(workspace, assetId, input, {now}?)` | 현장 확인 저장, 이전 값·새 값의 이력 추가 |
| `normalizeScenario(input)` | 변경안 입력 정규화 |
| `upsertScenario(workspace, input, {now}?)` | 대안 생성 또는 명시 ID에 해당하는 대안 수정 |
| `normalizeQuery(input)` | 요일·동일 일자 시간구간·선택 공간·거리 조건 검사 |
| `compareWorkspace({assets, workspace, query, now})` | 현재 기록과 선택한 변경안의 결정론적 계산 |
| `saveSnapshot(workspace, comparison, {name, now}?)` | 계산 당시의 결과·출처를 저장 |
| `diffSnapshots(previous, next)` | 같은 검토 조건의 저장 결과 사이 기록상 변화 비교 |
| `validateWorkspace(value, {regionId, now}?)` | 전체 스키마·지역·보관 한도 검사 후 복사본 반환 |
| `serializeWorkspace(workspace, options?)` | 다시 가져올 수 있는 JSON 백업 생성 |
| `parseWorkspace(text, {regionId, now}?)` | JSON 백업 전체 검증 |
| `mergeWorkspaces(current, imported, {now}?)` | 이력·검토 결과를 보존하는 원자적 합치기 |
| `kstToday(now?)` | 한국시간 기준 오늘 날짜 |
| `straightDistance([lon,lat], [lon,lat])` | 좌표 사이 대권 직선거리, 미터 |
| `dataFingerprint(value)` | 정렬된 JSON 내용의 변경 감지용 지문 |

변경 함수는 전달받은 작업공간을 수정하지 않는다. 검증한 새 작업공간을 반환한다. 실패하면 예외가 발생하며 저장은 호출자가 하지 않아야 한다. `now`를 고정하면 같은 입력과 시간에 같은 판단을 재현할 수 있다.

## 3. 공간 ID와 원자료

```js
const assets = seedAssets(facilitiesGeoJSON, {
  regionId: profile.id,
  datasetId: profile.facilityLayerId,
});
```

브라우저와 서버는 **동일한 `datasetId`**를 사용해야 한다. 생략 기본값은 `public-facilities`이며, 배포 앱에서는 지역 프로필의 `facilityLayerId`를 명시한다.

```js
{
  id: `${datasetId}::${sourceId}`,
  sourceId, regionId, datasetId,
  name, coordinates: [longitude, latitude],
  dongId, dongName, address,
  rawHours,
  source: {name, url, date},
  unit: 'space', note,
  dataFingerprint
}
```

`sourceId`는 `properties.id`, 없으면 GeoJSON `feature.id`다. 이름이나 배열 순서로 ID를 만들지 않는다. ID 중복·잘못된 좌표·다른 지역 공간이 섞인 비교는 거부한다. 위치, 출처명·URL·기준일과 원문 운영시간을 보존한다. `rawHours` 문장은 자동으로 현재 운영시간으로 확정하지 않는다. 예를 들어 원자료의 ‘평일 09:00~18:00’만으로 현재 개방 중이라고 계산하지 않는다.

자료 지문은 원자료 변화 여부를 비교하기 위한 `fnv1a64:…` 값이다. 암호학적 서명이나 원본 증명 수단은 아니다. 원자료가 갱신되면 새 계산의 `assetFingerprint`가 달라진다. 동일한 공간 ID에 대한 기존 현장 기록은 유효기간까지 유지하므로 시설의 용도·위치가 바뀐 경우 담당자가 다시 확인해야 한다.

## 4. 지역별 작업공간

```js
{
  format: 'seoon-space-twin', version: 1,
  regionId: 'seogu',
  revision: 0,
  updatedAt: '2026-10-22T03:00:00.000Z',
  observations: {},
  history: [],
  scenarios: [],
  snapshots: []
}
```

브라우저 저장 키에도 지역 ID를 넣어야 한다. 이 모듈은 직접 localStorage·서버 DB를 읽거나 쓰지 않는다. 지역을 바꾸면 다른 작업공간을 열고, 가져올 때 `parseWorkspace(text, {regionId: profile.id})`를 호출한다. 지역이 다른 백업은 거부한다. 사용자 선택 공간·현재 입력 폼은 UI 상태이며 백업 스키마에 포함하지 않는다.

## 5. 현장 확인

```js
workspace = recordObservation(workspace, assets[0].id, {
  operatingStatus: 'open',
  daysOfWeek: [1, 2, 3, 4, 5],
  opens: '09:00', closes: '18:00',
  observedOn: '2026-10-22',
  validUntil: null,
  evidence: '담당자 유선 확인, 운영 안내문 대조',
});
```

- `operatingStatus`: `open`, `closed`, `unknown`.
- 요일: 월요일 1부터 일요일 7까지, 중복 없이 입력한다.
- `open`이면 요일과 개방 시작·종료가 필요하다. 동일 일자만 지원하며 종료의 `24:00`은 허용한다. 자정을 넘기는 일정은 별도의 시간구간으로 나누어 검토한다.
- `closed`와 `unknown`에서는 요일·시간을 빈 배열과 `null`로 정규화한다.
- `observedOn`은 실제 날짜이고 한국시간 기준 미래일 수 없다.
- `evidence`는 필수이며 1,200자 이하다. 근거를 적었다는 사실이 공식 승인·독립 검증을 뜻하지 않는다. 사람의 이름·연락처 등 불필요한 개인정보는 입력하지 않는 운영 안내가 필요하다.
- `validUntil`은 선택값이며 확인일보다 빠를 수 없다.

확인일부터 **90일이 초과되거나**, 지정한 재확인 기한이 지나면 계산에서 미확인으로 취급한다. 90일은 이 앱의 초기 재확인 정책이며 법정 유효기간이나 실측으로 확정한 안정 기간이 아니다. 지역 운영 정책과 실제 변경 빈도를 보고 조정할 수 있다.

저장 시 `recordedAt`과 `revision`을 부여한다. 이력에는 `previous`, `next`, `recordedAt`, `assetId`, `revision`을 남긴다. 기존 원자료를 수정하지 않는다. 같은 공간을 다시 확인하면 새 현황이 다음 계산에 적용되고 이전 확인값은 이력에 남는다. 사용자가 작성한 기록이므로 브라우저 백업만으로 감사 수준의 무결성이나 책임자 신원을 보장하지 않는다.

## 6. 변경안과 비용

```js
workspace = upsertScenario(workspace, {
  name: '평일 저녁 개방 검토',
  changes: [{
    assetId: assets[0].id,
    operatingStatus: 'open',
    daysOfWeek: [1, 2, 3, 4, 5],
    opens: '09:00', closes: '21:00',
    additionalAnnualCost: 120,
  }],
  note: '직원 배치와 예약 운영을 추가 확인할 계획',
});
```

한 작업공간에 최대 세 개 대안, 대안마다 1~30개 공간의 변경을 저장한다. `id`를 생략하면 기존 대안 ID와 겹치지 않는 ID를 만든다. 명시한 기존 ID는 그 대안을 수정한다. 한 대안에서 같은 공간을 두 번 변경할 수 없다.

비용은 **추가 연간 운영비, 만원/년** 단위의 사용자 가정이다. `120`은 추가 연간 120만원이라는 가정이며 검증된 견적이 아니다. 소수 둘째 자리까지 허용한다. 변경한 공간 중 한 곳이라도 비용이 미입력이면 합계는 `null`, `costComplete`는 `false`다. `0`은 담당자가 명시적으로 추가 비용이 없다고 가정했을 때만 쓴다. 현재안의 `0`은 추가비용 비교 기준이며 현재 전체 운영비가 0이라는 뜻이 아니다. 자동으로 인건비·총사업비·편익·비용편익비를 산출하지 않는다.

## 7. 검토 조건과 계산

```js
const comparison = compareWorkspace({
  assets,
  workspace,
  query: {
    dayOfWeek: 1,
    start: '18:00', end: '21:00',
    assetIds: [assets[0].id],
    referencePoint: null,
    radiusM: null,
  },
});
```

검토 공간은 최대 100개다. `assetIds`를 생략하면 전달한 전체 공간을 사용하되 같은 한도가 적용된다. 거리 반경을 사용하려면 경도·위도의 기준점과 1~50,000m의 반경을 함께 입력한다. 좌표 사이 **직선거리**이며 실제 길을 따라 걷는 거리나 이동시간이 아니다. 반경 필터 후 공간이 0개인 결과는 허용한다.

각 공간은 다음 세 상태로 계산한다.

| 상태 | 계산 조건 |
|---|---|
| `eligible` | 유효한 확인값 또는 변경 가정에서 해당 요일의 요청 시간 **전체**를 개방 |
| `unavailable` | 운영 중단·해당 요일 미개방·요청 시간 일부만 개방 또는 시간대 불일치 |
| `unknown` | 유효한 현장 기록이 없거나 오래되었거나 변경안 자체가 미확인 |

`unavailable`은 해당 시간조건을 충족하지 않는다는 뜻이다. 공간이 영구 폐쇄되었거나 예약 가능성이 없다고 단정하지 않는다.

`overlapHours`는 각 공간의 개방 구간과 요청 구간이 겹치는 분을 합한 뒤 시간으로 바꾼 값이다. 예를 들어 18~21시 요청에 19시 30분까지 여는 공간은 `eligible` 0개, `unavailable` 1개, 겹치는 시간 1.5시간이다. 실제 주민 이용시간·직원 근무시간은 아니다. 소수 넷째 자리로 표시 가능한 값을 반환한다.

현재안이나 변경안에 미확인 공간이 하나라도 있으면 해당 대안의 `comparable=false`, `delta=null`이다. 변경안으로 처음 운영시간을 채운 것을 기존 대비 실제 공급 증가로 계산하지 않는다. 양쪽 모두 미확인이 없을 때만 조건 충족 공간 수와 겹치는 시간의 **입력조건상 차이**를 산출한다. 이 경우에도 정책 효과나 주민 편익의 실측값은 아니다.

변경안에 속한 공간이 현재 선택·거리 범위에서 빠지면 해당 비교를 거부한다. 저장된 대안 중 일부만 비교하려면 UI에서 임시 작업공간의 `scenarios`만 필터링한 후 계산한다. 원래 저장 작업공간을 수정하지 않는다.

### 주요 결과 필드

```js
{
  version, regionId, generatedAt, workspaceRevision,
  query, assetFingerprint, fingerprint,
  selectedCount, excludedByDistance, unlocatedCount,
  baseline, alternatives, sources, limitations
}
```

`baseline`과 각 `alternatives` 항목은 다음을 포함한다.

```js
{
  id, name, kind,  // current-records 또는 user-scenario
  eligibleCount, unavailableCount, unknownCount,
  overlapHours,
  additionalAnnualCost, costUnit: '만원/년', costComplete,
  changedCount, comparable, delta,
  rows, note
}
```

공간별 `rows`에는 식별자·이름·상태·적용한 시간·겹치는 분·직선거리·원자료 기준일·확인일·근거와 `provenance`가 있다. `provenance`는 `field-record`, `unverified-source`, `stale-record`, `user-assumption`이다. 변경 가정 행에 현재 기록의 근거를 붙이지 않는다. 원자료 출처는 별도 `sources`에 남는다.

## 8. 스냅샷과 기록 전후 비교

```js
workspace = saveSnapshot(workspace, comparison, {name: '저녁 개방 검토'});
const change = diffSnapshots(workspace.snapshots[0], workspace.snapshots[1]);
```

스냅샷은 `{id, name, createdAt, comparison}`을 저장한다. 계산 후 현장 기록이나 대안이 바뀌어 작업공간 버전이 달라지면 다시 계산한 뒤 저장해야 한다. 보고서는 스냅샷 내부의 행·출처만 사용하고 현재 현황을 섞지 않는다.

`diffSnapshots`는 지역·공간 목록·요일·시간·거리 조건이 같을 때 기록상 변화량을 반환한다. 미확인이 확인됨으로 바뀌어 수가 달라진 것도 기록상 변화에 포함된다. 따라서 이 결과는 조사 전후의 지식 변화까지 포함하며 정책 성과로 해석하면 안 된다. `dataChanged=true`는 원자료의 내용까지 달라졌음을 뜻한다. 조건이 다르면 직접 비교할 수 없다는 사유를 반환한다.

## 9. 백업 검증과 합치기

```js
const incoming = parseWorkspace(fileText, {regionId: profile.id});
const merged = mergeWorkspaces(workspace, incoming);
const backup = serializeWorkspace(merged);
// 모든 검증과 사용자 가져오기 검토가 끝난 후 UI가 저장한다.
```

상한은 UTF-8 JSON 2MiB, 전체 공간 자료 5,000개, 선택 공간 100개, 현장 확인 1,000개, 변경 이력 1,000개, 대안 세 개, 스냅샷 20개다. 초과 시 예전 기록을 자동 삭제하지 않고 실패한다. 내보내기는 보기 좋은 들여쓰기를 사용하되 들여쓰기로 파일 한도를 넘을 때는 공백 없는 JSON으로 저장한다. 내보낸 파일을 같은 버전에서 다시 읽을 수 있어야 한다.

다음 항목은 전체 가져오기를 거부한다.

- 다른 지역·지원하지 않는 버전·알 수 없는 필드·잘못된 날짜·요일·동일 일자 시간구간.
- 잘못된 숫자·비용 범위·중복 ID·누락된 필수 근거·보관 한도 초과.
- `__proto__`, `constructor`, `prototype` 키, 접근자, 순환 참조, 깊이·노드 수 과다, 빈 배열 슬롯 등 JSON에 맞지 않는 자료.
- 실행 스킴 또는 사용자명·비밀번호를 포함한 출처 URL. 출처는 HTTP(S)만 허용한다.
- 저장 결과의 공간 목록과 검토 조건·출처가 다르거나 시간·개수·합계·미확인 여부·차이 값이 서로 모순되는 스냅샷.

합치기는 다음 원칙을 따른다.

1. 동일 기록은 중복하지 않는다. 비어 있는 현재 작업공간에는 가져온 작업공간을 사용할 수 있다.
2. 같은 공간의 현황은 **현장 확인일, 그다음 기록시각**이 더 최근인 값을 사용한다. 늦게 입력한 옛 조사가 더 최근 현장 확인을 밀어내지 않도록 한다.
3. 같은 확인일·기록시각인데 내용이 다르면 합치기를 거부한다.
4. 양쪽 변경 이력과 스냅샷을 보존한다. 동일 ID의 내용이 다르면 덮어쓰지 않고 전체 합치기를 거부한다. 대안도 같은 ID의 정의가 다르면 별도 검토가 필요하다.
5. 합친 결과가 보관 한도를 넘으면 아무 것도 저장하지 않는다.

JSON 백업은 사용자가 수정할 수 있는 자료다. 스키마와 내부 일관성 검사는 서명·공인 근거·검증 완료를 보장하지 않는다. AI 서버는 백업에 들어 있는 계산값을 신뢰하지 않고 배포된 공간 원자료와 요청의 확인값·가정으로 다시 계산한다.

## 10. 확인한 시험

```sh
node tests/space-twin-model.test.mjs
```

실제 공개 공간 58개의 ID·원문 보존, 현장 확인과 변경안 재계산, 미확인과 0의 구분, 시간 일부 겹침, 운영 중단·요일 제외, 비용 미입력과 명시적 0, 한국 날짜·기한 경과, 직선거리, 범위 밖 대안, 지역 분리, 원자료 변경 감지, 이전 기록 보존, 스냅샷의 내부 모순, 위험한 가져오기 구조, UTF-8 파일 한도, 대안 ID 충돌, 충돌 없는 합치기와 덮어쓰기 거부를 검증한다.

이 시험은 계산·저장 동작의 검증이다. 원자료 운영 현황의 정확성, 담당자의 조사 진실성, 실제 이용 수요 또는 다른 지자체의 운영 성과를 입증하는 실증시험은 아니다.
