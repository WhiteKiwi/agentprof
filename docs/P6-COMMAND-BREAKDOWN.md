# Pending P6 planning recovery handoff

Recovery copy written with root authorization on 2026-10-02. **Project claim NOT saved. No production GO.** This is a scratch proposal, not a claimed repository document or executed test receipt.

The full original planning text is preserved below. The coordinator must save/reload the bounded P6 planning claim before resuming repository-document edits. Production, tests, dependencies and browser work remain paused.

## Final design clarifications

1. Use internal `agentprof.source-report/v2` for the additive command-breakdown model. Public CLI `agentprof.cli/v1` report receipts are unchanged; no persisted migration.
2. Source-level group/call row totals cover eligible detail partitions only. Display the number of unavailable partitions separately; unavailable data must not look like zero or ordinary display omissions. Time denominators remain partition-local.

## Original retained full proposal

# P6 native command breakdown contract and test plan

Draft for coordinator and independent review, 2026-10-02. Planning only; no implementation, new test execution, browser qualification, publication or broad P6 completion is asserted.

## Product outcome and exact current gap

Current main `063ee04b37e97616065254c9534f430bdc33e3c3` (tree `ce44659dfa117c2009e9541c07af6fb9a6796fd3`) already renders compatible summary-duration tables, p50/p95 and horizontal bars. Those bars are scaled against the largest **shown summary cohort**, so they deliberately do not answer a time-share question. Native SlowTool cards show an exact admitted-duration fraction only for cohorts satisfying both n >= 5 and G/D >= 0.2. The model removes event-ID arrays and has no single-invocation list.

Consequently, a synthetic workload of five 4 ms test calls and one 80 ms build displays the test candidate's 20/100 share but has no native build-share row or 80 ms single-call detail. The summary shows a build total, yet its broader eligibility must not be divided by the stricter native denominator. This successor supplies the missing complete-within-admitted-subset command breakdown, without broadening analyzer admission or calling a slow command waste.

User-facing result within each already selected compatible partition:

1. A native command/tool group table, ordered by recorded duration, with safe pattern/family, category, call count, exact summed milliseconds, and compatible G/D fraction plus a horizontal 0–100% bar. Cohorts below the diagnostic threshold remain visible and are not labeled findings.
2. A bounded “Slowest recorded calls” table, ordered by individual duration, with safe pattern/tool/category, terminal status and exact milliseconds. Native details disclose the session/partition, timing evidence and share denominator. Repeated same-pattern invocations remain separate.
3. Explicit unavailable/API/session-time explanation and display-omission counts. Existing source coverage, summary tables, usage and unchanged SlowTool cards remain available.

A single source-prefix report is still not complete session/history coverage. This is a useful report feature, not a QA-only phase or a local web server.

## Source evidence inspected

Nineteen relevant source/document/test/package blobs were fetched at the exact main commit and their returned blob IDs matched the complete 209-file tree (not truncated). No .agents skills exist in that tree. Read AGENTS, SPEC, IMPLEMENTATION, TODO, METRICS and the maintained PR35 contract before this proposal.

- `src/report/render.ts`: existing duration bars use sum / maximum shown sum, and native candidate cards expose their own copied admitted denominator.
- `src/report/source-model.ts`: six sessions, four partitions per session, ten known and ten unknown summary groups, ten total cards; model is owned/frozen/allowlisted and event IDs become counts.
- `src/analysis/source-summary.ts`: duration grouping does not include kind and its eligibility is intentionally broader than native SlowTool. It cannot supply a blindly interchangeable numerator.
- `src/analysis/source-slow-tool.ts`: partition grouping is (sessionId, durationScope, timingEvidence); cohort grouping is (kind, category, toolName, commandPattern). The analyzer sums in deterministic event-ID order. Its partition eventIds include tentative rows for identity_unresolved, so merely being listed is not admission.
- `src/cli/report.ts`: one selected readSource and one unchanged call to each analyzer within the same pinned read-only transaction, then rendering/publication after close.
- `src/analysis/source-invocation-overlap.ts`: existing separate CLI analysis reports positioned Claude interval sum/union/excess. Excess is multiplicity-weighted overlap, not concurrent wall time. This successor does not invoke or reinterpret it.
- `tests/cli-report.test.ts`: real ordinary raw-provider -> scan -> reopened store -> raw-input deletion already supplies the six-call 20/100 fixture; canonical realpath(tmpdir()) preserves the reviewed macOS fixture fix.

The latest inspected main retains the SlowTool parser-version-1 gate. The separately owned Claude-search candidate adds only reviewed version admission for Claude1/2 and Codex1 with exact source/capability agreement. The search developer explicitly confirmed no report production/test reservation or metric/threshold/schema/status/format change. This report must consume whichever analyzer result is actually integrated; no report-owned version exception is permitted.

Local ObsDog integration and its personal-scope skill are unavailable here. No capture, sync or external memory write is asserted.

## Ownership and scope

Project P6: https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833122

Coordinator session `01a0f1a1-4048-72ae-a185-e8a3f98ba008`; planning contributor `/root/plan_prof_command_breakdown`; proposed branch `feat/source-command-breakdown`; isolated planning directory `agentprof-command-breakdown-plan`. Live ownership remains only in the Project item. A separate developer is required after accepted plan, independent review, saved exact activation/readback and coordinator GO.

The P6 live 11:08 PR35 closeout explicitly released the original implementation, two-test macOS correction and three-doc review reservations. Preserve its original identities, historical failed/NOT RUN records, full macOS receipts and two unchecked broad acceptance gates. P4 broad history is preserved. Codex checkpoint, Claude DB/scanner resume and Claude search reservations remain independent.

Proposed exact thirteen-path maximum, not production permission:

- `src/cli/report.ts`
- new `src/report/command-breakdown.ts`
- `src/report/source-model.ts`
- `src/report/render.ts`
- `src/report/styles.ts`
- new `tests/source-report-command-breakdown.test.ts`
- new `tests/source-report-command-breakdown-cli.test.ts`
- `tests/source-report-model.test.ts`
- `tests/source-report-render.test.ts`
- new `docs/P6-COMMAND-BREAKDOWN.md`
- `docs/SPEC.md`, unique EOF section only
- `docs/IMPLEMENTATION.md`, unique EOF section only
- `docs/FINDINGS.md`, unique EOF section only

At planning time only the new contract document is reserved for editing. Shared appends are proposed verbatim below for coordinator integration. No inherited document content is replaced. In particular `docs/P6-SOURCE-REPORT.md`, both macOS-corrected CLI test files, `report/**`, design/assets, package/lock/workflows and the output writer remain unchanged.

Excluded: parser/normalization/database/schema/scanner/analysis/privacy implementation, additional diagnostics, interval aggregation/timeline, new flags/automatic scan/open/server, API spans or LLM-gap inference, global totals/readiness promotion, raw logs and publication/release/deployment. Changes outside these paths require a new coordinated amendment.

## Admission and denominator contract

The new internal helper consumes exactly the same validated StoredSource object and already computed SourceSlowToolAnalysis; it must never call the analyzer again. Source/provider/revision/completedOffset/observedSize/availability/persistedScope and parser/normalization/key contract fields must agree. It remains an internal projection, not an arbitrary JSON/Proxy validator or public metric API.

For each actual SlowTool partition:

- Only `evaluated` and `zero_denominator` are eligible for detailed projection. `identity_unresolved`, `numeric_overflow`, source suppression and missing partitions remain explicit unavailable states with no fabricated empty group/call arrays or share.
- Build an event-ID index from bounded validated source.events. Check every admitted reference exists exactly once, matches the partition tuple, is unique in the partition and not duplicated across partitions, and that its row count agrees with denominatorN. Fail a contradictory joined input with the existing safe error, rather than silently omitting it or repairing the denominator.
- As an internal consistency assertion, checked-add all referenced durations in lexical event-ID order and require exact equality to the unchanged denominatorSumMs. This is not a replacement denominator. Copy the analyzer's original N and D into the display model.
- Do not reimplement native-kind eligibility, provenance, parser-version rules, source suppression or thresholds. In particular no Summary event is admitted solely because it has a duration.
- Use the same exact group tuple (kind, category, toolName, commandPattern), including explicit nulls. Group over **all** admitted IDs before display bounds, retaining distinct groups when safe display placeholders happen to collide.
- G is the checked sum of a group's referenced stored durationMs in lexical event-ID order, with the existing finite/nonnegative/MAX_SAFE_INTEGER and overflow behavior. n counts those unique native records. Shares use ordinary IEEE-754 G/D when D > 0, never epsilon/rounded comparisons.
- A recorded zero denominator remains D=0 with known n and known zero group durations; share is null and no percentage mark is drawn. Known zero G within a positive D is 0%, not unknown.
- Fail unexpected unsafe/inconsistent arithmetic rather than clamping it into a valid share. No subtraction-based “other” remainder is needed.
- Do not demand that separately rounded group totals or percentages sum bit-exactly to D/100: regrouping floating-point additions can differ. Group sums follow analyzer order; D stays original. Horizontal independent bars avoid a false stacked-composition invariant.

