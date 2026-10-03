# AgentProf Specification

## Status

Draft, 2026-09-30. 사용자 제공 AgentTrace 제안과 AgentProf metrics 제안을 통합한 초기 사양이다. 제품명·CLI·저장소 이름은 사용자 지정에 따라 `agentprof`, 제품 표시명은 **AgentProf**로 정한다.

이 문서는 제품 목표와 관측 가능한 동작을 정한다. P0 조사·합성 계약 검토와 P1 실행 기반 검증을 마쳤다. 제품의 로그 분석·리포트 흐름은 후속 단계이며 현재 개발 CLI의 bounded scan 계약은 아래에 명시한다. 제품 범위나 동작을 바꾸면 먼저 이 문서를 갱신한다. 별도 디자인 기반의 토큰·컴포넌트와 합성 오프라인 견본은 [DESIGN-GUIDELINES](DESIGN-GUIDELINES.md)를 따른다. 이것은 실제 로그 분석·로컬 대시보드 구현이나 P5/P6 완료를 뜻하지 않는다.

## Goal

**AgentProf는 AI 코딩 에이전트의 병목과 반복 작업을 분석하는 로컬 성능 프로파일러다.**

첫 화면은 세 가지 질문에 답한다.

1. 에이전트가 어디에 시간을 쓰는가?
2. 어떤 반복 패턴을 관측했는가?
3. 무엇을 먼저 개선할 수 있는가?

제품의 중심은 측정 → 패턴 탐지 → 진단 → 개선 제안 → 전후 검증이다. 세션·호출·토큰 수는 맥락 정보다. 제안서의 모든 예시 수치는 제품 데모이며 실제 측정값이 아니다.

최적화의 목적은 **품질을 유지하면서 같은 작업에 필요한 토큰과 작업 경과 시간을 줄이는 것**이다. 검증을 생략하거나 불완전한 결과를 빨리 반환하는 것은 개선이 아니다. 측정 → 실행 가능한 작은 변경 → 같은 조건의 재검증까지 연결하되, 관측 연관성과 검증된 효과를 분리한다.

### Capability snapshot (2026-10-01 KST)

P1 통합 revision `c3856249bdc0a9c19b856ca32c97d3484e189176`에는 문서 PR #11과 기반 [PR #9](https://github.com/WhiteKiwi/agentprof/pull/9)가 병합되었다. P0 표본·합성 계약과 P1 help/version·개인정보·bounded reader·SQLite 기반을 사용한다. P2는 [Codex 어댑터](CODEX-PARSER.md)의 호출·턴·usage 관측과 [bounded 대조](CODEX-EVIDENCE.md)를 추가한다. 이 P1/P2 기록의 명령 미구현 경계는 역사적 상태다. 현재 `stats`와 `insights`는 아래 명시적 source-prefix 선택을 지원하고, `report`는 [bounded HTML 계약](P6-SOURCE-REPORT.md)에 따른 저장 소스 하나의 리포트를 생성한다. `open`은 `NOT_IMPLEMENTED`·exit 2다. 전역 분석·전체 리포트 흐름과 개선 효과 검증은 후속 기능이다. P0 조사를 하지 않았다고 표현하거나 부분 테스트 통과를 제품 분석 완료로 표현하지 않는다. [검토 근거](FINDINGS.md#2026-09-30-측정에서-개선으로-검토)와 [실행 evidence](ACCEPTANCE.md)를 참조한다.

P3는 [Claude 어댑터](CLAUDE-PARSER.md)의 원문 없는 execution·turn·usage 관측을 추가한다. [고정 prefix 대조](CLAUDE-EVIDENCE.md)는 명시한 bounded 범위에서 PASS다. 호출·결과 시각 차이는 invocation latency이며 background acknowledgement는 pending으로 보존한다. 직접 turn duration은 scope·구간 불명, 실제 usage는 finality unknown/provisional이다. 이 관측을 검증된 Active Time·최종 토큰 총계로 올리지 않는다.

사용자 요청으로 공개한 [npm 개발 알파](NPM-ALPHA.md)는 고정 main revision의 Codex parser·JSONL reader·privacy API와 CLI help/version을 제공한다. 최초 `0.1.0-dev.0`에는 Claude P3가 포함되지 않는다. 공개 알파의 SDK 사용 가능성과 전체 리포트 제품 출시를 구분한다.

## Product Principles

P4의 다음 저장 확장은 [metric evidence 계약](P4-METRIC-STORAGE.md)을 따른다. 이벤트와 같은 소스 세대의 토큰 usage·턴·진단 및 해석 근거를 원자적으로 보존하고, 기존 DB의 근거 부재는 null로 유지한다. 이는 후속 실제 집계의 입력 보존 단계이며 최종 토큰 합계·durable resume·리포트 완료를 뜻하지 않는다.

- 기존 로그를 읽어 분석한다. 입력을 변경하거나 로그에 나온 명령·지침을 실행하지 않는다.
- 핵심 기능은 계정·서버·LLM API 없이 로컬에서 동작한다. 분석 데이터의 자동 업로드와 텔레메트리는 없다.
- 측정값, 관측 시각으로 계산한 값, 추정값과 알 수 없는 값을 구분한다.
- 표본 수, 시간 커버리지, 분모, 날짜 범위와 타임존을 보여준다.
- 반복 실행은 필요한 작업일 수도 있다. 관측 패턴과 개선 가능성, 실제 절감 시간·인과 효과를 구분한다.
- 각 진단에 근거 이벤트, 관련 세션, 규칙·임계값과 개선 제안을 연결한다.

## Bounded scan CLI (2026-10-01)

개발 빌드의 `scan`은 명시적 `--codex-root` 또는 `--claude-root`가 하나 이상 필요하다. 생략한 공급자의 기본 홈 로그는 읽지 않는다. root와 `--data-dir` 옵션은 명령 앞뒤에서 쓸 수 있으며 상대 경로는 현재 작업 디렉터리를 기준으로 한다. 빈 값·공백만인 값·NUL/CR/LF 및 공급자 합계 16개 초과 root는 로컬 파일 생성/입력 접근 전에 `INVALID_ARGUMENT`·exit 2다. 실제 공백이 포함된 유효 경로는 보존한다.

```bash
agentprof scan --codex-root ./synthetic-codex --data-dir ./private-agentprof
agentprof --json --data-dir ./private-agentprof scan --codex-root ./synthetic-codex --claude-root ./synthetic-claude
```

수집 상한은 64 sources, 256 directories, 내부 nodes와 yielded entries 각각 4,096, source당 16 MiB/32,768 records, diagnostic samples 256개다. 기존 line/parser/store 상한도 적용된다. [변경 없는 source 재사용](P4-UNCHANGED-SCAN.md)은 현재 adapter version·semantic limits·전체 파일 bytes와 저장 payload를 검증하고 최신 generation을 확인한 경우에만 적용한다. 이때 rows와 revision을 유지한다. 재사용 조건이 맞지 않는 안정적인 miss는 최초에 읽은 revision으로 CAS를 유지하며 byte zero부터 재해석한다. 손상된 evidence와 probe 중 관측한 파일 변경·접근/close 실패는 안전하게 실패하며 재해석으로 숨기지 않는다. 원자적 source 교체는 중복 행을 만들지 않지만 revision은 증가할 수 있다. 전체 이력·성능 보장은 없으며 자동 삭제/이동 정합화·집계·증분 parser 복구는 없다.

