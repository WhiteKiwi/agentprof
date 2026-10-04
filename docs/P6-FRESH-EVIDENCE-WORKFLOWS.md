# Explicit evidence capture in fresh workflows

## Specification — 2026-10-04

Continue the owner's request to implement remaining AgentProf development. Base main is `4f33d2d86c68c941ccb4c5b8f720c7c95de2786e`. PR139 unified reports, PR142 usage timestamps/daily tokens, PR145 explicit-file lifecycle and PR147 provider evidence are already merged; do not recreate them. Broad #5/#7 acceptance and #50's exploration reservation remain separate.

Existing `report`, `patterns` and `history` explicit-file workflows shall accept `--usage-timing` and `--pattern-evidence`. These are explicit capture choices, not report filters. Pattern evidence implies usage timing using the existing captureMode policy. Omitted/false choices preserve the existing collector invocation, legacy capture, receipt shape and default output. Stored-source CLI invocations reject capture flags rather than silently ignoring them or rescanning data.

`history --tokens --provider codex|claude --input FILE.jsonl --usage-timing --from UTC --to UTC --output NEW.html` shall collect one file and render the existing daily usage analysis from that exact source revision. `--pattern-evidence` also satisfies the timestamp requirement. Missing capture opt-in is an error before filesystem or storage access; requesting tokens must not silently opt into a different parser. Provisional usage remains provisional, unknown time remains undated, and no billing/completeness/savings claims are introduced.

Fresh token receipts add only `analysisMode: "tokens"`, and human headings identify token exports. Existing no-token receipt shapes and bytes stay unchanged.

Every fresh path retains explicit input/output validation, receipt-proven generation selection, read-only revision pinning, no stale fallback, safe no-overwrite publication, partial warnings, interruption semantics and existing privacy boundaries. Capture mode/type/combination errors fail before bootstrap. New CLI flags reject duplicate occurrences. Unsupported mixed source/fresh selection remains invalid. No directory discovery, automatic browser opening, merge, release or new provider semantics are added.

## Findings

Read current `src/cli/scan.ts` and `src/parsers/capture.ts`: collectScan already accepts a validated fourth ParserCaptureOptions argument; pattern evidence implies timestamps. `report-fresh.ts` and `fresh-analysis.ts` previously invoked it with three arguments. `history.ts` dispatched --tokens to the stored-only usage path before fresh dispatch. Existing fresh helpers already prove source/provider/revision and distinguish published-with-warning/aborted outcomes. The missing work is explicit policy propagation and composing the existing usage analyzer/renderer, not another metric engine.

## Implementation and Verify

1. Reuse captureMode in one small fresh-capture helper, propagate explicit choices through report/pattern/history fresh paths without changing absent/false behavior. **Verify:** invalid types and duplicate flags fail before I/O; all exact Codex1/2/3 and Claude2/3/4 selections, pattern-implies-timing, one collector call, same-mode reuse and mode-change replay; legacy no-flag output/arguments stay equal.
2. Add fresh history token dispatch, using existing usage history analyzer and renderer in the same pinned read. **Verify:** required explicit timing/evidence opt-in, UTC/offset/session bounds, one source read, final/provisional/null and stored-export parity; failed/stale/intervening revisions cannot publish old data.
3. Add actual synthetic scan/store/CLI and installed-package regression tests; inspect changed-file scope. **Verify:** both providers, all fresh report modes, old stored paths and errors, no raw text in HTML; unified/history/pattern pages keep identity-free output, while the unchanged legacy report retains its existing hashed source ID. Verify no private mutation from reads, no overwrite and no new skipped cases. Run typecheck/build/focused and full supported-runtime checks; record exact counts/failures and distinguish local/hosted results.
4. Publish Draft and hand off. **Verify:** remote source/test blobs equal tested changes, final-head CI status is observed, only implementation checks complete. Independent review and actual merge remain open; no broad parent closure.

## Execution environment and ownership

