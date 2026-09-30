# AgentProf v0.1 TODO

## Status

2026-09-30. `36bb389`의 개정 계획으로 P0 조사·계약·합성 fixture 검토를 마쳤고 P1 CLI·개인정보 기반을 구현 중이다. 파서·집계·HTML은 후속 단계다. 공급자 지원과 제품 acceptance를 계약 검사 통과로 간주하지 않는다. [SPEC.md](SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md), [METRICS.md](METRICS.md), [IMPLEMENTATION.md](IMPLEMENTATION.md)에 따라 진행한다.

2026-09-30 개정된 단계·Verify를 GitHub 이슈 #1–#8에 동기화하고 본문 readback을 확인했다. 실제 구현 상태·검증 evidence는 이 문서를 우선한다.

단계마다 구체적인 `Verify`를 수행한 뒤 완료로 표시하고 실제 evidence를 붙인다. 제품 범위·구현 결정이 달라지면 해당 문서를 먼저 갱신한다. 코드 작업은 개발 서브세션에서 맡고 부모가 계획·변경·검증과 게시를 검토한다. P0 evidence와 기대값 검토 후 P1로 진행한다.

## Planning and Repository Bootstrap

- [x] 원본 두 문서와 locron 구조를 반영한 계획을 검토하고 저장소에 게시한다.
  **Verify:** 원본 두 파일의 SHA-256이 Downloads 파일과 일치한다. 문서 링크, 10 MVP 지표·6 진단, 개인정보·시간 계약과 단계별 검증이 서로 일치한다. private GitHub 저장소의 main에서 동일 문서를 확인한다.
  **Evidence:** 2026-09-30 원문 2개·참고 PNG 3개의 SHA-256 동일성, 로컬 문서 링크 49개, TODO 18개 항목의 Verify와 staged diff whitespace 검사를 통과했다. 계획 서브세션 검토와 부모 검토를 마쳤다. `00000ed89054180014db5a89ede7d4fa8bda3fc2`의 로컬 HEAD·GitHub main이 일치하고 저장소는 PRIVATE다. 8개 열린 구현 이슈와 2개 마일스톤을 확인했다. 제품 실행 acceptance는 아직 NOT RUN이다.

## P0 — Empirical Evidence, Contracts and Synthetic Fixtures

