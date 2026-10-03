# AgentProf Design QA

2026-09-30 · Candidate 0.1 · Design scaffold only

The reusable source is implemented. Browser visual/interaction QA is **NOT RUN** because of verified environment restrictions. This is not a release-ready accessibility claim and does not complete any product P0–P7 acceptance.

## Passed

| Check | Actual result |
| --- | --- |
| `node design/build.mjs` | Self-contained synthetic `design/showcase.html`, 1,278,741 bytes; generated locally, not committed |
| `node design/tests/static.mjs` | Formatting, null/zero distinction, null/nonfinite/string chart rejection, HTML escaping, role/ID validation, fixture arithmetic, complete template, exact CSP hashes, no remote resources/fetch/storage, one original PNG inclusion |
| `node design/tests/contrast.mjs` | 72 theme/state pairs pass their role gates: ordinary text ≥4.5 and essential non-text ≥3 |
| `node --check design/showcase.mjs` | Syntax passed |
| `node --check design/tests/browser.mjs` | Syntax passed; syntax is not browser execution |
| Current create-design-guideline contrast helper | #171A1E/#F87929 = 6.449431642237748; #545E6B/#EAEDF0 = 5.601391871265717, ordinary-text gate passed |
| README SVG | Rasterized with installed sharp at 1200×400 and pixel-inspected; title, tagline, trace and stage label fit |
| Documentation | Local link targets, TODO Verify entries, fenced blocks and whitespace checked before commit |

Selected minima (display rounded; assertions use full precision): dark text 6.4494:1; light text 5.6014:1; dark essential boundary 4.1071:1; light essential boundary 3.9953:1. Measurements apply only to tested opaque sRGB pairs, not full WCAG conformance.

The four newly supplied images and existing repository dark/orange PNG were pixel-inspected. Existing `assets/reference/salamander2.png` is reused unchanged. New attachments were not committed as duplicate binary assets. The README cover is original native SVG type/trace geometry, not a mascot redraw. Source image identity is checked by the static test against the inlined bytes.

## Blocked / NOT RUN

Installed Chromium was attempted normally and once with an authorized tool escalation. It failed before browser creation with `socket() failed: Operation not permitted` in process_singleton_posix. The supported cloud browser separately rejected local `file://` navigation because it allows only HTTP/HTTPS. No restriction was bypassed and no Site was deployed.

The checked-in browser suite therefore has **not executed its assertions**: dark/light 320/390/1440 layouts, runtime external requests, keyboard/focus, target sizes, theme changes, filter/reset, evidence disclosures, repeated actions, active navigation, validation, 200% zoom, print, reduced motion and no-JavaScript behavior remain NOT RUN. Static source checks are not a substitute for those checks. Full README rendering on GitHub was not verified; its cover image was rendered locally.

Run `node design/tests/browser.mjs` in an environment with Playwright and a usable Chromium before using this candidate in product reports. Review actual rendered screens in addition to the automated checks. Do not mark the design track's visual gate complete until evidence exists.

## Semantic review corrections

- Null chart data cannot silently become a zero-width bar. Unknown metric values do not inherit numeric unit display.
- “Window coverage” is the specimen's exclusive interval-window fraction; call timing coverage is shown separately.
- 12s + 8s − 5s = 15s is geometry-only, not proof that two rows meet retry/repeated-error eligibility.
- The 95-second duration specimen is not a fake Slow Tool rule, baseline claim or waste contribution.
- The supplied repository PNG is inlined once; JavaScript reuses its URL for a provisional favicon. With JavaScript disabled, content/native disclosures remain present but the favicon is blank and enhanced controls require JavaScript.
- No analyzer, log parser, live dashboard, server, watcher, deployment or raw user data was added.

## Next verification

Resolve the browser execution environment, run the suite and inspect the resulting screenshots. Keep final logo/vector-master and small-size optical approval open. Connect this design to real snapshot data only through the existing P5/P6 contracts and product acceptance.

## Issue #10 bounded regression verification — 2026-10-03

