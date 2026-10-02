# P6 standalone explicit local report opening — plan proposal

Status: revised v1 after coordinator review, for independent review, 2026-10-02. No production GO, Project claim write, feature test execution or browser success is asserted.
Base supplied and inspected: main 063ee04b37e97616065254c9534f430bdc33e3c3, tree ce44659dfa117c2009e9541c07af6fb9a6796fd3, 209 baseline files. All repository files remain unchanged during this planning pass.

## Observable specification

`agentprof open <file>` accepts exactly one explicitly named existing local HTML file. Only `.html` and `.htm` extensions, ASCII case-insensitive, are supported. It requests the operating system's default application to open that file. It never scans logs, generates or changes a report, opens a database/key, reads HTML contents, searches for a latest report, hosts a server, changes preferences, or adds dependencies. `report --open` stays rejected. Existing macOS/Linux support is unchanged; Windows is not introduced.

Input is a filesystem pathname, never a URL: reject leading URI schemes matching `[A-Za-z][A-Za-z0-9+.-]*:`, `//` network forms, and Windows UNC/drive syntax. Do not decode percent escapes, expand tilde/environment variables, or trim an accepted filename. Preserve spaces, non-ASCII characters, shell metacharacters, percent, hash and question-mark filename characters exactly. Leading dash filenames require `--` or `./`; the helper always receives an absolute pathname so it cannot interpret a filename as an option or URI scheme.

Reject empty/whitespace-only input, more than4096 UTF-8 bytes before or after absolute resolution, C0/C1 controls, and unpaired UTF-16 surrogates before filesystem or process I/O. Invalid command flags and extra positionals are rejected. Harmless inherited --data-dir/--codex-root/--claude-root options retain normal global parsing/validation, but have no effect on open: no scan, data-directory resolution, creation or store/key reads. This preserves existing CLI global semantics without implying those operations occur. --json, --help and --version retain ordinary CLI behavior; help/version do no file/process/store I/O. Unknown options and parse errors retain the existing raw-free INVALID_ARGUMENT envelope. No application or executable selection flag is added.

A supported target must resolve through realpath to an existing readable regular .html/.htm file. Symlinked report directories/files and ordinary macOS /var-to-/private/var aliases are allowed; pass only the canonical absolute pathname to the opener. Apply pathname byte/control validation to the canonical result too. Stat the canonical target first and reject nonregular files before opening. Open it read-only/nonblocking, fstat to confirm regular-file status, and close without reading contents. Reject missing/dangling links, directories and other nonregular or unreadable targets. Do not chmod, create, copy or rewrite files. This is a convenience opener for explicitly trusted local files, not an adversarial pathname-race sandbox or remote-mount detector; concurrent replacement after validation cannot be ruled out. Both requested and canonical suffix must be HTML, ensuring the default handler receives an HTML-named file. Canonicalizing a leaf symlink may change relative-resource resolution compared with opening its alias; this is documented behavior, not a preservation guarantee.

Use async child_process.spawn and fixed platform helper, argument array `[absolutePath]`, shell:false, stdio:'ignore'; no command string, shell quoting, shell fallback, browser override or retries. macOS helper is /usr/bin/open; Linux helper is xdg-open using the trusted process PATH. Linux with both DISPLAY and WAYLAND_DISPLAY absent/blank returns a fixed opener-unavailable error without spawn; macOS has no speculative DISPLAY check. Environment is inherited as trusted local configuration; this command is not an environment or default-application sandbox.

Wait for the helper's exit code, not merely its spawn event. Exactly one zero exit before the deadline yields accepted; signal/nonzero/error are failures. At5000ms without terminal success, settle a timeout and unref the helper. Clear the owned deadline and terminal listeners but retain an inert error handler until child termination to avoid late unhandled errors. Do not signal the helper or kill its process tree: xdg-open may itself be a foreground handler, and a timeout must not close a browser the user already sees. stdio ignore and unref keep the CLI bounded; no child termination is claimed. A timeout can occur after a browser was opened, especially with helpers that remain attached; it means acknowledgement was not received. A later exit/error must not change the settled outcome or trigger an unhandled error.