GitHub: [#1](https://github.com/WhiteKiwi/agentprof/issues/1)

- [x] 허용된 로컬 실로그로 지표·공급자·버전별 필요 필드·의미·커버리지 행렬을 작성한다.
  **Verify:** METRICS 행렬의 모든 지표에 direct/observed/inferred/unsupported, inspected/eligible/timed 표본 수, 선택 조건·누락 이유·합성 fixture 연결을 기록한다. 원문·명령·출력 업로드가 없다. 접근/검증 부재는 NOT RUN이며 지원 완료로 표시하지 않는다.
  **Evidence:** [EVIDENCE.md](EVIDENCE.md)의 12개 로컬 표본·4,286개 완전 레코드·7개 header 버전 층 × 10개 지표를 부모가 검토했다. 후보 호출·턴·usage 분모와 누락·ambiguous origin을 분리했다. 원문은 저장소 밖에 유지한다. 파서 결과와 제품 지원 승격은 NOT RUN이다.
- [x] 진단 품질 평가와 자원 측정 조건·예산을 정한다.
  **Verify:** 6개 규칙 각각 양성·정상 음성, 평가 표본 선택·판정, 오탐 검토·구체적 다음 행동의 판단 방법과 출시 pass/fail gate·검토자가 사전 확정되어 있다. workload·장비·Node·cold/warm 조건과 full/incremental 시간·peak RSS·최대 줄·HTML 크기 예산을 기록한다. 미결정은 TBD이고 측정은 NOT RUN이다.
  **Evidence:** [QUALITY.md](QUALITY.md)의 6개 규칙·기술 검토자·목적 표본·오탐 보류 gate와 [BENCHMARKS.md](BENCHMARKS.md)의 workload·M4 기준 장비·Node·cold/warm·사전 예산을 검토했다. 64 KiB chunk, LF 제외 raw 1 MiB line 제한을 정했다. Linux 기준 장비 배정·제품 성능·사람 파일럿은 NOT RUN이다.

- [x] 현재·구형 입력과 capability 지원표, provider별 ID 연결을 정의한다.
  **Verify:** Codex 완료 항목·response, Claude call/result·중복 메시지·sidechain·archive·fork fixture에서 기대 event IDs와 호출 수를 수작업으로 확인한다.
  **Evidence:** [FIXTURES.md](FIXTURES.md)와 provider expected JSON의 7개 shape를 검토했다. 7개 JSONL·55개 합성 레코드의 문법·ID 참조·canonical 호출 수·archive byte 동일성을 확인했다. annotation 없는 fork는 origin 불명이다. 실버전 지원 목록과 shape 계약을 구분했다.
- [x] 시간·10 지표·6 진단의 합성 기대값과 개인정보 sentinel을 작성한다.
  **Verify:** 순차·병렬·retry overlap·unresolved recovery·반복 읽기 변경·토큰 누적·날짜 경계의 계산을 METRICS와 대조한다. 실제 사용자 원문이 fixture에 없다. 규칙별 waste 포함표, 첫 실패 포함/첫 lookup 제외, slow-tool 단독 제외, canonical wrapper·병렬·기간 clipping의 수작업 기대값을 고정한다.
  **Evidence:** 19개 metric 사례·9개 waste 사례·6개 진단 각각 양성/정상 음성·독립 sentinel을 고정했다. 부모의 독립 계산으로 sum 20초/union 15초, retry 9초·recovery 11초, lookup 6초, rule overlap 총 15초, clipping 7초, nearest-rank와 53/91 비율을 대조했다. 이는 oracle 검토이며 parser/analyzer 실행 통과가 아니다.

## P1 — CLI Foundation and Privacy Boundary

GitHub: [#2](https://github.com/WhiteKiwi/agentprof/issues/2)

- [ ] 런타임·SQLite driver·package manager·의존성을 고정하고 빌드·도움말·CI를 구성한다.
  **Verify:** macOS arm64·Linux의 Node 24.15.0과 현재 지원 24 버전에서 SQLite import·parameter binding·transaction rollback·migration·close-reopen, clean install·빌드·help/version을 실행한다. 미지원 구형 Node에서 명확한 진단을 확인한다. 설치 스크립트·native addon 요구사항을 기록한다.
  **Evidence:** 2026-09-30 부모가 macOS arm64의 Node 24.15.0·24.21.0·26.7.0에서 각각 `npm ci --ignore-scripts --no-audit --no-fund`와 `npm run check`를 통과했다. 5개 파일·60개 테스트와 14파일 tarball의 npm exec·격리 전역 설치를 확인했다. Node 22.16.0은 import 전 `UNSUPPORTED_RUNTIME`·exit 2다. Linux CI 확인은 남아 있다. 의존성·설치 경계는 [IMPLEMENTATION.md](IMPLEMENTATION.md)에 기록했다.
- [x] 로컬 데이터 경로·입력 override·권한·허용 필드·원문 없는 진단을 구현한다.
  **Verify:** 입력 파일 hash가 바뀌지 않는다. secret sentinel이 정규화 결과·진단에 남지 않는다. empty input, 큰 줄과 root 밖 symlink에서 정해진 동작을 확인한다. commandPattern·operationKey·lookup/content/error fingerprint의 허용 필드·null·정규화/키 버전 계약을 확인한다.
  **Evidence:** 위 3개 macOS 런타임에서 합성 sentinel·입력 hash·1 MiB 경계·BOM/CRLF·partial UTF-8/JSON·append/truncate·symlink·ambiguous provider root·동시 key 초기화·명령 인자/시간 근거 충돌·DB migration/rollback/reopen 검증을 통과했다. [NORMALIZATION.md](NORMALIZATION.md)의 allowlist와 key/normalization version 1을 구현했다. 파서·이벤트 저장·분석·HTML의 전체 개인정보 acceptance는 NOT RUN이다.

## P2 — Codex Adapter

GitHub: [#3](https://github.com/WhiteKiwi/agentprof/issues/3)

- [ ] 현재 구조화된 완료 항목과 구형 호출·결과 fallback을 구현한다.
  **Verify:** item scope·namespace·content-block output·직접 duration·paired timestamp의 fixture 기대값이 맞는다. wrapper와 내부 항목을 이중 집계하지 않는다. 원문 폐기 전 안전한 패턴·operation/lookup/content/error fingerprint가 생성되고 대상·플래그·범위 차이와 secret sentinel이 보존/제거 계약에 맞는다. P0 실로그 수작업 표본과 로컬 대조해 공급자·버전별 의미·coverage 행렬을 갱신한다. 미실행은 NOT RUN이다.
- [ ] pending·취소·process polling·fork·archive·token source 중복을 처리한다.
  **Verify:** 나중 결과 갱신, 누적 polling 시간 제외, 복사된 이력과 실제 새 실행 분리, unsupported record 진단을 확인한다.

## P3 — Claude Code Adapter

GitHub: [#4](https://github.com/WhiteKiwi/agentprof/issues/4)

- [ ] UUID·parent·call/result·agent·sidechain 연결과 source roots를 구현한다.
  **Verify:** 동시 호출·중복 메시지·누락 결과에서 ID와 호출 수가 맞는다. `CLAUDE_CONFIG_DIR`로 지정한 임시 root를 읽는다. 원문 폐기 전 안전한 패턴·operation/lookup/content/error fingerprint가 생성되고 대상·플래그·범위 차이와 secret sentinel이 보존/제거 계약에 맞는다. P0 실로그 수작업 표본과 로컬 대조해 공급자·버전별 의미·coverage 행렬을 갱신한다. 미실행은 NOT RUN이다.
- [ ] 직접 duration·관측 구간·turn duration과 usage 의미를 구분한다.
  **Verify:** timing 누락이 0이나 측정값으로 바뀌지 않는다. background result·다른 duration scope·cache 사용량 fixture가 기대 classification을 낸다.

## P4 — SQLite and Incremental Scan

GitHub: [#5](https://github.com/WhiteKiwi/agentprof/issues/5)

- [ ] 이벤트·진단·pending 상태와 완전한 줄 checkpoint를 원자적으로 저장한다.
  **Verify:** 2회 같은 스캔, append·잘린 UTF-8·partial JSON·중단 후 재시작에서 DB 의미 결과가 같다. checkpoint만 앞서 나가지 않는다. P2/P3의 identity·evidence·정규화/키 버전이 DB round-trip 후 동일하며 원문이 없다.
- [ ] 교체·truncate·archive 이동·삭제·parser version 변경을 처리한다.
  **Verify:** 소스 기여분의 원자적 교체, 이동 중복 방지, 접근 불가 이력 보존과 미지원 압축 진단을 확인한다.

## P5 — Metrics, Diagnostics and CLI Results

GitHub: [#6](https://github.com/WhiteKiwi/agentprof/issues/6)

- [ ] 저장된 정규화 identity·패턴을 소비해 시간·실패·재시도의 최소 CLI/HTML 세로 단면을 먼저 연결한다.
  **Verify:** scan → DB → stats/insights → 최소 report가 두 공급자에서 동일 snapshot 값을 표시한다. 원문 재복원 없이 다른 대상·플래그를 구별하고 `rg` exit 1·compound command의 상태 의미를 유지한다. unknown/coverage·근거 이동·외부 요청 0건·secret 부재를 확인한 뒤 전체 지표와 상세 화면으로 확장한다.
- [ ] 10개 MVP 지표와 evidence·coverage·표본 수를 구현한다.
  **Verify:** METRICS 각 `Verify`와 ACCEPTANCE 행렬의 수작업 기대값이 맞는다. unknown·unresolved·unattributed를 보존한다.
- [ ] 6개 진단, Detected Waste 합집합과 `stats`·`insights` 출력을 구현한다.
  **Verify:** 규칙 ID·version·근거·임계값·추천을 확인한다. retry 12초·repeated error 8초·overlap 5초의 총계가 15초다. coarse heuristic·slow-tool 단독은 고신뢰 시간 총계에 들어가지 않는다. 6개 규칙별 양성·정상 음성 및 첫 실패/반복 lookup 포함 사례를 통과한다. 로컬 표본의 오탐·판정 불가·제안 적용 가능 여부와 rule version을 기록하고 보정한다. precision/개선률을 근거 없이 기입하지 않는다.

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
  **Verify:** 두 공급자의 수작업 표본과 수치가 맞는다. clean install → scan → stats → insights → report를 macOS arm64·Linux에서 확인한다. P0 자원 예산 대비 시간·메모리·HTML 크기의 측정 조건과 실패를 ACCEPTANCE에 기록한다. 공급자/버전·지표 지원 행렬과 진단별 오탐·제안 품질을 갱신하고 수동 matched before/after 절차의 조건·표본·효과 없음/비교 불가도 남긴다. 자동 비교 UI는 구현하지 않는다.

Homebrew·Rust·추가 비교 기능은 [BACKLOG.md](BACKLOG.md)에 있다. active TODO로 옮기기 전에 사양·연구·구현 계획을 갱신한다.
