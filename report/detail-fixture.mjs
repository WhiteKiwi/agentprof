/** Independent synthetic detail cohort. Safe patterns are authored, never raw logs. */
const process = (id, aliasId, alias, category, start, end) => ({ id, aliasId, alias, category, scope: 'process-runtime', evidence: 'direct', duration: end-start, start, end, status: 'success', condition: 'Synthetic project A · fixed target set · no raw arguments' });
const api = (id, aliasId, alias, start, end, status='success') => ({ id, aliasId, alias, category:'api-tool',scope:'invocation-latency',evidence:'direct',duration:end===null?null:end-start,start,end,status,condition:'Synthetic tool alias · request payload and endpoint omitted' });
export const detailFixture = {
  kind:'synthetic', id:'demo-detail', label:'Detail cohort demo-detail · 5-minute synthetic excerpt', windowSeconds:300,
  calls:[
    process('build-1','build-bundle','npm run build <target>','build',0,60),
    process('build-2','build-bundle','npm run build <target>','build',100,180),
    process('build-3','build-types','tsc --build <target>','build',220,260),
    process('test-1','test-suite','vitest run <suite>','test',40,110),
    process('test-2','test-suite','vitest run <suite>','test',210,260),
    process('search-1','search-path','rg <pattern> -- <path>','search',0,20),
    process('search-2','search-path','rg <pattern> -- <path>','search',180,220),
    api('api-1','api-query','MCP query [alias A]',20,80),
    api('api-2','api-query','MCP query [alias A]',80,140),
    api('api-3','api-query','MCP query [alias A]',140,200),
    api('api-4','api-fetch','API fetch [alias B]',200,260),
    {...api('api-5','api-fetch','API fetch [alias B]',0,null),start:null,status:'error',condition:'Terminal error; timing unavailable. No status inference from command text.'},
    api('api-6','api-fetch','API fetch [alias B]',280,null,'pending')
  ]
};
