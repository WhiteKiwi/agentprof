# AgentProf component foundation

**Implemented specimen; candidate design.** This directory is a reusable, framework-free design foundation for a future offline report and local dashboard. It does **not** implement scanning, parsing, metrics, diagnostics, a CLI, a server, or a product dashboard. All display data is synthetic. Product contracts remain in [`docs/METRICS.md`](../docs/METRICS.md).

Design authority: [`DESIGN.md`](../DESIGN.md) · [Full guideline](../docs/DESIGN-GUIDELINES.md) · [QA evidence](../docs/DESIGN-QA.md)

## Open and rebuild

Download/clone the repository, run `node design/build.mjs` from its root, then open the generated `design/showcase.html` in a browser. The generated file is not committed; its source and build are. It is a self-contained file with no network, remote fonts, telemetry or storage. GitHub displays HTML source rather than a live preview.

```sh
node design/build.mjs
node design/tests/static.mjs
node design/tests/contrast.mjs
```

The build and static tests use Node built-ins only. Node 24.19.0 was used for this change; this is not a product runtime support claim. The generated HTML is gitignored; build it locally with Node, then open it without a local server.

Optional browser verification requires an existing Playwright installation and a Chromium binary. No package or browser is installed by this directory:

```sh
CHROMIUM_PATH=/path/to/chromium AP_QA_DIR=/tmp/agentprof-design-qa node design/tests/browser.mjs
```

The suite targets 320, 390 and 1440px in light/dark, repeated interactions, keyboard focus, reduced motion, print, no-JavaScript access, safe text and offline requests. A test file's existence is not a passing result; check the dated QA record for what actually ran.

## Files and reuse

| File | Responsibility |
| --- | --- |
| `tokens.css` | Primitive intent, semantic color roles, dark/light theme mapping, type/spacing/radius/motion |
| `components.css` | Native controls, layout, metrics, badges, chart rows, insights, evidence table, responsive and print styles |
| `components.mjs` | Pure escaped-HTML render helpers; finite numeric duration/chart validation; unknown differs from zero |
| `fixtures.mjs` | Explicitly synthetic component examples; never real logs or analyzer output |
| `showcase.template.html` | Semantic composition and accessible native HTML |
| `showcase.mjs` | Optional theme, filter, evidence navigation, validation and print behavior; no network/storage |
| `build.mjs` | Inlines assets and creates hash-based Content Security Policy |
| `showcase.html` | Locally generated, gitignored offline artifact; edit sources, then rebuild |
| `tests/` | Dependency-free static/contrast gates and optional Playwright regression suite |

A consumer loads tokens before component styles and uses the semantic classes on ordinary HTML. Set `data-theme="dark"` or `data-theme="light"` on the root. The default is dark. The optional specimen behavior follows OS appearance only when “System” is selected and does not save the preference.

```html
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="components.css">
<button class="ap-button ap-button--primary" type="button">Inspect evidence</button>
<span class="ap-badge ap-badge--info">Direct</span>
<details class="ap-details">
  <summary>Inspect evidence &amp; next step</summary>
  <div class="ap-details-body">Normalized evidence belongs here.</div>
</details>
```

For a single-file report, inline those files using the build pattern. The example above documents local development reuse; the generated file has no external stylesheet requests. Render helpers consume display values, **not** a supported product snapshot schema. Adapt the future normalized snapshot at the boundary and keep calculations out of display components.

## Evidence semantics

- “Window coverage” is this fixture's disjoint interval coverage, 24/30 minutes. It is not the product's call-based duration coverage. Tool call coverage is separately labeled 32/40
- The 12s + 8s − 5s = 15s example illustrates interval-union geometry only. Two rows do not establish the product's repeated-error/session/retry diagnostic eligibility
- The 95s build is a component specimen, not an emitted Slow Tool diagnostic, baseline comparison, or waste contribution
- Unknown, unsupported, pending, empty, failed and measured zero have separate labels. `chartRow` rejects null, strings and nonfinite numbers rather than coercing them into a zero-width bar
- Synthetic strings are escaped before HTML insertion. The future product still needs its complete privacy boundary and snapshot integration tests

## State and asset notes

`<button>`, `<select>`, `<input>`, `<details>/<summary>` and table headers remain native. Filtered content announces the remaining count; evidence links clear the filter and focus the disclosure. Without JavaScript, all insights and native disclosures remain available in the default dark theme. Theme/filter actions require JavaScript.

The existing repository `assets/reference/salamander2.png` is embedded whole and unmodified. Optional JavaScript reuses the mark's data URL as the favicon, avoiding duplicate image bytes. Without JavaScript the favicon is blank. This is a provisional mark, not a newly designed final logo. No image processing or third-party visual dependency is involved.

Hash-based CSP permits only the exact generated CSS/JS and data-URL images; network connections, objects, form submission and base changes are blocked. The controls never load logs, execute text, save field values or send requests. Build-time HTML escaping and CSP are complementary defenses, not a claim that the product privacy implementation is complete.

## Changing the system

Update the guideline and semantic tokens together. Keep component palette choices in token roles; fixed-light print values are the explicit export exception. Rebuild after source changes, run the dependency-free gates, then render supported viewports/states where browser execution is available. Preserve QA blockers and avoid marking product P5/P6 complete for a component specimen.
