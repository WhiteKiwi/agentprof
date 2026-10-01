/** Fixed synthetic display snapshot. Not an analyzer/provider/storage contract. */
export const snapshot = {
  kind: 'synthetic', title: 'Where the time goes',
  period: '2026-09-29 09:00–09:30', timezone: 'UTC', collectedAt: '2026-09-29 09:31 UTC',
  source: 'Hand-authored fixture / report-demo-v1',
  sessions: 2, terminalCalls: 40, timedCalls: 32, pendingCalls: 1,
  observedSpanSeconds: 1800, turnUnionSeconds: 1440, toolUnionSeconds: 600,
  wasteSeconds: null,
  tokens: { uncachedInput: 16000, cacheReadInput: 8000, output: 6000, eligible: 6, inspected: 8 },
  timeline: { label: 'Session demo-a / selected 09:00–09:05 UTC excerpt', windowSeconds: 300, spans: [
    {id:'search-a',label:'Search A',start:10,end:40,note:'Search interval overlaps Build A. Relationship beyond timing is unknown.'},
    {id:'build-a',label:'Build A',start:20,end:80,note:'Observed interval 60s. Confirmed success; synthetic process runtime also 60s, kept conceptually separate.'},
    {id:'search-b',label:'Search B',start:100,end:160,note:'Second selected search interval. This excerpt is not the entire search aggregate.'},
    {id:'build-b',label:'Build B',start:140,end:220,note:'Observed interval 80s. No causal dependency on Search B is asserted.'},
    {id:'build-c',label:'Build C',start:250,end:290,note:'Observed interval 40s. Inspect target equality before treating repetition as redundant.'},
    {id:'pending-a',label:'Pending item',start:280,end:null,note:'No completion timestamp. Excluded from duration sums; not extended to the window end.'}
  ]},
  hotspots: [
    { label: 'Build · process runtime', seconds: 180, sample: '3 / 3 terminal calls timed', evidence: 'direct' },
    { label: 'Search · call latency', seconds: 120, sample: '12 / 16 terminal calls timed', evidence: 'observed' },
    { label: 'Validation · process runtime', seconds: 0, sample: '1 / 1 terminal call timed', evidence: 'direct' },
    { label: 'Other tools · call latency', seconds: null, sample: 'Timing scopes not comparable', evidence: 'unknown' }
  ],
  insights: [{
    id: 'build-hotspot', title: 'Inspect the build setup first', rule: 'Manual review candidate · demo-v1',
    evidence: 'direct', seconds: 180,
    description: 'Three completed build calls contribute 180s of process runtime. This is a hotspot, not an emitted Slow Tool diagnostic or a waste contribution.',
    sample: '3 / 3 build calls timed · low sample', scope: 'Process-runtime sum · not wall-clock elapsed',
    nextStep: 'Check whether these calls cover the same target before changing build setup.',
    experiment: 'On the same task, compare one setup change with the baseline. Keep target, inputs and completion criteria fixed; record sample size and timing coverage.',
    guardrail: 'Retain the same required tests and review criteria. Lower time with weaker validation is not an improvement.',
    caveat: 'No baseline or causal effect is established. These calls may overlap. Their sum is not recoverable time.',
    events: [{ id: 'demo-build-1', interval: '60s process runtime', evidence: 'direct', result: 'Confirmed success' }, { id: 'demo-build-2', interval: '80s process runtime', evidence: 'direct', result: 'Confirmed success' }, { id: 'demo-build-3', interval: '40s process runtime', evidence: 'direct', result: 'Confirmed success' }]
  }]
};