결과는 stdout에 한 번 출력한다. JSON은 `{schema:"agentprof.cli/v1",ok:<completed 여부>,command:"scan",result:<ScanResult>}`이며 human도 같은 status/counts/stop reason/diagnostic drop 수를 사용한다. `completed` exit 0, `partial` exit 1, 협력적 SIGINT/`aborted` exit 130이다. 부분 실행의 이전 commit은 유지된다. 결과 이전 argument/bootstrap/store 오류는 기존 안전한 stderr error envelope와 exit 2를 보존한다. 내부 예상 밖 오류는 `INTERNAL_ERROR`다. 경로·원문·secret·arbitrary exception text는 출력하지 않는다. Node 자체 SQLite warning은 별개 stderr일 수 있다.

SIGINT는 시작 단계 사이와 수집 중 협력적으로 확인한다. scan 시작 전 취소는 모든 count/drop이 0인 aborted 결과이며 이미 만든 private bootstrap 파일은 남을 수 있다. 열린 DB와 해당 임시 signal listener는 닫고 제거한다. SIGTERM/SIGKILL의 crash rollback이나 즉시 중단은 보장하지 않는다. `aggregationReady=false`, `parserResumeReady=false`이며 저장 source 수는 검증된 세션/토큰/시간 총계가 아니다. help/version 및 미구현 명령은 storage-free다. 로컬 key/DB 오류는 기존 파일을 보존하며 자동 key 회전/DB 초기화를 하지 않는다. 상세 구현·실행 근거는 [P4-SCAN-CLI](P4-SCAN-CLI.md)를 따른다.

## First User Flow (planned full product)

```bash
agentprof scan
agentprof stats --last 7d
agentprof insights --last 7d
agentprof report --last 7d --output ./agentprof.html --open
agentprof open ./agentprof.html
```

첫 시도는 `npx`로 실행할 수 있고, 지속적으로 쓰는 사용자는 npm 전역 설치 후 `agentprof`를 실행할 수 있다. `report --open`은 입력을 증분 스캔해 최신 HTML을 만든 뒤 브라우저로 연다. 별도 `scan` 없이 일회성 생성·열기가 가능하다. `stats`·`insights`는 저장된 결과를 읽고 수집 시각을 표시한다.

출시 전 문서의 설치 명령은 예정 기능으로 표시한다. macOS·Linux를 초기 지원 대상으로 삼는다. 브라우저를 열 수 없는 환경에서도 생성된 HTML을 보존하고 파일 경로를 안내한다.

## In Scope: v0.1

| 영역 | 사용자에게 보이는 결과 |
| --- | --- |
| 입력 | Claude Code·Codex 로그, 명시적 입력 root, 형식·버전 지원 진단 |
| 수집 | 진행 중 로그와 추가 데이터를 다시 읽고, 같은 데이터를 재스캔해도 중복 집계하지 않음 |
| 시간 | 관측 범위·턴 시간·도구 시간, 호출 합계와 병렬 구간의 실제 경과 시간 구분 |
| 명령·도구 | 검색·빌드·테스트·MCP 등 활동 분류, 안전한 명령 패턴과 p50·p95 |
| 실패·복구 | 실패 실행, 재시도 체인, 반복 오류, 확인된 복구와 미해결 체인 |
| 탐색·검증 | 반복 읽기·검색, 편집 후 검증 사이클과 근거가 있는 검증 범위 |
| 토큰 | 공급자별 검증된 턴 사용량과 cache 구분, 근거 부족 시 미지원·미분류 표시 |
| 인사이트 | Slow Tool, Retry Loop, Repeated Error, Exploration Thrashing, Validation Thrashing, Context Churn |
| 추이 | 일별 측정·패턴 추이와 표본 수 |
| 출력 | 읽기 쉬운 CLI, 기계용 JSON, 단일 오프라인 HTML과 최소 세션 타임라인 |

10개 MVP 지표와 6개 자동 진단의 정확한 계약은 [METRICS.md](METRICS.md)를 따른다. 지원되는 입력·합성 검증 사례에서는 정의된 실제 수치를 계산해야 한다. 데이터 근거가 없는 지표는 수치를 만들어 채우지 않고 `unknown` 또는 미지원으로 표시한다. 추정만 가능한 기능은 화면에서 그 사실을 알려야 한다.

토큰을 특정 도구나 추정 작업 단계에 정확히 배분할 수 없으면 미분류로 둔다. 검증 명령의 이름만으로 full rebuild·전체 테스트로 판단하지 않는다. 파서에서 MCP를 식별할 수 있으면 기본 도구 통계에 포함한다.

## Detected Waste Contract

표시명은 **Detected Waste**다. 관측된 반복 패턴에 연결된 시간이며, 전부 피할 수 있었거나 불필요했다는 주장이 아니다.

- [METRICS.md](METRICS.md)의 규칙별 포함표를 따른다. 시간 비중이 큰 Slow Tool은 그 이유만으로 낭비에 포함하지 않는다.
- 시간 근거가 있는 적격 반복 패턴만 시간 총계에 포함한다.
- 같은 구간이 재시도·반복 오류·검증 반복에 동시에 해당해도 총계에서는 한 번만 센다.
- 정밀한 경과 구간이 없는 패턴은 호출 수·호출 시간 합계로 별도 표시한다.
- 측정·추정 총계를 분리하고 커버리지·규칙별 근거를 확인할 수 있게 한다.
- 충분한 근거가 없으면 총계는 `unknown`이다. 이를 0이나 0%로 표시하지 않는다.

## Report Priorities

첫 화면에는 **Time Breakdown**, **Detected Waste**, **Top Insights**를 우선 배치한다. 세션 수와 토큰은 보조 정보다.

상세 화면은 세션 목록, 관측 시간·커버리지, 도구별 시간, 느린 명령, 실패·복구·반복 패턴, 일별 추이, 세션 타임라인을 제공한다. 진단에서 근거 구간으로 이동할 수 있어야 한다.

첫 화면은 숫자보다 먼저 수집 시각·기간·공급자/버전·지원/누락을 보여준다. 시간은 task elapsed(명시적 작업 경계가 있을 때), 관측 턴 시간, session-minutes, 도구 호출 합/구간 합집합을 구분한다. 토큰은 지원되는 고유 응답의 최종 usage와 입력·출력·cache 구성, 분모·미분류를 함께 보여준다. 총 토큰을 도구 출력 크기나 현재 context 길이로 대신 표시하지 않는다.

