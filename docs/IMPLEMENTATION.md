# AgentProf v0.1 Implementation Plan

## Status and Authority

Draft, 2026-10-01 KST. [SPEC.md](SPEC.md)의 사용자 동작, [ARCHITECTURE.md](ARCHITECTURE.md)의 불변 조건, [METRICS.md](METRICS.md)의 계산 계약을 구현하는 계획이다. `36bb389`의 개정 계획에 따른 P0 계약 검토와 P1 실행 기반 검증을 완료했으며 [PR #9](https://github.com/WhiteKiwi/agentprof/pull/9)는 main `c3856249bdc0a9c19b856ca32c97d3484e189176`에 병합되었다. P2 Codex 계약·bounded 검증은 [CODEX-PARSER.md](CODEX-PARSER.md)·[CODEX-EVIDENCE.md](CODEX-EVIDENCE.md)·[ACCEPTANCE.md](ACCEPTANCE.md)에 있다. P3의 별도 조사·구현·검증 계약은 [CLAUDE-PARSER.md](CLAUDE-PARSER.md)에 둔다. [FINDINGS.md](FINDINGS.md)는 조사 근거이며 사양을 덮어쓰지 않는다. 디자인 기반은 아래 별도 트랙으로 유지하고 데이터 파서·분석기 구현과 구분한다.

새 지표 제안을 반영해 v0.1에 10개 지표와 6개 자동 진단을 포함했다. 이 계획을 검토한 뒤 개발 서브세션이 구현한다. 제품 범위를 바꾸면 SPEC, 구조·불변 조건은 ARCHITECTURE, 계산 의미는 METRICS, 접근·선행 조건은 이 문서를 먼저 갱신한다. 실행 작업·Verify·담당·상태는 [Project](https://github.com/users/WhiteKiwi/projects/2)의 해당 draft ticket에 반영한다. repository issue를 새로 만들지 않는다.

## Selected Approach

**TypeScript CLI + npm 배포 + 단일 오프라인 HTML**을 초기 경로로 삼는다. JSONL·지표·UI 개발을 같은 언어로 연결하고 `npx` 시험 사용과 전역 설치를 함께 제공한다.

설치 편의와 언어 선택은 분리한다. Homebrew도 Node CLI를 설치할 수 있다. Rust는 단일 실행 파일·시작 비용·대규모 처리에서 장점이 있다. 별도 합성 component 조사에서 Node의 반복 key-representation 처리 비용을 확인했으며 [identity 성능 보완](IDENTITY-PERFORMANCE.md)으로 검증한다. 제품 전체 scanner 성능은 아직 측정하지 않았다. 먼저 스트리밍·증분 수집과 정확한 데이터 계약을 만든 뒤 전환 필요를 판단한다.

| 영역 | 초기 선택 | 결정 근거·검증 |
| --- | --- | --- |
| 런타임 | Node.js >=24.15.0, TypeScript | 내장 SQLite로 별도 addon 설치 제거. 최소 patch와 지원 중인 런타임 조합 검증 |
| 저장 | `node:sqlite`, SQL migrations | 단일 사용자 SQLite. API는 Release candidate이며 Stable로 주장하지 않음 |
| CLI | Commander | `scan`, `stats`, `insights`, `report`, `open`, help·version·JSON output |
| 리포트 | React·Vite·SVG | 상세 화면·타임라인과 single HTML bundle |
| 검증 | Vitest·Playwright | 합성 기대값·DB 복구·offline 렌더링 |
| 패키지 관리 | npm + committed lockfile | 배포와 같은 생태계로 유지. 실행은 빌드된 JS이며 TS runtime을 요구하지 않음 |

P1에서 `node:sqlite`의 준비된 statement·transaction·migration·close 동작과 최소 런타임 설치를 검증한다. 필요한 동작이 불안정하면 코드 구현 전에 이 문서를 갱신하고 `better-sqlite3` v13을 검토한다. v13의 N-API·npm 내 prebuilt 개선을 구버전 다운로드 방식과 구분한다.

2026-09-30 첫 개발 묶음은 [FIXTURES.md](FIXTURES.md)의 독립 합성 입력·수작업 기대값과 [NORMALIZATION.md](NORMALIZATION.md)의 개인정보 API 계약을 먼저 검토했다. 이를 기반으로 P1의 공급자 독립 실행·저장 primitive를 구현한다. P0의 실로그 행렬·품질·자원 문서 검증은 함께 마무리하며, 해당 검증 없이 P0 완료나 공급자 지원을 선언하지 않는다. P2/P3와 제품 성능 acceptance는 P0 증거 gate 이후에 진행한다.

## Structure and Boundaries

```text
src/
  cli/         argument validation and human/JSON rendering
  scanner/     read-only discovery, bounded JSONL streaming, checkpoints
  parsers/     codex and claude adapters, pairing and capabilities
  normalize/   allowlist, safe patterns, operation and lookup identities
  db/          migrations and atomic source contributions
  analyzer/    shared metrics, diagnostic rules, overlap accounting
  report/      safe single-file packaging and opener
web/           offline report components and SVG timeline
tests/fixtures/ synthetic provider records and expected metrics
docs/          specification, evidence, plans and acceptance
```

정규화 데이터부터 개인정보 경계를 적용한다. raw 객체를 downstream metadata로 전달하지 않는다. 입력 경로는 로컬 수집 manifest에만 사용하며 공유 리포트에는 자동 노출하지 않는다. CLI와 HTML은 같은 집계 모델을 사용한다.

분석 snapshot과 정적 HTML renderer를 분리해 후속 로컬 대시보드의 확장 지점을 유지한다. 초기 구현에는 서버·watcher·polling을 추가하지 않는다. 도롱뇽 마스코트와 제공 PNG 참고는 [DESIGN.md](DESIGN.md)를 따른다.

## Change Order

| ID | 결과물 | 선행 조건 | 마일스톤 | 초기 추정 |
| --- | --- | --- | --- | --- |
| [P0](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258832949) | 실로그 의미·coverage, 로그·지표 계약, 합성 기대값 | 없음 | v0.1-alpha | 1–2 작업일 |
| [P1](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258832975) | CLI 기반, 타입·개인정보·설치 검증 | P0 | v0.1-alpha | 1–2 작업일 |
| [P2](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833002) | Codex adapter | P0, P1 | v0.1-alpha | 1–2 작업일 |
| [P3](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833029) | Claude adapter | P0, P1 | v0.1-alpha | 1–2 작업일 |
| [P4](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833059) | SQLite·증분 scan | P1, P2, P3 | v0.1-alpha | 1–2 작업일 |
| [P5](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833093) | 최소 세로 단면 → 10 지표·6 진단·stats·insights | P0, P2, P3, P4 | v0.1-alpha | 3–5 작업일 |
| [P6](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833122) | single HTML·타임라인·open | P5 | v0.1 | 2–4 작업일 |
| [P7](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833142) | packed artifact·파일럿·출시 준비 | P6 | v0.1 | 1–2 작업일 |

한 명의 순차 작업 기준 11–21 작업일의 초기 추정이다. 출시일 약속이 아니며 공급자·시간 의미 대조 결과로 다시 산정한다. 각 draft ticket의 구현 단계에 구체적인 Verify를 둔다. 2026-10-01 기존 이슈의 본문·Verify·담당·진행 상태를 Project 전용 draft로 이관했다. 진행 상태는 Project, 설계상 선행 조건은 본 계획, 실제 실행 증거는 ACCEPTANCE를 따른다.

### P0 — Empirical Contracts Before Parsers

Codex 구조화 완료 항목과 response 표현, Claude call/result·메시지 재저장·sidechain을 합성 fixture로 만든다. 현재 조사 버전은 관측 목록이며 제품 지원 목록이 아니다. 시간 의미·ID 우선순위·capability를 버전별로 검증한다.

순차·병렬·wrapper·fork·pending·polling·unknown, unresolved recovery, 대상이 다른 명령, 내용이 바뀐 읽기, 토큰 누적과 cache, 기간 경계의 손계산 기대값을 고정한다. 같은 작업 판정에 표시용 commandPattern을 쓰지 않는다.

P0에서 허용된 로컬 실로그의 소규모 층화 표본을 수작업으로 읽어 [METRICS의 행렬](METRICS.md#metric-evidence-matrix)을 작성한다. 공급자·정확한 버전·관측 기간·선택 기준, 지표별 필요 필드·direct/observed/inferred/unsupported, 표본 수·커버리지·누락 이유를 기록한다. 원문·명령·출력은 커밋하거나 다른 환경으로 옮기지 않는다. 접근이 없으면 NOT RUN과 차단 사유를 남기고 해당 버전의 검증된 지원 주장을 보류한다. P2/P3의 파서 결과 대조와 P7의 출시 파일럿은 이 초기 조사를 대체하지 않는다.

6개 진단마다 양성·정상 음성 사례와 근거/시간 포함 이벤트를 설계한다. 오탐 검토, 제안의 적용 가능성·후속 확인 방법과 파일럿 보정 절차는 [QUALITY.md](QUALITY.md)에 있다. 성능은 [BENCHMARKS.md](BENCHMARKS.md)의 대표 합성 workload·장비·Node·cold/warm 조건과 full/incremental scan 시간·peak RSS·HTML 크기 예산을 측정 전에 고정했다. 제품 성능 측정은 NOT RUN이며 Linux 기준 장비 배정·브라우저 응답 예산은 미확정이다. 예산 결정은 성능 acceptance 실행보다 선행한다.

### P1 — Installation and Privacy Foundations

패키지의 단일 `bin`은 `agentprof`를 가리키고 shebang·실행 권한·빌드된 JS·HTML assets만 배포한다. minimum Node와 지원 플랫폼을 검사하고, 도움말과 명확한 runtime 오류를 제공한다. npx에서 source compile·agent runtime 설치·SQLite addon 다운로드가 필요하지 않게 한다.

로컬 데이터 경로, config·key 권한, source overrides, JSON envelope와 비밀값 없는 진단을 구현한다. 공급자 어댑터에는 원문을 읽을 권한만 주고 정규화 경계 밖으로 전달하지 않는다. P1에서 commandPattern·operationKey·lookup/content/error fingerprint의 필드·null·정규화/키 버전 계약과 비실행 정규화 API를 고정한다.

초기 foundation package는 `0.1.0-dev.0`, `private: true`, `UNLICENSED`로 작업 트리의 직접 공개 배포를 막는다. npm lockfile에 Commander 15.0.0, TypeScript 7.0.2, Vitest 5.0.2, Node 타입 24.19.0을 고정했다. 실행 의존성은 Commander뿐이며 SQLite는 Node 내장 모듈이다. TypeScript·테스트 도구의 platform binary는 개발 의존성으로만 설치하며 packed artifact에는 compiled JS만 넣는다. clean install과 production tarball 설치는 lifecycle scripts를 끄고 검증한다. 정식 출시의 license·배포·설치 artifact·파일럿 검증은 P7에 남기며 초기 npm 공개 예외는 아래에 기록한다.

2026-10-01 사용자의 초기 npm 공개 요청에 따라 이미 검증된 main의 Codex parser/JSONL reader API를 `agentprof@alpha`·`0.1.0-dev.0`로 공개했다. [NPM-ALPHA](NPM-ALPHA.md)에 고정 source archive·정확한 tarball 검토·게시·fresh registry SDK/npx 실행 결과를 기록했다. 원본 package/README의 공개 guard는 유지했다. 빈 이름 예약과 전체 제품 출시를 구분하며 후속 P7 설치·파일럿·라이선스·정식 배포 검증은 계속 필요하다.

역사적인 P1 구현 경계는 [NORMALIZATION.md](NORMALIZATION.md)다. CLI help/version과 원문 없는 오류, inert 정규화, bounded reader, private key·SQLite migration/동기 transaction만 포함한다. `scan`, `stats`, `insights`, `report`, `open`은 exit 2의 `NOT_IMPLEMENTED`로 처리한다. 이벤트/checkpoint 저장은 P4이며 리포트·대시보드 디자인 시스템은 별도 작업이다. CI는 Ubuntu 24.04에서 Node 24.15.0·24.21.0·26.7.0의 동일 check와 Node 22.16.0의 실행 전 거부를 수행한다. 실제 실행 결과는 [ACCEPTANCE.md](ACCEPTANCE.md)에 기록한다.

### P2 / P3 — Provider Adapters

P2 Codex의 실제 shape·API·pairing·privacy·검증 세부는 [CODEX-PARSER.md](CODEX-PARSER.md), P3 Claude의 별도 계약은 [CLAUDE-PARSER.md](CLAUDE-PARSER.md)에 둔다. 해당 Project draft의 작업과 Verify를 먼저 확정한 뒤 개발 서브세션이 구현한다. P1 PR #9 병합 후 P2 PR은 main을 기준으로 검토한다.

Codex는 검증된 구조화 `item_completed`를 우선하고 같은 response를 중복 세지 않는다. namespace·call ID·content-block output과 직접 duration을 처리한다. Claude는 transcript UUID·API message ID·tool ID를 구분해 연결한다. call/result latency는 invocation 관측이며 background acknowledgement는 process 종결이 아니다. 직접 turn duration은 scope·경계 불명을 유지한다. cache read/create를 포함한 all-input과 uncached input을 보존하고, 실제 transcript의 finality가 검증되지 않은 usage는 provisional로 남긴다.

pending 갱신, 취소·background·polling, 복사된 과거와 실제 새 실행, schema drift를 명시적으로 다룬다. 관계·scope가 불명확하면 capability와 coverage를 낮추고 raw 내용 없는 진단을 제공한다. 원문을 폐기하기 전에 commandPattern·operationKey·lookup/content/error fingerprint를 생성한다. 대상·플래그·편집/범위 차이와 비밀값 sentinel fixture를 통과해야 P4로 넘긴다. 각 공급자 단계에서 P0 실로그 표본의 수작업 의미와 정규화 출력을 로컬 대조하고 지원 행렬을 갱신한다. 권한/입력 부재는 NOT RUN으로 남긴다.

P3 구현은 88개 Claude 검사를 기존 116개와 함께 실행한다. 고정 S1–S3 1,179개 레코드의 독립 keyed 대조·동일 source replay·RAM archive 재표현·privacy·기본 상한 결과는 [CLAUDE-EVIDENCE](CLAUDE-EVIDENCE.md)에 있다. 280개 실행·8개 duration-only turn·251개 usage를 보존하며 실제 usage eligible은 0이다. macOS/Linux의 각 3개 지원 Node에서 204개 테스트·25파일 artifact는 PASS다. runtime과 [PR #18](https://github.com/WhiteKiwi/agentprof/pull/18) 검증 결과는 [ACCEPTANCE](ACCEPTANCE.md)에 기록한다. P4 durable checkpoint·scan 연결은 아직 구현하지 않았다.

### P4 — Transactional Incremental Scan

다른 세션이 독립 부분을 맡을 때는 [담당 규칙](TODO.md#담당-세션과-병렬-작업)을 따른다. P3 어댑터와 P4의 저장 primitive는 파일·공유 타입 소유권을 정해 병렬로 진행할 수 있다. 공급자 연동·durable parser-state 복구·증분 재시작은 P2/P3 계약 검증을 기다린다. 이는 P4 전체의 선행 조건을 없애지 않으며, 한 세션이 여러 티켓을 자동으로 잡는 근거가 아니다.

완전한 줄의 byte offset과 경계 digest를 저장한다. 이벤트·pending 갱신·checkpoint를 같은 transaction에 commit한다. append의 잘린 끝줄은 미루고 교체·truncate·parser version 변경 시 소스 기여분을 원자적으로 교체한다.

file move·archive·duplicate discovery에서 논리 ID를 유지한다. 읽을 수 없거나 미지원인 파일을 조용히 건너뛰지 않는다. 대형 줄·전체 파일 buffering을 제한한다. 정규화된 identity·evidence·버전의 DB round-trip을 검증하며 raw 저장을 우회 경로로 사용하지 않는다.

### P5 — Metrics and Actionable Diagnostics

P2/P3에서 생성하고 P4에 저장한 operation·lookup/error identity와 안전한 commandPattern을 소비한다. P5에서 원문이나 대상 정보를 복원하지 않는다. duration scope·evidence·coverage를 바탕으로 METRICS의 10개 지표를 계산한다. 직접 값과 paired·estimated를 섞은 분포를 만들지 않는다. 실패 code·unknown status와 missing timing을 보존한다.

6개 진단은 버전 있는 rule과 검증 가능한 임계값으로 구현한다. coarse heuristic과 고신뢰 구간을 구분한다. Detected Waste는 충분한 evidence를 가진 구간의 합집합이며 회복 경과 시간이나 여러 규칙 내역을 더한 값이 아니다.

빈 입력·partial coverage를 포함해 CLI human·JSON 출력과 HTML 공통 분석 결과를 만든다. supported fixture에서는 실제 계산값이 나와야 하며, 모든 복잡한 지표를 unknown으로 처리해 완료로 간주하지 않는다.

P5 시작 시 시간·실패·재시도만으로 scan → SQLite → stats/insights → 최소 오프라인 HTML을 연결하는 세로 단면을 먼저 만든다. 한 공급자 경로부터 시작해 두 공급자로 확장하고, 같은 snapshot의 CLI/HTML 수치·근거 이동·unknown/coverage 표시를 검증한 뒤 나머지 지표·진단과 P6의 상세 화면으로 확장한다. 최소 HTML도 원문/비밀값 노출·외부 요청 없이 동작해야 한다. 별도 출시 범위나 새 명령을 추가하는 단계가 아니다.

진단별 양성·정상 음성, 오탐 후보와 다음 행동의 유용성을 검토한다. 규칙별 waste 포함표와 첫 발생/반복 발생·canonical overlap fixture를 통과시키고, 실로그 표본의 판정 불가·오탐을 기록하여 임계값을 보정한다. 근거가 부족한 진단은 지원 한계를 드러내며 완료를 위해 숫자를 만들어 넣지 않는다.

### P6 — Offline Evidence Navigation

첫 화면에 Time Breakdown·Detected Waste·Top Insights, 상세에 7개 화면과 timeline을 구현한다. 각 진단에서 근거 이벤트로 이동한다. 표본 수·시간 의미·분모·지원 한계를 표시한다.

`report`는 증분 스캔 → snapshot 집계 → HTML 생성으로 동작하고 `--open`이 있으면 생성된 파일을 연다. 새 설치에서 별도 scan 없이 한 번의 명령으로 생성·열기를 수행할 수 있어야 한다. opener가 없는 headless 환경에서는 HTML을 남기고 경로를 안내한다.

Vite 출력·SVG·분석 데이터를 HTML에 inline하고 dynamic fetch·CDN·remote font를 사용하지 않는다. script 종료 문자열·HTML·control character를 안전하게 처리한다. opener는 argument 배열로 파일 경로를 전달한다.

### P7 — Reproducible Installation and Local Pilot

npm 이름·scope 권한·license를 확정하고 `npm pack` 결과를 isolated cache·prefix에서 실행한다. 공개 npm 이름이 미확정이면 tarball 기반 npm exec를 먼저 검증한다. 공개 후 actual npx 경로도 검증한다.

macOS arm64·Linux에서 clean install → scan → stats → insights → report를 검증한다. 실제 원문은 로컬에서만 시험하고 공유된 evidence에는 정규화 결과와 측정 조건만 기록한다. 실제 시간·메모리·HTML 크기를 측정하고 P0에서 정한 예산과 대조하며 합성 성능 조건과 구분한다. P0/P2/P3의 지원 행렬을 최종 갱신하고 진단별 표본·오탐·판정 불가·제안 적용 가능 여부를 보고한다. [ACCEPTANCE](ACCEPTANCE.md)의 수동 matched before/after 절차로 한 가지 개선 전후를 대조한다. 비교 불가·효과 없음도 결과이며 자동 비교 UI는 v0.2에 둔다.

Homebrew tap·formula 게시, npm 공개와 license 선택은 이 계획의 구현 artifact 준비와 별개인 게시 단계다. 현재 저장소 초기화 요청은 패키지 공개를 의미하지 않는다.

## Efficiency Review Priorities

2026-09-30 검토는 P0–P7을 대체하지 않고 기존 순서의 통과 기준을 구체화한다. 목표는 품질 보존형 토큰·task elapsed 개선이다. 문서만으로 구현 완료를 표시하지 않으며, PR #9의 실행 결과·Project 진행 상태를 이 문서 개정으로 재작성하지 않는다. 다음 구현에서는 해당 PR의 최신 계약과 병합 후 상태를 먼저 대조한다.

| 순서 / 기존 단계 | 결과물·설계 선택 | Verify / 수용 기준 |
| --- | --- | --- |
| 1 / P2·P3·P4 | 수집 freshness·provider/version capability와 canonical identity를 먼저 표시. direct duration·paired interval·lifecycle과 final usage 후보를 별도 보존 | PR #9의 P0 evidence를 시작점으로 실제 adapter 출력을 대조. unknown≠0, missing/pending·same-ID update·replay/fork·scope conflict를 합성 oracle로 재현. 원문/secret 비노출, 재스캔 동일값 |
| 2 / P5 최소 세로 단면 | coverage → 같은 scope의 hotspot(count/sum/p50/p95) → 확인된 실패 → 검증된 retry 한 종류 → 작은 행동 카드. 두 공급자의 최소 CLI/HTML 연결 | 10초 두 호출/5초 overlap이20초/15초. global union/session-minutes30/60분. 상태 불명·identity 불명을 제외 사유와 함께 표시. CLI/HTML이 같은 snapshot·값·근거를 소비 |
| 3 / P5 기존 지표 완성 | 고유 최종 token usage·cache/weighted denominator, validation/recovery/lookup evidence를 추가. token 전체 합보다 응답/턴·실패/lookup 맥락을 탐색 | response6→10을10 한 번, cache 포함/별도 의미 각각 기대값. `1/2 + 9/98 = 10/100`, pooled quantile 일치. resolved만의 recovery 분포와 unresolved 수를 분리. tool별 token 귀속 근거 없으면 미분류 |
| 4 / P5·P6 카드/리포트 | 근거 → 조치 하나 → 실험 → 품질 보호 조건을 모든 insight에 연결. 기간·필터·coverage·사용량·한계를 함께 표시 | 양성/정상 음성·evidence/included/excluded IDs, observation window vs clipping, duration-only·권한/데이터 부족 검증. 느린 정상 작업·필수 테스트·정상 탐색을 확정 낭비로 말하면 실패 |
| 5 / P7 품질 보존 파일럿 | 같은 조건에서 한 가지 변경의 토큰·task elapsed·품질을 수동 비교. 효과 없음/품질 악화/비교 불가도 보존 | [ACCEPTANCE 파일럿](ACCEPTANCE.md#quality-preserving-improvement-pilot)의 작업/버전/분모/품질 gate·반복 실행·교란 조건을 사전 고정. 품질 미검증 상태에서 절감 성공 주장 금지. 인과 효과·일반화 주장은 별도 실험 필요 |
| 후속 / 범위 결정 이후 | 큰 출력·context 성장·병렬 중복, private tool 별칭과 관계 분석 | [BACKLOG gate](BACKLOG.md#efficiency-candidate-gates)를 통과한 뒤 SPEC·정규화·fixture·Verify를 갱신. 새로운 수집·자동 규칙·instrumentation은 이번 문서 PR에서 구현하지 않음 |

첫 두 단계는 대시보드 장식이나 모든 고급 추정에 앞선다. 이후에도 기존 v0.1 10개 지표·6개 진단의 완료 기준은 유지한다. 필수 근거가 부족한 항목은 명시적으로 보류하며 전부 unknown을 반환하는 것으로 지표 구현을 완료하지 않는다. 특정 기간/모델/공급자 순위를 생산성 점수로 만들지 않는다.

### 문서 PR과 병행 구현의 경계

이 측정·개선 개정은 `main 514ee77`에서 분기한 문서 PR #11이었다. main `90998a5`로 병합한 뒤 P0 실측과 P1 실행 기록을 보존하며 기반 브랜치에 통합했다. 이후 PR #9도 main `c3856249`에 병합되었다. 문서 계약 적용과 Project 상태 변경·코드 검증·패키지 공개는 각각의 실행 근거로 판단한다.

## Verification and Handoff

[GitHub Project](https://github.com/users/WhiteKiwi/projects/2)의 draft item마다 구현 체크·담당·Verify가 있다. [TODO.md](TODO.md)는 티켓 링크와 보드 운영 규칙을 안내하며 상태를 복제하지 않는다. [ACCEPTANCE.md](ACCEPTANCE.md)는 실행 전 NOT RUN이고, 실행 후 revision·환경·명령·기대값·실제 결과를 기록한다. fixture·개인정보·DB 복구·지표 일치·offline UI·설치 시험을 변경 범위에 맞게 수행한다.

개발 서브세션에는 SPEC·FINDINGS·ARCHITECTURE·METRICS·IMPLEMENTATION, Project의 해당 draft·Verify·선행 조건을 전달한다. 구현 결정 변경은 해당 문서와 draft부터 반영하고 parent에 변경·검증·한계를 보고한다. parent는 계획·변경·검증 증거를 검토하고 저장소 수준 게시를 맡는다.


## Design Foundation Track (2026-09-30)

이 트랙은 사용자가 요청한 디자인 가이드라인·재사용 컴포넌트·README 초안이다. P0–P7의 의미·검증 순서를 바꾸거나 로컬 대시보드를 앞당기지 않는다.

1. 제공 이미지·design-guidelines skill·Design Index·Recent를 검토하고 [canonical guideline](DESIGN-GUIDELINES.md)과 [간결한 실행 계약](../DESIGN.md)을 작성한다.
2. 별도 구현 세션에서 framework-free `design/`의 semantic CSS tokens·native HTML primitives·최소 vanilla 동작과 합성 오프라인 single-file showcase를 만든다. 재사용 소스를 커밋하고 생성 HTML은 로컬에만 둔다.
3. dark/light·320px/phone/desktop·keyboard·reduced-motion·privacy·contrast·print를 검증하고 [DESIGN-QA](DESIGN-QA.md)에 실제 결과와 제한을 기록한다. README는 배포/측정된 제품인 것처럼 표시하지 않는다. 남은 브라우저·README 검증은 [Design 티켓](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833178)에서 추적한다.

제품 적용은 P5 최소 report부터 시작한다. 실제 snapshot 연결·파서·injection 방어의 제품 acceptance는 그대로 미실행이다. 전역 framework/package 구성을 만들거나 watcher·server·배포를 추가하지 않는다.

## Identity key performance supplement (2026-10-01)

[IDENTITY-PERFORMANCE.md](IDENTITY-PERFORMANCE.md) records the reviewed, behavior-preserving KeyObject reuse change and its focused verification. The earlier component experiment found an avoidable Node key-representation cost; its full-path numbers also include batching/worker changes and are not product scan evidence. This slice preserves every HMAC and privacy check, adds no fingerprint cache, and leaves ordered byte-bounded ingestion batching behind the P4 pipeline/atomic-checkpoint contract. Its Project draft owns execution status; the supplement records actual evidence.

## P4 source storage supplement (2026-10-01)

[P4-STORAGE.md](P4-STORAGE.md) defines the first bounded persistence slice: versioned source event contributions and completed-line observation metadata replaced atomically under an optimistic revision. Schema-version checks and upgrades serialize under the same immediate write lock so simultaneous opens do not repeat completed migrations. Source variants remain separate; readback is not yet aggregation-ready. Durable parser state, provenance/usage/turn persistence and scan integration remain explicit P4 gates. A saved byte offset alone never authorizes parser resume. The Project draft owns progress and the supplement owns actual evidence.

## P4 single-source ingestion supplement (2026-10-01)

[P4-INGESTION.md](P4-INGESTION.md) defines the reviewed bounded connection from one explicit file through its existing adapter to the event-contribution store. It reparses from zero, verifies observed file consistency and a precise keyed LF boundary, and preserves the caller's revision for atomic replacement. Event-only storage remains neither aggregation-ready nor parser-resume-ready. The coordinator reviewed the plan before implementation; the P4 Project item owns the bounded claim and verification status.

## P4 metric evidence storage supplement (2026-10-01)

[P4-METRIC-STORAGE.md](P4-METRIC-STORAGE.md) defines the next reviewed storage extension: final source turns, usage, observations, capabilities and safe diagnostics committed with events and completed-prefix metadata in one generation. Schema 3 preserves absent historical evidence; legacy event-only replacement clears stale evidence. Readback stays bounded and neither aggregation-ready nor parser-resume-ready. Provider interpretation, graph/recovery state and report integration are separate gates.


## Original P4 bounded scan CLI supplement (2026-10-01, PR #23)

[P4-SCAN-CLI.md](P4-SCAN-CLI.md) originally connected only explicit provider roots to the merged bounded coordinator in PR #23. That slice validated all arguments before lazy storage bootstrap and retained existing private identity, the then-current schema 3 store, per-source CAS and result evidence without a schema change. The original [unchanged-source extension](P4-UNCHANGED-SCAN.md) introduced schema 4 and verified reuse while preserving these CLI boundaries. The current [relationship storage extension](P4-RELATIONSHIP-STORAGE.md) advances to schema 5 and additionally validates current-policy relationship coverage before reuse. A temporary SIGINT listener covers asynchronous startup and scan, with typed zero-work pre-scan cancellation, database closure and exact listener removal. Fatal error envelopes remain exit 2; returned completed/partial/aborted results use 0/1/130. No default roots, aggregate/report activation, dependency changes or parser resume. Earlier P1/NORMALIZATION foundation-only statements describe their historical boundary. The coordinator approved the original plan before the separate development session; the Project owns the live claim.

## P5 bounded source-local summary supplement (2026-10-01)

[P5-SOURCE-SUMMARY](P5-SOURCE-SUMMARY.md) defines the independently planned and coordinator-reviewed pure calculation slice. Consume one validated `readSource` generation through type-only imports, retain bounded inventory and conservative source suppression, group measured duration by stream/category/tool/pattern/scope/evidence, and reconcile response-usage duplicates before finality/mapping cohorts. Checked sums retain null for overflow or incomplete optional components. Deterministic immutable output has no I/O, global canonical totals or CLI/report integration. Implement in a separate development session after Project claim readback; verify unit partitions, adapter/store/reopen integration, privacy and full checks before independent review and draft publication.

## P5 read-only selected-source stats (2026-10-01)

Implement the reviewed [read-only stats contract](P5-READONLY-STATS.md) before broader report/reconciliation work. First prove a non-creating, non-migrating existing-private-store opener for supported DELETE mode; reuse exact key/header validation and pinned readSource. Then bounded header catalogue, explicit-mode CLI and synthetic full/artifact verification. Stop and report if the supported-case no-write gate cannot be demonstrated. No report files, parser, schema or dependency changes.

## Human selected-source formatter supplement (2026-10-01)

[P5-HUMAN-STATS](P5-HUMAN-STATS.md) specifies the independently planned, coordinator-reviewed formatter-only slice. Keep the JSON and source-list branches unchanged; copy and partition existing immutable summary cohorts, then render numeric ASCII tables with full safe-label legends and exact String(number) values. Verify separate known/unknown top-ten buckets, every evidence/eligibility boundary, complete synthetic output, JSON byte parity, privacy and packed CLI before frozen-content review. No source-summary, storage, parser, report, dependency or CLI option change.

## P4 unchanged-source reuse supplement (2026-10-01)

Implement the independently planned and coordinator-reviewed [P4-UNCHANGED-SCAN](P4-UNCHANGED-SCAN.md) contract in an isolated development session. Review the exact streaming HMAC/schema/store lifecycle before connecting same-read proof generation and raw probes; then integrate fresh synchronous unchanged confirmation and additive scan outputs. Preserve all current bounds, adapter semantics, original CAS on misses, safe failure and read-only no-write behavior. Full synthetic/adversarial/concurrent/artifact checks and independent frozen-file review precede draft publication. No source defaults, parser resume, aggregation, report, dependencies or timing benchmark expansion.


## Source-local Slow Tool supplement (2026-10-01)

The independently researched, coordinator-reviewed [P5-SOURCE-SLOW-TOOL](P5-SOURCE-SLOW-TOOL.md) contract defines an internal pure function using type-only imports. The original implementation stacked on PR27 `d3289118658070a0601876445ac105fc6f1d898c` while that parent was open, preserving its additive shared documents and all other paths. Parent final review reconciled merged main `5ed025cd63285c50e6c07036abf5c3f25d2fa43d` without altering the Slow Tool rule/tests and retained the parent's current contract corrections. Final publication targets main and requires exact-head CI before merge. The narrow Project draft, separate from existing P5 report ownership, owns live claims and status; the steps below describe the original implementation plan.

1. Freeze the closed population, positive provenance, whole-source/partition suppression, arithmetic and no-waste contract before code, then save/read back the precise claim. **Verify:** current main/PR paths, unchanged report reservation, exact base-tree bytes and additive shared documents.
2. Implement one bounded observation index, disjoint eligibility and immutable deterministic partition/cohort output. **Verify:** hand-calculated thresholds, provenance failures without denominator inflation, replay/poll/wrapper controls, zero/overflow/fractional arithmetic, quantiles, exact caps and linear retained evidence. Pause for coordinator selection/provenance/arithmetic review before final testing.
3. Exercise independent synthetic provider -> store -> reopen -> readSource -> rule paths and card actionability. **Verify:** actual ordinary adapter provenance, structured priority, Claude final/background/sidechain semantics, repeat/replacement identity and unchanged source/store bytes; necessary-work counterexample, one matched experiment and mandatory quality gates. Real logs/pilot/benchmark remain NOT RUN.
4. Freeze changed bytes and manifest for independent full-diff review and publication handoff. **Verify:** focused tests, full npm run check/typecheck/build/artifact, doc links/anchors, whitespace, privacy sentinels and unchanged package/CLI surface. Root owns draft publication, exact remote/head CI and any later retarget. No merge, deploy, npm release or broad P5 completion.


## Read-only selected-source insights supplement (2026-10-01)

Implement the reviewed [P5-SOURCE-INSIGHTS-CLI](P5-SOURCE-INSIGHTS-CLI.md) contract as one CLI adapter over the existing pinned read-only store and unchanged Slow Tool rule. Validate full selection and path syntax before lazy storage imports; inside one synchronous callback validate installed-key binding, read one source once and analyze that exact generation once. Embed exact analysis JSON and render evidence-first human output with one candidate-bucketing pass, retaining all bounded partitions/cards and required actionability text. Make only the two existing schema/mode error strings command-neutral. Verify selection/privacy/no-write boundaries, independent provider lifecycle and generation consistency, null/zero/partial/denominator/coarse-family semantics, structural max-shape bounds, exact neighboring-command success parity and packed installed output before independent all-file review. No parser, normalization, storage/opener, rule, package or report change. Project-only tracking owns current status; no test is passed until recorded in the contract's executed evidence.


## Confirmed source-local failure evidence supplement (2026-10-01)

Follow [P5-SOURCE-FAILURES](P5-SOURCE-FAILURES.md): freeze ordinary adapter provenance and independent expectations, claim the narrow Project draft, obtain coordinator review, then implement the pure immutable bounded analyzer. Pause for source review before adding opt-in stats selection and formatter. Preserve one pinned read and unchanged old bytes. Verify ordinary adapters through scan/store/reopen, disjoint exclusions, session suppression, independent timing, bounds, privacy/no-write, focused/full/installed-artifact gates and frozen all-path review. No parser/schema/dependency/report changes or retry inference.

Failure-view presentation amendment: bucket cohorts once, then render first 6 sessions / 3 cohorts per displayed session / 3 measurements per displayed cohort in existing order. Human omits proof arrays with reference counts, caps patterns at 80 ASCII characters with accounting, and reports all omission counts. JSON/analysis stay complete. Validate safe-pattern bounds fixtures and assert 400-line/64-KiB maxima and 45-line/6-KiB ordinary output before final all-file review.

## P4 relationship storage supplement (2026-10-02)

Implement [P4-RELATIONSHIP-STORAGE](P4-RELATIONSHIP-STORAGE.md) after the fresh Project claim and shared-document release. Freeze main/fixture bytes and independent tiny semantic oracles before code. Add an owned-data relationship validator with provider-specific exact shapes and incremental 4 MiB capture policy, then schema 5 source-owned header/ordered contributions, original-CAS atomic replacement and bounded same-snapshot readback. Preserve historical null, deterministic budget-unavailable and captured states without changing old ingestion acceptance. Guard schema4 cache DDL during migration. Connect only final adapter projections and require understood relationship capture policy for candidate/fresh unchanged confirmation.

Verify migration/rollback/cancellation/foreign-key binding, count-byte preflight and cursor ownership, ten fixture round trips, independent raw synthetic expected relationships, prior event/metric parity, null recapture and captured/unavailable reuse, exact read-only compatibility/no-write, CLI parity and script-disabled installed artifact. Node heap is bounded at 512 MiB with one test worker. Unsupported future contracts and corruption fail safely; policy mismatches require recapture. No parser/normalizer/report/CLI/schema-output/public-export changes or inferred graph edges. The linked supplement records actual local execution receipts and the remaining exact-head CI/runtime gates.

## Source-local completed Read revisits (2026-10-02)

The separate development session implemented [P5-SOURCE-READ-REVISITS](P5-SOURCE-READ-REVISITS.md) on merged `b8ea155829e6ee095fb0eafbf4774bc264a94eaa`, after a narrow Project claim/readback and final coordinator contract review. The existing P5 report owner and display-model reservations remain unchanged. Eleven paths cover four production files, four new tests and three documents; no inherited fixture, parser, normalizer, store, shared-analyzer or package change. The steps below record the original implementation plan; current execution evidence, including independent parent review, is in the linked supplement.

1. Freeze independent ordinary Claude Read A,A,B,A expectations and verify adapter -> store -> close/reopen without trusted context. **Verify:** four distinct invocation IDs, two project-scoped file identities, replay stability, project-absent null identity, failed/pending exclusions and untimed completed admission. This positive was a prerequisite for production metric development and passed before that handoff.
2. Add the bounded immutable analyzer, reusing unchanged source-failures admission once as a conservative provenance gate. **Verify:** 2/4 and 53/91, observed zero versus unknown, full-session missing-identity suppression, different project/range/session behavior, inherited provenance limits, structural reference caps and no unsupported inference. The helper computes irrelevant failure timing transiently; this bounded correctness trade-off adds no work to old commands and makes no performance claim. Pause for coordinator source review before CLI integration.
3. Add the opt-in stats branch and formatter over one pinned readSource generation. **Verify:** arguments before I/O; no scan/migration/writes; exact old-command bytes; complete bounded JSON at most 8 MiB, human at most 160 lines/32 KiB with six sessions/ten cohorts per shown session and truthful omissions. Ordinary output stays at most 35 lines/4 KiB. Scope is file revisits, not search ratios or waste.
4. Run focused/full/typecheck/build/script-disabled artifact, optional old/new and installed parity, privacy/docs and frozen all-path review gates. **Verify:** current source versions/limits and inherited byte/mode preservation, no gate weakening, separate failed/NOT RUN receipts, exact published-head CI before any later authorized merge. Separate development owns implementation; parent owns review/publication. No broad P5 completion, real-user pilot, paid benchmark, release or report integration is implied.

## Observed invocation interval union (2026-10-02)

A separate development session implemented [P5-SOURCE-INVOCATION-OVERLAP](P5-SOURCE-INVOCATION-OVERLAP.md) on merged main `38871590fb00efba2b1efd64f1b7639572365fce`. The original twelve-path Project reservation was amended to thirteen before the inherited read-revisits test's exact help assertion changed. Current execution receipts and independent parent review are recorded in the linked supplement; the Project item owns live status and claims.

The original implementation plan was to freeze ordinary raw timestamps, independent framed HMAC IDs and source-byte offsets through actual adapter/ingestion/store/reopen, stopping on an adapter-contract failure. Then implement a pure bounded immutable analyzer calling unchanged source-failures exactly once, indexing observations once and validating independent interval fields and arithmetic. Obtain independent analyzer review before opt-in CLI integration. Verify one pinned read, no writes/raw scans, exact inherited command parity including read-revisits, complete bounded JSON and human omissions. The existing dependency/runtime and bounded resource plan apply; full aggregate execution requires coordinator scheduling. Separate development owns implementation; parent owns review and publication.

## Ordinary Claude adapter checkpoint plan (2026-10-02)

A separate development session implemented [P4-CLAUDE-CHECKPOINT](P4-CLAUDE-CHECKPOINT.md) after coordinator and independent contract review, on merged main `d3c6b63edc36ea61cf0cbe08912d76d8048f69af`. The ten-path slice preserves current ingestion outputs; no scanner seek, database migration, CLI/readiness or provider-semantic change is authorized. The steps below record the original implementation plan, while the linked supplement records executed candidate and independent parent verification. Live ownership/status remains in the P4 Project draft.

1. Freeze independent synthetic raw records, framed HMAC expected identities, byte starts and semantic timing/usage oracles against unchanged main. Draft every-split equivalence and adversarial validation tests before production edits. **Verify:** source baseline is d3c6b63edc36ea61cf0cbe08912d76d8048f69af; three immutable Claude JSONL fixtures run without trusted context; private reference exceptions and zero/one-based split-zero cases are explicit. New tests remain NOT RUN at planning time.
2. Add bounded private-state schema and codec helper. Bind all state, effective limits, actual current parser identity, caller boundary and context versions/key with the existing namespaced HMAC over the payload SHA-256. Preflight4MiB/depth16/canonical JSON, exact fields/counts/64KiB rows, typed references, safe counters and staged owned decoding. **Verify:** re-signed malformed test payloads cannot bypass schema validation; duplicate JSON/map keys, wrong binding/key/version, deep/oversized state and trusted fields reject without a partial adapter. Valid nullable/partial/limited/dangling states remain representable.
3. Add descriptor-only eligibility tracking and additive export/static restore methods to ClaudeAdapter. Track valid source positions before malformed-record early returns, preserve all private state in insertion order, and require first restored position ordinal=nextOrdinal and byteOffset>=completedOffset. **Verify:** snapshot/inspectRetainedState/upsert batches and independent tiny oracle equal uninterrupted parsing at every split; second checkpoint cycle, pending/deferred/background/usage replays and limits/drop counters retain exact semantics. Failed capture does not alter parsing; offsets remain caller claims requiring external file proof.
4. Run focused/typecheck/build/full and installed-artifact checks only in the coordinator-scheduled resource slot; freeze all10 paths for independent code review and parent draft publication. **Verify:** unchanged inherited fixtures/old adapter behavior, privacy sentinels, Markdown links/whitespace and exact hashes; heavy commands use one worker/512MiB heap. Report optional skips and NOT RUN limits distinctly. No merge/deploy/package publication or full-P4 completion.

## P6 selected-source measured HTML — reviewed slice

A separate development contributor implemented the bounded successor on merged main `08d87e1a979aba53dd15d091af4fff0dd6f967b2`, using TypeScript static HTML/CSS/numeric SVG rather than the planned full-product React/Vite report. The steps below retain the original implementation plan; executed implementation and independent parent verification, including the bounded macOS test-fixture correction, are recorded in the linked contract. [P6-SOURCE-REPORT.md](P6-SOURCE-REPORT.md) is the exact contract, 18-path reservation, independent expectations and verification matrix. It does not replace historical plans or broaden the checkpoint reservation.

1. Freeze reviewed source selection, session/partition union order, text/array/byte caps, analyzer field projection, CSP and publication outcomes; save/readback the Project claim and shared-section handoff. Verify: no production edits before root GO; fresh base/claim and no overlapping parser paths.
2. Add raw-provider baseline oracles, model/renderer/writer and CLI tests. Verify: independent six-call 20/100 arithmetic on actual closed/reopened store; 19/100, zero, missing-provenance, fractional and overflow controls; missing-feature red is distinct from fixture failure.
3. Implement a bounded owned model from one readSource and one call per unchanged analyzer in the existing read-only pinned transaction, closing before rendering/output. Implement semantic-token static CSS with exact CSP hash and compatible numeric SVG, then trusted-parent no-overwrite publication with truthful postlink results. Verify: safe field projection, exact values/unknown states, deterministic caps/anchors, 0600/identity checks, immutable source/store and every pre/postlink failure path.
4. Wire only explicit report selection/output and safe receipts; qualify inherited help expectations narrowly. Verify: existing command byte/status parity except documented report/top-level-help changes; script-disabled packed-installed parity, artifact contents and optional test counts.
5. Root schedules aggregate tests and browser evidence, independent exact-path review, draft publication and exact-head CI. Verify: actual execution recorded, NOT RUN limits retained, no merge/deploy/npm/user-log use and no broad P5/P6Done claim.


Parent macOS qualification amendment (2026-10-02): resolve the synthetic temporary parent with `realpath`/`realpathSync` in the two report CLI fixture files before `mkdtemp`, as planned in [P6-SOURCE-REPORT](P6-SOURCE-REPORT.md#independent-parent-qualification-amendment--macos-fixtures-2026-10-02). A separate development contributor makes this bounded test-only correction; parent retains review/publication and the three reserved documents. Verify ordinary macOS temporary paths with every existing assertion and production guard unchanged, then run supported-runtime/full optional/installed/artifact qualification and record browser results distinctly.


## Ordinary Claude search lookup evidence (2026-10-02)

The separate developer implements the coordinator-reviewed [native search slice](P5-CLAUDE-SEARCH-EVIDENCE.md) in the reviewed 20-path claim. The finite own-data extractor validates supported native fields, canonicalizes only present options and preflights the entire unchanged 2 MiB lookup frame before passing transient fields to the existing normalizer. Frame overflow removes only lookup evidence. No operation-key formula, raw retained field or state collection changes.

Native replay digests compose the unchanged base HMAC with bounded version fingerprints/state and raw shape/version eligibility independent of project availability. Lookup creation alone uses the selected authoritative call project. First message-link conflict propagates through one bounded existing-event-map walk to matching native searches, including omitted-tool replay. Checkpoint schema 1 admits only exact keyed native tuples and rejects linked retained conflicts; semantic version 2 rejects old 1 tokens. Storage and the two analyzer gates accept historical Claude 1/current Claude 2 with exact agreement; Codex remains 1. Historical capability insertion order is preserved for byte-identical old output.

The recovered candidate is based on all 209 independently verified Git blobs of merged 063ee04b. Existing main report changes and all earlier shared-document bytes remain untouched. The original evidence-test prefix and unchanged checkpoint/storage test files match their pre-loss hashes; source and documentation recovery use a new immutable freeze and independent review. The interrupted aggregate is not a pass. Root coordinates the next one-worker/512 MiB resource gate, exact-head review and any later publication.


Independent review's earlier-cwd authority correction separates finite raw shape/version eligibility from project availability. Every eligibility frame uses the same 105-byte ASCII length-only budget stand-in, never an actual or retained identity; the real project is supplied only to normalization. Both directional regressions retain completed 4,000 ms timing, inherited source-order authority and stable subsequent replay. The Project-approved 20th file is an additional inherited fixture-header correction only; no scanner/store/schema/report scope changed.

## Pinned mise and pnpm qualification (2026-10-02, PR #37)

Follow the five ordered steps and concrete Verify entries in [TOOLCHAIN](TOOLCHAIN.md). Separate research verified the pinned action input and the complete immutable npm/pnpm lock graph; preserve its recorded optional-peer encoding exception. Integrate current main without changing inherited production or tests, document the pinned developer commands, and qualify clean scripts-disabled installation, enabled npm prepack and isolated consumers. Run supported local checks with authentic historical baselines and this candidate's installed artifact, then inspect actual current-head hosted matrix logs before merging. The coordinator owns integration/review/publication and the Project-only draft owns the live claim; any implementation correction must return to a separate development contributor under an amended plan first. No package publication or broad P7 completion is included.

## Common pnpm pin follow-up (drafted 2026-10-02)

Follow the four ordered steps and Verify entries in [TOOLCHAIN](TOOLCHAIN.md#common-pnpm-pin-follow-up-plan-2026-10-02). Separate research confirms official pnpm 10.34.6 metadata, the exact installed standalone asset and the unchanged v9 lock format. A separate development contributor replaces only the current pnpm values in mise.toml, package.json and the matrix configuration; the coordinator owns README/current planning prose, review, qualification and publication. Preserve all production/tests and dependency-lock bytes. Qualify the pinned macOS runtime and actual three-runtime hosted CI, enabled npm prepack and isolated consumer execution with the authentic historical baselines. Hold the successor merge for the authorized cross-repository ordering handoff, then release only this narrow Project draft. Original PR #37 evidence and completion remain historical facts.


## Completed native search recurrence (2026-10-02)

Follow [the reviewed 17-path slice](P5-SOURCE-SEARCH-RECURRENCE.md), activated in the scoped Project child before edits. Verify exact PR36 inherited bytes and immutable v4 tests; execute ordinary upstream oracle on unchanged production. Implement a pure bounded deeply owned immutable analyzer calling unchanged source-failures once, indexing proofs once, and grouping exact lookup keys only within each session. Obtain independent analyzer review before formatter/CLI integration. Validate opt-in/conflicts before I/O, then one pinned read-only snapshot. Preserve inherited command bytes except the exact frozen help additions. Root schedules one-worker/512 MiB full and packed-installed qualification and owns shared-hunk integration and publication.

Focused-stage update: ordinary upstream oracle 7/7; analyzer plus oracle 39/39; formatter/read-only integration 12/12; source typecheck and direct build passed. Independent analyzer review cleared its exact frozen bytes. Actual CLI/current PR36 parity passed 31 tests (one installed-artifact test skipped); aggregate, installed artifact and all-path review are pending; see [the stage evidence](P5-SOURCE-SEARCH-RECURRENCE.md#local-implementation-evidence--focused-stage-2026-10-02).

Final local qualification: independent 17-path review CLEAR; source typecheck/build PASS; full suite 59 files / 1,509 passed / 52 optional skipped; unchanged artifact verifier PASS (54 files). Retained script-disabled install plus exact PR36 parity passed 32/32 with zero skips in a quiet-slot rerun, retaining the earlier 31-pass/one-15-second-timeout failure. No production/test or timeout change was made. Historical optional baselines remain NOT RUN; publication/CI/merge remain unclaimed. See [final evidence](P5-SOURCE-SEARCH-RECURRENCE.md#final-local-qualification-2026-10-02).

Fresh-main integration amendment: PR36 was externally amended and merged before publication. Apply only the reviewed 17-path feature delta to main `ffd87e1dc1bcbc21d925d7466ae19b944c1a8735` (tree `8549d3dd18de9292917fe5928ba2bd9cd12b3b14`), preserving all six external test/document changes and 66 new controls. Original qualification remains historical; rebase review and verification are pending. See [the amendment](P5-SOURCE-SEARCH-RECURRENCE.md#fresh-main-integration-amendment-2026-10-02).

Fresh-main qualification completed: independent rebase review CLEAR; typecheck/build PASS; full60 files /1,575 passed /52 optional skipped, including all66 external controls; unchanged54-file artifact PASS; exact ffd87 baseline plus retained installed recurrence32/32, zero skips, unchanged15-second timeout. All225 reviewed source hashes stayed unchanged during gates. Only evidence docs were appended afterward. Historical-baseline optional suites remain NOT RUN; publication/exact-head CI/merge remain parent-owned and unclaimed. See [fresh-main evidence](P5-SOURCE-SEARCH-RECURRENCE.md#fresh-main-qualification-completed-2026-10-02).

Bounded PR37 main integration: preserve exact main106d6c1329499fdb57e63c7aad3f8aac78987249 ten-path toolchain change and package-lock removal, all84 identical dependency-version/integrity pairs, and unchanged feature production/tests. Incoming main shared-document prefixes are retained in full. Duplicate full local suites were not rerun for toolchain-only drift; local mise/pnpm execution is NOT RUN and new exact-head hosted pnpm qualification remains pending. See [the integration contract](P5-SOURCE-SEARCH-RECURRENCE.md#bounded-main-toolchain-integration-2026-10-02).

Bounded PR43 integration: preserve exact main6f7a538d1806a1973a647fb16ab6c1fecc74bd49 eight-path toolchain/document delta and full shared prefixes, unchanged lockfile/84 dependency pairs and identical feature production/tests. Local duplicate full suites and installation are NOT RUN; new exact-head hosted pnpm10.34.6 qualification remains PENDING. Prior pnpm10.33 results are historical. See [the integration note](P5-SOURCE-SEARCH-RECURRENCE.md#bounded-pnpm-10346-main-integration-2026-10-02).
