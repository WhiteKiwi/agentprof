# Explicit single-file fresh report

Local successor proposal, 2026-10-02. Publication is not authorized. Project draft: https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=260861648

`agentprof report --provider claude|codex --input FILE.jsonl --output NEW.html [--open]`

Exactly one explicit file/provider pair is an alternative to stored-only `--source`. Reject mixed, duplicate, incomplete and root selections before bootstrap. Preflight requires a regular uncompressed `.jsonl` file with no symlink components. Resolve the data directory once; never inspect omitted-provider roots.

Collect once, then select exactly one committed or unchanged generation from the returned scan receipt. Completed and partial evidence may report. Discovery truncation, stop reasons, unsuccessful outcomes, contradictory counts or revision tokens fail closed. Never choose another stored source/revision or fall back to old data. Partial evidence preserves unknowns and diagnostics, with overall exit 1.

Validate an optional internal expected revision before report I/O; compare it immediately after `readSource` inside the same pinned callback used to build every model. Mismatch is safe `SOURCE_REVISION_CHANGED`. A writer before this read prevents output; one after the captured read does not invalidate that captured generation.

One workflow-owned SIGINT listener spans collection, report publication and optional opening. Check abort before later phases and immediately before opening. Preserve completed publication and already-started opener outcomes. Abort exits 130, without rollback or retries. Post-scan report errors remain a combined safe receipt retaining scan effects; pre-scan errors retain safe stderr and exit 2.

The output wraps the unchanged scan and report/open receipts. Exit 0 requires completed scan, warning-free publication and, if requested, accepted opening. Writer warning and opener failure receipts remain intact. Browser rendering is never asserted. Existing output is never overwritten, although collection may already have committed.

Stable caller-controlled input paths are a precondition. Preflight and scanner reopening are not an atomic file binding; a substituted directory containing exactly one eligible child can pass cardinality. Scanner hardening is outside this slice. No parser, scanner, store, model, renderer, metric or package changes.

## Verification plan

Focused selection/revision/cancellation controls, mocked workflow receipts/listener cleanup, real Claude/Codex commit/reuse/append and writer interleaving, privacy/no-bootstrap checks and stored-only parity precede independent source review. Built and script-disabled installed CLI parity, aggregate and artifact checks follow their authorization gates. Actual runtime/browser/live-input P6 acceptance stays open until observed. No planned check is a pass.

## Local implementation freeze evidence

Node 24.19.0/Linux, one Vitest worker, 512 MiB heap and 600-second stage ceilings. Typecheck and build PASS. Focused suite: 8 files, 146 tests PASS, 3 installed-binary tests intentionally skipped until packed installation qualification. Executed controls include real Claude/Codex commit/reuse/append, actual independent writer before and after the pinned read, safe combined report failures, signal cleanup and 24 built-CLI refusal combinations. Built completed Codex returns 0; partial Claude with accepted controlled opener returns 1. This is not a GUI test.

Test calibration failures are retained outside the source freeze: appending an empty JSONL line caused expected scanner rejection, so the append oracle now uses valid explicit synthetic records. The post-read writer initially treated SourceCatalogue as an array; it now uses the existing `.items` API. The opener fixture initially omitted DISPLAY and correctly received OPEN_OPENER_UNAVAILABLE; the controlled-shim fixture now supplies its synthetic display environment. These were test setup fixes, not scanner/store/opener behavior changes. Historical failing logs remain available to the reviewer.

Aggregate, packed installation/artifact, supported-runtime, hosted CI, macOS/native GUI and live-input full P6 acceptance were NOT RUN at this freeze. Independent source review is pending.

## Post-freeze local qualification (2026-10-02)

The immutable fresh-input source tree `681eda2be6652a971734d3ec8958154b265e3f3d` received independent source review CLEAR: all 251 paths verified, exactly 16 owned changes, 235 other inherited paths unchanged. Source remained byte/mode identical throughout qualification.

- Node 24.19.0, Linux x64; one worker, 512 MiB heap, 600-second stage ceiling; explicit writable package cache
- Typecheck/build PASS; focused 146 PASS, 3 installed-only skips at source freeze
- Aggregate: 2006 PASS, 48 skip; 72 files PASS, 1 skip; 190.41 seconds
- Script-disabled packed installation: 6 built/installed fresh CLI tests PASS, including selection/no-bootstrap/privacy, completed Codex, partial Claude and controlled opener outcomes
- 58 installed dist files match build bytes/modes; installed executable directly reports version 0.1.0-dev.0
- Inherited stored-only dependency/candidate/installed CLI oracle: 55 cases PASS, unchanged private-store bytes/modes
- Actual CLI SIGINT oracle: 6 built/installed cases PASS; exit 130 preserves published HTML and actual accepted/failed/timeout results after the owned opener begins; no retries
- Artifact: 60 files PASS; publication false

