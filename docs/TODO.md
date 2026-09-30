# AgentProf Work Tracking

작업 순서·진행 상태·실행 체크리스트는 [AgentProf GitHub Project](https://github.com/users/WhiteKiwi/projects/2)와 연결된 [이슈](https://github.com/WhiteKiwi/agentprof/issues)에서 관리한다. 이 문서는 보드 링크와 운영 규칙을 안내한다.

## 원본과 역할

- 제품 범위·의미·구현 결정은 [SPEC.md](SPEC.md), [METRICS.md](METRICS.md), [FINDINGS.md](FINDINGS.md), [IMPLEMENTATION.md](IMPLEMENTATION.md)에 둔다.
- 각 이슈에 목표, 선행 조건, 작업 체크리스트와 구체적인 `Verify`를 작성한다. 체크리스트·현재 상태를 이 문서에 복제하지 않는다.
- 실제 검증은 revision·환경·명령·기대값·결과·한계를 [ACCEPTANCE.md](ACCEPTANCE.md) 또는 해당 evidence 문서에 기록하고 이슈에서 연결한다. 디자인 검증은 [DESIGN-QA.md](DESIGN-QA.md)에 둔다.
- 출시 범위는 [v0.1-alpha](https://github.com/WhiteKiwi/agentprof/milestone/1)와 [v0.1](https://github.com/WhiteKiwi/agentprof/milestone/2) 마일스톤으로 구분한다. 후속 아이디어는 [BACKLOG.md](BACKLOG.md)에 둔다.

## 상태와 완료 기준

- **Todo:** 선행 조건·범위가 정해졌고 아직 착수하지 않은 작업.
- **In Progress:** 구현·검증 또는 PR 리뷰·병합을 진행 중인 작업.
- **Done:** `Verify`를 통과하고 이슈를 완료 처리한 작업. 코드 변경은 PR이 병합된 뒤 완료 처리한다.

구현 체크가 끝나도 리뷰·병합이 남으면 이슈를 열어 둔다. 문서 작성·기반 테스트·디자인 견본 통과로 공급자 지원이나 전체 제품 acceptance를 완료 표시하지 않는다. 미실행 검증은 `NOT RUN`으로 남긴다.

## 작업 흐름

1. 범위나 계약이 바뀌면 관련 계획 문서를 먼저 갱신한다.
2. 이슈에 작업과 `Verify`를 작성하고 Project에 추가한다. 세 단계 이상 계획의 각 구현 단계에는 구체적인 `Verify`가 필요하다.
3. [AGENTS.md](../AGENTS.md)에 따라 개발 서브세션이 구현하고 부모가 변경·검증·게시를 검토한다.
4. 실제 evidence를 기록하고 이슈 체크·PR·Project 상태를 갱신한다. 완료 기준을 충족하면 이슈를 닫고 **Done**으로 표시한다.

2026-09-30에 기존 P0–P7 체크리스트와 `Verify`를 이슈 #1–#8로 이관했다. 별도 디자인 작업의 미완료 검증은 [#10](https://github.com/WhiteKiwi/agentprof/issues/10)으로 추적한다. 이전 체크리스트와 bootstrap 기록은 Git 이력에 남아 있다.
