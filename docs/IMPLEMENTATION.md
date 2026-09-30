# AgentProf v0.1 Implementation Plan

## Status and Authority

Draft, 2026-09-30. [SPEC.md](SPEC.md)의 사용자 동작, [ARCHITECTURE.md](ARCHITECTURE.md)의 불변 조건, [METRICS.md](METRICS.md)의 계산 계약을 구현하는 계획이다. 코드 구현은 아직 시작하지 않았다. [FINDINGS.md](FINDINGS.md)는 조사 근거이며 사양을 덮어쓰지 않는다.

새 지표 제안을 반영해 v0.1에 10개 지표와 6개 자동 진단을 포함했다. 이 계획을 검토한 뒤 개발 서브세션이 구현한다. 제품 범위를 바꾸면 SPEC, 구조·불변 조건은 ARCHITECTURE, 계산 의미는 METRICS, 접근·순서는 이 문서와 TODO를 먼저 갱신한다.

## Selected Approach

**TypeScript CLI + npm 배포 + 단일 오프라인 HTML**을 초기 경로로 삼는다. JSONL·지표·UI 개발을 같은 언어로 연결하고 `npx` 시험 사용과 전역 설치를 함께 제공한다.

설치 편의와 언어 선택은 분리한다. Homebrew도 Node CLI를 설치할 수 있다. Rust는 단일 실행 파일·시작 비용·대규모 처리에서 장점이 있지만, 현재 실측된 병목은 없다. 먼저 스트리밍·증분 수집과 정확한 데이터 계약을 만든 뒤 전환 필요를 판단한다.

| 영역 | 초기 선택 | 결정 근거·검증 |
| --- | --- | --- |
| 런타임 | Node.js >=24.15.0, TypeScript | 내장 SQLite로 별도 addon 설치 제거. 최소 patch와 지원 중인 런타임 조합 검증 |
| 저장 | `node:sqlite`, SQL migrations | 단일 사용자 SQLite. API는 Release candidate이며 Stable로 주장하지 않음 |
| CLI | Commander | `scan`, `stats`, `insights`, `report`, `open`, help·version·JSON output |
| 리포트 | React·Vite·SVG | 상세 화면·타임라인과 single HTML bundle |
| 검증 | Vitest·Playwright | 합성 기대값·DB 복구·offline 렌더링 |
| 패키지 관리 | npm + committed lockfile | 배포와 같은 생태계로 유지. 실행은 빌드된 JS이며 TS runtime을 요구하지 않음 |

P1에서 `node:sqlite`의 준비된 statement·transaction·migration·close 동작과 최소 런타임 설치를 검증한다. 필요한 동작이 불안정하면 코드 구현 전에 이 문서를 갱신하고 `better-sqlite3` v13을 검토한다. v13의 N-API·npm 내 prebuilt 개선을 구버전 다운로드 방식과 구분한다.

## Structure and Boundaries

```text
src/
  cli/         argument validation and human/JSON rendering
  scanner/     read-only discovery, bounded JSONL streaming, checkpoints
  parsers/     codex and claude adapters, pairing and capabilities
  normalize/   allowlist, safe patterns, operation and lookup identities
  db/          migrations and atomic source contributions
  analyzer/    shared metrics, diagnostic rules, overlap accounting
  report/      safe single-file packaging and opener
web/           offline report components and SVG timeline
tests/fixtures/ synthetic provider records and expected metrics
docs/          specification, evidence, plans and acceptance
```

정규화 데이터부터 개인정보 경계를 적용한다. raw 객체를 downstream metadata로 전달하지 않는다. 입력 경로는 로컬 수집 manifest에만 사용하며 공유 리포트에는 자동 노출하지 않는다. CLI와 HTML은 같은 집계 모델을 사용한다.

분석 snapshot과 정적 HTML renderer를 분리해 후속 로컬 대시보드의 확장 지점을 유지한다. 초기 구현에는 서버·watcher·polling을 추가하지 않는다. 도롱뇽 마스코트와 제공 PNG 참고는 [DESIGN.md](DESIGN.md)를 따른다.

