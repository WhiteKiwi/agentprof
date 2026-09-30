# AgentProf

**AI 코딩 에이전트가 어디에 시간을 쓰고, 무엇을 먼저 개선할 수 있는지 보여주는 로컬 성능 프로파일러.**

Claude Code·Codex 로그에서 시간 병목, 반복 실패, 탐색·검증 패턴을 분석한다. 결과는 로컬 CLI와 오프라인 HTML로 확인한다. 제품의 중심은 측정 → 패턴 탐지 → 진단 → 개선 제안 → 전후 검증이다.

현재는 **설계·작업 계획 단계**다. 아래 실행·설치 명령은 구현 목표이며 아직 배포된 패키지가 아니다.

## Intended use

처음에는 npm 패키지로 시험하고, 자주 쓰면 전역 설치한다. 공개 이름은 출시 전에 등록 상태·권한을 확인한다. 아래는 `agentprof` 이름을 사용할 수 있을 때의 예정 명령이다.

```bash
npx agentprof report --last 7d --output ./agentprof.html --open

npm install -g agentprof
agentprof scan
agentprof stats --last 7d
agentprof insights --last 7d
agentprof open ./agentprof.html
```

초기 구현은 TypeScript + Node.js >=24.15.0 + SQLite다. 설치 마찰을 줄이기 위해 `node:sqlite`를 우선 검증한다. 이 API는 Release candidate 상태이며 최소 버전·패키지 검증을 먼저 수행한다. Homebrew 배포는 후속 단계다. Rust는 대용량 스캔·메모리·단일 바이너리 필요를 실제 측정한 뒤 판단한다.

## v0.1

10개 MVP 지표와 6개 자동 진단을 제공한다. 첫 화면은 **Time Breakdown**, **Detected Waste**, **Top Insights**에 집중한다. 세션·도구·명령·추이·타임라인 상세에서 근거를 확인한다.

측정값·관측 구간·추정·unknown을 구분하고 표본 수와 커버리지를 표시한다. 병렬 호출과 여러 진단이 같은 시간 구간을 가리켜도 중복 합산하지 않는다. Detected Waste는 관측 패턴에 연결된 시간이며 실제 절감 가능한 시간과 같지 않다.

분석은 로컬에서 끝난다. 자동 업로드·텔레메트리는 없으며 원문 프롬프트·소스·도구 출력·원문 명령·비밀값을 기본 결과에 넣지 않는다.

## Documentation

`WhiteKiwi/locron`처럼 사양·조사·구현 계획·검증 체크리스트를 나눈다.

| 문서 | 역할 |
| --- | --- |
| [SPEC](docs/SPEC.md) | 무엇을 만들고 어떤 동작을 제공하는가 |
| [FINDINGS](docs/FINDINGS.md) | 조사 근거·결정·불확실성 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 데이터 흐름·정규화·저장·개인정보 불변 조건 |
| [METRICS](docs/METRICS.md) | 10개 지표·6개 진단·시간 중복 제거 계약 |
| [IMPLEMENTATION](docs/IMPLEMENTATION.md) | 어떻게 구현하고 검증할 것인가 |
| [TODO](docs/TODO.md) | 단계별 진행 상태와 Verify |
| [ACCEPTANCE](docs/ACCEPTANCE.md) | 완료 판단과 실제 검증 증거 |
| [BACKLOG](docs/BACKLOG.md) | 비교·배포·마스코트 등 후속 아이디어 |
| [DESIGN](docs/DESIGN.md) | 확정된 도롱뇽 마스코트와 제공 참고 이미지 |
| [AGENTS](AGENTS.md) | 문서 우선·서브세션·Git 작업 방식 |

두 사용자 원문은 [AgentTrace 제안](docs/reference/agenttrace-design.md)과 [AgentProf metrics 제안](docs/reference/agentprof-metrics-and-insights.md)으로 보존했다. 원문 이름·예시 숫자·제안 범위가 현재 문서를 덮어쓰지 않는다.

마스코트는 **도롱뇽**이다. 제공한 [3개 이미지](docs/DESIGN.md)를 README와 리포트 시각 작업에서 참고한다. 실시간 로컬 대시보드는 후속 아이디어로 기록했고, 초기 버전은 일회성 HTML 생성·열기에 집중한다.

## Next milestone

P0의 합성 fixture와 로그·지표 계약부터 시작한다. 이어 CLI → 공급자 파서 → 증분 스캔 → 10 지표·6 진단 → 단일 HTML → 설치·파일럿 순서로 진행한다. 개발 서브세션이 구현하고 계획 세션이 검토·게시한다.

구현 작업은 [8개 이슈](https://github.com/WhiteKiwi/agentprof/issues)와 [v0.1-alpha](https://github.com/WhiteKiwi/agentprof/milestone/1)·[v0.1](https://github.com/WhiteKiwi/agentprof/milestone/2) 마일스톤으로 추적한다.
