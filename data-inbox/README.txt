받은 파일함 (data-inbox)

공공데이터포털(data.go.kr)에서 내려받은 CSV 파일을 이 폴더에 그대로 넣으세요.
파일 이름은 바꾸지 않아도 됩니다. 넣은 뒤 프로젝트 폴더에서 아래 한 줄을 실행합니다.

    node scripts/data/ingest.mjs

먼저 결과만 보고 싶으면:

    node scripts/data/ingest.mjs --dry-run

어떤 파일을 받아야 하는지, 결과를 어떻게 읽는지는 docs/DATA_INBOX.md 에 있습니다.
이 폴더의 CSV 원본은 저장소(GitHub)에 올리지 않습니다.
