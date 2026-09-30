# AgentProf P0 Local Evidence

## 상태와 범위

조사일: 2026-09-30 19:52 KST. 계획 기준 revision은 `36bb389262ae44d3f7afe3060401537c41f55c11`이다. 이 기록은 허용된 로컬 로그의 필드·관계 대조다. 제품 파서, 지표 계산, fixture 실행과 지원 승격은 **NOT RUN**이다. 아래 표본에서 필드가 존재한다는 사실을 버전 전체의 지원율로 확대하지 않는다.

P0의 필드 조사와 누락 사유 기록은 수행했다. [METRICS](METRICS.md)의 계산 의미를 만족하는 제품 결과는 P2/P3의 정규화 출력·합성 기대값·로컬 수작업 대조가 모두 통과한 뒤 기록한다. 진단 품질 절차는 [QUALITY](QUALITY.md), 자원 조건은 [BENCHMARKS](BENCHMARKS.md), 합성 연결은 [FIXTURES](FIXTURES.md)를 따른다.

원문은 읽는 동안만 RAM에서 처리했고 저장소·ObsDog·공유 문서로 복사·업로드하지 않았다. 출력은 집계, 필드 이름·형과 익명 sample alias로 제한했다. 실제 source 경로·ID·snapshot digest는 저장소 밖의 권한 `0700` 디렉터리와 `0600` 로컬 manifest에만 있다. 원문 snapshot은 저장하지 않았다.

## 표본 선택과 재현 한계

- 입력 inventory는 Codex sessions 최근 수정 64개, archive 최근 수정 32개, Claude projects 최대 64개의 첫 24줄까지만 대조했다. inventory는 최근 파일에 편향된 선택이며 전체 모집단 조사가 아니다.
- 본문 조사는 Codex 5개 header 버전과 Claude 2개 버전 층에서 최근·오래된 표본을 골랐다. 수정 후 120초가 지난 파일 중 200,000 bytes 이상·8 MiB 이하를 우선했다. 조건에 없으면 작은 완전 파일, 그마저 없으면 큰 파일의 첫 1 MiB를 사용했다.
- 총 12개 파일, 4,286개 완전 JSONL 레코드, 22,720,651 bytes를 읽었다. 10개는 읽은 시점의 전체 파일이고 2개는 newline까지 자른 prefix다. 손상 JSON은 0개, 읽기 전후 size/mtime 변경은 0개였다. append 가능성과 선택 편향은 남는다.
- source 경로와 읽은 byte cutoff·digest는 로컬 manifest로 고정했다. 후속 대조 시 같은 prefix의 digest가 다르면 새 표본으로 기록한다. 현재 파일 전체나 새 append를 당시 snapshot과 같다고 취급하지 않는다.
- 버전은 아래 **관측 파일의 선두 runtime header**다. 복사된 이력의 원래 실행 버전은 별도 문제다. fork 표본의 숫자형 history 필드만으로 원본/새 실행 경계를 확정하지 않았다.

| Provider / header version | Samples | Records | 관측 UTC 범위 | 이력·버전 불확실성 |
| --- | --- | ---: | --- | --- |
| Codex `0.149.0-alpha.4.3` | S4, S5 | 306 | 08-28 17:11:28.728 → 08-31 08:21:56.744 | 두 1 MiB prefix. 잘린 끝 이후 결과는 조사하지 않음 |
| Codex `0.153.4` | S6, S7 | 1,717 | 09-07 13:45:27.013 → 09-11 04:42:57.914 | S7 fork origin 불명 |
| Codex `0.157.0` | S8, S9 | 685 | 09-25 05:31:42.398 → 09-25 16:27:46.487 | S8에 `0.153.4` metadata도 존재 |
| Codex `0.159.0` | S10, S11 | 206 | 09-29 21:31:08.097 → 09-30 09:25:47.919 | S10 fork origin 불명 |
| Codex `0.159.2` | S12 | 193 | 09-30 09:27:27.445 → 09-30 09:39:51.506 | `0.159.0` metadata도 존재; 전체 지원으로 승격하지 않음 |
| Claude `2.1.222` | S1 | 47 | 08-09 07:18:11.957 → 08-09 07:19:57.594 | 작은 단일 표본 |
| Claude `2.1.241` | S2, S3 | 1,132 | 08-23 02:12:13.595 → 08-24 03:23:59.405 | 사용량 재저장 의미 확인 필요 |