Top Insights의 각 카드는 관측 사실·근거, 제안, 한 가지 검증 실험, 품질 보호 조건, 미지원/판단 불가 이유를 포함한다. 카드의 영향량은 관측된 사용량이며 예상 절감량이 아니다. [METRICS의 개선 후보](METRICS.md#efficiency-opportunity-cards)는 기존 6개 진단과 구분한다. 큰 출력·context 성장·병렬 중복의 신규 자동 탐지는 별도 검증이 필요한 후속 범위이며, 이 문서 개정으로 v0.1 규칙 수나 완료 상태를 늘리지 않는다.

다크·라이트 테마, 작은 화면과 키보드 사용을 지원한다. 빈 입력, 부분 지원, 진행 중 세션, 낮은 표본 수와 손상된 입력도 설명한다. HTML은 인터넷 연결 없이 열리고 동작한다.

## Privacy and Trust

원문 프롬프트·소스 코드·도구 출력·원문 셸 명령과 비밀값은 기본 저장·리포트·진단·내보내기에 포함하지 않는다. v0.1에는 원문 저장 옵션을 제공하지 않는다. 프로젝트 표시명과 로그 접근 경로를 구분하며, 실제 입력 경로를 공유용 결과에 자동 노출하지 않는다.

HTML에 포함된 분석 문자열은 실행 코드가 될 수 없다. 사용자 로그를 공개 fixture로 사용하지 않는다. 제품 설치 시 패키지를 받는 작업과, 분석 데이터의 로컬 처리는 구분한다.

## Completion Criteria

1. 두 공급자의 지원 입력에서 `scan → stats → insights → report`가 동작한다.
2. 재스캔·append·중단 후 재실행에서 누락과 중복 없이 기대 결과를 재현한다.
3. 순차·병렬·누락·장기 세션의 시간 계산이 정의된 수작업 기대값과 일치한다.
4. 10개 지표와 6개 진단이 근거 있는 값이나 설명 가능한 미지원 결과를 낸다.
5. 같은 기간·조건의 CLI와 HTML 수치가 일치한다.
6. HTML은 오프라인에서 동작하고 외부 네트워크 요청과 비밀값·원문 노출이 없다.
7. P0·공급자 파서 단계부터 로컬 실로그의 필드 의미·지원 범위·표본 수·커버리지를 확인한다. 원문 없이 합성 재현 사례와 검증 요약만 남기며, 검증하지 않은 공급자 버전을 지원한다고 표시하지 않는다.
8. 6개 진단별 양성·정상 음성 사례, 오탐과 제안의 실행 가능성을 검토한다. 파일럿은 동일 조건의 수동 전후 확인을 포함하며 효과가 없거나 판단 불가한 결과도 보존한다.
9. 첫 설치에서 `npx`와 전역 설치의 실행 경로를 검증하고, 지원 버전·한계를 문서화한다.

## v0.1 Manual Improvement Check

v0.1의 전후 검증은 파일럿 절차다. 같은 프로젝트·작업 종류·공급자/모델·설정·기간/표본 기준을 기록하고 한 가지 개선을 적용하기 전후의 리포트를 수동 대조한다. 표본 수·분모·시간 의미·커버리지와 작업량 차이를 함께 검토한다. 조건을 맞추지 못하면 비교 불가로 남긴다. 절감 시간이나 인과 효과를 증명했다고 표현하지 않는다. 자동 매칭·설정 변경 추적·전후 비교 UI는 v0.2 범위다. 상세 절차는 [ACCEPTANCE.md](ACCEPTANCE.md)에 둔다.

전후 확인은 같은 작업의 성공 기준·필수 테스트·검토 기준을 먼저 고정한다. 토큰 또는 시간이 줄어도 품질 조건이 악화되면 개선으로 승격하지 않는다. 작은 작업의 성공률은 전체 작업 품질을 대신하지 않으며, [품질 보존 파일럿](ACCEPTANCE.md#quality-preserving-improvement-pilot)에 반복·변동성과 비교 불가 사유를 남긴다.

## Out of Scope: v0.1

회원 가입, SaaS 백엔드, 팀 동기화, 실시간 로컬 대시보드·서버·watcher, 자동 수집 데몬, LLM 진단, 모델 가격·비용 계산, 임베딩 기반 작업 분류, 근거 없는 절감 예상치와 인과 효과는 포함하지 않는다.

## Later Scope

v0.2는 프로젝트·MCP 상세, Skill 사용 증거, 설정 변경 지점과 조건을 맞춘 전후 비교, JSON·CSV 내보내기를 검토한다. v0.3 이후에는 작업 분류, 서브에이전트 관계, 모델·에이전트 비교와 복합 진단을 검토한다.

Homebrew 배포는 npm 경로를 검증한 다음 단계다. 실시간 로컬 대시보드는 향후 확장으로 감안하되 초기 작업에서 제외한다. 단일 바이너리와 추가 공급자도 별도 검토한다. 후속 아이디어는 [BACKLOG.md](BACKLOG.md)에 둔다. 마스코트는 도롱뇽으로 확정했으며 참고 이미지는 [DESIGN.md](DESIGN.md)에 있다.

## Open Product Questions

- 독립 CLI·오프라인 리포트 이후에도 로컬 사용을 중심으로 유지할지, 선택적 공유를 제품으로 확장할지.
- 정식 출시 라이선스·Homebrew tap을 무엇으로 확정할지. npm 이름은 초기 알파 공개로 `agentprof`를 확보했다.
- 각 패턴의 초기 기본 임계값과 낮은 표본 수의 표시 기준을 어떻게 조정할지. 초기 제안은 연구 문서에서 근거·판단을 구분한다.

위 질문은 초기 로컬 분석 구현을 막지 않는다. 공개 배포와 새로운 범위에는 결정이 선행되어야 한다.

## Bounded source-local summary (2026-10-01)

One validated stored source prefix may expose an internal, read-only summary: record inventory, same-stream/scope/evidence duration distributions, and verified final-response token components. The result preserves source revision and byte-prefix bounds, unknown versus observed zero, eligibility/exclusion counts, and parser limitations. It is not a complete session, history or time-window total. Unavailable, evidence-absent, state-limited or ambiguous sources have no metric values. Optional token aggregates are null unless every selected response has that component; contradictory duplicate responses are excluded as whole groups. Cross-source reconciliation, active/busy time, percentages, cost and report integration remain out of scope. The read-only stats slice below exposes this unchanged summary through an explicit source selection. No provider support is promoted. See [P5-SOURCE-SUMMARY](P5-SOURCE-SUMMARY.md).

## P5 read-only selected-source stats (2026-10-01)

Existing-store stats requires exactly one explicit --list-sources or --source <full-source-id>. It reads one stored prefix without collecting input logs, creating storage, changing permissions or migrating. List output is bounded to 64 IDs with explicit truncation. Selected metrics reuse the source-local summary with its suppression, scope, null/zero and unreconciled boundaries. No history/global totals or freshness check is claimed.

## Human selected-source stats tables (2026-10-01)

The selected-source human report presents exact stored inventory and evidence-labelled duration/usage tables. It preserves unknown versus observed zero and full source/session identities. Known recorded-duration sums rank only within one session/scope/evidence partition; unknown sums occupy a separate unranked bucket. Each bucket shows at most ten cohorts with truthful omission counts. JSON retains all cohorts and contributing IDs unchanged; source listing is unchanged. No new metrics, global totals, elapsed/busy time, percentages or savings are inferred. See [P5-HUMAN-STATS](P5-HUMAN-STATS.md).

## Bounded unchanged-source reuse (2026-10-01)

A repeated explicit-root scan may reuse an available stored source generation only after bounded whole-byte equality and unchanged interpretation limits/versions are established, then fresh store validation confirms the originally observed revision. Reuse reports an additive unchanged outcome and reused revision, preserving actual diagnostics, partial coverage and readiness boundaries. Changed sources reparse from zero under the original revision check. No raw bytes persist, and size/mtime or completed-line boundary alone never prove equality. The original [P4-UNCHANGED-SCAN](P4-UNCHANGED-SCAN.md) introduction used schema 4. Current read-only source commands require schema 5 under [P4-RELATIONSHIP-STORAGE](P4-RELATIONSHIP-STORAGE.md), rejecting older stores without migration; historical relationship absence requires one recapture before reuse.


## Source-local Slow Tool candidates (2026-10-01)

One validated stored source prefix may produce internal Slow Tool duration-concentration candidates for provenance-backed native call records. A compatible source/session/duration-scope/timing-evidence partition must have a known positive admitted duration denominator; a safe display cohort needs at least five timed calls and at least 20% of that denominator, including other admitted categories and small cohorts. Missing or contradictory timed-call provenance suppresses the whole compatible partition instead of inflating the share. Source suppression and null versus observed-zero remain explicit. Cards expose bounded evidence, direct versus observed measurement, a necessary-work counterexample, one investigative experiment and mandatory quality safeguards. MCP/browser labels remain coarse tool families. This is not proof of avoidable work, a latency cause, network/backend time, task elapsed, physical execution uniqueness, savings or population coverage. Slow Tool contributes no Detected Waste events. The original internal-rule slice did not activate CLI/report/public package functionality. The selected-source insights slice below now exposes this unchanged analysis through the CLI. Provider support expansion, report/public package activation and global aggregation remain separate gates. See [P5-SOURCE-SLOW-TOOL](P5-SOURCE-SLOW-TOOL.md).


## Read-only selected-source insights (2026-10-01)

`agentprof insights --source <full-source-id>` exposes the unchanged provenance-backed source-local Slow Tool analysis from one existing private current-schema DELETE-mode store. Exactly one full source selection is required; no period/list/input-root mode, scan, migration, storage creation or freshness check occurs. Human output retains every bounded partition and candidate with full safe identities, null/zero and partial/suppressed distinctions, compatible denominator and direct/observed evidence. Each candidate includes its necessary-work counterexample, one matched experiment and mandatory quality guardrail. JSON retains the full unchanged rule result and evidence IDs. Successful command execution does not imply diagnostic completeness. Report/global aggregation, waste/savings and empirical optimization claims remain out of scope. See [P5-SOURCE-INSIGHTS-CLI](P5-SOURCE-INSIGHTS-CLI.md).


## Confirmed source-local failure evidence (2026-10-01)

The opt-in `stats --source <full-id> --failures` view exposes provenance-backed native completed/failed counts per stored source/session. Status admission includes untimed failures; timing is independently eligible. Missing terminal provenance suppresses the compatible session denominator. Keep raw inventory, exclusions, null/zero and source limitations separate; no global failure rate, retry/error identity inference, waste or savings. Existing command result bytes remain unchanged without the flag; stats help adds the flag and its coverage warning. See [P5-SOURCE-FAILURES](P5-SOURCE-FAILURES.md).

The failure view human summary deterministically bounds displayed sessions/cohorts/measurements and long patterns, always reporting shown/total/omitted and pointing to complete JSON. It does not rank incomparable scopes; displayed compatible denominators/exclusions and quality safeguards remain intact. Exact caps and falsifiable output bounds are in the failure contract.

## Bounded relationship evidence storage (2026-10-02)

[P4-RELATIONSHIP-STORAGE](P4-RELATIONSHIP-STORAGE.md) preserves the current adapter's exposed keyed metadata and wrapper/message relationships atomically with each accepted source generation. Captured empty evidence, historical absence and explicit current-policy budget unavailability are distinct; none establishes a complete provider graph, canonical cross-source history or parser recovery. Relationship capture has a separate 4 MiB serialized row budget, preserving existing event/metric acceptance. Historical absence needs one byte-zero recapture before unchanged reuse; captured and deterministic budget-unavailable evidence can both reuse after normal byte/proof/generation validation. Existing CLI payloads remain unchanged and do not claim relationship completeness.

Authorized write-open migrates historical stores to schema 5 without inventing relationships; exact-current-schema read-only commands reject schema 4 without writes. Aggregation and parser resume readiness remain false. Acceptance evidence is recorded in the linked supplement, not inferred from prior PR verification.

## Source-local completed Read revisits (2026-10-02)

The opt-in `stats --source <full-id> --read-revisits` exposes the basic file-revisit metric for ordinary, provenance-backed completed Claude Read invocations in one stored source/session. Each unique normalized invocation event counts once, while different invocations of the same operation remain distinct. Group by existing project-scoped file identity: different ranges and necessary post-edit rereads still describe visits to the same observed path identity, not redundant content or waste. Different project contexts do not collapse, but this view does not reconstruct project partitions or merge sessions/sources.

For a nonempty admitted completed-Read set with every file identity present, show read count N, unique identities U and revisit ratio `(N-U)/N`. Missing identity makes the whole compatible session ratio unknown; failed/pending/unknown calls and unsupported Codex remain explicit. Untimed completed reads may count. There is no search-ratio support, content-equality proof, Context Churn diagnosis, API span, token/time attribution or savings claim. Bounds and null/zero distinguish this observed prefix from complete history. Existing command results retain their bytes without the flag; the new human view bounds displayed sessions/cohorts with explicit omissions while JSON preserves the full bounded result. The ordinary adapter/store/reopen positive passed before implementation. This internal CLI view is implemented and synthetically verified; empirical usefulness and real-provider/version coverage remain unverified. See [P5-SOURCE-READ-REVISITS](P5-SOURCE-READ-REVISITS.md) for execution receipts and publication boundaries.

## Observed source-local invocation interval union (2026-10-02)

The opt-in [invocation interval view](P5-SOURCE-INVOCATION-OVERLAP.md) reports session-local geometry of positioned ordinary Claude terminal invocations from one stored prefix. It preserves conservative provenance suppression and explicit partial coverage, with interval-length sum, union and excess; unknown remains null and observed zero remains zero. It makes no runtime, active-time, task-elapsed, waste or savings claim. The existing summary and reports remain unchanged, including `no_interval_aggregation`. Codex and cross-source/session union remain unsupported. This internal CLI view is implemented and synthetically verified; empirical usefulness and real-provider/version coverage remain unverified. Independent review and execution receipts are in the linked supplement; the Project item and PR own live publication status.

## Ordinary Claude checkpoint boundary (2026-10-02)

The [P4-CLAUDE-CHECKPOINT](P4-CLAUDE-CHECKPOINT.md) API preserves bounded ordinary single-source Claude adapter state across serialization without retaining raw transcript content. Exact source/key/version/semantic-limit binding, private replay/ordering/pending state and safe atomic rejection are required. Trusted fixture evidence is excluded. A checkpoint byte budget may make recovery unavailable while ordinary parsing continues unchanged.

This is an adapter contract, not scanner resume or durable database integration. Caller-provided offsets do not prove source bytes or LF boundaries; future scanner use requires independent source-prefix/generation validation and atomic checkpoint storage. Existing CLI behavior, coverage limitations and both false readiness flags remain unchanged. Bounded ordinary export and fresh-instance restore are implemented and synthetically verified. The linked contract records historical candidate checks and independent parent/runtime/installed-SDK receipts; the Project and PR own live publication status. This slice does not establish empirical provider coverage, performance or full P4 completion.

## Selected-source measured HTML report (bounded P6 slice)

The bounded `report --source FULL_ID --output NEW_HTML` contract is defined in [P6-SOURCE-REPORT.md](P6-SOURCE-REPORT.md). This slice is implemented and synthetically qualified; the linked contract records independent review, the macOS fixture correction and supported-runtime/installed receipts. Browser execution remains unverified, and PR/Project records own live publication status. It writes a new static offline HTML file from one pinned validated stored source generation without scanning, opening a browser, accessing source roots or computing global totals. Both flags are mandatory; `--last` and `--open` remain unsupported. Standalone `open` remains NOT_IMPLEMENTED. Earlier report/open placeholder statements describe the pre-slice state.

The first screen shows measured source-prefix coverage and limitations, followed by compatible duration tables/bars, eligible response-usage tables and unchanged SlowTool evidence cards with necessary-work and quality safeguards. Summary suppression and native-rule suppression/assessment/partition status remain distinct. Unknown, zero, overflow, unavailable and evaluated-empty are different states. Bounds and deterministic omissions never alter analyzer denominators. The byte prefix is not a date range or full history; no avoidable-work, savings or network-latency claim is made.

A stable trusted existing parent directory and a previously absent output are required. The report never overwrites a target. Publication is mode 0600 using supported same-directory no-replace hard-link semantics; every error after linking reports that the file was published, with durability and cleanup qualification. This does not promise defense against hostile ancestor replacement races. No JavaScript, external resources, raw data or hidden JSON is embedded. This slice does not complete all P5/P6/P7 scope or the planned full-product flow below.


## Ordinary Claude search lookup evidence (2026-10-02)

The reviewed [native search contract](P5-CLAUDE-SEARCH-EVIDENCE.md) makes opaque lookup identity available for ordinary directly recorded Claude Grep/Glob requests in a finite supported input subset. Exact query, project/root, tool, direct provider version, option values and omissions remain distinct; missing or unsupported evidence stays null. No raw request or result content is retained. Shell/MCP/custom/web searches and the documented default native Bash search path are excluded.

This is evidence for future analysis, not a repeated-search ratio, new diagnostic, complete-result claim, Detected Waste total or measured saving. Current Claude interpretation becomes parserVersion 2; historical version1 data stays read-only-compatible and an explicit scan replays an obsolete source once. Prior semantic checkpoints cannot resume under the changed parser. The linked contract records recovery, exact test hashes and executed versus pending verification; the narrow Project owns current status.

## Pinned development toolchain qualification (2026-10-02, PR #37)

Repository development uses mise with Node 24.21.0 and pnpm 10.33.0, a frozen pnpm lockfile, and explicitly disabled dependency-install scripts. Supported product runtimes remain Node >=24.15.0 on macOS/Linux. The CI matrix continues to exercise 24.15.0, 24.21.0 and 26.7.0, with a separate unsupported-runtime rejection check.

The distributed npm package retains its executable, runtime dependency pins, artifact allowlist and installation contract. Development-tool changes must preserve ordinary npm pack, npm exec and global installed CLI behavior without requiring mise or pnpm on the consumer machine. Qualification includes a clean frozen install, full checks, enabled packaging lifecycle, installed artifacts and unsupported-runtime behavior. This contract does not authorize package publication or complete the broader P7 pilot. [TOOLCHAIN](TOOLCHAIN.md) records the reviewed plan and actual evidence.

## Common pnpm version alignment (2026-10-02)

Following verified owner-authorized coordination across repositories, the current development pin advances from pnpm 10.33.0 to 10.34.6; Node stays 24.21.0. This supersedes only the earlier tool-version choice. Consumer Node >=24.15.0, the supported three-runtime CI matrix, unsupported-runtime rejection, npm distribution, frozen dependency resolutions and scripts-disabled installation retain the preceding toolchain contract. The original PR #37 execution record remains historical evidence. Qualify the new pin before publication; [TOOLCHAIN](TOOLCHAIN.md) records the follow-up plan and execution. Subsequent merge order is coordinated with the other repository review session.


## Ordinary Codex checkpoint boundary (2026-10-02)

The proposed [P4-CODEX-CHECKPOINT](P4-CODEX-CHECKPOINT.md) API preserves bounded ordinary single-source Codex adapter state across serialization without retaining raw transcripts. Recovery requires exact source/key/version/semantic-limit binding, private replay/pending/process/poll/source evidence, cumulative snapshot diagnostic history and safe atomic rejection. Native terminal response evidence, ambiguous origin, unknown values and non-additive cumulative scope remain unchanged. Trusted fixture evidence is excluded. Serialization budget can make recovery unavailable while parsing continues normally.

This is an adapter prerequisite, not scanner seek, source-prefix authentication or durable SQLite integration. Caller offsets do not prove bytes or LF boundaries; future integration must independently validate source generation/prefix and atomic stored contributions. Existing CLI behavior and false readiness flags remain unchanged. This section describes a draft contract; no implementation, execution or performance result is claimed.

Execution note (2026-10-02 UTC): the preceding paragraphs preserve the reviewed pre-implementation proposal. An isolated candidate now implements the additive API on main `063ee04b37e97616065254c9534f430bdc33e3c3`. Independent codec/schema review cleared after constructor-grounded repairs; typecheck and all 144 checkpoint cases passed. Local full-repository, packed/installed artifact and pristine-current-main byte-parity qualification also passed; final all-file review and exact-head hosted/runtime qualification remain separate gates. No scanner, database, report or readiness behavior changed.

Independent parent qualification boundary (2026-10-03): the existing ordinary Codex API must preserve uninterrupted versus restored continuation and bounded, atomic rejection on the supported macOS runtime, including authentic historical baseline and installed-package checks. Qualification against the current merged toolchain must preserve Claude parser v2, Codex parser v1, existing CLI behavior and all false readiness flags. Source-prefix/LF proof and durable Codex resume remain separate work; checkpoint integrity alone does not establish either.

Ordinary Codex checkpoint count-order correction (2026-10-03): a v1 checkpoint accepts only the six token-count fields in the order produced by ordinary parsing: `input`, `output`, `cachedInput`, `cacheWriteInput`, `reasoningOutput`, `total`. An authenticated payload with another count-field order is unsupported and rejects atomically as `invalid_checkpoint`, including count objects in usage, cumulative comparison history and safe usage observations. Normal exported checkpoints, nullable component values and normal replay semantics remain unchanged. This closes an accepted-state continuation mismatch; it is not an authentication-bypass or signer-secret-compromise claim.


## Native command breakdown in source reports (bounded P6 successor)

The planned source-report successor adds compatible native command/tool duration-share bars and bounded slowest single-call details to the existing stored-generation report. Every admitted group can appear, including one-off builds and groups below SlowTool diagnostic thresholds. The exact admission, denominator, omission and privacy contract is in [P6-COMMAND-BREAKDOWN](P6-COMMAND-BREAKDOWN.md). Shares compare recorded durations only within one admitted source/session/scope/evidence partition; they do not measure full worktime, API/network latency, interval occupancy, avoidable work or savings. Unknown and unavailable remain distinct from0. Existing summary, usage, analyzer semantics and safe output publication remain unchanged.

Implementation qualification (2026-10-02): the bounded successor is implemented and synthetically qualified, including the one-call build share and compatible slowest-call detail. The linked contract preserves exact passed/failed/skipped receipts and all unknown/coverage limits. API/network and complete-session worktime shares remain unavailable. Browser execution, real-user coverage and broad P6 acceptance remain unverified; publication and hosted CI are separate gates.

Independent parent PR39 qualification boundary (2026-10-03): review and integrate the published native command-report successor while preserving current main's pnpm 10.34.6, Claude2/Codex1 and ordinary Codex checkpoint contracts. Verify compatible recorded-duration denominators, one-call below-threshold visibility, truthful zero/unavailable/display omissions and bounded safe HTML. Qualify synthetic macOS/actual installed outputs and available browser behavior before authorized merge. Broad P6 acceptance remains separate; no automatic collection/open/local dashboard server or real-user-log pilot is added.


## Bounded ordinary Claude durable resume

The reviewed [ordinary Claude durable-resume contract](P4-CLAUDE-RESUME.md) supersedes earlier full-replay-only statements only for compatible ordinary Claude source generations. After verifying authenticated bounded state and every previously observed byte including unfinished tails, repeated scans may skip ingestion of the completed prefix and continue at its verified LF boundary. The complete public snapshot, proof, checkpoint and revision remain atomic, with original-generation concurrency checks on every continuation or replay path. Valid incompatibility or stable changed bytes requires full replay; authenticated corruption and observed I/O instability fail without replacing evidence. Optional checkpoint absence remains supported. Changed Codex sources retain full replay. Both public readiness flags remain false, public outputs are unchanged, and no performance, savings or broad P4 completion is claimed. Schema 6 requires an authorized write-open migration before exact-current read-only commands can read an older store.

Local qualification (2026-10-02): the bounded behavior above passed the reviewed synthetic persistence, original-generation race, every-LF continuation, same-read byte-proof and five actual crash/restart gates on Linux. Public CLI/read-only and installed-artifact parity passed within the recorded limits. See [executed verification](P4-CLAUDE-RESUME.md#executed-implementation-verification--2026-10-02t1313z) for exact counts, the two historical-help cases not run, and pending independent-provider integration/remote-CI/macOS gates. Both readiness flags remain false.


### Ordinary Claude search durable-upgrade qualification

The existing durable contract also requires an authentic parser-v1 generation to replay once under parser v2, then preserve native search lookup evidence through unchanged reopen and suffix continuation. Corrupt old state and stale original revisions remain hard rejection boundaries. [The integration supplement](P4-CLAUDE-SEARCH-RESUME.md) defines synthetic qualification; public readiness, coverage and performance claims do not change.

The combined ordinary Claude path is now locally qualified on the pinned main106d6c toolchain: authentic old-generation upgrade, unchanged reopen, two suffix continuations, corrupted-state rejection, original-CAS races and strict read-only schema compatibility passed. [Execution receipts](P4-CLAUDE-SEARCH-RESUME.md#integrated-toolchain-and-complete-local-qualification--2026-10-02t1531z) retain optional-test and runtime limits; this does not establish broad provider coverage or measured savings.

Independent parent PR40 qualification boundary (2026-10-03): review and integrate the published bounded ordinary Claude schema6 resume/search-upgrade slice while preserving current mainb0198c45e8ceab3ba85e3ac0ea3f621be965d7e0, pnpm10.34.6, Claude2/Codex1 admission, ordinary Codex checkpoint validation and source-report v2. Verify authenticated generation/projection/proof linkage, original predecessor/revision checks, one-descriptor complete-old-byte/LF verification, suffix behavior and fail-closed corruption/races/crash recovery. Schema5 read-only rejection and explicit write-open migration remain intentional; qualify authentic retained historical binaries and separate synthetic store copies without silently migrating actual data or weakening parser-version/output assertions. Perform pinned macOS/all available optional/current-installed/artifact qualification and exact final hosted/merge/main checks before narrow completion. Codex changed sources remain full replay, optional Claude checkpoint absence remains valid, both public readiness flags remain false, and broad P4/provider/performance acceptance stays separate.


Independent parent current-main qualification (2026-10-03) now verifies the bounded ordinary Claude durable-resume/search-upgrade slice on macOS Node24.21.0/pnpm10.34.6: all 1,870 tests without skips, authentic old-version/copy-migration controls, five intended crash placements and isolated installed continuation passed. The [complete parent receipts and limits](P4-CLAUDE-RESUME.md#independent-parent-composed-head-qualification-2026-10-03) preserve author history and the pending hosted/merge/main gate. Both public readiness flags, changed-Codex full replay and separate broad provider/performance acceptance remain unchanged.


## Completed native search recurrence (2026-10-02)

Add opt-in `stats --source ID --search-recurrence` per [the reviewed contract](P5-SOURCE-SEARCH-RECURRENCE.md). One stored source-prefix generation yields session-local completed ordinary Claude parser2 Grep/Glob request recurrence. N counts admitted unique invocation IDs, U exact opaque request identities, repeats=N-U, ratio=(N-U)/N. Missing lookup identity makes the whole partition unknown; zero eligible calls are unknown, whereas a nonempty distinct population has measured zero repeats. Historical Claude parser1 stays readable but unsupported for this metric. Inherited provenance suppression remains authoritative. Output contains snapshot-local aliases and safe proof IDs only, with no raw query/key, equivalent-results, waste or savings inference.


## PR #41 current-main review contract (2026-10-03)

Review the completed native search recurrence feature on source `c655f7c56b4961b0b4152527d9dc02b311e69ad2` before merging it into current main. Preserve its session-local N/U/repeats/ratio, authoritative whole-session provenance suppression, whole-partition unknown on missing lookup identity, parser1 unsupported status, truthful output caps and safe proof references. Integrate current main's already reviewed count-field validation, source command breakdown and durable Claude checkpoint generation behavior without widening this metric's scope or readiness flags. Existing author evidence remains historical; old-base passes do not qualify the composed tree.

A separate research contributor must inspect all 17 original paths, current-main interactions and historical/installed parity inputs, then append grounded findings before the implementation admission plan. The parent owns shared-document composition, review, packaging/installed qualification, exact-head CI and publication. Any production or test correction requires a preceding plan amendment and a separately registered development contributor. Complete only this narrow Project draft after an actual reviewed merge; broader P5/P6 scope remains separate. No real logs, npm release, user-store migration or persistent service changes are part of this review.


## Standalone explicit local report opening (bounded P6 slice)

[The standalone opener contract](P6-SAFE-OPEN.md) permits exactly one explicitly trusted existing local HTML file on macOS/Linux. It validates and canonicalizes a readable regular file, then requests the fixed OS helper with one literal absolute argument. Success means helper acknowledgement only, with browserVerified:false; a five-second timeout may occur after opening and never kills or retries the helper. No scan, store/key reads, report generation, report --open, telemetry or browser-rendering claim. Selected HTML may execute scripts/contact remote resources and native opening may create history. Only after recorded verification does this bounded slice supersede the earlier capability snapshot’s open NOT_IMPLEMENTED statement. Historical receipts and the incomplete wider report --open first-user-flow acceptance remain intact.


## PR #42 current-main review contract (2026-10-03)

Review source `56a9af5e20d436cf9160adccb0eba7e6759896f5` against current main `65f02fb086bb175a4ef5b9f5efb1b969809bc61f`. Preserve explicit trusted local HTML selection, pathname/regular-readable-file metadata validation, a canonical single argv to the fixed platform helper, shell-disabled ignored stdio, one monotonic five-second acknowledgement deadline, no retry/kill, fixed raw-free diagnostics and browserVerified:false. It does not generate reports, scan inputs or access/migrate stored user data. Native browser/desktop rendering acceptance is separate from controlled process/helper tests.

Separate post-SPEC research must review all11 original paths and current-main interactions, including exact intentional open/top-level help changes against all inherited genuine-baseline suites. Preserve merged search recurrence, durable checkpoint generations, report behavior, numeric schema assertions, toolchain and author history. If those preserved suites need narrowly specified help-compatibility integration, amend the plan/reservation before a separately registered developer changes tests; do not weaken unrelated parity. The parent owns shared-doc integration, review, qualification and publication. Complete only the narrow opener draft after verified merge/main CI; broad P6 ownership and acceptance remain separate.

The intended help exception is limited to the replaced top-level `open` row and the complete standalone `open <file>` help text. Unchanged command help/version, all source-provider scan and stats outputs, recurrence's exact additive stats-help removals, numeric schema matrices and stored-data invariants must retain their existing comparisons. The three inherited CLI parity suites may replace the obsolete pending-opener equality with an exact expected new help assertion and a narrowly frozen old-to-new top-level row comparison; no broad textual normalization or helper masquerading as a historical binary is permitted. Current-source installed/Linux controlled-process qualification must use the genuine enabled-prepack tarball and unchanged frozen process tests. Platform skips, optional baseline skips and separately executed supplements remain distinct evidence; actual native desktop/browser rendering is not inferred.

## P6 observed invocation timeline — bounded source-prefix slice

The [observed invocation timeline contract](P6-INVOCATION-TIMELINE.md) adds a session-local view of admitted Claude invocation boundaries to the selected-source offline report. Native S (interval-length sum), U (interval union), multiplicity-weighted excess and positioned/admitted/excluded boundary counts remain distinct from drawing availability and display truncation. The exact relative-millisecond table is authoritative; static numeric SVG is a visual companion. Unknown gaps remain unattributed. No task elapsed time, tool runtime, API latency, Active Time, causal waste or savings is inferred.

The source-level native assessment/suppression notice exists even when no session is selected. Codex remains unsupported; absent evidence retains native precedence. All native metrics and the full axis precede the deterministic six-session/twenty-invocation display bounds, including timeline-only sessions. Unsafe enclosing-axis arithmetic omits geometry while preserving qualified metrics. Internal owned HTML model v3 changes no stats/insights JSON, parser, storage or public package contract. Production acceptance, installed/runtime and browser qualification are separate gates recorded in the linked contract.

## PR #44 current-main review contract (2026-10-03)

Review the nineteen-path timeline delta at `5277222c3a915ddb440d57eb26212ac4d3a2012d`, originally stacked on merged report prerequisite `5580df688e7f18cb10be7f1e087c271c69b449d6`, against actual current main `bf341bae4dd76d3fe01963938f10e25b875c17d8`. Keep one pinned stored source generation and one unchanged overlap-analysis call, contributing-membership-only relative geometry, original native assessment/coverage/S/U/excess, strict immutable owned model v3 and full metrics/axis before the six-session/twenty-row display limits. Unknown geometry and unsupported providers retain explicit native/display states; no task elapsed time, wall-time share, API/active time, critical path, waste or savings is inferred.

Immediately continue separate post-SPEC research over all nineteen original paths and current-main report/storage/metric interactions. Preserve merged command-breakdown accessibility, recurrence, checkpoint generations, standalone opening and exact help compatibility. The parent owns current-main/stack composition, shared-document prefixes/history, qualification and publication. Any code/test correction requires preceding plan and Project reservation amendment with a separately registered developer; no inherited numeric or privacy oracle is weakened. Retarget the existing draft to main after dependency ancestry is verified, then qualify the new combined head. Synthetic browser inspection of relative SVG, exact tables, narrow layouts and keyboard access is distinct from screen-reader, print, real-user coverage or broad P6 acceptance. Complete only the narrow timeline draft after verified merge/main CI.

### PR #44 responsive-resolution amendment (2026-10-03)

Browser reproduction confirms that a positive interval with normalized SVG width2 can occupy only0.633972 CSSpx at a375px viewport while the original conditional scale guidance is absent. Available charts containing positive displayed intervals must provide static responsive-resolution guidance at any viewport. Explain that scaling can make small positive intervals hard to resolve and that the exact millisecond table remains authoritative. This is a general limitation, not runtime pixel detection. Preserve exact native S/U/excess, full axis, row coordinates/widths, zero/failure/unknown states, caps and script-free privacy/CSP contracts. Do not widen positive bars or add viewport-dependent JavaScript.


## Source-prefix token-evidence panel (2026-10-02)

The source-prefix report shows an always-visible Token evidence panel with exact stored/selected/duplicate/excluded evidence-row counts, pre-display-cap eligible observed responses, and source-wide exclusion reasons. Empty, unavailable, suppressed, all-excluded and eligible evidence remain distinct. The graphic describes row disposition, never token-population coverage. See [P6-TOKEN-EVIDENCE](P6-TOKEN-EVIDENCE.md).

## PR #45 independent current-main review contract (2026-10-03)

Review the eleven-path token-evidence feature at `8d32f8280bd77342ed1fb338a27122bc3017c0bb` against actual main `8e3118155038a04adcf08f97113186af4243bc2d`. Preserve the uncapped source-wide stored/selected/duplicate/excluded record counts, eligible observed response count, complete thirteen-reason inventory, separate conflicting-response-group diagnostic and exact numeric geometry. These proportions describe evidence records; they do not establish token-population coverage, uniquely lost responses, ordinary Claude finality, waste or savings. Preserve source-unavailable/absent/suppressed/empty/all-excluded/eligible state precedence, unknown versus observed zero, compatible cohort component semantics and the authoritative exact table.

Immediately continue separate post-SPEC research over all eleven original paths and current-main interactions. Preserve the upstream responsive timeline guidance, static CSP/privacy, 1 MiB ceiling, safe output publication, unchanged CLI/store/analyzers and genuine historical/installed parity. The parent owns shared-document composition, review, qualification and repository publication. Any code/test correction requires a preceding plan and Project reservation amendment and a separately registered developer. Qualify synthetic browser light/dark/narrow/desktop/keyboard/offline/runtime-CSP behavior separately from string tests; print, screen-reader, real-user coverage and broad P6 acceptance remain distinct. Complete only this narrow draft after actual reviewed merge and main CI. No npm release, real-user store migration, log upload or persistent service change is part of the review.


## Ordinary Codex durable-source continuation (2026-10-02)

Ordinary Codex sources may capture optional bounded durable state and continue from a committed complete-LF boundary after exact previous-byte and generation authentication. Restored public evidence, metadata and wrappers must equal cold replay. Export-unavailable remains an accepted source. Incompatible valid interpretations replay with original CAS; corruption is a hard failure. Both readiness flags remain false. See [P4-CODEX-RESUME](P4-CODEX-RESUME.md).

## PR #46 current-main review contract (2026-10-03)

Review the nineteen-path ordinary-Codex durable-source delta at `b91c18ecc08a2876749ea027160a892f67990573`, selected from main `8e3118155038a04adcf08f97113186af4243bc2d`, against actual main `bcc43062db6fc85ceba005208e9d0963ec40237f`. Accepted sources may retain bounded optional private continuation state; complete-LF continuation must authenticate all previously observed bytes and the original stored generation. Public events, turns, usage, observations, diagnostics, capabilities, metadata and wrappers must equal cold replay. Preserve existing Claude domains and behavior, provider-specific isolation, corruption-before-fallback precedence, atomic generation CAS and accepted capture-unavailable semantics. Both readiness flags remain false. No performance, user-log or broad P4 acceptance is inferred.

Immediately continue separate post-SPEC research over all nineteen original paths and current-main parser, storage, scan, report and CI interactions. Preserve merged token evidence, invocation geometry, recurrence, checkpoint codec corrections, numeric/schema/help/privacy oracles and every unowned byte/mode. Historical qualification must use genuine immutable schema5 source `5614a3107b53022f29ea32d44ba83f533fd58b92` and tree `c1361a2fea2386ced7c30f88da82ce421017dca6`; a current or relabelled runtime is not a historical seed. The parent owns shared-document composition, verification and authorized publication. Any source or test correction requires a prior plan and Project reservation amendment plus a separately registered developer. Complete only this narrow Project draft after verified merge and main CI; preserve original authorship and dated qualification history.

## Explicit stored-source report opening

The opt-in [stored-source report opening contract](P6-REPORT-OPEN.md) adds `report --source FULL_ID --output NEW.html --open`. It requests the unchanged native opener only after completed, target-verified publication. All publication fields and warnings survive opener acceptance, failure or timeout; browser rendering remains unverified. Default report behavior is unchanged. Earlier no-`--open` statements describe their historical slice. No implicit scan, freshness claim or broad fresh-input-to-report acceptance is introduced.


## PR #47 parent review contract (2026-10-03)

Review the published eleven-path stored-source report/open feature at `6b317bc0c84bdd759c9ddfc4ec44c493013beda4`, selected from `8e3118155038a04adcf08f97113186af4243bc2d`, against actual merged main `3b5d270e97107fa1b6690008d7cc4732f15ce448`. Preserve all merged token-report and Codex durable-source behavior, public readiness flags, current diagnostics, offline privacy/CSP, exact non-opt-in report results and unchanged standalone opener semantics. The opt-in request must follow one completed publication, require a verified target and retain every publication field on skipped/failed/timed-out opening. Native browser rendering and freshness remain unverified.

Immediately continue separate post-SPEC research across every original path, including excluded documentation/tests. Review pre-I/O argument rejection, validation precedence, publication/open ordering, every warning state, safe postpublication error boundaries, literal path argv, timeout/no-retry semantics, immutable receipt/HTML/store evidence and genuine baseline identity. Inventory historical compatibility oracles and intentional command-help additions without weakening unrelated help, numeric or rejection assertions. No correction is admitted yet; any needed amendment precedes a separately registered developer. Parent owns append-only planning/evidence composition, full current-main preservation and existing-branch publication. The Project-only narrow review can complete only after final-source qualification, expected-head merge, clean main synchronization and actual main CI; broad P6/fresh-input/design/pilot gates remain separate.


### PR #47 exact-help witness amendment

Independent review identified three inherited genuine-baseline help witnesses still spelling the now-obsolete standalone help phrase `URLs or report --open`: `tests/cli-read-revisits.test.ts`, `tests/cli-invocation-overlap.test.ts` and `tests/cli-search-recurrence.test.ts`. The new opt-in behavior intentionally removes only `or report --open` from the current standalone command's help. Amend only that current-help expected line in each witness to `No scan, report generation, latest-file search or URLs. Global data/root options are validated but inert.` Keep historical pending-help expectations, complete stdout/stderr/status comparisons, exact top/stats/scan/insights/version bytes, numeric semantics and privacy/no-I/O assertions unchanged. Do not add a broad normalizer or weaken genuine historical comparisons. These three paths extend the original eleven-path review ceiling to fourteen; no product correction is needed or admitted. A separate developer must show the original help witnesses fail for this exact difference, then pass with the same genuine b8/388/e199 runtime modules after the three-line amendment. Preserve failures as actual test-receipt evidence; full qualification and final-head CI follow the corrected freeze.

## Fresh single-file report local successor proposal (2026-10-02)

The separately owned fresh-report proposal is [P6-FRESH-INPUT-REPORT](P6-FRESH-INPUT-REPORT.md). It preserves stored-only behavior and requires an exact scan generation, partial-evidence warning receipts and cooperative cancellation. This appended local section does not replace shared PR40 documentation. Implementation verification is pending; publication, supported-runtime and real-browser acceptance remain unclaimed.


## PR48 independent review of explicit single-file report (2026-10-03)

The published explicit-input successor is reviewed against merged main85b27df, retaining complete token-evidence, authenticated Codex-source continuation and verified stored-report opening. Exactly one explicit provider/file pair selects the committed or reused generation from this invocation; contradictory, failed, stale, truncated or aborted collection never substitutes previously stored data. Partial evidence preserves diagnostics and unknowns with exit1. Reports use the exact selected revision in their pinned read: replacement before capture prevents publication; a later writer does not change the already captured model. Cooperative SIGINT preserves completed HTML and any already-started opener outcome with exit130, without retry or rollback. Stored-source defaults retain their published behavior.

Review every original16-path delta, every inherited compatibility/assertion witness and the complete actual-main composition. Any newly established correction requires a prior specification/implementation/Project scope amendment and a separately named developer. Runtime/package/genuine historical, installed CLI cancellation and current-head/main-CI evidence remain required; historical author passes do not qualify a changed composition. Stable caller-controlled input/output parents remain a precondition. Preflight/reopen path substitution, native GUI/browser acceptance, broad P6/provider readiness and performance are separate from this bounded review.

### Admitted PR48 presentation-witness correction

Separate all16-path research established two P2 compatibility failures against released main85b; no production correction is admitted. Expand the review ceiling to17 paths by adding only the existing `tests/cli-search-recurrence.test.ts` witness. Within its complete genuine e199 top-help comparison, require the old report row exactly once/new row absent in historical stdout and the new report row exactly once/old row absent in candidate stdout. Compare complete help after only the existing exact trusted-open-row replacement and the exact new-report-row to old-report-row replacement; no broad normalization. Confirm Commander15's actual emitted wrapping during RED before GREEN.

Within original `tests/fresh-precode-controls.test.ts`, replace only the historical usage-notice presentation assertion with the exact released-main notice twice and historical notice absent. Preserve the same synthetic fixture, hard-coded duration/usage cells, two pending durations null, reasoning null, provisional exclusion, zero admitted usage, summary usage null, privacy sentinels and unchanged DB/key bytes/modes. No metric/parser/renderer/model or fixture input changes. A separately registered developer must reproduce the identical two witnesses RED then GREEN after saved Project admission and actual-main composition. All other source/tests/assertions, three PR47 opener-help amendments and historical baseline bytes/modes remain exact.

### PR48 macOS orchestration-fixture review amendment

The first frozen full check exposed27 workflow-test failures in one original-owned file: its intended ordinary temporary JSONL path crosses macOS's `/var` symlink, so the production no-symlink preflight rejects it before the mocked later phases. Keep that product validation and every rejection/cancellation/listener/receipt assertion unchanged. Research the bounded fixture setup correction that creates the ordinary private test root beneath the canonical real temporary directory. No new product/runtime scope or softened path policy is admitted. Separate research, implementation-plan/Project amendment and separately registered developer precede any fixture change. The first failed full check remains retained evidence; its passing cases do not qualify the changed freeze.

## Repository issue tracking transition (2026-10-03)

The owner's new instruction makes repository GitHub Issues the source of truth for active work, ownership, dependencies, execution checklists and concrete Verify entries. This supersedes the previous Project-only rule. Maintained planning documents retain product contracts and verification evidence; `docs/TODO.md` remains navigation and operating rules, without a second live checklist.

Move every unfinished Project item to exactly one open repository issue. Reuse the corresponding historical issue when it represents the same scope; create an issue only when no counterpart exists. Preserve current plans, unchecked acceptance gates, original history, known owner/session/contributor identities, dependencies, linked PRs and milestones. An active claim stays with its existing owner during migration. Completed items stay historical and are not reopened as new work. Long histories may use linked archival issue comments when one body cannot hold the original text; no content is silently truncated or declared completed by migration.

Update current entry points and agent instructions for issue claims and completion. A work issue closes as completed only after its Verify gates pass and its code/documentation PR merges. Migration closure is separate from broader P4/P5/P6 acceptance. Close the AgentProf Project after every unfinished item has a verified issue mapping and the replacement workflow is published. Retain the closed Project and its historical contents. Do not delete it or change product behavior, source code, tests, package releases or local services as part of this transition.

## CI optimization review contract (2026-10-03, PR #52)

Keep full qualification for every PR source update and every push to `main`, while removing the duplicate push workflow on PR branches. A newer run of the same PR may cancel its older run. Separate PRs and distinct `main` pushes must not cancel each other's running or pending qualification. Supported jobs are bounded to 15 minutes and the unsupported-runtime guard to 5 minutes.

Retain the Node 24.15.0 / 24.21.0 / 26.7.0 matrix, Node 22.16.0 rejection, immutable schema5 seed, artifact verifier, read-only token and SHA-pinned actions. The review admits only the concurrency correction and dated planning/evidence additions. Product behavior, tests, dependencies, runtime support and releases remain outside this change. Separate research confirms GitHub's pending-run semantics before the implementation plan and developer handoff; final-source and merged-main CI are separate verification gates.
