# Claude Code Adapter Evidence — P3

조사·최종 대조일: **2026-10-01 KST**. 연구 기준은 main `baa384f779d5eab6d31a6c7099372f19a1d98496`이며 P3 계획은 [CLAUDE-PARSER](CLAUDE-PARSER.md)에 있다. 별도 연구 담당이 기존 P0 S1–S3의 고정 prefix를 읽기 전용으로 재현하고 부모가 승인한 frozen P3 build의 parserVersion 1을 독립 기대값과 대조했다. **bounded shape/keyed parity·replay·기본 상한·선정 문자열 privacy 대조는 PASS**다. coverage는 partial이며 실제 usage finality는 unknown/provisional이다. 모든 공급자 버전 지원·P4 통합·제품 acceptance·진단 precision·성능·사람 파일럿은 이 결과로 통과하지 않는다.

## Corpus and reproducibility

P0의 manifest에 저장된 바이트 길이만 읽고 각 prefix의 SHA-256을 RAM에서 대조했다. 세 digest가 모두 같았다. 이후 append나 다른 파일은 조사하지 않았다. manifest와 조사 스크립트는 저장소 밖의 private 디렉터리 `0700`, 파일 `0600`으로 유지한다. 실제 source 경로·ID·digest·프롬프트·명령·코드·출력은 문서나 fixture에 복사하지 않는다. 원문은 조사 과정의 RAM에서만 처리하며 명령을 실행하지 않는다.

| 익명 표본 | 선택 버전 | 고정 bytes | 완전 LF records / reader eligible | UUID records | assistant usage records / 고유 message IDs | paired tool_use / tool_result |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| S1 | 2.1.222 | 86,662 | 47 / 47 | 34 | 17 / 8 | 6 / 6 |
| S2 | 2.1.241 | 1,648,697 | 741 / 741 | 535 | 341 / 135 | 156 / 156 |
| S3 | 2.1.241 | 1,505,302 | 391 / 391 | 391 | 268 / 108 | 118 / 118 |
| 합계 | 두 선택 버전 | 3,240,661 | 1,179 / 1,179 | 960 | 626 / 251 | 280 / 280 |

malformed·1 MiB 초과 line·미완성 LF bytes는 각각 0이다. LF만 제외한 최대 raw line bytes는 S1 11,200 / S2 183,693 / S3 192,759였다. CR/BOM은 line 한도에 포함한다. 이 수치는 선택 prefix의 재현 결과이며 전체 Claude Code 로그의 분포나 reader 성능을 설명하지 않는다.

P0 선택 시점은 2026-09-30 19:52 KST다. source timestamp 범위는 2026년 S1 `08-09 07:18:11.957–07:19:57.594 UTC`, S2 `08-24 02:12:37.449–03:23:59.405 UTC`, S3 `08-23 02:12:13.595–02:29:02.366 UTC`였다. [P0 EVIDENCE](EVIDENCE.md)의 동일 표본을 다시 읽은 것이므로 새 표본처럼 합산하지 않는다. `version`은 UUID를 가진 960 records에 존재했다: 2.1.222 34개, 2.1.241 926개. 나머지 219개에는 이 필드가 없었다. 파일 선택 버전을 모든 레코드의 실행 버전이나 복사 이력의 원래 버전으로 확대하지 않는다.

## Source authority and limits

공식 자료 확인일은 2026-10-01이다. 아래의 공개 API·SDK·OTel 의미는 local transcript의 모든 버전에서 같은 저장 시점을 보장하지 않는다.

