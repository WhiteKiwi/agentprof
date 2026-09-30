# AgentProf Metrics and Diagnostics

## Status and Authority

Draft, 2026-09-30. 사용자 제공 [metrics 제안](reference/agentprof-metrics-and-insights.md)을 계산·관측 계약으로 구체화한다. 제품 범위는 [SPEC.md](SPEC.md), 구현 방법은 [IMPLEMENTATION.md](IMPLEMENTATION.md)를 따른다.

## Shared Measurement Contract

- 각 값은 단위, 범위, 분모, 유효 표본 수, 누락 표본 수와 timing evidence를 갖는다.
- `source_reported`는 소스가 직접 기록한 값, `paired_timestamps`는 검증된 호출·결과 관측 구간, `estimated`는 별도 추정, `unknown`은 근거 부족이다.
- 호출 latency, 프로세스 runtime, 항목 lifecycle은 서로 다른 시간 의미다. 의미가 다른 표본을 같은 latency 분포에 섞지 않는다.
- 관측 범위와 active time을 구분한다. Active Time은 **관측된 턴 경과 시간**이라는 한계를 표시한다. 사용자 승인 대기 등이 포함될 수 있고 CPU 작업 시간은 아니다.
- 기간 경계의 시간은 구간을 잘라 계산한다. 호출 수·분포의 표본은 시작 시각 기준으로 선택한다. 타임존을 명시한다.
- 값이 없으면 `null`이다. 분모가 0인 비율과 데이터가 없는 통계도 `null`이며, 정상적으로 관측한 0과 구분한다.
- 시간 집계는 원칙적으로 구간 합집합이다. 호출 duration 합계는 별도 지표다. wrapper·내부 항목의 동일 실행 표현은 먼저 중복 제거한다.

## Metric Evidence Matrix

P0에서 아래 필요 필드를 공급자·로그 버전별로 대조하고, P2/P3에서 실제 정규화 출력과 수작업 표본을 검증한다. 실제 원문은 허용된 로컬에서만 읽고 커밋·업로드하지 않는다. 공개/공유 evidence는 원문 없는 집계·검증 조건과 독립적으로 만든 합성 fixture만 사용한다.

| 지표 | 필요한 관측 필드·관계 |
| --- | --- |
| Active Time | turn ID, 명시적 시작/종료, duration scope |
| Tool / Command / Category Time | canonical execution ID, 도구·안전한 commandPattern, 구간·duration scope |
| p50 / p95 | terminal 상태, 같은 scope·timing evidence의 duration |
| Failed Executions | terminal 상태·exit code와 명령별 실패 의미 |
| Retry Overhead | project/turn, operationKey, errorFingerprint, 시도 관계·실패 구간 |
| Repeated Error Time | errorFingerprint, session/project, 확인된 실패 구간 |
| Recovery Time | 같은 operationKey의 실패·성공 결과 시각과 연결 근거 |
| Repeated Read / Search Ratio | 기본 파일 재방문 비율: 파일 식별자; 기본 검색 비율: query·범위·옵션 fingerprint. 내용·변경 관측은 기본 비율의 필수 조건이 아니라 Context Churn 고신뢰 진단의 추가 요건 |
| Edit → Validation Cycles | 관측된 편집 관계, 검증 상태·시각·scope 근거 |
| Token Attribution | 고유 response/turn ID, usage 종류, 누적/증분·cache 의미 |

각 행을 공급자·정확한 로그 버전별로 확장한 검증 기록은 다음 열을 필수로 가진다. `metric | provider/version | required fields present/missing | direct/observed/inferred/unsupported | eligible n / inspected n | timing-covered n / eligible n (scope별) | semantic check + synthetic fixture ID | status/reason`.

`direct`는 검증된 직접 값, `observed`는 검증된 관측 관계로 계산, `inferred`는 별도 추정, `unsupported`는 필요한 근거 없음이다. 시간 evidence의 `source_reported/paired_timestamps/estimated/unknown`과 각각 대응하지만 비시간 지표에도 적용한다. 혼합 근거는 따로 나눠 기록한다. 0 분모의 coverage는 `null`이다. 버전·표본 선택·관측 기간과 누락 사유를 남겨 선택된 표본을 전체 모집단의 지원율로 확대하지 않는다.

