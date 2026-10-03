# Token-evidence availability in source reports

## Contract

The static source-prefix report shows one always-visible Token evidence panel before displayed sessions, including when no session is selected. Its exact-count table shows stored, selected, duplicate and excluded usage evidence rows. The adjacent eligible observed response count comes from the unchanged source-wide summary before display caps. All thirteen exclusion reasons, including zero counts, and the separate conflicting-response-group count remain visible.

The three SVG segments describe evidence-row disposition, not token coverage. Selected, duplicate and excluded widths are exactly 600 times their count divided by known positive inventory; x positions are cumulative. Zero and tiny segments are never enlarged. An empty or unavailable inventory has explicit text and no filled geometry. The semantic table is authoritative and its caption names a keyboard-focusable region.

Unavailable source takes precedence over absent evidence, then state-limited or ambiguous-origin suppression. Present-empty, all-excluded and eligible evidence remain distinct. Unknown counts remain unknown. Suppressed zero eligible responses do not prove no model responses occurred. Existing session sections with no eligible usage cohort state that fact without showing “Usage unavailable: none” or inventing per-session exclusion counts.

An identical provisional pair contributes zero selected, one duplicate and one excluded row. Conflicting payload groups exclude every row and increment a separate group diagnostic. The six-row reference case has two selected, one duplicate and three excluded rows, with two eligible observed responses. These are row dispositions; they are not counts of uniquely lost responses.

Per-session provider/mapping/finality cohort tables remain the authority for recorded token components. Cache and reasoning components remain subsets; observed zero, unknown and overflow remain distinct. No complete-session total, population coverage, cost, savings, token rate, API latency or LLM wait is inferred. Source-prefix and unreconciled cross-source limitations remain explicit.

## Implementation plan and verification

1. Render existing validated summary counters through a small pure helper; preserve analyzer, model, storage, CLI and schema contracts. Verify source-wide counts remain unchanged by six-session and four-cohort display caps.
2. Add a static semantic-token stylesheet rule and invoke the helper in assessment; correct session empty-cohort copy. Verify exact SVG geometry, every exclusion reason, state precedence and one additional table only.
3. Run focused feature and inherited model/renderer/timeline tests plus typecheck and build. Verify getters are rejected without invocation, raw identifiers are not added, CSP hashes match static CSS and combined maximum output remains under 1,048,576 UTF-8 bytes. Escaped overflow must remain REPORT_LIMIT.
4. Qualify aggregate, packaged-installed parity and independent review separately. Browser light/dark, mobile/desktop, keyboard, print, offline and runtime CSP require separate evidence. Publication and broad P6 acceptance are separate gates.

## Execution evidence

The pre-implementation reference controls passed; all nine panel acceptance cases failed as expected because the panel was absent. The implemented renderer passes those nine cases, seven supplemental cases, and the complete focused six-file suite: 159 tests, zero skips. Production typecheck and build pass on Node 24.19.0 with the pinned dependencies.

The unchanged inherited combined structural fixture renders 748,352 UTF-8 bytes. A positive-usage variant retains every combined display ceiling (480 duration rows, 24 usage cohorts, ten cards, 240 native groups, 240 native calls and 120 timeline rows) and renders 748,789 bytes, below 1,048,576. Its stored usage inventory is 4,096 rows: 24 selected, 2,000 duplicate and 2,072 excluded. Escaped overflow still fails with REPORT_LIMIT.

Reproduce the focused checks with `pnpm typecheck`, `pnpm build`, and `NODE_OPTIONS=--max-old-space-size=512 pnpm exec vitest run tests/source-report-token-evidence.test.ts tests/source-report-render.test.ts tests/source-report-model.test.ts tests/source-report-command-breakdown.test.ts tests/source-report-invocation-timeline-render.test.ts tests/source-report-invocation-timeline.test.ts --maxWorkers=1`.

Full aggregate, artifact and installed qualification, independent review and browser acceptance remain pending. Static tests do not establish browser light/dark, narrow-screen, keyboard, print, offline or runtime-CSP behavior. No public release or broad P6 completion is claimed.


## Frozen-candidate aggregate and installed qualification (2026-10-02)

The later gates recorded as pending above now pass on unchanged implementation and test bytes. Node 24.19.0 / Linux x86_64; one worker, 512-MiB Node heap and 600-second stage limits:

