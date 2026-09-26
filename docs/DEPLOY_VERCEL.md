# 기존 GitHub → Vercel 배포 유지

기존 seogu-on 프로젝트에서 Framework Other / Build npm run build / Output dist / Node22.x를 유지합니다. 새 저장소나 별도 Unity 프로젝트를 만들지 않습니다.

현재 개선 앱 소스는 ZIP으로 전달합니다. 생성된 브랜치에는 수집·진단 워크플로만 있습니다. ZIP 안의 개선 소스를 해당 브랜치에 업로드한 뒤 main에 병합하거나, 검토 후 기존 main에 업로드합니다. 환경변수는 Settings → Environment Variables에서 Production에 지정합니다. Preview에 설정한 값만으로 Production 배포가 바뀌지 않습니다. 저장 후 Deployments에서 Production 재배포를 실행합니다.

초기 진단 당시 배포 `/api/config`는 version0.1.0, vworld3d=false, vworldRest=false, publicData=false를 반환했습니다. 계정의 환경변수 화면을 직접 열어 확인한 것은 아니므로 미입력·다른 환경 지정·재배포 누락 중 어느 원인인지 확정하지 않습니다.

새 배포 후 확인: `/api/config` version0.2.0 → 18개동 선택 → 실제자료325개 → 브이월드 및 REST 설정 상태 → 연결센터에서 실제 수신시험. JSON에 키 값이 나오지 않아야 합니다.

키가 설정되어도 인증 실패 시 VWorld 계정의 서비스 승인·도메인 등록·현재 접속 도메인을 확인합니다. 단순 SDK 준비 메시지만으로 모델 수신 성공이라고 판정하지 않습니다. Preview의 긴 자동 생성 주소는 Production과 다른 도메인입니다.

최초 공개본만 확인할 때는 API 키가 없어도 됩니다. 기본 OSM 지도는 외부 CDN·타일과 WebGL이 필요하며 네트워크 정책이 차단하면 오류를 표시합니다.