Owner is this ChatGPT continuation, one active narrow ticket (#149). Runtime UUID and separate development/review subagents are not exposed; none is invented, and independent maintainer review remains necessary. Only scoped docs, fresh-capture helper, fresh-analysis/report-fresh code, history/pattern/report option/dispatch hunks and new tests are reserved. Existing analyzers/parsers/checkpoints/store/schema/legacy stats/insights/design/dependencies remain unchanged.

Temporary branch-only snapshot tooling packaged the public repository's tracked files, pinned dependencies and resolved Node runtime for this isolated environment; no .git, credentials, environment files or user logs were collected. A temporary mechanical apply workflow published exact replacement operations and checked the expected Git blob hashes of all eight changed source/test files. It used a non-force push to this feature branch and removed the apply script and both temporary workflows before handoff. Main was not modified. No Work/Codex job was launched.

Directory-membership reconciliation and empirical/design/release acceptance remain outside this slice. This document is a narrow specification/implementation addendum; live progress belongs to #149.

## Executed verification

Local Node24.21.0/Linux strict typecheck and build PASS. Focused new suites: **68 PASS /0 FAIL /0 SKIP** (workflow49 + CLI19, including one real installed-tarball case exercising both providers and all three commands). The prior focused selection intentionally deferred the installed case and reported67 PASS/1 unselected; the subsequent run executed it successfully.

The local scripts-disabled installation used a temporary loopback registry serving only the exact pinned Commander15 files from the verified source snapshot because external DNS is unavailable. This is not an ordinary public-registry qualification; hosted Foundation checks independently use the normal registry. No dependency/lockfile or existing test was changed.

Initial new assertions incorrectly prohibited the legacy report's existing hashed source identity (4 FAIL/45 PASS). Inspection confirmed that this is the old report contract, not a raw secret. The corrected tests preserve old HTML byte parity and still forbid raw sentinels/scripts in every output and durable IDs in unified/history/pattern outputs. Production rendering was not changed. Initial tooling copied a mise shim rather than the resolved Node executable; the corrected artifact verifies actual process.versions.node24.21.0. No Node22 run is counted as supported qualification. A failed local mirror startup caused one interrupted installation attempt; the mirror was created and the complete focused run repeated successfully.

### Full local qualification

Node24.21.0/Linux x64: strict typecheck, build and the complete default regression suite PASS. **4,415 PASS /0 FAIL /138 inherited optional SKIP;146 files (144 PASS/2 SKIP)**. New49+19=68 cases all execute with zero new skips. The authentic schema5 seed from `5614a3107b53022f29ea32d44ba83f533fd58b92` was provided via AGENTPROF_PRE_RESUME_DIST. Other optional baseline/installed matrices remain unselected; they are not marked passed. Public-registry independence is not claimed for the local loopback installation mirror.

Existing artifact verifier PASS: **134 files**, scripts-disabled packed npm-exec/global installation, existing stats/insights/failures parity and immutable private stores. `published:false`; no npm release occurred. The new installed case separately compares both providers across fresh unified report, patterns and daily token history, using the same unchanged generation and exact JSON/HTML/exit/store bytes. A real sequential second capture-mode commit proves revision-change refusal; it is not an independent-process concurrency test.

Only five existing CLI files change: fresh-analysis, report-fresh, history, patterns and main (report registration only). The new helper consumes the existing parser capture contract; no analyzer, provider parser, checkpoint, schema, dependency, existing test or renderer is modified. Legacy report keeps its existing hashed source identity; no raw payload is added. Temporary source/toolchain/publish tooling is absent from the final diff.

### Source publication

Implementation commit `ec7f12e3174a182d1f0ba5e152f12a780dee0ce9` contains the locally tested candidate. Mechanical publication checked these exact source/test blobs:

| Path | Git blob |
| --- | --- |
| src/cli/fresh-analysis.ts | 30a2c6de78a59633994441784caca728a0661fbf |
| src/cli/fresh-capture.ts | b5e680bbc75f1aec0bd7d19c5542d8afac39afe0 |
| src/cli/history.ts | ea65de61c1ffb53b4bf5c751cbf5cec6f709b059 |
| src/cli/main.ts | 936f913f8002bac66a0a5439e68f4ef92ad606e3 |
| src/cli/patterns.ts | 4ab00f9188c6addae7060c84c434eb2d9041faa6 |
| src/cli/report-fresh.ts | 636f363927cfd82189eef3347b1a44eeda809973 |
| tests/fresh-capture-cli.test.ts | 57fb75d2c0bb3f0dd72f9b8950cde28c7c42ce06 |
| tests/fresh-capture-workflows.test.ts | 1ebc41922a77c6e66949d3191f8cb0d34d42e80f |

Final hosted CI results are attached to the owning PR and #149 after observation. At this documentation commit they are not yet declared PASS. Independent review/merge, latest-main composition, native browser acceptance and directory-membership reconciliation remain open.

## Independent maintainer qualification — 2026-10-04 KST

Coordinator `01a1009e-990b-72e0-af24-9acac67c653f` independently reviewed the six OCR-selected production paths and all three excluded document/test paths of original source `a3c30bb55782595724b4dc125f4f35017923fea4`: **9 reviewed /0 skipped**. Separate read-only research `/root/fresh150_research` completed the same nine-path contract audit; no Critical/High/Medium defect was established and no production or test correction was admitted. The original author specification, tests, source history and failed-run limitations remain intact. Research's malformed-calendar coverage observation was addressed through independent composition checks using one invalid `--from`, rather than the original duplicate-flag subcase.

Actual local **Node24.21.0 /macOS arm64** strict typecheck/build and new68 cases PASS with no new skip. One shared full run with authentic schema5 seed and genuine retained evidence/report, usage and provider composition horizons completed **4,463 PASS /0 FAIL /90 historical conditional cases not selected**. The68 new cases are included in that whole-suite count; the difference from the author's default4,415 PASS comes from48 retained baseline/actual-installed cases now selected, not duplicate local/hosted counts. All three retained external-installed contracts use the actual current candidate package; new self-pack/install coverage also executes.

Scripts-disabled artifact verifier **134 files PASS**; a separate ordinary-registry global installation passes outside the repository, and all132 built and installed compiled files are byte-identical. Independent built/actual-installed consumers execute **12 controls /68 CLI invocations**, confirming both providers and timing/pattern captures, daily +09:00 versus UTC partition arithmetic, exact valid session filtering, half-open window values, final/provisional preservation, no raw/path/script/identity insertion, mode0600, existing-output refusal and unchanged private bytes. Single malformed calendar, invalid offset and invalid session each return INVALID_ARGUMENT before opening absent input/store/output. These controls supplement the unchanged68 author regressions; they are not extra full-suite test cases.

The original immutable source's four Foundation jobs and GitGuardian security check are completed/success. This appended documentation receipt changes no qualified non-Markdown source, tests, compiled/runtime/package input, dependency or broad acceptance contract; the common gate is reused for identical inputs. Final documentation-head hosted checks, actual ordinary main merge, final-main CI and narrow issue149 closeout are separate publication gates. Directory-wide membership, exploration implementation, independent-process races, empirical provider/usefulness/performance, native browser/accessibility, release and broader5/6/7/10/50 acceptance remain separate.