The initial empty-cache offline install failed with ENOTCACHED for commander metadata. The failure receipt was preserved; normal official-registry installation with the explicit writable cache then passed. Historical synthetic test calibration failures were retained as described above. Copied precode-oracle header comments describe their original preimplementation provenance; they are not statements that the APIs remain absent.

No supported-runtime matrix, exact-head hosted CI, real GUI/browser/macOS opener or live-user-input full P6 acceptance is claimed. Stable caller-controlled input paths remain a precondition; preflight/reopen path substitution is not solved. Source publication, PR creation/merge and deployment were not performed. This appendix is a separate local proposed evidence amendment; the reviewed source freeze is unchanged.

## Current-main composition and schema-6 requalification plan (2026-10-03)

This successor reapplies the reviewed fresh-input delta on current main `8e3118155038a04adcf08f97113186af4243bc2d` plus the separately reviewed stored-report/open composition. All newly integrated upstream scanner/store/parser/checkpoint/search-recurrence/timeline bytes and documentation are preserved. Earlier counts above describe the older immutable source and are not a qualification claim for this successor.

The newly integrated schema-6 Claude checkpoint path requires an authentic schema-5/Claude-parser-1 write-migration witness. Use the retained PR38 `5614a3107b53022f29ea32d44ba83f533fd58b92` build, verify all 51 retained dist hashes, assert its actual schema/version/partial diagnostic receipt, then run fresh report on a private copy. Assert read-only schema5 rejection without mutation, explicit fresh migration to schema6/parser2 and exact revision2, unchanged reuse without ingestion/writes, and two one-record suffix generations with exact offsets/ordinals. The historical original stays unchanged. Never recreate historical evidence with current code or weaken fixture outcomes silently.

A separate current-generation corrupted checkpoint control requires failed scan, zero parser calls, no HTML or opener call and unchanged post-corruption bytes. The existing pinned-revision, cancellation and stored-only parity controls remain required. Added controls and all refreshed runtime stages are NOT RUN at composition freeze; independent composition review and resource allocation precede execution. Stable-path, runtime/browser and publication boundaries remain unchanged.

## Current-main local qualification completed (2026-10-03)

The successor composition tree `c9377f739a4f4ba57b91d9c0b65d3b7fa3419671` is based on main `8e3118155038a04adcf08f97113186af4243bc2d` plus the independently reviewed stored-report/open dependency `2d646088600377951a21855031b65656f22a65f6`. Independent composition review verified all 272 file bytes/modes, the exact 16 owned changes, 256 unchanged dependency paths and preservation of upstream shared-document prefixes. The source/archive remained unchanged throughout these runtime checks.

On Linux x64 / Node 24.19.0, one worker, 512 MiB heap and 600-second stage bounds with explicit writable package cache:

- Typecheck and build PASS
- Focused: 149 PASS across nine files; three installed-only cases initially skipped and then explicitly passed in installed qualification
- Aggregate: 2,201 PASS, 60 explicit optional skips; 82 files PASS and one optional file skipped; 167.89 seconds
- Packed/script-disabled installation: six built/installed fresh CLI tests PASS; all 61 installed dist files match built bytes/modes; installed executable directly ran
- Stored-only refreshed dependency/candidate/installed parity: 55 cases PASS, preserving private-store bytes/modes
- Actual built/installed CLI SIGINT: six cases PASS, preserving publication and already-started opener accepted/failed/timeout outcomes with exit 130 and no retries
- Artifact: 63 files PASS; no publication performed by the qualification commands

The genuine schema5/Claude1 oracle was explicitly enabled in focused and aggregate runs. Its retained historical executable is from PR38 head `5614a3107b53022f29ea32d44ba83f533fd58b92`, with all 51 retained dist hashes verified. It is not attributed to the older 063 revision. The control proves schema5 read-only rejection without mutation; fresh write migration of a private copy to schema6/parser2 and revision2; unchanged revision reuse without parser calls or DB changes; two one-record suffix generations with exact offsets/ordinals; and an unchanged historical original. The corruption control proves failed scan before parsing, HTML creation or opening while retaining the post-corruption bytes.

No current-run fixture calibration, source change or failed stage was needed. Prior-freeze calibration failures remain historical evidence and are not erased by this result. Supported-runtime matrix, exact-head hosted CI, macOS native opener, actual GUI/browser rendering and live-user-input full P6 acceptance remain NOT RUN. The documented stable-input-path precondition and preflight/reopen limitation remain unchanged. Local qualification does not establish remote publication, merge or release.

## Independent released-main review and qualification (2026-10-03)