Success is `schema:agentprof.cli/v1, ok:true, command:open, result:{status:accepted, opener:open|xdg-open, browserVerified:false}` on stdout, exit0. Human output says only that the opener accepted the request and that browser rendering is not verified. Never claim the browser opened/rendered, or that arbitrary user HTML is safe/offline. Errors use one existing stderr safe-error envelope and exit2; stdout is empty. Fixed new diagnostics distinguish OPEN_FILE_UNSAFE, OPEN_FILE_UNAVAILABLE, OPEN_OPENER_UNAVAILABLE, OPEN_FAILED and OPEN_TIMEOUT. No requested/resolved path, file bytes, environment, exception text or child output appears in diagnostics or success. AgentProf does not create telemetry, but native opening may create OS recent-item/browser history; arbitrary selected HTML may execute scripts or contact remote resources. Only explicitly trusted local HTML should be opened. The user can open the same explicitly selected file manually; no copied path is required in this standalone command's error. Existing files are preserved on every outcome.

## Exact proposed ownership

Separate Project-only draft: “Open explicit local reports”. Coordinator01a0f1a1-4048-72ae-a185-e8a3f98ba008; planning contributor /root/plan_prof_safe_open; research contributor /root/plan_prof_safe_open/research_safe_opener. Future development identity must be registered before code. Proposed branch feat/explicit-local-open and isolated workspace agentprof-safe-open-implementation.

Effective planning scope is this out-of-repository proposal only; no active repository reservation yet. Proposed exact10-path maximum:
1. src/cli/main.ts (replace pending open registration only; reject excess args/irrelevant globals locally)
2. new src/cli/open.ts
3. src/privacy/diagnostics.ts (five fixed messages only)
4. new tests/cli-open.test.ts
5. new tests/cli-open-installed.test.ts
6. tests/cli.test.ts (only obsolete pending-open assertion becomes rejection-before-I/O assertion)
7. new docs/P6-SAFE-OPEN.md
8. docs/SPEC.md only EOF heading “Standalone explicit local report opening (bounded P6 slice)”
9. docs/IMPLEMENTATION.md only EOF heading “P6 safe standalone opener — reviewed slice”
10. docs/FINDINGS.md only EOF heading “2026-10-02 standalone opener evidence”

Root integrates unique EOF sections preserving every prior byte and other worker's additions. Report/model/render/styles/output writer, analyzer/parser/storage/scanner, dependencies, scripts/workflows/assets and numeric schema matrices in read-revisits/invocation-overlap tests are excluded. Preserve P6 Owner/session/In Progress and original acceptance gates. This narrow draft is not P6 completion.

## Implementation order and gates

1. Freeze this specification, independent research, exact tests and expected outcomes; root/independent reviewer resolve every remaining question. Verify claims/readback, no overlap, immutable precode test hashes and unsupported/deferred boundaries. No test is considered passed yet.
2. Save/reload a distinct Project draft and exact activation with actual developer identity, isolated full baseline and unique docs sections. Verify209 inherited files and modes, baseline revision, planning hashes and preserved Project fields before separate production GO.
3. Separate developer implements only the activated files. Verify filesystem validation before spawn, trusted-environment boundary, exact argument vectors, single settlement/resource cleanup and output privacy against independent tests; missing-feature RED differs from fixture error.
4. Root schedules focused/full/typecheck/build/artifact and installed/current parity; independent frozen all-file review. Verify Linux actual shim processes plus mocked macOS vectors; native GUI/browser checks separately NOT RUN unless actually executed. Preserve failed/skipped receipts. Root owns publication/exact-head CI; no merge/release/deploy permission follows from this proposal.

## Independent verification freeze v0 (all NOT RUN)