inventory에서 추가로 본 Codex `0.149.0-alpha.4.1`, `0.151.0-alpha.7.2`, `0.154.0-alpha.6.2`, `0.155.0-alpha.16.4`, `0.157.1`, `0.158.0-alpha.2.1`과 Claude `2.1.226`, `2.1.240`은 본문 의미 조사 **NOT RUN**이다. 지원 목록에 넣지 않는다.

## 분모와 상태 표기

행렬의 `E/I`는 **필요 필드가 있는 후보 수 / 해당 단위의 조사 수**다. `E`는 출시 지원 표본 수가 아니다. wrapper·fork 중복, privacy identity와 파서 동등성의 최종 검증은 남는다. 레코드 전체 수를 호출·턴 coverage의 분모로 사용하지 않는다.

- `T` 단위: 고유 source turn identity가 있는 명시적 시작 표식. 종료 표식만 있고 시작이 빠진 경우는 따로 센다.
- `C` 단위: Codex `CommandExecution`/`McpToolCall`의 `(thread, turn, item ID)` 또는 Claude `(session, tool_use ID)`별 후보. Codex wrapper response와 다른 도구 항목은 포함하지 않는다. 따라서 이것이 모든 도구 호출을 대표하지 않는다.
- `F` 단위: 소스가 failed라고 표시한 `C` 후보. 실행 실패 의미는 아직 명령 classifier와 대조하지 않았다.
- `L` 단위: 구조적으로 식별된 read/search lookup. 경로 재방문 비율에 필요한 파일 식별과 고신뢰 content churn의 내용·범위 증거는 별개다.
- `V` 단위: 관측 edit 이벤트 또는 명령 토큰으로 찾은 validation 후보. 검증 scope·작업 연결이 검증되지 않은 후보를 완료 cycle로 세지 않는다.
- `U` 단위: usage가 기록된 response/message. 재저장 record 수와 고유 ID 수를 별도로 보존한다.

`direct`는 소스 직접 필드, `observed`는 대조한 timestamp/ID 관계, `inferred`는 검증 전 추론, `unsupported`는 필수 근거 없음이다. 이는 조사 근거의 종류다. 모든 셀의 제품 지원 상태는 **NOT RUN**이다. timed 비율의 0 분모는 `null`이며 시간과 무관한 usage 표본은 `N/A`다.

## Source 단위 집계

| Provider / header version | C 후보 | 직접 duration / C | 유효 경계 / C | 소스 status / C | F / C | response call / result | 다른 완료 도구 record |
| --- | ---: | --- | --- | --- | --- | --- | ---: |
| Codex `0.149.0-alpha.4.3` | 73 | 73/73 | lifecycle 73/73 | 73/73 | 13/73 | 29/28 | 5 |
| Codex `0.153.4` | 98 | 98/98 | lifecycle 98/98 | 98/98 | 6/98 | 154/154 | 119 |
| Codex `0.157.0` | 135 | 135/135 | lifecycle 135/135 | 135/135 | 10/135 | 65/64 | 31 |
| Codex `0.159.0` | 23 | 23/23 | lifecycle 23/23 | 23/23 | 1/23 | 20/20 | 11 |
| Codex `0.159.2` | 33 | 33/33 | lifecycle 33/33 | 33/33 | 3/33 | 17/17 | 11 |
| Claude `2.1.222` | 6 | 0/6 | invocation pair 6/6 | 명시 `is_error` 4/6 | 0/6 | tool_use/result 6/6 | N/A |
| Claude `2.1.241` | 274 | 0/274 | invocation pair 274/274 | 명시 `is_error` 193/274 | 12/274 | tool_use/result 274/274 | N/A |

두 Claude 표본은 모든 tool_use에 같은 session의 결과 ID와 nonnegative timestamp 관계가 있었다. 순수 실행 runtime으로 확인한 값은 아니다. `is_error`가 없는 결과를 성공으로 채우지 않는다. Codex response call 수와 완료 도구 수가 같지 않아 ID 연결 없이 두 숫자를 합칠 수 없다.

## 지표 × Provider / Version 행렬

아래 표의 공통 필요 필드는 [METRICS](METRICS.md)의 Metric Evidence Matrix다. `d`는 직접 duration, `b`는 구간 경계, `i`는 invocation latency, `null`은 0 분모다. fixture 연결은 아직 구현 대조 전이며 [FIXTURES](FIXTURES.md)의 아래 의미 사례에 연결한다. 표본 원문에서 fixture를 복사하지 않는다.

### Codex `0.149.0-alpha.4.3`