The reviewed source retains original PR48 `553c1ad1a5606f1b8c9dd4dfc2990131c7151d9b` and feature base `6b317bc0c84bdd759c9ddfc4ec44c493013beda4`, integrating actual main `85b27dfc405c3c23abed15e36b5d2a6789414801`. Separate research covers all16 original paths (5 OCR selected/11 exclusions manually reviewed/zero skipped), then the bounded macOS fixture. No production defect was established. SPEC/FINDINGS/IMPLEMENTATION and saved Project admission precede each separately assigned test correction. The17-path ceiling preserves264 unowned main blobs/executable modes,9 unamended original non-document automatic-composition deltas and all four complete incoming shared-document prefixes.

Three bounded test corrections preserve every other assertion: recurrence admits the exact new report row alongside the already reviewed exact opener row; fresh-precode requires the released token notice twice and historical notice absent; the ordinary workflow fixture uses `realpathSync(tmpdir())` without changing production no-symlink validation. The genuine e199 help and unchanged Claude presentation witnesses each reproduce1 RED→1 GREEN (31/12 filtered cases are not passes). The fixture's identical28 cases reproduce27 failures/1 pass→28 passes/zero skips, changing only import/setup. Initial planning49fbe and actualmain85b are the real parents of compositionf23d414; the final runtime source freeze is `6e0fb5c9a0eeb983c41e3b6e54ce5de87c1c1d9a`, tree `c4b24df4a1a786a76a5640f9cf305fe5d3163d2d`, with281 tracked inputs. The first full check atae865b remains retained: type/build passed,2312 passed/27 failed/45 skipped,133.00s; artifact gate not reached. It does not qualify this corrected source.

Pinned Node24.21.0/macOS arm64 and pnpm10.34.6 typecheck/build/full/artifact pass: **2339 passed/45 explicit optional or platform skips**,88 files (86 passed/2 optional whole-file skips),139.09s. Separate compatible whole genuine baselines execute11+10+11 formerly optional cases;47/25/21 filters are excluded. Actual Node24.21.0 Linux arm64 executes14 original installed tests with zero skips:7 standalone opener,1 stored-report wrapper and6 fresh built/installed cases. One overlaps the macOS run, so these runs execute all **2384 unique suite cases**. Neither the wrapper's55 inner comparisons/direct repeat nor additional SIGINT/history repeats increase this inventory.

The actual built/scripts-disabled installed fresh workflow qualifies pre-bootstrap refusal/privacy/omitted roots, completed Codex, partial Claude commit/reuse and retained opener failure with no failed-scan fallback. Six additional actual SIGINT scenarios cover built/installed accepted/failed/timeout outcomes: exit130 retains the complete scan/publication, HTML/store/key/sidecar bytes/modes, exactly one literal opener argv and started-helper outcome, without retries or helper killing. Private timeout helpers release naturally. The existing pinned-revision cases execute real independent writers before and after capture: replacement before the pinned read prevents HTML; later replacement preserves the captured model. Stable caller-controlled parents remain a precondition; preflight/reopen substitution is not solved.

The actual immutable5614/treec136 original schema5 executable and51 unchanged modules seed mandatory Codex migration and both full schema5 alias consumers. Fresh Claude copied migration proves schema6/parser2/revision2, unchanged reuse without parser/DB writes and two exact one-record suffix generations; original historical data stays unchanged. Corrupt current-generation state fails before parser/HTML/opener. Separate named historical receipts repeat two already executed full-suite cases. Existing six Codex/five Claude real SIGKILL controls remain in the passed full suite. A real schema5/raw-deleted store supplies36 exact read-only rejections and4 candidate/installed report-open refusals with no output/opener/store mutation.

Stored-only55-control qualification uses the genuine whole PR47 pre-fresh consumer ataaa5/treeD4EA, identical to actualmain85b: all61 runtime modules and original Commander15 resolution preserved. Default JSON/human/HTML after invented raw deletion, opener outcomes/argv, neighboring commands and private-store bytes/modes stay exact. All1302 historical/pre-fresh source blobs,295 runtime modules and complete dependency maps remain unchanged. No thin or relabelled baseline substitutes for these inputs.

Enabled prepack rebuilds owned dist; a fresh script-disabled consumer without mise/pnpm in PATH passes version/help/npm-exec. All62 candidate/installed runtime files match bytes/modes before and after; the64-file artifact gate and Node22 unsupported guard pass. Archive SHA256 `54901d0bd4d8809e13b54e2ac29e25cad5532a9a5b1dc1bfe960d69b286ab2ef`. Final evidence appends only to this page, IMPLEMENTATION and FINDINGS;278 other frozen inputs stay unchanged. Exact published-head/test-merge CI, expected-head merge, clean main sync and actual main CI are separately observed in the linked PR and Project. Only synthetic fixtures/controlled helpers were used; native GUI/browser/AT, wider provider/P6 readiness, performance and release acceptance are separate.
