import { createHash } from "node:crypto";
import { SafeError } from "../privacy/diagnostics.js";
import { REPORT_CSS } from "./styles.js";

export const EVIDENCE_HTML_BYTES = 1_048_576;
export type EvidenceCell = string | number | null;
const CSS = REPORT_CSS + `
.evidence-page .series{break-inside:auto}.evidence-page .day-chart{list-style:none;padding:0}.evidence-page .day-chart li{margin:12px 0}.evidence-page .day-chart svg{max-width:none}.evidence-page .evidence-links{overflow-wrap:anywhere}.evidence-page .series th:first-child{min-width:110px}.evidence-page .skip-link{position:absolute;left:-10000px}.evidence-page .skip-link:focus{position:static}.evidence-page .sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.evidence-page .sources article{min-width:0}.evidence-page .sources .panel{margin:0}.evidence-page .provenance{overflow-wrap:anywhere}
@media print{.evidence-page .day-chart{display:none}.evidence-page details{break-inside:auto}}
`;
export function htmlText(value: EvidenceCell): string {
  const text = value === null ? "Unavailable" : String(value);
  if (text.length > 4096) throw new SafeError("REPORT_LIMIT");
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    .replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function numericText(value: number | null): string {
  if (value === null) return "Unavailable";
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new SafeError("INVALID_ARGUMENT");
  return String(value);
}
function anchor(id: string): string {
  if (!/^[a-z][a-z0-9-]{0,95}$/.test(id)) throw new SafeError("INVALID_ARGUMENT");
  return id;
}
export function evidenceLink(id: string, label: EvidenceCell): string {
  return `<a href="#${anchor(id)}">${htmlText(label)}</a>`;
}
export function omissions(label: string, shown: number, total: number): string {
  if (!Number.isSafeInteger(shown) || !Number.isSafeInteger(total) || shown < 0 || total < shown) throw new SafeError("INVALID_ARGUMENT");
  return `<p class="omission">${htmlText(label)}: shown=${shown}/${total}; omitted=${total - shown}.</p>`;
}
/** Text-only cells: callers cannot smuggle arbitrary HTML into evidence tables. */
export function evidenceTable(id: string, caption: string, columns: readonly string[], rows: readonly (readonly EvidenceCell[])[]): string {
  const captionId = `${anchor(id)}-caption`;
  const body = rows.map(row => {
    if (row.length !== columns.length) throw new SafeError("INVALID_ARGUMENT");
    return `<tr>${row.map((cell, i) => i === 0 ? `<th scope="row">${htmlText(cell)}</th>` : `<td>${htmlText(cell)}</td>`).join("")}</tr>`;
  }).join("");
  return `<div class="table-wrap" tabindex="0" role="region" aria-labelledby="${captionId}"><table><caption id="${captionId}">${htmlText(caption)}</caption><thead><tr>${columns.map(c => `<th scope="col">${htmlText(c)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}
/** A bounded, decorative bar; visible text and tables always carry the same values. */
export function evidenceBar(value: number | null, denominator: number | null): string {
  if (value === null || denominator === null) return `<span class="muted">Unavailable</span>`;
  numericText(value); numericText(denominator);
  if (denominator === 0) return `<span class="muted">No positive denominator</span>`;
  if (value > denominator) throw new SafeError("INVALID_ARGUMENT");
  const width = (value / denominator * 100).toFixed(6);
  return `<svg class="native-share-bar" viewBox="0 0 100 8" aria-hidden="true" focusable="false"><rect class="native-share-track" width="100" height="8"/><rect class="native-share-value" width="${width}" height="8"/></svg>`;
}
/** IDs remain Map keys, never serialized. Aliases are local to this report only. */
export function evidenceAliases(ids: Iterable<string>, prefix: string): ReadonlyMap<string, string> {
  anchor(prefix);
  return new Map([...new Set(ids)].sort().map((id, i) => [id, `${prefix}-${i + 1}`]));
}
export function evidenceAlias(aliases: ReadonlyMap<string, string>, id: string): string {
  const value = aliases.get(id);
  if (value === undefined) throw new SafeError("INVALID_ARGUMENT");
  return value;
}
/** body is owned template markup, never JSON or user-supplied HTML. */
export function evidencePage(title: string, lead: string, body: string, limitations: readonly string[]): string {
  const hash = createHash("sha256").update(CSS).digest("base64");
  const csp = `default-src 'none'; script-src 'none'; style-src 'sha256-${hash}'; img-src 'none'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${htmlText(csp)}"><title>${htmlText(title)} · AgentProf</title><style>${CSS}</style></head><body class="evidence-page"><a class="skip-link" href="#content">Skip to report</a><main id="content"><header><div class="wordmark">AgentProf</div><p class="eyebrow">Local evidence · offline report</p><h1>${htmlText(title)}</h1><p class="lead">${htmlText(lead)}</p><p class="notice">Stored observations, not complete history, productivity or proven savings. Report-local aliases are not persistent identities.</p></header>${body}<footer><h2>Limits and interpretation</h2>${limitations.map(l => `<p>${htmlText(l)}</p>`).join("")}<p>No scripts, remote assets, automatic actions or raw source data are embedded. Complete machine-readable evidence remains available from the original command without --output.</p></footer></main></body></html>`;
  if (Buffer.byteLength(html, "utf8") > EVIDENCE_HTML_BYTES) throw new SafeError("REPORT_LIMIT");
  return html;
}
