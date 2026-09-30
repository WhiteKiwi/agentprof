# Fixed-snapshot report preparation

Status: preparatory presentation slice, 2026-09-30. Tracks [P5 #6](https://github.com/WhiteKiwi/agentprof/issues/6); P6 remains dependent on real analysis. This supplement does not replace SPEC, METRICS or the P5/P6 implementation plan.

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
