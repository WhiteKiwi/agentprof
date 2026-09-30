# AgentProf Backlog

다음 항목은 현재 v0.1 구현 약속이 아니다. active 작업으로 옮길 때 SPEC → FINDINGS → IMPLEMENTATION → TODO 순서로 계획을 갱신한다.

## v0.2: 더 나은 비교와 탐색

- 프로젝트 필터·MCP 서버·메서드 상세와 Session Explorer 확장.
- 명시적 Skill 호출, 문서 읽기, 지침 적용 증거를 구분한 Skill 분석.
- 설정 변경 지점, 자동 조건 매칭, 동일 조건·표본 수·미분류를 드러내는 before/after 비교 UI. v0.1의 수동 파일럿 검증 절차는 active 범위이며 [ACCEPTANCE](ACCEPTANCE.md)를 따른다.
- regression·Missing Persistent Knowledge 복합 진단.
- 개인정보 필터를 유지하는 JSON·CSV export.

## Efficiency Candidate Gates

[6개 개선 후보](METRICS.md#efficiency-opportunity-cards) 중 반복 lookup·검증·실패는 기존 v0.1 규칙의 행동/실험 계약으로 다룬다. 아래 신규 자동 탐지는 아직 v0.1 구현 약속이 아니며 토큰·task elapsed를 줄인다는 효과도 검증되지 않았다.

- **큰 도구 출력:** 원문 저장 없이 per-call 출력 bytes/characters·잘림·선택 범위를 얻는 adapter 계약이 먼저다. tokenizer 추정은 provider usage와 분리한다. 필요한 근거가 줄거나 재조회가 늘어나는 정상 반례를 평가한다.
- **Context 성장:** response별 최종 input·cache·model·compaction/재개 관계가 필요하다. cumulative usage를 현재 context 길이로 읽지 않는다. 요약 비용·정보 누락·재탐색을 포함한 matched pilot을 통과해야 한다.
- **병렬 중복:** 명시 parent/child·spawn/join·task/operation·scope·content/change·clock 관계가 필요하다. fork 복사·wrapper 중복 제거와 실제 독립 실행의 중복 후보는 별도다. 의도된 independent review·교차 검증을 제거 대상으로 삼지 않는다. tree만으로 critical path를 만들지 않는다.
- **Private tool 구분:** 같은 `mcp/other`로 뭉친 호출을 원문 없이 분리하는 설치별 keyed ID·stable alias·key version/비교 범위가 필요하다. privacy sentinel과 cardinality 예산을 먼저 검증한다.

공통 승격 gate: SPEC 범위 결정 → 필요 필드/정규화 allowlist → 양성·정상 음성 합성 사례 → 공급자별 실제 의미·coverage → 근거/제안/실험/품질 보호 조건 → 오탐·비교 불가 기록. 어느 단계든 필요한 근거가 없으면 보류하고 예상 절감량을 생성하지 않는다. 관련 Verify는 [구현 우선순위](IMPLEMENTATION.md#efficiency-review-priorities)에 있다.

## Local Live Dashboard

사용자는 실시간 로컬 대시보드를 향후 확장 아이디어로 제안했다. **v0.1에서는 작업하지 않는다.** 초기 흐름은 일회성 HTML 생성과 열기다.

후속 설계에서는 동일한 분석 snapshot을 로컬 화면에 연결하고 증분 수집 결과를 갱신하는 접근을 검토한다. CLI·저장·집계와 정적 HTML 화면 생성을 분리해 두되, v0.1에 서버·watcher·polling·dashboard 명령을 만들지 않는다.

active 작업으로 옮길 때 loopback 서버의 접근·수명·동시 스캔, 갱신 주기·소스 변경·query snapshot consistency·개인정보·종료 동작을 사양으로 정하고 검증한다. 포트·프레임워크·daemon 방식은 아직 결정하지 않는다.

## 이후: 관계와 작업 분류

- heuristic·선택적 local embedding 작업 분류, query similarity.
- 명시적 parent 관계를 이용한 서브에이전트·병렬 작업 분석.
- task mix·모델·도구 차이를 통제해 설명하는 비교. causal improvement나 단순 winner 판정은 하지 않음.
- 비용 config·추가 공급자·Parquet export·선택적 팀 aggregate 공유.

## Distribution

- npm `npx`·global 경로를 검증한 뒤 Homebrew formula를 추가한다. Node 기반 CLI도 formula로 배포 가능하며 Rust 전환은 선행 조건이 아니다.
- formula는 version·checksum·runtime·native dependency를 고정하고 설치된 기능을 검증한다. tap 이름과 공개 권한은 별도 확정한다.
- Rust scanner 또는 CLI 전환은 실제 대용량 성능·메모리·설치 마찰을 측정한 뒤 판단한다. UI·지표 계약은 유지한다.
- 단일 실행 파일은 runtime·SQLite·HTML asset·지원 플랫폼의 실제 배포 검증과 함께 검토한다.

## Mascot Direction

사용자가 **Salamander / 도롱뇽**을 확정하고 3개 참고 PNG를 제공했다. 결정과 실제 자료는 [DESIGN.md](DESIGN.md)에 있다. 마스코트 후보 선정은 열린 작업이 아니다.

최종 로고 형태와 작은 크기의 광학 보정·벡터 master는 후속 시각 작업이다. 현재 제공 PNG의 임시 logo/favicon, README 초안, dark/light 재사용 디자인 기반을 별도 [가이드라인](DESIGN-GUIDELINES.md) 트랙에서 준비한다. 실제 제품 리포트 연결은 P5/P6이며, 시각 견본이 제품 구현을 완료시키지는 않는다. 제공 원본은 보존한다.
