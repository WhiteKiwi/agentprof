# AgentProf Architecture

상태: P0 계약 검토와 P1 실행 기반 검증 완료. [SPEC.md](SPEC.md), [METRICS.md](METRICS.md), [FINDINGS.md](FINDINGS.md)를 반영한다. 파서·집계·이벤트/checkpoint 저장·리포트는 후속 단계이며, 단계별 접근은 [IMPLEMENTATION.md](IMPLEMENTATION.md)에 있다.

## 데이터 흐름

```text
Read-only JSONL
  → Streaming reader / source diagnostics
  → Provider adapter / pairing / deduplication
  → Privacy allowlist / safe patterns + keyed operation/lookup/error identities / raw discard
  → Normalized events + source checkpoints in SQLite
  → Shared metrics / deterministic diagnostics / overlap accounting
  → CLI stats + insights + self-contained offline HTML
```

파서는 네트워크 호출이나 소스 파일 수정을 하지 않는다. CLI와 HTML은 같은 집계 결과를 소비한다. UI가 별도 계산으로 수치를 바꾸지 않는다.

집계 결과는 schema version·기간·필터·수집 시각·coverage를 가진 분석 snapshot이다. 정적 리포트 생성은 snapshot을 소비하는 출력 계층이다. 후속 실시간 로컬 대시보드도 같은 결과를 소비할 수 있도록 이 경계를 유지한다. v0.1은 대시보드·HTTP 서버·watcher·실시간 polling을 구현하지 않는다.

## 기술 선택

| 영역 | 초기 선택 | 이유·확인할 조건 |
| --- | --- | --- |
| 언어·런타임 | TypeScript, Node.js >=24.15.0 | JSONL 처리와 리포트 개발을 한 저장소에서 수행. 최소 패치·지원 런타임은 P1에서 검증 |
| CLI | Commander | 작은 명령 표면과 일관된 도움말 |
| 저장 | SQLite + `node:sqlite`, SQL 마이그레이션 | 외부 SQLite addon 없이 npx·전역 설치. RC API 상태를 명시하고 트랜잭션·설치 검증 |
| 리포트 | React, Vite, SVG | 타임라인·필터를 구현하고 자산을 단일 HTML에 포함 |
| 검증 | Vitest, Playwright | 합성 fixture의 기대값, 파일로 여는 리포트와 네트워크 요청 검증 |

ORM, DuckDB, 차트 라이브러리, Rust 전환은 필요가 확인될 때 추가한다. 초기 설치 채널은 npm의 npx·전역 설치이며 Homebrew는 후속 채널이다. Node CLI도 Homebrew로 배포 가능하므로 언어 선택과 설치 채널을 분리한다.

`node:sqlite`는 Node.js 24.15.0부터 Release candidate이며 Stable API로 표현하지 않는다. P1에서 사용하는 최소 API와 packed artifact를 검증한다. 필요한 동작에 문제가 확인되면 구현 전에 계획을 갱신하고 `better-sqlite3`를 검토한다. 최신 v13의 npm 포함 prebuilt·N-API 개선은 구버전 설치 방식과 구분한다. 날짜·버전·공식 근거는 [FINDINGS.md](FINDINGS.md)에 유지한다.

## 정규화 계약

모든 시간은 UTC로 저장하고 화면의 타임존을 별도로 적용한다. 종료·시간·성공 여부를 모르면 `null`로 남긴다. `0`이나 성공으로 보정하지 않는다.

