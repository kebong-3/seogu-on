# 서구온 0.17.1 — 먼저 읽어주세요

1. Node.js 22와 전체 저장소를 준비합니다. `vendor/cesium-1.121.0.tar.gz`를 빠뜨리지 마세요.
2. `.env.example`을 참고해 필요한 외부서비스 키를 `.env.local`에 설정합니다. 실제 키를 GitLab·이메일·화면 캡처에 넣지 않습니다.
3. `npm run dev`로 실행합니다. AI 키가 없으면 규칙 기반 표시를 확인합니다. 실제 3D 수신이 어려우면 지도 연결 화면에서 경계도·경량지도를 선택합니다.
4. `npm run verify`와 `node scripts/validate-region-replay.mjs`를 실행합니다. 실제 모델 2종은 `docs/VALIDATION_RUNBOOK.md`의 별도 실행 기록으로 확인합니다.
5. 풍암동 공원 문의 → 출처 → 메모 저장, 학교 주변 그늘막 200m·500m 비교, 폭염 대안 → 보고서, 침수 이력 → 현장 확인기록을 확인합니다.
6. 최종 배포의 `/data/release.json` 버전·코드 지문을 빌드 결과와 대조합니다. 3D 지도·외부 API·실제 모델은 현장 접속환경에서 별도로 확인합니다.
7. 공공 GitLab 등록 외에 신청서·안내서·시연영상 이메일과 기관 AI 담당부서의 공문 처리를 각각 완료합니다.

현재 직원 업무효과는 미측정입니다. `public/tools/seoguon-work-study.html`과 `docs/challenge/measurement-guide.md`로 실제 수행 결과를 수집합니다. 키가 없는 모델 검증을 성공으로 바꾸지 않습니다.

루트의 RELEASE_MANIFEST.json은 과거 v0.7.0 기록입니다. 현재 소스 지문은 성공한 Challenge reproducible evidence 실행의 source-manifest.json을 확인하세요.
