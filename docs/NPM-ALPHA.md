# Early npm Alpha

2026-10-01 KST. 사용자가 제품 구현이 끝나기 전에 `agentprof` npm 공개를 요청했다. 이름 예약만을 위한 빈 패키지는 [npm 정책](https://docs.npmjs.com/policies/disputes/)에서 금지하므로, 이미 구현·검증된 기능을 사용할 수 있는 개발 알파를 공개한다. 전체 P7 출시·제품 acceptance와 구분한다.

## Published scope

첫 알파의 코드 기준은 main `baa384f779d5eab6d31a6c7099372f19a1d98496`이다. 해당 revision의 bounded Codex adapter, JSONL reader, 개인정보 정규화·HMAC identity API와 CLI help/version을 제공한다. [CODEX-PARSER](CODEX-PARSER.md)·[CODEX-EVIDENCE](CODEX-EVIDENCE.md)의 검증 범위와 한계를 그대로 적용한다. Claude P3는 이 최초 알파의 코드에 포함하지 않는다.

CLI `scan`, `stats`, `insights`, `report`, `open`은 `NOT_IMPLEMENTED`·exit 2다. 사용자는 Node.js >=24.15.0의 macOS/Linux에서 parser/reader 개발 API를 직접 import할 수 있다. 이 알파는 단일 HTML 리포트 제품 출시가 아니다.

| Field | Selected value |
| --- | --- |
| npm name | `agentprof` |
| Version | `0.1.0-dev.0` |
| Dist tags | `alpha`와 `latest`가 모두 `0.1.0-dev.0`을 가리킴. 권장 명령은 `agentprof@alpha` |
| CLI smoke command | `npx agentprof@alpha --help` / `--version` |
| API paths | `agentprof/dist/parsers/codex/index.js`, `agentprof/dist/scanner/jsonl.js`, `agentprof/dist/normalize/identity.js` |
| License | 기존 `UNLICENSED` 유지. OSS license 결정은 별도 |
| Publish account | 로그인 결과로 확인한 `whitekiwi` |
| Package files | compiled `dist/`, package metadata, 알파용 README |

초기 API subpath는 개발용이며 안정된 public facade·TypeScript declaration 제공은 후속 배포 계약에서 정한다. raw user logs·fixture·TS source·DB·secret·개인 경로를 registry에 올리지 않는다.

## Reproducible packaging plan

P3 작업 트리의 package·README·design 자산은 바꾸지 않는다. 위 main revision을 별도 private 임시 경로에 archive하고 clean install/build한다. 그 임시 manifest에서만 `private`를 제거하고 repository/homepage metadata를 보완한다. version·runtime·production dependency·source code는 해당 revision과 같다. 알파 README는 실제 제공 기능·API 예제·미구현 CLI 동작을 설명하며 현재 제품 로드맵에 링크한다.

1. 고정 main source와 알파 metadata/README를 준비한다.
   **Verify:** source revision·코드 checksum·실제 npm 사용자·현재 name lookup을 확인한다. 로그와 인증 값은 출력·기록하지 않는다.
2. 정확한 tarball을 설치해 실제 parser/reader API와 CLI를 검증한다.
   **Verify:** scripts 없는 격리 설치에서 합성 JSONL oracle의 canonical count·timing·usage를 대조한다. 지원 Node에서 help/version, `NOT_IMPLEMENTED`·exit 2, archive file allowlist를 확인한다. `npm publish --dry-run --tag alpha`의 metadata·파일·integrity를 검토한다.
3. 검토한 tarball 한 개를 npm에 공개하고 원격 결과를 확인한다.
   **Verify:** version/tag/owner/tarball integrity가 일치한다. registry에서 새 cache로 `npx agentprof@alpha --help`·`--version`과 SDK 예제를 실행한다. 반환 결과가 불확실하면 원격 상태부터 확인하며 같은 version을 무조건 재게시하지 않는다.

[npm 2FA 요구](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)를 따른다. 이번 인증은 owner가 허용한 c6s derived-code read로 수행하며 seed·OTP·token은 repository·evidence·memory에 기록하지 않는다. 계정 policy를 바꾸거나 approval을 대신 승인하지 않는다.

## Evidence

준비 시 registry `agentprof` 조회는 E404였고, c6s를 사용한 웹 재인증 후 `npm whoami`는 `whitekiwi`였다. 검토한 tarball을 `--tag alpha`로 한 번 게시했고 exit 0을 확인했다. registry readback의 version·owner·source revision·integrity·shasum은 검토한 artifact와 일치한다.

게시 명령은 `latest`를 지정하지 않았지만 실제 registry에는 `alpha`와 `latest`가 함께 있었다. `npm dist-tag rm agentprof latest`는 HTTP 400으로 실패했고 재시도하지 않았다. 원인을 확정하지 않으며 현재 두 태그가 같은 개발 prerelease를 가리키는 상태를 기록한다. 안정 버전 출시로 표시하지 않고 문서·검증 명령에는 `agentprof@alpha`를 사용한다.

| 확인 대상 | 실제 결과 |
| --- | --- |
| 공개 요청 | 2026-10-01 10:52:32 KST, 검토한 tarball 한 개 게시·exit 0 |
| Registry | [agentprof](https://www.npmjs.com/package/agentprof), version `0.1.0-dev.0`, maintainer `whitekiwi`, source revision 일치 |
| Artifact | 20파일, compressed 28,351bytes / unpacked 120,942bytes, allowlist PASS |
| Integrity | `sha512-8C2R7s4TEX2SacpLjbTLx8AcPdALcCf0FXd817Cq8HUE4T5UjBCMV98q7jKymqeDI+te0Y9fw5K2nR8wi2Le3w==` |
| SHA-1 shasum | `599a4829b7cd3566c9100772aa6af27ab2f3922d` |
| Exact-tarball local install / dry-run | PASS: Node 24.15.0·26.7.0, npm 11.19.0, scripts 비활성화, reviewed integrity·file list 동일 |
| Fresh public-registry install / SDK | PASS: 위 두 Node에서 기존 합성 oracle의 execution2/turn1/usage2·timing·token mapping·exact replay와 README API 예제 대조 |
| Fresh-cache npm exec / npx 경로 | PASS: 위 두 Node에서 `agentprof@alpha --help`·`--version`; `scan --json`은 `NOT_IMPLEMENTED`·exit 2 |
| 원격 실행 시각 | 2026-10-01 11:06:15–11:06:18 KST. 빈 작업 디렉터리·새 cache 사용, registry integrity 일치 |

원본 main source 20파일의 checksum은 변경하지 않았다. primary package/lock/README/design/CLI와 기존 P0 fixture도 보존했다. 로컬 검증 스크립트의 JSON 응답 shape·OS temporary-path alias 처리 오류를 고친 뒤 실제 결과를 대조했으며 제품 코드를 그 오류에 맞춰 바꾸지 않았다. 공개 Linux registry 설치·안정 public API/DTS·단일 HTML 제품·전체 P7 acceptance는 **NOT RUN**이다.

[IMPLEMENTATION](IMPLEMENTATION.md) · [ACCEPTANCE](ACCEPTANCE.md) · [Project](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833029).
