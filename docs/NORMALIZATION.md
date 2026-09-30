# Normalization and Privacy Contract

상태: 2026-09-30 P0/P1 계약. 이 문서는 [ARCHITECTURE](ARCHITECTURE.md)의 정규화 경계를 구체화한다. 공급자 어댑터·DB·분석기는 후속 단계이며, 여기서 형식을 정했다고 실로그 버전을 지원하는 것은 아니다.

## Version and Identity

`normalizationVersion = 1`, `keyVersion = 1`을 사용한다. 설치별 32-byte 무작위 HMAC-SHA-256 키를 로컬 데이터 디렉터리의 `identity-key.json`에 보관한다. 디렉터리는 POSIX `0700`, 키/설정/DB 파일은 `0600`이다. 키는 DB·진단·내보내기·fixture·리포트에 넣지 않는다. 테스트 키는 명백한 합성 키이며 사용자 키가 아니다.

식별자는 `h1:<keyId>:<domain>:<hexDigest>`다. `keyId`는 무작위 16-byte 식별자이며 비밀 키가 아니다. HMAC 입력은 `[normalizationVersion, keyVersion, domain, ...typedParts]`의 JSON 인코딩이다. field/domain separation으로 파일·내용·작업·오류가 서로 충돌하는 비교를 막는다. 서로 다른 keyId/keyVersion/normalizationVersion의 식별자는 비교하지 않는다. 키가 손상되거나 권한·symlink가 부적절하면 자동 재생성하지 않고 안전한 오류를 반환한다. 필요한 원본이 없으면 재처리·동일성 확인은 불가로 남긴다.

| Identity | 메모리에 있을 때 필요한 입력 | 저장되는 값 | 근거가 부족한 경우 |
| --- | --- | --- | --- |
| event/session/turn/source | provider와 원본의 안정 ID; source는 local file identity | domain별 HMAC | 안정 ID가 없는 이벤트는 adapter 진단과 nullable 관계를 사용 |
| operationKey | provider, 프로젝트/실행 문맥, 프로그램, 전체 argv 또는 검증된 구조화 도구 동작 | HMAC | 복합 셸·치환·환경 대입·heredoc·연결 관계 불명은 `null` |
| lookupKey | 파일 식별자+관측 범위 또는 query+검색 root+옵션 | HMAC | 필요한 범위/옵션 불명이면 `null` |
| contentFingerprint | 로그에 실제 관측된 완전한 내용 | HMAC | 잘림·내용 누락은 `null` |
| errorFingerprint | 검증된 오류 분류+오류 코드+메모리에 있는 비교용 메시지 | HMAC | 실패/오류 의미 미검증 또는 비교 입력 누락은 `null` |

operationKey는 표시용 commandPattern과 다르다. `npm test alpha`와 `npm test beta`, `rg --glob a`와 `rg --glob b`는 같은 표시라도 다른 키다. 모든 argv를 opaque하게 비교해 알 수 없는 중요 인자를 임의로 무시하지 않는다. 상대 경로는 확인된 실행 문맥 안에서 lexical하게 해석하며 현재 프로젝트 파일을 읽거나 셸을 실행하지 않는다. 외부 상태·symlink의 과거 의미를 새로 추측하지 않는다.

candidate의 `sessionIdentity`는 root session 그룹이 아니라 고유 execution stream/thread다. Claude sidechain은 agent stream을 포함한 값이어야 한다. 논리 root group은 후속 session metadata에서 따로 관리한다. `parentEventIdentity`는 같은 stream의 관계만 지원하며 cross-stream parent는 P1에서 null로 남긴다. 명시 `parentStreamIdentity`가 현재 stream과 다르면 `UNSUPPORTED_PARENT_RELATION`이다. 이 필드가 없을 때는 adapter가 같은 stream을 확인한 관계만 넘겨야 한다.

오류 메시지의 동적 숫자/경로를 자동 삭제해 서로 다른 오류를 합치지 않는다. 검증된 provider 오류 코드가 있으면 그 코드를 사용하고, 그 외에는 정확한 관측 문자열의 keyed 비교를 사용한다. 동적 필드의 의미를 확인한 adapter 규칙만 추후 버전 변경으로 정규화할 수 있다. 키만 같다고 원인을 확정하지 않는다.

## Inert Command Classification

셸/프로세스/네트워크 실행 없이 문자열을 token화한다. 단순 argv와 단순 따옴표만 허용한다. 셸 연산자, redirection, control character, command substitution, backtick, expansion, 환경 대입, heredoc, 불완전한 quote를 발견하면 `commandPattern = "shell <complex>"`, `operationKey = null`, 상태 의미는 `unknown`으로 낮춘다. structured argv는 일반 문자열 인자로 비교할 수 있으나 display는 같은 allowlist를 적용한다.

