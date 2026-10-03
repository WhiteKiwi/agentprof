# AgentProf Design Guidelines

Version 0.1 candidate · 2026-09-30 · Design foundation, not a shipped profiler

## Brief and authority

AgentProf helps developers locate time hotspots and repeated work in local coding-agent logs. Its interface must make evidence easier to inspect than its mascot is to admire. This guideline covers offline HTML reports, a reusable component foundation for a future local dashboard, and the provisional README. English component labels and Korean explanatory content must both reflow. Light and dark report themes are required by SPEC. The local dashboard itself remains out of v0.1 scope.

**Visual thesis: a quiet instrument panel with one warm trace.** Charcoal surfaces, crisp type and restrained ember orange carry the supplied dark/technical “FOLLOW THE SLOW.” direction. Brand orange marks navigation and identity; it is never automatic evidence of failure or waste. The brand image can be expressive. Analytical surfaces remain flat and readable.

Status vocabulary: `inherited` is a prior user/product decision; `observed` is inspected source material; `proposed` is this candidate's design choice; `verified` requires named checks. Artifact state (`candidate`, `approved`, `implemented`) is separate. A working specimen does not approve a final logo or ship the profiler.

## Research ledger

| Source | Observed method | AgentProf decision | Authority |
| --- | --- | --- | --- |
| User-provided trace-style image, inspected locally | Dark technical treatment, orange salamander trace, white/orange name, short tracked tagline | Dark README brand scene; restrained warm accent in data UI | User reference; observed |
| Three supplied flat salamanders and [existing repository references](DESIGN.md) | Simple silhouette and large eye; light, dark/orange and orange-field variants | Use dark/orange variant provisionally for compact identity; reuse existing repository original without alteration | Inherited mascot; proposed selection |
| [Create Design Guideline](https://github.com/WhiteKiwi/skills/blob/aeb0d118784de28aa616db2066a89c94eff4d850/skills/create-design-guideline/SKILL.md) | Latest standalone creation workflow and deliverable/color references read before finalization | Explicit pair/state tables, execution contract and separate candidate/implementation/verification state | Requested current skill, verified 2026-09-30 |
| [Design Guidelines skill](https://github.com/WhiteKiwi/skills/tree/main/skills/design-guidelines) | Brief → semantic tokens → component state contracts → rendered QA | Keep this rationale, concise root DESIGN.md and implementation together | Requested workflow |
| [Design Index](https://github.com/WhiteKiwi/design-index), [systems guide](https://github.com/WhiteKiwi/design-index/blob/main/references/design-systems.md) | Principles → semantic system → native primitives → components | Framework-free CSS and native controls first; no registry copying or premature dashboard framework | Requested reference |
| [Recent](https://recent.design/) | Inspected gallery: quiet neutral chrome, clear typography, expressive work isolated within tiles | One distinctive brand area; neutral evidence content. Do not import gallery motion, ads, assets or code | Inspiration only; viewed 2026-09-30 in cloud browser |
| [Kiwi / PIP source contract](https://github.com/WhiteKiwi/kiwi-design-system/blob/main/DESIGN.md), [tokens](https://github.com/WhiteKiwi/kiwi-design-system/blob/main/packages/tokens/src/theme.css) | Quiet neutral canvas, one protagonist, semantic states and 44px targets | Shared WhiteKiwi editorial/neutral discipline; AgentProf keeps its specifically requested ember/salamander brand rather than replacing it with kiwi green | User-directed shared design reference, source inspected 2026-09-30 |
| [Radix scale anatomy](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) | Separate surface, boundary, solid and text jobs | Brand field and brand text use separate colors; roles map independently per theme | Official method; no copied code |
| [WCAG contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Foreground/background thresholds depend on role | Ordinary text ≥4.5:1; essential controls/graphics ≥3:1; contrast is one check, not full conformance | Standard guidance |

References were studied for methods and composition. No third-party artwork, font, CSS library or component implementation is adopted. The supplied screenshot is an image reference, not a claim that the mascot illustration or logo is a newly authored final identity.

## Operating principles

1. **Evidence first.** Label the period, timing scope, sample and coverage next to the value. Never hide them solely in hover tooltips.
2. **Unknown is information.** `—` has a visible “Unknown” or “Unsupported” label and reason. A measured zero is `0` with its evidence. Pending, empty, estimated, unavailable and failed are separate states.
3. **One accent, many meanings.** Orange is brand. Success is green, error red, informational evidence blue, caution amber, unknown neutral; text and symbols also carry meaning.
4. **Density through alignment.** Use tabular numbers and compact metadata, not tiny type or many nested cards. A chart gets a readable text/table equivalent.
5. **Quiet by default.** No continuous glow, auto-animation, particles, glass, remote fonts, decorative chart gradients or background video in analytical views.

## Layout and typography

- Container: maximum 1240px; desktop gutter 40px, narrow gutter 16px. Use a 4px spacing rhythm: 4, 8, 12, 16, 24, 32, 48, 64.
- Desktop overview: readable heading and period first; summary strip, time breakdown, then ranked insights and evidence. Avoid seven equally loud panels.
- Typography: local system sans (`system-ui`, platform sans, Korean sans fallback); local monospace for commands/IDs. No external font fetch. Body 16px/1.55, metadata ≥12px/1.5, section 20–24px, display 40–64px with responsive clamp. Numbers use tabular figures. Limit prose to ~70 characters per line; long Korean labels wrap.
- Radius: 6px controls, 10px panels, full round only for small badges. Spacing, alignment and surface differences lead separation; thin borders group evidence when needed. No floating shadow on every card.
- Report headings describe observations, not certainty: “Repeated failures”, “Observed time”, “Check setup”. Never “You wasted 40%” or “Guaranteed savings”.

## Color role contract

Canonical implemented values live in `design/tokens.css`; components consume semantic `--ap-*` roles, never choose palette literals. Primitive relationships use OKLCH (neutral low chroma, warm brand hue); exact sRGB fallbacks are the runtime authority for measurements. Keep an intentional fixed-dark README scene separate from switchable report themes.

| Role | Dark starting value | Light starting value | Use / avoid |
| --- | --- | --- | --- |
| canvas | #111315 | #F5F6F7 | Overall plane; do not tint every surface orange |
| surface | #191C20 | #FFFFFF | Data reading plane |
| surface-raised | #23272D | #EAEDF0 | Hover / nested metadata |
| text | #F5F6F7 | #171A1E | Primary content |
| text-muted | #B2B8C2 | #545E6B | Readable supporting text, never exempt from contrast |
| border | #424B57 | #B4BDC8 | Dividers; essential control boundaries need separate stronger role |
| control-border | #7B8796 | #697583 | Essential input/control boundary |
| brand-field | #FF8A3D | #FF8A3D | Primary button / identity field |
| on-brand | #171A1E | #171A1E | Always dark on orange; white/orange text pair forbidden |
| brand-text / focus | #FFAB73 | #944200 | Link/focus against neutral planes; verify every relevant adjacent color |
| success | #79D6A3 | #14633A | Confirmed successful state + text/symbol |
| warning | #EDC46B | #765100 | Caution/partial coverage; not brand identity |
| danger | #FF9993 | #A32723 | Confirmed failure, never unknown |
| info | #9AC4FF | #245B9B | Observed/direct evidence metadata |

Values are implemented in the candidate scaffold; selected opaque pairs passed automated measurement, while browser state rendering remains NOT RUN. If implementation corrects a contrast pair, update this table and QA record in the same change. No alpha-dependent text pairs; decorative border contrast is not a claim of essential-control compliance. Disabled controls remain visibly disabled and non-interactive; do not use disabled styling for supporting text.

## Component contracts

| Component | Required content and behavior |
| --- | --- |
| Report shell | Product mark, synthetic/real dataset label, snapshot period, theme selector, skip link; no live indicator for a static report |
| Button / link | Native element; rest, hover, active, focus-visible and disabled; explicit text; 44px target policy (project policy, stricter than AA minimum) |
| Metric | Value/unit, title, evidence, n/coverage and scope; unknown and zero examples; no invented benchmark arrow |
| Evidence badge | Direct / Observed / Estimated / Unknown / Unsupported text; color is supplementary |
| Time breakdown | Same scope/denominator, labeled values, text equivalent; independent overlapping durations never become a 100% pie |
| Insight | Rule/version, severity text, observed impact, sample/coverage, next step, evidence disclosure; Slow Tool alone is not waste |
| Evidence disclosure | Native details/summary; keyboard accessible, content remains without JavaScript; no hidden raw logs |
| Session/evidence table | Proper headers/caption; narrow layout retains all required fields or controlled labeled scroll, never whole-page overflow |
| Input/select | Visible label, help/error association; ordinary text contrast; native keyboard interaction |
| Empty/partial/pending/error | Distinct explanatory text and safe next action; no unavailable data normalized to zero |

Interaction matrix: neutral surfaces at rest; raised surface on hover; selected state combines visible marker/text and border; `:focus-visible` uses 2px outline + 3px offset; primary button keeps dark foreground for rest/hover/active; links are underlined on text surfaces; disabled native controls do not activate. Theme changes only visual roles and never numeric values. Use native disclosure rather than custom focus traps; no modal is needed in this scaffold.

## Responsive, motion and export

| Region | 320–640px | Wider screens |
| --- | --- | --- |
| Brand/title/period | Preserve; wrap title/period, compact mark | One aligned row |
| Summary metrics | Recompose into one column | Three-column strip |
| Breakdown + insights | Recompose in reading order | Balanced split where space allows |
| Evidence details | Collapse with native disclosure; explicit summary | Same accessible disclosure |
| Tables/long IDs | Wrap meaningful text; local scroll only where essential | Aligned data columns |

No essential content is deferred to desktop. Check 320px, typical phone and desktop in both themes, keyboard focus and 200% zoom/reflow. Transition only state feedback ≤160ms; reduced-motion removes nonessential transitions. No entry animation gate. Print uses light backgrounds and expands important evidence; do not print dark canvas or navigation controls. Fixed-dark brand artwork is a documented exception.

## Reuse and adoption

The reusable scaffold is `design/`: CSS tokens and components, documented semantic HTML, optional vanilla behavior and a generated self-contained specimen. The specimen is synthetic visual QA data, not an analyzer or a live dashboard. Consumers may inline its CSS/JS for offline reports or reuse the same classes/tokens in a future dashboard. Do not add server, watcher, React runtime or dependencies just to demonstrate it.

Adoption: (1) verify this specimen (2) use tokens/primitives in P5 minimal report (3) connect actual snapshot contracts, injection defenses and product acceptance (4) expand P6 details. Keep pending product implementation checks open. A new visual feature cannot redefine METRICS or claim that P5/P6 is complete.

## Release checks and open decisions

Record exact commands and rendered evidence in [DESIGN-QA.md](DESIGN-QA.md). Check themes, 320px/phone/desktop, keyboard/repeated controls, reduced motion, zero/unknown, malicious strings, offline requests, long Korean labels, focus/disabled/error/selected states, print and all actual contrast pairs. A screenshot is visual evidence; it is not a complete accessibility audit.

Final logo selection/vector master remains open. This work may use the supplied flat dark/orange salamander unmodified as a provisional logo/favicon. No tracing, cropping or generated redraw is needed. README and specimen must label design-stage status and synthetic metrics clearly.

## Implemented candidate details and measured pairs

Updated against `WhiteKiwi/skills` create-design-guideline at `aeb0d118784de28aa616db2066a89c94eff4d850`. Candidate implementation is present; final logo approval and browser QA are not implied.

| Additional role | Dark | Light |
| --- | --- | --- |
| observed / observed-soft | #C3ACF2 / #302738 | #654194 / #F2EBFA |
| brand-soft | #38281F | #FFF0E5 |
| success-soft | #183027 | #E5F4EB |
| warning-soft | #342B18 | #FFF2D4 |
| danger-soft | #382221 | #FFEDEB |
| info-soft | #202D40 | #E9F1FF |
| unknown-soft | raised surface | raised surface |
| brand-hover / brand-active | #FFA05F / #F87929 | #FFA05F / #F87929 |

| Primitive intent (OKLCH) | sRGB authority | Purpose / avoid |
| --- | --- | --- |
| ink (0.22 0.01 255) | #171A1E | Dark foreground; no component direct selection |
| paper (0.97 0.002 255) | #F5F6F7 | Neutral reading/canvas family |
| ember (0.75 0.16 52) | #FF8A3D | Brand field; not success/error semantics |

OKLCH values document perceptual intent, not a claim of exact conversion to the runtime hex fallback. Measured fallback pairs are authoritative.

| Pair | Measured ratio (display rounded) | Allowed use |
| --- | --- | --- |
| #171A1E / #F87929 | 6.4494:1 | Primary active text, both themes |
| #545E6B / #EAEDF0 | 5.6014:1 | Light secondary text on raised surface |
| #7B8796 / #23272D | 4.1071:1 | Dark essential control boundary |
| #697583 / #EAEDF0 | 3.9953:1 | Light essential control boundary |

Gates use full precision; exact values can be regenerated with `node design/tests/contrast.mjs`. Forbidden: white text on ember; status communicated only by hue; muted/disabled opacity used for active explanatory copy. These measurements do not prove full accessibility or correct browser rendering.

| Family / theme | Rest | Hover | Active/selected | Focus-visible | Disabled |
| --- | --- | --- | --- | --- | --- |
| Primary / both | on-brand + brand-field | on-brand + brand-hover | on-brand + brand-active | theme focus outline with offset | native disabled + muted/raised |
| Neutral control / both | text + surface, control-border | text + raised | visible state/border + text | theme focus on adjacent neutral | native disabled, no activation |
| Text link / both | brand-text + underline | same readable role | same role; destination state explicit | theme focus ring | use text instead of fake disabled link |
| Navigation / both | muted readable text | text + raised | brand-text, visible underline/current state | theme focus ring | no disabled nav in specimen |
| Input / both | text + surface, control-border | boundary retained | native editing; error text + danger border | theme focus ring | native disabled when used |
| Insight/disclosure / both | surface + readable text | summary raised | explicit selected marker; open disclosure | summary theme focus | no fake disabled evidence |

Governance: changes to semantic roles update tokens and this guideline together; proposed exceptions require reason, affected surface and review at the next design revision. Product owner retains final brand authority. Adoption remains P5 minimal report first; unresolved browser QA is a gate before production use.

### Shared WhiteKiwi tone

The README follows Kiwi/PIP's wide cover → concise proposition → direct document links → evidence/status → repository map rhythm. Ordinary report surfaces aim for roughly 90% neutral area with one primary accent focus per viewport; this is a design intent, not a measured screenshot result. Static information panels do not acquire pointer/lift/arrow affordances. The requested dark/ember mascot direction is a product-specific brand exception, and the 120ms specimen transition is a short feedback exception to PIP's 150–220ms range. Motion disappears under reduced motion.

The shared public site is [design.whitekiwi.link](https://design.whitekiwi.link/); live access through the research tool was unavailable in this pass, so decisions are grounded in its repository README, DESIGN.md and canonical token source rather than an unobserved live screen. No Kiwi code/font package dependency is imported into the offline scaffold.

## Issue #10 bounded regression clarification — 2026-10-03

The duration primitive preserves full sub-minute precision and the existing
millisecond-rounded minute display. A remainder rounded to 60 seconds carries
into the next minute (`119.9999` → `2m`, `3599.9999` → `60m`); no hours unit is
introduced. Unknown, measured zero and invalid-input behavior are unchanged.

The print view includes every synthetic insight and suppresses the screen-only
empty-filter notice. Before-print enhancement snapshots disclosure open states
and the notice's hidden state, expands evidence and hides the notice; after-print
restores the snapshot without changing the selected filter. Repeated before-print
notifications must retain the first snapshot, and an extra after-print notification
must not undo later screen changes. The same restoration path applies to print
cancellation notifications. Existing print CSS also hides the notice when print
events do not run.

These are candidate component semantics, not new product capabilities. Ordinary
Node/VM regression and unchanged static/contrast checks are recorded in
[DESIGN-QA](DESIGN-QA.md#issue-10-bounded-regression-verification--2026-10-03).
Actual browser layout, native print/cancellation, accessibility and README GitHub
rendering remain unverified; the VM fixture supplies no browser-rendering evidence.
