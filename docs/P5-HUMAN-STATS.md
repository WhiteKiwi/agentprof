# Human selected-source stats tables

## Scope and reviewed baseline

The coordinator approved the independent concrete layout review before this
separate development session. Project-only execution tracking:
https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=259743024

Baseline: PR25 head `7a5570bf88446b1e3580b6d8039458d960f57df9`, exact tree
`9e1cd66d531b50bb21fb134b50014a49935041f7`. Stack on `feat/readonly-source-stats`.
At 2026-10-01 14:48 UTC PR24 was merged as `b96bda476042b41a3b60507376b781c677e6997d`;
PR25 was retargeted to main, with unchanged head, still open/draft. Recheck the
base before publication and reconcile after dependency merge. Local materialization
uses the exact dependency tree; its synthetic local commit is not a remote commit.

Ownership readback confirmed the prior stats reservation release and the external
reservation of `report/**` and `docs/REPORT-PREVIEW.md`. Only `src/cli/stats.ts`,
its tests and this document/minimal SPEC/IMPLEMENTATION supplements are changed.
JSON and source-list output remain byte-for-byte identical. SourceSummary,
parsers, database, report, options, dependencies and workflows remain unchanged.
No new metrics, graphs, percentages, savings, global totals or source collection.

## Presentation contract


1. Front matter must retain full selectable source ID, provider, revision, completed/observed byte prefix, source-prefix scope, availability, persisted evidence, suppression, unchecked freshness and cross-source conflict warning. Do not call the recorded prefix fresh or complete history.
2. Render record inventory as a small table. Status/outcome and selection/finality inventories may use wrapped label=value rows, with every enum value visible including observed zero. A null inventory map is 'unknown', never an all-zero map.
3. Put eligibility beside inventory. Show terminalCandidates and included separately. Neither equals all events in general. Show every usage eligibility counter: observedResponses, selectedRows, deduplicatedRows, excludedRows, excludedResponseGroups. In particular the first field is observed *eligible final* responses, not a population denominator.
4. Exclusion reasons are bounded enums. Show nonzero reasons in their explicit existing enum order plus '(unlisted reasons=0)'. If the whole eligibility object is null, show unknown and do not append that zero assertion. This saves noise without losing numerical information. Do not sum overlapping inventory interpretations together.
5. Sort full sessions and scope/evidence partitions locale-independently. Duration rows sort by known sum descending, then the existing full cohort identity tuple. Copy arrays before sorting; SourceSummary is frozen. Ties must not depend on locale, discovery/input order or only a non-distinguishing tool label.
6. Use two duration buckets in every partition: known sums, and unknown sums (currently numeric_overflow). Show at most 10 rows from each bucket. Report each bucket's available/shown/omitted counts separately, even when zero. Unknown rows must never disappear because 10 known rows filled a shared quota. Sort unknown rows by cohort identity and label them unranked. This is a deliberate refinement of the original total-10 proposal: maximum 20 visible rows per partition, rather than implying an unknown sum is slowest. All omitted cohorts remain in JSON.
7. The ranked numeric table uses row, n, sum ms, mean ms, max ms, p50 ms, p95 ms. Immediately below it, print the same row keys with category, tool and pattern. All identity fields appear in full. Row keys avoid aligning arbitrary label widths and let large numeric values grow columns naturally. 'unknown' for a null tool or command pattern preserves current semantics; do not invent 'not applicable'.
8. Use c.lowSampleP95 for the asterisk and test its consistency at 19/20 observations; do not rederive percentiles or other metrics in the formatter. Preserve finite max/p50/p95 on sum/mean overflow. A single shared legend explains '*' rather than repeating lowSampleP95=true on every row.
9. Print 'recorded duration sum' in the partition introduction and clarify overlap before ranking: not elapsed/busy time, time share, waste or proven savings. Known descending order is a useful inspection order, not an optimization recommendation or a universal top-tools ranking.
10. Keep the existing exact numeric string conversion as the default: null -> unknown, otherwise String(n), with no locale commas, token abbreviations, unit conversion or silent decimal rounding. This can retain floating-point tails such as 0.30000000000000004; accepting that is simpler and safer for this slice than designing an approximation contract. Fixed integer count fields remain exact. A later deliberate rounded display can be its own change.
11. Usage table headers remain provider/mapping/finality-specific with full session context and observed response count. All seven token components stay visible. No token component is recalculated from another. Codex reasoning is a subset of output; normalized input already includes cache components. Claude input is normalized uncached + cache read + cache write. Never add these breakdown components to input/total again. Do not render cache ratios or tokens saved.
12. Preserve overflowComponents and usage limitations for each displayed usage cohort, including zero_or_source_default. Never label the trusted_final fixture cohort as native source_terminal or pool them. Keep usage blocks unranked; their token counts are not comparable across providers, mappings or evidence finalities.
13. Keep source support, coverage, parser version, unsupported/ambiguous counts, stateLimited, diagnosticsDropped, observedShapes, and source limitations. These can be readable wrapped text in an evidence footer rather than JSON. Partial coverage must be visible near the front as well if the footer is likely to be far below a large report; add a short 'Coverage: partial; shape_verified_only' front-matter line if needed.
14. Do not limit the number of sessions/partitions in this slice without a separate explicit contract. State partition count. Existing source ceilings make output bounded, but 4096 distinct partitions is still verbose; no claim of globally compact output or universal terminal fit. No new terminal-width dependency or graph abstraction.
15. Numeric table contents are ASCII. Labels live outside aligned numeric columns. Wrap labels/prose at ASCII spaces around 100 characters without breaking identity tokens, never ellipsize/truncate. This is a formatting target, not an 80-column or Unicode display-cell guarantee. Wide/non-ASCII label strings must remain exact and clearly delimited; tests should assert preservation and association rather than alignment by JavaScript string length. Full source/session IDs may exceed the target width, as this proposal's 117-character maximum does. Long indivisible labels may also exceed it.
16. Footer: all cohorts and full contributing event/usage IDs are in --json; crossSourceReconciled=false, aggregationReady=false, parserResumeReady=false. Removing the row-ID lists must not remove the ability to inspect full evidence.


