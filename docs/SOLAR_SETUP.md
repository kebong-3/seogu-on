# Solar Pro 4 연결

Vercel의 **seogu-on → Settings → Environment Variables**에서 아래 값을 설정합니다. 운영 사이트는 Production을 선택하고, 미리보기에서도 쓸 때는 Preview에도 설정합니다. 저장 후 새로 배포해야 실행 중인 함수에 적용됩니다.

| 이름 | 값 |
| --- | --- |
| `AI_PROVIDER` | `upstage` |
| `UPSTAGE_API_KEY` | Upstage에서 새로 발급한 비밀 키 |
| `AI_MODEL` | `solar-pro4` |
| `AI_REASONING_EFFORT` | `medium` |

`AI_PROVIDER=solar`도 같은 설정으로 처리합니다. 연결 주소는 서버에 `https://api.upstage.ai/v1`로 고정되어 있어 `AI_API_BASE`는 설정하지 않아도 됩니다. 이전 `AI_MODEL`이 Gemma 등 다른 모델로 되어 있다면 반드시 `solar-pro4`로 변경하세요. `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMMA_MODEL`은 Solar를 선택했을 때 사용하지 않습니다. 키는 `UPSTAGE_API_KEY`를 우선 읽고, 비어 있으면 기존 공통 변수 `AI_API_KEY`를 사용합니다.

대화·공개 파일에 한 번 노출한 키는 폐기하고 새로 발급합니다. 실제 키를 GitHub, `.env.example`, 공개 화면, 브라우저 입력란에 넣지 않습니다. 환경변수에 `NEXT_PUBLIC_` 또는 `VITE_` 접두어를 붙이지 않습니다.

## 적용 범위와 확인

- 지도에게 묻기, 지역별 공공공간 조회, 시설 배치 검토와 공공공간 운영시간 비교 및 자연어 도보 방문계획에 같은 Solar 연결을 사용합니다.
- 지도에서 질문한 뒤 답변의 모델 표시에 `solar-pro4`가 나타나면 해당 응답은 Solar 결과입니다. 키 누락, 모델 오류, 한도 또는 시간 초과는 규칙 기반 응답으로 표시됩니다. 규칙 기반 응답을 Solar 성공으로 간주하지 않습니다.
- 서버는 `choices[0].message.content`와 도구 호출만 읽습니다. `message.reasoning`은 응답·지도·로그로 보내지 않습니다.
- 공개 자료에서 실행한 조회·계산 근거, 출력 검증과 일일 호출 제한을 유지합니다. 키가 없으면 Upstage를 호출하지 않습니다.
- `ASK_DAILY_LIMIT`은 기존과 같이 기본 300회입니다. 0은 AI 호출을 중지합니다. 여러 서버 인스턴스를 합산한 공급자 과금 한도가 아니므로 Upstage의 사용량 설정도 확인합니다.

Solar의 reasoning은 최종 답변과 출력 예산을 공유합니다. `medium` 이상을 포함한 reasoning 활성화 시 최대 출력 토큰을 최소 8,192로 확보하되, 기존 서버 응답 시간 제한은 유지합니다. 응답이 늦으면 `AI_REASONING_EFFORT=low` 또는 `none`을 선택해 재배포할 수 있습니다. 허용값은 `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`입니다. 오류 시 다른 제공기관으로 자동 전환하거나 비밀 키를 전달하지 않습니다.

검증은 테스트용 가짜 키와 모의 응답으로 수행합니다. 실제 새 키를 입력한 뒤의 운영 응답 성공 여부는 별도 확인해야 합니다.

공식 문서: [Chat Completions API](https://console.upstage.ai/api/chat), [Reasoning 설정](https://console.upstage.ai/docs/capabilities/generate/reasoning).
