# AgentProf synthetic report preview

A small, single-file offline report built from the existing AgentProf design system. All numbers and events are hand-authored synthetic examples. No logs are loaded. This does not implement the CLI `report` command, compute metrics, validate provider support, or complete P5/P6.

From the repository root:

```sh
node report/build.mjs
node --test report/tests/*.test.mjs
```

Open `report/preview.html` locally. It is generated and ignored by Git. No server, install, network, remote asset, telemetry or storage is required. The supplied salamander remains unmodified; design tokens and helpers remain in `design/`.

## Boundary

`renderReport(snapshot)` takes only the internal synthetic display model in `fixture.mjs`. It returns HTML and does not serialize the source object. Numeric durations are seconds, `null` means unknown, and zero is measured zero. Counts must be non-negative integers and timed calls must not exceed terminal calls. Hotspots are independent duration sums with explicit scopes, evidence and sample limits. The renderer does not derive diagnostic eligibility, percentiles, waste, causal effect or savings.

This is not a public snapshot, storage or provider schema. Text is HTML-escaped, but escaping does not remove sensitive content. A future product adapter must enforce the existing privacy allowlist before rendering. The model contains no raw log/command/prompt/output/path fields; unexpected fields are not serialized. Only synthetic input is accepted in this preparation.

Native evidence disclosures work without JavaScript. JavaScript only enables appearance/print controls and opens focused span details; there is no filter, form, upload or fetch. The exact inline stylesheet/script hashes are placed in CSP. Changes to source require a rebuild.

## Checks

Render tests use only Node built-ins. Optional browser tests use an existing Playwright installation and Chromium; no browser is downloaded:

```sh
CHROMIUM_PATH=/path/to/chromium AP_QA_DIR=/tmp/agentprof-report-qa node report/tests/browser.mjs
```

The suite covers dark/light at 320, 390 and 1440px, repeated theme changes, native keyboard disclosure, in-page navigation/back, print, reduced motion, no-JavaScript access, escaped injection and external request monitoring. See [QA.md](QA.md) for actual results; test presence does not mean it passed.

Plan and limitations: [REPORT-PREVIEW](../docs/REPORT-PREVIEW.md). Product metric semantics: [METRICS](../docs/METRICS.md).

## Visual-first revision

Large metrics lead into separately scoped time bars, a synthetic token composition, selected hotspot bars/table and a five-minute session excerpt. Span endpoints are explicit, pending items have start ticks only, and a table preserves all interval values. The excerpt is not an exhaustive export or dependency graph. The internal display model now has explicit synthetic token and timeline sections; it still does not define a provider contract. No real token observations or span analysis are inferred. See the planning supplement for the primary-source review and the decision to defer a local server.

## Requests and commands detail

The independent `demo-detail` cohort answers three different questions with separate views:

1. Horizontal stacked bars: where cumulative timed duration went, within compatible process-runtime or invocation-latency cohorts only
2. Independent occupancy bars: each category's observed interval union divided by the 300s excerpt; categories overlap and must not be stacked into 100%
3. Command bars/table: sum, cohort share, within-category share, observed occupancy, call/timing coverage, mean and max; longest calls link to native per-run evidence and concurrent lanes

API/tool invocation latency is not model-network latency or pure server runtime. Model API timing remains unsupported. Five API/tool calls are terminal (four timed, one missing); a sixth is pending and excluded. Command aliases are hand-authored safe patterns, not raw commands or proven same-operation identities. No private arguments, endpoints, output or prompts are embedded. This display fixture and its arithmetic are not an analyzer implementation. Run the whole `report/tests/*.test.mjs` suite for its independent numeric oracles.