The native subset can include completed or failed calls. Counts and durations are observed native records, not proof of physical execution identity, semantic same-operation equivalence or complete provider coverage. Coarse MCP/browser family rows do not name endpoints or identical operations.

## Timing and claim boundaries

The percentage label is “Share of admitted compatible recorded duration,” never “share of worktime.” Exact table evidence includes G ms / D ms and denominator N calls. Preserve the same session, source/provider/generation, durationScope and timingEvidence. Never pool sessions, process_runtime, invocation_latency, item_lifecycle, source_reported and paired_timestamps.

Summed tool duration can exceed elapsed wall time when calls overlap. Paired invocation latency can include waiting and is not CPU runtime. Neither duration sum nor interval union establishes session wall elapsed, Active Time, API backend/network latency, critical path or savings. The selected byte prefix does not provide complete task/session boundaries.

No first/last-log-span denominator is introduced. LLM gaps are not API request/response measurements. The report states that API/network share and complete-session worktime share are unavailable from this view; it never shows 0% as a substitute. Actual API share needs separately captured compatible request-start/response-end spans and a justified enclosing work interval in a future input contract.

Existing invocation-overlap CLI evidence stays separate. If discussed in help text, sum/union/excess and multiplicity-weighted excess are distinguished; no new overlap number is derived in this slice. No “all calls are non-overlapping” assumption is used.

## Selection and model bounds

Retain existing six-session/four-partition deterministic selection without changing its union or order. Only native partitions whose existing session/partition context is retained can produce rows. A source-level native group/call summary counts omissions caused by parent bounds as well as row bounds; it must not promote unavailable totals to zero.

Within each retained eligible partition:

- Compute all groups from at most 4096 stored events, then order by G descending, n descending, original group tuple lexical. Show at most ten.
- Order individual admitted calls by durationMs descending, then event ID lexical. Show at most ten. A call can belong to a non-displayed group; it carries its own safe labels and links to the retained partition, not a missing row.
- Represent group and call total/shown/omitted separately. Denominator N/D is invariant under every display cap. Unknown/unavailable details are null/state-qualified; they are not “omitted by display bounds.”
- Assign generated deterministic call/group anchor IDs after selection; do not serialize raw event IDs, sourceRef, observations, timestamps, argv, paths, output or hidden JSON. “Call 1” is a report-local display alias, not a durable event identity.
- Existing safe-pattern 512 UTF-8-byte bound and overlong-pattern fixed substitution remain. Original keys determine grouping/order before substitution; two substituted labels do not merge.
- Maximum new rendered groups 6*4*10=240, calls 240, partitions24; the input helper is bounded by4096 events/4096 partition references and existing analyzer limits. Reject repeated references, unexpected model keys/accessors and oversized arrays before output.
- Keep exact raw milliseconds/fractions in data text. Visual percentages may round to one decimal with explicit small-value notation; rounding never feeds sorting, arithmetic or diagnostic decisions.
- Final escaped HTML still <=1MiB before file creation. Normal worst-case structural models must be tested; adversarial text expansion may safely return existing REPORT_LIMIT.

Do not modify original Summary statistics, usage components/finality, SlowTool candidates, thresholds, evidence counts, safeguards or output receipt fields. Add a bounded command-breakdown projection to the owned model and validate it through the same closed-field discipline. Internal model version treatment must be explicit before implementation; the model is not persisted or a public CLI JSON contract, but accidental unreviewed shape changes must be rejected.

## Static visual design

Use existing semantic colors, system fonts, spacing, responsive panels, light/dark and print rules. Add no dependencies, scripts, assets, local server or dynamic style attributes.

Each group row pairs an actual semantic table with a numeric SVG horizontal bar on a fixed 0–100 share scale. Accessible text states exact numerator, denominator, n and scope/evidence. Show a long one-off build beside repeated small test calls even when neither/both are SlowTool candidates. Existing relative-summary bars retain their distinct caption; native share bars must not be confused with them.

Single-call details use native details/summary and generated in-document links. All controls remain >=44px; keyboard focus visible, anchors unique/resolving. Unknown produces text, no zero-length ghost bar. Print should expose useful table/evidence content without requiring JavaScript.

Keep the existing strict CSP with the hash of actual static CSS bytes, no unsafe-inline, scripts/network requests, external URLs/fonts/forms/frames, input paths, raw user data or hidden payload. Escaping is mandatory in all text and attribute contexts.

The existing browser file:// denial is a real unexecuted qualification boundary, not a reason to create an unrequested server or bypass policy. Browser visual, runtime-CSP, 320/390/1440, keyboard, print, no-JS and offline checks need authorized supported execution; static tests cannot mark them passed.

## Independent fixture and test matrix (all NOT RUN)

No existing fixture bytes are changed. Raw fixtures are synthetic and inert. Canonicalize the temporary parent with realpath(tmpdir()), preserving the macOS production guard and earlier correction.

A. Arithmetic and membership

1. Ordinary raw Codex session_meta + six CommandExecution completion records: five npm-test calls at4ms, one cargo-build call at80ms. After real scan/store reopen/input deletion, expect D100/N6; build n1/G80/share0.8; tests n5/G20/share0.2. Both group rows appear, only the five-call group is an unchanged SlowTool candidate. First individual row is80ms.
2. Ordinary paired Claude assistant tool_use/user tool_result records produce the same4/80ms values in invocation_latency/paired_timestamps. Source-reported synthetic Claude and native Codex runtime remain separate contracts; do not use trustedFixtureContext.
3. Add below-threshold and zero-duration cohorts: all admitted groups are counted, regardless of diagnostic thresholds; D remains full, zero G gets0 when D>0. All-zero partition retains counts/sums with null shares.
4. Identical safe patterns in different kind/category tuples remain distinct. Null pattern/family and overlong substitution collisions remain separate, bounded and deterministic.
5. Confirmed failed native call contributes under unchanged SlowTool admission; pending/cancelled/unknown/missing-duration/estimated rows do not.
6. Missing/contradictory provenance for one otherwise eligible row suppresses the whole native partition. Summary may still show a duration; no native group is synthesized from it.
7. Unavailable/evidence-absent/ambiguous/state-limited/unsupported-contract/unresolved-wrapper source suppressions remain exact. Numeric-overflow partition emits unavailable breakdown, never0 or a fabricated remainder.
8. Two sessions and multiple compatible scope/evidence partitions never pool or rank together. Denominator references stay local.
9. Fractional durations, event-order permutations and IEEE reassociation cases preserve analyzer-order G and copied D; no rounded-value threshold/composition assertion.
10. Contradictory generation/partition IDs, missing/duplicate IDs, wrong tuple, mismatched counts/sum or unsupported values reject safely without writing output.

B. Bounds and privacy

11. Seven sessions/five timing partitions/eleven command groups/eleven calls exercise each parent and local omission independently; totals, shown, omitted and unchanged D/N are asserted.
12. Exact maximum selected structure renders within cap under ordinary bounded labels; overlong escaped-content expansion yields REPORT_LIMIT before output. No swallowed guard paragraph.
13. Stable ties use documented lexical keys/event IDs; input permutation gives byte-identical HTML and does not mutate/freeze borrowed source/analyzer objects.
14. Sentinel prompt/output/raw command path, tags/script text, sourceRef/key material/event IDs and extra/accessor fields never enter projection/HTML; getters are never invoked by owned-model validation.
15. Hidden group/source/session context cannot leave a dangling call link. All generated anchors are unique and report-local.

C. Integration and qualification

