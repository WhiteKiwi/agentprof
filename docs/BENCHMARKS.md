# AgentProf Resource Measurement Protocol

## 상태와 목적

2026-09-30, P0 사전 조건 `resource-v1`. 아래 값은 측정 전에 정한 **초기 제품 예산**이며 확인한 성능이나 외부 표준이 아니다. scanner·DB·report·성능 측정은 **NOT RUN**이다. 기능 정확성·개인정보 gate가 먼저 통과해야 하며 빠르지만 데이터가 틀린 결과는 fail이다.

계획은 [IMPLEMENTATION](IMPLEMENTATION.md), 입력 경계는 [NORMALIZATION](NORMALIZATION.md), 실제 실행 결과는 [ACCEPTANCE](ACCEPTANCE.md)에 유지한다. 데이터를 보고 유리하게 한도를 바꾸지 않는다. 변경이 필요하면 실패값·조건·이유와 protocol revision을 먼저 남긴다.

## 결정한 reader 제한

- chunk는 64 KiB다. 최대 JSONL **줄의 raw bytes**는 끝의 LF(`0x0a`)만 제외하고 1 MiB다. CRLF의 CR과 BOM bytes는 한도에 포함한다. UTF-8 code point 수나 JSON 파싱 후 길이와 다르다. checkpoint offset은 LF·CR·BOM을 모두 포함한 원본 byte offset이다.
- 1 MiB를 넘으면 그 줄의 payload를 저장하거나 전체 메모리에 쌓지 않고 delimiter까지 소비해 원문 없는 oversized-line 진단을 남긴다. 뒤의 정상 줄은 처리한다. 마지막 미완성 줄은 checkpoint를 앞으로 이동시키지 않는다.
- 기본 root 밖으로 향하는 symlink는 건너뛰고 안전한 진단을 남긴다. 테스트 root는 합성 임시 root를 사용한다.
- line limit은 리포트 크기나 source 전체 파일 크기의 한도가 아니다. 이 제한은 계획 선택이며 큰 정상 로그에서 손실이 생길 수 있음을 coverage에 표시한다.

## 합성 workload

어느 provider의 실제 원문도 복사하지 않는다. fixture generator는 version·seed와 정확한 파일/완전 줄/bytes/canonical events를 manifest로 기록한다. 아래 byte 값은 목표 조건이며 실제 생성값을 함께 기록한다. 출력 개인정보 sentinel은 배포 tarball에 넣지 않는다.

| ID | 규모·분포 | 검증할 동작 |
| --- | --- | --- |
| W-small | 20 files, 10,000 JSONL records, 약 20 MiB, 최대 일반 줄 256 KiB; 두 provider 각각 절반 | 첫 설치의 full scan·stats·insights·report, partial coverage, CLI/HTML 일치 |
| W-large | 200 files, 1,000,000 records, 약 1 GiB; 짧은 도구 record와 256 KiB 긴 줄 혼합; 10% pending/unknown, 5% 중복 표현 | 스트리밍 bounded memory, wrapper/dedup, 기간 집계와 report |
| W-append | W-large의 20 files에 총 10,000 records·약 10 MiB append; 나머지 180 files는 변경 없음 | 증분 checkpoint가 새 줄만 처리하고 full 결과와 동일 |
| W-no-change | W-large에 변경 없음 | no-change 재스캔의 중복 없음·재처리 bytes·시간 |
| W-boundary | 작은 입력에 1 MiB-1, 정확히 1 MiB, 1 MiB+1 bytes 줄; 각 앞뒤 정상 줄, UTF-8/CRLF·미완성 tail | 최대 줄 경계, 초과 진단, 정상 줄 복구·checkpoint |
| W-report | 정규화 100,000 events·1,000 session aliases·6 rule evidence, unknown과 낮은 coverage 포함 | 한 HTML의 timeline 근거·집계 일치·크기와 UI 응답 |

W-large의 1 GiB 파일을 리포트에 그대로 넣지 않는다. snapshot은 원문 없이 집계·선택 가능한 안전한 근거만 담으며, 큰 상세 데이터는 표시 범위를 설명한다. 핵심 데이터 누락을 단순히 숨겨 성능을 통과시키지 않는다.

## 장비와 실행 조건

