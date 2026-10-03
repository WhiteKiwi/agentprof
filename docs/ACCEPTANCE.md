# AgentProf v0.1 Acceptance

## Status

2026-10-01 KST. 아래는 **제품 흐름의 예정된 검증**이다. P0의 조사·계약·독립 합성 기대값 검토와 P1 실행 기반의 macOS/Linux 검증을 마쳤다. P2 Codex·P3 Claude 어댑터와 초기 npm 알파의 실제 실행 범위는 아래 evidence에 구분해 기록한다. 두 공급자를 연결한 제품 scan·분석·HTML·출시 파일럿은 아직 `NOT RUN`이다. 부분 검증과 전체 제품 acceptance를 구분해 기록한다. 별도 디자인 scaffold 검증은 [DESIGN-QA.md](DESIGN-QA.md)에 기록하며 제품 acceptance 통과로 취급하지 않는다.

| ID | 기대 동작 | 검증 방식 | 상태 |
| --- | --- | --- | --- |
| A01 | 두 공급자의 호출·상태·시간을 연결 | 현재·구형 합성 fixture와 수작업 ID·수치 대조 | NOT RUN |
| A02 | 시간 합계·합집합·겹침 분리 | 10초 두 호출·5초 overlap에서 20초·15초 | NOT RUN |
| A03 | 장기 세션·pending·누락 보존 | 재개·미완료·duration missing이 허위 active·0이 되지 않음 | NOT RUN |
| A04 | 재스캔·append·복구 안정성 | 중단 지점별 재시작, partial UTF-8·JSON, 2회 동일 입력 | NOT RUN |
| A05 | 교체·archive·fork·중복 메시지 처리 | stable identity와 source 기여분 기대 결과 | NOT RUN |
| A06 | 같은 작업·오류의 체인·복구 | 다른 대상 성공·미해결·병렬·오류 변경 fixture | NOT RUN |
| A07 | 반복 읽기·검색·검증 의미 유지 | 변경·다른 범위·scope 불명·edit 없는 검증 제외 | NOT RUN |
| A08 | 토큰·cache 중복과 추정 분리 | response 재저장·누적 snapshot·cache 의미·미분류 | NOT RUN |
| A09 | 10 MVP 지표·6 진단 계약 | METRICS의 개별 Verify, evidence·coverage·rule version | NOT RUN |
| A10 | Detected Waste 중복 제거 | 12초·8초·5초 overlap에서 15초, 낮은 근거 제외 | NOT RUN |
| A11 | 분위수·기간·타임존 재현 | 0·1·19·20개 표본, 자정·DST·기간 경계 | NOT RUN |
| A12 | 개인정보 경계 | secret sentinel이 DB·diagnostics·HTML·artifact에 없음 | NOT RUN |
| A13 | offline HTML·텍스트 안전성 | file:// UI 동작, 요청 0건, `</script>` 삽입 공격 | NOT RUN |
| A14 | CLI·HTML 같은 값 | 동일 source·period·filters 결과 대조 | NOT RUN |
| A15 | 설치 편의와 runtime 계약 | macOS arm64·Linux의 최소24.15.0·지원24 SQLite 검증, tarball npm exec·global install·첫 실행 | NOT RUN |
| A16 | 단계별 실제 데이터 지원과 자원 사용 | P0 행렬·P2/P3 로컬 의미 대조·P7 갱신, P0 예산 대비 시간·peak RSS·HTML 크기 측정 | NOT RUN |
| A17 | 한 번의 생성·열기와 headless 결과 보존 | 별도 scan 없이 `report --open`, 새 데이터 반영, opener 없으면 HTML·경로 보존 | NOT RUN |
| A18 | 원문 폐기 전 정규화 identity 완성 | P1 계약 → P2/P3 생성 → P4 round-trip → P5 소비; 대상·플래그 차이·키 버전·secret sentinel | NOT RUN |
| A19 | 규칙별 waste 포함 의미 | slow-tool 제외, retry 첫 실패 포함, lookup 최초 제외, canonical ID·clipping·duration-only fixture | NOT RUN |
| A20 | 진단 품질·제안 유용성 | 6개 규칙별 양성/정상 음성, 로컬 검토 표본·오탐·판정 불가·실행 가능한 다음 행동 | NOT RUN |
| A21 | 초기 세로 단면 | P5 초반 두 공급자 시간·실패·재시도의 CLI/최소 offline HTML 값·근거·privacy 일치 | NOT RUN |
| A22 | 수동 개선 전후 확인 | 아래 matched before/after 절차, 조건·표본·커버리지·비교 불가/효과 없음 기록 | NOT RUN |
| A23 | 집계 수준·분모 재현 | 동시 두 stream30분: global30분/session-minutes60분; 비율1/2와9/98→10/100; pooled p95 | NOT RUN |
| A24 | 최종 usage·cache 회계 | 같은 ID output6→10은10 한 번; OpenAI100in/cache40/out20→120; Anthropic100/read30/create20/out10→160; reset/final 불명은 unknown | NOT RUN |
| A25 | 개선 카드의 근거·조치·보호 조건 | 6개 후보 분류와 기존6개 규칙 구분; 큰 출력/context/병렬 신규 규칙은 후속; 정상 반례·제안·실험·품질 gate | NOT RUN |
| A26 | 품질 보존형 전후 판정 | 같은 과제·revision·성공 기준·필수 검사 유지, parent+child token 포함, 품질 악화/효과 없음/비교 불가 보존 | NOT RUN |
| A27 | 관계·window·지원 한계 | observation window와 query clipping 분리, identity coverage, tree만으로 critical path 금지. private tool 별칭 구현은 후속 조건부 gate | NOT RUN |

## Evidence Gates and Recording

- P0: METRICS의 지표 × 필요 필드 × 공급자/버전 행렬, 수작업 의미, direct/observed/inferred/unsupported, 표본·coverage·누락 이유를 [EVIDENCE.md](EVIDENCE.md)에 기록했다. 12개 bounded 표본의 필드·관계·누락 대조는 수행했으나 제품 파서 동등성·실버전 지원은 NOT RUN이다. 필요한 로그를 읽을 권한/환경이 없으면 차단 사유를 남기고 지원 승격을 보류한다.
- P2/P3: 해당 공급자·버전의 수작업 표본과 파서 정규화 출력 대조 및 합성 기대값을 통과한 범위만 지원한다. 실제 로그는 로컬에 남기며 raw·prompt·source·output·secret을 저장소/공유 evidence에 넣지 않는다.
- P0 자원 예산: [BENCHMARKS.md](BENCHMARKS.md)의 workload(파일/이벤트/바이트/최대 줄)·M4 기준 장비·Node·cold/warm, full/incremental scan 시간·peak RSS·HTML 크기 한도를 측정 전에 결정했다. 제품 성능 측정은 NOT RUN, Linux 기준 runner와 브라우저 응답 수치 예산은 미확정이다. P7은 조건별 실제값과 예산 대비 pass/fail을 기록하며 측정 후 유리하게 기준을 바꾸지 않는다. 기준 변경 시 이유·revision을 남긴다.
- P5/P7 진단 품질: 규칙별 positive/normal-negative fixture와 로컬 검토 표본 수, true/false positive·판정 불가, 적용 가능한 제안/불가 사유, rule version·임계값을 기록한다. 제안은 근거 이벤트, 구체적 다음 행동, 확인할 지표, 한계가 있어야 한다. 초기 precision 목표는 미확정이며 실제 근거로 보정한다. 불확실한 사례를 정답으로 취급하지 않는다.
- 품질 통과 gate: 모든 규칙의 합성 양성/정상 음성 기대 판정과 included/excluded IDs가 맞고, 파일럿 검토자가 근거를 이해해 구체적 다음 행동과 확인 지표를 선택할 수 있어야 한다. 정상 조사·필요한 반복 검증·정상 고비중 도구를 낭비로 단정하면 실패다. 알려진 재현 가능 오탐은 수정하거나 해당 조건에서 규칙을 억제하고 재검증한다. 실표본이 없는 규칙은 파일럿 미검증으로 표시하며 검증된 유용성을 주장하지 않는다. 규칙별 평가 표본 선택·판정 절차와 출시 pass/fail 기준, 잔여 오탐의 허용/보류 판단 방법·담당 검토자는 P0에서 사전 확정하고 P7에 결정과 이유를 기록한다. 이 gate를 충족하지 못한 규칙은 완료/지원 승격하지 않는다.
- 실행 evidence 공통: repo revision, parser/normalization/rule version, 환경·명령, 기대값·실제값, 날짜·표본 선택, pass/fail/NOT RUN 및 제한. 문서 검사 통과와 제품 acceptance를 분리한다.

