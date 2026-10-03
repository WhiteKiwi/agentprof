import { SafeError } from "../privacy/diagnostics.js";
import { resolveDataDirectory } from "../privacy/paths.js";
import { identity } from "../db/source-validation.js";
import { validateSourceSelection } from "./stats.js";
import { validateReportPath, writeReportOutput } from "../report/write-output.js";
import type { ReportArguments, ReportInternalOptions, ReportResult } from "./report.js";

export function validateUnifiedReportArguments(options: ReportArguments, internal: ReportInternalOptions = {}) {
  if (options.unified !== true || internal.expectedRevision !== undefined && (!Number.isSafeInteger(internal.expectedRevision) || internal.expectedRevision <= 0)
    || options.codexRoot !== undefined && (!Array.isArray(options.codexRoot) || options.codexRoot.length !== 0)
    || options.claudeRoot !== undefined && (!Array.isArray(options.claudeRoot) || options.claudeRoot.length !== 0)) throw new SafeError("INVALID_ARGUMENT");
  if (options.source === undefined || options.output === undefined) throw new SafeError("REPORT_SELECTION_REQUIRED");
  const sourceId = validateSourceSelection(options.source), output = validateReportPath(options.output);
  if (!/\.(?:html|htm)$/i.test(output)) throw new SafeError("INVALID_ARGUMENT");
  if (options.dataDir !== undefined) validateReportPath(options.dataDir);
  const directory = validateReportPath(resolveDataDirectory(options.dataDir === undefined ? {} : { dataDir: options.dataDir }));
  return { sourceId, output, directory };
}
export async function runUnifiedReport(options: ReportArguments, internal: ReportInternalOptions = {}): Promise<ReportResult & { readonly layout: "unified" }> {
  const { sourceId, output, directory } = validateUnifiedReportArguments(options, internal);
  const { withReadOnlyStore } = await import("../db/read-only.js");
  const { createSourceStore } = await import("../db/source-store.js");
  const { buildUnifiedSourceReport } = await import("../report/unified-model.js");
  const model = await withReadOnlyStore(directory, (db, key) => {
    try { identity(sourceId, "source", key); } catch { throw new SafeError("INVALID_IDENTITY_KEY"); }
    const source = createSourceStore(db, key).readSource(sourceId);
    if (source === null) throw new SafeError("SOURCE_NOT_FOUND");
    if (internal.expectedRevision !== undefined && source.revision !== internal.expectedRevision) throw new SafeError("SOURCE_REVISION_CHANGED");
    return buildUnifiedSourceReport(source);
  });
  const { renderUnifiedSourceReport } = await import("../report/unified-page.js");
  const publication = await writeReportOutput({ output, dataDirectory: directory, html: renderUnifiedSourceReport(model) });
  return Object.freeze({ mode: "selected_source", layout: "unified", sourceId: model.sourceId, revision: model.revision, ...publication });
}