T01 Ordinary temporary local .html/.htm, uppercase extensions, absolute/relative, spaces/non-ASCII, leading dash via -- and ./, shell metacharacters, `%23`, `#`, `?`: exact one absolute argv, no shell and no accidental command execution; output path absent.
T02 Missing/extra positional, unknown option, report --open, malformed file values, 4096/4097byte multibyte boundary, controls/surrogates/URI/network syntax: INVALID_ARGUMENT, no fs/spawn/store.
T03 Missing/unreadable, directory/FIFO/socket/device, dangling symlinks, close failure and inaccessible ancestors: fixed code, no spawn, no mutation. Use permission-independent mocks for unreadable/close failure, real directory/FIFO and dangling-symlink fixtures; sockets/devices use nonregular stat mocks. Actual socket/device fixtures are deferred, not claimed passed. Existing leaf/ancestor symlinks, including canonical macOS temp aliases, succeed with exact canonical argv. Reject a canonical non-HTML target.
T04 Inject macOS/Linux platform plus spawn observer: exact command/vector/options, no executable/browser customization. Unsupported platform rejects. Linux headless fails before spawn; Wayland-only and X11-only permit it. Process environment values never emitted.
T05 Mock helper spawn then zero exit=>accepted; spawn-only never success; nonzero each1–5, signal, ENOENT, EACCES, thrown spawn and arbitrary private error=>fixed failures. Ignore enormous child output via stdio rather than collecting it.
T06 Fake-timer5000ms deadline, synchronous/asynchronous event edges, late exit/error and duplicate callbacks=>one result; clear timer/listeners; no unhandled rejection; hanging helper cannot hang CLI and kill() is never called. No detached browser/descendant lifetime claim.
T07 Built CLI with controlled Linux PATH fake xdg-open executable and synthetic HTML: persisted argument receipt proves exact bytes/count; shell metacharacter sentinel does not create unrelated file. Fake zero/nonzero/ENOENT/timeout helpers cover actual process integration. Native GUI not invoked.
T08 Harmless inherited data/root options before and after the command are accepted and inert. Missing and existing sentinel private data roots stay byte/mode/entry identical under valid/invalid/help/error paths; no SQLite import warning or fs access to store/key/log roots. HTML inode/bytes/mode/mtime unchanged. Test explicitly allowed target metadata reads only.
T09 JSON/human output schema, exact fixed errors, stdout/stderr/exit codes and path/child-message/environment sentinels. BrowserVerified:false always explicit in success; no “rendered” success claim. Help explains explicit HTML-only/macOS+Linux/local trusted files and rejected automatic behavior.
T10 Unchanged scan/stats/insights/report success and failure behavior, help/version parity except intended open help; old report --open rejection preserved; old open pending test bounded amendment only. Full check and packaged no-install-script artifact verifier unchanged.
T11 Installed/current open parity using same controlled opener and synthetic file; no graphical browser launch. Optional installed gate is explicit, and skipped is not pass. Native macOS helper acceptance and real browser rendering remain separate NOT RUN evidence unless explicitly executed.

## Questions for independent review

Coordinator accepted five-second acknowledgement deadline, errors-as-exit2, canonical symlink support and preservation of harmless inherited globals. Independent reviewer should confirm no-kill/unref lifecycle, fixed helper/trusted environment boundary, both requested/canonical HTML suffix rule and exact test freeze. Freeze executable tests after that review and saved/reloaded claim; no production implementation beforehand.

## Independent-review amendments and executable freeze v2

This section is authoritative where v0/v1 wording was underspecified. Separate review contributor: /root/review_prof_safe_open. Tests are authored in the local planning workspace only and remain NOT RUN, not production or baseline passes.

API fixed for independent tests: `runOpen(options: {file:string; dataDir?:string; codexRoot?:readonly string[]; claudeRoot?:readonly string[]}): Promise<OpenResult>` and `formatOpenResult(result,json):string` in new src/cli/open.ts. Global fields are ignored after the existing Commander validators have parsed them. The new command allows one operand only. Remove the now-unused pending helper in main.ts. Do not change shared global validators or their preexisting error behavior. Store/key reads must be instrumented separately from module loading; static CLI imports alone are not storage access.

Validation order:
1. CLI parsing/arity and existing global validation; requested operand lexical checks, including raw4096-byte limit and lexical absolute resolution with its own4096-byte/control checks. Fail INVALID_ARGUMENT before filesystem/process I/O.
2. Requested HTML suffix check: OPEN_FILE_UNSAFE. Existing platform support guard: UNSUPPORTED_PLATFORM.
3. realpath target; filesystem failure => OPEN_FILE_UNAVAILABLE. Canonical suffix/control/surrogate/4096-byte checks => OPEN_FILE_UNSAFE.
4. stat canonical target and reject nonregular before open. stat/open/fstat/close operational errors => OPEN_FILE_UNAVAILABLE. fstat nonregular => OPEN_FILE_UNSAFE. Always close a successfully acquired descriptor exactly once, even on fstat throw/nonregular. If close also fails, OPEN_FILE_UNAVAILABLE wins. No opener after any failure.
5. Linux headless test after valid file/descriptor close; missing desktop => OPEN_OPENER_UNAVAILABLE. No DISPLAY requirement on macOS.
6. Record monotonic start immediately before spawn; launch fixed command once. Synchronous/asynchronous ENOENT/EACCES => OPEN_OPENER_UNAVAILABLE; other spawn exceptions/errors, nonzero exit or signal => OPEN_FAILED. Zero exit is accepted only with elapsed time strictly less than5000ms. At or after5000ms without previously accepted terminal result => OPEN_TIMEOUT. Timer scheduling delays must not turn an already-expired zero exit into success.

