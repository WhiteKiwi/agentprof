/** Hand-authored synthetic display fixture. No source logs or analyzer output.
 * The timing strip is a deliberately exclusive 30-minute example window.
 * The 15-second waste example uses the canonical overlap contract only. */
export const fixture = {
  period: '30 Sep 2026 · 09:00–09:30 UTC',
  metrics: [
    { label: 'Observed window', value: '30', unit: 'min', note: 'One synthetic session · elapsed wall-clock window' },
    { label: 'Window coverage', value: '80', unit: '%', note: '24 of 30 minutes covered · direct + observed, kept separate' },
    { label: 'Tool calls with timing', value: '32', unit: '/ 40', note: '20 direct · 12 paired · 8 without timing evidence' }
  ],
  breakdown: [
    { label: 'Direct duration intervals', seconds: 840, total: 1800, evidence: 'direct' },
    { label: 'Paired timestamp intervals', seconds: 600, total: 1800, evidence: 'observed' },
    { label: 'Uncovered window', seconds: 360, total: 1800, evidence: 'unknown' }
  ],
  insights: [
    { id: 'retry-pattern', selected: true, evidence: 'observed', rule: '01 / INTERVAL OVERLAP · GEOMETRY SPECIMEN', title: 'Two patterns can share the same time', seconds: 12,
      description: 'Illustrative retry and repeated-error intervals share time. This demonstrates union geometry, not diagnostic eligibility.', sample: '2 pattern intervals · same 20s evidence window', scope: 'Paired timestamp intervals; no causal claim',
      nextStep: 'In a real report, inspect the qualifying events and rule criteria before deciding whether a retry was necessary.',
      caveat: 'Retry [0,12) + repeated error [7,15) = 15s union, not 20s. Geometry only: these two rows do not establish the repeat-count or session criteria of an emitted diagnostic.',
      events: [{ id: 'demo-retry', interval: '0–12s', evidence: 'observed', result: 'Repeated failure' }, { id: 'demo-error', interval: '7–15s', evidence: 'observed', result: 'Same error pattern' }] },
    { id: 'slow-tool', selected: false, evidence: 'direct', rule: '02 / DURATION HOTSPOT · COMPONENT SPECIMEN', title: 'A closer look at one build', seconds: 95,
      description: 'One direct-duration call demonstrates the evidence component. This is not an emitted Slow Tool diagnostic and is excluded from Detected Waste.', sample: '1 of 20 direct-duration calls', scope: 'No diagnostic threshold applied',
      nextStep: 'Check the build scope and cache behavior. Compare like-for-like work before changing the workflow.',
      caveat: 'No real baseline, avoidable-time estimate, or improvement rate is inferred from this example.',
      events: [{ id: 'demo-build', interval: '95s duration', evidence: 'direct', result: 'Completed' }] },
    { id: 'missing-timing', selected: false, evidence: 'unknown', rule: '03 / COVERAGE NOTE · DEMO 0.1', title: 'Some calls have no timing evidence', seconds: null,
      description: 'Eight calls have no usable start/end pair or direct duration. Missing time stays unknown.', sample: '8 of 40 calls', scope: 'Not included in timing distributions',
      nextStep: 'Check the source format and supported fields when the real parser exists. Do not substitute zero.',
      caveat: '정보가 없는 값은 0이 아닙니다. 긴 한국어 설명과 식별자도 정보 손실 없이 줄바꿈합니다.',
      events: [{ id: 'demo-long-identifier-without-private-project-paths-or-user-content', interval: 'Unknown', evidence: 'unknown', result: 'Status unknown' }] }
  ]
};