| Metric | 필드·근거 종류 | E/I와 timing-covered/E | 의미 대조·누락 사유 / fixture |
| --- | --- | --- | --- |
| Active Time | turn ID·start/end; observed 후보 | 2/4 T, b 2/2 | 시작/완료 동일 start 확인. prefix 밖 끝은 unknown / explicit-turn, pending-turn |
| Tool / Command / Category Time | item ID·duration·경계; direct + observed | 73/73 C, d 73/73·b 73/73 | runtime/lifecycle 분리; wrapper 관계 미검증 / duration-vs-interval, wrapper |
| p50 / p95 | terminal duration; direct 후보 | 73/73 C, d 73/73 | scope별 분포 파서 대조 전 / quantiles |
| Failed Executions | status·exit; direct 후보 | 73/73 C, d 73/73 | F 13개. `rg`/compound 의미 대조 전 / terminal-status |
| Retry Overhead | operation/error identity 미검증; unsupported | 0/13 F, null | 실패 시간 필드는 13/13이나 적격 체인 아님 / retry-loop |
| Repeated Error Time | error identity 미검증; unsupported | 0/13 F, null | 세션 간 동일 오류 확인 없음 / repeated-error |
| Recovery Time | operation·성공 연결 미검증; unsupported | 0/13 F, null | unrelated success와 구분 전 / unresolved-recovery |
| Repeated Read / Search Ratio | read path; observed 후보 | read 5/5 L·d 5/5, search 0/0·null | 내용·범위 동일성 없음 / read-revisit, changed-read |
| Edit → Validation Cycles | 해당 후보 없음; unsupported | edit 0/0·validation 0/0, null | 관측 없음은 전체 미지원의 증거 아님 / validation-cycle |
| Token Attribution | cumulative/last snapshot 29개; unsupported turn attribution | 0/29 U, N/A | 고유 response usage 없음·snapshot 우선순위 대조 전 / cumulative-usage |

### Codex `0.153.4`

| Metric | 필드·근거 종류 | E/I와 timing-covered/E | 의미 대조·누락 사유 / fixture |
| --- | --- | --- | --- |
| Active Time | turn ID·start/end; observed 후보 | 60/62 T, b 60/60 | end 62개 중 직접 경계 61개, 일치 시작 60개. fork origin 미검증 / explicit-turn, fork |
| Tool / Command / Category Time | item ID·duration·경계; direct + observed | 98/98 C, d 98/98·b 98/98 | wrapper/fork canonical 동등성 미검증 / duration-vs-interval, wrapper |
| p50 / p95 | terminal duration; direct 후보 | 98/98 C, d 98/98 | scope별 분포 대조 전 / quantiles |
| Failed Executions | status·exit; direct 후보 | 98/98 C, d 98/98 | F 6개, 명령 의미 미검증 / terminal-status |
| Retry Overhead | operation/error identity 미검증; unsupported | 0/6 F, null | 실패 duration은 6/6이나 체인 아님 / retry-loop |
| Repeated Error Time | error identity 미검증; unsupported | 0/6 F, null | 세션 간 연결 미검증 / repeated-error |
| Recovery Time | 동일 작업 성공 연결 없음; unsupported | 0/6 F, null | unresolved/누락 구분 전 / unresolved-recovery |
| Repeated Read / Search Ratio | parsed command unknown; unsupported | read 0/0 L·search 0/0, null | shell 원문 classifier·fingerprint 계약이 필요 / read-revisit |
| Edit → Validation Cycles | edit 67개·validation 후보 15개; unsupported cycles | 0/67 edits·0/15 validation, null | command 토큰은 scope/연결 증거 아님 / validation-cycle |
| Token Attribution | response·turn usage; direct 후보 | 193/193 U, N/A | token_count 213개와 중복 제거·cache 의미 미검증 / cumulative-usage |

### Codex `0.157.0`

