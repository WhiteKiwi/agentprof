# AgentProf Work Tracking

작업 순서·담당·진행 상태·의존성·실행 체크리스트는 [저장소 GitHub Issues](https://github.com/WhiteKiwi/agentprof/issues)에서 관리한다. 2026-10-03 사용자 요청으로 이전 Project 전용 규칙을 대체했다. 이 문서는 티켓 위치와 운영 규칙만 안내하며 실시간 체크리스트·담당표를 복제하지 않는다. [이전 Project](https://github.com/users/WhiteKiwi/projects/2)는 이력 보관용이다.

## 원본과 역할

- 제품 범위·의미·구현 결정은 [SPEC.md](SPEC.md), [METRICS.md](METRICS.md), [FINDINGS.md](FINDINGS.md), [IMPLEMENTATION.md](IMPLEMENTATION.md)에 둔다.
- 이슈 본문에 목표·범위·완료 기준, 계획 링크, 선행 조건, 작업 체크리스트와 구체적인 Verify를 작성한다. 단계가 3개 이상인 계획은 모든 단계에 Verify를 둔다.
- SPEC → 별도 조사와 FINDINGS → IMPLEMENTATION → 이슈와 Verify → 계획 검토 → 별도 개발 서브세션 순서를 따른다. 기존 이슈를 같은 범위에 재사용하며 계획 변경은 구현보다 먼저 반영한다.
- 실제 검증은 revision·환경·명령·기대값·결과·한계를 [ACCEPTANCE.md](ACCEPTANCE.md) 또는 해당 evidence 문서에 기록하고 이슈에서 연결한다. 디자인 검증은 [DESIGN-QA.md](DESIGN-QA.md)에 둔다.
- 이전 이슈·Project의 milestone·label·담당·PR·검증·실패 이력은 이관된 본문과 연결된 원문 보관 댓글에 보존한다. 후속 범위는 [BACKLOG.md](BACKLOG.md)에 둔다.

## 상태와 완료 기준

- **Todo:** 열린 이슈 + `status:todo`. 선행 조건·범위가 정해졌고 아직 착수하지 않은 작업.
- **In Progress:** 열린 이슈 + `status:in-progress`. 계획·구현·검증 또는 PR 리뷰·병합을 진행 중인 작업.
- **Done:** 자신의 Verify를 통과하고 코드·문서 PR이 병합된 뒤 `completed`로 닫은 이슈. 현재 상태 label 두 개는 제거하고 다른 label·milestone·이력은 보존한다.

열린 작업 이슈에는 두 상태 label 중 정확히 하나를 둔다. 구현 체크가 끝나도 리뷰·병합이나 후속 Verify가 남으면 In Progress로 유지한다. 부분 PR은 넓은 부모 이슈의 완료 조건을 대신하지 않는다. 문서 작성·기반 테스트·디자인 견본 통과로 공급자 지원이나 전체 제품 acceptance를 완료 표시하지 않는다. 미실행 검증은 NOT RUN이다. 취소나 과거 이관 때문에 `NOT_PLANNED`로 닫은 이슈는 Done의 근거가 아니다.

## 담당 세션과 병렬 작업

1. 착수 전에 이슈 본문·담당·연결 PR의 기존 claim과 의존성을 읽는다. 이미 담당이 있으면 중복으로 잡지 않고 조정 세션을 통해 협업 범위나 인계를 정한다.
2. 이슈의 Work claim 절에 아래 필드를 기록하고 readback한다. 실제 Codex 세션 ID를 사용한다. 서브에이전트는 조정 세션 ID와 도구가 반환한 agent 이름을 함께 적어 구별한다. 확인 뒤 `status:todo`를 `status:in-progress`로 바꾸고 저장된 상태를 다시 읽는다. 사람용 별칭만 확인된 담당은 이를 보존하고 실제 세션 ID를 추측하지 않는다. GitHub assignee는 계정 배정이며 세션 ID를 대신하지 않는다.
3. 한 세션은 한 번에 티켓 하나만 맡는다. 병렬 가능하다는 이유로 같은 세션이 다른 티켓까지 자동 배정·착수하지 않는다. 다른 세션의 개발 담당은 별도 브랜치·worktree를 사용한다. 공유 인터페이스나 같은 파일의 수정 소유권은 먼저 정한다. 한 티켓의 담당은 한 세션이며 조사·개발·리뷰 서브세션은 별도 contributor로 적는다.
4. 선행 티켓 전체가 끝나지 않아도 독립 부분은 계획·Verify를 정해 시작할 수 있다. 공급자 어댑터와 SQLite 저장 primitive는 병렬 가능하다. 공급자 연동·checkpoint 재시작은 어댑터 계약과 상태 복구 검증을 기다린다. 부분 통과로 전체 티켓을 닫지 않는다.
5. 범위·단계·의존성·담당·PR이 바뀌거나 검증이 끝나면 claim을 갱신한다. 대기 시간만으로 다른 세션의 소유권을 회수하지 않는다. 종료·중단·인계 때 완료 범위, 반환한 파일 예약, 남은 검증과 다음 담당을 기록한다. 담당이 없고 진행을 멈춘 열린 작업은 `status:todo`로 되돌린다.
6. 부모는 변경 검토·공유 파일 통합·CI·병합 순서를 조정한다. 자신의 Verify 통과와 PR 병합 후에만 해당 이슈를 완료 처리한다. 실시간 배정표·체크리스트는 이슈에만 둔다.

```markdown
## Work claim

- Coordinator session: <actual Codex session ID>
- Owner: <actual session ID, or coordinator ID + actual agent name>
- Contributors: <research/development/review sessions and scope>
- Branch / worktree: <branch and isolated worktree>
- Scope / reserved files: <phase and owned paths>
- Dependencies / waiting for: <required contract, ticket or verification>
- Next Verify: <concrete next check>
- Updated: <timestamp with timezone>
- Handoff / PR: <link or remaining work; no invented session IDs>
```

## 이슈 조작

- 생성: 같은 범위의 기존 이슈를 먼저 찾는다. 새 작업은 [Task 양식](../.github/ISSUE_TEMPLATE/task.yml)이나 `gh issue create --repo WhiteKiwi/agentprof --body-file <file> --label status:todo`로 만든다. Project 항목을 새로 만들거나 이슈를 이전 Project에 추가하지 않는다. 양식은 기본 담당을 배정하지 않는다.
- 본문·제목·상태: 해당 repository issue를 갱신한다. 새 본문으로 바꾸기 전 긴 원문·이력을 보존하고 저장 후 readback한다. 상태 label을 교체할 때 다른 label·assignee·milestone을 덮어쓰지 않는다.
- 게시: PR 본문에 담당 이슈를 연결한다. 부분 작업이나 병합 뒤 검증·후속 조작이 남으면 `Refs #...`로 연결하고 gate 통과 뒤 수동으로 닫는다. 좁은 자식 PR에 넓은 부모 이슈의 `Closes #...`를 쓰지 않는다.
- 완료·인계: 실제 evidence와 PR 병합을 확인한 뒤 체크·claim을 갱신하고 파일 예약을 반환한다. 자신의 완료 기준이 전부 충족된 이슈만 `completed`로 닫는다. 중단·취소 이유와 역사적인 unchecked 체크는 완료로 바꾸지 않는다.

## 티켓 위치

아래는 이슈 탐색 링크이며 현재 담당·상태·체크리스트는 각 이슈 본문을 따른다.

| 범위 | 저장소 이슈 |
| --- | --- |
| P4 | [#5 · SQLite 저장과 증분 scan](https://github.com/WhiteKiwi/agentprof/issues/5) |
| P5 | [#6 · 지표·진단·stats·insights](https://github.com/WhiteKiwi/agentprof/issues/6) |
| P6 | [#7 · 오프라인 HTML 리포트](https://github.com/WhiteKiwi/agentprof/issues/7) |
| P7 | [#8 · 설치 artifact와 로컬 파일럿](https://github.com/WhiteKiwi/agentprof/issues/8) |
| Design | [#10 · 브라우저·접근성·README QA](https://github.com/WhiteKiwi/agentprof/issues/10) |
| Exploration | [#50 · 관측된 탐색 패턴 평가](https://github.com/WhiteKiwi/agentprof/issues/50) |

2026-10-03 추적 방식 이관은 [Workflow #49](https://github.com/WhiteKiwi/agentprof/issues/49)와 [이관 계획](IMPLEMENTATION.md#repository-issue-tracking-migration-plan-2026-10-03), [이관 검증 기록](ACCEPTANCE.md#repository-issue-tracking-migration--2026-10-03)에서 확인한다. 이관 자체는 제품 acceptance 완료가 아니다.

## 완료 항목과 이전 이력

완료된 P0–P3와 이전 Workflow는 다시 만들거나 재개하지 않는다. 아래 Project 링크와 기존 닫힌 이슈는 당시의 검증·이관 이력을 읽는 용도다.

| 완료된 범위 | 보관된 Project 기록 |
| --- | --- |
| P0 | [로그·지표 계약과 합성 fixture](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258832949) |
| P1 | [npm CLI 기반과 개인정보 경계](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258832975) |
| P2 | [Codex 어댑터](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833002) |
| P3 | [Claude Code 어댑터](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833029) |
| 이전 Workflow | [세션 담당·추적 규칙](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833206) |

2026-09-30에는 체크리스트를 이슈로 관리했다. 2026-10-01 사용자 요청으로 기존 10개 항목의 본문·Verify·담당·상태를 Project 전용 draft로 이관하고, 미완료 이슈를 `NOT_PLANNED`로 닫았다. 이 상태는 구현 완료를 뜻하지 않았다. 2026-10-03에는 같은 범위의 미완료 이슈 #5/#6/#7/#8/#10을 재사용하고, 대응 이슈가 없던 탐색 작업만 #50으로 만들었다. 이전 본문·실패·PR·담당 이력은 이슈의 원문 보관 댓글과 이전 Project에 보존한다. 날짜가 있는 예전 Project 전용 지침은 현재 운영 규칙으로 적용하지 않는다.