기준 장비 class는 macOS arm64 **4개 이상 CPU core·16 GiB RAM·로컬 SSD**와 Linux x64 **4 vCPU·16 GiB RAM·로컬 SSD**다. macOS 기준 장비는 이 로컬 `Mac16,10`, Apple M4, physical/logical CPU 각 10개, RAM 17,179,869,184 bytes(16 GiB), Darwin arm64로 선택했다. 이는 부모가 읽은 hardware 필드이며 성능 측정은 아니다. 정확한 OS·파일시스템·스토리지·여유 공간·부하는 실제 실행 때 기록한다. Linux의 조건을 만족하는 실제 runner는 **미배정**, 측정은 NOT RUN이다. 작은 장비로 실행하면 다른 조건의 관측으로 남기며 기준 통과라고 하지 않는다.

Node `24.15.0`과 당시 지원하는 현재 24 patch, 정확한 npm/SQLite driver version, commit, build mode와 timezone을 기록한다. 초기 설치 전 네트워크 패키지 획득 시간은 분석 처리 시간과 분리한다. actual user-log pilot의 규모·coverage와 합성 workload를 별도 결과로 보고한다.

- **cold application run:** 새 DB·새 cache directory·새 CLI process. OS page cache를 지웠다고 가정하지 않으며 강제 cache drop은 하지 않는다. cold application과 cold disk를 혼동하지 않는다.
- **warm run:** 한 번 선행 실행 후 같은 process 시작 조건과 동일 input을 사용한다. fresh DB full run, 기존 DB no-change, append run을 혼합하지 않는다.
- 각 조건은 1회 준비 실행 뒤 3회 측정하고 median·min/max와 모든 실패를 보존한다. 3회만으로 tail p95를 주장하지 않는다.
- full과 incremental은 discovery → parsing → normalization → transaction 완료까지의 wall time, report는 snapshot query → HTML 저장까지의 wall time이다. 브라우저 opener와 사람 탐색 시간은 별도다.
- peak RSS는 CLI와 자식 process를 구분해서 기록한다. Node heap만 RSS로 대신하지 않는다. 플랫폼별 RSS 단위를 bytes로 정규화한다. report HTML bytes는 실제 파일 byte size다.

## 사전 예산과 pass/fail

| Workload / 측정 | 초기 한도 | 판정 |
| --- | ---: | --- |
| W-small full scan | median ≤5 s | 3회 모두 정확한 event/checkpoint, median과 max 기록 |
| W-large full scan | median ≤60 s | fresh DB 조건. 원문 전체를 메모리에 올리지 않음 |
| W-append incremental | median ≤5 s | 새 약 10 MiB만 파싱, 결과가 독립 full 재구축과 동일 |
| W-no-change scan | median ≤2 s | event 증가 0, 정상 source의 재파싱 bytes 0 |
| W-small / W-large scan peak RSS | ≤512 MiB | 각 측정 run 모두 충족. helper 포함 범위 기록 |
| W-report HTML 생성 | median ≤10 s | CLI snapshot과 계산값·coverage 동일 |
| W-report 생성 peak RSS | ≤512 MiB | report 생성 process, 브라우저 RSS 별도 |
| W-report HTML 파일 | ≤25 MiB | CSS·JS·SVG·데이터 모두 포함, 외부 요청 0 |
| W-boundary oversized 입력 | payload buffering ≤1 MiB + 64 KiB chunk + parser overhead | 초과 payload 저장/출력 0, 다음 정상 줄 처리. overhead 실제 측정 |

예산 초과는 원인·범위와 실제값을 기록하고 최적화 후 같은 조건으로 재실행한다. 플랫폼/Node/workload 미실행은 NOT RUN이다. 초기 예상 예산을 만족했다는 이유만으로 1 GiB 이상의 모든 사용자 데이터나 모든 hardware를 보증하지 않는다. Rust 전환은 이 결과를 보고 별도 결정한다.

브라우저 첫 렌더·근거 이동은 Playwright로 동작·네트워크·실제 대기 시간을 기록하되 아직 별도 수치 예산은 **TBD**다. 이 TBD는 scanner의 사전 예산이나 HTML 정확성 gate를 대체하지 않는다. 작은 화면·키보드·empty/unknown 상태는 성능과 별도로 acceptance에서 확인한다.