| Metric | 필드·근거 종류 | E/I와 timing-covered/E | 의미 대조·누락 사유 / fixture |
| --- | --- | --- | --- |
| Active Time | turn ID·start/end; observed 후보 | 8/10 T, b 8/8 | fork 이력 4개 시작의 origin은 미확정 / explicit-turn, fork |
| Tool / Command / Category Time | command/MCP ID·duration·경계; direct + observed | 135/135 C, d 135/135·b 135/135 | runtime/lifecycle·wrapper 구분 전 / duration-vs-interval, wrapper |
| p50 / p95 | terminal duration; direct 후보 | 135/135 C, d 135/135 | tool/scope/evidence별 파서 대조 전 / quantiles |
| Failed Executions | status·exit; direct 후보 | 135/135 C, d 135/135 | F 10개, exit 133/135. MCP 상태·명령 의미 구분 전 / terminal-status |
| Retry Overhead | operation/error identity 미검증; unsupported | 0/10 F, null | 실패 duration은 10/10이나 체인 아님 / retry-loop |
| Repeated Error Time | error identity 미검증; unsupported | 0/10 F, null | 세션 연결 미검증 / repeated-error |
| Recovery Time | operation·success 연결 미검증; unsupported | 0/10 F, null | 복사 이력과 새 작업 구분 전 / unresolved-recovery, fork |
| Repeated Read / Search Ratio | parsed command unknown; unsupported | read 0/0 L·search 0/0, null | 원문 없는 identity 생성 대조 전 / read-revisit |
| Edit → Validation Cycles | edit 12개·validation 후보 6개; unsupported cycles | 0/12 edits·0/6 validation, null | validation scope와 작업 연결 미검증 / validation-cycle |
| Token Attribution | response·turn usage; direct 후보 | 70/70 U, N/A | token_count 72개와 cache·fork 중복 대조 전 / cumulative-usage, fork |

### Codex `0.159.0`

| Metric | 필드·근거 종류 | E/I와 timing-covered/E | 의미 대조·누락 사유 / fixture |
| --- | --- | --- | --- |
| Active Time | 시작만 존재; unsupported completed time | 0/3 T, null | end 0개. 현재 시각으로 늘리지 않음 / pending-turn |
| Tool / Command / Category Time | item ID·duration·경계; direct + observed | 23/23 C, d 23/23·b 23/23 | wrapper/fork origin 미검증 / duration-vs-interval, wrapper |
| p50 / p95 | terminal duration; direct 후보 | 23/23 C, d 23/23 | scope별 결과 대조 전 / quantiles |
| Failed Executions | status·exit; direct 후보 | 23/23 C, d 23/23 | F 1개, 명령 의미 미검증 / terminal-status |
| Retry Overhead | operation/error identity 미검증; unsupported | 0/1 F, null | 임계값 적격 체인 관측 없음 / retry-loop |
| Repeated Error Time | 세션 간 동일 오류 없음; unsupported | 0/1 F, null | 적격 그룹 없음 / repeated-error |
| Recovery Time | 같은 작업 성공 연결 미검증; unsupported | 0/1 F, null | 작은 표본·미해결 여부 미검증 / unresolved-recovery |
| Repeated Read / Search Ratio | read path·search query/path; observed 후보 | read 7/7 L·d 7/7, search 1/1·d 1/1 | search 옵션/범위·content 증거 미검증 / read-revisit, changed-read |
| Edit → Validation Cycles | 해당 후보 없음; unsupported | edit 0/0·validation 0/0, null | 관측 부재 / validation-cycle |
| Token Attribution | response·turn usage; direct 후보 | 20/20 U, N/A | token_count 21개와 중복·cache·fork 대조 전 / cumulative-usage |

### Codex `0.159.2`

| Metric | 필드·근거 종류 | E/I와 timing-covered/E | 의미 대조·누락 사유 / fixture |
| --- | --- | --- | --- |
| Active Time | turn ID·start/end; observed 후보 | 1/3 T, b 1/1 | copied metadata와 원래 실행 버전 미검증 / explicit-turn, fork |
| Tool / Command / Category Time | item ID·duration·경계; direct + observed | 33/33 C, d 33/33·b 33/33 | explicit thread는 선두 meta와 일치하나 origin 대조 전 / duration-vs-interval, fork |
| p50 / p95 | terminal duration; direct 후보 | 33/33 C, d 33/33 | scope별 파서 대조 전 / quantiles |
| Failed Executions | status·exit; direct 후보 | 33/33 C, d 33/33 | F 3개, 명령 의미 미검증 / terminal-status |
| Retry Overhead | operation/error identity 미검증; unsupported | 0/3 F, null | 같은 작업·오류 조건 미검증 / retry-loop |
| Repeated Error Time | error identity 미검증; unsupported | 0/3 F, null | 세션 간 그룹 미검증 / repeated-error |
| Recovery Time | operation·success 연결 미검증; unsupported | 0/3 F, null | 복사/새 실행 provenance 대조 전 / unresolved-recovery, fork |
| Repeated Read / Search Ratio | read path; observed 후보 | read 9/9 L·d 9/9, search 0/2 candidates·null | query 없는 list_files 2개를 동일 검색 비율에 넣지 않음 / read-revisit |
| Edit → Validation Cycles | edit 2개·validation 후보 1개; unsupported cycles | 0/2 edits·0/1 validation, null | scope·cycle 연결 미검증 / validation-cycle |
| Token Attribution | response·turn usage; direct 후보 | 18/18 U, N/A | token_count 19개와 cache·fork 중복 대조 전 / cumulative-usage, fork |

