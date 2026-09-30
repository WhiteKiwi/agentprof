# AgentProf Backlog

다음 항목은 현재 v0.1 구현 약속이 아니다. active 작업으로 옮길 때 SPEC → FINDINGS → IMPLEMENTATION → TODO 순서로 계획을 갱신한다.

## v0.2: 더 나은 비교와 탐색

- 프로젝트 필터·MCP 서버·메서드 상세와 Session Explorer 확장.
- 명시적 Skill 호출, 문서 읽기, 지침 적용 증거를 구분한 Skill 분석.
- 설정 변경 지점, 동일 조건·표본 수·미분류를 드러내는 before/after 비교.
- regression·Missing Persistent Knowledge 복합 진단.
- 개인정보 필터를 유지하는 JSON·CSV export.

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

최종 로고 형태, favicon·벡터 자산, README 배치와 리포트 테마는 후속 시각 작업이다. 제공 참고를 우선하고 작은 아이콘·다크·라이트 대비를 실제 렌더링으로 검증한다.
