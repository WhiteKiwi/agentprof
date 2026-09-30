# AgentProf v0.1 Acceptance

## Status

2026-09-30. 아래는 `main 514ee77` 기준 **예정된 제품 검증**이며 모두 `NOT RUN`이다. 별도 [PR #9의 acceptance](https://github.com/WhiteKiwi/agentprof/blob/6f614727dced9df2693ac008aa3f3e4be559386c/docs/ACCEPTANCE.md)에는 P0 조사·P1 기반 실행 evidence가 있다. 그 기록을 미실시로 되돌리거나 제품 분석/파일럿 완료로 확대하지 않는다. 별도 디자인 scaffold 검증은 [DESIGN-QA.md](DESIGN-QA.md)에 기록하며 제품 acceptance 통과를 뜻하지 않는다. 병합 시 실행 기록을 보존하고 revision·환경·명령·결과로 갱신한다.

| ID | 기대 동작 | 검증 방식 | 상태 |
| --- | --- | --- | --- |
| A01 | 두 공급자의 호출·상태·시간을 연결 | 현재·구형 합성 fixture와 수작업 ID·수치 대조 | NOT RUN |
| A02 | 시간 합계·합집합·겹침 분리 | 10초 두 호출·5초 overlap에서 20초·15초 | NOT RUN |
| A03 | 장기 세션·pending·누락 보존 | 재개·미완료·duration missing이 허위 active·0이 되지 않음 | NOT RUN |
| A04 | 재스캔·append·복구 안정성 | 중단 지점별 재시작, partial UTF-8·JSON, 2회 동일 입력 | NOT RUN |
| A05 | 교체·archive·fork·중복 메시지 처리 | stable identity와 source 기여분 기대 결과 | NOT RUN |
| A06 | 같은 작업·오류의 체인·복구 | 다른 대상 성공·미해결·병렬·오류 변경 fixture | NOT RUN |
| A07 | 반복 읽기·검색·검증 의미 유지 | 변경·다른 범위·scope 불명·edit 없는 검증 제외 | NOT RUN |
| A08 | 토큰·cache 중복과 추정 분리 | response 재저장·누적 snapshot·cache 의미·미분류 | NOT RUN |
| A09 | 10 MVP 지표·6 진단 계약 | METRICS의 개별 Verify, evidence·coverage·rule version | NOT RUN |
| A10 | Detected Waste 중복 제거 | 12초·8초·5초 overlap에서 15초, 낮은 근거 제외 | NOT RUN |
| A11 | 분위수·기간·타임존 재현 | 0·1·19·20개 표본, 자정·DST·기간 경계 | NOT RUN |
| A12 | 개인정보 경계 | secret sentinel이 DB·diagnostics·HTML·artifact에 없음 | NOT RUN |
| A13 | offline HTML·텍스트 안전성 | file:// UI 동작, 요청 0건, `</script>` 삽입 공격 | NOT RUN |
| A14 | CLI·HTML 같은 값 | 동일 source·period·filters 결과 대조 | NOT RUN |
| A15 | 설치 편의와 runtime 계약 | macOS arm64·Linux의 최소24.15.0·지원24 SQLite 검증, tarball npm exec·global install·첫 실행 | NOT RUN |
| A16 | 단계별 실제 데이터 지원과 자원 사용 | P0 행렬·P2/P3 로컬 의미 대조·P7 갱신, P0 예산 대비 시간·peak RSS·HTML 크기 측정 | NOT RUN |
| A17 | 한 번의 생성·열기와 headless 결과 보존 | 별도 scan 없이 `report --open`, 새 데이터 반영, opener 없으면 HTML·경로 보존 | NOT RUN |
| A18 | 원문 폐기 전 정규화 identity 완성 | P1 계약 → P2/P3 생성 → P4 round-trip → P5 소비; 대상·플래그 차이·키 버전·secret sentinel | NOT RUN |
| A19 | 규칙별 waste 포함 의미 | slow-tool 제외, retry 첫 실패 포함, lookup 최초 제외, canonical ID·clipping·duration-only fixture | NOT RUN |
| A20 | 진단 품질·제안 유용성 | 6개 규칙별 양성/정상 음성, 로컬 검토 표본·오탐·판정 불가·실행 가능한 다음 행동 | NOT RUN |
| A21 | 초기 세로 단면 | P5 초반 두 공급자 시간·실패·재시도의 CLI/최소 offline HTML 값·근거·privacy 일치 | NOT RUN |
| A22 | 수동 개선 전후 확인 | 아래 matched before/after 절차, 조건·표본·커버리지·비교 불가/효과 없음 기록 | NOT RUN |
| A23 | 집계 수준·분모 재현 | 동시 두 stream30분: global30분/session-minutes60분; 비율1/2와9/98→10/100; pooled p95 | NOT RUN |
| A24 | 최종 usage·cache 회계 | 같은 ID output6→10은10 한 번; OpenAI100in/cache40/out20→120; Anthropic100/read30/create20/out10→160; reset/final 불명은 unknown | NOT RUN |
| A25 | 개선 카드의 근거·조치·보호 조건 | 6개 후보 분류와 기존6개 규칙 구분; 큰 출력/context/병렬 신규 규칙은 후속; 정상 반례·제안·실험·품질 gate | NOT RUN |
| A26 | 품질 보존형 전후 판정 | 같은 과제·revision·성공 기준·필수 검사 유지, parent+child token 포함, 품질 악화/효과 없음/비교 불가 보존 | NOT RUN |
| A27 | 관계·window·지원 한계 | observation window와 query clipping 분리, identity coverage, tree만으로 critical path 금지. private tool 별칭 구현은 후속 조건부 gate | NOT RUN |

## Evidence Gates and Recording

- P0: METRICS의 지표 × 필요 필드 × 공급자/버전 행렬, 수작업 의미, direct/observed/inferred/unsupported, 표본·coverage·누락 이유를 기록한다. [PR #9의 행렬](https://github.com/WhiteKiwi/agentprof/blob/6f614727dced9df2693ac008aa3f3e4be559386c/docs/EVIDENCE.md)은 작성되어 있으나 adapter·제품 분석 대조는 후속이다. 필요한 로그를 읽을 권한/환경이 없으면 차단 사유를 남기고 지원 승격을 보류한다.
- P2/P3: 해당 공급자·버전의 수작업 표본과 파서 정규화 출력 대조 및 합성 기대값을 통과한 범위만 지원한다. 실제 로그는 로컬에 남기며 raw·prompt·source·output·secret을 저장소/공유 evidence에 넣지 않는다.
- P0 자원 예산: workload(파일/이벤트/바이트/최대 줄)·장비·Node·cold/warm, full/incremental scan 시간·peak RSS·HTML 크기 한도를 먼저 결정한다. [PR #9의 resource-v1](https://github.com/WhiteKiwi/agentprof/blob/6f614727dced9df2693ac008aa3f3e4be559386c/docs/BENCHMARKS.md)에 초기 예산이 있으며 성능 측정은 NOT RUN이다. P7은 조건별 실제값과 예산 대비 pass/fail을 기록하며 측정 후 유리하게 기준을 바꾸지 않는다. 기준 변경 시 이유·revision을 남긴다.
- P5/P7 진단 품질: 규칙별 positive/normal-negative fixture와 로컬 검토 표본 수, true/false positive·판정 불가, 적용 가능한 제안/불가 사유, rule version·임계값을 기록한다. 제안은 근거 이벤트, 구체적 다음 행동, 확인할 지표, 한계가 있어야 한다. 초기 precision 목표는 미확정이며 실제 근거로 보정한다. 불확실한 사례를 정답으로 취급하지 않는다.
- 품질 통과 gate: 모든 규칙의 합성 양성/정상 음성 기대 판정과 included/excluded IDs가 맞고, 파일럿 검토자가 근거를 이해해 구체적 다음 행동과 확인 지표를 선택할 수 있어야 한다. 정상 조사·필요한 반복 검증·정상 고비중 도구를 낭비로 단정하면 실패다. 알려진 재현 가능 오탐은 수정하거나 해당 조건에서 규칙을 억제하고 재검증한다. 실표본이 없는 규칙은 파일럿 미검증으로 표시하며 검증된 유용성을 주장하지 않는다. 규칙별 평가 표본 선택·판정 절차와 출시 pass/fail 기준, 잔여 오탐의 허용/보류 판단 방법·담당 검토자는 P0에서 사전 확정하고 P7에 결정과 이유를 기록한다. 이 gate를 충족하지 못한 규칙은 완료/지원 승격하지 않는다.
- 실행 evidence 공통: repo revision, parser/normalization/rule version, 환경·명령, 기대값·실제값, 날짜·표본 선택, pass/fail/NOT RUN 및 제한. 문서 검사 통과와 제품 acceptance를 분리한다.

## v0.1 Manual Matched Before/After Pilot

1. 한 진단과 관련 작업을 고르고 변경 전 로컬 report를 보존한다. 프로젝트 별칭, 작업 종류·크기, 공급자/모델·버전, 설정, 기간·타임존·필터, rule version, 표본·분모·coverage를 기록한다.
2. 실행 가능한 개선 하나와 예상 확인 지표를 사전에 정한다. 자동 설정 변경은 하지 않는다. 같은 작업 조건의 변경 후 표본을 모아 같은 버전/필터의 report를 만든다.
3. 시간 의미별 값, 실패·재시도 수와 표본당 값, 진단 근거·coverage를 수동 대조한다. 원시 합계 차이를 작업량 차이와 혼동하지 않는다. task mix·모델·도구·데이터 지원 변화와 매칭 실패를 명시한다.
4. 개선 방향 관측/효과 없음/비교 불가로 결과와 다음 확인을 기록한다. 작은 표본·선택 편향과 교란 요인을 남기고 절감 보장이나 인과 효과를 주장하지 않는다. 자동 매칭·변경 추적·비교 UI는 v0.2다.

현재 파일럿은 **NOT RUN**이다. 이 절차는 실제 비교 결과가 아니다.

## Quality-Preserving Improvement Pilot

위 수동 파일럿의 실행 양식이다. 제품 구현·사람 검토·개선 효과는 아직 **NOT RUN**이며 아래 숫자/성공을 실측한 것으로 읽지 않는다. PR #9의 기반 테스트나 합성 계약 검사도 이 gate를 대체하지 않는다.

1. **비교 단위 고정:** 프로젝트 별칭, task ID/과제 설명의 안전한 분류, 입력 fixture/revision·작업량, provider/model/version·도구/환경, 설정과 parser/rule 버전, query period·timezone·warm/cold cache 조건을 기록한다. 명시적 작업 경계가 없으면 task elapsed는 미지원이고 대신 비교하는 시간의 정확한 이름을 쓴다.
2. **품질 기준 먼저 고정:** 기대 산출물·정답 rubric, 필수 단위/통합/회귀 테스트·빌드·정적 검사와 검토 요구를 바꾸기 전에 정한다. 정상 독립 검토/보안 gate를 생략하지 않는다. 테스트 통과만으로 정확성·완전성을 전부 증명했다고 하지 않는다. 가능한 경우 같은 rubric으로 결과를 비교하고 평가자/자동 검사와 한계를 남긴다.
3. **한 가지 변경:** output 범위, 검색 지도, targeted-first 순서, setup 확인, 요약 등 카드와 연결된 변경 하나만 정한다. baseline과 treatment의 다른 조건은 유지한다. 요약·재조회·parent/child·재시도 사용량까지 같은 accounting 범위에 포함한다. 변경 자체의 준비 비용은 따로 기록한다.
4. **반복과 순서:** 반복 가능한 동일 과제를 양쪽에서 실행하고 stochastic 변동·cache warm-up·실행 순서 영향을 기록한다. 가능하면 순서를 교차/무작위화한다. 실험 전에 반복 수와 허용 품질 조건을 정하고 좋은 결과만 선택하지 않는다. 작은 표본이면 불확실성을 남기며 임의의 유의성·확정 개선률을 붙이지 않는다.
5. **비교 값:** 완료/미완료/실패 수, 품질 gate 결과, 고유 최종 input/output/cache와 전체 관측 token, 정의된 task elapsed 또는 대체 시간, 호출/실패/재시도, coverage·unknown 수를 함께 비교한다. `(after-before)/before`는 같은 분모·단위이고 before>0일 때만 변화율로 표시한다. 작업 수가 다르면 합계 차이를 성능 개선으로 부르지 않는다.
6. **판정:** 품질 gate를 만족한 관측 개선 / 효과 없음 / 품질 악화 / 비교 불가로 남긴다. token↓·time↑처럼 trade-off가 있으면 둘 다 보인다. coverage가 바뀌거나 task mix·모델이 달라지면 단순 전후 절감을 주장하지 않는다. 작은 matched 관측은 인과 효과나 모든 작업의 절감 보장이 아니다.

기록 필드: `experiment ID`, `candidate/rule version`, 안전한 task/조건 별칭, `baseline/treatment revision`, 변경 하나, 사전 품질 기준, 실행별 outcome·tokens·시간 scope·coverage, 제외/실패/미완료 수, 관측 변화·교란 요인, 판정과 다음 확인. 실제 로그·prompt·원문 출력·개인 경로는 기록하지 않는다.

**Verify:** synthetic 결과로 (a) token/time 감소+품질 동일, (b) token 감소+필수 테스트 실패, (c) 시간 감소+coverage 하락, (d) 실패 실행 누락, (e) 변경 효과 없음, (f) parent/child 중복/누락을 입력한다. (b)는 개선 실패, (c)·(d)는 비교 보류, (e)는 유효한 효과 없음으로 남고, (f)는 accounting을 고치기 전 판정을 보류해야 한다.

## Planning Evidence

두 source 문서를 읽고 최근 로컬 로그의 필드 구조를 조사했다. 이는 구현 acceptance 통과가 아니다. 현재 확인한 사실과 한계는 [FINDINGS.md](FINDINGS.md)에 있다.