Fixed diagnostics (never append native details):
- OPEN_FILE_UNSAFE: “Select a regular local HTML file with a supported path.”
- OPEN_FILE_UNAVAILABLE: “The selected HTML file could not be accessed.”
- OPEN_OPENER_UNAVAILABLE: “A desktop opener is unavailable. Open the selected HTML file manually.”
- OPEN_FAILED: “The system did not accept the open request. Open the selected HTML file manually.”
- OPEN_TIMEOUT: “Could not confirm the open request before the timeout; the file may already be open.”

Lifecycle: independent deadline, single terminal settlement, clear deadline on every success/error/timeout/synchronous-throw branch. Keep an inert error listener until `close`, including error→close without exit. On close remove owned terminal/error/close listeners; no process-global listeners. On timeout unref once and never call kill. stdio ignore avoids descendant-held pipes keeping the CLI alive. Tests must cover monotonic elapsed time, delayed callback, error→close, fstat failures/closure and late events. No headless/mobile/browser/rendering success is inferred.

Actual process helpers run only on Linux, because macOS's fixed /usr/bin/open must never be invoked by tests. macOS command/vector tests use mocked spawn exclusively. Real timeout fixture writes its receipt before waiting, exits itself after approximately12s, and the parent subprocess has a9s watchdog. No immortal helper is created. The finite helper deliberately outlives the9s watchdog, so failure to unref cannot pass the <8.5s parent bound. Cross-platform rejection tests use nonexistent file operands, ensuring parser regressions cannot launch macOS GUI. Installed parity uses explicit AGENTPROF_OPEN_INSTALLED_BINARY and records skip versus pass.

Exact executable proposal files: tests/cli-open.test.ts and tests/cli-open-installed.test.ts under this planning directory. They import future production modules using the intended final repository-relative paths; do not run them against unrelated working directories. Existing tests/cli.test.ts changes only its obsolete pending-open test: retain data-dir untouched/stdout-empty/noSQLite/raw-sentinel assertions, use missing local .html to expect OPEN_FILE_UNAVAILABLE instead of NOT_IMPLEMENTED, and rename the case accordingly. All other inherited test bytes remain unchanged.

Append-only SPEC heading must explicitly state that this implemented bounded slice supersedes the earlier capability snapshot's `open` NOT_IMPLEMENTED statement only after its verification evidence is recorded. Historical snapshot/failed/NOT RUN records remain intact. The wider report --open first-user-flow acceptance remains incomplete.


## Development activation and baseline evidence

2026-10-02: the separate developer /root/implement_prof_safe_open prepared all 209 inherited main 063ee04b37e97616065254c9534f430bdc33e3c3 files, verified Git blob SHA-1/SHA-256 and executable modes, then copied the independently frozen tests unchanged. The exact ten-path Project activation was saved/reloaded before coordinator production GO at 13:40 UTC. Earlier proposal and NOT RUN statements above retain their historical meaning.

Node 24.19.0/Linux with existing pinned dependencies, 512 MiB heap, one worker and 600-second watchdog: baseline build PASS; inherited CLI control 5 PASS; feature unit suite missing-module RED; six process cases NOT_IMPLEMENTED RED; installed parity 1 SKIP. These expected failures establish missing-feature evidence, not feature success. No native GUI/browser verification.

## Candidate focused evidence — 2026-10-02 13:43 UTC

The first candidate build PASS and exact frozen focused suites plus amended inherited CLI control PASS: 3 files, 72 tests passed, 1 installed-parity test skipped (73 total), 10.05 seconds. Commands used Node 24.19.0/Linux, existing pinned node_modules, NODE_OPTIONS=--max-old-space-size=512, timeout 600s and vitest --maxWorkers=1. The two independent test files retain SHA-256 914714e4e03dad4355bfab06e6d4b404161acf5ce28a77666dd5b7577c2df7db and 6f9cb23d6944df69c2337e347a01cd563bf61cdd1ee465cda16c51e8cb853f53. No test oracle modification.

