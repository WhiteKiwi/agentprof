# Synthetic Fixture Contracts

상태: 2026-09-30 P0. 모든 입력은 이 저장소를 위해 독립 작성한 합성 자료다. 실제 사용자 로그·prompt·code·tool output·secret을 복사하지 않았다. `FICTITIOUS_AGENTPROF_*`는 만들어 낸 개인정보 sentinel이며 실제 credential이 아니다. expected JSON은 parser/analyzer에서 생성하지 않고 아래 손계산 계약을 고정한다. P0 파일 구조 검사는 제품 acceptance 통과가 아니다.

## Provider Shapes and Identity

`tests/fixtures/providers/`의 JSONL은 version support claim 없이 shape별 기대값을 둔다. 정확한 실로그 버전·커버리지는 [EVIDENCE.md](EVIDENCE.md)의 조사와 P2/P3 대조를 통해서만 승격한다.

| Shape | 입력 | 손계산 기대값 |
| --- | --- | --- |
| `codex-structured` | call/response, completed item, explicit wrapper relation, turn boundaries | shell c1과 MCP c2를 각각 1회; wrapper/response는 새 실행이 아님. duration scope별 분리 |
| `codex-legacy` | function call/output, missing result, start/poll/terminal | 1 completed + 1 pending + 1 process; poll은 추가 실행 아님. 직접 runtime과 invocation latency 분리 |
| `claude-message` | tool_use/result, replay UUID/message, sidechain | main 2 + sidechain 1; replay는 0회 추가. call/result 시각은 observed latency |
| `codex-fork` | forked_from_id, 복사 구간 metadata, thread/event ID의 복사+새 이벤트 | copied c1은 새 실행 0, 새 fork 실행 1. 원본 관계 없는 동일 문자열은 자동 중복 제거 불가. 정확한 복사 경계 의미는 adapter 검증 필요 |
| `claude-fork` | fixture가 가정한 명시 원본 message 관계의 복사+새 이벤트 | copied call은 새 실행 0, 새 call 1; session ID만 같거나 다름으로 dedup하지 않음. 가정한 provenance 필드는 실제 공급자 보장 아님 |
| `codex-archive` | structured 원본의 byte-identical 합성 복사 | source 2개, canonical 실행은 2개 유지. 경로는 실행 identity가 아님 |

`providers/expected.json`의 ID는 검토용 logical alias다. P1 이후 실제 정규화 저장 ID는 [NORMALIZATION.md](NORMALIZATION.md)의 HMAC이며 alias를 원문으로 저장하라는 계약이 아니다. wrapper의 관계 annotation과 Claude fork provenance 필드는 합성 계약 가정이며 관측된 공급자 스키마를 주장하지 않는다. Codex fork의 복사된 metadata 버전은 새 thread 실행의 버전을 덮어쓰지 않는다. 명시 연결/복사 경계가 검증되지 않으면 unsupported 관계/coverage로 남긴다. pending fixture에 나중 결과를 append하는 입력도 둔다.

Codex `subagent_history_start_ordinal`은 관측한 필드 이름이지만 이름만으로 새 실행 경계를 추정하지 않는다. 이 fixture는 별도의 검토용 `explicitFixtureKnownCopiedOrdinals` annotation이 있는 조건에서 copied/new 기대값을 정한다. annotation 없이 필드만 있으면 `AMBIGUOUS_ORIGIN`이고 dedup을 만들어 내지 않는다. Claude fork의 가정한 provenance도 같은 조건부 계약이다.

## Metric Cases

`tests/fixtures/contracts/metrics.json`의 `cases[].input`은 독립 작성한 정규화 전 논리 fixture다. 이벤트 ID는 synthetic alias, 시간은 fixture origin 이후 ms이다. `expected`는 수작업 oracle이다. 정규화 단계의 실제 keyed ID를 고정된 해시 문자열로 발명하지 않는다.

