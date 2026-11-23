'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const AccountingCore=require('../accounting-core.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','crm_v38.html'),'utf8');
const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const nillScript=inline.find(s=>s.includes('New NIL checkpoints apply BEFORE'));
const smartScript=inline.find(s=>s.includes('Smart Auto NIL: preview-first'));
assert.ok(nillScript&&smartScript,'settlement scripts are embedded in the served page');
function fixture(){
 const rows=Array.from({length:45},()=>Array.from({length:9},()=>({value:null,fill:{type:'pattern',fgColor:{argb:'FFFFFFFF'}},address:''})));
 function set(r,c,value,yellow=false){const x=rows[r-1][c-1];x.value=value;x.address=String.fromCharCode(64+c)+r;if(yellow)x.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFF00'}};}
 for(const[c,n]of [[1,'BUBLY'],[4,'PRINCE'],[7,'ABHISHEK VINOD']]){set(1,c,n);set(2,c,'Date');set(2,c+1,'Amount');set(2,c+2,'Remarks');for(let d=1;d<=30;d++)set(d+2,c,`${String(d).padStart(2,'0')}-11-2026`);}
 // Screenshot-shaped entries and settlement markers.
 set(3,2,7000);set(3,3,'NILL');set(8,2,9467,true);set(8,3,'JAMA',true);
 set(3,5,2000);set(3,6,'NILL');set(7,4,'05-11-2026');set(7,6,'TILL DATE HISABB NILL',true);
 set(4,8,500);set(4,9,'NILL');set(9,8,5000);set(9,9,'NILL');set(14,8,1000,true);set(14,9,'ADV',true);
 for(const[c,v]of [[1,0],[4,'-'],[7,1000]]){
  for(const[r,label]of [[33,'ADV TOTAL'],[34,'JAMA TOTAL'],[35,'ONLINE TOTAL'],[36,'CASH / UNMARKED TOTAL'],[37,'ALL AMOUNTS TOTAL']]){set(r,c,label);set(r,c+1,250);}
  set(38,c,'FINAL TOTAL ADV');set(38,c+1,v);set(40,c,'PREVIOUS BALANCE');set(40,c+1,500);set(41,c,'NET OUTSTANDING');set(41,c+1,900);set(42,c,'OCT NILL',true);set(42,c+1,'',true);set(42,c+2,'',true);set(43,c,'HISAB NILL 31-10-26',true);
 }
 const rowObjs=rows.map(cells=>({getCell(c){return cells[c-1]||{value:null};}}));
 const worksheet={name:'November',rowCount:38,columnCount:9,getRow(r){return rowObjs[r-1];}};
 const data={cos:[{m:'BUBLYCO',n:'Factory'},{m:'PRINCECO',n:'Factory'},{m:'ABHISHEKCO',n:'Factory'}],w:[{id:1,n:'BUBLY',c:1},{id:2,n:'PRINCE',c:2},{id:3,n:'ABHISHEK VINOD',c:3}],adv:[],nl:{}};
 const context={console,Date,Math,Number,String,Object,Array,Set,Map,JSON,RegExp,Blob,Uint8Array,AccountingCore,document:{querySelector(){return null;}},D:data,today:()=> '2026-11-20',cn:c=>['BUBLYCO','PRINCECO','ABHISHEKCO'][+c-1],wn:id=>String(id),say(){},sv2(){},save(){},render(){},T:{adv:{top:()=>''}}};
 context.window=context;context.globalThis=context;vm.createContext(context);vm.runInContext(nillScript,context);vm.runInContext(smartScript,context);
 return{context,data,workbook:{worksheets:[worksheet]}};
}
test('advances tab exposes a WhatsApp PDF shortcut with a no-server file-share route',()=>{
 assert.match(html,/onclick=\"stmDlg\(\$\{w\.id\}\)\">WhatsApp PDF<\/button>/);
 assert.match(html,/Share PDF to WhatsApp \/ phone apps \(no server\)/);
 assert.match(html,/navigator\.canShare&&navigator\.canShare\(\{files:\[f\]\}\)/);
});

test('panel-only Auto NIL plans all active companies through today with zero carry and leaves future entries alone',()=>{
 const{context,data}=fixture();data.adv=[
  {id:1,w:1,d:'2026-11-20',t:'g',amt:200,note:'ADV'},
  {id:2,w:1,d:'2026-11-21',t:'g',amt:900,note:'FUTURE'},
  {id:3,w:2,d:'2026-11-19',t:'g',amt:100,note:'ADV'},
  {id:4,w:3,d:'2026-11-20',t:'r',amt:50,note:'JAMA'}
 ];
 const plan=context.SAN.panelPlan();
 assert.equal(plan.boundary,'2026-11-21');assert.equal(plan.through,'2026-11-20');
 assert.equal(plan.list.length,3,'includes workers across all three companies');
 assert.equal(JSON.stringify(plan.list.map(x=>x.record.carry)),JSON.stringify([0,0,0]));
 const first=plan.list.find(x=>x.w.id===1);assert.equal(first.i.N,200,'future-dated advance is outside the NIL-through-today cutoff');
 assert.equal(first.record.settledThrough,'2026-11-20');assert.equal(first.record.cutoff,'before-day');
});

test('reads worker blocks, yellow/text markers, dates and final totals from screenshot-shaped workbook',()=>{
 const{context,workbook}=fixture(),book=context.SAN.parse(workbook);
 assert.equal(JSON.stringify(book.markers.map(m=>[m.worker.n,m.date])),JSON.stringify([['BUBLY','2026-11-06'],['PRINCE','2026-11-05'],['ABHISHEK VINOD','2026-11-12']]));
 assert.equal(book.entries.length,6);
 assert.equal(book.checkpoints.length,3,'FINAL TOTAL ADVANCE is read from the workbook footer');
 assert.equal(book.workers.length,3);
 assert.equal(book.warnings.length,0,'OCT NILL is a private note and is ignored, including its yellow fill');
 assert.equal(book.issues.length,0,'the note row does not create missing-date blockers');
});
test('verifies workers independently and does not Auto Nil the JAMA mismatch',()=>{
 const{context,workbook}=fixture(),book=context.SAN.parse(workbook),preview=context.SAN.analyze(book);
 assert.equal(JSON.stringify(preview.rows.map(r=>r.status)),JSON.stringify(['MISMATCH','VERIFIED','VERIFIED']));
 assert.equal(preview.rows[0].counts.balance,-9467,'JAMA is treated as a deduction and negative balances are preserved');
 assert.equal(preview.rows[0].difference,-9467);
 assert.equal(preview.canApply,true,'only the matching workers can be confirmed');
});
test('same workbook is recognized as already imported/settled and cannot duplicate the entries',()=>{
 const{context,data,workbook}=fixture(),book=context.SAN.parse(workbook);context.SAN.analyze(book);
 data.adv=book.entries.map((e,i)=>({id:100+i,w:e.worker.id,d:e.date,t:e.t,amt:e.amount,note:e.note,src:e.sourceKey}));
 data.nl['2|2026-11-05']={carry:0,net:0,cutoff:'after-day',settledThrough:'2026-11-05',smartSettlementId:'done-prince'};
 data.nl['3|2026-11-12']={carry:0,net:1000,cutoff:'after-day',settledThrough:'2026-11-12',smartSettlementId:'done-abhishek'};
 const repeat=context.SAN.analyze(book);
 assert.equal(repeat.candidates.length,0);
 assert.equal(JSON.stringify(repeat.rows.map(r=>r.status)),JSON.stringify(['MISMATCH','ALREADY SETTLED','ALREADY SETTLED']));
 assert.equal(repeat.canApply,false);
});
test('ambiguous duplicate rows require review instead of being silently deduplicated',()=>{
 const{context,workbook}=fixture(),book=context.SAN.parse(workbook);book.entries.push({...book.entries[0],row:99});const preview=context.SAN.analyze(book);
 assert.ok(preview.issues.some(x=>x.includes('duplicate-looking Excel rows')));
 assert.equal(preview.canApply,false);
});

test('re-upload with appended rows recognizes old source identities and exposes only new rows',()=>{
 const{context,data,workbook}=fixture(),initial=context.SAN.parse(workbook);
 data.adv=initial.entries.map((e,i)=>({id:200+i,w:e.worker.id,d:e.date,t:e.t,amt:e.amount,note:e.note,src:`${e.worker.id}|${e.sheet.toLocaleUpperCase()}|${e.date.slice(0,7)}|${e.address.toLocaleUpperCase()}`}));
 const row=workbook.worksheets[0].getRow(15);row.getCell(2).value=333;row.getCell(2).address='B15';row.getCell(3).value='ADV';row.getCell(3).address='C15';
 const appended=context.SAN.parse(workbook),review=context.SAN.analyze(appended);
 assert.equal(review.candidates.length,1);
 assert.equal(review.candidates[0].amount,333);
 assert.equal(review.candidates[0].sourceKey,'1|NOVEMBER|2026-11|B15');
 assert.equal(review.issues.length,0);
});
test('same source cell with edited values is flagged instead of re-imported as another transaction',()=>{
 const{context,data,workbook}=fixture(),book=context.SAN.parse(workbook),first=context.SAN.analyze(book).candidates[0];
 data.adv=[{id:700,w:first.worker.id,d:first.date,t:first.t,amt:first.amount,note:first.note,src:first.sourceKey}];
 workbook.worksheets[0].getRow(3).getCell(2).value=7100;
 const edited=context.SAN.parse(workbook),review=context.SAN.analyze(edited);
 assert.ok(review.issues.some(x=>x.includes('changed since import')));
 assert.equal(review.canApply,false);
 assert.equal(review.candidates.length,5,'the changed source row is not added as a second transaction');
});
test('yellow fill is identified from ExcelJS foreground fill colour',()=>{
 const{context}=fixture();assert.equal(context.SAN.isYellow({fill:{type:'pattern',fgColor:{argb:'FFFFFF00'}}}),true);assert.equal(context.SAN.isYellow({fill:{type:'pattern',fgColor:{argb:'FFFFFFFF'}}}),false);
});