16. Spy on actual CLI pipeline: one readSource, one summarizeSource and one analyzeSourceSlowTool, same source object and one pinned transaction; no raw-root read/rescan/reopen. The helper does no I/O.
17. Before/after hashes, modes and directory entries of DB/key remain identical. New reports deterministic; no-overwrite0600 publication and truthful postlink receipt contracts remain inherited and pass unchanged tests.
18. Existing stats/insights/help/report receipt stdout/stderr/status remain unchanged. Report HTML intentionally gains the section; unchanged Summary/SlowTool serialized values are compared against baseline.
19. Script-disabled packed/current installed report produces the feature from real stored synthetic input after input removal. Installed runtime bytes/modes match frozen current build. Optional binary-dependent cases and skips remain separately reported.
20. After Claude-search integration, historical Claude1, admitted Claude2 and Codex1 use actual analyzer behavior. Before integration parser2 stays unsupported_contract. Report code contains no independent version-admission rule.
21. Full typecheck/build/tests/artifact and independent all-file review run only in coordinator-scheduled resource slot, one worker/512MiB heap. Existing failure/NOT RUN receipts remain preserved; no new test runs during planning.
22. Authorized browser rendering verifies numeric SVG under actual CSP, viewport320/390/1440, light/dark, keyboard/details/links, print, noJS and offline requests. If unavailable record NOT RUN, never a static PASS.

## Implementation sequence and Verify

1. Review/freeze this contract, exact ownership, interface, model version and independent expected values before production. Verify: saved Project claim/readback, no overlap, full fresh-main preservation, coordinator GO and separately named developer. No suite has run at planning time.
2. Author the independent helper/model/renderer/real-ingest integration tests in the reserved paths before implementing. Verify: distinguish expected missing-feature red from fixture/parser incompatibility; protect original fixture bytes and independent arithmetic.
3. Add the bounded report projection, wire it to the existing pinned source/analyzer result, and render static share/call tables. Verify: no analyzer/provenance/threshold changes, exact denominator and state contracts, stable omissions/privacy/CSP/bytes.
4. Complete focused/full/installed/browser qualification and independent final all-file review. Verify: actual results and skips/NOT RUN boundaries, exact13-path maximum and unchanged other tracked blobs/modes, frozen publication manifest. Parent owns any later draft PR and exact-head CI; implementation permission does not imply merge/release/deploy.

## Proposed root-owned shared EOF additions

These are text proposals, not edits already made.

### SPEC: Native command breakdown in source reports (bounded P6 successor)

The planned source-report successor adds compatible native command/tool duration-share bars and bounded slowest single-call details to the existing stored-generation report. Every admitted group can appear, including one-off builds and groups below SlowTool diagnostic thresholds. The exact admission, denominator, omission and privacy contract is in [P6-COMMAND-BREAKDOWN](P6-COMMAND-BREAKDOWN.md). Shares compare recorded durations only within one admitted source/session/scope/evidence partition; they do not measure full worktime, API/network latency, interval occupancy, avoidable work or savings. Unknown and unavailable remain distinct from0. Existing summary, usage, analyzer semantics and safe output publication remain unchanged.

### IMPLEMENTATION: P6 native command breakdown — reviewed slice

A separate developer may implement [P6-COMMAND-BREAKDOWN](P6-COMMAND-BREAKDOWN.md) only after coordinator/independent plan review and saved exact claim activation. The report helper joins the same pinned source to unchanged SlowTool membership for evaluated/zero_denominator partitions, copies full N/D before display limits, computes ordered safe group numerators and presents at most ten groups/ten calls per retained partition. Verify raw-provider/reopened-store arithmetic, strict state/ID consistency, exact omissions/privacy/CSP, existing CLI parity and separately qualified installed/browser execution. No analyzer-version, parser/storage, local-server, worktime/API or broad-P6 completion scope is added.

### FINDINGS: 2026-10-02 native command breakdown evidence

Source inspection at063ee04b/treece44659 shows existing summary bars scale to the maximum shown cohort, while native shares appear only on threshold-qualified SlowTool cards. Broader Summary cohorts and native denominators are not interchangeable. A six-call synthetic design (five4ms test calls and one80ms build) provides a decisive planned oracle: D100/N6, build80% with n1, tests20% with n5. No new test was run during this planning inspection. SlowTool's unresolved partitions retain tentative IDs, requiring an explicit evaluated/zero-denominator gate. API request/response spans and complete session task boundaries are absent from this report projection; LLM gaps cannot supply them. The separately owned Claude-search version admission is consumed without report-owned analyzer edits.

## Planning verification receipt

- Exact GitHub main ref rechecked at2026-10-02 11:32 UTC:063ee04b37e97616065254c9534f430bdc33e3c3; open-PR search returned none.
- Exact tree:209 tracked blobs, no truncation;19 fetched inspection blobs match.
- P6/P4/Codex/resume live claims read; Search developer confirmed current exact boundary after its page hit browser timeouts. Root owns serial Project writes. No claim-save success is asserted until root supplies its verified readback.
- No production/test/dependency edit, test/build execution, installation, Work/Codex task launch, new worker, commit, PR, merge or deployment.
- Read-only source inspection is evidence for the feature gap and feasibility, not an implementation or browser acceptance pass.

## Planning resumed after verified claim — 2026-10-02 11:47 UTC

The coordinator reports actual saved/reloaded raw-exact P6 claim verification at11:45 UTC, token `p6-command-breakdown-20261002-1129`, preserving the20,410-character prior body in the23,360-character updated body. The effective reservation is only this new planning document; the thirteen-path proposal is not production permission. This receipt supersedes the earlier recovery-header statement that the Project claim had not been saved. The original25,584-byte recovery proposal remains unchanged in its recovery location with SHA256 `d590a70b2f9213c67325e3abdff344b7338280ea3f8f20f24cd4e006a7799636`.

Planning uses the coordinator's209-file verified `agentprof-search-recovery-base` at063ee04b/treece44659 read-only. New private `.test.ts.proposed` artifacts under this planning directory are test designs, not repository test edits or execution. No installation or duplicate dependency/source recovery is requested. A separate independent reviewer and production developer remain coordinator-assigned.

### Concrete internal interface for review

Freeze `buildSourceCommandBreakdown(source: StoredSource, slow: SourceSlowToolAnalysis)` in the proposed new report helper. It returns an owned/deep-frozen `agentprof.source-command-breakdown/v1` object with copied header fields `sourceId`, `provider`, `parserVersion`, `normalizationVersion`, `keyVersion`, `revision`, `completedOffset`, `observedSize`, `persistedScope`, `availability`; copied `assessment` and `suppressionReason`; explicit `state`; and all original SlowTool partitions in their original order. No analyzer invocation occurs inside it.

Each helper partition copies `id`, `sessionId`, `durationScope`, `timingEvidence`, `status`, `denominatorN`, `denominatorSumMs`; `groups` and `calls` are null for unavailable partition states. Eligible partitions expose:

- group rows `{ordinal, group:{kind,category,toolName,commandPattern}, n, sumMs, share}`. Sort all groups by sum descending, n descending, original JSON tuple lexical; assign1-based ordinal after sorting. `share` is G/D or null for D0.
- call rows `{ordinal, groupOrdinal, group:{kind,category,toolName,commandPattern}, status, durationMs}`. Assign1-based call ordinal in lexical event-ID order first, then sort rows by duration descending and original ordinal ascending. This gives deterministic ties without serializing an event ID. A group's ordinal refers to the full helper group set; the final renderer links only to retained anchors, otherwise to its partition.
- Internal ordinals above are stable tie/alias keys assigned before selection. DOM IDs are separately generated after selection, as the original visual contract requires. The first displayed slowest row has visible rank1 even when its stable report-local alias is Call6 or Call21; ordinal is never misrepresented as rank.

No event-ID array, private observation, timestamp or raw path crosses the helper output boundary. Header/tuple/count/member uniqueness and exact event-ID-order denominator consistency guards reject `INVALID_RECORD`; structural resource caps use the existing `REPORT_LIMIT`. These are internal consistency guards, not new provenance admission. Check source.events and total partition memberships before allocation; each must be <=4096, and source partitions <=4096. No silent truncation precedes admission/grouping.

