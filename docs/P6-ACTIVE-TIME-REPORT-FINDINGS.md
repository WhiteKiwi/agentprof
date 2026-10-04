# Findings: observed turn Active Time in the unified report

Date: 2026-10-04 UTC. Status: source-backed pre-code research; implementation and new verification have not run.

## Recommendation

Proceed with the narrow report connection after the coordinator reviews the plan and registers/readbacks its issue claim. There is no analyzer, parser, store, capture-mode, or new-diagnostic prerequisite discovered in the checked source. Compose the **unchanged** `analyzeSourceActiveTime` result once from the same validated, transaction-pinned `StoredSource`, retain it whole in the internal unified model, and render its original assessments, populations, partition union/span and qualifications.

A small semantic table is sufficient. Reuse existing session aliases; show full turn/proof counts and bounded partition rows. Do not add a chart, new timing metric, per-turn detail, or turn/proof alias family. The existing Active Time JSON command already provides complete admitted turn endpoints, terminal statuses, proof IDs and excluded-turn membership. The report is a bounded presentation connection, not another native-evidence authority.

The important presentation hazard is that `activeTimeAssessmentReason` is **not** interchangeable with `suppressionReason`. Unsupported provider/parser, no-supported-turns and partial/excluded-turn reasons can have `suppressionReason=null`. An overview that uses only the existing generic suppression column would hide these states.

## Checked source and scope