## Change Order

| ID | 결과물 | 선행 조건 | 마일스톤 | 초기 추정 |
| --- | --- | --- | --- | --- |
| [P0](https://github.com/WhiteKiwi/agentprof/issues/1) | 로그·지표 계약, 합성 fixture·기대값 | 없음 | v0.1-alpha | 1–2 작업일 |
| [P1](https://github.com/WhiteKiwi/agentprof/issues/2) | CLI 기반, 타입·개인정보·설치 검증 | P0 | v0.1-alpha | 1–2 작업일 |
| [P2](https://github.com/WhiteKiwi/agentprof/issues/3) | Codex adapter | P0, P1 | v0.1-alpha | 1–2 작업일 |
| [P3](https://github.com/WhiteKiwi/agentprof/issues/4) | Claude adapter | P0, P1 | v0.1-alpha | 1–2 작업일 |
| [P4](https://github.com/WhiteKiwi/agentprof/issues/5) | SQLite·증분 scan | P1, P2, P3 | v0.1-alpha | 1–2 작업일 |
| [P5](https://github.com/WhiteKiwi/agentprof/issues/6) | 10 지표·6 진단·stats·insights | P0, P2, P3, P4 | v0.1-alpha | 3–5 작업일 |
| [P6](https://github.com/WhiteKiwi/agentprof/issues/7) | single HTML·타임라인·open | P5 | v0.1 | 2–4 작업일 |
| [P7](https://github.com/WhiteKiwi/agentprof/issues/8) | packed artifact·파일럿·출시 준비 | P6 | v0.1 | 1–2 작업일 |

한 명의 순차 작업 기준 11–21 작업일의 초기 추정이다. 출시일 약속이 아니며 P0에서 지원 버전·시간 의미를 확정한 뒤 다시 산정한다. TODO의 각 단계에 구체적인 Verify를 둔다.

### P0 — Contracts Before Parsers

Codex 구조화 완료 항목과 response 표현, Claude call/result·메시지 재저장·sidechain을 합성 fixture로 만든다. 현재 조사 버전은 관측 목록이며 제품 지원 목록이 아니다. 시간 의미·ID 우선순위·capability를 버전별로 검증한다.

순차·병렬·wrapper·fork·pending·polling·unknown, unresolved recovery, 대상이 다른 명령, 내용이 바뀐 읽기, 토큰 누적과 cache, 기간 경계의 손계산 기대값을 고정한다. 같은 작업 판정에 표시용 commandPattern을 쓰지 않는다.

### P1 — Installation and Privacy Foundations

패키지의 단일 `bin`은 `agentprof`를 가리키고 shebang·실행 권한·빌드된 JS·HTML assets만 배포한다. minimum Node와 지원 플랫폼을 검사하고, 도움말과 명확한 runtime 오류를 제공한다. npx에서 source compile·agent runtime 설치·SQLite addon 다운로드가 필요하지 않게 한다.

로컬 데이터 경로, config·key 권한, source overrides, JSON envelope와 비밀값 없는 진단을 구현한다. 공급자 어댑터에는 원문을 읽을 권한만 주고 정규화 경계 밖으로 전달하지 않는다.

### P2 / P3 — Provider Adapters

Codex는 검증된 구조화 `item_completed`를 우선하고 같은 response를 중복 세지 않는다. namespace·call ID·content-block output과 직접 duration을 처리한다. Claude는 UUID·parent·tool IDs를 연결하고 직접 duration과 관측 latency를 구분한다.

pending 갱신, 취소·background·polling, 복사된 과거와 실제 새 실행, schema drift를 명시적으로 다룬다. 관계·scope가 불명확하면 capability와 coverage를 낮추고 raw 내용 없는 진단을 제공한다.

### P4 — Transactional Incremental Scan

완전한 줄의 byte offset과 경계 digest를 저장한다. 이벤트·pending 갱신·checkpoint를 같은 transaction에 commit한다. append의 잘린 끝줄은 미루고 교체·truncate·parser version 변경 시 소스 기여분을 원자적으로 교체한다.

file move·archive·duplicate discovery에서 논리 ID를 유지한다. 읽을 수 없거나 미지원인 파일을 조용히 건너뛰지 않는다. 대형 줄·전체 파일 buffering을 제한한다.

### P5 — Metrics and Actionable Diagnostics

operation·lookup identity, duration scope·evidence·coverage를 바탕으로 METRICS의 10개 지표를 계산한다. 직접 값과 paired·estimated를 섞은 분포를 만들지 않는다. 실패 code·unknown status와 missing timing을 보존한다.

6개 진단은 버전 있는 rule과 검증 가능한 임계값으로 구현한다. coarse heuristic과 고신뢰 구간을 구분한다. Detected Waste는 충분한 evidence를 가진 구간의 합집합이며 회복 경과 시간이나 여러 규칙 내역을 더한 값이 아니다.

빈 입력·partial coverage를 포함해 CLI human·JSON 출력과 HTML 공통 분석 결과를 만든다. supported fixture에서는 실제 계산값이 나와야 하며, 모든 복잡한 지표를 unknown으로 처리해 완료로 간주하지 않는다.

### P6 — Offline Evidence Navigation

첫 화면에 Time Breakdown·Detected Waste·Top Insights, 상세에 7개 화면과 timeline을 구현한다. 각 진단에서 근거 이벤트로 이동한다. 표본 수·시간 의미·분모·지원 한계를 표시한다.

`report`는 증분 스캔 → snapshot 집계 → HTML 생성으로 동작하고 `--open`이 있으면 생성된 파일을 연다. 새 설치에서 별도 scan 없이 한 번의 명령으로 생성·열기를 수행할 수 있어야 한다. opener가 없는 headless 환경에서는 HTML을 남기고 경로를 안내한다.

Vite 출력·SVG·분석 데이터를 HTML에 inline하고 dynamic fetch·CDN·remote font를 사용하지 않는다. script 종료 문자열·HTML·control character를 안전하게 처리한다. opener는 argument 배열로 파일 경로를 전달한다.

### P7 — Reproducible Installation and Local Pilot

npm 이름·scope 권한·license를 확정하고 `npm pack` 결과를 isolated cache·prefix에서 실행한다. 공개 npm 이름이 미확정이면 tarball 기반 npm exec를 먼저 검증한다. 공개 후 actual npx 경로도 검증한다.

macOS arm64·Linux에서 clean install → scan → stats → insights → report를 검증한다. 실제 원문은 로컬에서만 시험하고 공유된 evidence에는 정규화 결과와 측정 조건만 기록한다. 실제 시간·메모리·HTML 크기를 측정하고 합성 성능 조건과 구분한다.

Homebrew tap·formula 게시, npm 공개와 license 선택은 이 계획의 구현 artifact 준비와 별개인 게시 단계다. 현재 저장소 초기화 요청은 패키지 공개를 의미하지 않는다.

## Verification and Handoff

[TODO.md](TODO.md)의 모든 구현 체크에는 Verify가 있다. [ACCEPTANCE.md](ACCEPTANCE.md)는 실행 전 NOT RUN이고, 실행 후 revision·환경·명령·기대값·실제 결과를 기록한다. fixture·개인정보·DB 복구·지표 일치·offline UI·설치 시험을 변경 범위에 맞게 수행한다.

개발 서브세션에는 완료된 SPEC·FINDINGS·ARCHITECTURE·METRICS·IMPLEMENTATION·TODO와 첫 단계 P0를 전달한다. 구현 결정 변경은 해당 문서부터 반영하고 parent에 변경·검증·한계를 보고한다. parent는 계획·변경·검증 증거를 검토하고 저장소 수준 게시를 맡는다.