The model's internal schema becomes `agentprof.source-report/v2`. `buildSourceReportModel(summary, slow, breakdown)` takes the required third input from this same pinned generation. Its `commandBreakdown` object has the helper header/state/assessment plus bounded **contexts**, one for every already selected Summary/native tuple, and `selection` as typed below. Contexts use the existing tuple-to-DOM-anchor map; SlowTool partition.id is never used as the display anchor by coincidence. Source group/call totals cover **eligible detail partitions only**; display that caption and unavailable-partition count. Under source suppression, assessment/reason remains decisive even if the analyzer has no partition. No count is a coverage fraction. Helper groups/calls are not a public or persisted format.

The following additional exact internal types complete the field contract; the group/call shapes above and copied header are unchanged:

```ts
type DetailState = "suppressed" | "no_native_partitions" | "details_available" | "details_partial" | "details_unavailable";
type ContextState = "source_suppressed" | "no_native_partition" | "evaluated" | "zero_denominator" | "identity_unresolved" | "numeric_overflow";
type BreakdownContext = Readonly<{
  displayPartitionId: string; // exact existing tuple map, e.g. partition-2
  nativePartitionId: string | null; // analyzer identity, not a DOM target
  sessionId: string; durationScope: DurationScope; timingEvidence: TimingEvidence;
  state: ContextState; denominatorN: number | null; denominatorSumMs: number | null;
  groups: readonly NativeCommandGroup[] | null;
  calls: readonly NativeCommandCall[] | null;
  counts: Readonly<{ groups: Count | null; calls: Count | null }>;
}>;
type BreakdownSelection = Readonly<{
  eligiblePartitions: Count | null;
  unavailablePartitions: Count | null;
  missingNativeContexts: Count | null;
  groups: Count | null; calls: Count | null;
  totalsScope: "eligible_detail_partitions_only";
}>;
```

State/count truth table:

- `suppressed`: copied source suppression is nonnull; helper partition array remains actual analyzer array (normally empty); all five selection Count values are null. Existing selected contexts are `source_suppressed`, with nativePartitionId/denominators/rows/counts null. Do not display native zero findings.
- `no_native_partitions`: source is unsuppressed and analyzer partition array is empty; eligible/unavailable/groups/calls counts are known zero. `missingNativeContexts` counts actual summary-only tuple contexts, including parent omissions. Existing contexts are `no_native_partition`, with rows/counts/denominators null. This says the native analyzer returned no eligible partition, not that recorded summary work had zero duration.
- `details_available`: at least one evaluated/zero partition and no unavailable native partition. Selection totals use all eligible helper groups/calls, then apply display bounds. Actual summary-only contexts remain separate and never contribute native rows/counts.
- `details_partial`: at least one eligible detail partition and at least one identity-unresolved/overflow native partition. Groups/calls Count values cover only the eligible partitions. Unavailable partitions have null detail rows/counts; they are not omitted group/call rows.
- `details_unavailable`: native partitions exist but none is eligible for details. Eligible-partition count is known zero; unavailable-partition count is known. Source group/call counts are null, never known zero. Individual context states preserve the exact native reason.

For every unsuppressed state, missingNativeContexts counts the complete Summary/native tuple union entries without a native counterpart; shown/omitted follows existing parent selection. It is not part of unavailablePartitions. In a retained native context, nativePartitionId copies its actual SlowTool id, and the displayPartitionId comes from the Summary/native union. Native status is preserved as context state. Counts omitted because of session/partition/row bounds are ordinary display omissions only. The helper's state is computed from its actual returned statuses; do not use admittedTimedCalls for eligible-detail totals because that analyzer count includes numeric_overflow partitions.

Preserve existing session/partition selection; select ten helper groups and ten calls for each retained native partition. Group/call ordinals remain stable when other groups/calls are omitted. Apply safe label bounds after group identity/order is established. Same header checks prevent summary/slow/breakdown generations from being spliced. Existing two-argument model test factories are adjusted only to supply the third result; synthetic maximum-model cases must explicitly populate the new exact shape. No analyzer output field is altered.

The fixed visible table captions are `Native command duration shares · ms` and `Slowest recorded calls · ms`. Place the native share table near the start of its compatible partition before lengthy summary/diagnostic context. Its fixed0–100 scale is visible. Each row includes exact `G / D ms` and call count; zero-D displays `unknown` without a percent mark. Calls are explicitly ranked only within this compatible partition. Percent labels use one decimal place except: G0/Dpositive is `0.0%`; positive G whose percentage is below0.1, including IEEE division underflow to0, is `<0.1%`; positive share that would round to100.0 while G<D is `<100.0%`; G=D is `100.0%`. Exact ordinary-division fraction and G/D remain visible, with underflow identified as display-scale/IEEE precision, not an exact zero measurement. No minimum bar width manufactures a larger value. New generated anchors use a report-local ordinal namespace, not source identities. This is a testable static representation, not a script/data payload.

### Explicit scope refinements

- Source-level/native membership totals are counts only; never sum timing denominators across partitions.
- Missing optional installed binary skips exactly the named supplement; use existing `AGENTPROF_REPORT_INSTALLED_BINARY` rather than adding a mismatched environment variable.
- Group sums and whole-denominator sums intentionally follow their own event-ID-ordered subsequences. No stack/remaining-share figure forces rounded percentages to100.
- Private oracle drafts test real ordinary Codex and paired-Claude ingestion; they never install dependencies or run scripts from logged commands. Existing macOS fixture-parent canonicalization is retained in all new tests.
- Null commandPattern remains valid. Null toolName is an unchanged native-admission-negative case, not a native group-label case.
- A five-partition selection fixture tests the existing Summary/native union/model bounds; it must not be called five ordinary supported native timing contracts.
- The full output-ceiling oracle includes existing480 summary rows,24 usage rows and10 complete safeguard cards together with240 new groups and240 calls, state/count text and escaping; testing only the new sections is insufficient.
- Native SVGs use static class `native-share-bar` and numeric foreground rect class `native-share-value`; exact geometry at D100/G80/G20 is width80/20 in the0–100 viewBox. A maximum-relative100/25 rendering fails the oracle. The combined maximum test asserts rendered24 share tables/24 call tables and240 rows each, ten each, plus unique visible content in partition24, so silently omitting new sections cannot pass.
- Installed supplement subprocesses retain the coordinator's512MiB heap bound. Tiny baseline checks validate data/fixture arithmetic only, not browser behavior or the new feature.

### Independent review corrections incorporated — 2026-10-02 11:54 UTC

Reviewer `/root/review_prof_breakdown_plan` confirmed the feature premise and required the explicit states/types above. Additional frozen oracles: (a) Summary-only invocation/source-reported tuple precedes native process-runtime/source-reported tuple; native analyzer id partition-1 must link to actual display partition-2 and its exact tuple. (b) ten groups with two10ms calls each plus an eleventh one19ms group: D219/N21, groups11/10/1 and calls21/10/11; the19ms call ranks first while its omitted group links only to its retained partition. (c) lexical IDs a/b/c with0.1/0.2/0.3, groups A={a},B={b,c}: D0.6000000000000001, sums0.1/0.5 whose regrouped total0.6 must never replace D; shares0.16666666666666666/0.8333333333333333. (d) eligible N6/D100 plus overflow N2 and identity-unresolved tentative N2: admittedTimedCalls8 but eligible-detail calls6/groups2, two actual unavailable native partitions. (e) Number.MIN_VALUE / Number.MAX_SAFE_INTEGER underflows to0; positive raw numerator is still shown with `<0.1%`, not exact0%. These remain test designs, not executed PASS evidence.

### Concrete draft freeze before authorized tiny baseline checks — 2026-10-02 12:09 UTC

The final private helper/model/renderer draft includes the review corrections, exact positive event/metric validation, source/partition/context state tests, group and call omissions, anchor-target tuples, no inference from LLM gaps, mixed eligibility, fractional regrouping, subnormal underflow, near100 formatting and the complete old-plus-new renderer ceiling. The ordinary-provider CLI draft uses real raw Codex/paired-Claude ingestion, stored reopen, deleted input roots, independent framed source HMAC, exact20/100 expectations, immutable analyzers/store, one pinned generation and one optional current installed-artifact case.

