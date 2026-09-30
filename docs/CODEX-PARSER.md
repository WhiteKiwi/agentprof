# Codex Adapter — P2 Implementation Contract

2026-09-30. [P2 issue #3](https://github.com/WhiteKiwi/agentprof/issues/3)의 구현·검증 계획이다. 검토된 P0 계약과 P1 기반을 사용한다. P1 PR #9가 병합 전이므로 `codex/codex-adapter`를 `codex/initial-foundation` 위에 쌓는다. 실행 상태·체크리스트는 이슈와 Project에서 관리한다.

## Scope and source authority

P2는 reader의 완전한 JSONL 레코드를 소비하는 Codex 어댑터와 개인정보 경계를 구현한다. 정규화된 호출·턴·usage 관측, 안정 ID의 갱신, capability/coverage·안전한 진단을 반환한다. CLI scan·DB 이벤트/checkpoint transaction·지표 계산·HTML은 후속 단계다. 공개 runtime/CLI 동작을 가짜 분석으로 바꾸지 않는다.

[NORMALIZATION.md](NORMALIZATION.md)의 HMAC·시간 scope·원문 폐기 계약, [FIXTURES.md](FIXTURES.md)의 독립 기대값과 [EVIDENCE.md](EVIDENCE.md)의 bounded 표본을 따른다. 실로그 파서 대조는 별도 Codex evidence에 기록한다. 합성 annotation을 공급자 스키마로 받아들이지 않으며 정확한 버전의 검증 범위와 unknown을 구분한다.

## API and privacy boundary

- `src/parsers/`에 공급자 독립 결과 타입과 Codex 구현을 둔다. reader entry의 record/byteOffset과 로컬 source identity·alias를 받으며 호출자는 여러 입력·나중 append를 같은 adapter에 전달할 수 있다.
- 안정 stream + call/item identity로 HMAC 이벤트 ID를 만든다. 같은 이벤트의 추가 표현·나중 결과는 같은 ID의 upsert다. 경로·archive 위치는 실행 ID가 아니다. 별도 sourceRef로 관측 위치를 보존한다.
- normalized event는 기존 P1 allowlist를 유지한다. 턴·usage는 별도 명시 타입으로 numeric 값·UTC 경계·scope/evidence·opaque IDs·고정 분류만 갖는다. 공급자 raw 객체·임의 metadata 문자열·prompt·code·command·출력을 반환하지 않는다.
- command/lookup/content/error 비교 키는 필요한 원문이 이번 record 메모리에 있을 때 만든다. 이후 pairing 상태에도 원문 문자열/객체를 보관하지 않는다. 결과 이후 도착하는 exit code의 의미는 호출 때 만든 고정 enum 정책으로 해석한다.
- adapter의 pairing·replay·provenance 상태와 diagnostics는 상한을 둔다. 상한 초과는 안전한 진단·partial coverage로 드러내며 조용히 동일성을 잃거나 전체 파일을 buffer하지 않는다. P4 durable state/checkpoint 저장은 여기서 구현하지 않는다.
- 입력은 inert parsed JSON이다. unknown 필드와 schema drift는 whitelist 경계에서 버린다. diagnostics는 고정 code·source alias·offset만 갖는다. 오류 메시지나 원문 record type을 출력하지 않는다.

P2의 기본 상태 한도는 events/turns/usage 각 4,096개, sources/streams 각 256개, process/poll links 각 1,024개, observations/metadata/diagnostics 각 8,192개다. 호출자가 명시적으로 조정할 수 있지만 각 한도는 유한한 양의 정수여야 한다. 한도 초과를 partial coverage와 고정 진단으로 알린다. 조용한 eviction이나 새 ID 생성으로 동일성·pending 연결을 잃지 않는다. 이 bounded in-memory API는 P4의 대규모 durable 저장·성능 검증을 대신하지 않는다.

## Structured and fallback executions

관측된 실제 경로는 `event_msg.payload.type = item_completed`와 `payload.item`이다. 항목 종류는 PascalCase `CommandExecution`, `McpToolCall`이며 직접 duration은 `{secs,nanos}`, envelope 경계는 `started_at_ms`/`completed_at_ms`다. 타입·단위·scope를 검증한 범위만 처리한다.

1. 검증된 구조화 항목을 우선한다. 같은 stable ID로 확인된 function/custom call/output만 합쳐 fallback 표현과 구조화 항목을 두 번 세지 않는다. ID가 다르다는 이유로 timestamp·명령 문자열을 이용해 임의 연결하지 않는다.
2. 명령은 string과 argv를 처리한다. 실제 관측의 shell `-lc` transport는 검증된 argv 형태에서만 inert하게 내부 명령을 분류한다. compound·치환·heredoc는 P1의 unknown 정책을 유지한다. wrapper와 작업 문맥의 차이가 operation identity에서 사라지지 않게 한다.
3. function/custom call의 name·namespace와 JSON arguments 또는 custom input을 구분한다. `exec`의 코드 문자열은 실행하거나 분석해 내부 명령을 발명하지 않는다. 알려진 code wrapper는 execution과 별도 representation/coverage로 남기고 부모·자식 관계가 불명확하면 진단한다.
4. 결과는 구조화 object, 검증된 JSON 결과와 `text`/`input_text` content block을 처리한다. image와 stdout 내 임의 문장은 실행·상태 metadata로 해석하지 않는다. text transport를 해석할 경우 알려진 envelope의 header 경계만 처리하고 `Output` 이후는 inert body다.
5. 구조화 status의 의미와 command exit 정책을 구분한다. 관측한 `CommandExecution.status`는 exit code 0/비영으로 생성되는 transport 상태이며 semantic-explicit 실패로 넘기지 않는다. `rg` exit 1·검증된 `git diff --exit-code` exit 1은 완료된 no_match/change다. 검증된 zero 종료는 completed이며 일반 비영 code·알 수 없는 명령 의미는 P1의 unknown 정책을 유지한다. 필요하면 원문 없는 고정 enum으로 source transport status를 별도 보존한다. MCP `isError`와 같은 검증된 tool-result 실패는 별도 근거다. 취소·pending·완료 여부가 불명확한 결과는 unknown이며 근거 없는 오류 identity는 null이다.
6. CommandExecution duration과 lifecycle 경계, MCP 호출 duration, fallback call/result의 관측 latency를 서로 다른 scope/evidence로 보존한다. unified exec duration은 spawn 이후 output drain·monitor settle·lock까지 포함할 수 있는 monotonic process 경과이며 CPU 시간·순수 child runtime이라고 설명하지 않는다. 직접 duration으로 구간을 역산하지 않는다. 범위가 다른 값에 동일성 공식을 강제하지 않는다.

MCP duration은 source로 확인한 승인 후 호출 준비·RPC·결과 처리의 `invocation_latency`다. 최초 승인 대기·전체 item lifecycle·순수 서버 runtime을 뜻하지 않는다. skipped/unavailable/rejected 경로가 기록하는 zero duration은 결과 근거 없이 실제 호출 runtime으로 승격하지 않는다. tag별 생성 지점과 범위는 [CODEX-EVIDENCE.md](CODEX-EVIDENCE.md)에 기록한다.

## Pending, polling, archive and fork

호출의 pending 이벤트는 결과를 받으면 동일 ID로 갱신한다. 결과가 먼저 오거나 중복 결과의 값이 충돌하면 연결 가능성·근거를 검사해 진단하고 완료 값을 임의 선택하지 않는다.

검증된 exec_command process/session 관계와 write_stdin polling을 연결한다. polling은 추가 프로세스 실행이 아니며 여러 응답의 wall time을 합산해 runtime을 만들지 않는다. 호출 시작부터 terminal result까지는 관측 invocation latency다. process runtime이 없으면 null이다. 연결이 없는 polling은 미지원 관계로 기록한다.

동일 stream/item의 archive 복사·재스캔은 동일 ID를 유지한다. 독립 실행은 command가 같아도 같은 ID로 만들지 않는다. fork의 `subagent_history_start_ordinal` 이름만으로 copied/new 경계를 만들지 않는다. 테스트의 명시 복사 범위·wrapper 관계는 신뢰된 별도 fixture context로만 제공한다. 원본 관계가 검증되지 않은 복사 이력은 `AMBIGUOUS_ORIGIN`과 coverage 한계로 남긴다. 복사된 header가 새 실행의 stream·버전을 덮어쓰지 않게 한다.

## Turns and usage observations

검증된 task/turn 시작·완료·중단 경계를 연결한다. resume·missing end는 pending이며 현재 시각을 붙이지 않는다. 직접 턴 duration과 관측 턴 경계는 호출 duration과 별도 타입·scope다. source에서 확인한 task/turn의 `started_at`/`completed_at`는 Unix **seconds**, `duration_ms`는 **milliseconds**, item의 명시 `_ms` 경계는 **milliseconds**다. 단위별로 명시 변환하고 초 단위 wall 경계와 monotonic ms duration에 P1의 같은-ms-scope 1ms 일치 규칙을 강제하지 않는다.

확인된 payload endpoint가 있으면 이를 사용하고, copied history에서 다시 쓰일 수 있는 record ISO timestamp로 대체하지 않는다. endpoint 없는 구형/합성 입력의 record timestamp pairing은 별도의 observed log interval이며 source-reported turn 경계로 승격하지 않는다. 단위·scope가 검증되지 않은 값은 unknown과 진단으로 남긴다.

실제 `token_usage_record`는 top-level record이며 합성 fixture의 event_msg 형태도 조건부 shape로 검증한다. [PR #11](https://github.com/WhiteKiwi/agentprof/pull/11)의 최종 usage 계약을 따른다. 검증한 `0.153.4`, `0.157.0`, `0.159.0`, `0.159.2` source tag의 native record는 response terminal 경로에서 생성된다. origin·source version·관계가 확인된 범위만 terminal finality로 처리하며, 이는 turn 성공·완료를 뜻하지 않는다. 그 밖 shape·합성 event_msg·복사 출처 불명은 final을 임의 추정하지 않는다. fixture의 final/partial·source ordering 근거는 신뢰된 별도 context로만 제공한다.

같은 response ID의 partial → final 갱신은 검증된 source ordering과 final 근거가 함께 있을 때 마지막 완성 값으로 upsert한다. 첫 값 고정·component별 최대값·snapshot 합산은 금지다. 순서·final·origin 불명은 provisional/unknown과 제외 이유를 남긴다. 이미 final인 값의 모순이나 서로 비교할 수 없는 source의 충돌은 임의 마지막 값으로 덮어쓰지 않는다. `usage`, `turn_token_usage`, `thread_token_usage`, `token_count.info.total_token_usage`는 각각 response/turn/cumulative 관측이며 서로 합산하지 않는다.

입력·출력·cached/reasoning token 값은 안전한 비음수 정수와 검증된 포함 관계만 사용한다. OpenAI Responses로 확인된 매핑은 input에 cache read/write를 이미 포함하며 `cached + cacheWrite <= input`, `reasoning <= output`, `total = input + output`을 검증한다. cache를 total에 다시 더하지 않는다. 누락 component·미검증 포함 관계는 total/차감값을 null로 두고 확인한 component와 partial/invalid 근거를 보존한다. source가 기본값 0을 출력했다면 실제 0과 누락을 구별할 수 없다는 한계도 남긴다. positive cache-write의 실제 표본 대조는 미실행이며 source와 독립 합성 oracle 검증을 구분한다. response/turn/tool 귀속 근거가 없으면 null/unknown으로 둔다. token_count의 snapshot을 정확한 response 값처럼 대체하거나 임의 차분해 새 토큰을 만들지 않는다. 일치하지 않는 snapshot도 source 종류·scope를 보존한다.

## Implementation order and verification

1. 실제/합성 shape, source authority와 결과·상태·상한 타입을 확정한다.
   **Verify:** 기존 oracle을 고치지 않고 실제 argv·top-level usage·input_text·다른 item/call IDs의 독립 합성 입력을 추가한다. privacy allowlist와 unsupported 관계를 검토한다.
2. 구조화 항목·fallback·정규화와 동일 ID upsert를 구현한다.
   **Verify:** fixture의 shell/MCP count·scope·fingerprint·sentinel, alias/namespace·잘못된 시간·unknown status와 근거 충돌을 대조한다.
3. pending/polling·turn·usage·archive/fork 처리를 구현한다.
   **Verify:** 3개 legacy 실행·poll 추가 0·runtime null·5초 observed latency, append 후 pending 0·8초 latency, archive canonical 2, 검증된 copied range의 fork 새 실행 1, annotation 없는 ambiguity, usage replay와 cumulative 분리를 확인한다.
4. P0 bounded 로컬 표본을 수작업 기준과 adapter 출력으로 대조한다.
   **Verify:** 원문·실제 명령·출력·경로·stable IDs를 저장소/메모리로 내보내지 않는다. 표본 revision·선택·수치·의미·대조 결과·한계를 기록하고 shape-only와 검증한 버전/필드 범위를 구분한다.
5. 부모 검토·runtime/build/artifact 검증과 stacked PR 게시를 마친다.
   **Verify:** 변경에 맞는 행동 테스트, 지원 Node 24 최소/현재와 macOS/Linux CI, production pack·help/version, 원문 없는 parser 결과·상태, 문서 링크와 diff를 확인한다. P3–P7 제품 acceptance는 완료 처리하지 않는다.
