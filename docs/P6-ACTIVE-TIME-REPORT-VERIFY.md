# Active Time unified report verification

## Focused development receipt — 2026-10-04 UTC

Issue: [#161](https://github.com/WhiteKiwi/agentprof/issues/161), narrow child of P6. The [scoped plan](P6-ACTIVE-TIME-REPORT.md) was reviewed after [separate source research](P6-ACTIVE-TIME-REPORT-FINDINGS.md) and before implementation. This receipt covers the resulting local candidate, not a merge or broad P6 completion.

### Inputs and scope

- Genuine presentation predecessor: PR154 `596bd0842ae1c84735fb44469c677d6ba2eff0e1`, source tree `21beeb624118d9e11569e0304cdd57a9b133146b`, materialized from all461 verified Git blobs before development.
- Reviewed plan: public commit `6a5b4e71e758ed6a6d4f10dc47065daac5a4f4a9`, tree `9b052d9d773f40639fa12d3b9e564ecbadf7c728`. The local planning source reproduced that exact tree.
- Production delta: `src/report/unified-model.ts`, `src/report/unified-page.ts`, and new `src/report/active-time-section.ts` only. Tests: new `tests/active-time-report.test.ts` and `tests/active-time-report-cli.test.ts`; existing synthetic fixtures are imported unchanged. Scoped documentation only.
- No parser/analyzer/store/scanner/schema/CLI/style/helper/dependency/workflow or existing-test changes. The native Active Time, exploration and pattern authorities remain unchanged. No raw user logs or secrets were used.
- Existing direct Node24.19.0 Linux runtime, TypeScript7.0.2 and Vitest5.0.2 from the existing pinned dependency tree. Validation used one test worker and512MiB Node heap.

### Implemented contract

The internal model retains one complete unchanged native Active Time result from the same pinned source. Composition and rendering independently compare all eight source-envelope fields: source ID, provider, revision, parser version, normalization version, key version, completed offset and observed size. The two latter interpretation versions are additive internal envelope fields; public CLI receipts and analyzer schemas are unchanged.

The overview and linked count-only section retain assessment, `activeTimeAssessmentReason` and suppression separately. Source/capability/observation-window/readiness context and all eleven primary exclusion reasons remain visible, with unavailable distinct from zero and evaluated-empty. Every native partition's existing session alias is checked before clipping. Full-population distinct corroborating observation counts and independent union/span overflow partition counts precede at most twelve rows in native order. Rows retain exact admitted turn counts, distinct proof counts, union/span and separate arithmetic reasons. No pooled timing, percentage, turn/proof aliases, raw identity, chart or new admission heuristic is introduced. Complete native turn/proof evidence remains in `stats --active-time --json`.

### Commands and results

The baseline was built in a separate immutable-source directory before the candidate build. Its output was not rebuilt as the candidate. `AGENTPROF_ACTIVE_TIME_REPORT_BASELINE_BINARY` selects this genuine PR154 runtime. The older `AGENTPROF_ACTIVE_TIME_BASELINE_BINARY` retains its historical PR57 horizon and was not repointed.

1. Baseline `node scripts/build.mjs`: first attempt failed with `MODULE_NOT_FOUND` because this new source directory lacked its dependency symlink. Adding a symlink to the already installed pinned dependency tree, without installing or changing dependencies, allowed the same command to pass. Both logs remain retained. This was an environment-setup failure, not a passing product test.
2. Candidate `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`: PASS. Candidate `node scripts/build.mjs`: PASS. `NODE_OPTIONS=--max-old-space-size=512` for both. Production bytes were frozen after these passes.
3. Initial new model/render suite:64 PASS /1 FAIL /0 SKIP. The new evidence-absent inventory assertion incorrectly expected0; the unchanged native contract returns null. Only that new assertion changed to null. The complete rerun passed65/65 with no skips in2.87s; no production correction followed.
4. Final focused invocation, with the genuine predecessor and actual-installed variables enabled:

   `NODE_OPTIONS=--max-old-space-size=512 NODE_NO_WARNINGS=1 timeout 300 node node_modules/vitest/vitest.mjs run tests/active-time-report*.test.ts tests/exploration-report.test.ts tests/unified-report-model.test.ts --maxWorkers=1 --reporter=verbose`

   Result: **4 files /158 PASS /0 FAIL /0 SKIP**,101.50s. This is103 new cases (65 model/render,38 CLI) plus all32 unchanged exploration-report and23 unchanged unified-model cases. The new CLI set includes7 genuine predecessor cases and9 actual-installed cases; none was conditionally skipped. Inner command comparisons and repeated65-case execution are not extra unique tests.

5. `git diff --check`: PASS. Production and test hashes below remained unchanged throughout the final focused invocation.

### Executed controls

- Complete native analysis equality and one direct invocation; full unchanged summary, Slow Tool, commands, failures, Recovery/retry, Read/search, exploration and pattern results. Input ownership, deep native freezing, render immutability and reversed-array determinism.
- All eight independent analyzer-envelope and renderer-envelope mismatches rejected with `INVALID_RECORD`. Turn-only sessions retain existing aliases; a missing alias in an omitted twentieth partition fails rather than leaking its identity.
- Independent overlap/identical/adjacent/zero/gap/nested/cancelled wall geometry, paired proof semantics and replay membership. Recorded8150ms duration never replaces native interval geometry. Unsafe individual, unsafe accumulated union and span-only overflow retain admitted membership and independent reasons.
- Pending/unknown/missing/estimated/inconsistent/invalid boundaries; absent/wrong-reference/nonordinary/non-turn/unknown/contradictory terminal evidence; absent or late paired pending proof. All eleven native exclusion counters render without inference.
- Unavailable, evidence-absent, state-limited/dropped, ambiguous-count/origin, future/mismatched parser, normalization/key and unsupported-provider context. Matching Codex1/2/3 support remains native. Empty, all-excluded, excluded-turn partial and simultaneous partial-shape/excluded states retain native reason precedence and full exclusion counts.
- Full20-partition population before12-row display:8 omitted; union-overflow count1 and span-overflow count2 include omitted partitions and can overlap. One30-turn/60-proof row remains complete. Counts explicitly deduplicate proof membership; no per-turn list is clipped.
- Actual validated SQLite persistence/reopen of4096 turns and8192 observations, for4096 turn-only sessions, unsafe intervals and one session. Each native result retains all memberships. Exact combined HTML sizes:52,093 /52,555 /50,409 UTF-8 bytes respectively, below1,048,576. These are synthetic cardinality controls, not measured provider coverage or performance claims.
- All five inherited exploration maximum populations remain passing; final combined sizes were63,584 (tied),61,817 (unique),98,751 (many sessions),122,159 (many candidates) and62,043 (missing identity). Existing exploration32 cases were unchanged.
- Escaped hostile reason/shape/limitation text,4097-character rejection, final escaped-page overflow rejection, no scripts/external assets/hidden evidence JSON, unique anchors, caption-labelled table regions and exact CSP style hash. All tested reports exclude source/session/turn/observation IDs and synthetic raw sentinels.
- Ordinary Codex wall and paired/cancelled/gap records and actual Claude duration-plus-exploration records, in default/timing/pattern captures. Actual versions remain Codex1/2/3 and Claude2/3/4. Nine stored cases delete input first, observe one transaction-pinned read and one native call, retain0600 output and unchanged DB/key names, modes and bytes.
- Nine real built fresh cases match raw-deleted stored HTML and unchanged complete Active Time JSON; partial scan exit follows its actual receipt. Additional partial-shape and genuine-zero controls preserve reasons and values. Claude Active Time remains unsupported while its nonempty exploration section survives; Codex retains qualified Active Time beside unsupported exploration.
- Non-unified absent/false never invokes Active Time. Stale generation fails before analysis/publication; collision cannot overwrite output. Selected invalid-argument paths remain storage-free.
- Genuine PR154 comparisons preserve every one of the46 selected stats views (default plus45 flags), human and JSON, source listing, insights/exploration/patterns, help/version and non-unified report receipts/HTML/modes. Three predecessor gap controls confirm its missing Active Time anchor and byte-identical full exploration sections after the addition. Existing tests and historical help expectations were not modified.

### Actual installed qualification boundary

The coordinator packed the frozen candidate and installed it outside the source tree with lifecycle scripts disabled. The installed executable was the package's real `lib/node_modules/agentprof/dist/agentprof.cjs`. All136 compiled files matched built SHA256 values; the new section module was present and matched. The coordinator supplied its install receipt and executable to the developer's nine enabled cases, which exercised fresh/default-timing-pattern/provider matrices, raw-deleted stored report and complete human/JSON Active Time equality from an outside working directory.

Dependency retrieval used a same-process loopback registry serving only verified official Commander15 metadata/tarball, not ordinary hosted-registry qualification. The earlier cross-exec loopback installation could not connect and was interrupted; it is retained as a failed environment attempt, not an installed pass. Final-source normal-registry hosted CI remains a separate parent gate.

### Frozen source hashes

| Path | SHA256 |
| --- | --- |
| `src/report/unified-model.ts` | `20575530e72548ca3eb9bc14fc1d41064a59c85f3208c2d5af35ae0f5355b7a7` |
| `src/report/unified-page.ts` | `7aeef3c4176e8bee498ad71311c3a6fd1a29cbbd3af25eee889e8282fc73c8b0` |
| `src/report/active-time-section.ts` | `5718713d27ab6f8babcbeab2ef49d6e47efb9c25e2577aaa1c15beb460ebb0f4` |
| `tests/active-time-report.test.ts` | `1e5609e8495649073fbbe0575238ca0656311f1eee947a3e5adfd4b53bd4665a` |
| `tests/active-time-report-cli.test.ts` | `e6fb1df664f23048b6defcba10daf40a926711484325df57451e97b032bb2226` |

### Remaining qualification

Full repository regression with the authentic schema5 seed, unchanged artifact verifier, final all-path independent review, latest-main/prerequisite composition, normal-registry exact-head hosted CI/security, remote source/tree identity, publication and merge remain coordinator-owned gates. The focused158-case run is not a full-suite result. No existing optional historical horizon was fabricated or substituted.

Actual browser/layout/keyboard/assistive-technology/print inspection was not run by this contributor; semantic HTML/CSP string assertions do not establish that acceptance. Real user logs, empirical provider coverage, resource/performance guarantees, npm release and broad P5/P6 completion remain outside this receipt. The separate PR154 maintainer review may change the eventual integration base; its genuine596 predecessor remains preserved, and any later composition needs its own qualification. Source and tests are handed back uncommitted, with no external issue/PR mutation by this developer.

Coordinator browser-attempt receipt: the actual installed binary generated a synthetic50,323-byte report with25000ms union and110000ms span. The cloud browser rejected its `file://` URL under the permitted-protocol policy (only HTTP/HTTPS). No alternate route was used and no visual, keyboard or viewport assertion executed; browser/native acceptance remains **NOT RUN**, distinct from the passing static HTML checks.

## Parent qualification and current-main composition — 2026-10-04 UTC

Independent static review covered all five production/model/CLI-test paths and found no actionable defect or missing scoped obligation. All five frozen hashes above were checked again after review; the native analyzer is byte-identical to the genuine PR154 source. This is separate from the executed runtime gates below.

### Original596 qualification

The first complete run retained **4,643 PASS /4 FAIL /138 conditional SKIP**. All four failures stopped at inherited `npm pack` calls before installation because the default home cache directory was unavailable. They were the existing fresh-analysis, fresh-capture, history-installed and source-lifecycle installed witnesses. No source/test assertion was changed. Setting only npm's default cache to an existing writable directory fixed the harness.

The unchanged-source full rerun passed **4,647 /0 FAIL /138 inherited SKIP**,152 passed and2 skipped test files (154 total),424.66s. Every one of the103 new cases ran. The original artifact verifier passed **138 files**, scripts-disabled tarball npm-exec/global installation and retained read-only stats/insights/failure checks. These are the original schema6 presentation-base results, not the final schema7 composition counts.

### Actual merged prerequisite and final local gates

PR154 merged during qualification as actual main `61652839e7a1f91f02d0a9d8e6f6bf1411ab6b10`, source head `db3d1fe449e2766a611589b5675cf135cf2931b9`. The pre-integration plan was amended before composing this dependency. Its exact470-blob tree `a108601271fa1a6634ac566f18db9ce7fd1b94fd` was independently reconstructed. All468 incoming paths outside this feature's two modified existing paths remain byte/mode-identical. Six new paths complete the eight-path feature delta; every reviewed production/test byte remains unchanged.

The incoming37-path change preserves schema7 directory persistence, its read-only marker/orphan checks, historical compatibility controls and qualification documents. It does not change the native Active Time analyzer, source-store API, unified/fresh dispatch or this feature's existing report paths. A second independent read-only review confirmed the complete incoming tree, unchanged five feature hashes and pinned/query-only/no-migration interface compatibility, with no blocker.

A separate genuine616 predecessor was built before the composed candidate. The new report-only baseline variable selects this immediate schema7 predecessor in the final run; the original596 and older historical horizons remain retained. A new scripts-disabled candidate global installation had **139 compiled files**, all matching the built bytes. The local registry served only integrity-verified official pinned Commander15, within the same execution namespace, and was stopped after use. This is not a claim of ordinary-registry network qualification.

Final local Node24.19.0/Linux x64 gates:

- Strict typecheck and build: PASS
- Full suite with authentic schema5 seed, genuine616 predecessor and actual installed witnesses: **4,705 PASS /0 FAIL /138 inherited conditional SKIP**;156 passed +2 skipped files (158 total),444.41s
- All103 new cases executed with no new local skip, including all7 predecessor and9 installed cases. Their counts are included in4,705 and are not added again
- Existing artifact verifier: **141 files PASS**, scripts-disabled npm-exec/global install and original read-only stats/insights/failures; `published:false`
- Same one-worker/512MiB conditions. No production/test changes followed the reviewed freeze or final run; only this scoped evidence was appended

The two local full-run horizons, repeated focused checks and command comparisons are not summed. Default hosted CI does not receive the optional new predecessor/installed variables; its actually selected/skipped cases must be reported separately. All new obligations above were executed locally rather than inferred from a conditional skip.

Final source publication and exact-head normal-registry hosted CI remain pending at this documentation freeze and are reported in the PR. The Draft now targets main because its PR154 prerequisite has merged. Later base movement, authorized merge, real-provider/native/browser/release qualification and broad P6 acceptance remain separate. The issue's attempted dependency-status amendment was not confirmed; this dated receipt records the actual source and qualification state without rewriting prior history.