- `proposals/source-report-command-breakdown.test.ts.proposed`: SHA256 `f335da5982f56a5c916679524b47eac23e5bcec6271a946a8baac223fe4b6b25`.
- `proposals/source-report-command-breakdown-cli.test.ts.proposed`: SHA256 `e23105ea8b2abff16b70cd083fa24b1f1684f8789720aec6130130346608e461`.
- Tiny unchanged-baseline ordinary-provider suite: SHA256 `42420f65a863c86c3286a8ac12887378a0b7033cf19822a887b8188b8d8155da`.
- Tiny unchanged-baseline membership/arithmetic suite: SHA256 `042676c3fbc70fecdaf699105556aceff904222c93d3459b3e4a33f536028fac`.

All four were NOT RUN at this freeze. Root explicitly authorized the next tiny unchanged-baseline oracle execution and expected missing-helper collection RED, using already restored pinned dependencies, one worker/512MiB. This is not production GO or permission for full/heavy checks. Any fixture correction will retain the old receipt, amend this freeze and be rerun distinctly. Final independent draft review remains required before production.

### Final candidate test freeze and executed baseline/RED receipt — 2026-10-02 12:13 UTC

The independent reviewer required nonvacuous geometry and renderer-bound assertions before final freeze. The helper draft now inspects native SVG foreground widths80/20, not just percent text; checks actual24 share tables and24 call tables with240 rendered rows each, ten per table; and verifies unique native content in the final partition. Maximum-model known summary statistics were made internally coherent. The installed test subprocess retains512MiB heap. These test-design corrections change no repository source and supersede only the two proposed-test hashes above.

- Final helper/model/render draft: `b456f25e9e1952c40c865dee86a7bdad608d89c1de34c0838a1ddcf1e7688e80`.
- Final ordinary-provider CLI/installed draft: `5f1ef90cd9d0b58b88835fa8bd6e915de43884bfe8319f68611c8bb12a29429b`.
- Baseline oracle hashes remain `042676c3fbc70fecdaf699105556aceff904222c93d3459b3e4a33f536028fac` and `42420f65a863c86c3286a8ac12887378a0b7033cf19822a887b8188b8d8155da`.

Executed on existing Linux/Node24.19.0, Vitest5.0.2, one worker/512MiB, with restored pinned dependencies and a read-only source symlink to the coordinator-verified unchanged main:

1. `vitest run tests/baseline-provider.test.ts tests/baseline-membership.test.ts --maxWorkers=1 --reporter=verbose`: PASS,2 files/6 tests/0 skips. Ordinary Codex and paired-Claude records traversed actual scan, store reopen and input deletion; exact N6/D100, five-call G20/share0.2 and one-call build G80 were observed. The four remaining checks validate positive fixture storage shape, event-ID-ordered fractional denominator, overflow/unresolved admission distinction and positive subnormal duration. Receipt: `oracle/evidence/baseline-1.log`.
2. Byte-identical copies of the final proposed feature suites were run against unchanged main. Result: EXPECTED MISSING-API RED, exit1, exactly2 collection failures for absent `../src/report/command-breakdown.js`,0 feature tests executed. Receipt: `oracle/evidence/missing-api-red-1.log`. This is not an implementation-behavior pass, full suite, compiled typecheck or installed/browser qualification.

No production file, inherited fixture, dependency, package lock, analyzer rule, shared base or shared EOF section was edited. No full/heavy gate, installation, Work/Codex launch, browser, PR, merge or release occurred. Final independent draft review and separate implementation GO remain required. Root owns Project closeout/activation and publication; the planning contributor does not claim broad P6 acceptance.

### Final reviewer fixture correction and superseding freeze — 2026-10-02 12:15 UTC

The reviewer found that an unquoted privacy sentinel containing `<script>` makes the raw synthetic npm command a complex-shell/other cohort. The historical six-oracle PASS proves arithmetic and provider/store flow, but did not prove the intended test category. Preserve that receipt. Quote only the sentinel argument in the new raw CLI/baseline fixture and assert the reopened five test-category `npm test <target>` rows plus the one build-category `cargo build` row. Inherited fixtures and production normalization remain untouched.

Also require native viewBox origin0/width100 and rect x0 as well as80/20 foreground widths; otherwise a wrong viewport can misrepresent the fraction. Use allowed `--verbose` rather than unsupported `--release` for the final-context structural marker. The earlier draft hashes remain historical. Superseding held hashes before the repeated tiny qualification:

- Helper/model/render: `3ad7098b4acf4448fbfa98894c09b586b5349343c1ffeb4ff58eb3e2e5bd578c`.
- Ordinary-provider CLI/installed: `8baef2e894430ee359d2a70636d9cf42fa61671d1eda146ca9fca9b19431e02c`.
- Corrected raw-provider baseline: `c3b1671e3723bdd22f6406ac16d50b6529cb8390f908f6ac31677d658aa3167e`.
- Membership baseline remains `042676c3fbc70fecdaf699105556aceff904222c93d3459b3e4a33f536028fac`.

No new feature behavior has executed. These are test/contract planning amendments before production GO; they do not revise analyzer semantics or hide the historical category-oracle gap.

### Final planning qualification and independent clearance — 2026-10-02 12:17 UTC

The corrected ordinary-provider fixture and unchanged membership oracle ran successfully:2 files,6 PASS,0 skips. Both real ordinary providers now prove the actual five test-category `npm test <target>` calls at4ms and one build-category `cargo build` call at80ms after scan/store reopen/raw-input deletion, with native denominator N6/D100. This supersedes the earlier fixture's unverified category description, while preserving its arithmetic-only historical result.

- `oracle/evidence/baseline-2-quoted-category.log`: SHA256 `47c3d273a2bb29d95f59884a15f19be5892f750daaefc2dd53e3b3f544cd1e08`.
- Final helper/CLI copies exactly match held proposal hashes `3ad7098b4acf4448fbfa98894c09b586b5349343c1ffeb4ff58eb3e2e5bd578c` and `8baef2e894430ee359d2a70636d9cf42fa61671d1eda146ca9fca9b19431e02c`.
- `oracle/evidence/missing-api-red-2-final.log`: SHA256 `927fe2e87261571da4afe280ca651192dda830c14a6d7524311912b82b06cc3e`. Exactly2 collection failures for the absent helper, exit1,0 new feature tests run. No test case is called passed or skipped by this missing-API result.

Independent reviewer `/root/review_prof_breakdown_plan` inspected the final held drafts and contract `00b07d3d82897a6904b4b3b3f0cfcaa28a7f5947b98eefc1e471422de2c16a40`, verified the final fixture/geometry/bound/state/anchor corrections, read both final logs, and confirmed matching executed-copy hashes. It reports no remaining precode design/test-oracle blocker. This final receipt is documentation-only and does not change reviewed contracts or frozen tests.

Planning handoff: coordinator must refresh base/claims as needed, integrate only the named shared EOF sections, save/reload the exact implementation reservation and assign a separate development contributor before explicit production GO. This planning session does not implement its own specification. Broad P6 and browser/full/installed acceptance remain open. No source code, inherited tests, dependencies or shared baseline were modified by this contributor.


## Implementation activation receipt — 2026-10-02 12:26 UTC

The separate development contributor `/root/implement_prof_command_breakdown` saved and reloaded the exact thirteen-path reservation in P6 before edits. The full prior 23,360-character Project body remains an exact prefix of the new 27,056-character body. Coordinator conditional production GO is now satisfied. The isolated implementation copy has all 209 inherited files byte-identical to verified main `063ee04b37e97616065254c9534f430bdc33e3c3`, tree `ce44659dfa117c2009e9541c07af6fb9a6796fd3`. Reviewed EOF plans were appended before production code. Both new test files are byte-identical to the final held drafts. No feature PASS, full gate, browser or installed qualification is asserted at activation.


## Implementation and executed qualification — 2026-10-02 12:59 UTC

The bounded successor is implemented in the separately owned thirteen-path slice. The helper consumes the single validated stored source and its already-computed SlowTool result, checks header/partition/member consistency and event-ID-ordered arithmetic, and projects every admitted native group plus deterministic individual calls. It never invokes or changes an analyzer. The private report model is `agentprof.source-report/v2`; public report receipts remain `agentprof.cli/v1`. The existing session/partition union and bounds are unchanged. New descriptor-only model validation rejects unknown fields/accessors before rendering and checks generated context anchors, state/count/denominator relationships and retained ordinal bounds.