```ts
type TimingEvidence = "source_reported" | "paired_timestamps" | "estimated" | "unknown";

type NormalizedEvent = {
  id: string;                 // 공급자 + 고유 thread/stream + source item identity
  sessionId: string;          // 논리 그룹 ID와 고유 thread ID를 분리
  turnId: string | null;
  parentEventId: string | null;
  kind: "model" | "shell" | "file_read" | "file_write" | "file_edit"
    | "search" | "mcp" | "browser" | "skill" | "subagent" | "other";
  category: string;
  toolName: string | null;
  commandPattern: string | null; // allowlist로 만든 안전한 패턴
  operationKey: string | null;   // 대상·중요 플래그를 구분하는 로컬 fingerprint
  startAt: string | null;
  endAt: string | null;
  intervalTimingEvidence: TimingEvidence;
  intervalScope: "invocation_latency" | "process_runtime" | "item_lifecycle" | "unknown";
  durationMs: number | null;
  timingEvidence: TimingEvidence;
  durationScope: "invocation_latency" | "process_runtime" | "item_lifecycle" | "unknown";
  status: "completed" | "failed" | "cancelled" | "pending" | "unknown";
  exitCode: number | null;
  errorFingerprint: string | null;
  sourceRef: { fileId: string; byteOffset: number; recordType: string };
};
```

이 모델은 허용 필드를 명시한다. 원문 `metadata: Record<string, unknown>`를 그대로 DB에 넣지 않는다. 스키마·파서 버전, 소스 버전, ID 별칭과 진단은 별도 필드·테이블에 둔다. lookup의 파일·범위·내용 식별자와 validation scope도 원문 없는 허용된 정규화 필드로 관리한다.

P1에서 commandPattern·operationKey·lookup/content/error fingerprint의 허용 필드·null·키 버전 계약을 정한다. P2/P3의 파서 정규화 단계에서 필요한 원문이 메모리에 있을 때 비실행 방식으로 안전한 패턴과 식별자를 생성한 뒤 원문을 폐기한다. P4는 이 결과와 normalization/key version을 저장하고 P5는 소비만 한다. 원문 폐기 후 P5에서 대상을 복원하거나 fingerprint를 새로 만들지 않는다. 필수 정보가 없으면 null과 unsupported 이유를 남긴다. 키·정규화 버전이 다르면 동일성 비교를 하지 않으며, 재처리에 필요한 로컬 원본이 없으면 비교 불가로 남긴다.

소스의 직접 duration과 시작·종료 시각은 모두 검증한다. `durationScope`·`timingEvidence`는 duration 값의 의미이고, `intervalScope`·`intervalTimingEvidence`는 배치 가능한 경계 구간의 의미다. 프로세스 runtime과 항목 lifecycle은 서로 다른 scope로 함께 보존할 수 있으며 `durationMs = endAt - startAt`를 강제하지 않는다. 같은 scope의 근거가 충돌하면 원문 없는 진단을 남기고 공급자 계약으로 선택한다. duration만 있고 배치할 구간이 없으면 호출 합계에는 포함할 수 있지만 구간 합집합에는 넣지 않는다. lifecycle 구간을 process runtime 구간으로 역산하거나 재명명하지 않는다.

## 시간 회계

| 지표 | 정의 |
| --- | --- |
| `observedSpanMs` | 첫 유효 관측부터 마지막 유효 관측까지의 범위. 에이전트 작업 시간과 같지 않다 |
| `observedTurnMs` | 유효한 턴 경계로 구성한 구간의 합집합. 화면의 Active Time은 관측된 턴 경과 시간임을 표시 |
| `toolDurationSumMs` | 같은 시간 의미의 정규화 도구 호출 시간 합. 병렬 호출로 경과 시간보다 클 수 있으며 wrapper의 중복 표현은 제외 |
| `toolBusyMs` | 배치 가능한 도구 구간의 합집합. 중복과 병렬 겹침을 한 번만 센다 |
| `unclassifiedMs` | 선택한 관측 범위 중 유효한 분류 근거가 없는 구간 |
| `durationCoverage` | 전체 호출 수 대비 시간 값이 있는 호출 수. 측정·추정 표본을 각각 표시 |

예를 들어 10초짜리 도구 두 개가 5초 겹치면 호출 합계는 20초, 도구 구간 합집합은 15초다. 도구별 합계를 세션 시간 비율로 바꾸어 100% 파이 차트에 넣지 않는다.