The process cases use synthetic Linux xdg-open shims, including a finite acknowledgement-timeout helper, literal shell-sensitive filenames, inert globals, missing/nonzero helpers, invalid arguments/help, and a FIFO. macOS vectors are mocked only. Source is frozen for independent review; typecheck, full aggregate, script-disabled packed/installed artifact parity, native macOS helper and browser rendering remain NOT RUN at this checkpoint. Historical RED/SKIP evidence above is preserved.

## Independent deadline correction — 2026-10-02 13:55 UTC

Independent source review found that error/throw outcomes arriving after the monotonic deadline but before timer dispatch retained predeadline failure codes. Four additive independent regression cases (ENOENT, EACCES, EOTHER events and synchronous spawn throw at elapsed 5000ms) first failed as intended. The original frozen unit test bytes remain an exact prefix; process/installed oracle is unchanged. The first-settlement function now applies monotonic expiry uniformly before any result, preserving earlier error classification and inert later callbacks.

Candidate v2 build PASS; focused CLI/unit/process suites PASS: 3 files, 76 tests passed, 1 installed-parity SKIP. No aggregate or installed PASS is asserted. This correction supersedes the initial candidate implementation receipt while retaining its earlier PASS and newly demonstrated RED evidence. Renewed independent frozen review and root-scheduled full/typecheck/artifact/installed gates remain pending.

## Verifier scope amendment — 2026-10-02 14:00 UTC

The exact reservation expands to eleven paths solely for scripts/verify-artifact.mjs after coordinator review and saved/reloaded Project amendment. The obsolete top-level help assertion requiring a pending command first reproduced RED against built candidate help. Its replacement asserts open registration and the same script-disabled packed archive’s open --help trusted-input/rendering/no-retry boundaries. Every package-content, installation, read-only and parity gate is preserved; help cannot launch a helper. This narrow amendment supersedes the earlier ten-path maximum, not its exclusions. V3 is frozen before full qualification.

## Frozen v3 qualification — 2026-10-02 14:13 UTC

All eleven v3 hashes remained unchanged throughout qualification. Node 24.19.0/Linux x64; existing pinned dependencies; one Vitest worker, 512 MiB heap and a 600-second watchdog for each stage.

- Typecheck and build: PASS.
- Full suite: 53 files PASS; 1426 passed, 41 optional tests skipped, 1467 total; 221.03 seconds. Optional skips are not passes.
- Revised unchanged-content artifact gates: PASS, 52 packed files; script-disabled npm-exec/global installation, selected-source read-only stats/insights/failures parity and unchanged stores. The only verifier change is the reviewed obsolete-help replacement.
- Retained script-disabled tarball install: PASS. Controlled Linux helper tests against built/installed CLI: 7 PASS, zero skips, 8.19 seconds. This resolves the opener installed gate only; it does not turn every aggregate optional skip into PASS.
- Separately rebuilt exact baseline 063ee04b37e97616065254c9534f430bdc33e3c3: 10 inherited synthetic provider fixtures, 181 exact status/stdout/stderr comparisons PASS, including scan initial/reuse, stats/list/failures/read-revisits/invocation-overlap, insights, report human/JSON, help/version/error paths. Report HTML bytes/mode and private store bytes/mode remain unchanged. Intentional open behavior and top-level/open help changes are excluded explicitly. No old optional help-matrix oracle was weakened or repurposed.

Native macOS /usr/bin/open, real browser rendering, selected HTML safety/offline behavior, hostile pathname-race resistance, performance benefit, real-user pilot, publication/head CI and broad P6 completion remain NOT RUN or out of scope. The earlier missing-feature RED, four deadline RED cases, obsolete verifier assertion RED and installed skips remain recorded above.

These receipts qualify the candidate based on 063ee04b only. Main advanced externally to ffd87e1dc1bcbc21d925d7466ae19b944c1a8735 after PR #36; fresh-main integration and requalification are pending. No new-base PASS is implied. Parent owns shared-document integration, publication and exact-head CI; no merge/release/deploy occurred.

## Fresh-main integration qualification — 2026-10-02 14:28 UTC