The native share table uses a fixed 0–100 SVG viewport and ordinary G/D geometry, with exact numerator, copied full denominator and fraction text. Zero denominators have no bar or percentage; positive IEEE division underflow is explicitly identified. Calls retain their own safe labels and are ranked only within the compatible partition, linking to a retained group or the actual displayed tuple's partition. Summary-relative bars and complete SlowTool safeguards remain unchanged. The report explicitly marks API/network and complete-session worktime shares unavailable; it infers neither API spans from LLM gaps nor avoidable work/savings.

### Frozen source, test and review evidence

- Initial source freeze was taken after the focused implementation and compiler correction, before aggregate execution. Independent contributor `/root/review_prof_command_report` reviewed all thirteen paths and found no source blocker. The exact freeze remained unchanged throughout all aggregate and installed checks.
- Both new repository test files remain byte-identical to the final reviewed proposals: helper/model/render SHA256 `3ad7098b4acf4448fbfa98894c09b586b5349343c1ffeb4ff58eb3e2e5bd578c`; ordinary-provider CLI/installed SHA256 `8baef2e894430ee359d2a70636d9cf42fa61671d1eda146ca9fca9b19431e02c`. Their original planning-only/NOT RUN comments are retained as historical frozen bytes; the actual executions below supersede that planning status. No oracle assertion was weakened or fixture amended.
- Existing model tests only gained the required third helper input. Existing renderer factories also explicitly populate the new model shape for their structural ceiling. The original macOS-corrected report CLI fixtures, analyzer/parser/store/output-writer/dependency/workflow paths were untouched.
- All 200 inherited files outside the reserved existing paths retain exact base bytes and modes. The three shared documents retain their complete inherited text as exact prefixes and add only the previously named EOF sections. No additional inherited scope was edited.

### Actual command receipts

Environment: Linux x64, Node 24.19.0, TypeScript 7.0.2 and Vitest 5.0.2. Existing pinned development dependencies were reused, with no dependency or lockfile update. Full suites used one worker and a 512 MiB outer Node heap setting; aggregate shell runs had explicit 600-second bounds. The root scheduled the aggregate resource slot. Later suites used `--no-cache`; the initial focused runs used Vitest's default cache, without editing dependency package sources.

1. `vitest run tests/source-report-command-breakdown.test.ts --maxWorkers=1 --reporter=verbose`: **PASS**, one file / 44 tests / zero skips. This includes n1/G80/D100 beside n5/G20/D100, exact 80/20 bar geometry, all states, incompatible tuple separation, immutable inputs, group/call/parent omissions, true display anchors, fractional reassociation, subnormal underflow, less-than-whole percent labels, full combined structural rendering and safe escaped-output rejection.
2. Existing model/render suites plus the new ordinary-provider CLI suite: **PASS**, three files / 24 tests / one named installed-case skip. Actual ordinary Codex and paired-Claude input went through scan, persisted-store reopen and input-root deletion. Both providers retained exact six-call N6/D100, one 80ms build and five 4ms tests. The CLI spy proved one readSource, one Summary, one SlowTool and one helper join using the same source/result within the pinned read-only transaction; DB/key bytes, modes and entries were unchanged. Event-only storage retained evidence-absent/unavailable semantics.
3. Initial `npm run typecheck`: **FAIL** on TypeScript control-flow narrowing in the new helper (nullable duration/denominator and possibly missing indexed event). The correction changed the two safe-error functions to explicit never-returning function declarations. No runtime rule, assertion or input fixture was changed. Repeated typecheck **PASS** before initial source freeze; the failed receipt remains retained separately.
4. Scheduled `npm run typecheck` and `npm run build`: **PASS** on the frozen candidate.
5. Default `vitest run --maxWorkers=1 --no-cache`: **PASS**, 53 files / 1,403 tests passed / 41 optional tests skipped, 1,444 total. Skips are not passes.
6. Unchanged `npm run verify:artifact`: **PASS**. 52 packaged files; local tarball npm exec and isolated global-install help/version checks passed with install scripts disabled. Packed stored-source stats/insights/failures and exact current/installed JSON/human parity passed. No package was published.
7. A separate retained current tarball was packed and installed with scripts disabled. All **50 runtime files** matched current `dist` bytes and modes. With `AGENTPROF_REPORT_INSTALLED_BINARY` pointing to that exact installed runtime, the inherited installed-report suite plus new command-breakdown CLI suite passed **two files / seven tests / zero skips**. The installed command-share HTML/receipt matched current output from the same stored generation after raw input deletion; the output was mode 0600 and the store/key snapshot stayed unchanged.
8. Installed-enabled full `vitest run --maxWorkers=1 --no-cache`: **PASS**, 53 files / **1,405 tests passed / 39 optional tests skipped**, 1,444 total. This enables exactly the two report-installed cases missing from the default run. The 39 other pre-existing optional baseline/installed cases remain unexecuted, not promoted to passes.
9. A separate static byte probe using the same synthetic validated helper fixture rendered **25,211 bytes**, SHA256 `78ecaa113233a5fee1ac653e751527f07a452449a97d6ed7d9dedbdfd393df5e`. The complete combined structural model rendered **618,842 bytes**, SHA256 `d7738304b9f10a2c6e7fdcf2fa20339fab1998fbd7e1555d845041b4a59b48af`, including 480 summary rows, 24 usage rows, ten full safeguard cards, 240 native groups and 240 calls. It is below the unchanged 1 MiB ceiling. This is static renderer evidence, not an ordinary-provider support or browser qualification claim. The escaped expansion case still rejects with REPORT_LIMIT; no safeguards or sections were dropped.

The aggregate slot was released at 12:57 UTC. Final documentation receipts are the only subsequent changes to initial source freeze; production and test bytes remain frozen. Final parent review/publication and exact-head hosted CI are separate next gates. No commit, push, merge, deployment or npm publication was performed by this development contributor.

### Explicit qualification limits

Browser visual rendering, runtime CSP, 320/390/1440 viewport behavior, keyboard interactions, print, no-JavaScript browser execution and actual offline network requests remain **NOT RUN**. The previously recorded local-file browser denial was not bypassed; no unrequested server was created. Static HTML/CSP/accessibility assertions do not substitute for those executions. Actual macOS execution, the other historical-baseline optional matrices, real-user-log/provider empirical coverage and performance/savings qualification also remain **NOT RUN**. The independently owned Claude-search admission change was not integrated into this candidate; the report consumes the actual analyzer result without its own version exception. Broad P6 and both original acceptance gates remain open.

## PR39 accessibility correction — old-head qualification, 2026-10-02

The separate correction was planned and independently reviewed against published PR39 head `fcd7bca73749f9f54ea4dd557e371f7b97513691`, tree `c1af6a5fdd6d8c5554b51d03df145ffa66060443`. It adds explicit sequential keyboard focus and uniquely caption-labelled regions to every bounded table wrapper, extends the existing visible-focus CSS rule, and places SlowTool KPI terms and auxiliary text in valid grouped description lists. Caption identifiers use only existing bounded display ordinals. Model, analyzer, denominator, CSP hashing, output writer, privacy and byte-cap contracts are unchanged.

The planning baseline had three intended accessibility failures and ten inherited renderer controls passing, with zero skips and typecheck PASS. The new complete renderer oracle remains SHA256 `994086ab22d7aec7f43ac80449fc31204b737704248bd2367497b75bf16bfaa9`. A pre-edit review found that the two existing command-breakdown oracles required literal attribute-free caption tags. Root reviewed and approved exactly seven selector-only substitutions before the saved five-path activation: helper/model/render oracle `3ad7098b4acf4448fbfa98894c09b586b5349343c1ffeb4ff58eb3e2e5bd578c` became `5b9826a3102b298cda23967148f3d6d15cf341fe68587a6e69572c31a4c74b47`; CLI oracle `8baef2e894430ee359d2a70636d9cf42fa61671d1eda146ca9fca9b19431e02c` became `1f653060f71e0052ba44acc8cff949808f12c506a486101fcaac802df9fdb893`. Every exact caption label, row count, 80/20 geometry, numeric/privacy/overflow assertion, fixture and optional gate is preserved.

The five-path activation was saved/reloaded before production edits, preserving the complete prior 34,466-character Project body as the exact prefix of the 38,148-character body, with unchanged Owner/session and In Progress. Independent review cleared the exact correction. Only `src/report/render.ts`, `src/report/styles.ts` and the three named renderer/command-breakdown test files differ from the published head; all other 208 inherited files retain bytes and modes. The correction remained frozen through qualification.