## v0.1 Manual Matched Before/After Pilot

1. 한 진단과 관련 작업을 고르고 변경 전 로컬 report를 보존한다. 프로젝트 별칭, 작업 종류·크기, 공급자/모델·버전, 설정, 기간·타임존·필터, rule version, 표본·분모·coverage를 기록한다.
2. 실행 가능한 개선 하나와 예상 확인 지표를 사전에 정한다. 자동 설정 변경은 하지 않는다. 같은 작업 조건의 변경 후 표본을 모아 같은 버전/필터의 report를 만든다.
3. 시간 의미별 값, 실패·재시도 수와 표본당 값, 진단 근거·coverage를 수동 대조한다. 원시 합계 차이를 작업량 차이와 혼동하지 않는다. task mix·모델·도구·데이터 지원 변화와 매칭 실패를 명시한다.
4. 개선 방향 관측/효과 없음/비교 불가로 결과와 다음 확인을 기록한다. 작은 표본·선택 편향과 교란 요인을 남기고 절감 보장이나 인과 효과를 주장하지 않는다. 자동 매칭·변경 추적·비교 UI는 v0.2다.

현재 파일럿은 **NOT RUN**이다. 이 절차는 실제 비교 결과가 아니다.

## Quality-Preserving Improvement Pilot

위 수동 파일럿의 실행 양식이다. 제품 구현·사람 검토·개선 효과는 아직 **NOT RUN**이며 아래 숫자/성공을 실측한 것으로 읽지 않는다. PR #9의 기반 테스트나 합성 계약 검사도 이 gate를 대체하지 않는다.

1. **비교 단위 고정:** 프로젝트 별칭, task ID/과제 설명의 안전한 분류, 입력 fixture/revision·작업량, provider/model/version·도구/환경, 설정과 parser/rule 버전, query period·timezone·warm/cold cache 조건을 기록한다. 명시적 작업 경계가 없으면 task elapsed는 미지원이고 대신 비교하는 시간의 정확한 이름을 쓴다.
2. **품질 기준 먼저 고정:** 기대 산출물·정답 rubric, 필수 단위/통합/회귀 테스트·빌드·정적 검사와 검토 요구를 바꾸기 전에 정한다. 정상 독립 검토/보안 gate를 생략하지 않는다. 테스트 통과만으로 정확성·완전성을 전부 증명했다고 하지 않는다. 가능한 경우 같은 rubric으로 결과를 비교하고 평가자/자동 검사와 한계를 남긴다.
3. **한 가지 변경:** output 범위, 검색 지도, targeted-first 순서, setup 확인, 요약 등 카드와 연결된 변경 하나만 정한다. baseline과 treatment의 다른 조건은 유지한다. 요약·재조회·parent/child·재시도 사용량까지 같은 accounting 범위에 포함한다. 변경 자체의 준비 비용은 따로 기록한다.
4. **반복과 순서:** 반복 가능한 동일 과제를 양쪽에서 실행하고 stochastic 변동·cache warm-up·실행 순서 영향을 기록한다. 가능하면 순서를 교차/무작위화한다. 실험 전에 반복 수와 허용 품질 조건을 정하고 좋은 결과만 선택하지 않는다. 작은 표본이면 불확실성을 남기며 임의의 유의성·확정 개선률을 붙이지 않는다.
5. **비교 값:** 완료/미완료/실패 수, 품질 gate 결과, 고유 최종 input/output/cache와 전체 관측 token, 정의된 task elapsed 또는 대체 시간, 호출/실패/재시도, coverage·unknown 수를 함께 비교한다. `(after-before)/before`는 같은 분모·단위이고 before>0일 때만 변화율로 표시한다. 작업 수가 다르면 합계 차이를 성능 개선으로 부르지 않는다.
6. **판정:** 품질 gate를 만족한 관측 개선 / 효과 없음 / 품질 악화 / 비교 불가로 남긴다. token↓·time↑처럼 trade-off가 있으면 둘 다 보인다. coverage가 바뀌거나 task mix·모델이 달라지면 단순 전후 절감을 주장하지 않는다. 작은 matched 관측은 인과 효과나 모든 작업의 절감 보장이 아니다.

기록 필드: `experiment ID`, `candidate/rule version`, 안전한 task/조건 별칭, `baseline/treatment revision`, 변경 하나, 사전 품질 기준, 실행별 outcome·tokens·시간 scope·coverage, 제외/실패/미완료 수, 관측 변화·교란 요인, 판정과 다음 확인. 실제 로그·prompt·원문 출력·개인 경로는 기록하지 않는다.

**Verify:** synthetic 결과로 (a) token/time 감소+품질 동일, (b) token 감소+필수 테스트 실패, (c) 시간 감소+coverage 하락, (d) 실패 실행 누락, (e) 변경 효과 없음, (f) parent/child 중복/누락을 입력한다. (b)는 개선 실패, (c)·(d)는 비교 보류, (e)는 유효한 효과 없음으로 남고, (f)는 accounting을 고치기 전 판정을 보류해야 한다.

## Planning Evidence

두 source 문서를 읽고 최근 로컬 로그의 필드 구조를 조사했다. 이는 구현 acceptance 통과가 아니다. 현재 확인한 사실과 한계는 [FINDINGS.md](FINDINGS.md)에 있다.

2026-09-30 초기 bootstrap 검토에서는 Downloads 원문 2개·참고 PNG 3개의 SHA-256 동일성, 로컬 문서 링크 49개, 당시 TODO 18개 항목의 Verify와 staged diff whitespace를 확인했다. 계획 서브세션·부모 검토를 마쳤고 `00000ed89054180014db5a89ede7d4fa8bda3fc2`의 로컬 HEAD와 private GitHub main이 같았다. 이 기록은 초기 문서 게시 근거이며 현재 구현 상태는 Project draft와 아래 실행 evidence로 확인한다.

## P0 Contract Review — 2026-09-30

기준은 개정 계획 `36bb389`다. [EVIDENCE.md](EVIDENCE.md)의 7개 header 버전 층 × 10개 지표, [QUALITY.md](QUALITY.md)의 6개 규칙 gate, [BENCHMARKS.md](BENCHMARKS.md)의 사전 예산, [FIXTURES.md](FIXTURES.md)·[NORMALIZATION.md](NORMALIZATION.md)의 입력·개인정보 계약을 부모 Codex가 검토했다.

독립 합성 JSONL 7개·55개 레코드와 19개 metric 사례·9개 waste 사례·6개 규칙의 양성/정상 음성에 대해 JSON 문법·ID 참조·archive byte 동일성과 손계산 기대값을 대조했다. duration/interval scope 분리, 첫 실패 포함·최초 lookup 제외, overlap, period clipping, pending·unknown·최종 usage snapshot을 보존한다. 이는 계약·oracle 검토이며 A01–A22 제품 계산·파서·리포트 통과를 의미하지 않는다.

## P1 Foundation Verification — 2026-09-30