The isolated integration independently verified all 216 blobs/modes of main ffd87e1dc1bcbc21d925d7466ae19b944c1a8735 (tree 8549d3dd18de9292917fe5928ba2bd9cd12b3b14). All PR #36 parser/search/test/parity-helper additions remain intact. The eleven-path opener delta changed no production/test/verifier bytes from the qualified old-base candidate; shared documents received exact new suffixes after fresh-main contents. Independent integration review was CLEAR before new-base tests.

All eleven frozen integration hashes stayed unchanged through these new-base gates, on Node 24.19.0/Linux x64, existing pinned dependencies, one test worker, 512 MiB heap and 600-second stage watchdogs:

- Typecheck/build PASS. Full suite: 57 files PASS, 1575 passed, 41 optional skipped (1616 total), 204.55 seconds.
- Revised script-disabled artifact verifier PASS: 53 packed files; npm-exec/global install and inherited read-only stats/insights/failures gates preserved.
- Retained script-disabled installation PASS. Built/installed controlled Linux opener: 7 tests PASS, zero skips, 8.03 seconds. No real graphical helper was launched.
- Separately copied/verified/rebuilt exact ffd87e1 baseline: 181 exact old-command comparisons across ten inherited synthetic provider fixtures PASS. Initial/reused scan, selected stats/failures/read-revisits/invocation-overlap, insights and report human/JSON plus unchanged help/version/errors were compared. Report HTML bytes/mode and store bytes/mode remained unchanged. Intentional open behavior/top-level/open help changes are excluded explicitly.

Only this contract and FINDINGS receipt append after qualification. Prior old-base receipts, failure history and optional skips remain distinct. Native macOS helper acceptance, actual browser rendering, real-user pilot and publication/exact-head CI remain NOT RUN. This is the bounded standalone slice, not broad P6 completion; no merge/release/deploy.


## Current-main review qualification — 2026-10-03

The parent composed actual main `65f02fb086bb175a4ef5b9f5efb1b969809bc61f` with source `56a9af5e20d436cf9160adccb0eba7e6759896f5`, retaining complete current-main shared-document prefixes and original feature/research suffixes. Independent review covered all eleven original paths, zero skipped, and found no additional opener production defect. A separately registered developer reproduced three genuine help-parity RED cases and amended only the existing help functions in read-revisits, invocation-overlap and search-recurrence tests. Entire old/new opener help and the exactly-once top-level description hunk are frozen; every other help/stat/schema/parser/store oracle remains intact. The three focused cases became GREEN. Parent final review covered all fourteen scope paths; 238 unowned main blobs/modes and all seven original code/test/verifier paths match automatic source/main composition.

Immutable code/test candidate `606e3304bfc2a6b475e5b71bdd076afe97cc6cc4` passed macOS arm64 Node24.21.0/pnpm10.34.6 frozen installation, typecheck/build and unchanged full check: 71 files, 1987 passed plus 38 explicit skips, 2025 total. Those skips are shared genuine-baseline32 and Linux-only6, with no duplicate installed/OS counting. Separate genuine b8ea155 legacy groups passed11+10 cases, and genuine e1998cc pre-recurrence passed11. Name-filtered exclusions47/24/21 are not new optional skips. All55 optional environment cases are covered across actual local/supplement executions; this is not one zero-skip aggregate.

Enabled npm prepack, isolated scripts-disabled consumer without mise/pnpm, npm exec/help/version, unsupported Node22.16 pre-import guard and a59-file allowed artifact passed. All57 compiled/installed runtime files retained identical bytes/modes before/after checks. The same genuine tarball then passed the unchanged seven-case controlled opener suite in a cached Node24.21.0/Linux arm64 container: zero skips, exact built/installed argv/output, safe finite timeout and FIFO rejection; installed runtime bytes/modes remained identical. Six cases cover the Darwin platform gap; the cross-platform invalid/help case was already covered and is not counted twice. Combined qualification covers2025 unique cases. Linux arm64 controlled-process evidence is separate from the supported hosted Linux x64 matrix.

Only this receipt and its FINDINGS pointer append after local qualification. Final publication/head CI and main closeout remain coordinating gates in the [Project-only draft](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=260623998) and final PR description; planned actions are not recorded as passed here. Native macOS helper acknowledgement, browser rendering, selected HTML safety/offline behavior, hostile pathname-race defense, publication and broad P6 completion are not claimed.