Executed on Linux x64 / Node24.19.0 / TypeScript7.0.2 / Vitest5.0.2, using one worker, a 512MiB outer Node heap, `--no-cache` and explicit 600-second stage bounds:

- Focused renderer/model/command-breakdown/ordinary-provider CLI: four files, **71 PASS / one named installed skip**. All three additive accessibility cases are green. Static maximum output has 120 uniquely caption-labelled focusable table wrappers; dt/dd ancestry and the unchanged KPI values are verified.
- Typecheck and build: **PASS**.
- Default full suite: 53 files, **1,406 PASS / 41 optional skips**, 1,447 total, 184.42s.
- Unchanged script-disabled artifact verifier: **PASS**, 52 packaged files. No package publication.
- Retained current installed-report supplements: two files, **seven PASS / zero skips**; all **50 runtime files** matched current compiled bytes and modes.
- Installed-enabled full suite: 53 files, **1,408 PASS / 39 optional skips**, 1,447 total, 179.73s. Remaining optional cases are not passes.
- Installed stage including packing, installation, supplements, full suite and static rendering: 192.71s elapsed. Linux child/descendant usage reported maximum RSS350,856KiB; this is not a sum of simultaneous process memory or a product performance claim. An initial `/usr/bin/time` instrumentation attempt returned exit127 before any qualification command ran because that binary was absent. Python standard-library timing replaced only the wrapper; production, tests and verification scripts were unchanged.
- Regenerated synthetic six-call sample: **25,555 bytes**, SHA256 `4c582f209dadedd02c91d15adf1748b86995164b1a64be442f598224b1b1d8bc`. It still shows one 80ms build as80/100=80%, five 4ms test calls as20/100=20%, and the80ms call ranked first.
- Regenerated complete combined maximum: **630,844 bytes**, SHA256 `d6636943dbb6c9dc10f413ec56fcd7c333285c1f32638a7390b1410175ba8579`; all480 summary rows,24 usage rows,10 complete safeguard cards,240 native groups and240 calls remain present. Both artifacts are0600, all generated IDs are unique and internal links resolve. Escaped expansion still rejects at the unchanged1MiB ceiling.

The tested correction-only tree is `f03cd364ee1ade6cb33d4def8e1b72c9b7cc39ef` over the published PR39 head. These receipts do **not** qualify composition with later main `ffd87e1dc1bcbc21d925d7466ae19b944c1a8735`, which contains the independently merged PR36 changes; that integration requires separate preservation, review and test evidence. Every earlier head's receipt is retained as historical evidence for that exact head.

Browser visual behavior, actual keyboard scrolling/focus, screen-reader behavior, runtime CSP,320/390/1440 viewports, print, no-JavaScript and offline-browser requests remain **NOT RUN**. Static focusability and structural semantics are not a browser-conformance claim. Actual macOS, real-user logs, other optional matrices and empirical performance/savings qualification remain unexecuted. No denied local-file/HTTP route was bypassed. Broad P6 acceptance remains open.


## PR36 composition plan — 2026-10-02 14:20 UTC

The correction-only candidate and its exact old-head receipts remain archived. This isolated composition starts from verified main `ffd87e1dc1bcbc21d925d7466ae19b944c1a8735`, tree `8549d3dd18de9292917fe5928ba2bd9cd12b3b14`, with all 216 tracked files verified. It applies only the original thirteen-path report feature delta and the reviewed five-path accessibility correction. The report production and test bytes remain identical to the qualified correction-only candidate. All PR36 production, parser2 analyzer admission, review tests and documentation are preserved; the three shared docs keep complete fresh-main text as exact prefixes before the unique report EOF sections. No analyzer or model adjustment is made for integration.

Next Verify: independent exact resolution diff and fresh-main preservation, then coordinator-scheduled combined typecheck/build/full/artifact/retained installed qualification and regenerated artifacts. Old-head PASS receipts do not qualify this composition. No integration PASS, publication, branch force update, merge or broad P6 completion is asserted at this plan freeze.


## PR36 composition executed qualification — 2026-10-02 14:36 UTC

The isolated composition described above passed independent preservation review before execution. The exact pre-execution tree was `ebacf854cd45c7ee6fc1863a5e292b67b04ef850`, based on main `ffd87e1dc1bcbc21d925d7466ae19b944c1a8735`. All 220 tracked files were accounted for; the 207 non-owned main files kept exact bytes/modes, including PR36 production and review tests. SPEC/IMPLEMENTATION/FINDINGS retained all fresh-main text as exact prefixes. The thirteen owned files stayed frozen through all checks below; production/test bytes remained identical to the independently reviewed accessibility correction. No parser/analyzer admission or model adjustment was introduced for composition.

The P6 fresh-base claim was saved and reloaded before combined execution: complete prior 38,148-character body preserved as the exact prefix of 41,710 characters, with unchanged Owner/session and In Progress. Root independently reviewed the exact resolution and scheduled the combined gates. Environment remained Linux x64, Node 24.19.0, TypeScript 7.0.2 and Vitest 5.0.2, with one worker, 512 MiB outer Node heap, `--no-cache`, scripts disabled for packaging/install, and 600-second stage bounds.

Actual combined receipts:

1. Typecheck and build: **PASS**.
2. Default full suite: **57 files / 1,555 PASS / 41 optional skips**, 1,596 total; 167.47 s. The complete default typecheck/build/full/artifact stage exited0 in 182.94 s, with Linux child maximum RSS 355,584 KiB.
3. Unchanged artifact verifier: **PASS**,53 packaged files. Local script-disabled tarball execution, isolated installation, current/installed stats/insights/failures parity and immutable store checks passed. No package was published.
4. Retained current installed-report suites: **two files / seven PASS / zero skips**. All **51 installed runtime files** matched current compiled bytes and modes.
5. Installed-enabled full suite: **57 files / 1,557 PASS / 39 optional skips**, 1,596 total; 182.88 s. The remaining optional cases are unexecuted, not passes.
6. A separate explicit ordinary-provider version probe initially failed its scan-exit assertion before version/report checks. Unlike the already-passing repository fixtures, this newly written private probe omitted synthetic cwd. The actual Codex scan committed one source but returned partial with six `INSUFFICIENT_OPERATION_CONTEXT` warnings. The failed script and diagnostic logs are preserved. Adding only a fictitious cwd to its Codex metadata/Claude assistant records corrected the probe, without weakening any exit/version/arithmetic/store assertion or editing repository fixtures/production.
7. The corrected probe **PASS** independently established actual reopened-store Codex parser/capability 1 and Claude parser/capability 2, both N6/D100, build 80/100 = 80%, tests 20/100 = 20%, report publication 0600, raw input roots deleted before reading/reporting and unchanged DB/key snapshots. Resulting report sizes were 25,612 bytes for Codex and 25,703 bytes for Claude. It consumes the integrated analyzer's actual admission rather than adding a report-owned exception. This probe is separate from aggregate test counts.
8. The installed execution stage, which included the successful supplements/full suite/static rendering and then the first failed private probe, retained exit 1 in 195.58 s and child maximum RSS 353,412 KiB. The corrected private probe subsequently passed separately; no successful gate receipt is relabelled, and no full-stage rerun is claimed. Child maximum RSS is the operating system's child/descendant high-water report, not a sum of simultaneous processes or a product performance benchmark.
9. Artifacts were regenerated using the composed build. The deterministic synthetic helper sample remains **25,555 bytes**, SHA256 `4c582f209dadedd02c91d15adf1748b86995164b1a64be442f598224b1b1d8bc`; the full combined maximum remains **630,844 bytes**, SHA256 `d6636943dbb6c9dc10f413ec56fcd7c333285c1f32638a7390b1410175ba8579`. Matching earlier hashes are newly observed results, not reused old output. All 480 summary rows, 24 usage rows, 10 safeguard cards, 240 native groups and 240 calls remain; the 1 MiB rejection oracle is intact. The fixed helper sample is synthetic, while the independent ordinary-provider probe above establishes actual stored-version behavior.

The combined resource slot was released at 14:36 UTC. Only append-only documentation receipts follow this pre-execution freeze; no production or test bytes changed during or after qualification. Parent fresh-ref review, feature-branch publication and exact new-head hosted CI remain separate gates. This is integration of current main into the feature candidate, not completion or authorization of the PR39 merge into main. Browser visual/keyboard/screen-reader/runtime-CSP/viewports/print/no-JavaScript/offline execution, actual macOS, other optional matrices, empirical provider coverage and performance/savings remain **NOT RUN** as previously qualified. No denied browser route was bypassed and broad P6 acceptance remains open.

