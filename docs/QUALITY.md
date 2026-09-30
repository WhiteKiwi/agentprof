# AgentProf Diagnostic Quality Protocol

## 상태와 검토 책임

2026-09-30, P0 사전 절차 `quality-v1`. 제품 규칙·파서·로컬 파일럿은 **NOT RUN**이다. 임계값은 [METRICS](METRICS.md)의 초기 제품 판단이며 precision 목표나 개선률을 발명하지 않는다.

기술 검토자는 이 작업의 부모 **Codex (`codex-local`)**다. 개발 서브세션은 사례·결과를 작성하고 부모가 근거·포함 구간·제안을 독립 검토한다. 이것은 AI 기술 검토이며 사람의 유용성 검증이 아니다. 사람 파일럿과 수동 matched before/after 검토는 아직 배정·수행되지 않았고 P7에 남는다. 원문은 로컬에서만 보고 공유 기록에는 alias·집계·판정 이유를 남긴다.

## 6개 규칙의 기대 판정

모든 사례는 synthetic이며 fixture 이름·event ID와 실제 상태는 [FIXTURES](FIXTURES.md)에 유지한다. 아래 포함 ID는 의미 이름이다. 구현 fixture의 정확한 ID에 연결한 뒤 실행 결과를 기록한다.

| Rule | 양성 사례·근거 | 정상 음성·오탐 경계 | Waste 포함·제외 | 구체적 다음 행동 / 확인 지표 |
| --- | --- | --- | --- | --- |
| `slow-tool` | 같은 scope/evidence의 5회 이상 호출이 유효 도구 합의 20% 이상 | 5회 미만, 비중 미달, 서로 다른 scope의 합산은 음성. 필요한 정상 고비중 작업도 병목 후보일 수 있음 | 항상 included 없음. 양성 도구 시간도 waste가 아님 | 해당 도구의 작은 입력·targeted 경로를 비교 / 동일 scope p50·p95·n·비중 |
| `retry-loop` | 동일 turn/project/operation/error의 실패 3회가 10분 안에 있고 뒤의 성공은 별도 | 대상·중요 flag·오류·turn이 다르거나 실패 2회는 음성. 취소/unknown은 실패가 아님 | 첫 실패를 포함한 적격 실패 IDs만 포함. 성공·대기·편집 제외 | 첫 실패의 환경·필수 조건을 확인하고 한 번 작은 검증 / 실패 횟수·실패 구간 union·해결 여부 |
| `repeated-error` | 같은 검증된 error identity가 2개 이상 session에서 3회 이상 | 한 session만 있거나 다른 오류는 음성. fingerprint collision은 판정 불가 | 첫 발생 포함 적격 실패 IDs. 오류 사이 간격·복구 성공 제외; retry 중복 union | 공통 setup/bootstrap 지침 하나 확인 / 영향을 받은 session 수·재발·coverage |
| `exploration-thrashing` | 10분 내 read/search 20회 이상, 동일 lookup 5회 이상, 관측 edit 1회 이하 | 횟수 미달·중복 미달·edit 2회 이상은 음성. 정상 조사/리뷰는 수치 양성이라도 낭비라는 해석은 오탐 | included 없음. 패턴 insight만 제공 | 탐색할 모듈 지도·검색 범위 하나를 정리 / read/search 후보·반복 비율·근거 lookup |
| `validation-thrashing` | 15분 내 validation 3회 이상이며 관측 edit cycle·validation scope 근거가 있음 | 필요한 변경 뒤의 반복 검증은 정상 가능. scope unknown이면 full-build 진단은 음성 | 단독 included 없음. 적격 retry/error 실패만 다른 규칙으로 포함 | 가장 작은 의미 있는 검증 target를 먼저 실행 / scope별 횟수·first-pass rate·시간 |
| `context-churn` | 10분 내 동일 lookup 4회 이상이며 같은 range·관측 content·변경 상태가 검증됨 | 편집 후 읽기·다른 range·잘린 결과·내용/외부 변경 unknown은 고신뢰 음성/보류 | 첫 lookup 제외한 적격 반복 IDs만 포함. 제외 조건은 union 전에 적용 | 해당 모듈 설명이나 반복 lookup의 답을 지침에 남김 / 같은 lookup 반복·고신뢰 반복 시간·coverage |

수치 신호 판정과 “불필요한 작업” 해석은 별도 label로 평가한다. 정상 조사로 `exploration-thrashing` 신호가 발생해도 제한을 설명하면 패턴 관측과 맞을 수 있다. 정상 작업을 낭비·확정 root cause·절감 보장으로 제시하면 해석 오탐이다.