카테고리별 경과 시간 차트는 겹치지 않는 구간으로 분해한다. 여러 카테고리가 함께 실행된 구간은 `concurrent`로 표시한다. 도구가 관측된 모델 구간과 겹치면 도구 또는 `concurrent`로 분리하며, 모델 시간은 명시적 근거가 있는 단독 구간만 표시한다. 나머지는 `unclassified`다.

로그 사이의 긴 공백을 모델 사고·사용자 대기·절감 가능한 시간으로 단정하지 않는다. 재개한 장기 세션의 전체 범위를 작업 시간으로 쓰지 않는다. 진행 중 세션의 끝을 현재 시각으로 늘리지 않는다.

근거별 통계는 분리한다. p50·p95는 정렬된 유효 표본의 nearest-rank 방식으로 정의하고 `n`을 표시한다. 기간 경계에 걸친 시간은 구간을 잘라 집계하고, 호출 수는 시작 시각 기준으로 집계한다. 추이는 타임존과 집계 기준을 함께 저장·표시한다.

## 호출 연결과 중복 제거

- Codex의 `item_completed`에 구조화된 명령·MCP 정보가 있으면 그것을 우선 사용한다. 동일 작업의 `response_item`을 추가 호출로 세지 않는다.
- Codex의 `namespace`와 `name`을 함께 해석한다. 코드 모드 wrapper와 내부의 구조화된 작업을 관계로 연결할 근거가 없으면 억지로 연결하지 않는다.
- Claude의 `tool_use.id`와 `tool_result.tool_use_id`를 연결한다. `parentUuid`, `agentId`, sidechain과 동일 메시지의 중복 저장을 고려한다.
- 호출과 결과가 다른 스캔에서 발견되어도 같은 pending 이벤트를 갱신한다. 누락 결과·취소·백그라운드 실행·폴링은 별도 상태다.
- 프로세스 시작 호출·폴링 시간·프로세스 실행 시간을 구분한다. 폴링 응답의 누적 시간을 다시 더하지 않는다.
- fork의 복사된 과거와 서브에이전트의 자체 실행을 분리한다. 명시적 원본 ID가 있을 때만 중복을 제거하고, 관계가 불명확하면 그룹 통계 커버리지를 낮춘다.
- 토큰은 가능한 경우 고유 응답 ID 기준으로 한 번만 센다. 누적 스냅샷을 반복 합산하지 않으며, 서로 다른 사용량 소스를 더하지 않는다. v0.1 핵심 시간 집계 이후 검증된 토큰만 보조 표시한다.

## 저장과 증분 스캔

초기 테이블은 `source_files`, `sessions`, `turns`, `events`, `diagnostics`, `command_groups`, `insights`, `settings`다. 추이의 원본은 정규화 이벤트다. 사전 집계 테이블은 실제 조회 비용을 확인한 뒤 추가한다.

`source_files`는 파일 식별, 현재 경로, 크기·mtime, 마지막 처리한 완전한 줄의 바이트 offset, 경계 검증 digest, 파서 버전을 기록한다. mtime·크기만으로 변경을 판단하지 않는다.

1. 새 파일은 스트리밍으로 읽고 이벤트와 checkpoint를 같은 트랜잭션으로 저장한다.
2. append는 마지막 완전한 줄 다음부터 읽는다. 잘린 UTF-8·JSON 끝줄은 다음 스캔으로 미룬다.
3. 교체·truncate·경계 불일치·파서 변경이면 해당 소스를 다시 해석해 기존 기여분을 원자적으로 교체한다.
4. 파일 이동·아카이브·복사에서도 논리 이벤트 ID를 유지해 이중 수집하지 않는다.
5. 삭제된 입력은 원본 접근 불가로 표시한다. 저장된 과거 집계를 자동 삭제하지 않는다.