| Case | 계산 |
| --- | --- |
| `parallel-turns` | turn [0,20s)+[10,30s) → Active 30s; tool [0,10s)+[5,15s) → sum20s, busy15s, 단독 search5s/shell5s/concurrent5s |
| `resumed-pending` | [0,10s), 2일 뒤[0,5s), 이후 pending → Active15s, observed span172805s; pending 종료는 null |
| `latency-boundaries` | n0→null; n1=[7]→7/7; 1..19→10/19; 1..20→10/19. process/runtime와 paired/source 집단 분리 |
| `statuses` | completed 2(rg no-match 포함), failed 1, cancelled 1, pending 1, unknown 1; terminal denominator 4(completed+failed+cancelled), failed rate 1/4 |
| `retry-resolved` | 실패2s+3s+4s, 성공1s → failed sum/union9s. 첫 실패 종료2s→성공 종료13s recovery11s, chain elapsed13s |
| `retry-other-target` | 동일 display라도 beta 성공은 alpha 복구 아님; alpha chain unresolved, recovery null |
| `retry-overlap` | 독립 실패[0,5s),[3,8s),[8,10s) → sum12s, union10s; ID는3개 유지 |
| `repeated-error` | 2세션3회 [0,4s),[4,8s),[8,12s) → occurrences3, union12s; 첫 실패 포함 |
| `read-search-ratio` | reads91/unique38 →53/91, searches4/unique2→2/4; 합치지 않음 |
| `read-changes` | 동일 파일4회 → revisit3/4. 첫2회 같은범위/내용/unchanged만 churn비교 후보; edit후/다른범위 제외 |
| `validation-cycles` | terminal첫검증 cycle2 중 성공1 →1/2; pending1+편집없음1 제외. full1/knownscope2→1/2 |
| `codex-tokens` | 응답A100in/20out(cache40 포함), B50in/10out(cache10 포함); response replay/cumulative150/30 추가0 →150in/30out/cache50, total180 |
| `claude-tokens` | 같은 message.id의 output 6→10 snapshot은 최종 10을 한 번 선택. uncached 100 + cache-read 30 + cache-create 20 = input 150, output 10. 총 160, phase/tool 귀속 null |
| `period-clipping` | period[5s,12s), events[0,10s)+[10,15s) → busy7s, clipped duration5+2=7s; start선택 call1(duration5s 전체표본), duration-only/unknown 구간기여0 |
| `duration-only-unknown` | 직접duration2s 위치없음+unknown2개 → duration sum2s, busy null, timing coverage1/3. 역산구간없음 |
| `day-boundary` | UTC14:59:58..15:00:02는 Asia/Seoul 자정 전후2s씩, call수는전날1 |
| `dst-boundary` | America/New_York 2026-11-01 01시가2번이어도 UTC05:30..06:30은60분. timezone표시, 음수/120분아님 |
| `operation-flags-targets` | 같은 대상·플래그의 명령만 같은 operation. 대상이나 `--watch` 변경은 같은 display여도 다른 identity |
| `duration-interval-scopes` | process runtime 8초와 lifecycle 구간 10초는 함께 보존. 같은 process scope의 8초/10초 불일치는 진단과 adapter 우선순위가 필요 |

## Six Diagnostic Cases and Waste

`contracts/diagnostics.json`은 각 규칙의 positive/normal-negative, evidence/included/excluded ID와 구체적 다음 행동·확인 지표를 고정한다. 합성 판정은 실로그 precision·효과를 입증하지 않는다. 정상 조사에도 조건을 만족할 수 있는 heuristic은 confidence/제안만 표시하고 high-confidence waste에는 넣지 않는다.

- `slow-tool`: 같은 scope 5회, duration share >=20%인 positive. 정상 음성은 낮은 share다. waste는 항상 0이며 필요한 느린 작업도 waste로 단정하지 않는다.
- `retry-loop`: 동일 operation/error/turn 3실패/10분. 정상 음성은 다른 target이다. positive 실패 전부(첫 실패 포함)를 포함하고 성공/대기를 제외한다.
- `repeated-error`: 같은 error 3실패/2session. 정상 음성은 서로 다른 error 3개다. 첫 실패를 포함한다.
- `exploration-thrashing`: 10분 20lookup·동일 5·edit <=1. 정상 음성은 모두 다른 lookup이다. positive도 heuristic이며 waste는 0이다.
- `validation-thrashing`: 15분 3validation+edit/scope 증거. 정상 음성은 편집 없음과 scope 불명이다. 단독 waste는 0이며 정상 반복 검증의 한계를 표시한다.
- `context-churn`: 10분 같은 lookup 4회+같은 범위/완전한 내용/unchanged. 각 2초이면 첫 lookup 제외 6초다. 정상 음성은 edit 후·다른 범위·잘림·외부 변경 불명이다.

`contracts/waste.json`에는 첫 실패 포함 9초/최초 lookup 제외 6초, slow 단독 0, retry 12초+error 8초-overlap 5초=15초, wrapper/canonical 제거, 독립 병렬, period clipping, duration-only, timing unknown 변형을 둔다. eligible pattern의 full observation window와 query period를 구분하며 기간에 잘린 실제 구간만 총계에 넣는다. duration-only는 규칙별 합계에만 기여하고 global union은 null이다. 확인 가능한 적격 패턴이 없는 입력의 0과 coverage 부족의 null을 구분한다.

## Privacy and Verification

provider raw fixture에 prompt, 코드, raw argv, env값, URL query, error/output sentinel을 각각 넣어 downstream에서 없어야 할 목록을 `contracts/privacy.json`에 고정한다. 이 문자열은 합성 입력에만 의도적으로 존재한다. 원문을 없애야 하는 대상은 normalized events/diagnostics/DB/report/packed artifact이며 fixture 자체의 sentinel 부재를 요구하지 않는다.

P0 검사는 JSON/JSONL 문법, 입력 ID/기대 ID 참조, fixture 목록, 모든 지표/6규칙의 양성/정상 음성/waste 포함표를 대조한다. P1은 privacy API/reader 테스트를 실행하며 provider expected를 파서 실행으로 통과시켰다고 하지 않는다. P2/P3와 P5가 각 parser/metric oracle을 실제 구현에 연결한다.
