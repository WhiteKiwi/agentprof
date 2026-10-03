# Explicit stored-source report opening

## Contract

`agentprof report --source FULL_ID --output NEW.html --open` generates the existing stored-source report, then requests the native opener only after publication completes with a verified target. This is an opt-in stored-source workflow. It does not scan input roots, establish freshness, or complete the broader fresh-input-to-report product acceptance.

Without `--open`, report arguments, HTML, receipts and exit behavior remain unchanged. Source and output are required; `--open`, source and output cannot repeat. Unknown options, positional arguments, input roots and boolean assignments are rejected before store or output I/O. Global JSON and data-directory options retain their existing positions. Opt-in output must have a case-insensitive `.html` or `.htm` suffix and valid local path syntax, including no lone Unicode surrogate. Relative output is allowed; the opener receives only the absolute published output. No URL fetching or latest-file search occurs.

A published but unverified target skips opening. Verified publication warnings still permit opening, retaining every warning, durability qualification and cleanup field. Successful helper acceptance adds `open: {status: "accepted", opener: "open" | "xdg-open", browserVerified: false}`. A skipped request records `status: "skipped"` and `reason: "target_unverified"`; failure records `status: "failed"` and a closed safe diagnostic. All outcomes retain the exact publication receipt and HTML file. JSON stays in the report envelope; human output starts with the unchanged report receipt and appends the opener outcome and browser-not-verified notice.

Exit 0 requires both an ordinary published result and accepted opening. Publication warnings, skipped opening and opener failures exit 1 with one stdout receipt. Prepublication errors retain the safe stderr envelope and exit 2, without opening. A timeout may occur after the file is already open. There is no retry, killing of the helper, rollback, deletion, re-render or replacement output. Native opening may create OS/browser history. Helper acknowledgement does not verify browser rendering.

Stable trusted output parents remain required. Reusing the standalone opener re-resolves the path and does not protect against hostile replacement after publication. Renderer, analyzers, storage and standalone opener behavior remain unchanged.

## Implementation and verification plan

1. Validate roots, present source/output/data-directory syntax, then output suffix and Unicode, then missing selection before calling report generation. Verify invalid opt-in arguments cause no report or opener invocation.
2. Await exactly one unchanged report call, gate on publication and target verification, and await at most one unchanged opener call. Verify ordering, every writer warning, prepublication exceptions, safe postpublication errors and exact receipt preservation with immutable synthetic objects.
3. Wire only the report option/action/help and obsolete standalone help clause. Verify default report parity, duplicate/unknown/extra argument rejection and standalone opener parity.
4. Exercise a deterministic synthetic store after removing raw input. Verify exact HTML and unchanged store bytes/modes through controlled Linux opener shims, then script-disabled installed-artifact parity. The timeout fixture self-exits and is awaited; no actual browser is launched.
5. Run typecheck, build, focused tests, independent review, one-worker bounded aggregate and artifact gates. Record each actual result separately. Supported-runtime and exact-head hosted CI remain independent publication gates.

## Evidence

