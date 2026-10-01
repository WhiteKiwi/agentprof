# Fixed-snapshot report preparation

Status: preparatory presentation slice, 2026-09-30. Tracks [Project P5](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833093); P6 remains dependent on real analysis. This supplement does not replace SPEC, METRICS or the P5/P6 implementation plan.

## Scope and evidence

At main `c3856249bdc0a9c19b856ca32c97d3484e189176`, `src/cli/main.ts` exposes help/version and returns NOT_IMPLEMENTED for scan/stats/insights/report/open. Existing `design/` provides framework-free escaped rendering primitives, semantic tokens and an offline component specimen. Build on those assets without changing scanner, normalization, database, provider contracts or CLI capabilities.

This independent preparation renders a fixed, hand-authored synthetic display snapshot. It is not a parser, analyzer, supported storage schema, public snapshot API or completion of the P5 vertical slice. The future React/Vite P6 choice is unchanged. There is no server, watcher, network or automatic configuration change.

## Presentation boundary

Use a small internal display model with explicit provenance, period/timezone and collection time; counts and coverage; separately scoped duration values; independent hotspot rows; and insight evidence, a suggested action, one comparison experiment and a quality guardrail. Unknown remains null; measured zero remains zero. Sample and timing denominators remain visible. No raw command, prompt, source, output or input path field is accepted or serialized by the renderer. Escaping is not a privacy filter: a future trusted adapter must enforce the existing normalization allowlist before calling it.

Display the synthetic source/version as synthetic, not as verified Codex/Claude support. Do not calculate diagnostic eligibility in the renderer, sum overlapping hotspots, convert session span into active time, infer idle time from gaps, or imply observed duration equals savings. Detected Waste stays unknown when eligible intervals are absent. Fixed values are independent authored test expectations, not analyzer results.

## Change order and Verify

1. Compose report markup from the existing tokens and primitives. Verify visible collection/period/scope/coverage and explicit unsupported/unknown/zero states; no root README/mascot changes.
2. Build a single HTML with hash-based CSP, inline local styles/scripts/mascot, escaped text and native disclosures. Verify malicious strings stay inert, no remote resources or serialized raw snapshot, and deterministic output.
3. Test the fixture and boundary, then browser-test dark/light at 320/390/1440px, keyboard disclosure/navigation, repeated theme selection, no JavaScript, reduced motion and print. Verify zero external requests, no page overflow and inspect screenshots. Record pass/fail/not-run accurately.

Publication is a separate parent review and draft PR. It does not authorize merge, deployment, P5/P6 closure or a claim of CLI/report parity.

## Visual-first revision — 2026-09-30

User requested charts, aggregate metrics and session flow over paragraphs. Keep this bounded static presentation, with four large metrics, time/coverage bars, a declared token partition, selected-session interval lanes, tabular equivalents and brief action/evidence cards. Scope and coverage stay adjacent; explanatory details move into native disclosures. The synthetic timeline is a selected five-minute excerpt, not a complete reconstruction of the 30-minute aggregate.

### References and decisions

- [Perfetto large traces](https://perfetto.dev/docs/visualization/large-traces) documents native local TraceProcessor offload for traces that strain browser processing. Adopt the progressive boundary: bounded embedded views first; query-backed local processing only after measured browser limits. No Perfetto dependency is added.
- [Langfuse sessions](https://langfuse.com/docs/observability/features/sessions) groups related traces into a session view. Adopt session context around span lanes; grouping does not prove causality or parentage.
- [Jaeger UI's own configuration](https://github.com/jaegertracing/jaeger-ui/blob/main/packages/jaeger-ui/src/types/config.ts) distinguishes trace graph and trace timeline, with inline/side-panel details. Adopt aligned time lanes plus inspectable detail; omit dependency graph and critical path without verified relationship evidence.

These are product-design inferences from primary references, not claims of feature parity or copied assets.

### HTML versus local dashboard

| Need | Bounded offline HTML now | Local query-backed dashboard later |
| --- | --- | --- |
| Read aggregate results and share a fixed snapshot | Strong fit; no running process | Unnecessary overhead |
| Inspect selected session spans | Embedded lanes, evidence links and native disclosures | Not inherently required |
| Search all sessions, zoom arbitrary windows over large history | Limited by intentionally exported subset | Paginated SQLite queries, virtualized lanes |
| Fresh appended data | Regenerate snapshot | Incremental refresh, explicit local lifecycle |
| Privacy and operations | Inert normalized payload, no listener | Loopback binding, access/origin controls, query limits and shutdown need design |

Recommendation: improve the offline report before introducing a server. Measure generated size, load time, memory and interaction latency on representative bounded exports. A server becomes justified when users repeatedly need arbitrary historical queries or those measurements miss an agreed budget, not merely because the UI contains spans. Whole-log size is not HTML payload size. Neither architecture makes missing timestamps, relationships or token semantics observable. Server architecture/implementation remains deferred and requires a separate scoped decision.

### Revision verification

Check numerical chart domains, finite/non-negative intervals and token partition consistency; missing values get text, not zero-width marks. Span widths use the selected window's scale; no parent-child connectors or inferred critical path. Accessible labels and data tables retain timing values without SVG or JavaScript. Preserve CSP, escaping, deterministic output and existing tests. Browser rendering remains a separate outstanding gate.

## Detailed timing slice — 2026-10-01 UTC

User requested API request/response share, build-command share and longest commands. This is a continuation of the same [Project P5 presentation ticket](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833093), not a second engine task. Current main `baa384f` still has no analysis-to-report snapshot pipeline. The report therefore adds one explicitly synthetic, independently identified five-minute detail cohort; it does not imply the existing parser captures model-network timing.

Before implementation: choose horizontal stacked bars only for mutually exclusive categories within the same duration scope/evidence cohort. Process-runtime cumulative shares and API/tool invocation latency sums get separate panels. Independent category interval-union occupancy uses the 300-second excerpt as denominator and may sum above 100%; never stack those rows into a whole. Command rankings use bars and a numeric table with count, timed count, sum, mean and max. Long executions link to safe per-run detail and aligned interval lanes. Generic labels do not prove same-operation retry identity.

The detail fixture's direct process-runtime cohort has 7 terminal calls totaling 360s: build 180s, tests 120s, search 60s. Its API/tool invocation cohort has 5 terminal calls, 4 timed at 60s each (240s), one missing duration; a sixth pending call is separately excluded. Model API/network latency is unsupported. Timing intervals are a separate observed field, not inferred from direct duration. Per-category union occupancy is 180/300 build, 120/300 test, 60/300 search, 240/300 API/tool; overlap means the percentages are not additive. All known interval union is 260/300; remaining 40s is unobserved, not proven idle. This hand-authored oracle is unrelated to real user logs.

Safe command aliases are display-only synthetic patterns without private paths, parameters, endpoints or outputs. A future adapter must enforce allowlisting before supplying them; escaping does not sanitize sensitive text. Internal report helpers validate and format the bounded synthetic view, not replace product metric contracts. Verify fixed arithmetic, identical-scope denominators, null versus zero, union overlap, nonterminal exclusion, mean/max ordering, safe detail references and hostile strings. Keep no-JS tables/disclosures and browser QA limitations explicit.