### Claude `2.1.222`

| Metric | 필드·근거 종류 | E/I와 timing-covered/E | 의미 대조·누락 사유 / fixture |
| --- | --- | --- | --- |
| Active Time | 명시적 턴 경계 없음; unsupported | 0/0 T, null | 메시지 span을 Active Time으로 쓰지 않음 / duration-only-turn |
| Tool / Command / Category Time | tool_use/result ID·timestamp; observed | 6/6 C, i 6/6·d 0/6 | invocation latency만 관측 / paired-call |
| p50 / p95 | matched pair·timestamp; observed 후보 | 6/6 C, i 6/6 | n<20; 순수 runtime 분포 아님 / quantiles |
| Failed Executions | 일부 is_error; direct 후보 | 4/6 C, i 4/4 | 나머지 2개는 상태 누락. F 0개는 관측 범위에 한정 / terminal-status |
| Retry Overhead | 확인된 실패·identity 없음; unsupported | 0/0 F, null | 0으로 성능 성공을 주장하지 않음 / retry-loop |
| Repeated Error Time | 확인된 실패 없음; unsupported | 0/0 F, null | 세션 간 그룹 없음 / repeated-error |
| Recovery Time | 실패 cohort 없음; unsupported | 0/0 F, null | 복구 값을 0으로 만들지 않음 / unresolved-recovery |
| Repeated Read / Search Ratio | Read file_path; observed 후보 | read 1/1 L·i 1/1, search 0/0·null | 명시 range·content 동일성 없음 / read-revisit, changed-read |
| Edit → Validation Cycles | Edit 1개·validation 0개; unsupported cycle | 0/1 edits·0/0 validation, null | edit만으로 완료 cycle 없음 / validation-cycle |
| Token Attribution | message.id·usage; direct 후보 | 8 unique/17 records U, N/A | 재저장 동일 usage 대조, cache 의미·최종값 계약 미검증 / duplicate-usage |

### Claude `2.1.241`

| Metric | 필드·근거 종류 | E/I와 timing-covered/E | 의미 대조·누락 사유 / fixture |
| --- | --- | --- | --- |
| Active Time | turn_duration durationMs만; unsupported interval | 0/8 turn-duration records, b null·직접 합계 8/8 | 종료 timestamp에서 시작을 역산하지 않음 / duration-only-turn |
| Tool / Command / Category Time | tool_use/result ID·timestamp; observed | 274/274 C, i 274/274·d 0/274 | 직접 runtime 없음; background 상태 의미 대조 전 / paired-call |
| p50 / p95 | matched pair·timestamp; observed 후보 | 274/274 C, i 274/274 | duration scope와 unknown 상태를 따로 필터링 / quantiles |
| Failed Executions | 일부 is_error; direct 후보 | 193/274 C, i 193/193 | F 12개. 나머지 81개는 status 누락 / terminal-status |
| Retry Overhead | operation/error identity 미검증; unsupported | 0/12 F, null | 실패 pair는 12/12지만 적격 체인 아님 / retry-loop |
| Repeated Error Time | error identity 미검증; unsupported | 0/12 F, null | 세션 간 fingerprint 미검증 / repeated-error |
| Recovery Time | operation·success 연결 미검증; unsupported | 0/12 F, null | terminal status 누락·중단과 unresolved 구분 전 / unresolved-recovery |
| Repeated Read / Search Ratio | Read file_path; observed 후보 | read 20/20 L·i 20/20, search 0/0·null | 9개만 explicit offset+limit. 내용/변경 동일성 미검증 / read-revisit, changed-read |
| Edit → Validation Cycles | Edit/Write 32개·validation 후보 25개; unsupported cycles | 0/32 edits·0/25 validation, null | 일부 is_error 누락, full scope·cycle 연결 미검증 / validation-cycle |
| Token Attribution | message.id·usage; direct 후보 | 243 unique/609 records U, N/A | 108 IDs에서 usage 변경. 첫 값/합산 금지, final snapshot 의미 대조 전 / updated-usage |