display에는 allowlist 프로그램·서브명령·안전한 플래그와 `<args>`/`<target>` 자리표시자만 쓴다. raw 인자·환경값·파일 경로·URL query·inline 코드·임의 프로그램/도구명은 남기지 않는다. 알려지지 않은 프로그램은 `other <args>`다. `npm test`, `npm run <script>`, `rg`, `git`, `node`, `python`, `pytest`, `cargo`, `go`, `xcodebuild`, 일반 파일 도구만 초기 allowlist에 둔다. 사용자 정의 script 이름도 raw display에 넣지 않는다. compound command의 전체 시간을 하위 명령에 배분하지 않는다.

status는 adapter가 검증한 explicit source status와 exit-code 기반 분류를 구분한다. explicit source status는 유지한다. exit-code 기반이면 프로그램 의미가 확인된 단순 `rg`의 exit 1은 `completed`이며 결과 없음이다. exit 2 이상은 실패다. 단순 `git diff --exit-code`의 exit 1은 변경 발견이며 completed다. 그 외 비영 종료와 복합 명령은 검증된 explicit status가 없으면 unknown이다. 취소·pending·결과 누락을 completed/failed로 채우지 않는다. `node --eval/-e`, `python -c`, `sh/bash -c`와 `eval`은 평가 명령으로 미지원이며 operationKey를 만들지 않는다.

## Downstream Allowlist

원문 prompt·message·code·output·command·input 객체·provider metadata를 정규화 결과에 넣지 않는다. 일반 `Record<string, unknown>` 필드는 없다. 문자열 display는 고정 enum/allowlist이며 원본의 session/project/tool 이름도 그대로 전달하지 않는다. 프로젝트 사용자 별칭은 후속 별도 opt-in 표시 계약으로 처리한다.

정규화 이벤트의 허용 필드는 다음과 같다.

- 버전, opaque event/session/turn/parent ID, provider enum.
- kind/category/toolName/commandPattern: 고정된 분류와 안전한 display.
- operation/lookup/file/content/error identity, lookup 범위와 `complete/truncated/unknown`, 변경 근거 `unchanged/changed/unknown`.
- UTC start/end와 `intervalTimingEvidence`·`intervalScope`, durationMs와 `timingEvidence`·`durationScope`, status, exitCode, validationScope enum.
- sourceRef: opaque fileId, nonnegative 완전한 줄 byteOffset, allowlist recordType.

숫자는 유한하고 해당 필드의 범위에 맞아야 한다. timestamp는 유효한 UTC 시각이다. 음수/비유한 duration와 역전 구간은 원문 없는 diagnostic을 남기고 해당 값을 `null`/`unknown`으로 낮춘다. epoch millisecond 경계의 반올림을 고려해 같은 scope의 duration/구간 차이 <=1ms는 보존한다. 차이가 더 크면 `TIMING_CONFLICT`다. 검증된 source_reported duration과 paired/estimated 구간이 충돌하면 duration을 유지하고 구간의 scope/evidence를 unknown으로 낮춘다. source_reported 구간이 우세하면 duration을 낮추며, 두 근거가 동등하게 불명확하면 둘 다 집계에 쓰지 않는다. 원본 값 선택의 의미 검증은 P2/P3 계약이 선행한다. process runtime 8초와 item lifecycle 구간 10초처럼 scope가 다르면 모두 보존하며 충돌로 간주하지 않는다. 구간 합집합은 구간의 scope/evidence를 사용하고 duration 분포는 duration의 scope/evidence를 사용한다. duration-only는 합계 후보이며 위치를 역산하지 않는다. paired 시각은 process runtime이라는 의미를 만들지 않는다.

null은 정보 없음이다. pending의 종료·duration은 `null`이며 현재 시각으로 연장하지 않는다. direct·paired·estimated는 서로 다른 표본군이다. errorFingerprint·contentFingerprint 생성 전에 raw가 필요하지만 생성 이후 raw 참조를 결과 객체에 남기지 않는다. 함수가 원본을 실행하거나 현재 파일 내용을 다시 읽지 않는다는 것이 API 불변 조건이다.

candidate의 `statusEvidence`는 `explicit`(adapter가 검증한 상태), `exit_code`(명령 의미 분류 필요), 미설정/기타(unknown)다. normalized `executionOutcome`은 success/no_match/change_detected/error/unknown의 고정 enum이다. `git diff` 옵션은 parsed argv에서 `--` 이전에 실제로 있는 `--exit-code`만 해석하며 안전한 표시 문자열로 상태를 추론하지 않는다. 초기 helper는 `--exit-code`·`--quiet`·`--no-index`의 무인자 옵션과 일반 operand만 이해한다. `--output`·`--src-prefix` 등 모르는 option/value 구조가 있으면 unknown이며 뒤의 `--exit-code`를 flag로 오인하지 않는다. `--no-index`만 있는 경우도 unknown이다.

진단은 고정 code, severity, source file alias와 byteOffset만 갖는다. Error.message, raw recordType, 실제 경로와 입력 조각을 출력하지 않는다. 로컬 source manifest에는 실제 경로를 유지할 수 있으나 shared analysis envelope에는 포함하지 않는다.