Baseline: `d0f57e6ecaf797bfe895bd020cc09ba42dc4c756`; branch
`fix/design-qa-issue-10`. The separate development contributor implemented the
reviewed issue #10 plan after the coordinator confirmed its saved claim readback.
This receipt covers the local scoped diff, before parent review/publication.
Environment: Linux, Node 24.19.0, Vitest 5.0.2; existing locked dependencies were
installed with lifecycle scripts disabled. The environment's pnpm fallback reports
11.19.0, distinct from the repository's pinned pnpm 10.34.6 / Node 24.21.0 toolchain.

| Check | Actual result |
| --- | --- |
| Negative regression proof, before source changes: `node node_modules/vitest/vitest.mjs run tests/design-foundation.test.ts` | 7 FAIL / 26 PASS of 33 against the original design sources. Four minute/hour-boundary cases emitted `60s`; estimated-filter print and cancellation state did not hide the notice; the notice lacked its screen-only print class |
| Same ordinary suite after correction | 33 PASS / 0 FAIL. Includes independent expected strings, below-boundary/fractional/exact-minute/sub-minute/zero/unknown/invalid controls; all/direct/estimated filters; mixed disclosure states; repeated and unmatched print notifications; cancellation-event restoration and a fresh second snapshot |
| `node design/build.mjs` | PASS; local gitignored synthetic HTML, 1,279,002 bytes; no generated artifact committed |
| `node design/tests/static.mjs` | PASS with the gate unchanged: safe formatting/escaping, null/zero, roles, fixture arithmetic, hash CSP, single original image and no remote resources/storage |
| `node design/tests/contrast.mjs` | PASS with the gate/tokens/CSS unchanged: all 72 theme/state pairs; not full accessibility evidence |
| `node --check design/showcase.mjs` and `node --check design/tests/browser.mjs` | PASS; syntax only |
| `git diff --check` | PASS |
| README/specimen wording | Corrected the stale unmerged-P1/no-CLI claim using actual baseline `src/cli/main.ts`, maintained contracts and the distinct historical `docs/NPM-ALPHA.md` record; no open feature branch described as shipped |

The fix carries only the rounded minute remainder and uses the existing
`ap-no-print` style for the empty notice. Print-event state now snapshots/restores
that notice with disclosures while leaving the filter and insight hidden flags
unchanged. No product CLI, parser, store, analyzer, dependency, workflow, semantic
color token or contrast threshold changed.

`tests/design-foundation.test.ts` executes the real enhancement script in a small
Node VM DOM seam. Its passing assertions establish event/state logic only. The
optional browser suite now also checks direct and empty/estimated print views,
full screen-state restoration, repeated notifications, and the synthetic
cancellation-event path. **Those browser assertions are NOT RUN.** No browser was
launched or restriction retried in this implementation pass: the prior local
Chromium socket restriction and coordinator CUA approval blocker remain in force.

Outstanding gates remain actual browser layout and interactions, native print
and dialog cancellation, actual browser zoom (CSS `zoom=2` is a separate test),
assistive-technology/accessibility review, README GitHub rendering, and parent
full-check/review/remote-commit/merge qualification. This bounded correction does
not complete issue #10, a product release, a real-user pilot, or P4–P7 acceptance.

### Final scoped review and local aggregate checks

The reviewed delta is limited to twelve design/test/documentation paths. Existing
product source, dependency manifests/lockfiles, workflows, design tokens/CSS and
the original static/contrast gates are unchanged. Remote main was still
`d0f57e6ecaf797bfe895bd020cc09ba42dc4c756` at review.

- `npm run typecheck`: PASS; `npm run build`: PASS.
- Full ordinary Vitest run, one worker with a 512 MiB Node heap: **2,843 PASS,
  79 SKIP, 0 FAIL; 102 files PASS, 2 files SKIP**; elapsed 211.79 seconds.
  `AGENTPROF_PRE_RESUME_DIST` pointed to the built historical commit
  `5614a3107b53022f29ea32d44ba83f533fd58b92`, independently checked against tree
  `c1361a2fea2386ced7c30f88da82ce421017dca6` and runtime schema version 5.
  Skipped tests are not counted as passed. The 33 new design cases all executed.
