/* Optional progressive enhancement. No network, storage, parsing or analytics. */
(() => {
  'use strict';
  const root = document.documentElement;
  // Reuse the unchanged supplied PNG without duplicating its bytes in HTML.
  document.querySelector('#favicon').href = document.querySelector('#brand-mark').src;
  const theme = document.querySelector('#theme');
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    root.dataset.theme = theme.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme.value;
  }
  theme.addEventListener('change', applyTheme);
  systemTheme.addEventListener('change', () => { if (theme.value === 'system') applyTheme(); });

  const filter = document.querySelector('#evidence-filter');
  const insights = [...document.querySelectorAll('.ap-insight')];
  const emptyResults = document.querySelector('#empty-results');
  function filterInsights() {
    let visible = 0;
    for (const insight of insights) {
      insight.hidden = filter.value !== 'all' && insight.dataset.evidence !== filter.value;
      if (!insight.hidden) visible++;
    }
    emptyResults.hidden = visible !== 0;
    document.querySelector('#filter-status').textContent = `Showing ${visible} of ${insights.length} examples`;
  }
  filter.addEventListener('change', filterInsights);
  document.querySelector('#reset-filter').addEventListener('click', () => {
    filter.value = 'all'; filterInsights(); filter.focus();
  });
  function openEvidence(id) {
    const details = document.getElementById(id);
    if (!details || details.tagName !== 'DETAILS') return;
    filter.value = 'all'; filterInsights(); details.open = true;
    details.querySelector('summary').focus();
  }
  document.querySelectorAll('[data-open-evidence]').forEach(link => {
    link.addEventListener('click', () => openEvidence(link.dataset.openEvidence));
  });
  // Direct fragment navigation works on initial load and with browser back/forward.
  function revealHash() {
    const id = location.hash.slice(1);
    openEvidence(id);
    const section = id === 'components' ? 'components' : (id === 'insights' || id.endsWith('-evidence') ? 'insights' : 'overview');
    document.querySelectorAll('.ap-nav a').forEach(link => {
      if (link.getAttribute('href') === `#${section}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  addEventListener('hashchange', revealHash);
  if (location.hash) revealHash();

  let presses = 0;
  document.querySelector('#sample-action').addEventListener('click', () => {
    presses++;
    document.querySelector('#action-status').textContent = `Preview action completed ${presses} ${presses === 1 ? 'time' : 'times'}. Nothing was saved or sent.`;
  });
  const label = document.querySelector('#sample-label');
  label.addEventListener('input', () => {
    const invalid = !label.value.trim();
    label.setAttribute('aria-invalid', String(invalid));
    document.querySelector('#label-error').hidden = !invalid;
  });
  document.querySelector('#print-report').addEventListener('click', () => print());
  // Print all evidence without its screen-only empty notice; preserve screen state.
  let printState;
  addEventListener('beforeprint', () => {
    if (printState) return;
    printState = {
      details: [...document.querySelectorAll('details')].map(details => [details, details.open]),
      emptyHidden: emptyResults.hidden,
    };
    printState.details.forEach(([details]) => { details.open = true; });
    emptyResults.hidden = true;
  });
  addEventListener('afterprint', () => {
    if (!printState) return;
    printState.details.forEach(([details, wasOpen]) => { details.open = wasOpen; });
    emptyResults.hidden = printState.emptyHidden;
    printState = undefined;
  });
})();
