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
