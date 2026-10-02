# Claude Code Adapter — P3 Implementation Contract

2026-10-01 KST. [P3 Project 티켓](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833029)의 구현 계약이다. P0 계약·P1 기반과 기존 Codex P2 개인정보 경계를 사용한다. 고정된 S1–S3 prefix 1,179개 레코드의 연구 결과와 공식 API의 적용 범위는 [CLAUDE-EVIDENCE](CLAUDE-EVIDENCE.md)에 둔다. 실제 transcript의 사용량 종결·tool runtime·turn scope는 검증되지 않았으며 해당 값의 집계 적격성을 추정하지 않는다. 부모가 source 근거·API·시간·usage·상한과 독립 Verify를 먼저 검토했고 별도 개발 담당이 구현했다. frozen build의 독립 bounded parity는 PASS이며 지원 runtime·artifact·게시/병합 결과는 [ACCEPTANCE](ACCEPTANCE.md)에 기록한다.

## Scope and ownership

P3는 완전한 reader JSONL 레코드를 원문 없는 Claude execution·turn·usage 관측으로 바꾸는 bounded in-memory adapter다. `src/parsers/claude/`, Claude 행동·oracle 테스트와 독립 합성 fixture를 개발 담당이 소유한다. 공급자 공통 타입을 확장할 때 기존 Codex API·수치·nullable 의미를 보존한다. 기존 `providers/expected.json`, Claude P0 fixture는 구현에 맞춰 고치지 않는다. CLI scan·SQLite 저장·지표 계산·HTML은 후속 단계다.

UUID·parent·tool_use/tool_result·session/agent/sidechain 관계는 검증한 직접 필드만 사용한다. source 경로와 원문 ID는 HMAC 처리하고 result body·오류·명령·prompt를 pairing 상태에 보관하지 않는다. 직접 duration·call/result observed interval·turn duration을 구분한다. missing/pending은 null이며 현재 시각이나 0을 붙이지 않는다. Claude cache-read/create와 ordinary input의 관계는 검증한 매핑만 사용하며 OpenAI 포함 회계와 구분한다. finality·복사 출처·연결이 불명확하면 provisional/unknown과 coverage 한계를 보존한다. source roots는 P1 discovery의 `CLAUDE_CONFIG_DIR` 계약을 사용한다.

## Adapter API and bounded state

`src/parsers/claude/index.ts`는 `ClaudeAdapter`, `createClaudeAdapter`, `DEFAULT_CLAUDE_LIMITS`와 HMAC identity helper를 제공한다. `ingest(record, source)`는 immutable upsert batch, `snapshot()`은 canonical execution·turn·usage와 source observations·metadata·capabilities·state counts를 반환한다. `inspectRetainedState()`는 privacy·budget 검사용 안전한 상태만 반환한다. 이는 P4 durable checkpoint API가 아니다. 추가된 `exportCheckpoint(binding, options?)`와 `ClaudeAdapter.restoreCheckpoint(context, encoded, expectedBinding, limits?)`는 ordinary single-source 상태를 제한된 토큰으로 저장하고 검증 후 새 파서에서 복원한다. 실제 검증과 지원 범위는 [P4-CLAUDE-CHECKPOINT](P4-CLAUDE-CHECKPOINT.md)를 따른다. 이 API는 source bytes 검증·durable storage·scanner resume 지원을 뜻하지 않는다.

Claude 전용 타입은 `src/parsers/claude/types.ts`에 둔다. 공통 `NormalizedEvent`와 timing/status enum을 재사용하되 기존 Codex 출력·타입의 의미와 사용량 매핑은 바꾸지 않는다. source는 file identity·safe alias·byte offset·ordinal을 받는다. raw JSON 안의 annotation을 trusted context로 읽지 않는다.

기본 상한은 events/turns/usage 각각 4,096, sources/streams 각각 256, message links 8,192, deferred results/result replay/usage-order state와 별도 `usageProofReplays` 각각 4,096, observations/metadata/diagnostics 각각 8,192다. 전체 adjacency 수가 늘어나는 별도 구조에는 총량 상한을 둔다. 모든 설정은 양의 safe integer이고 1,000,000 이하여야 한다. 상한 초과는 `STATE_LIMIT`와 partial capability를 남기고 새 상태 추가를 거부한다. 기존 identity를 몰래 버리거나 다음 입력을 새 실행으로 오인하지 않는다. raw-free 상태의 모든 collection을 `stateCounts`로 검증한다.

