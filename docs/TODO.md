# AgentProf v0.1 TODO

## Status

2026-09-30. 문서·초기 조사 단계다. 제품 구현은 미착수이며, 아래 구현 체크는 모두 열린 상태다. [SPEC.md](SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md), [METRICS.md](METRICS.md), [IMPLEMENTATION.md](IMPLEMENTATION.md)에 따라 진행한다.

단계마다 구체적인 `Verify`를 수행한 뒤 완료로 표시하고 실제 evidence를 붙인다. 제품 범위·구현 결정이 달라지면 해당 문서를 먼저 갱신한다. 다음 코드 작업은 개발 서브세션에서 맡는다.

## Planning and Repository Bootstrap

- [x] 원본 두 문서와 locron 구조를 반영한 계획을 검토하고 저장소에 게시한다.
  **Verify:** 원본 두 파일의 SHA-256이 Downloads 파일과 일치한다. 문서 링크, 10 MVP 지표·6 진단, 개인정보·시간 계약과 단계별 검증이 서로 일치한다. private GitHub 저장소의 main에서 동일 문서를 확인한다.
  **Evidence:** 2026-09-30 원문 2개·참고 PNG 3개의 SHA-256 동일성, 로컬 문서 링크 49개, TODO 18개 항목의 Verify와 staged diff whitespace 검사를 통과했다. 계획 서브세션 검토와 부모 검토를 마쳤다. `00000ed89054180014db5a89ede7d4fa8bda3fc2`의 로컬 HEAD·GitHub main이 일치하고 저장소는 PRIVATE다. 8개 열린 구현 이슈와 2개 마일스톤을 확인했다. 제품 실행 acceptance는 아직 NOT RUN이다.

## P0 — Logs, Metric Contracts and Synthetic Fixtures