## Verification plan

1. Preserve unchanged output interfaces. Verify full JSON bytes/order/newline and
   source-list output, immutable inputs, complete inventory/eligibility/limits.
2. Render separate session/scope/evidence and provider/mapping/finality groups.
   Verify exact strings, 19/20 p95, real zero, fractions, overflow, overlap,
   empty/suppressed/provisional-only, known/unknown top-ten boundaries and ties,
   full safe labels, deterministic permutations and all IDs remaining in JSON.
3. Verify full synthetic samples, packed installed CLI, privacy and no reader
   mutation; full repository check, documentation links and whitespace.
4. Freeze only owned files for independent root review; publication owner verifies
   remote bytes and exact-head CI. Keep tracking In Progress until merge.

## Implementation decisions and evidence

Before coding, all execution checks are NOT RUN. No actual user logs are used.
The local macOS-only ObsDog integration path and plugin are unavailable in this
Linux workspace; no substitute credential, private log or memory claim is used.

Renderer decisions recorded during implementation: suppressed duration partition
counts are `unknown`, rather than zero; healthy empty input has zero partitions.
Usage eligibility explicitly labels observed eligible final responses. Numeric
rows are never wrapped; only prose/legends wrap at existing ASCII spaces.
Current stored tool and command labels use a closed ASCII vocabulary, so arbitrary
Unicode/control/delimiter-containing labels are not accepted source data. A direct
Unicode formatter robustness test is deliberately outside that input contract;
it does not promote provider or label support. Long valid repeated-flag patterns
are retained with distinguishing suffixes. No new validation or escaping is needed
at this already-validated boundary.

## Verification evidence — 2026-10-01