UUID+semantic content/usage의 exact replay HMAC marker는 별도 유한 collection으로 두고 `messageLinks` 상한을 적용한다. UUID link Map, replay marker Set와 parent/source-assistant adjacency 총량은 각각 상한과 상태 개수를 드러낸다. file reference·ordinal·trusted fixture proof는 의미 marker에 포함하지 않는다. 이미 관측한 과거 snapshot을 proof 없이 archive로 다시 읽어도 최신 usage를 conflict로 만들지 않는다. 같은 raw snapshot에 새 trusted proof가 붙으면 raw replay와 별도로 finality·ordering·count 관계를 검증한다. 기존 final을 강화하는 동일 값 proof는 반영할 수 있지만 상충하는 final 값은 conflict로 남긴다. 같은 proof의 재입력은 상태·진단·counter를 늘리지 않는다. 미관측 cross-source의 다른 값에는 순서를 발명해 선택하지 않는다.

검증한 usage proof의 이력은 `usageProofReplays` HMAC Set에 raw semantic identity와 safe finality/order/mapping 의미를 묶어 보관한다. 이 Set는 선택된 한 usage 후보의 `usageOrders` Map과 별개이며 독립 상한·개수를 드러낸다. 원문 ID·ordering group·body는 보관하지 않는다. trusted context가 없는 실제 표본의 proof Set 개수는 0이다. proof 상한 초과 시 새 proof로 canonical 값을 갱신하지 않고 partial을 남긴다.

## Identity, origin and replay

- Root stream은 session ID, sidechain stream은 session+agent ID로 식별한다. sidechain인데 agent ID가 없거나, agent ID가 있는데 sidechain 관계가 명시되지 않거나 모순되면 root에 합치지 않고 unattributed로 남긴다. source filename과 timestamp는 stream identity를 만들지 않는다.
- Execution은 stream+`tool_use.id`, usage는 stream+`message.id`, transcript link는 stream+`uuid`로 HMAC 처리한다. UUID 재입력과 같은 API message ID의 다른 content block은 별도 문제다. message ID가 같다는 이유로 새 tool block을 제거하지 않는다.
- `parentUuid`·`sourceToolAssistantUUID`를 bounded opaque link로 보존한다. 다중 호출 메시지에서 특정 parent execution을 고르거나 parent 순서로 시간을 만들지 않는다. 직접 검증된 실행 관계가 없으면 `parentEventId`·`turnId`는 null이다.
- 동일 내용의 재입력·archive 재표현은 canonical 실행·turn·usage를 늘리지 않는다. source observation은 별도로 보존한다. 서로 다른 내용의 동일 call/result ID는 안전한 conflict diagnostic과 unknown을 남긴다. source 경로 차이는 의미 충돌이 아니다.
- 동일 call이 뒤 UUID의 usage 갱신에 다시 나타나도 원래 start를 뒤로 옮기지 않는다. 같은 파일에서 더 이른 source ordinal이 후착하면 검증된 최초 call 표현으로 갱신할 수 있다. source 순서가 없는 다른 표현에서 가장 작은 timestamp를 골라 경계를 발명하지 않는다.
- call replay의 의미 HMAC은 직접 record context와 입력을 사용하며 나중에 바뀐 stream project context를 섞지 않는다. 최초 검증된 call 표현의 nullable project HMAC·context authority를 기존 bounded execution 상태에 보존한다. 뒤 레코드의 `cwd`가 과거 호출을 다시 분류하거나 missing context를 확정값으로 바꾸지 않는다.
- 동일 source point의 직접 declaration이 같은 재입력은 기존 bounded metadata에 남은 최초 ownership/origin을 사용한다. 나중에 발견한 source ambiguity는 새 관측에 적용하며, 과거 ordinary 관측을 replay 때만 ambiguous로 바꿔 provenance·진단·counter를 늘리지 않는다. 직접 declaration이나 call 입력 자체의 모순은 이 보존 규칙으로 숨기지 않는다. 새로운 원문 보관이나 무제한 context 이력은 추가하지 않는다.

기존 bounded metadata의 `declarationFingerprint`는 직접 session/sidechain/agent declaration의 HMAC이다. 미귀속·상한으로 `sessionId=null`인 경우에도 직접 declaration의 동일성은 별도로 비교한다. 동일 HMAC일 때만 최초 origin/ownership을 재사용하며 다른 declaration은 `INCONSISTENT_REPLAY`/ambiguous로 드러낸다. 입력-only HMAC·최초 nullable `callProjectId`는 기존 execution 상태에 보존한다. 별도 collection이나 상한은 추가하지 않는다.

한 파일에서 session declaration이 바뀌거나 fork origin이 불명확하면 ambiguous로 표시한다. P0 합성 fork provenance는 trusted test context의 copied ordinal로만 검증한다. `forkedFromSessionId` 같은 합성 필드는 실제 provider provenance로 승격하지 않는다. copied observation은 새 canonical 기여를 만들지 않는다.

