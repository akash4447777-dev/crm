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
 const rows=Array.from({length:38},()=>Array.from({length:9},()=>({value:null,fill:{type:'pattern',fgColor:{argb:'FFFFFFFF'}},address:''})));
 function set(r,c,value,yellow=false){const x=rows[r-1][c-1];x.value=value;x.address=String.fromCharCode(64+c)+r;if(yellow)x.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFF00'}};}
 for(const[c,n]of [[1,'BUBLY'],[4,'PRINCE'],[7,'ABHISHEK VINOD']]){set(1,c,n);set(2,c,'Date');set(2,c+1,'Amount');set(2,c+2,'Remarks');for(let d=1;d<=30;d++)set(d+2,c,`${String(d).padStart(2,'0')}-11-2026`);}
 // Screenshot-shaped entries and settlement markers.
 set(3,2,7000);set(3,3,'NILL');set(8,2,9467,true);set(8,3,'JAMA',true);
 set(3,5,2000);set(3,6,'NILL');set(7,4,'05-11-2026');set(7,6,'TILL DATE HISABB NILL',true);
 set(4,8,500);set(4,9,'NILL');set(9,8,5000);set(9,9,'NILL');set(14,8,1000,true);set(14,9,'ADV',true);
 for(const[c,v]of [[1,0],[4,'-'],[7,1000]]){set(35,c,'FINAL TOTAL ADV');set(35,c+1,v);set(36,c,'OCT NILL',true);set(36,c+1,'',true);set(36,c+2,'',true);}
 const rowObjs=rows.map(cells=>({getCell(c){return cells[c-1]||{value:null};}}));
 const worksheet={name:'November',rowCount:38,columnCount:9,getRow(r){return rowObjs[r-1];}};
 const data={cos:[{m:'BUBLYCO',n:'Factory'},{m:'PRINCECO',n:'Factory'},{m:'ABHISHEKCO',n:'Factory'}],w:[{id:1,n:'BUBLY',c:1},{id:2,n:'PRINCE',c:2},{id:3,n:'ABHISHEK VINOD',c:3}],adv:[],nl:{}};
 const context={console,Date,Math,Number,String,Object,Array,Set,Map,JSON,RegExp,Blob,Uint8Array,AccountingCore,document:{querySelector(){return null;}},D:data,today:()=> '2026-11-20',cn:c=>['BUBLYCO','PRINCECO','ABHISHEKCO'][+c-1],wn:id=>String(id),say(){},sv2(){},save(){},render(){},T:{adv:{top:()=>''}}};
 context.window=context;context.globalThis=context;vm.createContext(context);vm.runInContext(nillScript,context);vm.runInContext(smartScript,context);
 return{context,data,workbook:{worksheets:[worksheet]}};
}
test('reads worker blocks, yellow/text markers, dates and final totals from screenshot-shaped workbook',()=>{
 const{context,workbook}=fixture(),book=context.SAN.parse(workbook);
 assert.equal(JSON.stringify(book.markers.map(m=>[m.worker.n,m.date])),JSON.stringify([['BUBLY','2026-11-06'],['PRINCE','2026-11-05'],['ABHISHEK VINOD','2026-11-12']]));
 assert.equal(book.entries.length,6);
 assert.equal(book.workers.length,3);
 assert.equal(book.warnings.length,3,'OCT NILL opening labels are surfaced for acknowledgement, not misread as dated markers');
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