- `npm run verify:artifact`: **PASS**, 73 artifact files, tarball npm exec and
  isolated global install with lifecycle scripts disabled; synthetic packed
  read-only stats/insights/failures and unchanged-store checks passed.
  `published:false`; this check did not publish a package.
- Focused design checks were rerun against the final template and scripts:
  33 regression cases, build/static/72 contrast pairs, syntax and whitespace PASS.

Local verification used Node 24.19.0 on Linux x64 and the environment's pnpm
11.19.0 fallback. The repository-pinned Node/pnpm CI matrix is separate remote
verification, not inferred from these local runs. Native browser/print/visual
and full README rendering remain NOT RUN, and issue #10 stays open.

## Parent bounded browser and visual qualification — 2026-10-04 KST

The parent exercised the actual original141 suite, retained its failure at the immediate asynchronous system-theme assertion, and observed 20 alternating media transitions: immediate state was stale, while each bounded eventual DOM state was correct. A separately reviewed developer change adds only an explicit 2,000ms `page.waitForFunction` condition before the unchanged dark-theme assertion. Product theme behavior, all other assertions and contrast/style thresholds remain unchanged.

Actual qualified design prefix is `c74b94588683a42e83ebb271747a9f37c947e3cf`; all 12 design/README inputs remain exact in composed code `e7be6ab22ffaa497352e3506f79441aec1976471`. On macOS arm64, direct Node24.21.0 and installed Chrome154.0.8037.95 with existing bundled Playwright, `node design/build.mjs`, `node design/tests/static.mjs`, `node design/tests/contrast.mjs` (72 pairs) and `node design/tests/browser.mjs` all pass. The browser command uses the installed Chrome through CHROMIUM_PATH and the existing bundled module path; browser execution took7.875s.

The actual browser result covers 320/390/1440px in light/dark themes, zero external requests/console errors, no horizontal overflow, keyboard/focus/skip links, reduced motion, repeated theme/filter/reset/disclosure/navigation, print screen-state restoration, no-JavaScript and CSS zoom=2. Parent visually inspected all six base viewports, all six expanded viewports, no-JS320 and CSS-zoom output. The corrected six base PNGs are byte-identical to the already inspected original-run images; exact-image evidence was reused. No visible overlap or clipping was observed in these images.

Both actual print PDFs (ordinary specimen and empty estimated filter) contain four A4 pages. Parent rendered all pages through installed Poppler and inspected every ordinary page; each corresponding empty-filter rendered PNG is byte-identical. All three insights, expanded evidence tables, Korean text, zero/unknown/pending and controls appear without visible overlap or horizontal omission. Long identifiers and Unknown labels wrap inside narrow cells; complete typography approval remains separate.

The original141 README was read through the actual GitHub Preview DOM and visible banner/intro pixels. Its exact README blob is retained in the candidate. Full-page capture repeated the upper viewport, so it does not establish whole-README pixel acceptance. Aside local-file navigation was unavailable; no new browser access grant or bypass was attempted. The separately authorized repository browser suite produced the actual local images/PDFs above.

The 33 original duration/print VM cases also execute in the composed full suite. Aggregate qualification is4,208 PASS/0 FAIL/90 historical conditional cases not selected, all221 feature cases run, artifact131 and actual scripts-disabled installation pass. VM/event-state and PDF checks remain distinct from physical/native printing.

**Remaining issue10 gates:** native print dialog cancellation/physical printing, assistive technology, actual browser zoom (CSS zoom is separate), complete README pixel inspection and wider visual/accessibility acceptance are NOT RUN. Earlier dated NOT RUN records remain historical evidence; this bounded PR qualification does not close issue10 or establish full product/release/real-user acceptance. Immutable-source CI, authorized merge and final-main CI are recorded separately after observation.