## Executions, status and timing

Assistant `tool_use`와 user `tool_result.tool_use_id`를 같은 stream 안에서 연결한다. 다중 호출·결과 선행·누락·중복·다른 stream은 각각 검증한다. result 선행 상태에는 fingerprint·safe scalar·enum만 보관한다. command·input·result content는 입력 처리 중 normalizer에만 전달하고 버린다. shell 분류는 inert allowlist를 사용한다. 복합 shell을 실행하거나 단순 `rg` no-match 정책을 적용하지 않는다. custom tool/MCP 이름은 고정된 표시 enum과 HMAC으로 처리한다.

content/error 비교값은 완전성 근거가 없으면 null이다. 합성 oracle의 trusted complete-output context는 해당 ordinal·대상에만 적용한다. 전체 JSONL record를 읽었다는 이유로 잘린 도구 출력이나 Read의 line-numbered 표현을 완전한 내용으로 올리지 않는다. 실제 tool 실패 관측과 반복 오류 identity의 coverage는 별도로 기록한다.

직접 boolean `is_error`는 tool invocation failure/success의 근거다. missing은 unknown이며 출력 문자열에서 성공·실패·exit code를 추출하지 않는다. child process exit는 shape와 의미가 검증된 직접 필드가 없으면 null이다. conflict가 있는 결과는 확정 성공·실패로 쓰지 않는다.

정상 call/result의 timestamp 차이는 interval과 canonical `durationMs`에 함께 보존하며 둘 다 `paired_timestamps`/`invocation_latency`다. source-reported duration이 따로 검증되면 그 duration·scope를 우선 보존하고 paired interval은 별도로 둔다. 이 값은 process runtime이 아니다. 역전·누락은 null과 diagnostic을 남긴다. timestamp 부모 관계는 실제 표본에서 역전된 사례가 있어 clock order로 사용하지 않는다.

`run_in_background`·`backgroundTaskId`, `isAsync`·`async_launched`의 검증된 launch acknowledgement는 process terminal이 아니다. canonical execution은 pending으로 두고 end/duration을 null로 남긴다. source observation에는 safe completion-kind enum·관측 acknowledgement 시각/latency를 보존할 수 있다. user text의 task ID 언급으로 종결·sidechain parent를 추정하지 않는다.

한 레코드에 여러 `tool_result`가 있고 top-level launch metadata의 대상이 검증되지 않으면 각 결과에 background ID를 배분하지 않는다. safe `unassignedAcknowledgement` boolean과 `UNSUPPORTED_RELATION`을 남기고 affected canonical status/completion은 unknown, end/duration/interval은 null이다. 관측 `is_error`는 source observation에 그대로 보존한다. 정상 terminal로 오인하거나 도구 종류만으로 대상을 추측하지 않는다.

실제 표본 280개 result의 직접 tool runtime은 0개다. P0의 `toolUseResult.durationMs=2500`은 trusted fixture timing context가 `ordinal`·`toolUseId`·`durationScope`·`source=tool_use_result_duration_ms`로 정확한 대상·scope를 지정할 때만 source-reported duration으로 검증한다. 로그에 같은 필드가 있다는 이유만으로 process runtime으로 해석하지 않는다. 여러 result block에 top-level timing을 무차별 적용하지 않는다.

`system`/`turn_duration`의 직접 `durationMs`는 UUID별 duration-only turn 관측이다. 값의 evidence는 source-reported지만 scope는 unknown이다. 별도 observedAt을 보존할 수 있으며 start/end·interval은 null이다. 실제 8개에는 turn start/turn ID가 없으므로 `timestamp-duration`으로 경계를 역산하지 않는다. 같은 UUID의 상충하는 값은 집계 적격성에서 제외한다.

## Usage semantics and finality

Claude counts는 `mapping=anthropic_messages`다. `uncachedInput=input_tokens`, `cachedInput=cache_read_input_tokens`, `cacheWriteInput=cache_creation_input_tokens`, 공통 `input=uncachedInput+cachedInput+cacheWriteInput`, `total=input+output`이다. 따라서 uncached 100/read 30/create 20/output 10은 input 150/total 160이다. 공통 input은 Codex와 같은 all-input 의미다. TTL 5m/1h bucket은 cache creation의 세부 내역이며 다시 합산하지 않는다. 누락 component는 null이고 0을 대입하지 않는다. 음수·비정수·safe-integer overflow는 invalid다. 네 기본 component가 모두 유효하면 counts complete이며, 검증되지 않은 thinking detail은 reasoningOutput=null이다.