개정 계획 `36bb389` 기반 `codex/initial-foundation`의 코드 revision `4f030c69a6a046d9c13e0028adb8f346722f5856`을 부모가 검토했다. package `0.1.0-dev.0`, normalization/key version 1, DB schema version 1을 사용했다. [draft PR #9](https://github.com/WhiteKiwi/agentprof/pull/9)와 [Linux CI run](https://github.com/WhiteKiwi/agentprof/actions/runs/36712410194)에 게시·실행 evidence가 있다. 아래 PASS는 기반 helper·help/version 범위이며 A01–A22의 전체 제품 acceptance를 대신하지 않는다.

| 환경 | 실행 | 실제 결과 |
| --- | --- | --- |
| macOS arm64, Node 24.15.0 | clean install + `npm run check` | PASS: 타입 검사·빌드, 5개 파일·60개 테스트, 14파일 tarball 설치 |
| macOS arm64, Node 24.21.0 | 같은 실행 | PASS: 동일 검사·60개 테스트·tarball 설치 |
| macOS arm64, Node 26.7.0 | 같은 실행 | PASS: 동일 검사·60개 테스트·tarball 설치 |
| macOS arm64, Node 22.16.0 | built entry `--json --version` | PASS: CLI·SQLite import 전 `UNSUPPORTED_RUNTIME`, stderr JSON, stdout 없음, exit 2 |
| Linux x64, Node 24.15.0·24.21.0·26.7.0 | Ubuntu 24.04 CI matrix의 동일 clean install + check | PASS: 각 60개 테스트와 14파일 tarball 설치. CI 3개 job 모두 success |
| Linux x64, Node 22.16.0 | bootstrap만 복사한 CI guard | PASS: compiled CLI가 없는 상태에서 import 전 거부·stdout 없음·exit 2·JSON code 확인 |

부모가 각 지원 macOS 런타임에서 `npm ci --ignore-scripts --no-audit --no-fund` 후 check를 수행했다. `verify:artifact`는 npm cache·prefix를 새 임시 경로로 격리해 local tarball의 npm exec·global install help/version을 실행하고 삭제했다. install scripts는 비활성화했다. artifact는 compiled JS·package metadata·README만 포함하며 fixture·TS source·source map·참고 PNG·DB와 sentinel을 제외했다. 실제 공개 npm 이름과 게시 후 npx는 NOT RUN이다.

행동 검증은 원문 없는 allowlist·진단, HMAC domain/key 분리, 0700/0600 권한, 동시 key 생성, 명령의 quote/옵션/대상 구분, `rg` exit 1과 보수적 git diff 의미, duration/interval scope·1ms 정밀도·동등 근거 충돌, execution stream/parent 경계를 포함했다. reader에서 입력 hash 보존, BOM/CRLF byteOffset, 정확히 1 MiB/초과, 부분 UTF-8·JSON, opening size 고정, append/truncate와 symlink·discovery limit을 확인했다. SQLite import·prepared binding·migration·commit/rollback·caller transaction 보존·async callback 실행 전 거부·손상 DB/미래 schema·close/reopen을 확인했다.

CLI는 help/version만 구현했다. `scan`, `stats`, `insights`, `report`, `open`은 원문 없는 `NOT_IMPLEMENTED`·exit 2이며 파일을 생성하지 않는다. 실제 provider parsing·10 지표·6 진단·원자적 이벤트/checkpoint 저장·offline HTML·성능·사람 파일럿은 NOT RUN이다. 합성 테스트 실행 시간은 제품 성능 측정값이 아니다.

## Main Integration and Tracking Verification — 2026-09-30

[PR #9](https://github.com/WhiteKiwi/agentprof/pull/9)의 통합 작업 트리에서 main `c33f137`의 디자인 소스·brand 자산·canonical 디자인 문서 16개가 byte 단위로 동일함을 확인했다. macOS arm64 Node 26.7.0에서 `npm run check`를 다시 수행해 60개 테스트·14파일 artifact의 격리 npm exec/global install을 통과했다. `node design/build.mjs`, `node design/tests/static.mjs`, `node design/tests/contrast.mjs`도 통과했다. 디자인 브라우저 gate는 계속 NOT RUN이다.

충돌 marker 없음, 로컬 문서 링크 124개와 whitespace를 확인했다. Project의 private·저장소 연결·9개 이슈 항목을 확인하고 기존 #1–#8 체크리스트·Verify가 그대로 보존되었음을 본문 readback으로 대조했다. 별도 디자인 QA는 #10으로 이관했으며 TODO의 병행 진행 체크리스트를 제거했다.

마지막 원격 확인에서 main `514ee77`의 도롱뇽 README hero 변경을 추가 통합했다. 디자인·brand 소스 18개가 최신 main과 byte 동일하며 새 README로 `npm run verify:artifact`를 다시 통과했다. 시스템 소스는 변경되지 않았고 이미지·README의 브라우저 검증은 #10에서 계속 추적한다.

사용자 요청으로 문서 [PR #11](https://github.com/WhiteKiwi/agentprof/pull/11)의 8개 파일을 검토하고 main `90998a5`에 병합했다. PR head `1c9b402`의 로컬 링크 83개·section anchor 21개, README 한글 0개·마스코트 header 보존을 확인했으며 해당 head의 CI check는 0개였다. 기반 브랜치에서는 P0/P1 실행 기록·자원 예산과 Project 운영 규칙을 보존하며 충돌을 해결했다. src·bin·scripts·tests·package·workflow는 이전 기반과 동일하고 디자인·brand는 main과 동일하다. macOS arm64 Node 26.7.0의 build와 14파일 tarball의 격리 npm exec/global install help/version을 통과했다. 최종 usage·집계·개선 카드·A23–A27 계약은 적용하되 제품·파일럿 통과로 표시하지 않는다.

최종 foundation head `3d94be91b5573ee65001fbd828307f21e162d5a6`의 [Linux CI](https://github.com/WhiteKiwi/agentprof/actions/runs/36727381093)는 Ubuntu 24.04의 Node 24.15.0·24.21.0·26.7.0에서 각각 60개 테스트·14파일 artifact와 Node 22.16.0 거부 guard를 통과했다. 사용자 요청으로 PR #9를 main `c3856249bdc0a9c19b856ca32c97d3484e189176`에 병합하고 P1 이슈 #2를 closed/Project Done으로 정리했다. P0 #1도 Done이며, P2 #3은 별도 main 기준 PR과 검증 근거로 추적한다.

## P2 Codex Adapter Verification — 2026-10-01 KST

P1 통합 main `c3856249bdc0a9c19b856ca32c97d3484e189176`에 기반한 P2 구현이다. 검증한 코드 revision은 `fb6e3ad86d886487f12196211c4c8b4a5a94d733`이며 parser/normalization/key version 1, package `0.1.0-dev.0`, DB schema 1을 사용했다. 구현 계약은 [CODEX-PARSER.md](CODEX-PARSER.md), 독립 실표본 대조와 tag별 의미·한계는 [CODEX-EVIDENCE.md](CODEX-EVIDENCE.md)에 있다. [PR #12](https://github.com/WhiteKiwi/agentprof/pull/12)와 [P2 Project 티켓](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833002)에 게시·최종 head 검증을 연결한다. 아래 CI는 이 코드 revision의 [Linux run](https://github.com/WhiteKiwi/agentprof/actions/runs/36738136770)이다.

| 환경·대상 | 실행 | 실제 결과 |
| --- | --- | --- |
| macOS arm64, Node 24.15.0 | `npm run check` | PASS: 타입 검사·빌드, 8개 파일·116개 테스트, 20파일 production tarball 설치 |
| macOS arm64, Node 24.21.0 | 동일 실행 | PASS: 116개 테스트·20파일 tarball 설치 |
| macOS arm64, Node 26.7.0 | 동일 실행 | PASS: 116개 테스트·20파일 tarball 설치 |
| Ubuntu 24.04 x64, Node 24.15.0·24.21.0·26.7.0 | `npm ci --ignore-scripts --no-audit --no-fund` + `npm run check` | PASS: 각 8개 파일·116개 테스트·20파일 tarball npm exec/global install; CI 3개 job success |
| Ubuntu 24.04 x64, Node 22.16.0 | bootstrap만 복사한 CI guard | PASS: CLI/SQLite import 전 거부, stderr JSON `UNSUPPORTED_RUNTIME`, stdout 없음·exit 2 |
| 고정 P0 Codex prefix S4–S12, Node 26.7.0 | 독립 기준과 통합·9개 개별·메모리 내 archive 재표현 대조 | PASS: reader eligible 3,104개에서 실행 362개·턴 84개·usage 1,611개 및 원천 observedUsage 1,611개 불일치 0 |
| 동일 source replay·archive canonical 의미 | 별도 source 관측과 canonical 출력 대조 | PASS: 같은 source의 state/counter 불변, archive의 ID·수치·선택 의미 불변. archive는 명시 확장 상태 한도로 실행 |
| 원문 없는 반환·retained state | 16자 이상 민감 문자열 후보 6,141개 대조 | PASS: 선정 후보의 완전 문자열 노출 0. 짧은 문자열 전체·VM heap·zeroization 검증은 아님 |

각 runtime의 `verify:artifact`는 격리 npm cache/prefix에서 local tarball의 npm exec·global install help/version을 실행했다. install scripts는 비활성화했고 실제 공개 npm/npx는 NOT RUN이다. compiled JS·package metadata·README 20파일만 포함하며 fixtures·TS source·source maps·brand 이미지·DB·sentinel은 제외했다. 기존 P1 60개 검사와 P2 56개 검사를 함께 실행했다.

P2 행동 검증은 구조화 우선·inert shell argv·wrapper 분리, 같은 ID pending 갱신·결과 역순·terminal poll, 안전한 상태·진단과 aggregate wrapper links 한도, archive/fork의 명시 관계와 ambiguity, source/record endpoint 분리, required/optional usage component, trusted partial 6→8→final 10·더 이른 partial replay·충돌, cache containment와 snapshot 분리를 포함한다. 실제 표본의 unsupported call→result 57쌍에는 false `REORDERED_RECORD` 0개였고 last snapshot의 정상 감소는 `USAGE_RESET`으로 만들지 않았다. native response 301개 중 origin/source-terminal 근거가 확인된 31개만 eligible이며 270개는 provisional이다.

이 결과는 bounded adapter의 명시 shape·field 대조다. 실제 legacy polling, 변경된 동일 response ID의 partial→final, 양수 cache-write, fork copied-boundary의 실제 의미는 NOT RUN이고 합성 시험과 구분한다. 실제 reader·CLI·DB 이벤트 transaction·지표·HTML을 연결한 A01–A27, 성능과 사람 파일럿은 계속 NOT RUN이다.

## Project-Only Tracking Migration — 2026-10-01 KST

사용자 요청으로 기존 이슈 10개의 제목·본문·체크리스트·Verify·담당 claim·PR/evidence 링크와 milestone/label/assignee 정보를 Project draft에 이관했다. 각 새 draft의 원래 본문 포함과 상태를 readback한 뒤 기존 이슈에 새 티켓 링크·이력 전용 안내를 남기고 닫았다. 미완료 이슈의 이관 종료는 구현 완료를 뜻하지 않으며 Todo/In Progress는 새 draft에 보존한다. 기존 issue Project item만 제거했고 원래 이슈·댓글 이력은 삭제하지 않았다.

최종 CLI readback은 10개 item 모두 DraftIssue, 이관 본문 10개 보존, 빠진 item·기존 issue item·open repository issue 0개였다. P0/P1/P2는 검증·병합 근거에 따라 Done, 다른 세션의 P5 preview claim·reserved paths는 In Progress로 보존했다. 새 Owner/Owner session 텍스트 필드를 추가했고 확인되지 않은 다른 세션의 runtime ID는 추측하지 않았다. 추적 규칙 갱신은 Workflow draft에서 별도 단계로 진행하며 완료 후에만 Done으로 바꾼다.

GitHub GraphQL의 draft 생성·본문 편집·상태 갱신은 [공식 Projects schema](https://docs.github.com/en/graphql/reference/projects)를 확인했다. [TODO.md](TODO.md)에 실제 Project item ID 기반 티켓 링크와 조작 규칙, [AGENTS.md](../AGENTS.md)에 repository issue 생성·draft 변환 금지와 한 세션/한 티켓 원칙을 반영한다. 이 검증은 작업 관리 이관이며 제품 A01–A27 통과가 아니다.

## P3 Claude Adapter Verification — 2026-10-01 KST

코드 commit은 `faeb057a3f937f09c5566a63048f0c9caac396c6`이며 P2/추적 규칙 main `baa384f779d5eab6d31a6c7099372f19a1d98496`에 기반한다. parser/normalization/key version 1, package `0.1.0-dev.0`, DB schema 1을 유지했다. 부모의 doc-first 검토 후 별도 개발 담당이 구현하고 독립 연구 담당이 frozen build를 대조했다. 구현 계약은 [CLAUDE-PARSER](CLAUDE-PARSER.md), 분모·공식 source·실제 필드·대조와 한계는 [CLAUDE-EVIDENCE](CLAUDE-EVIDENCE.md)에 있다. [PR #18](https://github.com/WhiteKiwi/agentprof/pull/18)·[P3 Project 티켓](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833029)에서 최종 head·병합 결과를 추적한다.

| 환경·대상 | 실제 실행·결과 |
| --- | --- |
| macOS arm64, Node 24.15.0·24.21.0·26.7.0 | PASS: 각 `npm run check`, 타입/빌드·11파일 204개 테스트·25파일 production tarball allowlist·격리 npm exec/global install help/version |
| macOS arm64, Node 22.16.0 | PASS: help/version 모두 CLI·SQLite import 전 `UNSUPPORTED_RUNTIME`, stderr safe JSON·stdout 없음·exit 2 |
| Ubuntu 24.04 x64, Node 24.15.0·24.21.0·26.7.0 | PASS: clean scripts-disabled install·각 타입/빌드·11파일 204개 테스트·25파일 artifact npm exec/global install; 지원 runtime 3개 job success |
| Ubuntu 24.04 x64, Node 22.16.0 | PASS: bootstrap만 복사한 guard에서 CLI·SQLite import 전 거부·UNSUPPORTED_RUNTIME·stdout 없음·exit 2 |
| 고정 P0 S1–S3 prefix | PASS: reader eligible 1,179개 / 3,240,661bytes; 개별 3개·합본의 독립 keyed execution/turn/usage/message/metadata/source observation mismatch 0 |
| Canonical 관측 | 실행 280개(completed180/failed12/unknown82/pending6), paired invocation interval·duration 274개, duration-only turn 8개, usage251개/source usage626개/eligible0개 |
| Same-source replay·RAM archive 재표현 | PASS: replay의 snapshot·retained state·counter 불변. archive canonical 의미 불변, source observations3,552→7,104·metadata1,179→2,358. 실제 archive 파일의 지원 검증은 아님 |
| 기본 상태 상한·privacy | PASS: 각 표본·합본·재표현 모두 기본 상한 내, STATE_LIMIT·dropped diagnostics0, usageProofReplays0. 16 UTF-16 code units 이상 민감 후보3,075개/archive3,078개의 exact leaf string/key 노출0 |

macOS runtime check는 2026-10-01 10:47:44–10:47:54 KST에 npm 11.19.0을 사용했다. 앞선 환경 preflight에서 임시 Node 24.15/24.21 배포의 npm symlink가 `MODULE_NOT_FOUND('../lib/cli.js')`로 실패했으므로 제품 check를 시작하지 않았다. 원래 두 symlink를 private 임시 경로에 보존하고 이미 검증한 global npm CLI를 가리키도록 임시 링크만 고쳤다. global npm·Node 4개 바이너리와 제품 코드는 변경하지 않았고 실제 npm 진입의 Node version·바이너리 checksum을 전후 대조했다. 환경 복구를 제품 코드 수정이나 최초 preflight 통과로 기록하지 않는다. Linux CI는 별도 setup-node runtime과 npm을 사용한다.

PR의 검증 head `148ffb9204a46d61054c8431166691c55d29fdbf`는 원격 main `00539409595fe17349cf68dd41c0f83cc0383e23`의 다른 세션 합성 report preview를 충돌 없이 포함한다. 이 head의 [Linux PR CI](https://github.com/WhiteKiwi/agentprof/actions/runs/36805094842)는 2026-10-01 11:17 KST에 4개 job 모두 success였다. setup-node 로그의 실제 npm은 Node24.15=11.12.1, Node24.21/26.7=11.19.0, Node22.16 guard=10.9.2다. 부모는 job 로그의 204 tests/11 files·artifactFiles25·help/version·scripts disabled와 guard를 대조했다. 원격 main 기준 PR diff는 P3 코드/fixture/문서 22파일이며 report/design/README/package/workflow 변경은 없다. 로컬 문서26개·링크206개·anchor23개와 whitespace를 통과했다. 이후 evidence 문서만 보완하며 최종 head check·merge/readback은 Project와 PR에 연결한다.

기존 116개 검사에 Claude 88개를 더했다. P0 fixture/oracle와 기존 Codex, CLI/scanner/DB/package/workflow, README/design/brand의 보존 대상 29파일 checksum이 같았다. 25파일 tarball은 compiled JS·metadata·README만 포함하며 fixture·TS source/map·DB·brand 이미지·실제 데이터·sentinel을 제외한다. 설치 scripts는 비활성화했다. source/dist 22개 모듈과 독립 harness의 최종 연구 freeze도 유지했다.

합성 검증은 다중 content/UUID와 message usage, root/sidechain·결과 선행·pending·launch metadata 대상 불명·is_error 충돌·상한·원문 폐기를 포함한다. call input/최초 nullable project context·source-point declaration/ownership replay와 별도 bounded usage proof history를 검증했다. direct tool timing·완전한 output·copied boundary·finality는 해당 합성 대상의 외부 trusted context에서만 검증한다. 실제 turn scope·usage 종결·direct tool runtime, 미관측 버전/실제 fork·P4 durable 복구·제품 A01–A27·성능·사람 파일럿은 **NOT RUN**이다. privacy 결과는 선정된 완전 문자열 대조이며 짧은 문자열 전체·VM heap·zeroization 보장이 아니다.

## Early Public npm Alpha Verification — 2026-10-01 KST

사용자 요청으로 [agentprof npm package](https://www.npmjs.com/package/agentprof)를 `0.1.0-dev.0`·`alpha`로 공개했다. 이 첫 artifact의 고정 source는 main `baa384f779d5eab6d31a6c7099372f19a1d98496`이며 Claude P3를 포함하지 않는다. 빈 이름 예약 대신 이미 검증한 Codex parser·JSONL reader·privacy API와 CLI help/version을 제공한다. [NPM-ALPHA](NPM-ALPHA.md)에 실제 metadata·integrity·파일·시각·태그 상태를 기록했다.

정확한 20파일 tarball의 scripts-disabled 격리 설치·API oracle·README 예제·publish dry-run은 macOS Node 24.15.0·26.7.0 / npm 11.19.0에서 PASS다. 게시 요청은 한 번·exit 0이며 registry owner `whitekiwi`·version·source revision·integrity·shasum이 일치한다. public registry에서 새 cache·빈 작업 디렉터리로 SDK·npx 경로 help/version을 다시 실행해 두 Node에서 PASS였다. `scan --json`은 여전히 `NOT_IMPLEMENTED`·exit 2다.

`--tag alpha`로 게시했으나 실제 `alpha`·`latest`가 같은 prerelease를 가리킨다. `latest` 삭제는 HTTP 400으로 실패했고 재시도하지 않았다. 안정 버전 출시로 표현하지 않으며 실행 안내는 `npx agentprof@alpha --help`·`--version`이다. primary package/lock/README/design/CLI source를 변경하지 않고 별도 private archive에서 packaging했다. 인증 값은 evidence·repository·memory에 보관하지 않았다. 공개 Linux registry 설치·정식 라이선스/API·전체 P7 설치/제품 파일럿은 **NOT RUN**이다.


## Completed native search recurrence (2026-10-02)

The [contract](P5-SOURCE-SEARCH-RECURRENCE.md) records frozen ordinary adapter/store/reopen oracles and planned analyzer/formatter/CLI bounds, privacy and no-write acceptance. Independent upstream pre-production oracle: 7/7. Corrected v4 CLI baseline controls: 14 passed, 6 expected missing-feature failures, 12 skipped; these are not feature acceptance. Implementation tests, full/typecheck/build/script-disabled packed-installed qualification and independent final source review are pending, not passed. Optional historical parity needs the actual historical baseline; current PR36 command parity is mandatory.

Focused-stage update: ordinary upstream oracle 7/7; analyzer plus oracle 39/39; formatter/read-only integration 12/12; source typecheck and direct build passed. Independent analyzer review cleared its exact frozen bytes. Actual CLI/current PR36 parity passed 31 tests (one installed-artifact test skipped); aggregate, installed artifact and all-path review are pending; see [the stage evidence](P5-SOURCE-SEARCH-RECURRENCE.md#local-implementation-evidence--focused-stage-2026-10-02).

Final local qualification: independent 17-path review CLEAR; source typecheck/build PASS; full suite 59 files / 1,509 passed / 52 optional skipped; unchanged artifact verifier PASS (54 files). Retained script-disabled install plus exact PR36 parity passed 32/32 with zero skips in a quiet-slot rerun, retaining the earlier 31-pass/one-15-second-timeout failure. No production/test or timeout change was made. Historical optional baselines remain NOT RUN; publication/CI/merge remain unclaimed. See [final evidence](P5-SOURCE-SEARCH-RECURRENCE.md#final-local-qualification-2026-10-02).

Fresh-main integration amendment: PR36 was externally amended and merged before publication. Apply only the reviewed 17-path feature delta to main `ffd87e1dc1bcbc21d925d7466ae19b944c1a8735` (tree `8549d3dd18de9292917fe5928ba2bd9cd12b3b14`), preserving all six external test/document changes and 66 new controls. Original qualification remains historical; rebase review and verification are pending. See [the amendment](P5-SOURCE-SEARCH-RECURRENCE.md#fresh-main-integration-amendment-2026-10-02).

Fresh-main qualification completed: independent rebase review CLEAR; typecheck/build PASS; full60 files /1,575 passed /52 optional skipped, including all66 external controls; unchanged54-file artifact PASS; exact ffd87 baseline plus retained installed recurrence32/32, zero skips, unchanged15-second timeout. All225 reviewed source hashes stayed unchanged during gates. Only evidence docs were appended afterward. Historical-baseline optional suites remain NOT RUN; publication/exact-head CI/merge remain parent-owned and unclaimed. See [fresh-main evidence](P5-SOURCE-SEARCH-RECURRENCE.md#fresh-main-qualification-completed-2026-10-02).

Bounded PR37 main integration: preserve exact main106d6c1329499fdb57e63c7aad3f8aac78987249 ten-path toolchain change and package-lock removal, all84 identical dependency-version/integrity pairs, and unchanged feature production/tests. Incoming main shared-document prefixes are retained in full. Duplicate full local suites were not rerun for toolchain-only drift; local mise/pnpm execution is NOT RUN and new exact-head hosted pnpm qualification remains pending. See [the integration contract](P5-SOURCE-SEARCH-RECURRENCE.md#bounded-main-toolchain-integration-2026-10-02).

Bounded PR43 integration: preserve exact main6f7a538d1806a1973a647fb16ab6c1fecc74bd49 eight-path toolchain/document delta and full shared prefixes, unchanged lockfile/84 dependency pairs and identical feature production/tests. Local duplicate full suites and installation are NOT RUN; new exact-head hosted pnpm10.34.6 qualification remains PENDING. Prior pnpm10.33 results are historical. See [the integration note](P5-SOURCE-SEARCH-RECURRENCE.md#bounded-pnpm-10346-main-integration-2026-10-02).


## Source-prefix token-evidence qualification (2026-10-02)

The focused report suite passes 159 tests, and typecheck/build pass. Full qualification: 64 files, 1,825 passed / 43 skipped. With all installed-binary controls enabled: 64 files, 1,836 passed / 32 skipped; both runs total 1,868 tests. The unchanged artifact verifier passes with 58 packed files; retained script-disabled installation preserves every packed byte and mode. Sixteen baseline/current/installed CLI cases preserve status/stdout/stderr. The positive-usage combined maximum is 748,789 UTF-8 bytes under the unchanged one-MiB limit, and escaped overflow remains REPORT_LIMIT. The synthetic installed report retains the literal 6 stored / 2 selected / 1 duplicate / 3 excluded / N2 row oracle, timeline and native command sections; input removal does not affect regeneration, and key/store bytes and modes remain unchanged. Browser acceptance, publication and broad P6 completion remain separate. See [P6-TOKEN-EVIDENCE](P6-TOKEN-EVIDENCE.md).

These 2026-10-02 results qualify the earlier token candidate only. Current-main composition on 2026-10-03 requires fresh qualification; its results are recorded separately in the token-evidence contract.


## Token-evidence current-main qualification (2026-10-03)

Fresh composition onto main `8e3118155038a04adcf08f97113186af4243bc2d` passes typecheck/build, 199 focused tests, default aggregate (2,088 passed / 57 skipped) and installed aggregate (2,101 passed / 44 skipped), both 2,145 total. Artifact and enabled-prepack/script-disabled retained installation pass with 62 exact byte/mode matches. Eighteen current-main/candidate/installed CLI cases agree. Genuine retained schema5 read-only report rejection preserves the original/copy and creates no HTML. The positive-usage combined ceiling is 750,079 UTF-8 bytes; escaped overflow remains rejected. See [the complete current-main token qualification](P6-TOKEN-EVIDENCE.md#current-main-qualification-2026-10-03) for actual local Node/pnpm versions, synthetic-data boundaries, skipped tests and pending hosted/browser gates.


## Ordinary Codex durable-source continuation (2026-10-02)

Refreshed foundation precode: 79 focused cases = 3 independent oracle passes + 76 expected feature failures (74 absent captures, scanner full replay4 versus suffix2, legacy candidate guard rejection). Exact-foundation build PASS. Crash6 prerequisite RED: four missing captures, two first-generation child exit1; no successful kill/recovery assertion. All235 base files and five frozen tests unchanged. Serial one-worker stages used NODE_OPTIONS=--max-old-space-size=512 and timeout600s with existing dependencies. Implementation-present focused/crash, inherited suites, typecheck, aggregate, artifact and installed parity remain NOT RUN.


### Codex durable continuation: implementation-present evidence (2026-10-02 16:08 UTC)

- Foundation: tree837523490ef2521ddf8db4ba99fc4c9deea1ed40,235 exact files; source and independent oracle lineage retained. Production review CLEAR on all five paths; source-prefix has only the approved provider allowlist condition.
- v3 after implementation/guard:77/79 PASS; the two fixture failures were independently diagnosed and retained. v4 corrected scan seed limits and valid public command pattern, added direct provider controls, and retained all downstream assertions.
- v4 focused81 plus inherited175:256/256 PASS across7 files,13.76s. The inherited mixed test now requires positive authenticated Codex state while preserving all Claude unchanged checks and explicit cold replay2-call assertion.
- v5 supplements: real near-budget checkpoint refusal, SQL payload read positive control and two oversized-byte preflight cases are independently authored/reviewed and pass in the developer run.
- Exact candidate build PASS. v5 focused85 plus Codex crash6 plus inherited Claude crash5:96/96 PASS across5 files,14.74s. Real source/checkpoint staging and requested SIGKILL markers, rollback/committed recovery, full metadata/wrapper projection, and repeated unchanged idempotency assertions execute successfully.
- All five production hashes and the v5/approved inherited-test hashes match before/after execution.53 built dist file hashes retained. Serial tests use one worker,512MiB heap,600s stage timeout and existing pinned dependencies.
- Current Codex parser1 has no older positive version; genuine old-parser replay is NOT APPLICABLE. Historical schema5 source seed/reopen and valid old-limits mismatch replay are tested.
- Full aggregate, artifact/install qualification and hosted CI on the eventual published head remain NOT RUN for this feature. These bounded synthetic checks do not establish full provider13-stream acceptance or performance improvements. Public readiness remains false.


## Final original-foundation qualification (2026-10-02 16:42 UTC)

This later receipt supersedes the pending aggregate state above; earlier failed and partial receipts remain history. The saved/reloaded Project scope expanded to18 paths solely for the independently reviewed tests/scan-run.test.ts and tests/source-relationship-integration.test.ts amendment. Exact patch SHA256 `b567fe441039b0185b74721865df42c0d5a8c35f190f9d91dc64e58c733f8ba9` adapts legacy API hooks to authenticated checkpoint-aware calls, requires actual hook hits, distinguishes whitespace-only suffix from complete-record ingestion, and models legitimate historical state without a checkpoint. Five retained-seal mutation controls separately require hard failure without reparsing or repair. No production changes were made.

Initial full run1,842 PASS/17 FAIL/41 SKIP remains recorded. Reviewed v6 affected suites now74 PASS/13 optional SKIP, and full aggregate1,864 PASS/41 SKIP/0 FAIL across66 files (65 passed/1 skipped),215.66s. All18 pre-run file hashes matched after the gate. Typecheck, exact candidate build and standard artifact verifier PASS. The retained npm artifact has55 files and SHA256 `6d54d13e977d5eed3c685ea0f7d3dcb7c1d7d86cddc52cc55ae0d26cc103cc44`.

Fresh exact235-file foundation tree837523490ef2521ddf8db4ba99fc4c9deea1ed40, candidate and retained installed binary passed147 three-way CLI comparisons/441 subprocesses over10 synthetic fixtures. Retained installed SDK independently proves actual close/reopen, exactly two suffix adapter calls at ordinals2/3, cold-equal full public evidence, then zero adapter calls and unchanged rows on repeat.

These gates used Node24.19.0, pinned pnpm10.33.0, one test worker,512MiB heap,600-second stages and explicit writable npm cache.41 optional cases remain skipped; no raw-log pilot, broad13-stream acceptance, readiness promotion or performance claim is made. Current-main6f toolchain/docs foundation reconciliation and publication are separate coordinator-owned gates and have not been applied to this candidate.


## Current dependency composition and hosted seed gate (2026-10-02 16:56 UTC)

After original-foundation qualification, the coordinator approved a dependency-only refresh using published PR40 head `f00f3083b9eb7901585a69492626c68143fde292` (tree `9a007e2aca599a4af7eb11186f92ee7c40a7043f`) and PR38 head `628d6eaa6ceb5ed5a2d71a860325dd5bb269a347` (tree `8c222ab0752ad8fc7c51d9162cbc031703ff8f64`), both on main `6f7a538d1806a1973a647fb16ab6c1fecc74bd49` and pnpm10.34.6. Their exact235-file foundation is tree `7b8c7f6598a830d5a9b31e4467dfc7d192898dc4`. All source/tests/scripts/lock bytes remain identical to the original qualified foundation; complete dependency document suffixes are preserved. All five feature production and eight test/helper paths remain byte-identical to the qualified18-path candidate.

The saved/reloaded scope is19 paths, adding only `.github/workflows/ci.yml` for independently reviewed historical seed provisioning (patch SHA256 `bf1d28d65eaece783c14ee913dea05a40a93d9cb1aa160400da0d8f5f9544cc1`). The existing pinned checkout action retrieves immutable original PR38 `5614a3107b53022f29ea32d44ba83f533fd58b92`/tree `c1361a2fea2386ced7c30f88da82ce421017dca6` with persist-credentials:false. It verifies those identities, moves the checkout outside current test discovery, installs its unchanged npm lock with scripts disabled, builds under the matrix runtime and asserts schema5 before setting AGENTPROF_PRE_RESUME_DIST. The mandatory legacy test is not skipped or replaced with current schema6. Existing candidate checkout/cwd, runtime matrix, unsupported-Node22 guard and contents:read permissions are unchanged; no new credentials or secrets.

The1,864-pass/41-skip local full receipt and installed/artifact checks qualify the unchanged source/test slice on the original pnpm10.33 foundation. They are not relabeled as fresh hosted pnpm10.34.6 results. The coordinator must verify new hosted full/artifact and historical-seed execution on the published feature head. No duplicate local full run is claimed for the toolchain/document-only refresh. Planned publication uses a dependency merge commit with the exact PR40/PR38 parents and then a feature commit; the draft PR is stacked on feat/claude-source-resume with the PR38 prerequisite explicit. No main merge or readiness/performance promotion is authorized.


## Merged Codex prerequisite correctness refresh (2026-10-02 17:18 UTC)

Publication guard observed PR38 merged at main `39070c8a1214215fea6337677b19cc9fab193a05` (tree `048f8d71c1c06ce1941b36f299db6f049f016ddd`), after its final head `32791e04051e696c8edb6f72c4b15e1783e07a18` added constructor-order validation for token-count objects and nine additive regressions. The earlier19-path candidate is superseded and must not be published. This is a production dependency correction, so prior full-suite receipts do not qualify it without new execution.

A new exact235-file foundation tree `52f296dea7853cab587dda78fd4c494e9169feaa` composes verified merged main with preserved PR40 head `f00f3083b9eb7901585a69492626c68143fde292`. The incoming checkpoint codec and regression bytes are exact merged-main blobs; all earlier144 checkpoint cases and nine additions are retained. Complete current-main Codex document suffixes and PR40 documents are preserved. The existing19-path feature delta remains unchanged in production/tests, and the authentic historical5614a310 schema5 CI seed remains immutable. No Project write or remote publication is part of this preparation.

New codec, durable continuation, real crash, typecheck/build/full and artifact qualification is required. Local execution uses retained pnpm10.33.0, explicitly separate from mandatory new hosted pnpm10.34.6 matrix qualification. No weaker decoder, fixture normalization, skipped mandatory history gate or readiness/performance promotion is introduced.


## Final merged-prerequisite qualification (2026-10-02 17:31 UTC)

The corrected merged Codex prerequisite now has fresh local qualification; this later entry supersedes the pending gate immediately above. Node24.19.0 with retained pinned pnpm10.33.0 ran typecheck/build,153 checkpoint codec tests (144 retained plus9 incoming),85 durable-source cases and11 actual crash cases:249/249 PASS. Standard55-file artifact verification and a newly packed/installed SDK close/reopen witness PASS, with exactly2 appended adapter calls at ordinals2/3, then0 calls and identical rows on unchanged reuse. Initial pnpm automatic10.34.6 provisioning failed before checks in an unavailable default tool directory; that harness receipt is retained separately. The authorized local invocation explicitly sets npm_config_manage_package_manager_versions=false, without editing repository pins.

An independently authored additive store regression (patch SHA256 `311c94fa35cc89a73bba8f9695a359a75b998ef4f89e229755e7bab365dfd582`) establishes a genuine exported positive control, then independently resigns a token-count field-order mutation and its outer generation seal while leaving public rows unchanged. The old codec accepts it (expected RED); the merged codec rejects it at direct DB and scanner boundaries before adapter replay or writes (GREEN), preserving all rows. The approved amendment touches only the already owned codex-source-store test; all earlier tests and production bytes are retained. Developer store suite36/36 PASS.

Final full aggregate:1,874 PASS,41 explicit optional SKIP,0 FAIL,1915 total across66 files (65 passed/1 skipped),200.25s. All241 pre/post source/test/document hashes match; final documentation append is evidence-only. The prior merged1873/41 run and original1842/17/41 failure remain historical receipts rather than being relabeled. One worker,512MiB heap,600-second stage caps and explicit writable npm cache were used.

Publication proposal remains feature branch feat/codex-source-resume based on feat/claude-source-resume. Foundation parents are preserved PR40 `f00f3083b9eb7901585a69492626c68143fde292` and already merged main `39070c8a1214215fea6337677b19cc9fab193a05`; PR38 is now a merged prerequisite, not an unmerged branch assumption. Exact-head hosted pnpm10.34.6 matrix/full/artifact and immutable5614 schema5 provisioning remain required after publication. This local preparation performed no remote or Project writes. No main merge, broad real-log acceptance, public readiness promotion or performance claim is made.


### Merged-main Codex durable qualification — 2026-10-03 UTC

The existing nineteen-path Codex durable delta is now composed directly on merged main `8e3118155038a04adcf08f97113186af4243bc2d`, preserving all upstream source, tests, document history and modes. All five production files, eight test files and the immutable schema5 CI provisioning remain byte-identical to the previously reviewed feature. The intended branch is `feat/codex-source-resume`, with PR base `main`; a stacked prerequisite merge is no longer needed.

The exact composed source passed typecheck/build, **250 focused tests** including genuine schema5 migration, strict count-order rejection and six Codex/five Claude crash cases, then **2,159 passed / 57 explicit optional or platform skips / 0 failures** across79 test files. The full run took187.10 seconds. The61-file artifact gate passed. A freshly packed, script-disabled installed artifact proved actual reopen, two suffix ingestion calls at ordinals2/3, zero unchanged ingestion calls, exact cold public projection and unchanged reuse rows. A separately built exact-main control, candidate and installed CLI matched147 comparisons/441 subprocess calls across ten synthetic provider fixtures, including help/version and retained store bytes/modes.

Local qualification used Linux x64 Node24.19.0 and retained pnpm10.33.0 with package-manager auto-selection explicitly disabled; the repository pin remains10.34.6. All265 source bytes/modes were unchanged after execution; this evidence append follows that freeze. One interrupted retained-install attempt has no success claim; its partial state was inspected and one authorized exact retry passed. Previous receipts remain historical. Exact-head hosted pnpm10.34.6 matrix/full/artifact qualification, publication and merge remain pending. These synthetic results do not establish real-user coverage, performance savings, broader P4 completion or either public readiness flag.

## Stored-source report/open qualification

The [explicit stored-source workflow](P6-REPORT-OPEN.md) requires unchanged default HTML and receipts, no opener before verified publication, retained warning/error receipts, unchanged private store bytes/modes, safe diagnostics and controlled installed-artifact parity. Dependency-only build and missing-feature unit/CLI controls were observed on Node 24.19.0. Candidate typecheck and build passed on Node 24.19.0. The one-worker focused command recorded in the linked contract passed four files, 99 tests, with one inherited installed-test skip. Subsequent unchanged-candidate qualification passed independent all-path review, 28 controlled real-CLI cases, the separately enabled actual installed-binary oracle, byte/mode parity for 57 installed dist files, and the 59-file artifact gate. The bounded one-worker aggregate passed 66 files/1898 tests, with one file/45 tests skipped; the opt-in installed oracle was qualified separately. Reproducible commands and limits are recorded in the linked contract. Supported-runtime/exact-head hosted gates remain pending; real GUI/macOS/browser execution and broad P6 fresh-input acceptance are not verified.


## Stored-source report/open: current-main requalification

The [2026-10-03 main integration qualification](P6-REPORT-OPEN.md#2026-10-03-current-main-integration-qualification) passed independent composition review, baseline/candidate builds, typecheck, focused 99 tests, full 2090 tests (58 skipped), the 62-file artifact gate, 55 controlled built/actual-installed CLI cases and 36 authentic schema-5 read-only rejection comparisons. Main schema 6, recurrence and diagnostics remained intact; source/store/installed byte-and-mode checks passed. Hosted supported-runtime CI, GUI/macOS/browser execution and broad P6 fresh-input acceptance remain separate gates.

## Fresh single-file report local successor proposal (2026-10-02)

The separately owned fresh-report proposal is [P6-FRESH-INPUT-REPORT](P6-FRESH-INPUT-REPORT.md). It preserves stored-only behavior and requires an exact scan generation, partial-evidence warning receipts and cooperative cancellation. This appended local section does not replace shared PR40 documentation. Implementation verification is pending; publication, supported-runtime and real-browser acceptance remain unclaimed.

### Fresh-report local focused evidence

The explicit-input successor passes typecheck/build and 146 focused tests across eight files; three installed-binary cases await pack qualification. Tests execute exact generation selection, partial warning retention, real separate-connection writer interleavings, cancellation and listener cleanup, privacy/no-bootstrap failures, and controlled-opener CLI behavior. Earlier fixture calibration failures are preserved, not counted as production failures or hidden. See [fresh report evidence](P6-FRESH-INPUT-REPORT.md#local-implementation-freeze-evidence). Aggregate, installation/artifact, runtime matrix and browser acceptance remain unclaimed at this source freeze.

## Post-freeze local qualification (2026-10-02)

The immutable fresh-input source tree `681eda2be6652a971734d3ec8958154b265e3f3d` received independent source review CLEAR: all 251 paths verified, exactly 16 owned changes, 235 other inherited paths unchanged. Source remained byte/mode identical throughout qualification.

- Node 24.19.0, Linux x64; one worker, 512 MiB heap, 600-second stage ceiling; explicit writable package cache
- Typecheck/build PASS; focused 146 PASS, 3 installed-only skips at source freeze
- Aggregate: 2006 PASS, 48 skip; 72 files PASS, 1 skip; 190.41 seconds
- Script-disabled packed installation: 6 built/installed fresh CLI tests PASS, including selection/no-bootstrap/privacy, completed Codex, partial Claude and controlled opener outcomes
- 58 installed dist files match build bytes/modes; installed executable directly reports version 0.1.0-dev.0
- Inherited stored-only dependency/candidate/installed CLI oracle: 55 cases PASS, unchanged private-store bytes/modes
- Actual CLI SIGINT oracle: 6 built/installed cases PASS; exit 130 preserves published HTML and actual accepted/failed/timeout results after the owned opener begins; no retries
- Artifact: 60 files PASS; publication false

The initial empty-cache offline install failed with ENOTCACHED for commander metadata. The failure receipt was preserved; normal official-registry installation with the explicit writable cache then passed. Historical synthetic test calibration failures were retained as described above. Copied precode-oracle header comments describe their original preimplementation provenance; they are not statements that the APIs remain absent.

No supported-runtime matrix, exact-head hosted CI, real GUI/browser/macOS opener or live-user-input full P6 acceptance is claimed. Stable caller-controlled input paths remain a precondition; preflight/reopen path substitution is not solved. Source publication, PR creation/merge and deployment were not performed. This appendix is a separate local proposed evidence amendment; the reviewed source freeze is unchanged.

### Fresh-report current-main composition qualification pending (2026-10-03)

Earlier fresh-report counts belong to its prior source freeze. The main8e/schema6 successor preserves upstream state and adds the authentic schema5 copied-write migration, unchanged/suffix and corrupt-checkpoint controls described in [P6-FRESH-INPUT-REPORT](P6-FRESH-INPUT-REPORT.md#current-main-composition-and-schema-6-requalification-plan-2026-10-03). No refreshed runtime pass is claimed at composition freeze.

## Current-main local qualification completed (2026-10-03)

The successor composition tree `c9377f739a4f4ba57b91d9c0b65d3b7fa3419671` is based on main `8e3118155038a04adcf08f97113186af4243bc2d` plus the independently reviewed stored-report/open dependency `2d646088600377951a21855031b65656f22a65f6`. Independent composition review verified all 272 file bytes/modes, the exact 16 owned changes, 256 unchanged dependency paths and preservation of upstream shared-document prefixes. The source/archive remained unchanged throughout these runtime checks.

On Linux x64 / Node 24.19.0, one worker, 512 MiB heap and 600-second stage bounds with explicit writable package cache:

- Typecheck and build PASS
- Focused: 149 PASS across nine files; three installed-only cases initially skipped and then explicitly passed in installed qualification
- Aggregate: 2,201 PASS, 60 explicit optional skips; 82 files PASS and one optional file skipped; 167.89 seconds
- Packed/script-disabled installation: six built/installed fresh CLI tests PASS; all 61 installed dist files match built bytes/modes; installed executable directly ran
- Stored-only refreshed dependency/candidate/installed parity: 55 cases PASS, preserving private-store bytes/modes
- Actual built/installed CLI SIGINT: six cases PASS, preserving publication and already-started opener accepted/failed/timeout outcomes with exit 130 and no retries
- Artifact: 63 files PASS; no publication performed by the qualification commands

The genuine schema5/Claude1 oracle was explicitly enabled in focused and aggregate runs. Its retained historical executable is from PR38 head `5614a3107b53022f29ea32d44ba83f533fd58b92`, with all 51 retained dist hashes verified. It is not attributed to the older 063 revision. The control proves schema5 read-only rejection without mutation; fresh write migration of a private copy to schema6/parser2 and revision2; unchanged revision reuse without parser calls or DB changes; two one-record suffix generations with exact offsets/ordinals; and an unchanged historical original. The corruption control proves failed scan before parsing, HTML creation or opening while retaining the post-corruption bytes.

No current-run fixture calibration, source change or failed stage was needed. Prior-freeze calibration failures remain historical evidence and are not erased by this result. Supported-runtime matrix, exact-head hosted CI, macOS native opener, actual GUI/browser rendering and live-user-input full P6 acceptance remain NOT RUN. The documented stable-input-path precondition and preflight/reopen limitation remain unchanged. Local qualification does not establish remote publication, merge or release.

## Repository issue tracking migration — 2026-10-03

This dated tracking receipt follows the owner's instruction, the [SPEC transition](SPEC.md#repository-issue-tracking-transition-2026-10-03), separate [research](FINDINGS.md#2026-10-03-repository-issue-tracking-migration-research) and the reviewed [four-step plan](IMPLEMENTATION.md#repository-issue-tracking-migration-plan-2026-10-03). Baseline main is `ecd7e4432e6c71423763f4e48a13f48bdca5d540`. [Workflow #49](https://github.com/WhiteKiwi/agentprof/issues/49) owns only this migration; current product progress and claims live in the issues below.

The coordinator's stored-content readbacks confirm five reused issue identities and one new exploration issue. The following table is the migration snapshot, not a second live roster.

| Scope | Issue | Migrated status | Preserved milestone | Preserved owner |
| --- | --- | --- | --- | --- |
| P4 | [#5](https://github.com/WhiteKiwi/agentprof/issues/5) | In Progress | `v0.1-alpha` | `dot Claude checkpoint` |
| P5 | [#6](https://github.com/WhiteKiwi/agentprof/issues/6) | Todo | `v0.1-alpha` | Unclaimed |
| P6 | [#7](https://github.com/WhiteKiwi/agentprof/issues/7) | In Progress | `v0.1` | `dot — measured source HTML / P6` |
| P7 | [#8](https://github.com/WhiteKiwi/agentprof/issues/8) | Todo | `v0.1` | Unclaimed |
| Design | [#10](https://github.com/WhiteKiwi/agentprof/issues/10) | Todo | `v0.1` | Unclaimed |
| Exploration | [#50](https://github.com/WhiteKiwi/agentprof/issues/50) | In Progress | None | `dot /root/implement_prof_exploration` |

Each open issue has exactly one matching `status:todo` or `status:in-progress` label. The three existing claims retain coordinator/session `01a0f1a1-4048-72ae-a185-e8a3f98ba008`; migration assigns no successor and revives no released file reservation. Exploration retains `feat/source-exploration`, its original 19-path scope, six ordered gates and broad-P5 dependency. Existing assignees, unrelated labels and milestones were preserved.

All five replaced repository bodies were archived before replacement. Complete original Project text remains verbatim in the issue history; P4's four contiguous stored comments reconstruct all **100,871 UTF-8 bytes**, SHA-256 `21b983b138af966ff2d4da54eb7e1063988556dd5fc6623b460bb1cd2e3cf0e2`. Stored bodies and all nine archival comments were read back. Safe code fences keep retired historical checkboxes as text without changing source bytes. Actual GitHub Markdown rendering exposes **20 current boxes: 18 unchecked and Design's two checked**. P4 and P6 each retain their exact two broad acceptance gates. The 31 original unchecked historical boxes include 13 retired P6 entries; those are preserved history, not additional active work or newly completed acceptance.

The complete Project inventory and post-migration readback retain all **32 unarchived draft IDs, bodies and fields**, including 26 Done records, with zero live repository Issue/PullRequest items. Completed P0–P3 and prior Workflow records were not reopened. Earlier `NOT_PLANNED` issue closures record the 2026-10-01 tracker migration, not implementation completion. Project closure and its forward README mapping remain coordinator gates after workflow publication and main CI; no automatic pause of its six enabled workflows is claimed.

Separate developer `/root/issue_migration_development` was actually registered and read back in #49 before GO. Its six-file scope is AGENTS, README, TODO, current IMPLEMENTATION navigation plus one receipt, this ACCEPTANCE EOF, and `.github/ISSUE_TEMPLATE/task.yml`. The form configures five textareas with `required: true` for scope, maintained plans, dependencies, ordered steps/Verify and Work claim; the `status:todo` default label already exists, and there is no automatic Project or assignee assignment. The original reviewed migration plan and prior ACCEPTANCE content remain intact.

Local static verification **PASS**: Ruby 2.6.10/Psych 3.1.0 safely parsed YAML with duplicate-key rejection; supported fields/types, unique IDs, boolean validations, three explicit Verify placeholders and all nine claim fields match the [official issue-form syntax](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms) and [form schema](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema). The eight-path branch has **277 checked local links/anchors**, clean diff whitespace, all **274 unowned main blobs/executable modes** and **276 other post-plan tracked bytes/modes** unchanged. The entire reviewed four-step plan, dated IMPLEMENTATION history, original ACCEPTANCE prefix, SPEC/FINDINGS and mascot markup were preserved. Stored six-issue body hashes/open states/status labels/milestones and all32 original draft objects were also compared against the coordinator's actual readback files. These checks establish static structure and preservation, not hosted form submission or required-field UI enforcement.

Final-source CI, expected-head publication/merge, synchronized-main CI, Project closure and Workflow #49 completion remain **pending coordinator verification** at this receipt. Browser/form submission and product test/build execution were **NOT RUN by this documentation contributor**. This migration changes no product behavior, source/tests/package/lockfile/CI/brand assets, does not finish the six product scopes and publishes no package or service.