## Reader and Data Paths

macOS/Linux 초기 경로는 `XDG_DATA_HOME/agentprof`, 미설정이면 `~/.local/share/agentprof`다. `--data-dir`은 명시적 override다. 상대 XDG_DATA_HOME은 무시하고 기본 경로를 쓴다. Codex 기본 root는 `~/.codex/sessions`와 `~/.codex/archived_sessions`, Claude 기본 root는 `${CLAUDE_CONFIG_DIR:-~/.claude}/projects`다. `--codex-root`/`--claude-root`는 provider 기본 root를 대체하고 여러 번 지정할 수 있다.

root를 포함한 symlink는 따라가지 않는다. root 밖 symlink를 통한 탐색은 `SYMLINK_SKIPPED`다. discovery 파일/디렉터리 수와 JSONL 한 줄 크기는 제한하며 초과를 silent drop하지 않는다. 압축 JSONL은 `UNSUPPORTED_COMPRESSION`이다. 줄의 최대 크기는 1 MiB, reader chunk는 64 KiB다. 크기가 넘는 줄은 newline까지 메모리 누적 없이 버리고 safe diagnostic으로 기록한다.

여러 provider root에 동시에 포함되는 입력은 `AMBIGUOUS_INPUT_PROVIDER`로 건너뛴다. 동일 provider의 중복 root는 한 번 탐색한다. reader는 파일을 열 때의 size까지 읽어 one-shot 작업이 계속 append되는 파일을 끝없이 따라가지 않게 한다. 이후 append는 다음 호출의 checkpoint부터 읽는다. 읽는 중 truncate로 opening size에 도달하지 못하면 `INPUT_CHANGED`를 남긴다. 완전한 줄이 없는 빈 파일도 checkpoint 0을 반환한다.

줄 크기는 LF delimiter만 제외한 물리 byte 수다. CR/BOM도 한도에 포함하며 JSON decoding에서만 제거한다. 정확히 1 MiB는 허용하고 1 byte 초과는 진단한다. byteOffset은 CR/LF/BOM을 모두 포함한다. reader checkpoint는 마지막 newline 뒤 byteOffset이다. EOF의 부분 UTF-8·JSON은 다음 append까지 미룬다. newline으로 끝난 손상 JSON/UTF-8은 원문 없는 진단이며 offset은 진행 가능하다. 줄 크기 초과와 줄별 실패도 offset·code만 반환한다. 여기서 checkpoint를 계산하는 유틸리티는 P4의 DB 원자적 저장 구현을 대신하지 않는다. 소스 파일은 read-only로 열며 생성/수정/권한 변경하지 않는다.

## P1 Boundary

P1은 계약 구현·reader·local SQLite primitive·CLI help/version까지만 검증한다. `scan`, `stats`, `insights`, `report`, `open`의 제품 동작은 후속 단계다. 미구현 명령은 exit 2와 `NOT_IMPLEMENTED`로 설명하며 가짜 스캔/리포트를 만들지 않는다. 실제 provider 지원, 모든 지표·diagnostic 결과, 증분 transaction, offline HTML, 공개 npx 이름은 아직 NOT RUN이다.

SQLite 기반은 `schema_migrations`와 허용된 설정 키만 갖는 `settings`를 version 1로 만든다. scanner event/checkpoint tables는 P4에서 migration으로 추가한다. POSIX data directory를 먼저 보호하고 기존 DB symlink를 거부하며 새 DB 파일은 `0600`으로 생성한다. 초기 단일 CLI 연결은 `journal_mode = DELETE`, `foreign_keys = ON`, `trusted_schema = OFF`, busy timeout 1,000ms를 사용한다. transaction helper는 실패하면 rollback하고 원문 없는 오류 code를 반환한다. extensions는 활성화하지 않는다. 이 실험에서 migration/binding/rollback/close-reopen을 검증하더라도 P4 atomic checkpoint acceptance는 NOT RUN이다.

transaction callback은 동기 함수만 지원한다. native async 함수는 실행 전에 거부하고 thenable 반환도 misuse로 거부한다. BEGIN에 실패하면 caller가 소유한 기존 transaction을 rollback하지 않는다. 임의 동기 함수가 따로 예약한 비동기 작업을 취소하는 기능은 제공하지 않는다. nested/async transaction을 제품 동작으로 사용하지 않는다.

CLI entry는 호환 가능한 작은 JavaScript bootstrap에서 Node >=24.15.0을 검사한 뒤 compiled CLI를 import한다. 구형 Node가 SQLite import·새로운 런타임 문법을 먼저 만나지 않도록 한다. Commander 오류도 raw argv를 그대로 출력하지 않고 고정 code/message로 바꾼다. help/version은 data directory를 만들거나 source를 읽지 않는다. `--json`의 오류 envelope는 `schema`, `ok`, `error.code`, `error.message`만 갖는다.
