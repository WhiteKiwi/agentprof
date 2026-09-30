# AgentProf Work Tracking

작업 순서·담당·진행 상태·실행 체크리스트는 [AgentProf GitHub Project](https://github.com/users/WhiteKiwi/projects/2)의 **Project 전용 draft item**에서 관리한다. 저장소 이슈를 새로 만들거나 draft를 이슈로 변환하지 않는다. 이 문서는 티켓 위치와 운영 규칙만 안내한다.

## 원본과 역할

- 제품 범위·의미·구현 결정은 [SPEC.md](SPEC.md), [METRICS.md](METRICS.md), [FINDINGS.md](FINDINGS.md), [IMPLEMENTATION.md](IMPLEMENTATION.md)에 둔다.
- 각 draft 본문에 목표, 선행 조건, 작업 체크리스트와 구체적인 Verify를 작성한다. 체크리스트·현재 상태를 이 문서에 복제하지 않는다.
- 실제 검증은 revision·환경·명령·기대값·결과·한계를 [ACCEPTANCE.md](ACCEPTANCE.md) 또는 해당 evidence 문서에 기록하고 draft에서 연결한다. 디자인 검증은 [DESIGN-QA.md](DESIGN-QA.md)에 둔다.
- 이전 이슈의 milestone·label·담당·PR·검증 정보는 이관 본문과 migration metadata에 보존한다. 후속 범위는 [BACKLOG.md](BACKLOG.md)에 둔다.

## 상태와 완료 기준

- **Todo:** 선행 조건·범위가 정해졌고 아직 착수하지 않은 작업.
- **In Progress:** 계획·구현·검증 또는 PR 리뷰·병합을 진행 중인 작업.
- **Done:** Verify를 통과한 작업. 코드 변경은 PR이 병합된 뒤 완료 처리한다.

구현 체크가 끝나도 리뷰·병합이 남으면 In Progress로 유지한다. 문서 작성·기반 테스트·디자인 견본 통과로 공급자 지원이나 전체 제품 acceptance를 완료 표시하지 않는다. 미실행 검증은 NOT RUN이다. 이관 때문에 기존 이슈를 닫은 것은 구현 완료를 뜻하지 않는다.

## 담당 세션과 병렬 작업

1. 착수 전에 draft 본문·Project 필드·연결 PR의 기존 담당과 의존성을 읽는다. 이미 담당이 있으면 중복으로 잡지 않고 조정 세션을 통해 협업 범위나 인계를 정한다.
2. draft의 Work claim 절에 아래 필드를 기록하고 readback한다. 실제 Codex 세션 ID를 사용한다. 서브에이전트는 조정 세션 ID와 도구가 반환한 agent 이름을 함께 적어 구별한다. 기록 뒤 Status를 **In Progress**로 옮긴다. 사람용 별칭만 확인된 담당은 이를 보존하고 실제 세션 ID를 추측하지 않는다.
   보드의 Owner에는 담당 이름, Owner session에는 확인한 실제 세션 ID를 적는다. ID가 미확인인 기존 별칭은 본문에 한계를 명시하고 Owner session은 비워 둔다. 본문 claim과 필드를 함께 갱신한다.
3. 한 세션은 한 번에 티켓 하나만 맡는다. 병렬 가능하다는 이유로 같은 세션이 다른 티켓까지 자동 배정·착수하지 않는다. 다른 세션의 개발 담당은 별도 브랜치·worktree를 사용한다. 공유 인터페이스나 같은 파일의 수정 소유권은 먼저 정한다. 한 티켓의 담당은 한 세션이며 조사·개발·리뷰 서브세션은 별도 contributor로 적는다.
4. 선행 티켓 전체가 끝나지 않아도 독립 부분은 계획·Verify를 정해 시작할 수 있다. 공급자 어댑터와 SQLite 저장 primitive는 병렬 가능하다. 공급자 연동·checkpoint 재시작은 어댑터 계약과 상태 복구 검증을 기다린다. 부분 통과로 전체 티켓을 Done으로 바꾸지 않는다.
5. 범위·단계·의존성·담당·PR이 바뀌거나 검증이 끝나면 claim을 갱신한다. 대기 시간만으로 다른 세션의 소유권을 회수하지 않는다. 종료·중단·인계 때 완료 범위, 남은 검증과 다음 담당을 기록한다. 담당이 없고 진행을 멈춘 작업은 Todo로 되돌린다.
6. 부모는 변경 검토·공유 파일 통합·CI·병합 순서를 조정한다. Verify 통과와 코드 PR 병합 후에만 Done으로 옮긴다. 실시간 배정표·체크리스트는 Project에만 둔다.

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

## Project 조작

- 생성: Project에 draft item을 직접 추가한다. CLI의 gh project item-create 또는 GraphQL addProjectV2DraftIssue를 사용한다. repository issue 생성은 사용하지 않는다.
- 본문·제목: updateProjectV2DraftIssue에는 draft content ID를 전달한다.
- 상태·필드: updateProjectV2ItemFieldValue에는 Project item ID와 해당 field/option ID를 전달한다. draft content ID와 Project item ID를 혼동하지 않는다.
- 게시: PR 본문에 Project 티켓 링크를 넣는다. Closes #... 같은 이슈 자동 닫기 표현은 새 작업에서 사용하지 않는다.
- 완료: 검증 evidence와 PR 병합을 확인한 뒤 draft의 체크·claim·Status를 갱신한다.

## 티켓 위치

| 단계 | Project 전용 티켓 |
| --- | --- |
| P0 | [로그·지표 계약과 합성 fixture](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258832949) |
| P1 | [npm CLI 기반과 개인정보 경계](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258832975) |
| P2 | [Codex 어댑터](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833002) |
| P3 | [Claude Code 어댑터](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833029) |
| P4 | [SQLite 저장과 증분 scan](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833059) |
| P5 | [지표·진단·stats·insights](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833093) |
| P6 | [오프라인 HTML 리포트](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833122) |
| P7 | [설치 artifact와 로컬 파일럿](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833142) |
| Design | [브라우저·접근성·README QA](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833178) |
| Workflow | [세션 담당·추적 규칙](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833206) |

2026-09-30에는 체크리스트를 이슈로 관리했다. 2026-10-01 사용자 요청으로 기존 10개 항목의 본문·Verify·담당·상태를 draft로 이관했다. 이전 이슈는 이관 안내와 함께 닫아 이력을 보존했고, 보드에서 기존 issue 항목을 제거했다. 원문과 댓글 이력은 migration metadata의 이전 링크로 확인한다.
