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
| A16 | 실제 데이터의 지원 범위와 자원 사용 | 원본은 로컬 유지, 작은 수작업 표본 대조, 조건을 밝힌 시간·메모리 측정 | NOT RUN |
| A17 | 한 번의 생성·열기와 headless 결과 보존 | 별도 scan 없이 `report --open`, 새 데이터 반영, opener 없으면 HTML·경로 보존 | NOT RUN |

## Planning Evidence

두 source 문서를 읽고 최근 로컬 로그의 필드 구조를 조사했다. 이는 구현 acceptance 통과가 아니다. 현재 확인한 사실과 한계는 [FINDINGS.md](FINDINGS.md)에 있다.
