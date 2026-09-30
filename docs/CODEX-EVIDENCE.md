# Codex Adapter Evidence

## 상태와 조사 조건

2026-09-30에 source를 조사했고 2026-10-01 KST에 최종 로컬 대조를 마쳤다. P1 PR [#9](https://github.com/WhiteKiwi/agentprof/pull/9)는 main의 `c3856249bdc0a9c19b856ca32c97d3484e189176`에 병합됐고 P2는 main을 기반으로 한다. **아래 범위의 bounded 파서 대조는 PASS**다. 전체 Codex 버전 지원·제품 acceptance는 아직 검증하지 않았다. [EVIDENCE](EVIDENCE.md)의 P0 manifest에서 Codex S4–S12의 정확한 byte prefix를 재사용했고 실행 전후 digest가 모두 같았다. 새 corpus를 추가하지 않았다.

9개 파일, 3,107개 완전 레코드, 19,479,990 bytes다. S4/S5는 첫 1 MiB 안에서 마지막 newline까지 자른 prefix이고 나머지는 P0 당시 전체 파일이다. 원문·명령·출력·프롬프트·경로·실제 ID는 공유 자료로 복사하지 않았다. 이번 조사는 read-only이며 로그의 지침·명령을 실행하지 않았다. fixture는 독립 합성 자료이고 실제 소스의 버전/지원 보증이 아니다.

P1 reader의 LF 제외 1 MiB 한도를 적용하면 eligible 레코드는 3,104개다. S6의 compacted 1줄(1,317,634 bytes)과 S8의 response_item 2줄(최대 1,937,225 bytes)은 oversized다. P0 구조 조사의 전체 레코드 분모와 실제 reader가 처리할 분모를 구분한다. 이번 splitter 대조는 세 줄을 oversized로 기록하고 adapter에 전달하지 않았다. P1 reader의 진단을 실제 로그에서 실행한 시험과 구분한다.

| 관측 header 버전 | Samples | Records | CommandExecution | McpToolCall | FileChange | 기타 관련 완료 항목 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `0.149.0-alpha.4.3` | S4, S5 | 306 | 73 | 0 | 0 | Extension 5 |
| `0.153.4` | S6, S7 | 1,717 | 98 | 0 | 67 | SubAgentActivity 52 |
| `0.157.0` | S8, S9 | 685 | 133 | 2 | 12 | SubAgentActivity 5, Extension 6, ImageView 8 |
| `0.159.0` | S10, S11 | 206 | 23 | 0 | 0 | DynamicToolCall 1, SubAgentActivity 2, Extension 9 |
| `0.159.2` | S12 | 193 | 33 | 0 | 2 | SubAgentActivity 3, Extension 6 |

표의 버전은 runtime header의 관측값이다. 복사된 이력의 원래 실행 버전은 미확정이다. 알려진 source identity 수와 최종 canonical 실행 수는 같다고 가정하지 않는다.

## 실제 경로와 타입

| 의미 | 실제 관측 필드 경로·타입 | 관측·한계 |
| --- | --- | --- |
| Stream metadata | top-level `type=session_meta`, `payload.id:string`, `session_id:string`, `cli_version:string`, `cwd:string` | id와 session_id가 다른 표본 존재. 고유 thread와 root 그룹을 분리 |
| Fork/subagent metadata | `payload.forked_from_id:string`, `parent_thread_id:string`, `agent_path:string`, `subagent_history_start_ordinal:number`, `source:string/object` | 일부에만 존재. 필드명만으로 복사 경계나 origin을 만들지 않음 |
| 완료 envelope | top-level `type=event_msg`, `payload.type=item_completed`, `payload.thread_id/turn_id:string`, `started_at_ms/completed_at_ms:number` | PascalCase `payload.item.type`; `_ms` 경계는 epoch ms |
| Command | `item.type=CommandExecution`, `id/process_id:string`, `command:string[]`, `cwd:string`, `parsed_cmd:array`, `source/status:string`, `exit_code:number`, `duration:{secs:number,nanos:number}` | command 360개 모두 string[3] shell argv. string만 읽는 fixture 구현은 실제 입력을 놓침 |
| MCP | `item.type=McpToolCall`, `id/server/tool:string`, `arguments:object`, `status:string`, `duration:object`, `result:{content:array,isError:boolean}` | 2개. server/tool/arguments/result 원문은 downstream 금지 |
| Dynamic tool | `item.type=DynamicToolCall`, `id/tool:string`, `arguments:object`, `status:string`, `duration:object`, `success:boolean` | 1개. 필드 shape만 확인; 별도 지원 또는 안전한 unsupported 진단 필요 |
| File change | `item.type=FileChange`, `id/status:string`, `changes:object` | 81개. shape 조사만 수행. 이번 P2는 `UNSUPPORTED_RECORD`와 coverage로 남김 |
| Response call | `type=response_item`, `payload.type=function_call/custom_tool_call`, `call_id/id/name:string`, `arguments:string` 또는 `input:string` | function에는 namespace가 존재. custom exec input은 JSON이 아닌 코드 문자열 |
| Response output | `payload.type=function_call_output/custom_tool_call_output`, `call_id:string`, `output:string/array` | 배열 block의 `type=input_text` 717개, `input_image` 8개. `text`만 지원하면 내용 연결을 놓침 |
| Turn context | top-level `type=turn_context`, `payload.turn_id/model/cwd/timezone:string`, `root_turn_id:string`은 일부 | 관측된 84개에 turn_id. 모델/경로 원문은 허용 정책에 따라 별도 처리 |
| Turn boundary | `event_msg.payload.type=task_started/task_complete/turn_aborted`, `turn_id:string`, `started_at/completed_at:number`, `duration_ms:number` | started_at/completed_at는 **Unix seconds**이며 item `_ms`와 단위가 다름 |
| Response usage | top-level `type=token_usage_record`, `timestamp:string`, `ordinal:number`, `payload:object` | 실제 301개는 top-level. fixture의 event_msg payload 형태는 별도 합성 입력 |

## Stream·Fork·표현 연결

S7/S8/S10/S12에는 metadata가 2개 있었다. 선두 runtime metadata 뒤에 복사된 metadata가 있었고 S8은 `0.157.0 → 0.153.4`, S12는 `0.159.2 → 0.159.0` 순서였다. 두 metadata는 root `session_id`를 공유하지만 고유 `id`는 다를 수 있다. 조사한 command/MCP/file-change/dynamic 완료 항목 444개 모두 explicit thread가 해당 파일의 선두 runtime metadata ID와 일치했다. 이 사실이 모든 복사 이력의 origin을 보증하지는 않는다.

보수적 규칙은 다음과 같다.

1. 명시적 `item_completed.thread_id`로 stream을 선택하고 metadata를 ID별로 관리한다. 가장 최근 metadata나 root session_id로 고유 stream을 덮어쓰지 않는다.
2. 원본과 실제 stable stream/item ID가 같은 archive 복사는 dedup할 수 있다. 서로 다른 fork thread의 동일 문자열 ID를 무조건 같은 실행으로 합치지 않는다.
3. `forked_from_id`는 관계 후보이며 복사된 이벤트 범위를 자동 증명하지 않는다. `subagent_history_start_ordinal`만으로 event를 버리지 않는다. 검증된 원본/복사 관계가 없는 범위에는 `AMBIGUOUS_ORIGIN`과 낮은 coverage를 남긴다.
4. 구조화 완료 item을 실제 실행의 우선 표현으로 사용한다. 직접 function-call ID가 같은 경우만 동일 표현으로 연결하고, 이름·시간 근접·순서만으로 wrapper와 child를 합치지 않는다.

실제 response call은 custom `exec` 228개, function call 57개였다. 직접 `exec_command`·`write_stdin` response call은 **0개**다. 조사한 command/MCP/file-change의 item ID와 response call_id·item의 alternate call_id·process_id가 직접 일치한 연결은 **0개**였다. internal passthrough에는 turn_id와 create_time이 있었으며 wrapper-child 관계 필드는 확인하지 못했다.

function_call과 function_call_output 사이에서는 57/57개가 같은 call_id로 연결됐고 모두 call이 result보다 먼저 있었다. 미지원 function 이름 때문에 adapter가 연결을 만들지 못한 수를 실제 source 순서 뒤바뀜으로 설명하지 않는다. item 완료와 response call의 연결 0개라는 결과와도 구분한다.

따라서 [FIXTURES](FIXTURES.md)의 `explicitFixtureRelations`, `explicitFixtureKnownCopiedOrdinals`는 **test annotation**이다. 로그에서 보장한 공급자 필드로 처리하지 않는다. code-mode exec 입력을 실행하거나 코드 문자열에서 내부 명령을 복원하지 않는다.

## 상태와 명령 의미

| Command source status | exit_code | 표본 |
| --- | --- | ---: |
| completed | 0 | 329 |
| failed | 1 | 21 |
| failed | 2 이상 | 10 |

cancelled/pending/declined command 완료는 이 표본에서 없었다. 모든 CommandExecution.source는 `unified_exec_startup`이었다. **관측 source status는 명령 의미의 최종 실패 판정과 다르다.** 공식 v0.159.0 구현은 exit_code 0을 completed, 나머지를 failed로 변환한다. `rg` no-match나 `git diff --exit-code` 변경 발견을 의미상 실패로 단정할 수 없다. 이 source status를 adapter가 검증한 semantic-explicit status로 넘기지 말고 검증된 exit-code 분류와 `executionOutcome`을 사용한다. [Pinned tool events](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/tools/events.rs).

실제 command는 관측한 shell launcher와 `-lc` 및 한 문자열 body로 된 argv였다. 단순 synthetic command:string과 두 shape를 모두 검증한다. 기본 privacy contract가 평가 명령을 미지원으로 두므로, shell launcher에서 body를 분류하려면 실행 없이 특정 launcher shape를 해석하는 adapter 계약을 먼저 정한다. compound/expansion/환경 대입/알 수 없는 shell semantics는 operationKey=null이다. 분류를 위해 실제 명령을 실행하거나 새 파일을 읽지 않는다.

## Duration과 구간

360개 command의 duration은 nonnegative secs와 `0 <= nanos < 1e9`였다. 기존 P0 command/MCP 후보 362개 중 32개는 direct duration과 item 경과 경계가 1 ms보다 달랐다. `_ms` envelope는 item lifecycle을 관측한다. 숫자가 비슷하다는 이유로 직접 duration과 같은 scope로 합치지 않는다.

공식 v0.159.0 unified exec는 spawn 이후에 monotonic 시작을 잡으며 완료 watcher는 output drain·deferred monitor·interaction lock 이후 경과 duration을 기록한다. 이는 해당 backend가 기록한 process execution 경과의 근거이며 CPU 시간·순수 child runtime·공백 없는 실제 작업 시간은 아니다. per-call `wall_time_seconds`는 initial yield나 write_stdin의 응답 대기를 기록하므로 프로세스 전체 runtime으로 합산하지 않는다. [Process manager](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/unified_exec/process_manager.rs), [Completion watcher](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/unified_exec/async_watcher.rs).

P2는 검증된 `unified_exec_startup` source duration과 item interval의 scope/evidence를 별도로 유지한다. 그 밖 source나 형식의 시간 의미가 불명확하면 unknown이다. 직접 duration으로 start를 역산하지 않는다.

### MCP duration 경계

공식 `rust-v0.157.0`의 `core/src/mcp_tool_call.rs`에서 `handle_approved_mcp_tool_call`은 승인 후 호출 경로에서 monotonic clock을 시작한다(L457). 인자 준비·필요한 업로드·RPC·result callback·sanitize·auth elicitation을 기다린 뒤 elapsed를 얻고(L594), 완료 item의 `duration`에 넣는다(L1089). 초기 승인 요청과 선행 started item의 시점은 이 clock 밖이다. `rust-v0.159.0`도 같은 경계를 사용한다(L465/L611/L1100). 따라서 이 경로의 직접 값은 `source_reported`·`invocation_latency`이며 전체 `item_lifecycle`이나 순수 서버 runtime과 같지 않다. [v0.157.0 MCP call](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/core/src/mcp_tool_call.rs), [v0.159.0 MCP call](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/mcp_tool_call.rs).

skip·unavailable·rejected 경로는 같은 완료 생성 함수에 `Duration::ZERO`를 넘긴다(v0.157.0 L2495). 이런 error-only zero는 실측 호출 경과의 증거가 아니다. 호출 경로가 확인되지 않으면 scope와 duration을 unknown/null로 유지한다. 표본의 MCP 2개는 runtime header `0.157.0`에서 유효한 양수 duration·명시적 thread·result를 가졌지만 copied history의 원래 실행 버전까지 확인한 것은 아니다. 다른 모든 버전의 시간 의미가 같다고 일반화하지 않는다.

### Turn 단위 주의

task_complete 73개 중 경계 있는 것은 72개, turn_aborted는 4개 모두 경계가 있었다. 각 endpoint는 Unix seconds 범위였다. 공식 protocol도 started_at/completed_at를 seconds, duration_ms를 milliseconds로 명시한다. seconds를 1,000배 변환하고 item `_ms`는 그대로 처리한다. [Pinned protocol](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/protocol/src/protocol.rs).

duration이 있는 endpoint 76개 중 74개는 `duration_ms - (completed_at-started_at)*1000` 차이가 ±1초 안이었다. S7의 2개는 -1,897 ms/+1,968 ms였다. 초 단위 경계와 ms duration의 정확한 equality를 강제하지 않는다. 초 해상도와 불일치 진단을 보존하고 원인을 추측하지 않는다. envelope ISO timestamp의 floor가 source 경계와 같은 것은 start 33/82개, end 30/77개뿐이었다. 복사 이력의 envelope가 재작성될 수 있어 source endpoint를 envelope timestamp로 임의 대체하지 않는다. pending 끝은 null이다.

## Output envelope와 프로세스 polling

직접 exec_command/write_stdin call이 없어 legacy direct-call pairing은 이 corpus에서 **NOT RUN**이다. code-mode wrapper output의 `input_text`에는 알려진 JSON 모양의 결과 object 182개가 있었고 terminal exit_code가 157개, 실행 중 session_id가 25개였다. 모든 25개 session_id는 같은 sample의 structured CommandExecution.process_id와 문자열 변환 후 일치했다. 2개는 같은 sample에서 반복됐지만 command completed의 process_id는 sample 내 모두 고유했다.

관측한 JSON root의 알려진 형태는 다음과 같다. 임의 output body의 같은 문자열을 이 구조로 해석하지 않는다.

```text
chunk_id: string
wall_time_seconds: number
exit_code?: integer
session_id?: integer
original_token_count?: integer
output: string
```

실제 code-mode의 wrapper header는 `Script completed` → `Wall time <seconds> seconds` → `Output:` 224개와 `Wall time <seconds> seconds` → `Output:` 1개였다. 이는 wrapper 실행 시간이다. chunk/session/exit 값은 공유하지 않았다. 일반 command formatted_output에 아래 direct unified-exec header를 관측한 수는 0개였다.

공식 v0.159.0의 direct unified-exec response header는 다음 순서를 만든다. optional 항목이 있고 `Output:` 뒤는 불투명한 body다. 이 순서는 source 확인이며 이 corpus의 실측 direct legacy 형식 지원은 아니다. 같은 구현은 code-mode result의 session_id가 process_id에서 온다고 명시한다. [Exec output serialization](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/tools/context.rs).

```text
Chunk ID: <id>                         optional
Wall time: <seconds> seconds
Process exited with code <integer>     optional
Process running with session ID <id>   optional
Original token count: <integer>        optional
Output:
```

보수적 fallback은 known exec_command/write_stdin call과 call_id가 연결된 **시작 header 또는 strict top-level result**만 읽는다. Output body나 wrapper 임의 JSON 안에서 프로세스/exit를 검색하지 않는다. launch의 normalized 안전한 상태와 keyed process identity를 보관해 같은 process의 poll을 별도 실행으로 세지 않고 종료를 갱신한다. wall-time 응답들을 더해 runtime을 만들지 않는다. chars가 비어 있지 않은 interaction은 단순 polling으로 자동 제거하지 않는다. direct 호출·poll 누락·이력 모호함은 unknown/diagnostic이다.

## Usage·Replay·Snapshot

301개 실제 top-level `token_usage_record`가 다음 허용 전 원문 envelope를 가졌다. identity는 즉시 keyed ID로 바꾸고 원문 객체를 보관하지 않는다.

```text
timestamp: string, ordinal: integer, type: token_usage_record
payload.thread_id, turn_id, session_id, root_turn_id, response_id: string
payload.usage, turn_token_usage, thread_token_usage: object
usage fields: input_tokens, cached_input_tokens, cache_write_input_tokens,
              output_tokens, reasoning_output_tokens, total_tokens: integer
```

- 301/301 response usage에서 total=input+output, cached<=input, reasoning<=output이었다. cache와 reasoning을 total에 다시 더하지 않는다. cache-write는 전부 reported/default 0이므로 양수 포함 관계의 실제 표본 대조는 NOT RUN이다.
- `(thread,turn,response)` 고유 ID는 301개였다. 이 corpus의 실제 response-ID replay는 0개이므로 replay dedup은 합성 시험과 별도 대조가 필요하다.
- 연속 thread 누적 snapshot 294/294개, 같은 turn snapshot 254/254개는 previous snapshot + response usage와 input/output/total이 일치했다. 따라서 response increment와 누적 source를 합산하지 않는다.
- token_count는 354개다. 직전 response를 가진 324개 중 last snapshot=input/output/total 일치는 323개, cumulative snapshot과 직전 thread snapshot 일치는 242개였다. 한 source가 다른 source를 언제나 대체한다는 근거가 없다. reset·source scope·copied history·지연의 원인은 미확정이다.

같은 response의 여러 usage는 검증된 source ordering과 terminal/final 근거가 함께 있을 때 마지막 완성 값을 한 번 선택한다. 첫 값 고정·모든 snapshot 합산·component별 최대값은 금지다. 이미 final인 값의 모순이나 비교 불가능한 source의 충돌을 임의의 마지막 값으로 덮어쓰지 않는다. final·순서·origin 불명은 provisional/unknown으로 남기고 집계에서 제외한다. turn/thread/token_count snapshot은 별도 source/scope로 보존하며 response 값과 합산하지 않는다. root_turn_id는 group 관계이고 response의 고유 execution stream을 바꾸지 않는다. 단계·도구 토큰 귀속을 만들지 않는다.

### Native response finality 근거

관측 usage가 있는 네 공식 source tag의 생성 경로를 확인했다. `core/src/session/turn.rs`의 `ResponseEvent::Completed` 분기가 `record_observed_response_completed`를 호출한 뒤 sampling loop를 종료한다. `core/src/session/mod.rs`의 생성 함수는 usage가 없으면 record를 만들지 않으며, 있으면 response usage와 별도 turn/thread 누적 값을 top-level `RolloutItem::TokenUsageRecord`로 저장한다.

| 공식 source tag | Completed 분기 → record 호출 | 생성 함수 → persist | Source |
| --- | --- | --- | --- |
| `rust-v0.153.4` | L2591 → L2614 | L4342 → L4372 | [sampling](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core/src/session/turn.rs), [persist](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core/src/session/mod.rs) |
| `rust-v0.157.0` | L2849 → L2872 | L4674 → L4704 | [sampling](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/core/src/session/turn.rs), [persist](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/core/src/session/mod.rs) |
| `rust-v0.159.0` | L2911 → L2934 | L4764 → L4794 | [sampling](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/session/turn.rs), [persist](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/session/mod.rs) |
| `rust-v0.159.2` | L2911 → L2934 | L4764 → L4794 | [sampling](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/core/src/session/turn.rs), [persist](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/core/src/session/mod.rs) |

이 경로의 native record는 response terminal에서 얻은 best-effort final usage의 근거이며 streaming component delta가 아니다. `0.153.4`/`0.157.0` SSE 경로는 `response.completed`를 처리한다. `0.159.0`/`0.159.2`는 interrupted인 `response.incomplete`도 terminal Completed로 매핑하므로 전체 turn 성공·완료를 보증하지 않는다. [v0.159.0 terminal parser](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/codex-api/src/sse/responses.rs).

type 이름만 같은 합성 event_msg, 미검증 source version, copied origin 불명에는 이 finality를 자동 적용하지 않는다. actual native response 301개는 source 의미 조사 후보이고, origin ordinary는 31개, ambiguous는 270개다. ordinary 31개의 response projection은 input 1,711,866·output 7,062·cached 1,583,616·reasoning 2,987·total 1,718,928이다. ambiguous component를 보존해도 eligible total에 넣지 않는다. native ordinal의 연속 294쌍은 모두 증가했지만 같은 response ID 갱신은 없었으므로 last-final 갱신 의미의 실제 대조를 대신하지 않는다.

### Cache-write 포함 관계와 snapshot 감소

공식 `rust-v0.159.0` SSE 매핑은 Responses `input_tokens`를 그대로 input에, `input_tokens_details.cache_write_tokens`를 cache-write component에 넣는다(L128–141). 독립 source unit oracle은 input 100·cached 40·write 60·output 10·total 110이다(L798–821). 공식 Prompt caching guide도 ordinary input을 input-cached-write로 정의한다. 따라서 확인된 OpenAI Responses 매핑의 cache read/write는 이미 input에 포함되며 total에 다시 더하지 않는다. eligible 선택 전 `cached + cacheWrite <= input`, `reasoning <= output`, `total = input + output`을 검증한다. [Codex SSE mapping](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/codex-api/src/sse/responses.rs), [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

네 source tag 모두 누락 cache-write detail을 기본값 0으로 매핑한다. 실표본의 0은 실제 cache write가 없다는 증명이 아니며 입력에 이미 포함된 값인지에 관한 양수 실측 지원도 아니다. 필수 input/output 누락 또는 미검증 포함 관계는 확인한 component와 partial/invalid 근거를 보존하고 total을 null로 둔다. optional cache/reasoning 누락은 해당 component를 null/partial로 남기며, 확인된 input+output total은 보존할 수 있다. 차감에 필요한 cache 값이 없으면 차감값은 null이다.

독립 snapshot 대조에서 token_count_last의 total 등식 위반은 2/354개이며 모두 runtime header `0.153.4` 그룹이다. 최근 response 값의 감소는 token_count_last 166/345 연속 쌍이었다. token_count_total 345쌍·thread_snapshot 294쌍·같은 turn_snapshot 254쌍의 감소는 0개였다. last는 누적 값이 아니므로 응답 사이 감소를 `USAGE_RESET`으로 진단하지 않는다. 같은 누적 source/scope의 감소와 source 간 불일치를 구분한다.

## Lookup·편집 범위

구조화 `parsed_cmd`에는 read `{type, cmd, name, path}` 21개, query가 있는 search `{type, cmd, query, path}` 1개와 list_files `{type, cmd, path}` 2개가 있었다. 조사한 read/search 구조에는 line range·offset·limit·content fingerprint·unchanged 근거가 없었다. 기본 파일 식별·재방문 후보는 만들 수 있지만 같은 파일의 완전한 내용/범위·불필요한 반복으로 승격하지 않는다. raw stdout이 존재한다는 사실만으로 읽기 결과의 완전성·범위를 보장하지 않는다.

FileChange의 81개 shape를 shell/MCP와 구분한다. 이번 P2는 shell/MCP를 지원하고 FileChange는 `UNSUPPORTED_RECORD`와 coverage로 남긴다. 편집→검증/Context Churn의 완료를 주장하지 않는다. 편집 지표 구현 전 독립적인 FileChange의 대상/변경 의미와 합성 기대값 대조가 필요하다.

## 합성 보강·정규화 대조 gate

합성 보강은 기존 [FIXTURES](FIXTURES.md)의 Codex shape를 유지하며 다음 독립 사례를 검증 대상으로 삼는다.

1. 실제 argv-array shell shape, `input_text`/`input_image`, top-level usage와 unsupported DynamicToolCall.
2. item ID와 wrapper call_id가 다른 code-mode. wrapper input 코드를 읽거나 실행 없이 실제 command/MCP만 집계. 동명의 unrelated call은 합치지 않음.
3. source failed+exit1와 단순 rg/git semantic outcome, compound unknown. source marker만으로 실행 실패를 확정하지 않음.
4. seconds turn endpoint·millisecond item endpoint, coarse resolution·duration 불일치·aborted·완료 표식만 있는 turn.
5. strict direct header와 JSON result, Output body의 위조 header/JSON, polling session 갱신·nonempty chars·duration-only·누락 결과.
6. response replay·변경된 동일 ID·누적 snapshot·token source 불일치/reset, copied metadata 순서와 annotation 없는 origin 불명.

로컬 대조는 S4–S12의 source shape 수, normalized keyed 실행·turn·usage·진단의 aggregate와 timing scope를 메모리 안에서 비교했다. 원본 identity/key/path나 normalized 원문을 출력하지 않았다. source checksum·레코드 수·입력 불변성과 같은 입력 replay를 검사했고 unsupported/fork/legacy의 이유와 한계를 아래에 기록했다. 부분 호출 결과 갱신은 실제 direct-call 표본이 없어 합성 시험과 구분한다.

파서 실행 전 독립 구조 대조에서 reader-eligible 3,104개 중 shell/MCP stable `(thread,item)` identity는 362개, response `(thread,turn,response)` identity는 301개였다. 표본 사이의 같은 stable identity 중복은 각각 0개다. task_started 82개·task_complete 73개·turn_aborted 4개이며 고유 명시 turn은 84개다. terminal 경계와 direct duration이 함께 있는 것은 76개다. 이 수는 파서 결과에서 산출한 oracle이 아니며, archive replay를 새로 만드는 시험과 구분한다.

선두 metadata에 fork 표시가 있는 S6/S7/S8/S10/S12의 기여 후보는 shell/MCP 246/362개·response usage 270/301개·turn boundary record 144/159개다. 이는 origin 모호함을 드러낼 분모이며 복사된 실행 수가 아니다. source ID가 다른 fork 실행을 임의 삭제하거나 root session으로 합치지 않는다.

### 로컬 대조 프로토콜

고정 manifest의 byte prefix만 read-only로 읽고 실행 전후 digest 일치를 검사한다. LF를 제외한 raw line bytes가 1 MiB 이하면 parsed record를 adapter에 전달한다. 초과 3개는 독립 splitter에서 제외 수와 offset 진행만 확인한다. 이번 adapter 대조는 P1 reader·CLI·DB를 연결한 end-to-end 시험이 아니다.

구조 조사에서 먼저 확보한 shell/MCP 362개·turn 84개·native response 301개의 고유 ID와 수치를 기준으로 한다. 원문 identity는 메모리 안에서 시험 전용 HMAC context로 비교하고 출력하지 않는다. shell/MCP의 ID·stream·turn·exit code·direct duration·source endpoint·각 scope/evidence를 대조한다. turn의 source seconds 변환·상태·pending 끝 null과 native usage의 response 관계·component·finality·origin 제외를 별도로 대조한다. aggregate 상태 기준은 completed 329개·unknown 30개·failed 3개다. 실패 3개는 단순 `rg`의 오류 exit(2 이상) 1개와 MCP `isError` 2개이며 source failed 31개를 그대로 실패 수로 쓰지 않는다. response뿐 아니라 turn/thread/token_count source의 usage 1,611개와 `observedUsage` 원천 관측을 각각 수치·관계·scope·mapping으로 대조한다.

9개 표본을 각각 기본 한도로 실행한 결과와 통합 9개 결과를 구분한다. 같은 source 재입력은 source 관측·진단·canonical 의미와 counter의 불변성을 검사한다. 기존 prefix를 다른 합성 fileIdentity로 재표현하는 시험은 stable identity 중복 제거 시험이며, 실제 archive 파일을 추가 조사한 결과가 아니다. 이 재표현 시험에서는 observations 40,000개·diagnostics 25,000개로만 한도를 명시 확장한다. 기본 한도 시험 결과와 섞지 않는다.

privacy 대조는 입력에서 수집한 **16자 이상인 서로 다른 원문 후보 6,141개**를 대상으로 한다. 식별자·경로·명령·prompt·output 등이 포함되며 UTC timestamp와 `type`·`status`·`source`·`cli_version`·`model` 필드의 display/분류 문자열은 비교에서 제외한다. `inspectRetainedState()`가 반환하는 snapshot·source/stream·execution/pending/process/poll·snapshot pairing 상태의 JSON에 원문 후보가 완전한 문자열 값으로 남는지 확인한다. 이는 해당 반환 상태와 선정된 문자열의 대조다. 짧은 문자열 전체, VM heap 또는 원문의 완전한 zeroization을 검증한 것으로 확대하지 않는다.

### 2026-10-01 로컬 대조 결과

Node `v26.7.0`, `parserVersion=1`에서 KST 2026-10-01에 실행했다. 아래는 고정된 P0 prefix의 독립 기준과 adapter snapshot을 비교한 결과다. unsupported-call 진단·usage 선택·wrapper aggregate budget 보완 후 개발 세션이 고정한 최종 빌드로 통합·개별·archive 시험을 모두 재확인했다. raw 입력에는 trusted wrapper 관계가 없어 `wrapperChildLinks=0`이었다. 후보 수를 지표의 확정 eligible 실행 수나 전체 corpus의 지원율로 해석하지 않는다.

| Runtime header | Samples | Reader eligible | Shell/MCP 기준 / adapter | Turn 기준 / adapter | Native response 기준 / adapter | Response eligible / provisional | 제외·미지원 근거 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `0.149.0-alpha.4.3` | S4, S5 | 306 | 73 / 73 | 4 / 4 | 0 / 0 | 0 / 0 | native response 없음; token_count 58개는 매핑 미검증·partial snapshot |
| `0.153.4` | S6, S7 | 1,716 | 98 / 98 | 63 / 63 | 193 / 193 | 0 / 193 | origin ambiguous; oversized 1개; last snapshot 등식 위반 2개 |
| `0.157.0` | S8, S9 | 683 | 135 / 135 | 11 / 11 | 70 / 70 | 27 / 43 | S8 origin ambiguous·oversized 2개; S9 native terminal 27개 |
| `0.159.0` | S10, S11 | 206 | 23 / 23 | 3 / 3 | 20 / 20 | 4 / 16 | S10 origin ambiguous; S11 native terminal 4개 |
| `0.159.2` | S12 | 193 | 33 / 33 | 3 / 3 | 18 / 18 | 0 / 18 | origin ambiguous; 복사 metadata의 버전으로 owner를 바꾸지 않음 |
| 합계 | S4–S12 | 3,104 | 362 / 362 | 84 / 84 | 301 / 301 | 31 / 270 | runtime 버전과 원래 실행 버전을 구분 |

| 대조 대상 | 실제 결과 | 검증 범위 |
| --- | --- | --- |
| 실행 후보 | completed 329·unknown 30·failed 3; ordinary 116·ambiguous 246 | ID·stream/turn·exit·362개 direct duration/endpoint/scope 불일치 0; 상태 aggregate 기준 일치 |
| 실행 시간 | process_runtime 360·invocation_latency 2; item_lifecycle 362 | duration과 boundary의 32개 불일치를 별도 scope로 유지; 같게 만들거나 start를 역산하지 않음 |
| Turn | completed 73·cancelled 4·pending 7 | 84개 ID·상태·source endpoint 불일치 0; duration 76개는 turn_elapsed, wall interval 77개는 turn_wall; pending 7개 interval unknown |
| Metadata | 13개; ordinary 4·ambiguous 9 | owner/declared ID·version fingerprint 불일치 0; 9개 선두 header 버전 보존 |
| Usage | response/turn/thread 각 301개, token_count_total/last 각 354개 | 1,611개 ID·관계·component·scope·selection·finality·mapping 불일치 0; observedUsage 원천 관측 1,611개도 불일치 0 |
| Usage 선택 | eligible 31·provisional 270·snapshot_only 1,308·invalid 2 | native response 31개만 source_terminal로 선택; ambiguous response 270개는 component를 보존하고 제외 |
| Usage 품질 | complete 1,551·partial 58·invalid 2 | partial 58개는 구형 매핑 불명 snapshot; invalid 2개는 등식 위반 last snapshot |
| 미지원 function 관계 | unsupportedCalls 57·pendingResults 0 | 실제 call→result 57쌍에 false REORDERED_RECORD 0; 별도 실행으로 추가하지 않음 |
| Snapshot 감소 | USAGE_RESET 0 | last snapshot의 정상 감소 166쌍을 cumulative reset으로 표시하지 않음 |

eligible response projection은 input 1,711,866·output 7,062·cached 1,583,616·reported/default cache-write 0·reasoning 2,987·total 1,718,928로 독립 기준과 일치했다. native terminal은 응답의 final usage 근거이며 완료된 turn 73개와 같은 분모가 아니다.

9개 개별 실행과 통합 실행 모두 기본 한도에서 `stateLimited=false`, `diagnosticsDropped=0`이었다. 통합 상태는 observations 6,472개·diagnostics 4,591개였으며 `coverage=partial`, `support=shape_verified_only`를 유지했다. diagnostics는 UNSUPPORTED_RECORD 1,379개·UNSUPPORTED_RELATION 509개·UNSUPPORTED_COMMAND 91개·INSUFFICIENT_OPERATION_CONTEXT 91개·INSUFFICIENT_LOOKUP_EVIDENCE 20개·AMBIGUOUS_ORIGIN 2,496개·INVALID_USAGE 2개·INSUFFICIENT_ERROR_EVIDENCE 3개다. 한 record에 여러 code가 있을 수 있어 진단 합계는 record 분모가 아니다.

같은 source replay는 event·turn·usage의 canonical 의미와 state/counter가 불변이었다. 별도 fileIdentity의 메모리 내 archive 재표현은 observations 12,944개·metadata 26개·diagnostics 9,182개로 출처 관측만 늘었고 event 362개·turn 84개·usage 1,611개·response 301개의 ID·수치·선택·의미는 불변이었다. 이 시험은 명시 확장 한도에서 제한 초과 없이 실행됐다. 모든 단계에서 고정 prefix digest가 일치했고 선정된 민감 문자열의 retained-state 노출은 0개였다.

확인한 것은 이 고정 prefix와 명시 필드의 adapter 동등성이다. 실제 legacy direct-call/polling, 변경된 동일 response ID의 실제 partial→final/replay, 추가 archive 원본과의 대조, fork copied-boundary 의미, 양수 cache-write의 실제 표본 대조는 **NOT RUN**이다. 이 행동의 합성 시험과 원본 관측을 구분한다. reader·CLI·DB·metrics·HTML을 연결한 제품 acceptance, 전체 버전 지원과 성능 검증도 이 대조의 범위 밖이다. pinned source의 의미 근거는 확인한 tag에 한정되며 runtime header만으로 복사 이력의 원래 실행 버전이나 모든 버전의 동일 동작을 보증하지 않는다.