- Immutable source for this review: PR154 `596bd0842ae1c84735fb44469c677d6ba2eff0e1`, tree `21beeb624118d9e11569e0304cdd57a9b133146b`. Source materialization independently verified all 461 Git blobs and recomputed the complete tree; the separate research reviewed that source.
- Initial specification: [P6-ACTIVE-TIME-REPORT](P6-ACTIVE-TIME-REPORT.md). Read repository `AGENTS.md`, applicable `docs/SPEC.md` and `docs/IMPLEMENTATION.md` contracts, `docs/TODO.md`, `docs/P5-SOURCE-ACTIVE-TIME.md`, and the unified/exploration scoped contracts and verification documents.
- Reviewed directly: Active Time analyzer/formatter, source summary/validation/read-only seams, unified model/page/helpers, fresh/stored report dispatch, Active Time fixture and pure/integration/CLI tests, exploration report model/CLI tests, provider/timing composition controls and build/package entry points.
- All references below are against the immutable source above. A convenient [pinned source root](https://github.com/WhiteKiwi/agentprof/tree/596bd0842ae1c84735fb44469c677d6ba2eff0e1) is provided for navigation; source evidence was read locally.
- This is pre-code source research. No new build, installation, product test or real-provider-log validation was performed. Existing test expectations and historical receipts are evidence of the contract, not a new PASS claim.
- Issue152 and PR154 explicitly release their author implementation reservation. Independent PR154 review/integration/merge remains separate. Issue5/PR153 and shared maintained-document reservations remain untouched. This child must not close broader issue7.

## 1. The existing composition seam is suitable

### One pinned source, unchanged consumers

`src/cli/report-unified.ts:19-33` validates arguments, opens `withReadOnlyStore`, reads one source, checks the requested revision, builds the model inside the callback, then renders/publishes. `src/db/read-only.ts:61-105` enforces existing private files, a read-only SQLite connection, `query_only=ON`, an explicit transaction, and retained snapshot/path checks. No second read or source discovery is necessary.

Fresh report already forwards `unified` and the selected scan generation's `expectedRevision` through the same report path (`src/cli/report-fresh.ts:72-92`). Existing capture selection is decided before collection; report composition must not request richer capture or change it. `src/cli/report.ts:10-20` dispatches unified only when true; absent/false continue the legacy branch.

`src/report/unified-model.ts:22-55` composes each top-level domain from the same `source` and retains native results. Each analyzer may call its own unchanged summary/admission helpers. The appropriate invariant is **one pinned source read and one direct Active Time call**, not one global summary or admission call. Adding Active Time must not reuse invocation-timeline or pattern-time interval membership: those are different native authorities.

### Required envelope checks

Existing unified model and renderer compare `sourceId`, `provider`, `revision`, `completedOffset`, and `observedSize` across domain results; exploration separately compares `parserVersion` (`src/report/unified-model.ts:28-33`, `src/report/unified-page.ts:26-36`). Active Time carries all five common fields plus `parserVersion`, `normalizationVersion`, and `keyVersion` (`src/analysis/source-active-time.ts:19-29,78-85`).

Recommended additive interface:

1. Retain the result as `activeTime` (or one consistently named native field), without trimming it or rebuilding its DTO.
2. Add it to the existing five-field comparisons in both composition and rendering.
3. Compare its parser/normalization/key versions with the source at build time. Add `normalizationVersion` and `keyVersion` to the internal unified envelope, alongside the existing parser version, so rendering can reject independent corruption of each of these three version fields too. This changes neither CLI publication receipts nor a public analyzer schema.
4. Keep the native schema/metric/version literals and original null/empty distinction. Do not relabel supported parser versions, substitute a current version, or normalize native output to make it match another domain.
5. Keep the existing internal-owned-model boundary. This connection need not become a general arbitrary-JSON validator or duplicate the store's identity/proof validation.

Concrete mismatch tests should independently corrupt all eight fields at the analyzer return seam and on the renderer's model, expecting the existing `INVALID_RECORD` error. Do not create a new diagnostic.

### Alias boundary already includes turn-only sessions

`src/report/unified-model.ts:46-48` collects session IDs from events, usage and turns. Therefore a source with zero invocation events but eligible turn evidence already has the required session aliases. `evidenceAliases` de-duplicates and sorts identities; `evidenceAlias` rejects absent references and never falls back to serializing an ID (`src/report/evidence-page.ts:51-59`).

Call the existing session resolver for **every** native Active Time partition before clipping. A missing alias in partition13 or4096 must fail just like one in the first row. Counts-only evidence needs no event alias and no turn/proof alias. Do not place persistent IDs in titles, data attributes, hidden JSON, comments, or links.

## 2. Preserve this native contract exactly

Primary authority: [source-active-time.ts](https://github.com/WhiteKiwi/agentprof/blob/596bd0842ae1c84735fb44469c677d6ba2eff0e1/src/analysis/source-active-time.ts), with the relevant line ranges below.

### Source support and assessment precedence

- The analyzer calls the unchanged source summary once (`78-85`). Summary suppression precedence is unavailable source, absent metric evidence, state-limited/dropped diagnostics, then ambiguous count/origin (`src/analysis/source-summary.ts:98-107`).
- Supported Active Time is exactly Codex parser1,2,3 with normalization1/key1, matching Codex capability provider/parser and `shape_verified_only` support (`source-active-time.ts:88-92`). Current ordinary/timing/pattern modes emit Codex1/2/3 and Claude2/3/4 respectively (`src/parsers/codex/index.ts:99`, `src/parsers/claude/index.ts:72`).
- Inherited suppression wins over unsupported provider/contract. Unavailable analysis retains source context/inventory but returns null eligibility/exclusion/partition counts and null partition/excluded-evidence collections. Claude duration-only evidence stays `unsupported_provider`, never a measured zero.
- Available empty/all-excluded input has `no_eligible_turns`, `no_supported_turn_intervals`, numeric populations (including genuine0), and an empty partition array. No scalar Active Time0 is invented merely because that array is empty.
- With eligible turns, partial shape coverage takes reason precedence over excluded turns. The full exclusion table is still required, so simultaneous partial shapes and exclusions stay visible (`118-121`). All partial-coverage context remains visible even when there are no eligible turns.
- Arithmetic overflow does not change a native `evaluated` assessment into unavailable or exclude an admitted turn. Union and span each carry their own null/reason.

One test-name trap: the older `source-active-time.test.ts` case called `parser2` changes only the source header, leaving capability parser1. It is a **mismatch** negative, not evidence that matching parser2 is unsupported. Current timing/provider composition tests explicitly preserve parser2/3 native geometry and reject matching future4 or mismatched pairs.

### Positioned boundaries and corroboration

`source-active-time.ts:52-74` admits completed/cancelled Codex turns only. Pending/unknown status, absent/malformed/reversed boundaries, estimated/unknown interval evidence and inconsistent endpoint/scope/evidence labels are excluded with one deterministic primary reason.

- `turn_wall` requires source-reported start, end and interval evidence.
- `observed_turn` requires paired-timestamp start, end and interval evidence.
- Both endpoints must parse to safe integer timestamps and end must not precede start.
- Proof observations are linked by turn ID and must be ordinary turn representation with no event/usage link. At least one ordinary matching terminal observation must match the current turn's source reference byte offset and status.
- Any contradictory linked turn terminal status is excluded before filtering terminal proof to ordinary origin. A same-status terminal replay is permitted.
- Paired intervals require ordinary pending proof earlier in persisted byte order than the first consistent ordinary terminal proof. Later `task_started` replay is permitted when earlier valid pending proof exists. Wall intervals do not require a fabricated pending record.
- Observation order qualifies proof; it supplies no timestamps. Native stored endpoints alone determine geometry. `durationMs`, usage dates and invocation events must never be used to synthesize turn positions.

The renderer must consume these admitted partitions and proof memberships as-is. No additional report-only admission heuristic is needed.

### Geometry and owned evidence

`source-active-time.ts:37-50,101-121` groups by session, interval scope and interval evidence. Overlapping/adjacent intervals merge for union. Span is last admitted end minus first admitted start and includes gaps. Each is safe-integer checked independently. There is no pooled scalar across partitions and no denominator for a time share.

The native DTO retains partition `turnN`, complete `turnIds`, and `turnEvidence` with completed/cancelled status, start/end and complete sorted proof IDs. Exclusions retain full turn ID/reason membership. Output is deeply frozen and independently owned. Report rendering must not mutate arrays, freeze borrowed input, or truncate this result in place.

## 3. Minimal useful HTML

Recommended content in existing visual/semantic styles, without shared CSS/helper edits:

1. One overview row and navigation anchor, `unified-active-time`. Overview shows native `assessment` and `activeTimeAssessmentReason`, rather than treating null suppression as success.
2. A short explanation: observed native turn interval union excludes gaps; observed span includes gaps. Completed/cancelled observed time can include waiting. Sessions/contracts are separate; neither is CPU time, task elapsed, productivity, waste or savings.
3. Compact source-context text/table: provider/parser/normalization/key versions, byte observation window, availability/persisted scope, suppression, capability provider/parser/support/coverage, observed shapes and unsupported/ambiguous/state-limited/dropped-diagnostic counts. Preserve false freshness/reconciliation/readiness flags and null query period. The overview already carries source revision/bounds; do not print the source ID again.
4. Full population table before display caps: native eligible turns, excluded turns and partition count. If proof support count is shown, name it **distinct corroborating observation count**, computed from the complete native admitted proof membership; it is neither total stored observations nor a coverage percentage. Keep all native inventory in the existing overview.
5. Full11 primary exclusion reasons, including zero values when evaluated; when exclusions are null, explicitly say unavailable instead of printing eleven zeros. These are primary reasons, one per excluded turn, unlike overlapping exploration session-reason counts.
6. Full-population arithmetic qualification counts for Active Time union overflow and observed-span overflow before clipping. These count partitions and can overlap. This prevents an overflow in an omitted partition from disappearing behind a healthy-looking first page.
7. Up to12 partition rows in native deterministic order, with exact shown/total/omitted: session alias; interval scope/evidence; admitted turn count; distinct corroborating proof count; union milliseconds/reason; observed-span milliseconds/reason. Include0 as0 and null as `Unavailable`. Never sum rows or compute a percent/share. Preserve native order instead of lexicographically sorting `active-1`, `active-10`, etc.
8. Native limitations and the concrete complete-evidence command: `agentprof stats --source FULL_SOURCE_ID --active-time --json`. Individual turn endpoints/statuses/IDs and proof IDs are intentionally not embedded in this bounded summary; no turn/proof display-omission counts are necessary when there is no per-turn/proof display list. Partition omissions remain exact.

All dynamic text, including reasons and shapes, must use `htmlText`/`evidenceTable`; all numbers use the existing nullable numeric helper. No raw HTML cell, script, external asset or serialized analysis JSON. The existing skip link, focusable captioned table region, anchor checks and CSP remain intact.

## 4. Bounds

- Store and source summary permit4096 events,4096 turns,4096 usage rows,8192 observations and8192 diagnostics per source. Metric rows are individually at most64KiB; total metric payload at most16MiB. Events have a separate16MiB bound. Source read validates recorded versus actual cardinality/bytes before payload consumption (`src/db/source-metric-validation.ts:14-17,178-193`; `src/db/source-store.ts:294-358`; `src/analysis/source-summary.ts:98-103`).
- The report operates on one source, not the scan's64-source discovery population. At most4096 admitted turns means at most4096 Active Time partitions; unique admitted proof observation count cannot exceed8192 in validated input.
- Existing unified guard permits4096 event IDs,12288 session IDs (events+usage+turns upper sum), and48 timeline rows (`src/report/unified-page.ts:26-28`). Existing turn-session collection covers maximum turn-only sources without expanding it.
- Existing `htmlText` rejects individual text over4096 characters; `evidencePage` enforces **1,048,576 UTF-8 bytes** on the final combined report after escaping (`src/report/evidence-page.ts:11-20,62-67`). An over-limit page must fail with `REPORT_LIMIT`, never silently truncate the native DTO or unrelated sections.
- Twelve partition rows plus finite native reason/context tables are a modest additive presentation, but no actual candidate output size or performance claim has been measured here. Required stress verification includes a full combined page, not only a standalone Active Time section.

## 5. Concrete falsifiable controls for the developer

These are proposed verification, not executed results. Existing fixtures/test contracts supply independent expected values.

### Native equality, normal cases and geometry

- First, a pre-feature gap control should demonstrate that immutable PR154 has no Active Time member/anchor. Keep this separate from product-regression PASS claims.
- Assert full native deep equality with direct `analyzeSourceActiveTime(source)`, exactly one direct analyzer call, input/model immutability, and unchanged full results for summary, patterns, exploration, Slow Tool, commands, failures, recovery/retry and read/search domains.
- Existing `active-time-fixture.ts:35-40` wall records overlap0–10s and5–15s: union15000/span15000, two turns and two ordinary terminal proofs, despite each independent recorded duration8150ms.
- Existing paired fixture0–10s,5–15s and cancelled100–110s: union25000/span110000, three turns, cancelled membership retained, six earlier-pending/terminal proofs. Native late-start replay retains10000/10000 and three proof IDs (`source-active-time-integration.test.ts:20-34`).
- Identical0–10s twice:10000/10000; adjacent0–10s+10–20s:20000/20000; genuine zero100–100ms:0/0; gap0–10s+100–110s:20000/110000; nested+gap0–10s/1–2s/30–35s:15000/35000 (`source-active-time.test.ts:11-28`).
- Separate wall/paired scopes and an additional session produce three independent rows with no total, including turn-only sessions absent from events.
- Unsafe individual interval[-8e15,8e15] and two disjoint5e15 intervals retain admitted turn/proof membership but null union/span; two1000ms intervals near opposite extremes retain union2000 and span null. Reasons must be independently visible (`source-active-time.test.ts:30-38`).

### Negative and state controls

- Available empty, all excluded, partial with eligible+pending, partial-shape only, and partial-shape+excluded. Check assessment precedence and exact full reasons, not just absence of a value.
- Source unavailable, evidence absent/events-only, stateLimited, dropped diagnostics, ambiguousRecords, ambiguous observation origin. Preserve nonzero stored inventory with null Active Time populations and no fake `shown=0/0` partition list.
- Actual ordinary Claude2/3/4 including duration-only records remains unsupported; actual Codex1/2/3 matches native analysis. A matching future4 and header/capability mismatches remain unsupported rather than relabeled.
- Pending/unknown status; missing/unknown/estimated/inconsistent boundaries; missing terminal, wrong terminal reference, nonordinary/non-turn/unknown terminal evidence, contradictory status, and paired pending absent/too late. For persisted controls use store-valid shapes; invalid timestamps should be tested at their valid boundary rather than weakening store validation (`source-active-time-integration.test.ts:53-67`).
- All eight envelope mismatch fields fail at both composition and rendering. Missing shared session alias in an omitted partition also fails. No fallback persistent identity is allowed.

### Whole-population-before-cap and privacy

- Use at least13 partitions with the last native-order partition overflowing; verify full arithmetic reason count remains1 after only12 rows display. Use an excluded turn outside any displayed admitted rows; its primary-reason count remains present. Use20 partitions to verify shown12/20, omitted8 exactly.
- For a large one-session partition with more than12 admitted turns and proof observations, the single displayed partition still reports complete turn/proof counts and full union/span. There is no per-turn clipping of its arithmetic.
- Validated4096-turn/8192-proof `maximumSource()` with4096 turn-only sessions: preserve all native partitions/proofs internally, show12/4096 and omit4084, no identity leakage and combined HTML under1MiB. Add the existing unsafe-interval variant and a one-session maximum membership variant. Distinguish persisted-cardinality stress from an ordinary native4096-stream support claim.
- Keep original exploration32 renderer/model controls and its five maximum populations. Add Active Time to maximum combined-source rendering and explicit final-page-limit refusal; do not infer combined safety from the section's own small size.
- Assert no source/session/turn/observation IDs, raw refs, source paths, FICTITIOUS sentinels or hidden JSON. Hostile reason/limitation text escapes; over4096-character text and escaped final-byte overflow reject. Check unique anchors, all links/captions, no script/assets and exact CSP style hash. Reverse input turn/observation arrays and compare deterministic HTML.

### Stored/fresh, legacy and installed flows

- Parameterize actual ordinary/timing/pattern capture (Codex1/2/3) across wall and paired examples. Check one read in a read-only transaction and one Active Time invocation after raw input deletion. Database/key names, modes and bytes remain unchanged; HTML mode remains0600.
- Compare fresh `report --unified --provider ... --input ...` with stored raw-deleted unified HTML from the exact generation and with existing `stats --active-time --json`. In fresh results read `result.report`, not a guessed top-level publication field. Preserve ordinary versus partial scan exit status; no capture-mode upgrade is implicit.
- Actual Claude2/3/4 fresh/stored controls retain unsupported Active Time while preserving PR154's nonempty exploration section. Codex shows qualified Active Time alongside the unchanged unsupported exploration result. These are useful cross-domain non-regression controls.
- Absent/false unified report remains byte-identical to the genuine PR154 predecessor and does not call Active Time. Verify existing version/help, native stats/insights/patterns output, default reports, active JSON/human, source DB/key bytes and selected pre-I/O invalid-argument paths. New flag/help/diagnostic changes are neither needed nor allowed.
- Preserve revision mismatch refusal before publication, output collision/no overwrite, private output and retained publication/opener controls. Existing writer/fresh/open code must remain unchanged.
- Use an actual scripts-disabled installed artifact outside the source tree. Verify `dist/report/active-time-section.js` is included and built/installed result/HTML/active JSON agree across providers/captures. The existing installer witness resolves `<prefix>/lib/node_modules/<package-name>/dist/agentprof.cjs`, not an assumed top-level JS script (`tests/exploration-report-cli.test.ts:82-104`).

## 6. Baseline and qualification cautions

The immediate presentation predecessor for this new connection is **PR154 at596bd084**, including exploration; main-d1 alone is too old to prove its preservation. Preserve a genuine preceding compiled artifact before the candidate build. The build script removes/recreates `dist` (`scripts/build.mjs:5-11`), so a path that later points to rebuilt candidate output is not an immutable baseline.

`AGENTPROF_ACTIVE_TIME_BASELINE_BINARY` in the historical Active Time suite has an intentionally older immediate-PR57 horizon (`tests/cli-active-time.test.ts`). Do not set that old contract variable to PR154 or weaken its literal help expectations. Use a separately named new-test baseline input/receipt for the new connection. Genuine schema5 and older optional horizons also remain distinct.

`docs/P6-EXPLORATION-REPORT-VERIFY.md` records42 new exploration report cases and the author's historical local receipts. Its local package installation used a pinned loopback registry; that is explicitly not ordinary-registry qualification. Its browser controls used actual HTML via `page.set_content` after file-scheme administrator refusal, not successful `file://` opening. Those inherited caveats must not become newly claimed passes here.

The coordinator retains complete review, common full/schema5/package/actual-install gates, immutable source/security/latest-main integration and merge/publication ownership. Focused development results should report FAIL/SKIP/NOT RUN separately. No duplicate heavy gate is requested by this source-only research.

## Remaining decisions / blockers

1. Review/adopt the minimal count-only section and additive internal version-envelope checks before code. These fit the three proposed report production paths; no shared helper/style/CLI/analyzer edit is necessary.
2. Register/read back one narrow issue under7 and separate developer ownership before implementation. Preserve PR154 and issue5/PR153 reservations/dependency gates; do not infer upstream merge from released implementation ownership.
3. No source-level technical blocker was found for this bounded connection. Implementation, runtime/browser verification, immediate-predecessor build availability and final integration are not established by source review.

+
+## Separate maintainer receipt/source FINDINGS — 2026-10-04
+
+Separately registered /root/directory153_research completed precise research after SPEC68629fa782a2f40e16d85f53e33f1df1601f531d and returned ALL161 research reservations. Frozen initial719 cases contain717PASS/2FAIL/0SKIP; Codex and Claude genuine-generation cases actually stop at nav111. The new103 cases all pass including true report predecessor and actual installed inputs. Row/full-section/whole remaining comparisons were not reached in those two failing cases; their exact three-region boundaries are source-backed until developer replay. No researcher runtime was performed.
+
+Required order: independently verify the sole new nav insertion, native assessment row and whole native section, including full direct unchanged native/source8context, complete population/proof/arithmetic/exclusions/capability/session-alias/12-detail/unknown-zero/union-span/limitations/privacy/bounds grammar. Then remove only these validated additions into a fresh local Buffer for the unchanged four-Exploration comparator. Do not call the new renderer/model builder to construct expected regions. Keep each original raw HTML Buffer/CLI receipt unchanged; own byte fields refer to original raw length before the sole prior verified publication-byte adjustment.
+
+All old rejection vectors remain. One source-confirmed anchor needs a narrow change: wrong-native-assessment must mutate only the returned Exploration section, since the first global Assessment literal may now belong to earlier Active Time. Preserve its name/non-noop/rejection and prove Active Time stays exact. Other old nav/row/section/threshold/population/privacy/notices/head anchors remain meaningful. Native analyzer SHA2564fe9533adc5db2aaaf521d14184e51914226805ffa39ac2b565fdacbce56d907 is identical at actual163/original164/SPEC; no new JSON/schema/admission/native alias is needed. Completed private FINDINGS JSON SHA256655839cd9116e1d3fdbf78866b49c240d2b9f075031d4cdb2fde859140edba37 records exact grammar/vector groups and original immutable receipt hashes.
+