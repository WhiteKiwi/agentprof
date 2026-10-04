# Exploration publication and qualification

## Transport plan — before remote source publication

The source candidate is implemented and tested in the isolated container against main4f33d2d. Container DNS cannot reach GitHub for an ordinary git push. Native connector actions will stage a compressed UTF-8 patch and a temporary branch-only mechanical publisher. The patch is inert source data, not commands from input logs.

The publisher is limited to `feat/exploration-diagnostic`, checks a fixed SHA256 of the decoded patch, checks its exact twelve-path allowlist, applies it with `git apply --index`, and verifies every resulting Git blob against the locally tested manifest before committing. It removes both staging files in the same final source commit and only performs a non-force push to that feature branch. A concurrent branch update causes the ordinary push to fail; no retry/force update of another revision, main merge or release is permitted. It does not upload `.git`, credentials, environment files, user logs or runtime secrets. Existing Foundation CI and dependencies remain unchanged in the final tree.

The pre-code specification and claim remain in P5-EXPLORATION-CONTINUATION and issue50. This publication adjustment changes transport, not product behavior. All available source tests must pass before creating the Draft; final-head hosted CI is recorded separately from local execution. The existing scoped documentation and all unrelated base files are preserved.

## Local evidence so far

Node24.21.0/Linux typecheck and build passed. New suites currently have87 executed passes: analyzer52, format7, integration14, public/installed CLI14. The analyzer suite includes a separate brute-force oracle over180 deterministic input populations; those populations are not additional test cases. Five validated4096-event maximum populations retain full JSON below8MiB and human output below32KiB. The largest observed JSON among those cases is2,379,067 bytes; largest human output5000 bytes.

Local actual npm pack/global installation uses scripts disabled. Because public registry DNS is also unavailable, a loopback test mirror serves only the existing pinned Commander15 package. This is not a public-registry qualification; the unmodified hosted Foundation workflow will test normal-registry installation.

Initial test-only failures are retained: one malformed test object prevented collection (zero cases executed); after correcting syntax,52 analyzer cases passed. Three new CLI parameterized cases passed a string instead of an array; corrected tuple wrappers test exact flag arrays, then all87 cases passed. Product output and existing numeric/eligibility assertions were not weakened. Remaining full-suite and hosted results are not yet claimed.
