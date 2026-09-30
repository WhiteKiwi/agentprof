# AgentProf v0.1 Acceptance

## Status

2026-09-30. 아래는 **예정된 검증**이다. 제품 코드·test suite·배포 artifact가 없어 실행 검증은 모두 `NOT RUN`이다. 구현 후 실제 명령·환경·revision·결과로 갱신한다.

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

## Evidence Gates and Recording

- P0: METRICS의 지표 × 필요 필드 × 공급자/버전 행렬, 수작업 의미, direct/observed/inferred/unsupported, 표본·coverage·누락 이유를 기록한다. 현재 NOT RUN/TBD다. 필요한 로그를 읽을 권한/환경이 없으면 차단 사유를 남기고 지원 승격을 보류한다.
- P2/P3: 해당 공급자·버전의 수작업 표본과 파서 정규화 출력 대조 및 합성 기대값을 통과한 범위만 지원한다. 실제 로그는 로컬에 남기며 raw·prompt·source·output·secret을 저장소/공유 evidence에 넣지 않는다.
- P0 자원 예산: workload(파일/이벤트/바이트/최대 줄)·장비·Node·cold/warm, full/incremental scan 시간·peak RSS·HTML 크기 한도를 먼저 결정한다. 현재 모든 한도 TBD, 측정 NOT RUN. P7은 조건별 실제값과 예산 대비 pass/fail을 기록하며 측정 후 유리하게 기준을 바꾸지 않는다. 기준 변경 시 이유·revision을 남긴다.
- P5/P7 진단 품질: 규칙별 positive/normal-negative fixture와 로컬 검토 표본 수, true/false positive·판정 불가, 적용 가능한 제안/불가 사유, rule version·임계값을 기록한다. 제안은 근거 이벤트, 구체적 다음 행동, 확인할 지표, 한계가 있어야 한다. 초기 precision 목표는 미확정이며 실제 근거로 보정한다. 불확실한 사례를 정답으로 취급하지 않는다.
- 품질 통과 gate: 모든 규칙의 합성 양성/정상 음성 기대 판정과 included/excluded IDs가 맞고, 파일럿 검토자가 근거를 이해해 구체적 다음 행동과 확인 지표를 선택할 수 있어야 한다. 정상 조사·필요한 반복 검증·정상 고비중 도구를 낭비로 단정하면 실패다. 알려진 재현 가능 오탐은 수정하거나 해당 조건에서 규칙을 억제하고 재검증한다. 실표본이 없는 규칙은 파일럿 미검증으로 표시하며 검증된 유용성을 주장하지 않는다. 규칙별 평가 표본 선택·판정 절차와 출시 pass/fail 기준, 잔여 오탐의 허용/보류 판단 방법·담당 검토자는 P0에서 사전 확정하고 P7에 결정과 이유를 기록한다. 이 gate를 충족하지 못한 규칙은 완료/지원 승격하지 않는다.
- 실행 evidence 공통: repo revision, parser/normalization/rule version, 환경·명령, 기대값·실제값, 날짜·표본 선택, pass/fail/NOT RUN 및 제한. 문서 검사 통과와 제품 acceptance를 분리한다.

## v0.1 Manual Matched Before/After Pilot

1. 한 진단과 관련 작업을 고르고 변경 전 로컬 report를 보존한다. 프로젝트 별칭, 작업 종류·크기, 공급자/모델·버전, 설정, 기간·타임존·필터, rule version, 표본·분모·coverage를 기록한다.
2. 실행 가능한 개선 하나와 예상 확인 지표를 사전에 정한다. 자동 설정 변경은 하지 않는다. 같은 작업 조건의 변경 후 표본을 모아 같은 버전/필터의 report를 만든다.
3. 시간 의미별 값, 실패·재시도 수와 표본당 값, 진단 근거·coverage를 수동 대조한다. 원시 합계 차이를 작업량 차이와 혼동하지 않는다. task mix·모델·도구·데이터 지원 변화와 매칭 실패를 명시한다.
4. 개선 방향 관측/효과 없음/비교 불가로 결과와 다음 확인을 기록한다. 작은 표본·선택 편향과 교란 요인을 남기고 절감 보장이나 인과 효과를 주장하지 않는다. 자동 매칭·변경 추적·비교 UI는 v0.2다.

현재 파일럿은 **NOT RUN**이다. 이 절차는 실제 비교 결과가 아니다.

## Planning Evidence

두 source 문서를 읽고 최근 로컬 로그의 필드 구조를 조사했다. 이는 구현 acceptance 통과가 아니다. 현재 확인한 사실과 한계는 [FINDINGS.md](FINDINGS.md)에 있다.