The dependency-only build passed on Node 24.19.0. Before implementation, the independent unit suite failed because the workflow module was absent; no unit assertions executed. The independent real-CLI oracle completed synthetic scan, raw-input deletion and default report byte/receipt parity before failing on unsupported `--open`. These are missing-feature controls, not feature acceptance. Candidate qualification on Node 24.19.0: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` and `node scripts/build.mjs` passed. With `NODE_OPTIONS=--max-old-space-size=512`, `node node_modules/vitest/vitest.mjs run tests/cli-report-open.test.ts tests/cli-report-installed.test.ts tests/cli-open.test.ts tests/cli.test.ts --maxWorkers=1` passed 99 tests with one inherited installed-test skip. The independent workflow suite is included unchanged. Subsequent qualification of the unchanged candidate passed:

- Independent all-path review: clear, with all 243 file bytes/modes verified, 11 scoped changed paths, and all three supplied independent oracle sources unchanged.
- Controlled Linux CLI: `node tests/report-open-cli-oracle.mjs dist/agentprof.cjs BASELINE_BINARY` passed 28 cases after synthetic raw input deletion, including success, nonzero, missing/EACCES, signal and finite timeout helpers; the private store remained unchanged.
- Script-disabled `npm pack --ignore-scripts` and installation passed. All 57 installed dist files matched candidate bytes/modes. `AGENTPROF_REPORT_OPEN_BASELINE_BINARY=BASELINE_BINARY AGENTPROF_REPORT_OPEN_INSTALLED_BINARY=INSTALLED_BINARY node node_modules/vitest/vitest.mjs run tests/cli-report-open-installed.test.ts --maxWorkers=1` passed the enabled real installed-binary oracle, rather than skipping it.
- `node node_modules/vitest/vitest.mjs run --maxWorkers=1` passed 66 files with one skipped file: 1898 tests passed and 45 skipped. The installed report/open oracle was intentionally disabled in the aggregate and qualified separately above.
- `node scripts/verify-artifact.mjs` passed with 59 artifact files, script-disabled npm exec/global-install help/version checks and inherited packed read-only parity.

These stages used Node 24.19.0 on Linux x64, `NODE_OPTIONS="--max-old-space-size=512 --disable-warning=ExperimentalWarning"`, an explicit writable npm cache and a 600-second outer stage limit. The CLI oracle used only synthetic controlled helper processes; finite timeout fixtures were awaited without product-side killing or retries. Production files were unchanged throughout qualification. Supported-runtime matrix and exact-head hosted CI remain separate pending publication gates.

Real GUI behavior, macOS native helper behavior, browser rendering, provider coverage and broad P6 acceptance remain unverified.


## 2026-10-03: current-main integration qualification

The unchanged stored-source report/open feature was composed onto main `8e3118155038a04adcf08f97113186af4243bc2d`, after the standalone opener and invocation timeline merged. Independent composition review was clear: all 253 unowned main files remained exact, search-recurrence CLI additions survived the narrow clean merge, and four shared documents retained their complete main content. Schema 6 and current diagnostics were preserved; no report/opener implementation changed.

Qualification on Linux x64, Node 24.19.0 passed:

- Baseline build, candidate typecheck/build and the existing four-file focused suite: 99 passed, one installed-only skip
- `node node_modules/vitest/vitest.mjs run --maxWorkers=1`: 75 files and 2090 tests passed; two files and 58 tests skipped
- `node scripts/verify-artifact.mjs`: 62-file artifact passed, including script-disabled npm exec/global installation and inherited read-only command parity
- Script-disabled retained pack/install, then `node tests/report-open-cli-oracle.mjs CANDIDATE_BINARY MAIN_BASELINE_BINARY INSTALLED_BINARY`: 55 controlled cases passed with the actual installed binary, unchanged HTML/store bytes and modes, safe timeout handling and no real desktop launch
- Authentic schema-5 stores generated by the retained earlier writer were checked after deleting raw input: 36 JSON/human rejection comparisons against current-main, candidate and installed commands passed. Read-only stats modes, insights and report retained `DATABASE_SCHEMA_INCOMPATIBLE`; `report --open` likewise created no output and invoked no opener. Store bytes and modes remained unchanged.

Stages ran sequentially with one worker, `NODE_OPTIONS="--max-old-space-size=512 --disable-warning=ExperimentalWarning"`, an explicit writable npm cache and 600-second outer limits. All frozen source bytes/modes were rechecked after execution; installed dist bytes/modes matched. Aggregate opt-in skips are not counted as installed or historical-schema coverage; the explicit runs above provide those results. Exact-head hosted supported-runtime CI remains a separate gate. Real GUI, macOS native-helper behavior, browser rendering and broad P6 fresh-input acceptance remain unverified.