| 1차 출처 | 확인한 의미 | 이번 조사에서의 경계 |
| --- | --- | --- |
| [Claude Code Monitoring](https://code.claude.com/docs/en/monitoring-usage#event-correlation-attributes) | transcript는 내부 형식이며 버전별 join이다. API response를 content block별 entry로 저장하고 OTel의 최종 `message.uuid`로 연결한다 | 이 표본에는 해당 OTel 종결 이벤트가 없다. `assistant` entry 자체를 전체 response final로 올리지 않는다 |
| [Agent SDK streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output#message-flow) | 완성한 content block마다 AssistantMessage를 내보내며 같은 message ID를 공유한다. message_delta/message_stop 및 최종 ResultMessage는 별도다 | 완성 content block과 최종 response usage를 구분한다. SDK stream envelope를 local JSONL schema로 취급하지 않는다 |
| [Messages streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) · [Stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons#streaming-considerations) | message_delta usage는 누적 snapshot이며 마지막 message_stop이 별도로 있다. stop_reason는 message_delta에 제공된다 | local `message.stop_reason`와 durable final 저장 시점을 연결하는 보장은 미검증이다 |
| [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#tracking-cache-performance) | ordinary input·cache read·cache creation을 더해 all-input을 얻는다. TTL bucket은 creation의 내역이다 | 아래 실제 필드 매핑과 숫자 검사를 별도로 기록한다. API finality를 local 기록에 자동 이식하지 않는다 |
| [Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions#fork-to-explore-alternatives) | fork는 history를 복사한 새 session ID를 만든다. SDK가 session 조회 API를 제공한다 | raw transcript의 복사 경계나 `forkedFromSessionId` 필드 보장은 이 설명에 없다. 합성 fork annotation을 실제 필드로 취급하지 않는다 |

이 조사는 local JSONL만 읽었다. API 요청·SDK 실행·OTel 수집·원격 transcript 조회는 하지 않았다. 현재 공식 문서를 과거 CLI 2.1.222/2.1.241의 전체 schema 보장으로 표현하지 않는다.

## Identity, parent and stream observations

| 실제 경로 / 타입 | 표본에서 확인한 관계 | 보수적인 파서 권고 |
| --- | --- | --- |
| root `sessionId:string`, `uuid:string`, `parentUuid:string|null`, `isSidechain:boolean` | UUID records 960개 모두 session/sidechain을 가진다. stream별 UUID 중복 0 | session·sidechain·agent를 구분한 stream에서 UUID replay를 판정한다 |
| root `agentId:string` | S3 391 records에 같은 agent ID와 `isSidechain:true`; S1·S2 UUID records는 false이며 agent ID 없음 | sidechain을 root session과 합치지 않는다. 필요한 agent identity 누락은 unknown/coverage로 남긴다 |
| root `session_id:string` | S2 511 records에 있으며 모두 `sessionId`와 같다 | 이 부가 필드만으로 새로운 owner/fork 관계를 만들지 않는다 |
| root `message.id:string` | assistant 626 records가 251 API message IDs를 공유한다. 각 assistant content array 길이는 1 | UUID는 block/record identity, message ID는 response usage identity로 분리한다 |
| root `requestId:string` | S1 17 assistant records / 8 message IDs에만 관측 | 부재를 새 response로 간주하지 않는다. message ID와 request ID는 별도 의미다 |
| `message.content[].tool_use.id:string`, `.name:string`, `.input:object` | 280 calls, stream 내 고유 ID 280 | `(stream, tool_use ID)`로 실행을 HMAC 처리한다. tool input은 fingerprint 경계를 지난 뒤 버린다 |
| `message.content[].tool_result.tool_use_id:string` | 280 results가 모두 같은 stream의 call과 짝지어짐 | 직접 ID로 연결한다. source 파일이나 가까운 시각으로 다른 stream을 연결하지 않는다 |
| root `sourceToolAssistantUUID:string`, `parentUuid:string` | result 280/280에서 두 값 모두 대응 call UUID와 같음 | 검증한 직접 관계만 보존한다. 충돌·누락·결과 선행은 별도 진단과 bounded pending 상태로 처리한다 |

UUID parent 문자열 956개가 모두 같은 stream에서 해소됐다. parent가 뒤 ordinal에 있는 사례는 0이지만 parent→child timestamp 감소는 4개였다. 부모 관계가 시간 구간이나 전역 정렬을 보장하지 않는다. parent `null`은 4 records, parent 없는 metadata records는 219개다. 식별 필드가 없는 metadata를 가상의 공통 stream으로 묶지 않는다.

tool_use record 수와 `(stream, tool_use ID)` 수는 S1 6/6, S2 156/156, S3 118/118로 같다. 실제 동일 call ID 재등장은 0이므로 최초/마지막 call timestamp 선택 차이는 이 표본으로 검증하지 못했다. 합성 replay에서 같은 call의 input/meaning이 유지되면 최초 검증된 start를 보존한다. 다른 UUID의 usage 갱신이 기존 call start를 옮기거나, 뒤에 도착한 timestamp를 근거 없이 min으로 치환하지 않는다.

세 표본에는 고유 declared sessions 3개와 tool-bearing streams 3개가 있다. 동일 stream의 UUID/message/tool-use/result ID가 다른 표본에 반복된 사례는 0이다. 실제 archive 복사·UUID replay·fork copied range는 이 표본에서 검증하지 못했다. S3 compact boundary에는 `logicalParentUuid`가 1개 있지만 이는 복사 경계 증거가 아니다.

## Results, launch and timing

tool_result body는 string 279개 / array 1개였다. root `toolUseResult`는 object 268개 / string 12개였다. body를 operation/error 비교용 HMAC 경계에서 읽을 수는 있지만 원문·stdout/stderr·patch·prompt를 pairing 상태나 오류 메시지에 보관하지 않는다.

| 실제 shape | 확인한 개수 / 의미 | 이번 지원 경계 |
| --- | --- | --- |
| Bash result `stdout:string`, `stderr:string`, `interrupted:boolean`, `isImage:boolean`, `noOutputExpected:boolean` | 185 objects; interrupted는 모두 false | stdout/stderr를 success·empty-output·exit 0으로 바꾸지 않는다 |
| tool_result `is_error:boolean` | true 12 / false 185 / missing 83 | tool 실패·성공 관측과 child-process exit를 분리한다. missing은 false가 아니다 |
| Bash `backgroundTaskId:string`, call input `run_in_background:true` | 5 launch acknowledgements; is_error false | canonical event는 pending, end/duration null. acknowledgement 시점·latency만 source observation에 남긴다 |
| Agent `isAsync:true`, `status:"async_launched"`, `agentId:string`, `outputFile:string` | 1 launch acknowledgement; is_error 없음 | pending이다. 이 result의 agent ID는 S3와 일치하지 않아 parent를 추정하지 않는다 |
| Read `toolUseResult.file:object` | 21; `filePath/content:string`, `numLines/startLine/totalLines:number` | content 원문은 버린다. input Read 21개 중 offset+limit 명시 범위는 9개뿐이며 line 범위 의미 검증은 후속 gate다 |
| Edit/Write `filePath`, `structuredPatch`, `originalFile`, `userModified` 등 | typed metadata가 있으나 body/patch는 원문 | 확인한 fingerprint만 유지한다. 단순 result 존재로 작업 성공을 발명하지 않는다 |
| root `system`, `subtype:"turn_duration"`, `durationMs:number` | 8 nonnegative safe integers, parent는 모두 end_turn assistant UUID | duration-only 관측이다. source scope가 미검증이므로 `durationScope:"unknown"`, interval/start/end null. source timestamp는 관측 시점으로만 보존한다 |

280/280 call/result timestamps는 parse 가능하고 nonnegative였다. 이는 호출 기록→결과 기록의 **observed latency**이며 프로세스 runtime이 아니다. 직접 `toolUseResult.durationMs/duration_ms/duration`은 0/280이다. background의 launch acknowledgement를 process 종결점으로 쓰지 않는다. later user body에 task ID가 언급된 4개도 검증된 terminal envelope가 아니다.

부모가 선택한 계약에서는 정상 274개에 대해 이 elapsed를 canonical `durationMs`와 interval에 함께 보존한다. 두 값의 evidence/scope는 `paired_timestamps`/`invocation_latency`다. source-reported tool runtime이 생겼다는 뜻이 아니다. background 6개의 canonical end/duration/interval은 null이며 source result observation의 `acknowledgementLatencyMs`에만 call→ack 간격을 보존한다. 정상 result의 acknowledgementLatencyMs는 null이다.

실제 child-process exit field는 관측되지 않았다. Bash 오류 body의 고정 모양에서 exit 1/2/127을 RAM에서 본 사례가 각각 7/2/1개 있지만 이를 검증한 구조적 exit schema로 올리지 않는다. rg/grep 관련 exit1 사례 4개는 모두 shell control을 포함하므로 단순 no-match로 분류할 수 없다. 별도 2개 Bash objects에는 `returnCodeInterpretation:string`의 no-match 설명과 is_error false가 있었지만, 설명 문자열만으로 전체 command 의미를 확정하지 않는다. 원문은 공유하지 않는다.

위 상태 계약의 **독립 기대값과 최종 parser 결과**는 모두 completed 180 / failed 12 / unknown 82 / pending launch 6 = 280이었다. source is_error false 185개 중 Bash launch 5개를 pending으로 분리하고, missing 83개 중 Agent launch 1개를 pending으로 분리한 결과다. 전체 제품의 실패율이 아니다.

## Usage replay and finality

| 표본 | records / message IDs | 같은 message ID의 usage 값 변경 | stop_reason 관계 |
| --- | ---: | ---: | --- |
| S1 | 17 / 8 | 0 IDs | 17 records 모두 tool_use 또는 end_turn |
| S2 | 341 / 135 | 0 IDs | 341 records 모두 tool_use 또는 end_turn |
| S3 | 268 / 108 | 108 IDs | 앞 160 records는 null. 각 ID의 마지막 ordinal 108 records만 tool_use 107 / end_turn 1 |

S3 변경은 모두 `null→non-null stop_reason` 전이의 `output_tokens` 증가였다. 네 기본 component의 감소는 0이며 input/cache 값은 유지됐다. 각 ID에서 non-null 뒤 partial 재등장은 0이었다. 같은 ID의 timestamp 동률·역전도 0이었다. 이는 이 고정 prefix의 순서 관측이며 모든 replay·resume·fork의 순서 보장이 아니다.

**실제 251 usage IDs의 finality는 unknown, selection은 provisional로 권고한다.** `message_delta/message_stop`, SDK result, 대응 OTel assistant_response 종결 이벤트가 이 prefix에 없다. `message.stop_reason`가 공식 enum이고 마지막 레코드에 나타나도 local transcript 저장 단계와 API 종결을 연결하는 근거는 부족하다. S2는 모든 block entry에 non-null stop_reason가 있어 단순 존재 검사는 더욱 부족하다. 알려진 enum은 terminal-shaped candidate 정보만 보존한다. 현재 eligible response usage는 0이라는 계약이며 토큰이 0이라는 뜻이 아니다.

UUID replay 제거와 message ID usage upsert는 별개다. 같은 UUID의 exact replay는 관측 수만 갱신하고 새로운 실행을 만들지 않는다. 같은 message ID의 서로 다른 UUID/content block를 통째로 버리면 tool call을 잃을 수 있다. canonical usage 선택과 626개의 source count observations를 분리한다. 조사용 마지막 source-record candidate는 수치 대조에만 쓰며 verified final/제품 집계로 쓰지 않는다. 첫 snapshot 고정·모든 snapshot 합산·component별 max는 금지한다.

## Anthropic token accounting

`message.usage`의 `input_tokens/output_tokens/cache_read_input_tokens/cache_creation_input_tokens`는 626/626 records에서 nonnegative safe integer였다. 610/626에서 cache read가 ordinary input보다 컸다. OpenAI의 included-cache 계약을 원천 `input_tokens`에 적용하면 틀린다. [공식 cache 회계](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#tracking-cache-performance)에 따라 아래 매핑을 사용한다.

```text
mapping = anthropic_messages
uncachedInput = input_tokens
input = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
cachedInput = cache_read_input_tokens
cacheWriteInput = cache_creation_input_tokens
output = output_tokens
total = input + output
```

기존 Codex `TokenCounts.input`의 all-input 의미와 값을 유지한다. Claude의 ordinary input은 Claude 전용 nullable `uncachedInput` 또는 별도 breakdown으로 보존한다. Claude에서는 cache-read/create가 all-input 계산에 필요한 값이므로 누락을 0으로 채우지 않는다. 필수 component 누락·음수·비정수·overflow·미검증 mapping이면 영향을 받는 input/total을 null로 두고 partial/invalid를 보존한다. mapping이 확인돼도 finality가 unknown이면 eligible로 승격하지 않는다.

`usage.cache_creation`의 `ephemeral_5m_input_tokens`와 `ephemeral_1h_input_tokens`는 존재한 466/466 records에서 합이 cache_creation_input_tokens와 같았다. [공식 TTL 정의](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#1-hour-cache-duration)도 상위 creation의 내역으로 설명한다. 이 bucket과 상위 creation을 다시 더하지 않는다. 없는 160 records에서 bucket을 0으로 채우지 않아도 상위 필드가 검증돼 있으므로 기본 회계는 유지할 수 있다.

`output_tokens_details.thinking_tokens:number`는 449 records에서 관측됐다. 이번 조사에서 local 포함 관계·정확한 source mapping은 검증하지 못했으므로 reasoningOutput은 null로 권고한다. thinking block 길이·토큰 추정·세부 필드를 output에 추가하지 않는다. `iterations`가 있는 466 records 중 길이 1은 17 / 길이 0은 449였다. 이를 상위 usage에 다시 더하지 않는다. tool/phase 귀속은 null/unknown이다.

## Recommended API and finite state

아래 API/상한은 연구 담당의 구현 전 권고다. 부모 검토에서는 **Claude 전용 타입을 사용하고 기존 Codex 타입/API/출력을 변경하지 않는 방식**을 선택했다. 개발에 적용할 정확한 타입·상한·Verify는 [선택된 CLAUDE-PARSER 계약](CLAUDE-PARSER.md)을 따른다. provider 공통 union 확장은 이번 선택에 포함되지 않는다.

권고 API의 형태는 아래와 같다. ingest/snapshot의 구체 필드는 선택된 계약에 따라 개발 담당이 구현한다.

```ts
createClaudeAdapter(identityContext, limits)
  .ingest(record, { fileIdentity, sourceAlias, byteOffset, ordinal, trustedFixtureContext? })
  .snapshot()
  .inspectRetainedState()
```

ingest batch는 keyed upserts다. 최종 개수는 snapshot에서 확인한다. source observations에는 직접 관계·allowlisted 상태·acknowledgement timestamp/latency·usage 원천 component/finality/mapping만 보존한다. HMAC은 provider와 stream을 domain으로 분리하고 session/agent/UUID/tool-use/message ID와 원문 fingerprint를 즉시 변환한다. record source file identity도 HMAC 처리한다. 호출 input·result body·임의 metadata strings는 상태에 두지 않는다.

초기 상한 권고: sources/streams 각각 256, events/turns/usage/UUID replay와 usage-order 상태 각각 4,096, pending/result/background/parent 관계 각각 1,024, observations/metadata/diagnostics 각각 8,192. 배열 안의 관계도 collection의 총합 상한에 포함한다. 각 Map/Set과 관계 총합을 명시해 숨은 무제한 상태를 남기지 않는다. record 처리의 canonical JSON depth 32 / nodes 8,192 / 단일 raw line 1 MiB 경계를 유지한다. 한도 초과는 STATE_LIMIT·partial coverage로 드러내고 기존 안전 상태를 보존한다. 실제 메모리·성능 예산 통과를 주장하지 않는다.

같은 stream의 UUID 충돌, 같은 tool-use ID의 다른 input, result 상태 충돌, usage 역순·미확인 순서·동일 final의 모순은 unknown/conflicted와 safe 진단으로 남긴다. 모든 오류 경로는 공급자 원문·예외 message/stack을 출력하지 않는다. 아카이브 재표현의 file provenance와 canonical 실행 identity를 분리한다.

## Immutable fixture contracts and fork context

기존 [claude-message](../tests/fixtures/providers/claude-message.jsonl), [claude-fork](../tests/fixtures/providers/claude-fork.jsonl), [provider expected](../tests/fixtures/providers/expected.json)는 그대로 유지한다. 아래는 test harness가 주는 신뢰 관계이며 provider 레코드의 임의 필드에서 읽지 않는다.

- usage 6→6→10은 같은 message ID의 partial/order1, exact replay/order1, final/order2로 명시한다. mapping은 anthropic_messages다. trusted final 10을 한 번 선택해 uncached 100 + read 30 + create 20 = input 150, output 10, total 160을 검증한다. context가 없으면 finality unknown/provisional이다.
- synthetic a1-final의 뒤 UUID와 timestamp는 usage 갱신용이다. 같은 ct1/ct2 call의 `00:00:00` start를 `00:00:09`로 옮기지 않는다. 이미 연결된 `00:00:04` 결과와 4,000 ms interval을 보존한다. call ID/input 의미 충돌은 단순 replay로 숨기지 않는다.
- final 뒤 trusted older partial replay는 final을 바꾸지 않는다. 미지 순서의 다른 snapshot·동등 final의 모순은 제외/진단한다. finality와 origin eligibility는 별개다.
- fork는 외부 trusted owner session과 known copied ordinals를 주어야 한다. 합성 fork의 copied ordinals 2·3과 original-file 관계를 test harness에 고정한다. 실제 `forkedFromSessionId`, 파일 이름, cross-stream parentUuid, logicalParentUuid만으로 copied/new 경계를 만들지 않는다. 실제 미확인 복사는 ambiguous origin이며 숫자를 발명해 제거하지 않는다.
- synthetic ct3의 2,500 ms는 검토한 trusted timing context로만 source duration을 검증한다. 3,000 ms call/result interval과 같게 강제하지 않는다. source scope를 context로 검증하지 않으면 unknown이며 process runtime으로 승격하지 않는다.
- synthetic turn duration 9,000 ms도 위치 없는 값이다. background launch·실제 duration 부재·복수 blocks·결과 선행/누락·중복·cross-stream 충돌은 별도 행동 사례로 추가하며 기존 기대값을 구현에 맞춰 바꾸지 않는다.

## Final bounded parser verification

private `manifest.json`은 원래 P0 manifest를 참조하고 S1–S3 cutoff를 고정한다. `claude-inspect.mjs`는 구조·관계를 집계한다. 별도 `claude-parity.mjs` v2는 direct fields에서 ID pairs·source is_error·launch·timestamp·duration-only turns·usage counts를 독립 계산한다. P1 HMAC protocol의 독립 계산을 공개 Claude helpers와도 대조했다. semantic 판단에 어댑터의 분기 로직을 복제하지 않는다. manifest에는 frozen build와 harness의 hash, aggregate-only 결과 파일을 기록했다. 실제 source digest·경로·ID는 공유하지 않는다.

부모의 재freeze 승인 뒤 최종 실행은 **2026-10-01 10:35:00.753–10:35:04.662 KST**, Node **26.7.0**, elapsed **3,908 ms**였다. 이는 아래 여러 대조의 harness 실행 시간이며 제품 scan/report 성능 측정이 아니다. 모든 단계에 trusted fixture context를 주지 않았다. prefix digest 세 개가 다시 일치했고 동일 1,179 records만 사용했다. 실행 전후 dist의 22개 module과 독립 harness hash가 같았다. source API/build는 실행 중 고정했다.

초기 frozen-build 대조는 같은 날 10:23 KST에 PASS였다. 이후 최초 call의 직접 cwd 부재를 future cwd/replay로 재분류하지 않는 회귀와 같은 source point의 최초 origin/ownership을 보존하는 회귀가 보완됐다. 최종 재대조는 이 두 수정과 bounded metadata `declarationFingerprint`가 포함된 최신 build만 대상으로 한다. 두 조건의 합성 회귀 시험과 실제 고정 prefix의 재실행을 구분하며 새로운 실제 fork·반복 call-ID 사례를 조사한 것으로 해석하지 않는다.

| 시나리오 | records | events: completed / failed / unknown / pending | canonical intervals / source results | turns | usage IDs / source usage observations / eligible | messages / typed edges | metadata / 전체 observations |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| S1 | 47 | 4 / 0 / 2 / 0 | 6 / 6 | 0 | 8 / 17 / 0 | 29 / 34 | 47 / 123 |
| S2 | 741 | 89 / 7 / 54 / 6 | 150 / 156 | 8 | 135 / 341 / 0 | 517 / 672 | 741 / 2,143 |
| S3 | 391 | 87 / 5 / 26 / 0 | 118 / 118 | 0 | 108 / 268 / 0 | 389 / 505 | 391 / 1,286 |
| 합본 | 1,179 | 180 / 12 / 82 / 6 | 274 / 280 | 8 | 251 / 626 / 0 | 935 / 1,211 | 1,179 / 3,552 |

첫 입력과 같은-source 재입력, RAM archive 재표현은 각각 독립 기대값과 대조했다. keyed 비교는 실제 ID를 출력하지 않고 필드/불일치 개수만 기록했다.

| 시나리오 | 첫 입력 checked fields | 재입력 checked fields | RAM archive checked fields | 공개 helper checks | 최종 mismatch |
| --- | ---: | ---: | ---: | ---: | ---: |
| S1 | 2,186 | 2,186 | 3,839 | 121 | 0 |
| S2 | 38,234 | 38,234 | 66,333 | 2,110 | 0 |
| S3 | 24,056 | 24,056 | 40,435 | 1,436 | 0 |
| 합본 | 64,426 | 64,426 | 110,557 | 3,667 | 0 |

검증한 필드는 execution/session HMAC·provider·알려진 kind·status·start/end·duration/evidence/scope, null exit/parent/turn/content/error identity, turn의 duration-only 값/observedAt/null interval, 모든 usage component/mapping/finality/selection/stop candidate/null attribution, message parent/source-assistant/response 연결, metadata의 owner/declared root·stream/agent·sidechain/version·declarationFingerprint·source position, 모든 source usage/result observation의 counts·nullable·acknowledgement scalar다. 정상 274개의 canonical duration과 interval은 observed invocation latency로 일치했고, source-reported tool duration은 여전히 0/280이었다. result 280개의 `unassignedAcknowledgement`는 모두 false였다.

새 `declarationFingerprint`는 direct own data fields `agentId`, `isSidechain`, `sessionId` 각각의 `[field !== undefined, field ?? null]`을 key 정렬한 canonical JSON으로 만들고 `fingerprint('session', ['claude_declaration', encoded])`를 독립 계산했다. 첫 입력/재입력 metadata 1,179개와 RAM archive metadata 2,358개에서 exact HMAC과 필드가 일치했다. `inputDigest`와 최초 `callProjectId`도 전체 retained-state 재실행 동일성 및 privacy 순회에 포함됐다.

초기 freeze 실행의 RAM archive 기대 분모에는 대표 result만 들어가 두 count 비교가 불일치했다. 독립 harness에서 result **record별 provenance**를 포함하도록 보완한 뒤 같은 초기 frozen build로 다시 실행해 0 mismatch를 얻었다. 이번 최신 build에서도 같은 보완된 독립 분모를 사용했다. 연구 담당은 제품 코드를 변경하지 않았다.

### Replay, provenance and default limits

네 시나리오 모두 같은 source/offset/ordinal을 다시 넣은 뒤 전체 snapshot·inspectRetainedState·canonical·stateCounts·capabilities가 exact 동일했다. RAM archive는 원래 records를 메모리에서 다른 file identity로 재표현한 것이다. 실제 archive 파일이나 fork를 조사한 결과가 아니다. canonical events/turns/usage/messages의 모든 필드는 sourceRef provenance를 제외하면 exact 동일했다.

합본 RAM archive에서는 sources 3→6, metadata 1,179→2,358, observations 3,552→7,104로 늘었다. canonical events 280 / turns 8 / usage 251 / messages 935 / typed edges 1,211은 그대로였다. 각 시나리오와 합본·재표현 모두 **기본 상한**을 사용했고 확대 설정은 없었다. 모든 collection이 상한 안에 있었으며 STATE_LIMIT·stateLimited·diagnosticsDropped는 각각 0/false/0이었다. deferredResults 0, usageProofReplays 0을 대조했고 합본의 UUID replay markers 935 / result replay markers 280 / usage-order entries 251도 기본 상한 안에 있었다.

첫 합본은 unsupported records 244로 coverage partial이었다. diagnostics 601개는 UNSUPPORTED_RECORD 244, UNSUPPORTED_COMMAND 158, INSUFFICIENT_OPERATION_CONTEXT 158, INSUFFICIENT_LOOKUP_EVIDENCE 21, INSUFFICIENT_ERROR_EVIDENCE 12, TIMING_SCOPE_UNKNOWN 8이었다. RAM archive diagnostics는 1,190개이며 원천 provenance 증가를 canonical 실행 증가로 해석하지 않는다. 이 대조는 command/lookup/error identity의 전체 의미를 검증하거나 6개 제품 진단 규칙을 통과한 결과가 아니다.

### Retained-state privacy selection

실제 source 경로와 file identity, UUID/message/tool-use/agent ID 및 tool input·prompt·result의 leaf strings에서 **JS string.length 기준 16 UTF-16 code units 이상인 고유 문자열**을 선정했다. timestamp/version/model과 고정 type/role/stop/service-tier/speed/inference-geo 표시 필드는 제외했다. 허용된 고정 command display와 같을 수 있는 철자도 구별했다. 원문 값은 RAM에만 있었으며 출력에는 후보·반환 string/key·hit 개수만 남겼다.

| 시나리오 | 첫 입력/재입력 고유 후보 | RAM archive 고유 후보 | 모든 단계 exact string/key hits |
| --- | ---: | ---: | ---: |
| S1 | 214 | 215 | 0 |
| S2 | 1,674 | 1,675 | 0 |
| S3 | 1,207 | 1,208 | 0 |
| 합본 | 3,075 | 3,078 | 0 |

inspectRetainedState의 snapshot와 모든 collection/key를 재귀 순회했다. 합본 첫 입력·재입력의 반환 leaf strings 68,057 / object keys 130,958, RAM archive의 leaf strings 103,064 / keys 203,119을 대조했다. 모든 exact membership hits가 0이었다. 선정 길이 미만 문자열·부분 문자열·다른 rendering·heap zeroization 검사는 이 결과의 범위 밖이다. **모든 원문 문자열 0**이나 전체 메모리 삭제를 주장하지 않는다.

### Remaining gates

완료한 범위는 고정 prefix 재현·필드/관계 조사·미확정 의미 명시·P3 bounded parser keyed/replay/provenance/기본 상한·선정 privacy 대조다. 실제 archive/fork/call-ID 재등장·미관측 duration shape·source-terminal bridge·operation/lookup/error identity의 의미 전체·전체 provider versions는 검증되지 않았다. usage 251개는 계속 unknown/provisional이며 eligible 0이다. 부모의 runtime matrix·PR 검토와 P4 통합·제품 acceptance·성능·사람 파일럿은 별도 gate다.
