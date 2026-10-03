import { SafeError } from "../privacy/diagnostics.js";
import { resolveDataDirectory } from "../privacy/paths.js";
import { validateSourceSelection } from "./stats.js";
import { identity } from "../db/source-validation.js";
import { validateReportPath,writeReportOutput } from "../report/write-output.js";
import type { Publication } from "../report/write-output.js";
export type ReportArguments=Readonly<{dataDir?:string;source?:string;output?:string;codexRoot?:readonly string[];claudeRoot?:readonly string[]}>;
export type ReportResult=Publication&Readonly<{mode:"selected_source";sourceId:string;revision:number}>;
export async function runReport(options:ReportArguments):Promise<ReportResult>{
 if((options.codexRoot?.length??0)||(options.claudeRoot?.length??0))throw new SafeError("INVALID_ARGUMENT");
 if(options.source!==undefined)validateSourceSelection(options.source);if(options.output!==undefined)validateReportPath(options.output);if(options.dataDir!==undefined)validateReportPath(options.dataDir);
 if(options.source===undefined||options.output===undefined)throw new SafeError("REPORT_SELECTION_REQUIRED");
 const directory=validateReportPath(resolveDataDirectory(options.dataDir===undefined?{}:{dataDir:options.dataDir}));
 const {withReadOnlyStore}=await import("../db/read-only.js"),{createSourceStore}=await import("../db/source-store.js"),{summarizeSource}=await import("../analysis/source-summary.js"),{analyzeSourceSlowTool}=await import("../analysis/source-slow-tool.js"),{buildSourceReportModel}=await import("../report/source-model.js"),{buildSourceCommandBreakdown}=await import("../report/command-breakdown.js"),{analyzeSourceInvocationOverlap}=await import("../analysis/source-invocation-overlap.js"),{buildSourceInvocationTimeline}=await import("../report/invocation-timeline.js");
 const model=await withReadOnlyStore(directory,(db,key)=>{try{identity(options.source,"source",key);}catch{throw new SafeError("INVALID_IDENTITY_KEY");}const source=createSourceStore(db,key).readSource(options.source!);if(source===null)throw new SafeError("SOURCE_NOT_FOUND");const summary=summarizeSource(source),slow=analyzeSourceSlowTool(source),overlap=analyzeSourceInvocationOverlap(source);return buildSourceReportModel(summary,slow,buildSourceCommandBreakdown(source,slow),buildSourceInvocationTimeline(source,overlap));});
 const {renderSourceReport}=await import("../report/render.js");const html=renderSourceReport(model);const published=await writeReportOutput({output:options.output,dataDirectory:directory,html});
 return Object.freeze({mode:"selected_source",sourceId:model.summary.sourceId,revision:model.summary.revision,...published});
}
export function formatReportResult(result:ReportResult,json:boolean):string{if(json)return JSON.stringify({schema:"agentprof.cli/v1",ok:result.status==="published",command:"report",result})+"\n";return `AgentProf report ${result.status}\nOutput: ${result.output}\nSource: ${result.sourceId} | revision: ${result.revision}\nBytes: ${result.bytes} | published: true | target: ${result.targetVerification}\nDurability: ${result.durability} | temporary cleanup: ${result.cleanup}\nWarnings: ${result.warnings.join(", ")||"none"}\n`;}