## Independent parent review and qualification plan (2026-10-03)

The original recovery/production/accessibility and exact-head receipts retain their historical sources and environments. The owner's later review/process instruction authorizes parent review, necessary corrections and merge of PR39's thirteen-path slice. Broad P6 draft258833122 keeps both full product acceptance checks open, In Progress and its original coordinating Owner/session; this parent is a named review/publication contributor for this slice, not a reassignment of broad P6 or another reservation.

1. Read current claims and freeze/integrate exact author5580df688e7f18cb10be7f1e087c271c69b449d6 with current main39070c8a1214215fea6337677b19cc9fab193a05. **Verify:** actual Project registration/readback before research GO; all thirteen feature paths accounted for, every unowned main blob/Git mode and complete shared document prefix preserved, current checkpoint/pins/semantic versions intact.
2. Independently challenge helper/model/renderer/CLI and previous accessibility correction. **Verify:** one pinned source/precomputed SlowTool result, exact full compatible N/D, native membership/arithmetic/ordering, threshold-independent rows, zero/unavailable/partial/omission truth, bounds/private allowlist, unique resolving focusable captions and semantic KPI pairs. Record research before any amended correction; separate developer only after saved/read-back ownership.
3. Qualify frozen actual source/package and available browser execution. **Verify:** pinned macOS full suite with authentic historical/current-installed optional cases, clean enabled prepack, installed bytes/modes/artifact, ordinary reopened-store Codex1/Claude2 N6/D100 with build80%/tests20% and unchanged DB/key after input deletion. Use only owned synthetic HTTP reports for visual/keyboard/CSP checks; unsupported viewport/theme/print/noJS/offline controls remain explicit NOT RUN, not static passes or route bypasses.
4. Record current evidence and publish/merge the reviewed existing PR. **Verify:** all thirteen paths reviewed including OCR-excluded docs/tests, final exact-head hosted/security logs, expected-head merge, clean main tree equality. Complete and release only PR39's slice in the existing broad P6 body; preserve broad Status/Owner/session and the two unchecked original acceptance gates. No package publish, deployment or actual user logs.

Parent execution at this draft checkpoint is NOT RUN. Previous author macOS/browser NOT RUN and synthetic Linux/installed receipts are not newly executed parent evidence. PR40 remains queued; each parent session handles one ticket at a time.

## Parent integration and executed qualification (2026-10-03)

The parent reviewed all thirteen feature paths, including the eight documentation/test paths excluded by OCR delegate selection, and independently confirmed the separate research findings. No actionable production defect remained. Exact author `5580df688e7f18cb10be7f1e087c271c69b449d6` was composed with main `39070c8a1214215fea6337677b19cc9fab193a05` at qualified source head `a83c8134443722faeffd86ce8a0a511209cfb99c`, tree `38a7c1f2196db011414eb2aec4d2193a6b90aba3`. All 227 tracked paths were accounted for; 214 unowned main files retained exact Git blobs/modes, nine feature production/test paths retained exact author bytes, and the three shared documents preserved complete current-main prefixes before the unique report and parent/research appends. Current pnpm10.34.6, Claude2/Codex1, Codex checkpoint validation and existing privacy/output contracts were preserved. This composition changed no feature code or test assertion.

Actual parent receipts use macOS arm64, Node24.21.0, pnpm10.34.6, one Vitest worker and a512MiB Node heap:

- Frozen scripts-disabled dependency installation, typecheck, build, full suite and artifact qualification passed. **59 files / 1,749 tests / zero skips** includes all41 authentic historical/current-installed optional cases, including the added report case controlled by the existing AGENTPROF_REPORT_INSTALLED_BINARY. Historical baseline binaries and their identities were retained; no baseline, fixture or error assertion was normalized or swapped.
- A clean lifecycle-enabled npm prepack built the package from the owned checkout after its generated dist was removed. Actual isolated npm installation used disabled install scripts. All53 runtime files matched compiled/installed bytes and modes; the package allowlist/artifact gate covered55 files. Local tarball npm exec and isolated global-install help/version passed, as did packed stored stats/insights/failures and immutable store parity. Consumer PATH excluded mise/pnpm. Node22.16 rejected with exit2, empty stdout and UNSUPPORTED_RUNTIME. No package was published.
- A separate actual-installed CLI/SDK oracle scanned only inert synthetic ordinary Codex and paired-Claude records, reopened the stored generation, then deleted raw input roots before report reads. Actual parser/capability versions remained Codex1/Claude2; both had N6/D100, one n1/G80/build=80% group and five n5/G20/test=20% calls, with unchanged SlowTool diagnostics. Full HTML equalled the installed renderer and repeated outputs, was0600 and bounded, excluded private sentinels/key/path/raw event IDs, rejected an existing target with REPORT_OUTPUT_UNSAFE without changing it, and left DB/key bytes/modes/entries unchanged. Codex/Claude artifacts measured25,612/25,703 bytes. An actual stored Codex zero-duration fixture retained N6/D0 with unknown shares and no native SVG,21,767 bytes. These are synthetic evidence, not empirical provider population or savings measurements.
- Authorized ordinary loopback HTTP exposed only the owned synthetic report directory for transient browser qualification. At the actual1440x900 dark viewport, Codex and Claude share bars rendered correctly at80/20 with exact denominator text. The static hash CSP and actual stylesheet/SVG fill were observed. Real Tab moved from the provenance summary into the caption-labelled groups region, then into calls; both displayed the existing3px focus outline/4px offset. Enter expanded first-call evidence and its shown-group link resolved the unique actual cargo-build target. The zero-D page showed unknown with no percentage bar. Actual browser PDF export produced eight Letter pages; all eight were rendered/visually inspected, including share/call rows and complete SlowTool safeguards without observed clipping or overlap. Closed call-detail bodies were not printed, and the wrapper did not honor the requested A4 option; those are explicit execution limits, not full print conformance. The owned browser tab and foreground qualification server were closed; user tabs/services were preserved.

The first off-screen Claude element screenshot correctly failed before navigation; normal known session-anchor navigation and a full screenshot then succeeded. The default Python lacked Pillow for a private PDF contact sheet; bundled Python rendered the inspection without installing dependencies. Neither failure changed production, tests or successful receipts. Actual320/390 viewports, forced light screen theme, screen-reader execution, browser JavaScript-disable/offline-network controls, negative CSP attack controls and maximum-model browser layout remain **NOT RUN**. The combined structural/escaping limits are passing repository tests, not substituted browser evidence. Broad P6 remains In Progress with its original coordinating Owner/session and both original acceptance gates open.

Private receipts are retained under `pr37-40-20261002-51d062/pr39-qualification` and `pr39-report-oracle`; no synthetic database/key/raw fixture or local receipt is committed. Subsequent changes are append-only documentation evidence. Feature-branch publication, exact new-head hosted/security CI, expected-head merge and main CI are separate gates, not asserted at this local qualification checkpoint.

## Parent exact-source hosted qualification (2026-10-03)

Published head `efb29fae90e2bb44082a3554ce9166bc39eba3e8` has the same production/test bytes as locally qualified `a83c813`; only the maintained qualification receipts were appended. [Push37041584641](https://github.com/WhiteKiwi/agentprof/actions/runs/37041584641) and [PR37041594922](https://github.com/WhiteKiwi/agentprof/actions/runs/37041594922) passed all eight jobs and GitGuardian passed. Actual logs independently verified both exact checkouts, pnpm10.34.6 scripts-disabled frozen installs, TypeScript/build, all six Linux Node24.15/24.21/26.7 jobs with59 files/1,708 PASS/41 named optional SKIP (1,749 total), the55-file artifact guard, and both Node22.16 unsupported-runtime guards. The PR test-merge's parents are exactly main39070c8 plus head efb29fa and its tree equals the reviewed source tree. Linux skips remain skips; the earlier actual macOS installed-enabled run executed all41 controls successfully.

This append records source-head CI without altering code/tests or earlier receipts. Final documentation-head CI/security and expected-head merge/main verification remain publication gates; broad P6 acceptance and unsupported browser controls remain open.