- PASS: Linux x64, Node 24.19.0, final `npm run check`: typecheck/build,
  513 tests in 24 files and 35-file artifact. Existing isolated script-disabled
  tarball npm-exec/global help/version and packed source stats checks pass.
- PASS: 23 focused formatter tests plus the existing 16 CLI stats cases. Complete
  Codex and Claude synthetic output is asserted in inline snapshots, with exact
  saved pre-change JSON envelope bytes. Healthy empty, provisional-only,
  evidence-absent/unavailable/state-limited/ambiguous suppression, observed zero,
  partial coverage, all inventory enums/exclusions and component overflow stay
  distinct. Suppressed partition counts remain unknown.
- PASS: duration partitions, provider/mapping/finality separation, immutable
  source inputs, reverse-order deterministic ties/cutoffs, 19/20 low-sample p95,
  exact fractional and MAX_SAFE_INTEGER strings, overlap sum 20000 without an
  elapsed-time derivation, known/unknown bucket sizes 0/1/10/11, unknown-only
  and eleven-known-plus-overflow cases. JSON keeps omitted rows and all IDs.
- PASS: full source cohort ceiling, 4096 separate partitions with long valid
  repeated-flag patterns. An early implementation's spread into `splice` threw
  RangeError with that input; the final array concatenation passes without
  truncating sessions or labels. This is a bounded synthetic regression, not
  full-history resource or terminal-fit acceptance.
- PASS: all ten existing synthetic provider JSONL files (seven Codex, three
  Claude) were scanned in an isolated store. For each stored source, the baseline
  PR25 binary and final binary produce byte-identical selected JSON. Source-list
  human and JSON output also match exactly. Input fixture roots were removed
  before reads; application outputs contain no raw fixture/secret sentinels.
- PASS: a script-disabled isolated installation of the final packed tarball
  produces exactly the same human and JSON selected output for all ten sources.
  DB/key file bytes, modes and directory entries remain unchanged across all
  baseline/final/installed reads. No storage or parser code changed.
- PASS: 58 local link paths in the three changed documents and `git diff --check`.
  SourceSummary byte hash is unchanged from the dependency tree.

The actual approved synthetic Codex sample is 3537 bytes / 65 lines; Claude is
3304 bytes / 61 lines. Both have maximum line length 117 because identities are
never shortened. Earlier human samples were 3362/3381 bytes and 21/22 lines with
maximum line length 427. This is a width/scanning improvement with more vertical
space, not a blanket byte reduction, user productivity or token/time-savings claim.

At developer handoff, independent final review, publication, remote-byte checks
and exact-head CI are pending. macOS, real-user/full-history resource and browser
report acceptance are NOT RUN in this session. Full P5/P6 remains incomplete.
No merge, deployment or npm publication has been performed.

## Root review refinement — 2026-10-01 15:01 UTC

Before publication, the coordinator requested avoiding repeated per-session scans
of all duration partitions and usage cohorts. Build session buckets once, sort
full session identities and each session's existing partition/usage keys, then
render each bucket exactly once. Preserve all output bytes and snapshots; no
semantic or scope change. Verify paired pre/post byte equality for the 4096-session
stress case, deterministic permutations, all ten fixtures and the full check.

PASS after the refinement: full check remains 513 tests / 24 files / 35-file
artifact; all ten baseline and packed CLI comparisons pass again. A structural
regression counts session-identity reads at no more than four times the 4096
session count with both duration and usage cohorts, rather than relying on a
hardware timing threshold. Reverse input order preserves exact output. An
independent paired execution of the pre/post formatter confirms byte-identical
human and JSON output for all ten fixtures and the 4096-session long-label case
(11880633 human bytes; SHA256
`d5788a003aa800931e36dce8b17892202e652ef7a968336f7fc33c5c39b64523`).
No snapshots or numeric/layout semantics changed. Final review/publication gates
remain pending; this supersedes the earlier frozen candidate.