- Default aggregate: 64 files, 1,825 passed / 43 skipped, 1,868 total; 176.79 seconds
- Installed aggregate with all three installed-binary environment variables set: 64 files, 1,836 passed / 32 skipped, 1,868 total; 198.88 seconds
- Artifact verifier: 58 files, script-disabled package execution and isolated installation pass
- Retained installation: all 58 packed files match source-build bytes and modes
- Fresh prerequisite foundation build: pass; 16 baseline/current/installed command cases preserve exit status, stdout and stderr
- Synthetic installed report: 35,796 UTF-8 bytes; six stored usage rows, two selected, one duplicate, three excluded, two eligible observed responses; SVG widths 200/100/300
- Report regeneration after input deletion is byte-identical between built and installed CLI. Key/database bytes, modes and directory entries remain unchanged

The synthetic sample combines six ordinary-shaped invented Claude tool invocations with manually constructed, validated normalized usage evidence. Its trusted finality is an explicit test fixture and does not establish ordinary Claude transcript finality support. It contains no real user logs. Browser desktop/mobile, light/dark, keyboard, print, offline and runtime-CSP acceptance are NOT RUN; local browser access was unavailable to this qualification. No public release, published-head CI or broad P6 completion is claimed.

Reproduce aggregate checks with `NODE_OPTIONS=--max-old-space-size=512 pnpm exec vitest run --maxWorkers=1`; run `pnpm verify:artifact` after building. For retained installed coverage, set `AGENTPROF_INSTALLED_BINARY`, `AGENTPROF_INVOCATION_INSTALLED_BINARY` and `AGENTPROF_REPORT_INSTALLED_BINARY` to the script-disabled installed package’s `dist/agentprof.cjs` and repeat the aggregate. Preserve and report skipped tests separately.


## Current-main integration boundary (2026-10-03)

The earlier execution records above qualify the 2026-10-02 candidate, not this later composition. The feature is now composed onto main 8e3118155038a04adcf08f97113186af4243bc2d after PR #44 merged. Its renderer, styles and token tests remain byte-identical to the qualified token implementation; current-main schema6, checkpoint, search recurrence, safe-open and final timeline-warning fixes are preserved. Fresh focused/full/installed qualification, read-only schema5 rejection and baseline CLI parity are pending. Browser acceptance remains separate and is not inferred from the prerequisite timeline review.


## Current-main qualification (2026-10-03)

The composition on main `8e3118155038a04adcf08f97113186af4243bc2d` now passes fresh local qualification. The earlier results above remain historical. All token production and test files are byte-identical to the earlier qualified feature; the final upstream responsive timeline warning, schema6, checkpoint, search recurrence and standalone-open behavior are preserved. Complete current-main prefixes remain intact in shared documents.

- Typecheck and build pass; focused report and read-only safety tests: seven files, 199 passed, zero skips
- Default aggregate: 75 files passed / one skipped; 2,088 tests passed / 57 skipped, 2,145 total; 153.36 seconds
- Installed aggregate with all four installed-binary controls enabled: 75 files passed / one skipped; 2,101 tests passed / 44 skipped, 2,145 total; 162.11 seconds
- Unchanged artifact verifier passes with 62 packed files; enabled-prepack packaging and script-disabled retained installation pass, and every installed packed file matches its built bytes and mode
- Eighteen pristine-current-main / candidate / installed command cases match exit status, stdout and stderr, including search recurrence
- Built and installed report both reject an isolated copy of a genuine retained schema5 store with `DATABASE_SCHEMA_INCOMPATIBLE`, exit 2, no HTML and no migration. Original and copied key/database bytes, modes and names remain unchanged
- Positive usage evidence alongside every combined display ceiling renders 750,079 UTF-8 bytes, below the unchanged 1,048,576-byte cap. Escaped overflow still fails with `REPORT_LIMIT`. The preserved upstream timeline warning accounts for the increase from the earlier fixture size
- A fresh 36,011-byte synthetic schema6 installed report retains the six-row oracle: two selected, one duplicate, three excluded and two eligible observed responses, alongside the invocation timeline and native command sections. Built/installed HTML is identical after raw inputs are removed; key/database bytes and modes are unchanged

All runtime stages used Linux x86_64, Node 24.19.0, TypeScript 7.0.2 and Vitest 5.0.2, at most one worker, a 512-MiB Node heap and a 600-second stage limit. Local package commands used pnpm 10.33.0 with the explicit version-manager override; this does not claim local qualification of the repository's pnpm 10.34.6 pin. Exact pinned hosted-toolchain and supported-Node CI remain required after publication. Skipped historical/optional/platform tests remain skipped, not passed.

