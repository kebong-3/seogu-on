# 서구온 v0.5 시작하기

기존 `kebong-3/seogu-on` / 기존 Vercel 프로젝트를 유지합니다.

1. 압축 내부 파일·폴더를 저장소 최상위에 반영합니다. `vendor/`까지 필요합니다. 실제키 파일 `.env.local`은 올리지 않습니다.
2. 빌드: Node22 / `npm run build` / 출력 `dist`. 로컬 SDK 압축파일은 빌드가 해시를 확인하고 복원합니다.
3. 기존 브이월드 키는 유지합니다. 주제도 조회에는 승인된 `VWORLD_API_KEY`와 올바른 `VWORLD_DOMAIN`이 필요합니다.
4. 새 Production 배포 뒤 `/api/city-config` 및 `/data/release.json`의 버전0.5.0을 확인합니다.
5. `계절·3D 그림자`에서 가까운 동을 선택하여 겨울9시/12시/15시와 여름12시를 비교합니다. 이 기능은 `2D 근사 그늘 면`과 다릅니다.
6. `공식 주제도`에서 하나씩 조회하고 원본도형/수신시각/미조회 상태를 확인합니다. 66종 목록 등록만으로 공간자료가 수집된 것은 아닙니다.

자세한 순서: `docs/v05/DEPLOY.md`, `docs/v05/API_SETUP.md`, `docs/v05/DATA_STATUS.md`, `docs/v05/TEST_REPORT.md`.

로컬 검사: `npm run verify`. 추가 UI검사: `npm run test:v05-ui`(Python Playwright 필요). 운영·실제GPU검증을 대신하지 않습니다.

이번 ZIP은 로컬 구현본입니다. GitHub main이나 Vercel 운영서비스를 대신 변경하지 않았습니다. 정밀 일조권·조도·수리해석·실시간 결빙/재난안전 판정은 제공하지 않습니다.
