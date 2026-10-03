# Unified report footer clarification — 2026-10-03

Refs #138. Before modifying the shared shell, permit exactly one additive `evidencePage` parameter: optional escaped machine-evidence guidance, with the current literal footer sentence as its default. Existing standalone renderers retain byte-identical output. The unified report must instead point to the corresponding `stats`, `insights` and `patterns --json` commands, since `report` itself requires an output path and does not export the complete analyzer JSON.

This reserves only that function signature and escaped footer interpolation in `src/report/evidence-page.ts`; CSS, CSP, escaping, tables, focus behavior and byte ceiling remain unchanged. Verify all three immutable-parent pattern HTML hashes, original history/pattern tests and a unified-specific footer assertion. Other shared helper reservations remain excluded.

Local supported-runtime typecheck/build succeeded after correcting the renderer to use the existing Slow Tool confidence object and exact `observedEligibleNativeToolDurationShare` field, rather than inferred field names. The first focused test run also exposed a guessed pattern-time label in the new test; the assertion now checks the unchanged analyzer's actual meaning and the explicit no-savings caveat. Current 44 new model/CLI tests pass, including source/fresh/open-control paths and unchanged parent renderer hashes. No hosted full-suite or installed result is claimed yet.

A real Chromium file:// navigation attempt returned ERR_BLOCKED_BY_ADMINISTRATOR before rendering. Do not disable browser restrictions or claim file-origin qualification. Any permitted local HTTP rendering check must be reported separately from file://, native macOS/Safari and full print/accessibility acceptance.
