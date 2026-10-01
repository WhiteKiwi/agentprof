# Report preview verification

2026-09-30, based on main `c3856249bdc0a9c19b856ca32c97d3484e189176`; Node v24.19.0, Linux.

- PASS: `node report/build.mjs` produces the offline HTML deterministically
- PASS: `node --test report/tests/*.test.mjs` (11 tests): fixed values/scope/capability labels; CSP hashes and absence of remote-resource strings; escaped hostile text and omitted unexpected raw fields; numeric/ID validation; empty coverage and insight states
- BLOCKED before browser launch: `node report/tests/browser.mjs`, then the same command with execution escalation. Installed Chromium fails with `socket() failed: Operation not permitted` in `process_singleton_posix.cc`. No permission bypass or alternate launch flags were attempted
- BLOCKED: dot cloud browser rejects the local `file:` preview under its URL policy (only HTTP/HTTPS allowed). No alternate protocol/proxy workaround was attempted
- NOT RUN: actual browser visual inspection, screenshots, viewport reflow, keyboard/print/no-JavaScript runtime, runtime CSP and network monitoring, browser XSS execution test. The browser suite is included for an environment where Chromium can start
- NOT RUN: full product build/test/runtime matrix, real CLI/report parity or provider analysis. No product source, package configuration or CLI implementation is changed in this slice

This is a draft presentation implementation with browser verification outstanding. It is not production accessibility certification or a privacy-boundary implementation. The fixed fixture is synthetic; there are no real logs or measured performance claims.

Static CSS inspection confirms narrow-screen media rules, zero-minimum grid tracks, text wrapping, local table scrolling, native disclosures, hidden no-JS controls and reduced-motion rules. These are implementation hooks, not proof of correct 320px rendering.

Visual-first revision: 11 tests pass, including numeric chart domains, null/zero marks, integer token partition/sample validation, exact timeline endpoints, pending tick semantics, invalid spans and SVG/text injection escaping. No new browser launch attempt was made; visual rendering of the revised page is NOT RUN. Prior Chromium and cloud-file restrictions remain the verification blocker.

## Detailed timing revision — 2026-10-01 UTC

PASS on Node v24.19.0 / Linux: build and all 20 tests via `node --test report/tests/*.test.mjs`. Additional independent expectations cover same-scope cumulative shares, 4/5 terminal timing coverage plus a separate pending API/tool call, overlap unions, 200% non-additive category occupancy, command count/mean/max and category/cohort/window denominators, missing versus measured zero, duration-only placement, status exclusions, bounded size/invalid values/overflow, alias consistency and safe links/escaping. All 53 generated HTML IDs are unique and 99 fragment/disclosure references resolve (static inspection).

A first arithmetic assertion failed on binary floating-point representation of one-third; the assertion now checks a tight numerical tolerance without changing the expected duration/share oracle. The final suite passes. Actual browser rendering, mobile reflow, runtime interactions/CSP/offline requests, print and no-JavaScript browser behavior remain NOT RUN under the previously documented restrictions. The existing browser suite is retained; no local browser/security workaround or user-computer task was started. Full product runtime/build tests are not replaced by these report-focused checks.
