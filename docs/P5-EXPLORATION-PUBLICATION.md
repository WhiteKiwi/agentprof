# Exploration publication and qualification

## Transport plan — before remote source publication

The source candidate is implemented and tested in the isolated container against main4f33d2d. Container DNS cannot reach GitHub for an ordinary git push. Native connector actions will stage a compressed UTF-8 patch and a temporary branch-only mechanical publisher. The patch is inert source data, not commands from input logs.

The publisher is limited to `feat/exploration-diagnostic`, checks a fixed SHA256 of the decoded patch, checks its exact twelve-path allowlist, applies it with `git apply --index`, and verifies every resulting Git blob against the locally tested manifest before committing. It removes both staging files in the same final source commit and only performs a non-force push to that feature branch. A concurrent branch update causes the ordinary push to fail; no retry/force update of another revision, main merge or release is permitted. It does not upload `.git`, credentials, environment files, user logs or runtime secrets. Existing Foundation CI and dependencies remain unchanged in the final tree.

The pre-code specification and claim remain in P5-EXPLORATION-CONTINUATION and issue50. This publication adjustment changes transport, not product behavior. All available source tests must pass before creating the Draft; final-head hosted CI is recorded separately from local execution. The existing scoped documentation and all unrelated base files are preserved.

## Local evidence so far

Node24.21.0/Linux typecheck and build passed. New suites currently have87 executed passes: analyzer52, format7, integration14, public/installed CLI14. The analyzer suite includes a separate brute-force oracle over180 deterministic input populations; those populations are not additional test cases. Five validated4096-event maximum populations retain full JSON below8MiB and human output below32KiB. The largest observed JSON among those cases is2,379,067 bytes; largest human output5000 bytes.

Local actual npm pack/global installation uses scripts disabled. Because public registry DNS is also unavailable, a loopback test mirror serves only the existing pinned Commander15 package. This is not a public-registry qualification; the unmodified hosted Foundation workflow will test normal-registry installation.

Initial test-only failures are retained: one malformed test object prevented collection (zero cases executed); after correcting syntax,52 analyzer cases passed. Three new CLI parameterized cases passed a string instead of an array; corrected tuple wrappers test exact flag arrays, then all87 cases passed. Product output and existing numeric/eligibility assertions were not weakened. Remaining full-suite and hosted results are not yet claimed.

## Executed source qualification and handoff — 2026-10-04

The preceding status paragraphs preserve their earlier point-in-time evidence. Implementation is published as [Draft PR151](https://github.com/WhiteKiwi/agentprof/pull/151), source `c0c0cd67c143ea9c9b3f01a0758eae81dd7737aa`, tree `4f3fd0b9f9a03989c7222b4e792bb1651ed6227d`. The actual publisher removed three patch fragments and its workflow (four temporary files), not two files as originally described in the transport plan. Exact12-path UTF-8 patch SHA256 `8ed56ea0e62453c06702de7f7617bc5d3338f7584c8c37dfa45346192e0a8444` and each changed Git blob were checked before the non-force feature push. The remote complete src/tests subtrees match the staged, locally tested candidate: src `8c0b1fd81ceac65b3314f106b160320a8d01d972`, tests `01d1d1c79de9e25d9dd16b5df8cf97378897a11e`. The .github subtree remains original `272b2a4bcc40edc5f1f4dd9309a0ef468a92a977`. Final PR scope is14 paths, including the two scoped documents.

### Local fixed-parent run

Actual supported Node24.21.0/Linux strict typecheck/build/full suite/artifact exit0. Whole suite **4,434 PASS /0 FAIL /138 inherited optional SKIP**,148 files(146 PASS/2 SKIP). All87 new tests execute without skips and are included in that count. Artifact135files PASS, scripts-disabled npm-exec/global installation, prior read-only stats/insights/failures checks, published:false. The authentic immutable schema5 seed comes from5614a3107b53022f29ea32d44ba83f533fd58b92. Other optional historical/baseline/installed conditions are not fabricated or counted as passes. The local loopback registry qualification stays distinct from normal registry installation.

### Hosted current-main composition

While this candidate was developed, prior PR150 merged into main `9a6427cf93d0a5c1840d25bd214821112c0c0fad`. Its nine fresh-workflow paths and report-only main.ts hunk do not collide with this issue's insights-only hunk. [Foundation37167842619](https://github.com/WhiteKiwi/agentprof/actions/runs/37167842619) for source c0c0cd67 passes all four jobs: Node24.15.0/24.21.0/26.7.0 pnpm check and unsupported-runtime guard.

Directly inspected Node24.21 job111334448319 checks out synthetic merge `ae0229054a61464631435dacd34384d56450cdea`, combining source c0c0cd67 with current main9a6427. It records **4,502 PASS /0 FAIL /138 inherited optional SKIP**,150 files(148 PASS/2 SKIP), all87 new exploration tests and all68 retained PR150 tests. The68-count difference from the local fixed-parent run is the actually executed PR150 suite, not extra exploration coverage. Normal-registry frozen scripts-disabled installation and artifact **136files PASS** are confirmed. This synthetic merge is test composition, not an actual PR151 merge.

The same job executes actual installed exploration, default/timing/enriched Claude captures, raw-deleted read-only JSON/human and private DB/key invariance, one pinned source read/selected analyzer, the180-population brute-force oracle and all five bounded-output controls. Counts/passed populations are not double-counted. Largest measured JSON2,379,067bytes and human5000bytes are synthetic bound checks, not a representative performance claim.

### Remaining gates

The following commit only appends this verification document; its own CI is separate from the already qualified source run. No new code/test change is made. Independent maintainer review, original unpublished fourteen-artifact reconciliation if available, wider real-user usefulness/false-positive/performance and release acceptance remain pending. This continuation does not claim separate research/development/review subagent execution or an unavailable runtime UUID.

Release only the issue50 implementation reservation at handoff; leave it open for independent review and actual merge. Historical waiting/claim/failed/NOT RUN records are retained. No main merge, package release, user-log upload or broad5/6/7 completion is performed. Directory-wide durable membership/deletion/move reconciliation is separate remaining development.