The refreshed HTML is an invented-data test artifact; trusted usage rows are manually constructed normalized fixtures, not a claim that ordinary Claude transcripts supply trusted finality. Browser acceptance for the token panel remains NOT RUN. Upstream timeline browser evidence does not qualify this new panel. Public release and broad P6 completion remain separate.

## Independent parent qualification on pinned current main (2026-10-03)

Independent source review covered all11 original paths at `8d32f8280bd77342ed1fb338a27122bc3017c0bb`, including all8 OCR-excluded documents/tests, with no silent skips or actionable code/test defect. Actual main `8e3118155038a04adcf08f97113186af4243bc2d` was already an ancestor. Additive SPEC→separate FINDINGS→IMPLEMENTATION admission produced frozen candidate `cf5841c530fc56d27e146ca62b5abaf5948473fa`; no original production/test byte changed. All251 unowned main blobs/modes and complete shared-document prefixes were preserved. Existing author evidence above remains historical.

Pinned macOS arm64 Node24.21.0/pnpm10.34.6 qualification passed frozen scripts-disabled dependency installation, enabled npm prepack, a tool-free script-disabled installed consumer, npm exec, and the unchanged complete check chain. The full run passed76 files /2107 tests with38 explicit skips (2145 total). Those skips comprise32 shared historical-baseline controls and6 Linux-only opener cases. The genuine split controls passed11 legacy read,10 legacy relationship and11 pre-recurrence parity cases; name filtering excluded47/24/21 other cases and does not count as PASS. Actual cached Linux arm64 Node24.21.0 executed the unchanged installed/built helper/FIFO corpus:7PASS/0skip; one argument control duplicates macOS and6 complete its platform skips. Therefore2145 unique cases were qualified across executions, not a single zero-skip full-suite run.

The historical inputs were actual b8ea155/3887159/063ee04/e1998cc source/build lineages, with815 tracked source files checked against Git blobs and executable modes. Authentic invocation and schema5 controls remained enabled. All60 installed runtime files matched compiled bytes/modes before and after tests; the unchanged artifact verifier passed62 files. The enabled-prepack archive SHA256 is `b34e52f81641efe49534db1e6407dd5c70a3c013cbc0504f5a7ec58fad9a0ca8`. Unsupported Node22.16.0 returned the dependency-free guard. The positive combined ceiling remains750079 UTF-8 bytes with every numeric/privacy assertion and escaped REPORT_LIMIT rejection unchanged. Linux's isolated Vitest harness installed pinned packages with scripts disabled; its dependency resolution was separate from the repository's frozen install. Controlled helpers establish acknowledgement behavior only, not native GUI rendering.

Browser execution used only invented normalized fixtures rendered by that same genuine installed runtime through an owned loopback preview. Fresh preinstalled Chromium151.0.7922.34 contexts covered375px light/dark,1440px light,794px print media, and empty/provisional/eligible-zero/suppressed/unavailable/absent/seven-session-cap states. Literal stored6/selected2/duplicate1/excluded3/N2, SVG x/width0/200,200/100,300/300, all13 reasons and separate conflict-group1 matched the semantic table. Every context had no document overflow. Keyboard traversal returned to the caption-labelled region with a3px focus outline. Already-loaded offline interaction retained the exact values; actual CSP blocked injected inline script and unauthorized style, with observed page requests confined to the owned preview. Print-media inspection verified static counts/styles, not pagination or physical printing.375px screenshots were visually inspected. Aside separately confirmed the real1440px desktop accessible table/focus; only the owned tab and preview were closed, preserving existing user tabs and services.

Five ordinary synthetic provider CLI reports (responsive overlap, overlap/point, zero-only, empty and Codex) retained the panel alongside inherited report sections. Their raw-deleted regenerated HTML was byte-identical and private key/DB hashes, modes and directory entries stayed unchanged; outputs were0600 without SQLite sidecars. The six-row browser fixture is deliberately normalized synthetic evidence and does not establish ordinary Claude trusted finality. Real-user/provider coverage, assistive technology, paginated/physical printing, native GUI, full P6 and optimization effects remain NOT RUN or unestablished. Only append-only evidence documents follow the frozen runtime; exact published-head CI and actual merge/main verification remain separate gates.