기본 입력은 `~/.claude/projects`와 `~/.codex/sessions`다. Codex 아카이브와 사용자 지정 root를 명시적으로 다룬다. Claude의 `CLAUDE_CONFIG_DIR` 설정도 확인한다. 심볼릭 링크를 통한 root 밖 탐색은 기본 허용하지 않는다. 압축 로그는 지원 여부를 진단하고, 미지원 형식을 조용히 누락시키지 않는다.

## 명령·실패·인사이트

명령을 실행하지 않는 파서로 프로그램·서브명령·의미 있는 플래그만 추출한다. 인자, 환경 변수 값, URL 쿼리, 셸 치환, heredoc 원문은 저장하지 않는다. 복합 명령 전체 시간을 하위 명령에 임의 배분하지 않는다.

`xcodebuild test`와 빌드, `npm test`와 다른 스크립트, 대상 지정 테스트와 전체 테스트는 구분한다. 명령 이름만 보고 full rebuild로 분류하지 않는다. 사용자 규칙은 추후 검증 가능한 선언형 매칭으로 추가한다.

비영 종료 코드와 도구 실패는 분리한다. 예를 들어 `rg`의 결과 없음과 실행 오류를 같은 실패로 세지 않는다. 오류 식별자는 허용된 오류 분류와 로컬 keyed fingerprint로 만든다. 오류 원문을 보여주지 않아도 재시도 근거를 연결할 수 있어야 한다.

반복 실패의 초기 후보 기준은 같은 턴·프로젝트에서 동일 `operationKey`와 오류 식별자가 10분 안에 3회 이상 실패한 경우다. 명령 패턴은 표시·집계용이며 동일 작업의 근거가 아니다. 임계값은 명시적으로 설정한다. 오류 근거가 없으면 반복 실행까지만 말한다. 각 규칙은 ID·버전·근거 이벤트·임계값·신뢰도를 반환한다. 후보의 시간은 관측된 호출 시간이며 절감 예상치가 아니다.

10개 지표와 6개 진단은 [METRICS.md](METRICS.md)의 계약을 구현한다. Detected Waste 총계는 METRICS의 규칙별 포함표·canonical 구간 계약을 통과한 후보의 합집합이며 규칙별 합을 더하지 않는다. Slow Tool·탐색/검증 휴리스틱만으로는 시간 총계에 넣지 않는다. unresolved recovery·내용 변경 후 재읽기·토큰 단계 미분류를 별도 상태로 유지한다.

## 개인정보와 출력 경계

원문 프롬프트·소스·도구 출력·원문 셸 명령을 기본 DB, 디버그 로그, 리포트와 fixture에 넣지 않는다. v0.1은 원문 저장 옵션을 제공하지 않는다. 로컬 수집 manifest의 입력 경로는 운영상 보관하되 리포트에 자동 노출하지 않는다.

프로젝트는 사용자 별칭으로, 필요 없는 절대 경로는 생략한다. 동일 파일·오류 비교에 필요한 식별자는 로컬 키로 fingerprint를 만들고 키를 내보내지 않는다. 개인정보 필터를 통과한 정규화 데이터만 집계기에 전달한다.

HTML에는 JS·CSS·SVG·분석 데이터를 모두 포함한다. CDN, 외부 폰트, 원격 이미지와 fetch를 사용하지 않는다. 데이터 삽입 시 `</script>`, HTML 태그와 제어 문자를 안전하게 처리하며 문자열은 텍스트로 렌더링한다. 원문 로그는 리포트의 실행 코드가 될 수 없다.

전체 파일을 메모리에 올리지 않는다. P0에서 최대 줄 크기·전체/증분 scan 시간·peak RSS·HTML 크기의 측정 workload와 합격 예산을 정하고 초과 입력·파싱 오류는 원문 없는 진단으로 남긴다. DB와 설정·로컬 키 파일의 접근 권한도 설치 테스트에서 확인한다.