`inferred`로 승격한 수치는 없다. 기본 lookup 비율 후보와 고신뢰 Context Churn은 동일하지 않다. query fingerprint와 대상 옵션이 완성되기 전 검색 1개 관측을 완전한 지원으로 표시하지 않는다.

### 합성 ID 연결

위 행렬의 의미 이름은 다음 실제 synthetic ID에 연결한다. 실행 결과는 아직 NOT RUN이다.

| 행렬 의미 이름 | `contracts/metrics.json` case 또는 provider shape |
| --- | --- |
| explicit-turn, pending-turn, duration-only-turn | `parallel-turns`, `resumed-pending`, `duration-only-unknown`; `codex-structured` |
| duration-vs-interval, paired-call, quantiles | `duration-interval-scopes`, `latency-boundaries`; `claude-message`, `codex-legacy` |
| wrapper, fork | `codex-structured`, `codex-fork`, `claude-fork`, `codex-archive` |
| terminal-status | `statuses`, `operation-flags-targets` |
| retry-loop, repeated-error, unresolved-recovery | `retry-resolved`, `retry-other-target`, `retry-overlap`, `repeated-error` |
| read-revisit, changed-read, validation-cycle | `read-search-ratio`, `read-changes`, `validation-cycles` |
| cumulative-usage, duplicate-usage, updated-usage | `codex-tokens`, `claude-tokens`; `claude-message` |

각 rule ID의 양성·정상 음성과 포함 ID는 `contracts/diagnostics.json`, global overlap/clipping/duration-only는 `contracts/waste.json`에 있다. 파서 출력과 손계산 oracle을 대조하기 전에는 이 연결만으로 해당 버전의 지원을 완료하지 않는다.

## 확인한 의미와 다음 대조

1. **Codex duration과 경계는 항상 같지 않다.** 조사한 command/MCP 후보 362개 중 32개는 `end-start`와 직접 duration이 1 ms보다 달랐다. 버전별 수는 8/73, 1/98, 14/135, 3/23, 6/33이다. signed 차이의 전체 범위는 -0.748 ms → 29.993 ms다. 반올림이나 시작/종료 기록 오버헤드를 원인으로 확정하지 않는다. duration scope와 interval scope를 따로 보존하고 runtime 구간을 역산하지 않는다.
2. **Claude pair는 관측 latency다.** 280개 후보가 결과 ID와 연결됐지만 직접 duration은 0/280이었다. 앞선 FINDINGS의 다른 표본에서 duration을 본 사실과 모순이 아니다. 두 표본의 직접 timing coverage를 합쳐 전체 지원율로 사용하지 않는다. `turn_duration` 8개도 배치 가능한 턴 경계가 아니다.
3. **같은 Claude message.id의 usage가 변한다.** `2.1.241`의 243개 고유 ID 중 108개에서 재저장 usage가 달랐다. 이 표본의 숫자 component 감소는 0개였다. 같은 ID를 매번 더하거나 첫 값으로 고정하지 않는다. source ordering과 final snapshot 판정을 합성 updated-usage로 검증한 뒤 최종값을 선택한다. cache 포함 관계·partial/final 의미는 P3에서 확인한다.
4. **파일 header 하나로 origin을 확정할 수 없다.** S8/S12에는 여러 metadata 버전이 있었고 완료 항목 thread가 선두 metadata ID와 일치했다. 항목 ordinal은 선두 metadata의 `subagent_history_start_ordinal` 이후였다. 이 관계는 제한된 구조 관측이다. 해당 필드명이 copied/new cutoff를 보장한다는 근거는 없으므로 숫자만으로 이력을 제거하지 않는다. explicit thread, 알려진 원본 연결과 검증된 복사 경계가 없으면 ambiguous origin을 남긴다.
5. **시간이 있다고 retry/error가 지원되는 것은 아니다.** 소스 failed 후보 45개에는 timing 필드가 있지만 operationKey·errorFingerprint·작업 성공 연결의 privacy/semantic 계약이 검증되지 않았다. 해당 3개 지표의 eligible chain은 0, 제품 값은 unknown이다.

부모 Codex 기술 검토와 P2/P3는 위 후보 분모를 최종 canonical 호출·turn/usage로 재대조한다. 실제 source를 읽을 수 없으면 그 조건을 기록하고 합성 fixture 통과만으로 실버전 지원을 주장하지 않는다.