사용량은 message ID별로 upsert하고 각 source usage observation도 남긴다. 같은 파일의 ordinal은 그 파일 내 provisional 최신값 선택 근거다. 뒤에 읽힌 오래된 ordinal이 최신값을 덮지 않는다. 다른 파일의 서로 다른 값에는 비교 가능한 순서를 발명하지 않는다. 순서 불명·같은 순서 상충·final 이후 다른 final 값은 conflicted로 제외한다. trusted test context의 ordering group/order는 합성 oracle에서만 사용한다.

실제 626개 usage record/251개 message ID에는 streaming `message_delta`/`message_stop` 종결 증거가 없다. `stop_reason`의 검증된 enum은 terminal-shaped candidate로만 보존한다. 버전·enum·assistant content block 존재·output 증가·마지막 source ordinal만으로 `source_terminal`을 선언하지 않는다. 실제 사용량은 `finality=unknown`, `selection=provisional`이다. partial→final 합성 사례는 trusted fixture evidence가 final을 지정하고 counts complete·ordinary origin·response identity·비충돌 조건을 모두 만족할 때만 eligible이다. API token 매핑 검증과 transcript 저장 종결 검증은 별개다.

usage 6→6→10의 trusted final oracle은 10을 한 번 선택한다. 그 원본을 trusted proof 없이 다른 archive source에서 재입력해도 final 10은 유지한다. 이미 관측한 동일 snapshot에 나중에 검증된 final proof가 추가되면 해당 조건을 다시 검증하고, 이전 final 10과 다른 final 6을 그대로 건너뛰지 않는다. unknown-finality 원본도 하나의 provisional 후보와 원 관측을 유지한다. missing message ID·partial counts·ambiguous origin·conflict는 nullable 필드와 고정 limitation enum으로 설명한다. tool token 귀속과 model/network 시간을 발명하지 않는다.

## Research gates

- P0 S1–S3의 고정 prefix·digest가 남아 있는지 확인하고 새 파일/append를 당시 표본으로 취급하지 않는다.
- message ID/UUID/parent·sidechain·background result 관계, `toolUseResult` shape, 직접 duration scope, usage 재저장의 순서·final 근거를 조사한다.
- API 문서의 token 의미와 실제 Claude Code 로그의 보장을 구분한다. 합성 annotation은 provider 필드로 해석하지 않는다.
- 공통 또는 Claude 전용 결과 타입, HMAC domain, 유한 상태 상한, 누락·충돌·부분 지원 정책을 구현 전에 확정한다.

이 gate의 초기 조사 결과는 위 계약에 반영했다. 개발 중 새로운 source authority나 의미가 필요한 경우 코드보다 계약·Project Verify를 먼저 갱신한다.

## Implementation order and verification

1. 실제/합성 shape와 source authority, 결과·시간·usage·상태 한도를 확정한다.
   **Verify:** 원문·명령·출력·개인 경로·실제 ID는 공유하지 않는다. source 근거와 익명 집계만 evidence에 남기고 미확정 finality/version을 지원으로 승격하지 않는다.
2. bounded Claude adapter의 call/result·UUID replay·sidechain·pending·archive/fork 관측을 구현한다.
   **Verify:** P0 기대값과 기존 Codex 검증을 유지한다. 동시 호출·중복 메시지·결과 선행/누락·background·다른 stream·충돌·상한·inert 명령·privacy sentinel을 독립 기대값과 대조한다.
3. turn·token 관측과 final/provisional·cache mapping을 구현한다.
   **Verify:** 직접 duration과 observed interval, duration-only·unknown/0, 같은 message usage6→10·역순·충돌·누락 component·copied origin을 검증한다. tool/phase 귀속을 발명하지 않는다.
4. P0 bounded prefix의 정규화 출력을 독립 기준과 로컬 대조한다.
   **Verify:** ID·관계·수치·scope·selection·same-source replay·archive 재표현·raw-free retained state를 확인한다. 미실행·선택 편향과 실제 지원 한계를 별도 evidence에 남긴다.
5. 부모 리뷰·지원 runtime/build/artifact와 main 기준 PR 게시·병합을 마친다.
   **Verify:** 의미 있는 행동 테스트·타입·빌드·macOS/Linux Node matrix·production tarball help/version·문서 링크·diff를 확인한다. P4 통합 및 A01–A27 제품 acceptance는 별도다.

[NORMALIZATION](NORMALIZATION.md) · [FIXTURES](FIXTURES.md) · [EVIDENCE](EVIDENCE.md) · [IMPLEMENTATION](IMPLEMENTATION.md) · [ACCEPTANCE](ACCEPTANCE.md).
