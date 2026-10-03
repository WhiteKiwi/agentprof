# Source-local pattern engine

## Specification addendum — 2026-10-03

This is a bounded continuation of parent #6, not a replacement for its ten-metric/six-diagnostic acceptance. Baseline: `97880d8551f6b4ffa2b0a8dcd759a8f60c9c0b54`. Existing stats PRs have an active oldest-first review coordinator; do not rewrite their branches or create more duplicate display-only tickets. Preserve #5/#7 broad ownership and #50's exploration/insights reservation.

Add actual calculations for ordered edit-to-validation cycles, exclusive/category-concurrent observed intervals, evidence-qualified Retry Loop, Repeated Error, Context Churn, Validation Thrashing and deduplicated pattern-associated time. Reuse native terminal admission from `source-failures`; do not reclassify nonzero exit codes. Slow Tool remains the existing `insights` implementation. Exploration remains #50. This slice does not claim all six diagnoses or whole-product acceptance.

The opt-in `patterns --source FULL_ID [--from UTC --to UTC] [--json]` command reads exactly one existing source generation. It has no scan, migration, default-root discovery, writes, browser opening, network requests or automatic action. A separate command avoids modifying the actively reviewed stats dispatcher and the reserved insights handler. Existing commands retain their behavior. The optional UTC period is half-open and requires both bounds. Qualification uses its declared observation window before contribution clipping; repeated-error's window is the selected period when supplied.

## Evidence and meaning

- Native source suppression, missing/contradictory provenance, unknown status, unsupported parser versions and unresolved execution relations remain visible. Temporal associations additionally require recognized complete context; omitted/opaque actions never prove that nothing changed.
- Source-reported item boundaries and paired invocation boundaries are distinct from reported process durations. Only validated positioned native intervals enter unions. Missing/estimated/unsupported intervals remain exclusions, not zero durations. Different sessions, interval scopes and evidence classes are never silently combined.
- An edit-validation cycle is an ordered observation within one stream/turn context: completed native edit/write calls followed by a native test/build invocation. It is not proof that the validation tested every edited file. Unknown, overlapping, contradictory or opaque intervening actions break/suppress association. No changed-file/line counts are invented. First-pass rate includes only cycles with a confirmed first terminal result; scope ratios use known declared scope only.
- Retry Loop needs the same non-null operation, turn and error identities, at least three confirmed failures in a closed trailing ten-minute window, and no ambiguous parallel/unknown attempts. Success and changes of error identity break failure runs. Qualifying failures include the first failure; successful calls and intervening gaps do not contribute to pattern time.
- Repeated Error needs at least three confirmed failures with one exact keyed error identity across at least two session identities in this source. Missing identities remain coverage gaps. No cross-source/project count or error-message reconstruction is attempted.
- Context Churn needs at least four completed exact lookup/range/content observations in ten minutes, complete content and explicit unchanged state, with resolved mutation/opaque boundaries. The first lookup does not contribute. Missing, changed, truncated or externally-unknown content is not redundant work.
- Validation Thrashing needs at least three observed cycle-associated validations in fifteen minutes with known validation scope. It is informational only, never a full-build inference from a command name, and contributes no time by itself.
- Every candidate retains rule/version/threshold, exact evidence IDs, contributing IDs, window witnesses and a necessary-work counterexample, one investigation, a matched experiment and a quality guardrail. Avoidability, root cause and improvement remain unestablished.
- Detected Waste is a label for observed pattern-associated time, not proven savings. Deduplicate canonical event IDs, then union compatible clipped intervals. Keep per-rule unions, total union and multiplicity-weighted overlap excess distinct. Unknown contributions imply a partial observed lower bound, not an exact whole-history total.

## Known provider limitation

Current ordinary Codex/Claude adapters intentionally do not capture error fingerprints, verified complete lookup content/change state or validation scope in many paths. Implementing a positive synthetic normalized-evidence kernel does not upgrade those adapter contracts. Real stored inputs without those fields must show `not_evaluable` and missing-evidence reasons. Native edit/validation ordering and positioned category time can still be measured where their prerequisites exist. Provider evidence capture/version/checkpoint upgrades, cross-source reconciliation and empirical usefulness remain separate work; do not close #6 on all-unknown output.

## Implementation and Verify

1. Add bounded interval sweep/union primitives with half-open clipping and compatible partitions. **Verify:** 20-second sum/15-second union, exclusive vs concurrent categories, identical/adjacent/zero spans, retry12/error8/overlap5 => union15, three-rule multiplicity, duplicate/conflicting IDs and unsafe arithmetic. Never infer intervals from durations.
2. Build a source-local admitted-evidence context and ordered edit-validation cycles. **Verify:** multiple edits/one validation, first failure/subsequent success, unrelated target, absent edit, pending/opaque/parallel/tied actions, unknown scope, exact first-pass denominator and source/provider suppression.
3. Implement the four evidence-gated rules and pattern-time composition. **Verify:** each threshold boundary and normal negative; changed errors, missing identities, distinct targets/sessions, first-failure vs first-lookup inclusion, mutation barriers, observation-window versus query clipping, unresolved coverage and deterministic immutable privacy-safe output.
4. Add the opt-in read-only command and focused synthetic tests. **Verify:** one pinned read/analyzer, deleted raw inputs, unchanged store/key bytes, structured JSON, bounded human rows/omissions, duplicate/conflicting/invalid arguments before I/O, and unchanged legacy command paths. Run supported-runtime repository CI on the published head.

## Ownership and execution record

Owner: this ChatGPT continuation; no runtime UUID or independent subagent identity is exposed or invented. Independent maintainer review is still required. Reserve only new pattern/interval/cycle modules, their new tests, this scoped plan and the two-line command registration in `src/cli/main.ts`. Do not change existing parser/store/schema/normalizer/insights/stats/report code, dependencies, CI or other feature branches.

Implementation, test execution and publication are pending. Planned cases are not PASS receipts. Use synthetic data only; never upload user logs, prompts, source contents or secrets.