GitHub: [#1](https://github.com/WhiteKiwi/agentprof/issues/1)

- [ ] 현재·구형 입력과 capability 지원표, provider별 ID 연결을 정의한다.
  **Verify:** Codex 완료 항목·response, Claude call/result·중복 메시지·sidechain·archive·fork fixture에서 기대 event IDs와 호출 수를 수작업으로 확인한다.
- [ ] 시간·10 지표·6 진단의 합성 기대값과 개인정보 sentinel을 작성한다.
  **Verify:** 순차·병렬·retry overlap·unresolved recovery·반복 읽기 변경·토큰 누적·날짜 경계의 계산을 METRICS와 대조한다. 실제 사용자 원문이 fixture에 없다.

## P1 — CLI Foundation and Privacy Boundary

GitHub: [#2](https://github.com/WhiteKiwi/agentprof/issues/2)

- [ ] 런타임·SQLite driver·package manager·의존성을 고정하고 빌드·도움말·CI를 구성한다.
  **Verify:** macOS arm64·Linux의 Node 24.15.0과 현재 지원 24 버전에서 SQLite import·parameter binding·transaction rollback·migration·close-reopen, clean install·빌드·help/version을 실행한다. 미지원 구형 Node에서 명확한 진단을 확인한다. 설치 스크립트·native addon 요구사항을 기록한다.
- [ ] 로컬 데이터 경로·입력 override·권한·허용 필드·원문 없는 진단을 구현한다.
  **Verify:** 입력 파일 hash가 바뀌지 않는다. secret sentinel이 정규화 결과·진단에 남지 않는다. empty input, 큰 줄과 root 밖 symlink에서 정해진 동작을 확인한다.

## P2 — Codex Adapter

GitHub: [#3](https://github.com/WhiteKiwi/agentprof/issues/3)

- [ ] 현재 구조화된 완료 항목과 구형 호출·결과 fallback을 구현한다.
  **Verify:** item scope·namespace·content-block output·직접 duration·paired timestamp의 fixture 기대값이 맞는다. wrapper와 내부 항목을 이중 집계하지 않는다.
- [ ] pending·취소·process polling·fork·archive·token source 중복을 처리한다.
  **Verify:** 나중 결과 갱신, 누적 polling 시간 제외, 복사된 이력과 실제 새 실행 분리, unsupported record 진단을 확인한다.

## P3 — Claude Code Adapter

GitHub: [#4](https://github.com/WhiteKiwi/agentprof/issues/4)

- [ ] UUID·parent·call/result·agent·sidechain 연결과 source roots를 구현한다.
  **Verify:** 동시 호출·중복 메시지·누락 결과에서 ID와 호출 수가 맞는다. `CLAUDE_CONFIG_DIR`로 지정한 임시 root를 읽는다.
- [ ] 직접 duration·관측 구간·turn duration과 usage 의미를 구분한다.
  **Verify:** timing 누락이 0이나 측정값으로 바뀌지 않는다. background result·다른 duration scope·cache 사용량 fixture가 기대 classification을 낸다.

## P4 — SQLite and Incremental Scan

GitHub: [#5](https://github.com/WhiteKiwi/agentprof/issues/5)

- [ ] 이벤트·진단·pending 상태와 완전한 줄 checkpoint를 원자적으로 저장한다.
  **Verify:** 2회 같은 스캔, append·잘린 UTF-8·partial JSON·중단 후 재시작에서 DB 의미 결과가 같다. checkpoint만 앞서 나가지 않는다.
- [ ] 교체·truncate·archive 이동·삭제·parser version 변경을 처리한다.
  **Verify:** 소스 기여분의 원자적 교체, 이동 중복 방지, 접근 불가 이력 보존과 미지원 압축 진단을 확인한다.

## P5 — Metrics, Diagnostics and CLI Results

GitHub: [#6](https://github.com/WhiteKiwi/agentprof/issues/6)

- [ ] 안전한 commandPattern과 별도 operation identity, 실패 의미를 구현한다.
  **Verify:** 대상·플래그가 다른 작업을 연결하지 않는다. `rg` exit 1, compound command·env·URL·heredoc에서 기대 분류와 비밀값 제거를 확인한다.
- [ ] 10개 MVP 지표와 evidence·coverage·표본 수를 구현한다.
  **Verify:** METRICS 각 `Verify`와 ACCEPTANCE 행렬의 수작업 기대값이 맞는다. unknown·unresolved·unattributed를 보존한다.
- [ ] 6개 진단, Detected Waste 합집합과 `stats`·`insights` 출력을 구현한다.
  **Verify:** 규칙 ID·version·근거·임계값·추천을 확인한다. retry 12초·repeated error 8초·overlap 5초의 총계가 15초다. coarse heuristic은 고신뢰 시간 총계에 들어가지 않는다.

## P6 — Offline Report

GitHub: [#7](https://github.com/WhiteKiwi/agentprof/issues/7)

- [ ] 증분 수집을 포함한 `report --open`, Time Breakdown·Detected Waste·Top Insights와 7개 상세 화면을 구현한다.
  **Verify:** 동일 조건 CLI와 HTML 수치가 같다. empty·partial·low coverage·pending·작은 화면·키보드 동작을 렌더링으로 확인한다.
- [ ] 자산을 single HTML에 포함하고 data insertion·OS opener를 검증한다.
  **Verify:** 별도 scan 없이 새 입력으로 `report --open`이 생성·열기를 수행한다. `file://`에서 네트워크 요청 0건으로 기능이 동작한다. secret·원문·입력 절대 경로가 없다. `</script>` fixture가 실행되지 않는다. opener에 파일 경로를 셸 문자열로 삽입하지 않고 opener 없는 환경에서도 HTML·경로를 보존한다.

## P7 — Package, Pilot and Release Readiness

GitHub: [#8](https://github.com/WhiteKiwi/agentprof/issues/8)

- [ ] 공개 패키지명·license·설치 경로를 정하고 packed artifact를 검증한다.
  **Verify:** 격리된 npm cache·prefix에서 tarball 기반 npm exec와 global install을 수행한다. publish 후 실제 이름의 `npx` 경로를 확인한다. 소스·fixture·원문 데이터가 배포 artifact에 없다.
- [ ] 로컬 파일럿으로 수치·자원·지원 한계를 검증하고 출시 문서를 작성한다.
  **Verify:** 두 공급자의 수작업 표본과 수치가 맞는다. clean install → scan → stats → insights → report를 macOS arm64·Linux에서 확인한다. 시간·메모리·HTML 크기의 측정 조건과 실패를 ACCEPTANCE에 기록한다.

Homebrew·Rust·추가 비교 기능은 [BACKLOG.md](BACKLOG.md)에 있다. active TODO로 옮기기 전에 사양·연구·구현 계획을 갱신한다.
