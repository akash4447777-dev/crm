'use strict';
const C=require('./security-core.cjs'),R=require('./statements-core.js'),{randomUUID}=require('node:crypto');
module.exports=function({service:S,out,body,saveUsers}){return async(req,res,u,M,me)=>{
 if(!u.startsWith('/statements'))return false;
 if(!['/statements/report','/statements/preferences'].includes(u)||u==='/statements/report'&&M!=='POST'||u==='/statements/preferences'&&!['GET','PUT'].includes(M)){out(res,404,{error:'Unknown statements endpoint.'});return true;}
 if(!C.isSuper(me)&&!C.scope(me).size)C.fail(403,'No company assigned.');
 if(u==='/statements/preferences'&&M==='GET'){const p=me.statementExportPreferences||null;out(res,200,{preferences:p,storage:'signed shared database'});return true;}
 const input=await body(req);
 if(u==='/statements/preferences'){
  if(!saveUsers)C.fail(503,'Statement preference storage is not configured on this backend.');if(input.userId&&input.userId!==me.id)C.fail(403,'Only your own export preferences may be changed.');
  const options=R.options(input.options);if(!Number.isSafeInteger(input.base)||input.base<0)C.fail(422,'Invalid preference version. Refresh settings before saving.');
  const {env}=await S.readData(me);const ids=new Map((env.data.w||[]).map(w=>[String(w.id),w]));for(const id of options.companies)if(!env.data.cos?.[+id-1]||!C.can(me,id))C.fail(403,'Saved company selection is not authorized.');for(const id of options.workerIds)if(!ids.has(id)||!C.can(me,ids.get(id).c))C.fail(403,'Saved worker selection is missing or not authorized.');
  let saved;await saveUsers(list=>{const current=list.find(x=>x.id===me.id);if(!current||current.status!=='active'||(current.av||0)!==(me.av||0))C.fail(401,'Your account changed. Sign in again.');const prior=current.statementExportPreferences;if((prior?.version||0)!==input.base)C.fail(409,'Your defaults changed on another device. Reload settings before saving; nothing was overwritten.');saved={schema:17,version:input.base+1,updatedAt:new Date().toISOString(),options};current.statementExportPreferences=saved;return {ok:true};},me,'statement-preferences-save');out(res,200,{preferences:saved,storage:'signed shared database'});return true;
 }
if(input.data)C.fail(422,'Report data must come from the canonical server, not the browser.');
 const raw=input.options||me.statementExportPreferences?.options;if(!raw)C.fail(422,'Save your Advance Statement defaults first.');const o=R.options(raw),format=input.format||'pdf';if(!['pdf','preview','print','zip','csv','xlsx'].includes(format))C.fail(422,'Unsupported statement format.');
 for(let attempt=0;attempt<6;attempt++){
  const {row,env}=await S.readData(me);if(!row)C.fail(422,'No shared CRM records. Import an authorized backup first.');
  for(const id of o.companies)if(!env.data.cos?.[+id-1]||!C.can(me,id))C.fail(403,'Requested company is not authorized.');
  const byId=new Map((env.data.w||[]).map(w=>[String(w.id),w]));for(const id of o.workerIds){const w=byId.get(id);if(!w||!C.can(me,w.c))C.fail(403,'Requested worker is not authorized.');}
  const exportId=randomUUID(),sourceVersion=row.ver,report=R.build(C.project(env.data,me),o,{exportId,sourceVersion,source:'canonical shared database (authorized snapshot)'});
  const changes=report.companies.map(g=>({collection:'statement-export',id:exportId,company:g.id,before:null,after:{action:'authorization only, not confirmed file delivery',format,from:o.from,to:o.to,workers:g.workers,closingPaise:g.closing,template:o.template,paper:o.paper,language:o.language,transactionType:o.transactionType,fields:o.fields,dateFormat:o.dateFormat,sourceVersion}}));
  const result=await S.commit('data',row.ver,env,me,'statement-export-authorized',changes,{exportId,sourceVersion});
  if(result.ok){out(res,200,{report,auditVersion:result.ver});return true;}
 }
 C.fail(409,'The shared data changed repeatedly. Refresh and retry the report.');
};};