`main`에는 아직 이 행렬의 구현 결과가 없다. 별도 [PR #9의 P0 evidence](https://github.com/WhiteKiwi/agentprof/blob/6f614727dced9df2693ac008aa3f3e4be559386c/docs/EVIDENCE.md)에 bounded 표본·필드·coverage와 의미 확인 과제가 기록되어 있다. 이는 미실시 조사가 아니지만 파서/분석기 acceptance 통과도 아니다. 지원 승격은 해당 버전·지표의 합성 기대값과 로컬 대조가 통과한 범위에 한정한다. 원본을 읽을 권한/환경이 없으면 검증을 보류하고 지원 주장을 낮춘다.

## 1. Active Time

`activeTimeMs = |union(지원되는 명시적 턴 구간)|`.

오랜 공백을 포함한 전체 session span은 `observedSpanMs`로 따로 표시한다. 종료를 모르는 턴은 현재 시각으로 늘리지 않는다. 턴 duration만 있고 정확한 위치를 모르면 duration 합계를 보조 표시하며 구간 기반 Active Time으로 변환하지 않는다.

**Verify:** 며칠 뒤 재개, 승인 대기, 겹치는 턴·서브에이전트, pending과 경계 누락 사례에서 session span과 active time이 구분된다.

## 2. Time by Tool / Command / Category

`toolDurationSumMs`는 유효한 호출 시간 합, `toolBusyMs`는 배치 가능한 도구 구간의 합집합이다. 카테고리별 경과 시간은 단독 구간과 `concurrent` 구간으로 분해한다. 분모가 Active Time인지 도구 시간인지 표시한다.

명령 패턴은 집계 표시용이다. 재시도·복구의 동일 작업 판정에는 대상·중요 플래그·프로젝트를 보존한 별도 `operationKey`를 사용한다. 서로 다른 테스트를 `npm test <target>`라는 표시가 같다는 이유로 연결하지 않는다.

**Verify:** 10초 호출 두 개가 5초 겹치면 호출 합계 20초, 도구 경과 시간 15초다. 표시 패턴이 같은 다른 작업은 재시도 체인이 되지 않는다.

## 3. Tool Latency p50 / p95

종료가 확인되고 같은 duration scope·evidence를 가진 표본만 모은다. 정렬된 `n`개 값에서 `p(q) = sorted[ceil(q × n) - 1]`인 nearest-rank를 사용한다. `n = 0`이면 `null`이다.

초기 표시 기준은 `n < 20`이면 p95를 낮은 표본 수로 표시하고 높은 latency의 확정 근거로 단독 사용하지 않는 것이다. 이는 통계 표준에서 도출한 보장값이 아니라 제품 판단이며 파일럿에서 조정한다.

**Verify:** 0·1·19·20개 표본과 누락·추정·서로 다른 시간 의미가 포함된 fixture에서 분위수와 표본 수가 맞는다.

## 4. Failed Executions

실패가 확인된 명령·도구 호출 수와 전체 terminal 호출 수를 표시한다. 취소·pending·unknown은 각각 분리한다. 비영 종료 코드만으로 실패를 판정하지 않고 도구·명령의 의미를 확인한다. 예를 들어 `rg` exit 1의 결과 없음은 실행 오류와 구분한다.

**Verify:** 성공·실패·결과 없음·취소·미완료·종료 코드 없음이 서로 다른 분류와 분모를 갖는다.

## 5. Retry Overhead

체인은 같은 프로젝트·턴·`operationKey`의 확인된 실패와 다음 시도를 연결한다. 기본 후보는 같은 오류 식별자의 실패가 10분 안에 3회 이상인 경우다. 숫자는 초기 제품 판단이며 설정과 규칙 버전에 포함한다.

- `attemptCount`, `failedAttemptCount`, `resolved`, `terminalSuccessEventId`를 제공한다.
- `failedAttemptDurationSumMs`는 알려진 실패 호출 시간의 합이다.
- `retryOverheadMs`는 체인 내 실패 시도의 유효 구간 합집합이다. 필요한 재시도였을 수 있으며 절감 가능 시간을 뜻하지 않는다.
- `chainElapsedMs`는 첫 시도 시작부터 확인된 복구 완료까지다. 편집·대기 등이 포함될 수 있어 retry overhead와 다르다.
- 미해결 체인에는 관측된 실패 기여분을 보여주지만 완료 체인 통계에는 넣지 않는다.

단순히 “전체 체인 경과 시간 − 성공 실행 시간”을 retry overhead로 쓰지 않는다. 시간·상태가 누락되면 해당 값과 커버리지를 구분한다.

**Verify:** 실패 3회 후 성공, 다른 대상 성공, 오류 변경, 병렬 시도, 취소와 미해결 체인이 기대대로 분리된다.

## 6. Repeated Error Time

정규화된 오류 분류와 로컬 keyed fingerprint를 사용한다. occurrences, 영향받은 세션·프로젝트 수, 알려진 실패 구간의 합집합과 재발 간격을 제공한다.

실패 구간의 시간은 관측값이다. 오류를 처음 발견한 뒤의 모든 경과 시간을 `time lost`로 표시하지 않는다. 같은 구간이 retry에도 해당하면 Detected Waste 총계에서는 한 번만 센다. 안전한 오류 코드가 없으면 원문 메시지 대신 분류·식별자를 표시한다.

**Verify:** 동적 경로·숫자 차이의 처리, 서로 다른 오류 분리, 세션 간 같은 오류와 retry 중복이 기대값과 일치한다.

## 7. Recovery Time

같은 작업에서 실패를 관측한 시점부터 확인된 성공 결과까지의 `recoveryElapsedMs`를 제공한다. 기본 시작은 첫 실패 결과의 시각, 끝은 연결된 성공 결과의 시각이다. 편집·탐색·사용자 대기가 포함될 수 있다.

중간에 다른 작업의 성공이 있어도 복구로 간주하지 않는다. 세션 종료·관측 종료까지 성공이 없으면 `unresolved`로 남긴다. 복구 분위수에는 해결된 체인만 사용하고 **해결된 체인의 median/p95**로 표시한다. 전체 복구 모집단의 추정으로 표현하지 않는다. 해결 수·미해결 수를 함께 보여주고, 미해결을 0이나 마지막 로그 시각의 확정 복구 시간으로 채우지 않는다.

**Verify:** unrelated success, 중단·재개, 관측 종료, 시간 근거 누락과 확인된 복구를 구분한다.

## 8. Repeated Read / Search Ratio

기본 비율은 `(총 유효 읽기 수 − 고유 파일 수) / 총 유효 읽기 수`다. 검색에는 별도의 동일 query·범위·옵션 fingerprint를 사용한다. 두 비율을 서로 합치지 않는다.

파일 비율은 동일 경로의 재방문을 기술한다. 동일 내용의 불필요한 읽기를 의미하지 않는다. 진단에는 읽기 범위·관측된 내용 식별자·중간 변경 여부를 추가로 사용한다. 편집 후 재읽기, 다른 줄 범위, 축약·잘린 결과와 외부 변경 불명은 정당한 반복 가능성으로 남긴다.

v0.1은 정확히 같은 정규화 검색 식별자를 비교한다. 의미적 query similarity와 “동일 주제” 판단은 후속 기능이다. 원문 query·파일 내용은 저장하지 않는다.

**Verify:** 91 reads·38 unique files는 `53/91`이다. 같은 파일의 변경 후 읽기와 다른 범위 읽기는 고신뢰 중복 lookup 시간에 자동 포함되지 않는다.

## 9. Edit → Validation Cycles

관측된 편집 묶음과 그 뒤의 분류된 검증 호출을 사이클로 연결한다. 첫 검증 결과, duration, 실패·다음 시도, 알려진 파일·줄 변경 수와 validation scope를 제공한다.

`firstPassValidationRate = 첫 검증이 성공한 완료 사이클 / 첫 검증의 terminal 결과가 확인된 사이클`이다. 편집이 관측되지 않은 검증과 pending·unknown은 분모에서 제외하고 수를 따로 표시한다.

`fullValidationRatio`는 full·targeted·incremental 여부를 판정할 근거가 있는 사이클만 분모로 쓴다. `xcodebuild`라는 이름만으로 full rebuild라고 하지 않는다. 로그 편집이 실제 모든 파일 변경을 담고 있다고 가정하지 않는다.

**Verify:** 여러 편집 뒤 한 검증, 첫 실패 뒤 성공, 편집 없는 검증, 범위 불명과 중간 작업 전환을 구분한다.

## 10. Token Attribution

공급자가 기록한 입력·출력·cache 필드를 의미별로 유지한다. 고유 응답의 사용량과 턴·세션 누적 스냅샷의 우선순위를 정해 한 번만 집계한다. cache가 총 input에 포함되는지 공급자 계약을 확인하고 임의로 더하지 않는다.

v0.1은 근거가 있는 턴별 사용량을 제공한다. 탐색·구현·디버깅 등 단계별 배분은 명시적 단계나 검증된 추정이 있을 때만 추정 표시로 제공한다. 도구 호출 주변 토큰을 해당 도구가 소비한 토큰으로 단정하지 않는다. 그 외는 `unattributed` 또는 미지원이다.

**Verify:** 동일 response 재저장, cumulative snapshot, 모델 변경, cache 의미 차이와 분류 불명에서 중복·허위 배분이 없다.

## Aggregation and Token Accounting

아래는 위 10개 지표를 신뢰할 수 있게 집계하는 추가 계약이다. 구현·성능 개선 결과가 아니며 예시는 모두 합성이다.

### 범위·분모·시간

| 값 | 공식·필수 근거 | 제한·표시 |
| --- | --- | --- |
| Task elapsed | 명시적으로 연결된 작업의 완료 시각 − 시작 시각 | 같은 task ID/경계가 필수. 승인·편집·대기가 포함될 수 있음. 세션 span이나 마지막 로그 시각으로 대체하지 않음 |
| Stream active | 한 execution stream의 검증된 턴 구간 union 길이 | CPU 실행 시간이 아님. pending/위치 불명 duration 제외 |
| Session-minutes | `sum(stream active ms) / 60000` | 동시 stream 기여를 더한 누적량. 사용자 체감 경과 시간이나 global union이 아님 |
| Global observed active | 비교 가능한 공통 시계에 놓인 모든 적격 턴 구간의 union 길이 | 중복 표현은 먼저 제거. cross-device clock 관계 불명이면 계산 보류/범위 분리 |
| Tool duration sum | 같은 scope/evidence의 고유 호출 duration 합 | 독립 병렬 실행은 각각 유지. runtime과 lifecycle을 합치지 않음 |
| Tool busy | query period에 잘린, 같은 interval scope/evidence의 검증된 구간 union 길이 | duration의 scope/evidence와 별도로 판단. duration-only로 구간을 역산하지 않음. 분모의 턴 범위 밖 기여도 숨기지 않음 |
| Aggregate ratio | 같은 정의의 모든 적격 numerator 합 / denominator 합 | 세션별 비율의 단순 평균 금지. 전체·제외·unknown 분모를 함께 표시 |
| Aggregate quantile | 동일 scope/evidence의 원 표본을 모아 nearest-rank | 세션별 p95를 평균하거나 p95의 p95로 전체 p95를 만들지 않음 |

두 stream이 같은 30분 동안 실행되면 session-minutes는 60분, global observed active는 30분이다. 작업 경계가 없으면 두 값 중 어느 것도 task elapsed라고 부르지 않는다. 비율이 `1/2`와 `9/98`인 두 집단의 전체 비율은 `10/100 = 10%`이며 약 29.6%인 단순 평균이 아니다. 호출 수 분모·상태·필터가 다른 집단은 합치지 않는다.

규칙 적격성은 기록한 observation window에서 먼저 판정한다. 표시할 기간으로 구간을 clipping하는 단계와 구분한다. 예를 들어 window 안에 실패 3회가 있고 query period에는 마지막 1회만 들어오면 적격 체인의 근거 3개와 표시 기간의 기여 1개를 따로 보인다. window를 바꿔 재판정했다면 새 snapshot으로 기록한다. 기간 밖 근거를 몰래 현재 기간의 시간에 더하지 않는다.

**Verify:** 동시 두 stream 30/60분, 서로 다른 시계, `1/2 + 9/98`, pooled quantiles, observation window와 query clipping의 합성 손계산을 고정한다. duration scope·표본·filter가 다른 값을 합치면 검증 실패다.

### 고유 최종 usage와 cache

1. 공급자·고유 execution stream·response/message ID로 usage를 묶고 복사된 이력/재저장을 제거한다. 한 응답 안의 여러 저장 레코드는 새 응답이 아니다.
2. adapter가 검증한 source ordering·terminal/final 신호에 따라 마지막 완성 usage를 선택한다. 첫 값 고정·모든 snapshot 합산·각 component 최대값 선택은 금지다. final 판정 불가면 provisional/unknown과 제외 수를 남긴다.
3. response usage와 같은 사용량을 나타내는 turn/session cumulative를 더하지 않는다. cumulative만 가능한 소스는 reset/epoch·시작 baseline·증분 의미가 검증된 별도 fallback을 사용한다. 감소·reset·누락 baseline을 0으로 보정하지 않는다. 중간 기간의 사용량을 session 최종 누계로 대신하지 않는다.
4. 같은 응답 단위에서 의미가 검증된 input/output을 한 번 더한다. 알려진 응답의 합은 **관측 usage 합계**이며 누락 응답을 포함한 전체 사용량으로 주장하지 않는다. usage-covered responses / eligible responses, final/provisional/unknown 수와 source version을 표시한다.

| 공급자별 의미 | 정규화 공식 | 합성 기대값 |
| --- | --- | --- |
| [OpenAI API](https://developers.openai.com/api/docs/guides/prompt-caching): cached input이 input의 부분집합인 검증된 schema | `inputTotal = inputTokens`; `nonCacheReadInput = inputTokens - cachedInput`; `total = inputTotal + outputTokens` | input100, cached40, output20이면 total120. cache를 더한160 아님 |
| [Anthropic Messages](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): input은 non-cache, cache read/create는 별도인 검증된 schema | `inputTotal = inputTokens + cacheReadInput + cacheCreationInput`; `total = inputTotal + outputTokens` | input100, read30, create20, output이 같은 ID에서6→10이면 최종 total160. 156+160을 더하지 않음 |

이는 2026-09-30 확인한 공식 API 의미를 adapter 검증의 참고로 삼는 계약이다. Codex/Claude Code의 모든 로그 버전이 API schema와 같다고 가정하지 않는다. OpenAI의 cache-write 세부 필드가 존재하면 input에 포함된 별도 subset으로 보존한다. `nonCacheReadInput`에는 cache-write가 포함될 수 있으므로 일반 입력의 과금량으로 해석하지 않는다. cache 세부 bucket이 상위 합계에 포함되면 또 더하지 않는다. output 안의 reasoning 세부값도 부분집합이면 추가 합산하지 않는다. 필수 component가 누락되거나 포함 관계가 불명확하면 total/차감값은 `null`이며 원래 확인된 component만 보인다. cached > input 등 모순도 진단하고 억지로 0에 맞추지 않는다.

Cache read share는 의미가 맞는 `sum(cacheReadInput) / sum(inputTotal)`이다. 기간·모델·공급자와 eligibility를 고정하며, 이 비율이 가격 절감률이나 latency 개선률은 아니다. 반복 입력은 새 응답의 실제 usage로 남긴다. 전체 token 합은 고유 텍스트 양·현재 context 길이·tool output token 수가 아니다.

도구 출력은 관측된 byte/character 수와 실제 tokenizer/model로 추정한 token 수를 구분한다. 추정에는 tokenizer version·단위를 표시하고 provider usage에 더하지 않는다. 크기를 얻을 원문은 정규화 중 폐기하며, 유출 위험이 있는 내용/경로를 cardinality label로 저장하지 않는다. 명시적 연결이 없는 tool별 token 귀속은 `unattributed`다.

**Verify:** updated usage6→10, 동일 응답 replay, fork copy와 새 응답, cumulative reset·baseline 부재·역순 source, missing cache component, 두 공급자 cache 의미, 모델 변경과 provisional/final을 대조한다. 합성 기대값과 실제 adapter 출력 대조를 통과하기 전 지원으로 승격하지 않는다.

### 근거 등급과 우선순위

`direct / observed / inferred / unsupported`는 **측정 근거**다. 정확한 직접 사용량도 그 작업이 불필요했다는 근거는 아니다. 별도로 rule의 판정 상태·정상 작업 반례·identity coverage·time/token coverage·제안 적용 가능성을 표시한다. exact argv/error fingerprint는 다른 작업을 합치는 오탐을 줄이지만 표현만 다른 동일 작업을 놓칠 수 있다. 낮은 recall을 0회 발생으로 해석하지 않는다.

우선순위는 (1) 충분한 근거와 실행 가능한 행동, (2) 관측된 시간/토큰 영향과 반복 빈도, (3) 작은 검증의 비용·위험 순으로 설명한다. 토큰과 초를 임의의 단일 점수로 합치거나, coverage가 낮은 큰 숫자로 상단을 채우지 않는다. 예상 절감률은 측정 전 표시하지 않는다.

## Efficiency Opportunity Cards

다음 여섯 항목은 **개선 후보 분류**이며 아래 기존 Six Initial Diagnostics의 대체 목록이나 새 6개 구현 규칙이 아니다. 신호가 있어도 불필요함·원인·절감 가능성은 가설이다. 각 카드에는 `candidate ID/version`, 기간·대상 별칭, evidence IDs, 측정값·단위·분모·coverage, 측정 근거 등급, 정상 반례, 제안 하나, validation experiment, quality guardrail, 확인 결과를 표시한다.

| 후보 / 연결·범위 | 필요한 근거·한계 | 제안과 작은 실험 | 품질 보호 조건 |
| --- | --- | --- | --- |
| 큰 도구 출력 / 후속 후보 | per-call 출력 크기·잘림·선택 옵션; 실제 usage와 연결 없으면 출력량만 표시. 큰 출력 자체는 낭비 아님 | 필요한 필드/행 범위를 좁히고 같은 질문으로 기존/축약 출력을 비교. 출력 bytes·모델 usage·task elapsed를 각각 측정 | 필요한 근거·오류 맥락·누락 가능성이 유지되어야 함. 잘린 결과의 후속 재조회까지 포함 |
| 반복 검색·읽기 / exploration-thrashing, context-churn | 동일 query/범위/옵션·content/change fingerprint, 완전한 결과. 조사·리뷰·수정 뒤 재읽기는 정상 가능 | 모듈 지도나 검색 범위 하나를 개선하고 동일 작업의 lookup 수·관측 시간·usage를 비교 | 답변 근거와 탐색 범위 충분성 확인. 필요한 탐색/최신 내용 확인을 금지하지 않음 |
| 과도하게 넓은 검증 / validation-thrashing | 관측 edit-cycle, 실제 full/targeted scope·대상 대응. 명령명·작은 diff만으로 과도함 판정 금지 | 검증된 targeted test를 먼저 수행하는 순서와 기존 순서를 비교. 전체 사이클 시간·재시도·usage 측정 | 필수 전체/회귀 테스트·보안/빌드 gate 유지. 최종 결과·커버리지·결함 발견 동등성 확인 |
| 반복 실패 / retry-loop, repeated-error | 검증된 실패 의미, 같은 operation/error, 첫 실패 포함·성공 제외, unresolved 구분 | 첫 실패의 필수 조건이나 setup 지침 하나를 고치고 동일 작업에서 실패 수·실패 구간·복구를 비교 | 다른 오류를 숨기거나 검증을 우회하지 않음. 성공 산출물·필수 테스트 기준 동일 |
| context 성장 / 후속 후보 | 순서 있는 고유 최종 response input 사용량, 모델·cache·compaction/재개 여부. input 증가는 현재 context 크기와 동의어 아님 | 짧은 상태 요약/불필요한 재첨부 감소 한 가지를 시험. response별 input 추이·전체 usage·task elapsed 비교 | 요구사항·결정·근거 보존, 같은 품질 rubric으로 누락/환각/재탐색 확인. 요약 비용도 포함 |
| 병렬 중복 작업 / 후속 후보 | 명시 task/operation·spawn/join·내용/범위·시간 관계. 별개 execution ID는 측정에서 그대로 유지 | 작업 소유 범위를 분리한 경우와 기존 경우 비교. 전체 parent+child usage, task elapsed, 합산 활동량 측정 | 의도된 독립 검토·교차 검증·안전 확인 보존. trace tree만으로 critical path나 제거 가능한 시간을 주장하지 않음 |

합성 카드 예: “같은 lookup의 적격 반복 3회, 관측 구간 합집합 6초, timing 3/3, identity 4/4. 모듈 지도 한 항목을 추가해 같은 과제를 재시도하고 lookup 수·전체 usage·task elapsed를 비교한다. 정답 근거와 필수 테스트를 유지한다.” 여기서 6초는 관측된 패턴 관련 시간이며 “6초 절감 가능”이라는 뜻이 아니다.

큰 출력·context 성장·병렬 중복은 [BACKLOG](BACKLOG.md#efficiency-candidate-gates)에 gate를 둔다. 기존 규칙에 연결되는 후보도 근거가 없으면 카드에서 보류 이유를 표시한다. 초기 구현 순서와 Verify는 [IMPLEMENTATION](IMPLEMENTATION.md#efficiency-review-priorities)에 있다.

## Detected Waste Aggregation

아래 포함표를 통과한 규칙이 지정한 정규화 이벤트 구간의 합집합을 총계로 계산한다. 같은 이벤트·구간이 여러 규칙에 해당해도 한 번만 센다. 내역별 값은 겹칠 수 있으므로 합계와 overlap을 함께 설명한다.

부모 wrapper와 내부 작업의 중복 표현은 이벤트 단계에서 제거한다. coarse heuristic만 있는 탐색·검증 패턴은 Top Insights에 제안할 수 있지만, 고신뢰 Detected Waste 시간에 자동 합산하지 않는다. 정확한 구간이 없는 duration은 패턴별 호출 시간 합계로 별도 제공한다.

예를 들어 retry 후보 12초와 repeated-error 후보 8초가 5초 겹치면 총계는 15초다. overlap은 5초다. 미지원 source 때문에 전체 패턴을 확인할 수 없으면 알려진 하한과 커버리지를 표시하며 전체를 0으로 판정하지 않는다.

**Verify:** 다중 규칙 overlap, wrapper 중복, 일부 timing 없음과 근거 없는 반복 검색에서 총계와 내역이 보존된다.

### Rule-to-Waste Inclusion (v0.1)

| Rule ID | 총계에 포함할 이벤트 | 제외·한계 |
| --- | --- | --- |
| `slow-tool` | 없음 | 비중·latency는 병목 신호이며 그 자체로 낭비가 아님 |
| `retry-loop` | 임계값을 충족한 체인의 확인된 실패 시도 전부, 첫 실패 포함 | 성공 시도·시도 사이 대기·편집·chain elapsed 제외 |
| `repeated-error` | 임계값을 충족한 오류 그룹의 확인된 실패 전부, 첫 발생 포함 | 오류 사이 간격·복구 성공 제외; retry와 중복 제거 |
| `exploration-thrashing` | 없음 | 빈도·적은 편집만으로 정상 조사/리뷰와 구별 불가; insight만 제공 |
| `validation-thrashing` | 이 규칙 단독으로는 없음 | 정상 반복 검증 가능; retry/error 자격이 있는 실패만 해당 규칙으로 포함 |
| `context-churn` | 같은 lookup·범위·관측 내용 및 변경 상태가 검증된 그룹의 두 번째 이후 적격 반복 호출 | 첫 lookup·편집 후 읽기·다른 범위·잘린 결과·외부 변경 불명 제외; 필요한 근거 없으면 insight만 제공 |

그룹/체인의 임계값은 명시된 observation window에서 판정하고 `evidenceEventIds`와 시간에 기여한 `includedEventIds`를 분리한다. 기간 필터로 그룹이 달라질 수 있으므로 window·query period를 저장한다. `repeated-error`처럼 별도 시간 한도가 없는 규칙의 window는 선택한 query period다. 실패 그룹은 첫 실패를 포함하지만 lookup 반복은 최초 호출을 제외하는 차이를 fixture로 고정한다.

시간 총계는 canonical execution ID로 wrapper/child의 동일 실행 표현을 제거한 뒤, 적격 이벤트의 검증된 `[startAt, endAt)`를 query period에 잘라 합집합한다. 실제 독립 병렬 실행은 ID를 합치지 않고 시간 겹침만 한 번 센다. 동일 실행 관계가 불명이면 해당 기여를 확정 총계에서 제외하고 coverage에 남긴다. 직접 duration만 있고 위치가 없으면 구간을 역산하지 않는다. `source_reported`, `paired_timestamps`, `estimated`의 내역과 시간 의미를 유지하며 추정은 확정 관측 총계와 분리한다. 동일 canonical 실행에 여러 evidence가 있으면 공급자 계약으로 하나를 선택해 이중 계상하지 않는다.

**Verify:** slow-tool 단독 20초는 waste에 기여하지 않는다. 적격 retry 실패 2·3·4초와 성공 1초는 실패 합 9초이며 첫 실패를 포함한다. 적격 동일 lookup 4회가 각 2초면 최초 제외 6초다. 변경/내용 불명이면 그 반복은 제외한다. retry 12초와 repeated error 8초의 overlap 5초는 총계 15초다. 각 사례에 독립 병렬·wrapper 중복·경계 clipping·duration-only·unknown 변형을 추가한다.

## Six Initial Diagnostics

아래 임계값은 초기 제품 판단이다. 외부 자료가 보장한 수치나 이미 검증된 튜닝값이 아니다. 규칙 ID·버전·임계값·표본과 근거를 결과에 남긴다.

| Rule ID | 최소 신호 | 제안과 해석 한계 |
| --- | --- | --- |
| `slow-tool` | 같은 시간 의미의 5회 이상 호출, 유효 시간 합이 도구 합계의 20% 이상. p95 판단은 표본 수도 확인 | 측정된 호출 범위를 좁혀 볼 제안. 네트워크·서버 내부 원인을 로그만으로 단정하지 않음 |
| `retry-loop` | 동일 작업·오류의 실패 3회 이상 / 10분 | 환경·초기 조건·작은 검증 경로 확인. 재시도 전체가 낭비라는 판단은 하지 않음 |
| `repeated-error` | 같은 오류가 2개 이상 세션에서 3회 이상 | setup·bootstrap·지침 개선 후보. 동일 fingerprint 충돌 가능성과 오류 근거를 표시 |
| `exploration-thrashing` | 10분 내 검색·읽기 20회 이상, 동일 lookup 5회 이상, 편집 1회 이하 | repository map·탐색 범위 제안. 조사·리뷰 작업에는 정상일 수 있어 휴리스틱으로 표시 |
| `validation-thrashing` | 15분 내 검증 3회 이상, 편집 사이클과 검증 범위 근거 | targeted validation 경로 제안. full 여부가 불명이면 full-build 진단을 하지 않음 |
| `context-churn` | 10분 내 같은 lookup 4회 이상, scope·내용·변경 근거 확인 | 모듈 설명·지침·지속 지식 후보. 편집 뒤 재읽기와 다른 범위를 제외하거나 신뢰도를 낮춤 |

severity는 `INFO`, `NOTICE`, `WARNING`, `HOTSPOT`이다. 우선순위는 근거가 있는 관측 시간 영향, 반복 수와 신뢰도로 정한다. 취향이나 원문 프롬프트의 표현에 따라 severity를 결정하지 않는다.

각 결과는 rule ID·version, severity, evidence event IDs, observation window, sample·coverage, measured impact, confidence, suggestion을 가진다. root cause는 가설임을 표시하고 조언과 실제 효과를 구분한다. v0.1의 수동 파일럿과 v0.2의 자동 before/after 기능은 같은 조건의 비교이며 인과 효과 검증으로 표현하지 않는다.

각 규칙은 최소 하나의 양성 및 정상 음성 합성 사례, 기대 included/excluded event IDs, 오탐이 될 수 있는 정상 작업, 구체적 다음 행동과 그 행동을 확인할 지표를 갖춰야 한다. Slow Tool의 정상 음성은 비중 기준 미달 또는 scope가 다른 표본이며, 느리지만 필요한 작업을 낭비로 해석하는지도 별도로 검토한다. 실제 파일럿에서는 검토 표본·오탐 수·판단 불가 수·제안의 적용 가능 여부와 rule version을 기록한다. precision 목표나 개선률을 미리 발명하지 않고 P0에서 평가 절차를 정한 뒤 P5/P7의 근거로 임계값을 보정한다.