## 표본 선택과 판정

1. 먼저 규칙별 최소 1개 양성·1개 정상 음성, 임계값 직전/정확히 경계, missing·unknown, 독립 병렬·wrapper·기간 clipping을 합성 검증한다. included/excluded와 evidence IDs를 따로 기대값으로 고정한다. 같은 12초 retry·8초 error의 5초 overlap은 총 15초다.
2. 실제 로컬 평가 window와 provider/version/project alias·rule version·parser version·query period·timezone을 **탐지 전에** 고정한다. 실제 표본은 그 window에서 emitted 후보를 source 순으로 규칙당 최대 10개, near-threshold 또는 정상 작업 control 최대 10개 선택한다. 10개 미만이면 전부 검토하고 부족 수를 기록한다. 동일 이벤트가 여러 규칙이면 rule별 표본으로 남기되 global waste는 중복 계산하지 않는다.
3. 출력 후보만 검토하면 놓친 패턴을 알 수 없으므로 정상/near-threshold control과 합성 false-negative 검증을 별도로 보고한다. 이 작은 목적 표본을 실제 recall이나 모집단 precision으로 표현하지 않는다.
4. 기술 검토자는 필요한 관측 조건·ID·시간 scope·waste 포함과 제안 문구를 확인한다. `TP`는 정의된 조건과 제한을 지킨 탐지, `FP`는 조건 위반 또는 정상 작업을 확정 낭비로 해석한 탐지, `indeterminate`는 원본/identity/timing/맥락이 부족한 판정이다. control의 TN/FN은 따로 기록한다.
5. 적용 가능성은 `actionable / already_applied / not_applicable / insufficient_context`로 기록한다. `actionable`은 근거와 연결되는 구체적 다음 행동, 확인할 지표, 비용/범위가 설명된 경우다. 변화가 이미 효과 있었다고 주장하지 않는다.

보고 분모는 `reviewed emitted = TP + FP + indeterminate`, `determinate = TP + FP`다. `TP/determinate`를 계산할 때 두 분모와 표본 선택을 표시하며 indeterminate를 정답이나 성공으로 넣지 않는다. 제안 적용 가능성도 검토 수와 판단 불가 수를 함께 표시한다. raw prompt/command/output와 실제 파일 경로를 평가 표에 넣지 않는다.

## 사전 통과·보류 gate

- **합성 필수:** 6개 규칙 모두 양성/정상 음성·경계·unknown의 탐지 결과, evidence/included/excluded IDs와 waste 합집합이 기대값과 같아야 한다. privacy·scope 혼합·정상 작업의 확정 낭비 표현 실패는 즉시 fail이다.
- **재현 오탐:** 알려진 재현 가능 FP는 수정하거나 해당 조건에서 규칙을 억제하고 합성/로컬 재검증한다. unresolved 재현 FP를 둔 채 그 조건의 규칙을 지원 완료로 표시하지 않는다.
- **실표본 gate:** emitted/control이 없거나 판정 불가뿐이면 해당 규칙은 `pilot-unverified`다. 합성 동작은 제공할 수 있지만 검증된 유용성·threshold tuning을 주장하지 않는다. empirical 지원 승격과 출시 완료 체크는 보류한다.
- **제안 gate:** determinate TP에는 실행 가능한 다음 행동과 확인할 지표가 있어야 한다. 일반론만 있고 해당 근거와 연결되지 않으면 제안 품질 fail로 수정한다. 정상 리뷰/필요 검증을 낭비로 단정한 제안은 폐기한다.
- **잔여 불확실성:** indeterminate는 지원 한계와 confidence를 드러내고 확정 waste에서 제외한다. 부모 Codex 기술 검토자는 규칙별 unresolved FP·판단 불가 조건·표본 부족을 기록하고 `pass / fix / withhold empirical support`를 결정한다. 임의의 “허용 오탐 5%” 같은 숫자를 도입하지 않는다.
- **사람 파일럿:** AI 기술 검토를 사람의 만족·성능 개선으로 표현하지 않는다. P7의 사람이 수행한 동일 조건 전후 비교가 없으면 이 부분은 NOT RUN이다. 효과 없음·비교 불가도 보존한다.

실행 기록에는 commit, 환경, source selection alias, rule/normalization version, expected/actual, TP/FP/indeterminate/control, actionability, 검토 주체와 결정 이유가 필요하다. 기준을 바꾸면 결과를 유리하게 소급하지 않고 새 protocol revision과 이유를 남긴다.
