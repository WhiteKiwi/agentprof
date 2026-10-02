# AgentProf Research Findings

## 실행 추적을 GitHub Projects로 이동 — 2026-09-30

사용자 요청에 따라 [AgentProf Project](https://github.com/users/WhiteKiwi/projects/2)를 private로 유지하고 저장소에 연결했다. 2026-10-01에는 repository issue를 새로 만들지 않는 추적 방식으로 바꿨다. 기존 10개 이슈의 본문·작업·Verify·담당·상태·milestone/label 정보를 Project draft에 보존했다. 이전 이슈는 이관 안내와 함께 닫아 이력을 남기고 보드의 연결 issue item은 제거했다. 현재 실행 상태의 원본은 Project 전용 티켓이며 [TODO.md](TODO.md)는 티켓 위치와 운영 규칙만 안내한다. 제품 계약·구현 결정·실제 검증 evidence는 유지 관리 문서에 남긴다.

main `c33f137`의 디자인 guideline·재사용 컴포넌트·README 초안을 기반 작업 브랜치에 통합했다. 이후 main `514ee77`의 도롱뇽 README hero와 참고 자산, PR #11의 측정·개선 계약을 보존해 통합했다. P0/P1 검토·검증 후 PR #9는 main `c3856249bdc0a9c19b856ca32c97d3484e189176`에 병합되었다. 디자인 소스와 시스템 구현의 역할을 유지하며, 디자인 브라우저 검증의 `NOT RUN` gate를 별도 Design Project 티켓으로 추적한다. P2 Codex 파서의 범위·출처·대조 근거는 [CODEX-EVIDENCE.md](CODEX-EVIDENCE.md)에서 이어 간다.

## 로그 형식 조사

확인일: 2026-09-30. 계획을 위한 로컬 구조 조사이며, 파서 구현·정확도 검증이 완료된 상태는 아니다.

최근 수정된 Codex·Claude Code JSONL을 각각 5개 선택해 파일당 첫 2,500줄까지 조사했다. 출력은 이벤트 종류, 필드 구조, 버전·집계 수치로 제한했다. 원문 프롬프트·명령·도구 출력·사용자 코드와 실제 로그 파일은 이 저장소에 복사하지 않았다. 조사 중 로그가 append될 수 있어 아래 수치는 고정된 평가 corpus가 아니다.

### Codex: 구조화된 완료 이벤트를 우선 활용

관측된 런타임 버전: `0.159.0`, `0.157.0`, `0.153.4`, `0.149.0-alpha.4.3`. 이 버전들의 모든 기능을 지원한다고 보증하는 목록은 아니다.

| 관측 필드·레코드 | 파서에서의 의미 |
| --- | --- |
| `session_meta` | `id`, `session_id`, `cwd`, `cli_version`, 공급자·source metadata |
| `turn_context` | 턴 ID, 모델, 타임존 등 변화 가능 설정 |
| `response_item` | function/custom call, output, message, reasoning |
| `event_msg.item_completed` | `item`, `started_at_ms`, `completed_at_ms`, `thread_id`, `turn_id` |
| `item.type = CommandExecution` | 명령, 프로세스 ID, 상태·종료 코드, `duration: {secs, nanos}` |
| `item.type = McpToolCall` | 서버·도구, 상태, duration, 구조화된 결과 |
| `task_started` / `task_complete` | 턴 시작·완료와 duration 후보 |
| `token_usage_record` / `token_count` | 응답별 사용량과 누적 스냅샷. 중복 집계 방지 필요 |
| `compacted`, 서브에이전트·통신 관련 항목 | 복사된 이력·관계·관측 범위 처리 필요 |

한 후속 구조 조사에서 `CommandExecution` 1,572개와 `McpToolCall` 77개를 관측했다. 이 표본에는 각각 숫자형 시작·종료 시각과 구조화된 duration이 있었다. 최근 표본에 시간 근거가 존재한다는 뜻이며, 과거 버전·모든 도구·전체 corpus의 커버리지를 뜻하지 않는다.

코드 모드의 최상위 이름이 `exec`로 저장된 호출이 다수 있었다. 하지만 내부 명령·MCP 작업의 완료 항목도 따로 관측됐다. 따라서 wrapper의 입력 코드를 정규식으로 추측하기 전에 구조화된 항목을 확인한다. 두 표현을 함께 합산하지 않도록 실제 ID 연결을 검증해야 한다.

출력은 문자열과 content-block 배열 두 형식이 관측됐다. 텍스트에 나타난 wall time은 버전별 보조 근거이며, 구조화된 시간과 충돌하거나 비동기 프로세스의 일부 응답이면 전체 실행 시간으로 쓰지 않는다.

공식 OpenAI 문서는 thread archive가 저장된 JSONL을 아카이브 디렉터리로 이동한다고 설명한다. fork는 고유 thread ID와 원본 관계를 갖고, `sessionId`는 루트 그룹과 관련될 수 있다. 이는 아카이브 이동과 thread/session 식별을 별도로 다뤄야 하는 근거다. JSONL의 완전한 장기 호환 스키마가 이 문서로 보장된다는 의미는 아니다. [Codex App Server — Threads](https://learn.chatgpt.com/docs/app-server#threads).

### Claude Code: 호출·결과 연결과 시간 누락 처리

관측된 로그 버전: `2.1.241`. 최초 조사에서 1,963개 레코드와 382개의 `tool_use`, 382개의 `tool_result` 블록을 관측했다. 일대일 연결·중복 제거가 검증됐다는 뜻은 아니다.

| 관측 필드·레코드 | 파서에서의 의미 |
| --- | --- |
| `user`, `assistant` | `uuid`, `parentUuid`, `sessionId`, timestamp와 message |
| `tool_use` | 도구 `id`, `name`, input |
| `tool_result` | `tool_use_id`, `is_error`, content |
| `toolUseResult` | 도구마다 다른 구조. 상태·duration이 일부에만 존재 |
| `system` / `turn_duration` | 턴 단위 `durationMs` 후보 |
| `agentId`, `isSidechain` | 서브에이전트·이력 분기 식별 후보 |
| message usage | 입력·출력·cache 사용량. 메시지 재저장·중복 여부 검증 필요 |

후속 조사에서 구조화된 `toolUseResult` 367개 중 `durationMs`는 7개, `durationSeconds`는 2개에 존재했다. `turn_duration`도 26개 관측됐다. 따라서 모든 도구의 정확한 실행 시간을 직접 얻을 수 있다고 가정하지 않는다.

호출과 결과의 timestamp 차이는 호출 관측 구간이며 순수 프로세스 실행 시간과 다를 수 있다. 동시 호출, 백그라운드 작업과 결과 지연은 합성 fixture로 검증한다. 직접 duration이 없으면 `paired_timestamps` 또는 검증된 추정으로 표시한다.

공식 Claude 문서는 기본 저장 위치를 `~/.claude/projects/<encoded-cwd>/*.jsonl`로 설명하고 `CLAUDE_CONFIG_DIR` 설정 시 다른 root를 사용한다고 명시한다. fork는 이력을 복사하므로 복사된 과거와 새 실행을 구분해야 한다. [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions).

### 로그 계약: P0에서 확정할 질문

- Codex 완료 항목·response call의 실제 ID 연결과 구형 fallback 우선순위는 무엇인가?
- duration과 시작·종료 시각은 각 소스에서 같은 구간을 의미하는가?
- 진행 중 호출, process polling과 백그라운드 작업의 완료 근거는 무엇인가?
- Claude 메시지·usage가 재저장될 때 어떤 ID로 중복을 제거하는가?
- fork·sidechain·아카이브 이동에서 보존되는 식별자는 무엇인가?
- 압축·손상·미지원 레코드를 어떤 진단과 커버리지로 나타낼 것인가?

지원표는 실제 fixture와 버전별 검증 결과로 작성한다. 위 관측값을 전체 제품 지원 약속이나 시간 정확도의 근거로 확대하지 않는다.

## 배포와 SQLite 조사

확인일: 2026-09-30. [초기 설계](reference/agenttrace-design.md), [지표·진단 제안](reference/agentprof-metrics-and-insights.md), [SPEC](SPEC.md), [METRICS](METRICS.md), [ARCHITECTURE](ARCHITECTURE.md)를 읽고 공식 1차 자료를 확인했다. 아래 **확인 사실**과 **연구 판단**은 구분한다. 패키지 설치·DB 실행·성능 benchmark는 수행하지 않았다.

### 공식 자료에서 확인한 사실

| 자료·확인 버전 | 확인 사실 | 제품에 적용할 때의 한계 |
| --- | --- | --- |
| [npm exec, npm CLI v11 문서](https://docs.npmjs.com/cli/v11/commands/npm-exec/) | `npx`는 `npm exec`를 사용한다. 필요한 패키지가 없으면 npm cache에 설치하고 실행 PATH에 추가한다. 실행 파일은 `package.json`의 `bin`에서 결정한다. | `npx`는 Node 런타임을 없애는 배포 방식이 아니다. 최초 패키지 획득에는 네트워크가 필요하며, 분석의 오프라인 동작과 구분해야 한다. |
| [npm package.json, npm CLI v11 문서](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/) | Node CLI의 `bin`은 Node shebang을 사용한다. `engines`는 `engine-strict` 설정이 없으면 기본적으로 advisory다. | `engines`만으로 구형 Node의 실행을 확실히 막는다고 가정하지 않는다. SQLite를 import하기 전 런타임 검사와 명확한 진단을 계획한다. |
| [Node.js v24.21.0 SQLite](https://nodejs.org/docs/v24.21.0/api/sqlite.html), [공식 Markdown](https://nodejs.org/docs/v24.21.0/api/sqlite.md) | `node:sqlite`는 내장 모듈이다. v24.15.0부터 **Stability 1.2 — Release candidate**다. v22.13.0·v23.4.0에서 실험 플래그가 제거된 것과 Stable 전환은 다른 사건이다. `DatabaseSync` API는 동기 실행이다. | Stable API로 표현하면 틀린다. 내장 모듈 사용은 별도 SQLite native addon 배포를 줄이지만 Node 버전 요구와 RC 호환성 검증을 남긴다. |
| [Node.js v24.21.0 Stability index](https://nodejs.org/docs/v24.21.0/api/documentation.html#stability-index) | 1.2는 Experimental의 하위 단계다. 추가 breaking change가 예상되지는 않지만 사용자 피드백이나 underlying specification 변경에 따라 발생할 수 있다고 명시한다. | Node 24 LTS라는 사실이 SQLite API의 Stable 지위를 뜻하지 않는다. 최신 문서의 API가 최소 지원 patch에도 존재하는지 따로 확인해야 한다. |
| [better-sqlite3 v13.0.0 release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0) | v13은 N-API로 전환했다. `prebuild-install`을 제거하고 prebuilt 바이너리를 패키지 자체에 포함한다. 유지관리자는 여러 Node·Electron 버전 간 호환을 기대한다고 설명한다. | 구형 v12의 설치 시 바이너리 다운로드 방식을 v13의 현재 동작으로 설명하지 않는다. N-API도 모든 OS·architecture·libc 조합의 동작을 보장하지 않는다. |
| [better-sqlite3 v13.0.3 release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3), [해당 tag의 package.json](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/package.json) | 확인 당시 latest release는 v13.0.3이다. manifest는 Node `>=22`, `prebuilds/**` 포함, `node-addon-api` 의존성을 명시한다. `install`·`postinstall` 스크립트는 해당 manifest에 없다. | release 안내의 미지원 플랫폼 source build 설명만으로 설치 단계의 실제 fallback을 보증하지 않는다. 선택 시 published tarball·loader·플랫폼별 경로와 clean install을 P1에서 확인한다. |
| [Homebrew Language-Specific Formulae — Node.js](https://docs.brew.sh/Language-Specific-Formulae#nodejs) | 완전한 npm release tarball의 URL·SHA-256, 명시적 Node dependency, `std_npm_args`를 이용한 `libexec` 설치와 bin symlink 경로를 제공한다. 설치 lifecycle scripts는 기본적으로 무시한다. | Homebrew 사용에 Rust가 필수는 아니다. formula의 실제 source·runtime·native dependency와 기능 검증은 필요하다. 이 가이드는 `homebrew/core` 수용이나 agentprof tap 출시를 보장하지 않는다. |

Node 문서는 웹 도구 접근 실패 후 동일 공식 `nodejs.org`의 Markdown을 `curl`로 읽었다. `latest-v24.x` index의 표제는 v24.21.0이었으며 재현 가능한 인용은 그 버전 URL로 고정했다. 현재 설치된 사용자 런타임을 지원표로 삼거나 패키지를 설치하지 않았다.

### 연구 판단과 권고

초기 기본 계획은 **TypeScript + Node.js 24.15.0 이상 + `node:sqlite`**, 첫 사용은 `npx`, 반복 사용은 npm 전역 설치다. JSONL 정규화·규칙과 HTML 개발을 한 저장소에서 진행하고 별도 SQLite addon 설치 경로를 줄이는 데 우선순위를 둔다. 이는 구현 전 선택이며 설치 성공·성능 우위를 이미 입증했다는 뜻이 아니다.

Node 24의 최소 patch와 현재 patch를 검증 대상으로 삼는다. `>=24.15.0`을 선언하더라도 이후 모든 major를 검증했다고 표현하지 않는다. 정확한 npm 패키지명과 게시 권한은 P7에서 확인하며 출시 전 실행 예시는 예정 기능으로 표시한다.

P1에서 다음을 검증하고 결과를 `IMPLEMENTATION`·`TODO`·`ACCEPTANCE`에 반영한다.

- SQLite import와 실제 필요한 API가 최소 지원 버전과 현재 지원 버전에 모두 존재한다.
- parameter binding, transaction commit·rollback, migration, close·reopen과 정수·`null` 처리가 기대값과 맞는다.
- 잠금·busy timeout, journal mode, 중단 복구와 로컬 파일 권한이 CLI 사용 조건을 충족한다.
- 빌드된 CLI·HTML assets만 담은 tarball이 새 macOS arm64·Linux 환경에서 npm exec·global install로 실행된다. 런타임 부족을 SQLite import 오류 전에 설명한다.

RC API의 호환성이나 필요한 DB 기능이 이 조건을 충족하지 않으면 **제품 코드를 구현하기 전에** 계획을 `better-sqlite3`로 변경한다. v13 기준으로 정확한 버전과 published artifact를 고정하고 prebuilt 지원 대상·fallback·Node 호환성을 검증한다. 구형 설치 위험을 근거로 무조건 제외하지 않는다.

Homebrew formula는 npm artifact를 검증한 뒤 추가할 수 있다. Rust CLI나 Rust scanner는 대용량 스캔의 시간·메모리 또는 Node 설치 부담을 실제로 측정한 후 별도 판단한다. 현재는 Rust가 더 빠르다는 가정이나 Homebrew 선호만으로 언어를 확정하지 않는다. 내장 SQLite의 동기 API가 배치 CLI에 적합한지도 P1의 작은 실험과 P7의 자원 측정으로 확인한다.

## 10개 지표와 6개 진단의 의미 검토

검토일: 2026-09-30. 이 절은 두 제안서의 예시를 [METRICS](METRICS.md)의 관측 계약과 대조한 **연구 판단**이다. 예시 수치나 기본 임계값은 실제 데이터에서 검증된 통계가 아니다. 현재 로그 구조 조사도 지표 정확도·진단 precision 검증을 대신하지 않는다.

### 10개 MVP 지표

| 지표 | 의미가 달라질 위험 | 계획에 필요한 계약 |
| --- | --- | --- |
| Active Time | session의 첫·마지막 timestamp 차이에 며칠의 공백이나 대기가 포함됨 | 명시적 턴 구간의 합집합과 observed span을 구분한다. 턴 경과 시간은 CPU 실행·순수 모델 사고 시간으로 표시하지 않는다. |
| Tool / Command / Category Time | 병렬 호출 합계와 wrapper·내부 작업의 중복으로 경과 시간 초과 | 실행 정체성을 먼저 정리하고 호출 합·구간 합집합·`concurrent`를 구분한다. 표시 패턴과 작업 정체성도 분리한다. |
| p50 / p95 Latency | runtime·항목 lifecycle·관측 latency를 섞거나 작은 표본으로 꼬리를 확정 | 같은 scope·evidence의 terminal 표본, nearest-rank와 `n`을 유지한다. `n < 20` 경고는 제품 판단이다. |
| Failed Executions | `rg` exit 1의 결과 없음, 취소·pending을 실행 실패에 포함 | 명령 의미에 따른 terminal status와 성공·실패·취소·unknown 분모를 각각 드러낸다. |
| Retry Overhead | 체인 경과 시간에서 성공 duration을 뺀 값을 불필요한 재시도로 오해 | 실패 시도의 알려진 시간과 체인 경과 시간을 분리한다. 같은 작업·오류 연결 근거가 있어야 한다. |
| Repeated Error Time | 같은 error와 retry의 시간을 이중 합산하거나 첫 오류 이후 전체를 손실로 계산 | 알려진 실패 구간만 포함하고 global Detected Waste는 합집합으로 만든다. fingerprint 충돌·불명도 남긴다. |
| Recovery Time | 다른 작업의 성공을 복구로 연결하거나 미해결을 0으로 채움 | 같은 작업의 첫 실패 결과부터 확인된 성공 결과까지 연결한다. 해결된 체인의 분포와 미해결 수를 함께 표시한다. |
| Repeated Read / Search Ratio | 같은 파일의 재방문을 불필요한 동일 내용 읽기로 판단 | 비율은 재방문의 기술이다. 진단은 읽기 범위·내용 식별·변경·결과 잘림을 추가로 확인한다. 검색 fingerprint는 별도로 둔다. |
| Edit → Validation Cycles | command 이름만으로 full build, 편집 도구만으로 전체 파일 변경을 확정 | 관측한 편집만 연결하고 검증 scope 근거와 terminal 분모를 유지한다. unknown은 계산에서 드러낸다. |
| Token Attribution | 응답 사용량·누적 snapshot·cache를 중복 합산하고 주변 도구에 귀속 | 공급자 필드 의미와 고유 응답을 검증한다. 턴 사용량 우선, 단계·도구 귀속은 근거가 없으면 `unattributed`다. |

### 핵심 의미 위험

**겹침은 두 단계에서 처리한다.** 동일 실행의 wrapper·내부 표현을 제거하는 작업과 실제 독립 호출의 병렬 구간을 합치는 작업은 다르다. 실행 ID를 먼저 정리한 뒤 구간 합집합을 구한다. retry 12초와 repeated error 8초가 5초 겹치면 총계는 15초다. 내역 20초를 경과 시간으로 표시하지 않는다. 위치를 모르는 duration은 별도의 호출 합에만 포함한다.

**복구 통계에는 관측 종료를 남긴다.** [NIST Censoring](https://www.itl.nist.gov/div898/handbook/apr/section1/apr131.htm)은 관측 기간 이후의 완료 시점을 모르는 데이터를 right censored로 설명한다. 이를 AgentProf에 적용하는 것은 연구 판단이다. 복구가 없었다는 충분한 관측 근거가 있을 때 미해결 체인의 관측 기간은 하한 정보가 될 수 있다. 단순 로그 누락·관측 단절은 동일한 정보가 아니므로 분리한다. 해결된 체인만의 median은 **해결된 체인에서 관측한 median**으로 표시하고 전체 복구 시간 분포를 추정했다고 하지 않는다. v0.1에 survival model 구현을 추가하는 제안은 아니다.

**명령 패턴은 작업 ID가 아니다.** `npm test foo`와 `npm test bar`가 `npm test <target>`으로 표시되어도 서로 복구시키지 않는다. `operationKey`에는 provider가 확인한 프로젝트·실행 문맥과 정규화된 대상·중요 플래그의 keyed fingerprint를 보존한다. 원문 인자를 저장하지 않고도 구별할 수 있어야 한다. 임의 셸 문자열은 치환·실행하지 않는다. 복합 명령의 작업 분리가 불명확하면 체인 진단 신뢰도를 낮추거나 미분류로 둔다.

**읽기 후 변경은 검증 가능한 범위에 한정한다.** 같은 파일을 편집 뒤 다시 읽거나 다른 줄 범위를 읽는 것은 정상 검증일 수 있다. CLI는 현재 파일 내용을 다시 열어 과거의 동일성을 만들지 않는다. 입력 로그에서 내용 식별·변경 여부를 확인하지 못하면 `unknown`이다. 외부 변경을 관측하지 못한 것도 파일이 그대로였다는 증거가 아니다. 원문 내용 대신 로컬 fingerprint와 범위·관측 관계를 사용한다.

**토큰 근처의 활동은 토큰 소비 주체를 증명하지 않는다.** model response usage는 해당 도구의 실제 입력 크기나 작업 단계별 비용이 아니다. cumulative snapshot, 재저장 응답과 fork의 복사된 이력을 함께 합산하지 않는다. cache 포함 관계는 공급자별로 확인하며 한 공급자의 필드 의미를 다른 공급자에 적용하지 않는다. 단계 추정이 가능해도 measured turn usage와 별도 evidence로 표시한다.

### 6개 초기 진단

| 진단 | 검토 판단·경계 |
| --- | --- |
| Slow Tool | 같은 duration scope·evidence의 관측 비중과 표본을 근거로 우선순위를 제안한다. 로그만으로 네트워크·서버·모델 원인을 확정하지 않는다. |
| Retry Loop | 같은 `operationKey`·오류·턴의 반복 실패를 연결한다. 표시 패턴만 같은 대상·플래그 변경을 다른 작업으로 남긴다. |
| Repeated Error | 세션 간 오류의 재발이다. setup·문서 개선은 가설이며 keyed fingerprint만으로 root cause를 확정하지 않는다. |
| Exploration Thrashing | 읽기·검색의 높은 빈도와 적은 관측 편집은 휴리스틱이다. 조사·리뷰에는 정상일 수 있으므로 “진행 없음”이나 절감 시간을 단정하지 않는다. |
| Validation Thrashing | 반복 검증과 편집·scope 근거를 연결한다. full scope 근거가 없으면 expensive full build로 설명하지 않는다. |
| Context Churn | 같은 lookup·범위·관측된 내용과 변경 상태를 비교한다. 편집 뒤 재읽기·범위 차이·불명확한 내용 동일성은 제외하거나 신뢰도를 낮춘다. |

규칙의 횟수·10분·15분 기준과 Slow Tool 비중은 초기 튜닝 후보다. 외부 표준이나 실제 성능 개선 효과에서 유도한 수치가 아니다. 합성 양성·음성 사례와 로컬 파일럿에서 근거·rule version·false positive를 확인한 뒤 조정한다. 조언과 실제 개선 효과는 분리하며 Detected Waste는 **관측 패턴에 연결된 시간**이라는 설명을 유지한다.

### 구현 전에 남은 질문

- P0: 소스별 턴·항목·프로세스 시간의 scope, clock 차이·충돌·누락에 대한 우선순위는 무엇인가?
- P0: wrapper와 child의 같은 실행 여부를 입증할 ID가 없을 때 어떤 표본과 커버리지를 제외할 것인가?
- P0: operation identity에 필요한 대상·플래그를 어디까지 관측할 수 있으며 복합 명령·대상 변경은 어떻게 분리할 것인가?
- P0: 결과 없음·실행 실패·취소의 provider별 의미, 서로 다른 오류와 새로운 시도의 체인 분리 조건은 무엇인가?
- P0: 관측 단절·미해결·뒤늦은 성공과 기간 경계를 recovery cohort에 어떻게 포함할 것인가? 기본 동일 턴 연결의 한계도 지원표에 남겨야 한다.
- P0: 읽기 범위·내용 fingerprint·변경 증거가 공급자별로 어느 정도 존재하는가? 없으면 진단의 어떤 부분을 미지원으로 표시할 것인가?
- P0: 고유 응답과 턴별 usage, cumulative snapshot, cache input 포함 관계를 각 공급자에서 어떻게 검증할 것인가?
- P1: Node 최소·현재 버전에서 RC SQLite의 필요한 API와 DB 복구 검증이 통과하는가? 실패 시 `better-sqlite3` 계획 변경을 먼저 반영해야 한다.
- P7: 규칙별 표본·시간 커버리지·false positive와 자원 측정은 어떤 로컬 파일럿 조건에서 보고할 것인가? 임계값을 검증했다고 주장할 기준을 정해야 한다.

이 질문들은 구현 계약·검증 작업이다. FINDINGS의 연구 권고가 SPEC의 범위를 자동 확장하거나 acceptance를 통과시킨다는 뜻은 아니다. 실제 사용자 로그·프롬프트·코드·출력은 이 추가 조사에서 열거나 복사·업로드하지 않았다.

## 최신 제품 결정

기록일: 2026-09-30. 다음은 공식 자료에서 추론한 사항이 아니라 부모 계획 세션이 전달한 **사용자 결정**이다.

- 마스코트는 **Salamander / 도롱뇽**으로 확정한다. Downloads의 `salamander1.png`, `salamander2.png`, `salamander3.png`는 README·리포트 디자인용 참고 자료다. 이는 최종 로고·배포 이미지가 완성됐다는 뜻은 아니다.
- v0.1은 **일회성 HTML 생성과 열기**를 제공한다. 실시간 로컬 대시보드는 후속 확장 아이디어로 아키텍처에서 고려하며 현재 구현 범위에 넣지 않는다. 자동 watcher·대시보드 서버·상주 작업은 추가하지 않는다.


## 2026-09-30 계획 재검토: 검증 순서와 진단 의미

검토 기준은 main `676faf931732ce696b0149154eb2a19b701ef741`의 유지 관리 문서다. 다음은 문서 간 의존성과 제품 목표에 대한 **계획 검토 판단**이며 추가 실로그 조사·제품 실행 결과가 아니다. 원본 제안 문서는 변경하지 않는다.

- 구조 필드 관측만으로 지표 의미·지원율은 검증되지 않는다. P0에 지표/필드/공급자·버전/근거/표본·coverage 행렬을 두고 P2/P3에서 파서와 수작업을 로컬 대조한다. P7은 첫 검증이 아니라 최종 파일럿·지원표 갱신이다. 신규 행렬 결과는 NOT RUN, 값은 TBD다.
- commandPattern·operationKey·lookup/content/error fingerprint는 원문이 있는 정규화 경계에서 생성해야 한다. P1 계약, P2/P3 생성, P4 저장, P5 소비로 책임을 명시한다. P5에서 원문을 복원하는 방식은 개인정보 계약과 양립하지 않는다.
- 6개 진단의 양성·정상 음성·오탐과 제안의 실행 가능성을 완료 기준에 넣는다. 실제 precision이나 개선률은 아직 측정하지 않았으며 기본 임계값은 보정 후보다.
- Slow Tool의 시간 비중은 병목 신호이며 낭비 근거가 아니다. METRICS의 명시적 규칙별 포함표와 첫 실패 포함/최초 lookup 제외, canonical 실행 중복 제거 후 구간 합집합을 기대값으로 검증한다. 탐색/검증 휴리스틱 단독은 시간 총계에서 제외한다.
- 제품의 전후 검증 약속은 v0.1 수동 matched pilot으로 좁혀 명확히 한다. 자동 매칭·설정 변경 추적·비교 UI는 v0.2로 유지한다. 조건이 다르면 비교 불가, 실제 변화가 없으면 효과 없음으로 기록한다.
- 전체 상세 화면보다 시간·실패·재시도의 작은 CLI/오프라인 HTML 세로 단면을 P5 초기에 검증한다. 성능 예산·workload는 P0에 결정하고 실측은 이후에 기록한다. 현재 성능 수치는 없다.

이 개정은 계획 문서만 변경한다. 연결된 구현 이슈 본문과 마일스톤은 수정하지 않았으므로 새 단계 책임·검증 gate의 반영 여부는 후속 동기화 때 확인한다. 제품 코드·설치·테스트·실로그 파일럿 acceptance는 모두 NOT RUN이다.

## 2026-09-30 P0: bounded 지표 증거와 사전 gate

조사 기준은 사용자가 개정한 main `36bb389262ae44d3f7afe3060401537c41f55c11`이다. 별도 연구 서브세션이 허용된 로컬 Codex·Claude 로그 12개 snapshot을 읽어 4,286개 완전 레코드의 필드·ID/timestamp 관계를 대조했다. 이전 최근 5개 prefix 조사와 다른 목적 표본이며 합쳐 모집단 coverage로 표현하지 않는다. 실제 경로·ID·digest는 로컬 private manifest에만 있고 원문·명령·출력·프롬프트·사용자 코드·비밀값은 공유 문서나 fixture에 넣지 않았다.

- [EVIDENCE.md](EVIDENCE.md): 5개 Codex·2개 Claude runtime-header 층 × 10개 지표의 필요 필드, direct/observed/unsupported, 후보 eligible/inspected/timed 단위, 누락 사유와 독립 합성 fixture 연결을 기록했다. 조사 gate와 실제 파서/지원 승격을 분리한다. fork 원래 실행 버전·canonical wrapper·operation/error identity의 의미는 미검증이다.
- Codex command/MCP 362개 후보 중 32개는 직접 duration과 item boundary 차이가 1 ms를 넘었다. runtime과 lifecycle을 같다고 강제하거나 위치 없는 duration의 구간을 역산하지 않는다. 별도 interval scope/evidence 계약을 부모가 계획에 반영했다.
- Claude 표본 280개 tool_use는 결과 ID와 nonnegative 시각 관계로 연결됐지만 직접 duration은 0/280이었다. 관측 latency이며 프로세스 runtime을 증명하지 않는다. `turn_duration` 8개는 직접 합계 후보이며 명시적 턴 구간이 아니다.
- Claude `2.1.241`의 243개 message IDs 중 108개에서 재저장 usage 값이 달랐다. 첫 값으로 고정하거나 모든 값을 더하지 않는다. source ordering/final snapshot 의미·cache 계약을 파서 대조하고 synthetic updated-usage로 고정한다.
- Codex fork 표본에는 선두 runtime metadata 뒤에 다른 버전의 metadata가 복사돼 있었다. 완료 항목의 explicit thread는 선두 meta ID와 일치했다. `subagent_history_start_ordinal`이라는 필드명이나 값만으로 copied/new 경계·원래 실행 버전을 확정하지 않는다. 검증된 관계가 없으면 origin 불명을 유지한다.
- [QUALITY.md](QUALITY.md): 6개 규칙 각각 양성·정상 음성, included/excluded/waste 의미, 목적 표본 선택·TP/FP/판정 불가·제안 적용 가능성과 출시 지원 gate를 사전 결정했다. 검토 주체는 부모 Codex 기술 검토이며 사람 파일럿은 NOT RUN이다.
- [BENCHMARKS.md](BENCHMARKS.md): 합성 small/large/append/no-change/report/boundary workload, 최소 장비 class와 Node·cold/warm 조건을 정했다. macOS 기준은 부모가 hardware 필드를 확인한 로컬 Apple M4·16 GiB 장비로 선택하고 Linux runner는 미배정으로 남겼다. 64 KiB chunk·LF만 제외한 raw bytes 1 MiB line 계약에 맞춰 full/incremental 시간·512 MiB peak RSS·25 MiB HTML의 초기 예산을 측정 전에 고정했다. 실제 성능·브라우저 응답 예산은 미검증/TBD이며 제품 자원 acceptance는 NOT RUN이다.

실제 로그 대조를 반복 확장하지 않고 이 bounded increment의 미확인 조건을 P2/P3/P7에 넘긴다. 해당 공급자 버전 지원·진단 precision·성능 우위를 확인했다고 주장하지 않는다.

## 2026-09-30 P1: runtime·privacy foundation 검증

코드 `4f030c69a6a046d9c13e0028adb8f346722f5856`에서 TypeScript/npm·Commander·내장 `node:sqlite` 기반을 구현했다. macOS arm64와 Ubuntu 24.04 x64의 Node 24.15.0·24.21.0·26.7.0에서 clean install, build/typecheck, 60개 행동 테스트, 14파일 tarball의 npm exec·격리 전역 설치 help/version을 통과했다. Node 22.16.0은 compiled CLI·SQLite import 전에 거부했다. 세부 실행과 제한은 [ACCEPTANCE.md](ACCEPTANCE.md), Linux 결과는 [CI run](https://github.com/WhiteKiwi/agentprof/actions/runs/36712410194)에 있다.

P1에 필요한 prepared binding·migration·동기 transaction·rollback·reopen은 검증한 런타임에서 통과했으므로 SQLite driver를 변경할 근거가 없다. 이는 RC API의 Stable 전환이나 모든 OS/Node 지원을 의미하지 않는다. 실행 의존성은 Commander만이며 dev compiler/tool의 platform binary를 사용자 artifact에 넣지 않는다. public npm 이름·license·게시 후 npx는 미확정이다.

검토에서 같은 scope의 duration/interval 정밀도와 동등 근거 충돌, shell quote·git 옵션 값, discovery provider 중첩, opening size 고정, caller-owned transaction/async callback, 진단 runtime allowlist를 보완하고 회귀 테스트로 확인했다. 실제 provider adapter·이벤트/checkpoint 저장·지표/HTML·성능·사람 파일럿은 아직 NOT RUN이다. 디자인 가이드와 UI/README 꾸미기는 사용자가 별도 세션에 맡겼으며 이 증분은 시스템 기반을 담당한다.

## 2026-09-30 디자인 기반 연구

사용자 요청의 [design-guidelines skill](https://github.com/WhiteKiwi/skills/tree/main/skills/design-guidelines), [Design Index](https://github.com/WhiteKiwi/design-index)와 시스템/제품 영감 문서를 읽었다. [Recent](https://recent.design/)의 정확한 사이트와 화면을 cloud browser에서 확인했다. 중립적인 탐색 chrome 안에 표현적인 작품을 분리하는 구성을 관측했다. 이를 데이터 화면 전체의 효과·애니메이션으로 복제하지 않고 하나의 brand scene과 조용한 분석 영역의 분리로 적용한다.

제공된 네 이미지 모두 로컬에서 실제 픽셀을 확인했다. 어두운 기술적 trace 분위기와 평면 주황 도롱뇽을 구분하고, 신규 원본은 첨부로 유지하고 저장소의 기존 이미지를 수정 없이 재사용하며 compact mark는 임시 선택으로 둔다. 기존 저장소의 dark/orange 참고 PNG도 별도로 읽어 확인했다. 새로운 로고 생성·벡터화·외부 디자인 자산 복사는 하지 않았다.

[Radix의 역할별 색상 구조](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)와 [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)를 확인했다. 색상 측정은 특정 pair의 근거이고 전체 접근성 인증은 아니다. 상세 판단은 [DESIGN-GUIDELINES](DESIGN-GUIDELINES.md), 실제 실행/렌더링 증거는 [DESIGN-QA](DESIGN-QA.md)에 분리한다. 제품 로그·지표 검증 상태는 변하지 않는다.

후속 확인: 최신 `create-design-guideline` skill과 두 reference를 `aeb0d118784de28aa616db2066a89c94eff4d850`에서 읽고 primitive/semantic·state·측정 pair·governance 표를 보완했다. 브라우저 QA는 환경 제한으로 NOT RUN이며 정적·색상 측정과 구분한다.

## 2026-09-30 측정에서 개선으로 검토

검토 목표는 **결과 품질을 유지하면서 토큰과 작업 경과 시간을 줄이는 의사결정**이다. 이번 작업은 저장소 코드·기존 공개 evidence·공식 자료를 읽은 문서 검토다. 새로운 사용자 로그를 읽거나 업로드하지 않았고 제품 파서·분석기·파일럿을 실행하지 않았다. 조회일과 저장소 revision을 구분한다.

### 현재 가능한 것과 계획된 것

다음 표는 PR #11의 검토 당시 고정 revision 기록이다. 이후 문서 PR #11과 기반 PR #9는 main `c3856249`에 병합되었다. 파서·제품 검증의 현재 범위는 [ACCEPTANCE.md](ACCEPTANCE.md)와 공급자별 evidence를 따른다.

| 기준 | 확인한 상태 | 해석 한계 |
| --- | --- | --- |
| [main `514ee77`](https://github.com/WhiteKiwi/agentprof/tree/514ee77b7e76f988116614e652268dfa1e31f252) | 계획 문서·합성 디자인 scaffold. 제품 src·패키지·분석기 없음 | 목표 화면·명령을 배포 기능으로 표현하지 않음 |
| [draft PR #9](https://github.com/WhiteKiwi/agentprof/pull/9), head `6f614727` | P0 bounded 표본과 합성 계약, P1 CLI/privacy/reader/discovery/SQLite 기반 | 미병합이며 ingestion 기반은 실제 provider parser·분석기 완료가 아님 |
| [PR #9 CLI](https://github.com/WhiteKiwi/agentprof/blob/6f614727dced9df2693ac008aa3f3e4be559386c/src/cli/main.ts#L21-L32) | help/version 기반, scan/stats/insights/report/open은 NOT_IMPLEMENTED·exit2 | time/token 집계·자동 insight·offline 제품 report는 아직 실행 기능 아님 |
| [PR #9 evidence](https://github.com/WhiteKiwi/agentprof/blob/6f614727dced9df2693ac008aa3f3e4be559386c/docs/EVIDENCE.md#L185-L193) | 공급자별 필요 필드·누락·coverage·후속 의미 대조를 기록 | P0를 미실시로 부르면 오래된 평가. 표본의 필드 존재는 제품 지원/정확도 보장도 아님 |
| [PR #9 fixture 계약](https://github.com/WhiteKiwi/agentprof/blob/6f614727dced9df2693ac008aa3f3e4be559386c/docs/FIXTURES.md), [품질 절차](https://github.com/WhiteKiwi/agentprof/blob/6f614727dced9df2693ac008aa3f3e4be559386c/docs/QUALITY.md) | 손계산 oracle·정상 음성·판정 불가·actionability gate가 있음 | fixture 가정의 wrapper/fork 관계는 공급자 schema 보장이 아님. 기반 테스트는 분석기·사람 파일럿 통과가 아님 |

### 기존 P0 evidence의 중요한 경계

아래는 위 고정 revision의 공개 요약을 재검토한 것이며 이번 작업의 새 실측이 아니다. 선택된 bounded 표본을 전체 사용자/공급자의 대표 수치로 확대하지 않는다.

- Codex command/MCP 후보 362개 중 32개는 직접 duration과 `end-start`가 1ms보다 달랐다. runtime·lifecycle·observed latency를 분리하며 원인을 반올림/overhead로 확정하지 않는다.
- Claude paired 후보 280개에는 직접 duration이 없었다. pair는 관측 latency이며 순수 runtime이 아니다. `turn_duration` 8개도 위치를 아는 턴 구간이 아니다.
- Claude `2.1.241`의 고유 usage ID 243개 중 108개는 재저장 값이 달랐다. 첫 snapshot 고정·전체 합산 대신 source ordering·final 의미 확인이 우선이다.
- failed 후보 45개에 timing이 있어도 operation/error/성공 연결이 미검증이면 retry·recovery 지원 근거가 아니다. eligible chain 없음과 실패 없음은 다르다.
- [정규화 계약](https://github.com/WhiteKiwi/agentprof/blob/6f614727dced9df2693ac008aa3f3e4be559386c/docs/NORMALIZATION.md#L11-L31)의 exact argv/error keyed 비교는 잘못된 병합을 줄이지만 표현이 달라진 같은 작업을 놓칠 수 있다. identity coverage를 보고해야 한다.

### 공식 참고 자료와 적용 한계

조회일: **2026-09-30**. 아래는 설계 참고용 1차 출처이며 AgentProf 통합·개선 효과·벤더 성능 비교 결과가 아니다.

| 공식 자료 | 참고할 점 | AgentProf에서의 한계·판단 |
| --- | --- | --- |
| [OpenTelemetry GenAI metrics](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md) | client operation·agent invocation·workflow의 duration 경계를 분리. 문서는 Development 상태 | 기존 [웹 문서](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/)는 새 저장소로 이동. 날짜/버전을 고정해야 함. instrumentation 경계를 사후 로그에서 항상 복원할 수 없으며 OTel 수집/호환 지원은 이번 범위에 추가하지 않음 |
| [Langfuse data model](https://langfuse.com/docs/observability/data-model) | observation → trace → session의 단위를 구분하고 필터/버전별 탐색에 연결 | 같은 trace/session의 관측을 무조건 더하지 않음. evidence navigation의 참고이며 원문 input/output 저장·외부 trace 전송을 채택하지 않음 |
| [LangSmith evaluation types](https://docs.langchain.com/langsmith/evaluation-types) | curated dataset의 버전 비교, regression·pairwise·summary 평가 구분 | task mix가 다른 세션 비교를 실험처럼 해석하지 않음. 품질 기준을 사전 고정하되 LLM judge·온라인 평가 서비스 도입은 v0.1 범위 밖 |
| [Phoenix workflow](https://arize.com/docs/phoenix/quickstart) | tracing의 관측 → correctness 평가 → 같은 입력/기준의 experiment로 연결 | trace 화면만으로 개선을 입증하지 못함. local-first를 유지하며 서비스/SDK 설치 없이 수동 matched pilot 설계에 참고 |
| [OpenAI latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization) | 생성 token·입력 token·요청 수·병렬화는 서로 다른 latency 최적화 축 | 일반적 heuristic을 AgentProf 예상 절감률로 복사하지 않음. 입력 축소가 task elapsed를 같은 비율로 줄인다는 보장 없음. 필요한 결과/검증을 줄이지 않음 |
| [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | cached input과 cache-write 세부값은 input usage 안에서 해석. cache-hit 비율은 cached 합/input 합 | cache-hit와 비용·latency는 다른 값. API 의미를 Codex 로그 전 버전에 그대로 적용하지 않음. 가격/모델별 설정은 검토 범위 밖 |
| [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | total input은 input + cache-read + cache-creation. creation 세부 bucket은 상위 합계 내역 | OpenAI와 같은 포함 관계로 합산하면 오류. Claude Code 로그의 final/partial·cache 의미는 adapter에서 별도 대조 |

### 검토 결론과 문서 반영

1. **관측 정확성과 개선 가능성을 분리한다.** 정확한 시간/usage가 있어도 낭비·원인·절감 가능성은 추가 근거가 필요하다. Detected Waste는 관측된 패턴 관련 시간이다.
2. **토큰과 체감 시간을 함께 본다.** response input·output·cache·전체 사용량과 task elapsed, 호출 합·구간 union·session-minutes를 혼동하지 않는다. provider 생산성 순위·tree만으로 critical path·gap을 모델 사고로 설명하는 것은 보류한다.
3. **작은 행동 단위를 먼저 만든다.** freshness/coverage → hotspot → 확인된 실패 → 검증된 retry → 조치 하나 → 같은 조건 검증이 우선이다.
4. **여섯 후보를 구체화한다.** 큰 출력, 반복 검색, 넓은 검증, 반복 실패, context 성장, 병렬 중복을 근거·제안·실험·품질 보호 조건으로 연결한다. 기존 6개 규칙과 신규 후속 후보를 구분한다.
5. **효과 없음도 결과다.** 실패/미완료를 제외하거나 coverage가 낮아진 실행을 빨라졌다고 해석하지 않는다. 품질 gate·parent/child usage·준비/요약/재조회 비용과 변동성을 함께 기록한다.

공식 자료를 AgentProf에 적용한 부분은 **설계 판단**이다. 계산은 [METRICS](METRICS.md#aggregation-and-token-accounting), [행동 카드](METRICS.md#efficiency-opportunity-cards), 순서는 [IMPLEMENTATION](IMPLEMENTATION.md#efficiency-review-priorities), 검증은 [ACCEPTANCE](ACCEPTANCE.md#quality-preserving-improvement-pilot)에 반영한다. 후속 후보는 [BACKLOG](BACKLOG.md#efficiency-candidate-gates)에 남긴다. 원본 제안과 병행 PR의 코드는 변경하지 않는다.

## 2026-10-01 P3: Claude adapter 구현 전 조사

별도 연구 담당이 main `baa384f779d5eab6d31a6c7099372f19a1d98496` 기준으로 P0 Claude S1–S3의 고정 prefix/digest를 재현했다. 1,179 records·280 call/result pairs·8 duration-only turns·626 usage records/251 message IDs가 기존 P0와 일치했다. 원문은 RAM에서만 읽었으며 명령을 실행하거나 실제 로그·경로·ID를 문서/fixture/메모리에 복사하지 않았다. 자세한 분모·실제 field/type과 후속 대조 기준은 [CLAUDE-EVIDENCE](CLAUDE-EVIDENCE.md)에 있다. 앱 코드·테스트·기존 provider fixture는 이 조사에서 변경하지 않았다.

- UUID records 960개는 각 stream에서 유일했다. 하나의 API message ID가 여러 UUID/content block records로 나뉘므로 UUID replay 제거와 response usage upsert를 분리한다. P0의 “usage 재저장”은 같은 UUID 재저장이 검증됐다는 뜻이 아니다.
- result 280/280에서 tool_use ID·parentUuid·sourceToolAssistantUUID가 같은 stream의 call과 연결됐다. 직접 tool duration은 0/280이다. parent timestamp 역전 4개가 있어 parent 관계를 시간 구간으로 바꾸지 않는다.
- Bash backgroundTaskId 5개와 Agent async_launched 1개는 시작 확인이다. canonical pending과 source acknowledgement latency를 분리한다. Agent ID가 S3와 맞지 않아 추정 parent join을 하지 않는다. 실제 child-process exit는 검증된 직접 필드가 없으므로 null이다.
- turn_duration 8개는 durationMs 값과 end_turn assistant parent만 관측됐다. 시작/종료 구간·duration scope는 미검증이므로 unknown duration-only로 보존한다.
- S3의 108 message IDs는 output_tokens가 늘며 마지막 ordinal의 stop_reason가 tool_use 107/end_turn 1로 바뀌었다. 공개 API message_stop와 local 저장 시점의 연결은 미검증이다. 실제 usage는 모두 unknown/provisional이며 terminal-shaped enum을 final 보장으로 승격하지 않는다.
- Anthropic all-input은 ordinary + cache-read + cache-creation이다. 626 records에서 네 기본 component를 확인했고 TTL bucket이 있는 466 records에서 상위 creation 합과 일치했다. reasoning 포함 관계는 미확정이므로 thinking_tokens를 output에 더하거나 reasoningOutput으로 승격하지 않는다.
- 합성 usage 6→10의 finality/order, copied fork ordinals와 source duration은 외부 trusted test context로만 검증한다. 실제 source의 임의 annotation을 신뢰하지 않는다. 구현 전 조사 단계에서 private oracle/script를 준비했으며 실제 어댑터 parity는 아래 후속 실행 전까지 NOT RUN이었다. 전체 provider support·제품 acceptance는 이 조사로 통과하지 않는다.

P3 최종 재freeze build 대조는 2026-10-01 10:35:00.753–10:35:04.662 KST, Node 26.7.0에서 실행했다(elapsed 3,908 ms). 초기 10:23 KST 실행 뒤 최초 call cwd와 source-point origin/ownership replay 회귀가 보완됐다. 아래는 이 수정과 metadata declarationFingerprint가 포함된 최신 build의 결과다. S1/S2/S3 각각과 합본의 keyed execution·turn·usage·source observations·message links·metadata가 독립 기대값과 일치했다. 합본은 executions 280(completed 180/failed 12/unknown 82/pending 6), canonical intervals 274/source results 280, duration-only turns 8, usage IDs 251/source usage observations 626/eligible 0, message links 935/typed edges 1,211, metadata 1,179였다. base 64,426/replay 64,426/RAM archive 110,557 field 비교와 3,667 helper 비교의 최종 mismatch는 0이다.

직접 own declaration fields의 presence/value를 정렬한 JSON과 HMAC을 독립 계산해 metadata 1,179개/archive 2,358개의 새 declarationFingerprint를 대조했다. 같은-source replay 후 전체 snapshot·retained state·counters·capabilities가 exact 동일했고 새 inputDigest/callProjectId 반환 필드도 privacy 순회에 포함했다. RAM archive는 별도 file identity로 재표현한 것이며 실제 archive 파일 조사가 아니다. canonical은 sourceRef를 제외하면 동일하고 observations 3,552→7,104/metadata 1,179→2,358로 provenance만 늘었다. 각 표본·합본·재표현 모두 기본 상한 내였고 STATE_LIMIT·dropped diagnostics 0, 실제 usageProofReplays 0이었다. JS string.length 기준 16 UTF-16 code units 이상 민감 후보 합본 3,075개/archive 3,078개를 반환 leaf string/key와 exact 대조해 hit 0을 확인했다. 선정 기준·검증 수·harness 분모 보완·짧은 문자열/heap 등 한계는 [CLAUDE-EVIDENCE](CLAUDE-EVIDENCE.md#final-bounded-parser-verification)에 기록했다.

지원 경계는 shape_verified_only/partial이다. unsupported records 244와 operation/lookup/error evidence 누락을 성공으로 숨기지 않는다. 실제 usage finality는 unknown/provisional이며 raw error/content identity는 완전성 증거가 없어 null이다. 전체 버전 지원·실제 fork/미관측 duration·제품 acceptance·성능·사람 파일럿은 별도다. 연구 담당은 제품 코드·테스트·Git·Project·memory를 변경하지 않았다.

## 2026-10-01 source-local summary planning evidence

Independent planning inspected main `489cd20637e692b27ed6e590af41b04f0858c27f`: schema 3 readback validates a bounded single generation but omits metadata/wrapper/message graphs and parser recovery state. Therefore cross-source canonical reconciliation cannot be inferred from source order, revision or component maxima. Existing Codex usage selection distinguishes source-terminal evidence from trusted fixture finality; actual Claude transcript usage remains provisional. Normalized Claude input already contains cache-read and cache-write components. The coordinator reviewed the separate plan before implementation, requiring whole-group duplicate conflict exclusion, all-selected-row optional-component completeness, and an internal validated-readSource-only boundary. These are design findings, not execution passes or additional provider-version support.

## P5 read-only selected-source stats (2026-10-01)

Rechecked live P4/P5 claims and PR24 on 2026-10-01 13:47 UTC. CLI reservations are released; report/** and REPORT-PREVIEW remain independently owned. PR24 is draft/unmerged at 9cb0b19675cb8f695ceee3b6860780e5ccdab932. Read-only SQLite supports this product DELETE-mode store; immutable is prohibited, WAL/sidecars reject, and arbitrary external journal-mode switches are not supported. Opener syscall/no-side-effect verification is still NOT RUN.

Read-only stats execution evidence is now recorded in [P5-READONLY-STATS](P5-READONLY-STATS.md): Node 24.19.0 Linux full check 488 tests / 23 files / 35-file artifact passes; synchronized inotify with positive transient controls found no reader mutations in seven synthetic success/failure scenarios. This supersedes the initial NOT RUN above only for those local checks. Other-runtime CI, macOS, arbitrary external mode/schema/path races and full-history resource acceptance remain outside this local result.

Final metadata projection correction raises the passing local gate to 490 tests / 23 files / 35-file artifact; large TEXT/BLOB settings reject before materialization. See the final evidence and historical interrupted-run caveat in the stats contract.

## 2026-10-01: bounded unchanged-source proof review

Main 1dcd70089d640f5137b382eaf83b0b2ecc49b41d and its complete recursive Git tree were checked before implementation. Existing boundaryFingerprint covers only the completed-prefix tail, so it cannot authorize whole-source reuse. Existing JSON fingerprint's 2 MiB input limit remains unchanged. The separate planning review approved streaming standard HMAC with explicit domain/length framing, same-parsing-read ownership, atomic schema-4 optional proof lifecycle and a fresh synchronous final read transaction. Strict read-only schema policy intentionally rejects schema 3 until a write opener migrates. The conservative first implementation still reads all bounded bytes and validates stored payloads twice; no benchmark or universal speedup is claimed. Detailed decisions and planned verification are in [P4-UNCHANGED-SCAN](P4-UNCHANGED-SCAN.md).


## 2026-10-01: source-local Slow Tool provenance review

Independent read-only planning inspected main `1dcd70089d640f5137b382eaf83b0b2ecc49b41d` and PR [#27](https://github.com/WhiteKiwi/agentprof/pull/27), exact head `d3289118658070a0601876445ac105fc6f1d898c`. Fresh implementation-start reads confirmed the only open PR is that unmerged draft, with the same 33 changed paths. The coordinator explicitly chose a stack on its exact head; all 161 source-tree blobs were verified before copying. Shared documentation is appended, preserving every PR27 byte. Publication must explicitly depend on PR27 while open; the coordinator owns later retarget/reconciliation.

The retained metric evidence contains native event IDs, source positions, representation/origin and Claude completion semantics, but no stored wrapper-child or message graph. Current Codex v1 prioritizes structured runtime and maps terminal polls to original native calls; known wrapper observations are not separate event executions. Claude v1 requires final invocation results and preserves background acknowledgements as pending. MCP/browser normalization erases concrete targets and tool names. Therefore only admitted native-call classes and coarse display cohorts are supportable, not physical leaf deduplication or same-operation inference. A timed otherwise-admissible row with missing/contradictory provenance must suppress its entire compatible partition, since merely removing it can inflate another cohort's share. The reviewed bounds, provider-specific gates and independent synthetic verification plan are recorded in [P5-SOURCE-SLOW-TOOL](P5-SOURCE-SLOW-TOOL.md). No real-user logs, empirical duration-support promotion, performance campaign, usefulness or causal-effect validation was performed for this slice.

The new source-local rule's executed evidence is in [P5-SOURCE-SLOW-TOOL](P5-SOURCE-SLOW-TOOL.md#executed-verification--2026-10-01): 116 independent synthetic tests include actual persisted ordinary provenance for both providers; the final Linux Node 24.19.0 standard gate passes 709 tests / 28 files / 37-file artifact. Exact source-byte/store-generation immutability and full-partition suppression for missing large-call evidence are verified. These results validate the bounded calculation contract only; empirical diagnostic usefulness, provider-version expansion and optimization effects remain unestablished.


## 2026-10-01: selected-source insights presentation review

Read-only planning found the existing source-local Slow Tool rule already returns stable source/revision/byte bounds, complete admitted compatible denominators, full decisive evidence and matched experiment/quality safeguards. The missing narrow capability is user access through `insights --source`, not another rule or data model. Reusing the existing pinned read-only store can expose one immutable validated generation without raw-input access or writes. Rendering must preserve unavailable versus empty candidates and unknown versus actual zero; a concentration candidate, even 100%, does not establish waste or savings. Full candidate guidance is bounded but verbose, so structural work-count/output-size checks replace hardware timing assertions. The planned contract is [P5-SOURCE-INSIGHTS-CLI](P5-SOURCE-INSIGHTS-CLI.md). The executed synthetic CLI evidence is now recorded there: 769 tests / 30 files and the 38-file artifact on Linux Node 24.19.0, with exact one-generation JSON, no-write storage and 80 neighboring-command parity comparisons. These validate the bounded CLI contract; no real-user usefulness, precision or optimization effect is claimed.

## 2026-10-01 — Ordinary source-local failure provenance

Pre-production synthetic research on exact main `18bd5579fc4954d29e710c5d47157f4b189b97c7` confirmed nine independently expected cases through the existing ordinary `ingestSourceFile` provider adapter, SQLite commit, close/reopen and `readSource`. No trusted fixture context or user logs were supplied. Linux x64 Node 24.19.0; scratch TypeScript emit and probe under 512 MiB Node heap cap and umask 022. These are status/provenance compatibility observations, not a new analyzer/full-check pass or empirical provider-support promotion.

- Codex structured native records: two rg exit-2 failures (one 4 ms, one untimed), rg exit-1 no-match, zero-duration success and another success retain 2 failed / 5 terminal. Every decisive observation is ordinary and source-position matching. The failed error fingerprints remain null.
- Codex ordinary result and final empty-char poll retain normalized failed/error with exact result source position even though observation transportStatus is unknown. A still-running poll stays pending. An untimed result stays failed with null duration. Explicit MCP isError=true also yields a failed ordinary call/result pair.
- Codex structured priority remains intact when a later fallback result conflicts; the normalized event points to structured evidence. Generic npm test exit 2, compound rg-and-test exit 1 and completed transport with nonzero exit all remain unknown in the tested cases. The first written expectation incorrectly classified npm test exit 2 as failed; source review corrected it before probe execution. `semanticExit` in `src/parsers/codex/command.ts` confirms nonzero errors only for known rg/git_diff policies. This is a material coverage limitation, not permission to broaden parser semantics.
- Claude ordinary is_error=true tool_result preserves failed status without timestamps; decisive observedAt and event endAt are both null, duration and error fingerprint remain null. The matching call and final invocation_result are retained. A background acknowledgement stays pending and conflicting final results stay unknown.

The proposed [failure view](P5-SOURCE-FAILURES.md) must separate status from timing, preserve raw inventory and generic-command unknown exclusions, and suppress a compatible session denominator when otherwise terminal native provenance is unresolved. Positive synthetic evidence does not establish real-user usefulness, physical execution uniqueness, retry/error identity, performance or optimization effects. Owner-only ObsDog integration and connector were unavailable; no alternate private source was read.

Further pre-CLI source review found that Claude invalid negative paired elapsed clears normalized endAt but preserves failed status and decisive observedAt. An ordinary reversed-time adapter/store probe confirmed this. Status admission therefore binds source position/final kind/isError independently of timestamps; paired timing separately checks exact valid boundaries. Codex structured completed/failed transport must match the reachable normalized status/outcome tuple, with no-match/change-detected as explicit failed-transport completed outcomes. Three initial analyzer controls failed before the approved correction; this history is not hidden.

## 2026-10-02: positioned invocation interval evidence boundary

Read-only inspection of merged main `38871590fb00efba2b1efd64f1b7639572365fce` confirms normalized events preserve interval scope/evidence separately from duration scope/evidence. The ordinary Claude adapter pairs call/result timestamps, invalidates reversed boundaries and clears conflicting interval evidence. Claude call observations have no timestamp; result observations retain observedAt. Therefore the new narrow view must independently prove raw call-to-start preservation through ingestion/store/reopen, then validate result/end linkage without reconstructing positions from durationMs. Reuse unchanged source-failures terminal admission once; its conservative source/session suppression remains authoritative. See [the frozen plan and execution record](P5-SOURCE-INVOCATION-OVERLAP.md). At this initial source-inspection checkpoint the new execution gate had not run; the later executed evidence follows below.

The initial raw multi-root fixture was not an ordinary supported positive: `ClaudeAdapter.#selectStream` binds the first root and marks differing declarations ambiguous. Nine initial first-gate tests passed, including all ordinary interval shapes; the tenth failed the incorrect ordinary-origin expectation. Preserve that evidence and assert suppression instead. Session-separation arithmetic must use explicitly synthetic validated-store partitions without claiming ordinary multi-root adapter support.

Corrected ordinary interval persistence gate passed 10/10. Actual pure analyzer plus integration checks then passed 50/50; one preceding fixture error (unknown interval evidence paired with known scope) was rejected by the existing validator and corrected without weakening validation. Independent process-runtime duration and missing duration both leave valid invocation positions intact in validated-store synthetic cases. Unsafe endpoint differences and accumulated sums return null measurements with specific reasons. This remains synthetic evidence, not a real-log pilot or support for ordinary raw multi-root inputs.

Independent parent review of PR #33 covered all thirteen changed paths and the ordinary adapter/normalization/store boundary. No production blocker was found. macOS arm64 Node 24.15.0, 24.21.0 and 26.7.0 each passed 1216 tests across 44 files with all 39 optional baseline/installed cases enabled and no skips; each unchanged artifact verifier passed with 45 packaged files. The source-head hosted CI independently passed on all three supported Linux runtimes with its 39 explicitly optional cases skipped. Renderer receipts agree across all three macOS runtimes and retain complete bounded JSON. See [independent parent review](P5-SOURCE-INVOCATION-OVERLAP.md#independent-parent-review-2026-10-02). These checks validate the synthetic calculation and command contract, not real-user timing, performance or savings.

## 2026-10-02 — Ordinary Claude checkpoint planning evidence

Read-only inspection of main `d3c6b63edc36ea61cf0cbe08912d76d8048f69af` confirms that Claude `snapshot()` omits private call/input/result digests, source/stream maps, positions/ordinals, deferred results, UUID/result replay sets, usage order, diagnostic dedup keys and counters needed for lossless continuation. `inspectRetainedState()` exposes more safe data but is not a versioned restore contract. The [checkpoint proposal](P4-CLAUDE-CHECKPOINT.md) adds no storage/scanner capability.

The current identity helper computes HMAC-SHA256 with a private KeyObject over the normalization/key version, domain and framed parts; its encoded input cap is2MiB. A separate checkpoint namespace and SHA-256 digest of the bounded serialized payload fit that existing contract without modifying identity derivation. This protects the serialized state under the same key, not the original log bytes or caller offset. Strict structural validation remains necessary, including recomputed-test-tag adversarial cases.

Production `source-ingest.ts` supplies zero-based ordinals; `tests/claude-helpers.ts` starts at one. Capture the observed first ordinal and validate consecutive continuation rather than silently assuming either convention. The repository tree has THREE Claude JSONL fixtures, not four: fork, message and real-shapes. All checkpoint fixture tests omit trustedFixtureContext. No actual user logs, source paths or raw contents were collected. Local ObsDog integration is not available in this dot cloud task; no external memory capture is asserted. This paragraph records the original source inspection; separate executed candidate receipts are in the checkpoint supplement.

Independent implementation review found two concrete API-boundary gaps: trustedFixtureContext can be inherited, and existing diagnostic alias coercion can retain a caller-owned object. Pre-fix synthetic regressions demonstrated incorrectly available checkpoints and two toJSON calls during export. Descriptor-only eligibility/encoding correct these checkpoint paths without changing inherited ingest behavior. The implementation contributor additionally reproduced JSON's loss of retained IEEE -0; v1 reports unavailable rather than normalizing parser state or inventing a wire representation.118 corrected new tests pass, including the genuine fixed4MiB boundary and exact source-key/limits/position binding; this is still not a source-file authenticity or scanner-resume claim.

Independent parent review of all ten PR #34 paths found no remaining production blocker. macOS arm64 Node 24.15.0, 24.21.0 and 26.7.0 each passed 46 files / 1334 tests with all 39 historical-baseline/current-installed optional cases enabled and zero skips, plus the unchanged 46-file artifact verifier. Separately installed SDK probes compare every split of an ordinary four-record stream and a second checkpoint cycle against the uncheckpointed current-main adapter, with independent HMAC identities, a 4000 ms invocation and 150 input / 160 total provisional tokens. Source-head hosted CI passes 1295 tests with 39 explicit optional skips per supported Linux job. Detailed receipts and the caught private baseline-preparation failure are in [independent parent review](P4-CLAUDE-CHECKPOINT.md#independent-parent-review-2026-10-02). Adapter state integrity remains distinct from original-file authenticity, and broad P4 readiness stays unchanged.


## 2026-10-02 ordinary Codex checkpoint feasibility

This section is a newly written recovery/execution receipt, not a byte-exact recovery of the lost research addendum. The authoritative pre-implementation contract [P4-CODEX-CHECKPOINT](P4-CODEX-CHECKPOINT.md) remains unchanged, SHA-256 `75c400e28f4bf6d04bfd860248a0349012aeb17f1239b24a3ed04282c0453c48`. Every existing section in this document and the current-main report changes is preserved.

The complete current-main base is `063ee04b37e97616065254c9534f430bdc33e3c3`, tree `ce44659dfa117c2009e9541c07af6fb9a6796fd3`; all 209 inherited blobs and file modes were independently reverified before the isolated candidate was edited. Existing Codex constructors remain the behavioral authority: ordered process/poll/pending maps can overlap, owner/active-turn/provider references may dangle at admission limits, and historical native-terminal usage evidence is independent of later ambiguous source metadata. Cumulative snapshot points retain diagnostic comparison history without deriving response increments.

Recovery provenance: the contract and validation test match their original frozen hashes. The behavior test has SHA-256 `020dfad054c9cb0991e933c608772111477b276cc24bbd2fad4ab7f4fa2c2e0d`; only its lost source-cap/counter gap was reconstructed and independently reviewed before the new freeze. The baseline rerun passed seven independent oracle cases; the selected absent-API case failed as expected before production. These are distinct from candidate implementation results.

Candidate implementation uses provider-local types and validation only. Checkpoint entrypoints preflight caller bindings/options/limits through own data descriptors and reject proxies without invoking traps. The direct constructor retains its existing spread semantics. The position observer runs before record-shape early returns, retains the authenticated restored boundary until the next descriptor, and never changes the existing ingest outcome. Mutable source, stream and execution records are owned by the new adapter; nested safe projections are frozen.

Initial candidate checks, Node `24.19.0`, Linux, existing pinned dependencies, one worker/512-MiB Node heap:

- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`: PASS
- `node node_modules/vitest/vitest.mjs run tests/codex-checkpoint.test.ts tests/codex-checkpoint-validation.test.ts --maxWorkers=1 --no-file-parallelism -t 'preserves all split positions|preflights|accepts safe null-prototype'`: PASS, six selected cases; 128 filtered, not validated by this run
- Initial codec/schema review: pending on the frozen three-file source candidate
- Full checkpoint corpus, inherited aggregate, build/artifact/installed-SDK, additional runtime/platform and exact-head hosted CI: NOT RUN for this candidate at this checkpoint

No performance, empirical provider coverage, scanner resume, durable database integration or broad P4 completion follows from these checks. Existing readiness flags remain false. Publication and final qualification remain separate coordinator gates.

### Initial independent review and complete checkpoint corpus

The initial source review identified budget validation after JSON graph allocation, missing mandatory source ownership and three leaf relationships. The repaired codec now performs a grammar/depth/node/collection-count/row-byte preflight before payload graph allocation. Nonempty semantic state and positioned diagnostics require an admitted source; primitive/array-only prefixes retain their valid empty source map and null-input diagnostic. MCP/patch event exit metadata remains null. An ambiguous observation cannot itself carry native-terminal usage, but historical ordinary observations remain valid after later source ambiguity. Nonstructured call/event operation identities match; structured replacement keeps its legitimate exception.

Ten additive regression cases were frozen after the original corpus, with negative RED receipts and positive controls before the corresponding repairs. Independent review cleared the repaired source, including the narrow diagnostic-owner follow-up. No mandatory-reference check imposes disjoint execution/poll/pending maps or graph completeness absent from the parser.

The first full run returned 143 PASS / 1 FAIL: an original test expected one inherited `trustedFixtureContext` getter access, while unchanged main reads it twice, once for copied ordinals and once for complete-output evidence. A separate pristine current-main checkout, independently verified against all 209 blobs/modes, passed a one-case witness asserting two accesses. Coordinator approval then changed only the test comment and that expected count from one to two; checkpoint entrypoint zero-hook assertions and production ingest behavior were unchanged. The earlier frozen validation hash remains historical; the corrected final validation test hash is `f6086e4e857fca494b54fec5b4adbfd01bc34fb8bc214c82e75dde5d8bf2b303`.

After that evidenced fixture correction, `tsc -p tsconfig.json --noEmit` passed and both checkpoint test files passed all 144 cases in 9.32 seconds, with one worker, a 512-MiB Node heap and a 600-second outer bound. The complete run includes seven-fixture every-split and second-cycle continuation, actual cap hits, owned/proxy-safe input validation, all-leaf re-signed mutations, source-order/origin semantics and genuine near-4-MiB plus exact one-byte budget boundaries. Before/after production, behavior-test and contract hashes match. These are bounded synthetic correctness checks, not an RSS or performance claim. Full-repository/build/artifact/installed and hosted/runtime checks are not implied by this checkpoint-corpus receipt.

### Local aggregate and installed qualification (2026-10-02 UTC)

The frozen candidate passed typecheck and build, then the full repository suite with one concurrent worker and a 512-MiB Node heap: **53 files, 1,499 PASS, 40 optional SKIP**, 165.06 seconds. A 600-second outer timeout bounded the aggregate. The subsequent unchanged artifact script failed initially because its default npm cache directory was absent; this was an environmental failure before successful packing, not a source or assertion correction. Retrying the unchanged script with a permitted temporary npm cache and the official registry passed all original checks: **53 artifact files**, script-disabled npm-exec/global-install help/version and installed read-only stats/insights/failures parity. Package/lock/workflow files remain byte-identical to the base.

A separately retained script-disabled install of the exact packed candidate and pinned Commander `15.0.0` passed the SDK continuation check. This used the actual installed package, not an extracted-only stand-in: all seven immutable ordinary Codex fixtures, **64 split/second-cycle cases**, full retained-state and per-suffix-batch equality against the pristine `063ee04b` adapter. A second independently built current-main checkout retained all 209 original blob identities and modes. Its exact help/version bytes matched both candidate and installed CLI. For all ten Codex/Claude fixtures, initial/reused scans and human/JSON list, stats, insights, failures, read-revisits and invocation-overlap output bytes matched current main.

The optional installed suites were then explicitly enabled against the retained install: **8 PASS across four files**, with 143 unrelated cases filtered by the focused selection. These exercise read revisits, invocation overlap, relationship persistence/budget reuse and measured HTML report publication. The original aggregate's 40 optional skips remain recorded honestly; eight installed cases were separately exercised, while the historical pre-slice baseline-binary selections were not relabelled as aggregate passes. Current-main compatibility instead has the independent ten-fixture byte-parity receipt above.

All inherited bytes/modes and the exact nine-path reservation were checked again after execution. The three shared documents retain their complete current-main prefixes, including report work. The original Codex contract remains byte-identical; the recovered behavior-test gap, ten additive review cases and approved getter-count fixture correction are separately accounted for. Real-user logs, empirical provider/version expansion, performance/RSS claims, additional supported-runtime/platform qualification and exact-head hosted CI remain outside these local receipts. No merge, release or deployment occurred.
