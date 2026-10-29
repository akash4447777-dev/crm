/* Accounting core: immutable derived views, integer paise, no DOM or provider calls. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AccountingCore=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const cents=v=>Number.isFinite(+v)?Math.round((+v+Number.EPSILON)*100):NaN;
const numeric=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(+v);
const validMoney=(v,allowZero=true)=>numeric(v)&&Number.isSafeInteger(cents(v))&&+v>=(allowZero?0:.0000001)&&Math.abs(+v*100-cents(v))<.00001;
const shift=(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
const endMonth=m=>{if(!/^\d{4}-\d{2}$/.test(String(m))||!validDate(m+'-01'))return null;const[y,n]=m.split('-').map(Number);return new Date(Date.UTC(y,n,0)).toISOString().slice(0,10)};
const taxPaise=(amount,rate)=>{if(!Number.isSafeInteger(amount)||amount<0||!Number.isFinite(+rate)||+rate<0||+rate>1)return NaN;const [raw,exponent='0']=String(rate).toLowerCase().split('e'),fraction=(raw.split('.')[1]||'').length,power=fraction-Number(exponent);let numerator=BigInt(raw.replace('.','')),denominator=1n;if(power>=0)denominator=10n**BigInt(power);else numerator*=10n**BigInt(-power);return Number((BigInt(amount)*numerator+denominator/2n)/denominator);};
const norm=s=>String(s??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-IN');
const days=(a,b)=>Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/864e5);
function build(data){
 const issues=[],workers=new Map((data.w||[]).map(w=>[String(w.id),w])),workerEvents=new Map(),workerRows=new Map(),nills=new Map(),attendance=new Map(),byCompany=new Map((data.cos||[]).map((c,i)=>[String(i+1),c]));
 const add=(map,k,v)=>{k=String(k);if(!map.has(k))map.set(k,[]);map.get(k).push(v)};
 const issue=(kind,id,code,message)=>issues.push({key:kind+':'+id+':'+code,kind,id,code,message});
 for(const[kind,rows]of [['worker',data.w||[]],['worker-advance',data.adv||[]],['expense',data.ex||[]],['income',data.inc||[]],['fund-transfer',data.mp||[]],['fund-advance',data.fa||[]]]){const ids=new Set();for(const r of rows){const id=String(r.id);if(ids.has(id))issue(kind,r.id,'duplicate-id','Duplicate record ID; resolve identity before relying on linked calculations');ids.add(id);}}
 for(const w of data.w||[])if(w.wg!=null&&!validMoney(w.wg))issue('worker',w.id,'invalid-wage','Daily wage must be a nonnegative amount with at most two decimals');
 const advanceDuplicates=new Set(),seenAdvance=new Map();
 (data.adv||[]).forEach(a=>{
  if(!validDate(a.d)||!validMoney(a.amt)||!['g','r','n'].includes(a.t)){issue('worker-advance',a.id,'invalid','Invalid date, amount or advance type');return;}
  if(!workers.has(String(a.w)))issue('worker-advance',a.id,'orphan','Worker reference does not exist');
  add(workerRows,a.w,a);if(a.t!=='n')add(workerEvents,a.w,{d:a.d,o:0,v:(a.t==='r'?-1:1)*cents(a.amt),id:a.id});
  const sig=JSON.stringify([String(a.w),a.d,a.t,cents(a.amt),norm(a.note)]);if(seenAdvance.has(sig)){advanceDuplicates.add(String(a.id));advanceDuplicates.add(String(seenAdvance.get(sig)))}else seenAdvance.set(sig,a.id);
 });
 Object.entries(data.nl||{}).forEach(([k,n])=>{const[id,raw]=k.split('|'),d=raw?.length===7?endMonth(raw):raw;if(!validDate(d)||!validMoney(n.carry)){issue('settlement',k,'invalid','Invalid settlement date or carry');return;}const row={k,...n,d};add(nills,id,row);add(workerEvents,id,{d,o:1,c:cents(n.carry),k});});
 workerEvents.forEach(list=>{list.sort((a,b)=>a.d.localeCompare(b.d)||a.o-b.o);let balance=0;list.forEach(e=>{const before=balance;balance=e.o?e.c:balance+e.v;e.balance=balance;e.settled=e.o?Math.max(0,before-e.c):0;});});
 workerRows.forEach(l=>l.sort((a,b)=>a.d.localeCompare(b.d)||String(a.id).localeCompare(String(b.id),undefined,{numeric:true})));nills.forEach(l=>l.sort((a,b)=>a.d.localeCompare(b.d)));
 Object.entries(data.a||{}).forEach(([k,status])=>{const[d,id]=k.split('|');if(!validDate(d)||!['P','H','A'].includes(status)){issue('attendance',k,'invalid','Invalid attendance date or status');return;}add(attendance,id,{d,status,time:(data.t||{})[k]||{}});});
 const balance=(id,to)=>{const l=workerEvents.get(String(id))||[];let lo=0,hi=l.length;while(lo<hi){const mid=(lo+hi)>>1;if(l[mid].d<=to)lo=mid+1;else hi=mid;}return lo?l[lo-1].balance:0;};
 function workerPeriod(id,from,to){const list=(workerRows.get(String(id))||[]).filter(a=>a.d>=from&&a.d<=to),att=(attendance.get(String(id))||[]).filter(a=>a.d>=from&&a.d<=to),settle=(workerEvents.get(String(id))||[]).filter(e=>e.o&&e.d>=from&&e.d<=to);return{opening:balance(id,shift(from,-1)),closing:balance(id,to),given:list.filter(a=>a.t==='g').reduce((n,a)=>n+cents(a.amt),0),returned:list.filter(a=>a.t==='r').reduce((n,a)=>n+cents(a.amt),0),notCounted:list.filter(a=>a.t==='n').reduce((n,a)=>n+cents(a.amt),0),settled:settle.reduce((n,e)=>n+e.settled,0),worked:att.reduce((n,a)=>n+(a.status==='P'?1:a.status==='H'?.5:0),0),p:att.filter(a=>a.status==='P').length,h:att.filter(a=>a.status==='H').length,a:att.filter(a=>a.status==='A').length};}
 const bills=[],partyIndex=new Map();
 for(const[kind,rows]of [['income',data.inc||[]],['expense',data.ex||[]]])for(const x of rows){
  const errors=[];if(!validDate(x.d))errors.push('Invalid document date');if(!validMoney(x.amt))errors.push('Invalid or negative amount');if(!numeric(x.g??0)||+(x.g??0)<0||+(x.g??0)>1)errors.push('GST rate must be a fraction between 0 and 1');
  const c=String(x.c??''),manager=byCompany.get(c);if(!manager)errors.push('Manager reference does not exist');
  const status=x.st||(kind==='income'?'Received':'Paid'),allowed=kind==='income'?['Received','Pending']:['Paid','Pending','Partial'];if(!allowed.includes(status))errors.push('Unsupported payment status');
  const amount=validMoney(x.amt)?cents(x.amt):0,tax=numeric(x.g??0)&&+(x.g??0)>=0&&+(x.g??0)<=1?taxPaise(amount,+(x.g??0)):0,gross=amount+tax;if(!Number.isSafeInteger(gross))errors.push('Gross exceeds safe paise precision');
  let paid=kind==='income'?(status==='Received'?gross:0):(status==='Paid'?gross:status==='Partial'?(validMoney(x.pp)?cents(x.pp):NaN):0);
  if(!Number.isSafeInteger(paid)||paid<0||paid>gross)errors.push('Part payment must be between zero and document gross');
  const explicit=String(x.due||'').trim(),termRaw=x.termsDays,hasTerms=termRaw!==''&&termRaw!=null;
  let due=null,dueSource='Missing';if(explicit){if(validDate(explicit)){due=explicit;dueSource='Explicit'}else errors.push('Invalid due date');}else if(hasTerms){if(Number.isInteger(+termRaw)&&+termRaw>=0&&+termRaw<=3650&&validDate(x.d)){due=shift(x.d,+termRaw);dueSource='Credit days'}else errors.push('Invalid credit days');}
  const party=String(kind==='income'?x.party||'':x.v||'').trim(),partyKey=JSON.stringify([kind,c,norm(x.br),norm(party)||'__missing_'+String(x.id)]),rejected=kind==='expense'&&x.ap==='Rejected';
  const row={kind,id:x.id,ref:String(kind==='income'?x.ref||'':x.inv||'').trim(),d:x.d,c,manager:manager?.m||'',branch:String(x.br||''),party,partyKey,status,approval:x.ap||'Approved',amount,tax,gross,paid:Number.isSafeInteger(paid)?paid:0,outstanding:Number.isSafeInteger(paid)?gross-paid:0,due,dueSource,errors,rejected,valid:!errors.length&&!rejected,source:x};
  if(party==='')issue(kind,x.id,'missing-party','Party name is missing; this bill is kept separate from other unnamed bills');
  if(due&&validDate(x.d)&&due<x.d)issue(kind,x.id,'due-before-document','Due date is before document date');
  if(kind==='expense'&&x.ap==='Awaiting Approval')issue(kind,x.id,'awaiting-approval','Included under existing non-rejected expense rule; approval still needs review');
  if(kind==='expense'&&x.ap&&!['Approved','Awaiting Approval','Rejected'].includes(x.ap))issue(kind,x.id,'unknown-approval','Unrecognized approval state; included under the existing non-rejected rule, review required');
  if(rejected&&paid>0)issue(kind,x.id,'rejected-with-payment','Rejected document reports a payment; excluded under existing rules. Reconcile any refund separately.');
  for(const err of errors)issue(kind,x.id,'invalid-'+err,err);bills.push(row);add(partyIndex,partyKey,row);
 }
 const seenBill=new Map();for(const b of bills){if(!b.ref)continue;const key=JSON.stringify([b.kind,b.c,norm(b.branch),norm(b.party),norm(b.ref)]);if(seenBill.has(key)){issue(b.kind,b.id,'duplicate-reference','Possible repeated invoice/reference for the same scoped party');const earlier=seenBill.get(key);if(!issues.some(i=>i.kind===earlier.kind&&i.id===earlier.id&&i.code==='duplicate-reference'))issue(earlier.kind,earlier.id,'duplicate-reference','Possible repeated invoice/reference for the same scoped party');}else seenBill.set(key,b);}
 const fundById=new Map((data.mp||[]).map(t=>[String(t.id),t])),fundAllocation=new Map();for(const a of data.fa||[]){const t=fundById.get(String(a.tr));if(!validDate(a.d)||!validMoney(a.amt))issue('fund-advance',a.id,'invalid','Invalid date or amount');if(a.tr&&String(a.tr)!=='0'&&(!t||String(t.c)!==String(a.c)))issue('fund-advance',a.id,'invalid-link','Transfer is missing or belongs to another manager');if(t&&String(t.c)===String(a.c)&&validMoney(a.amt))fundAllocation.set(String(t.id),(fundAllocation.get(String(t.id))||0)+cents(a.amt));}for(const t of data.mp||[]){if(!validDate(t.d)||!validMoney(t.amt))issue('fund-transfer',t.id,'invalid','Invalid date or amount');if((fundAllocation.get(String(t.id))||0)>cents(t.amt))issue('fund-transfer',t.id,'over-allocated','Linked advances exceed the transfer amount');}
 const inScope=(b,o)=> (!o.manager||+o.manager===0||String(b.c)===String(o.manager))&&(!o.branch||o.branch==='0'||b.branch===o.branch);
 function snapshot(opts={}){
  const asOf=opts.asOf;if(!validDate(asOf)||!validDate(opts.from)||!validDate(opts.to)||opts.from>opts.to)throw new Error('A valid from/to/asOf range is required');
  const scoped=bills.filter(b=>inScope(b,opts)),period=scoped.filter(b=>b.valid&&b.d>=opts.from&&b.d<=opts.to),asOfBills=scoped.filter(b=>b.valid&&b.d<=asOf),parties=new Map();
  for(const b of asOfBills){let p=parties.get(b.partyKey);if(!p){p={key:b.partyKey,kind:b.kind,party:b.party||'(Missing party) #'+b.id,manager:b.manager,c:b.c,branch:b.branch,invoice:0,paid:0,outstanding:0,overdue:0,dueToday:0,dueSoon:0,missingDue:0,notDue:0,age0:0,age30:0,age60:0,age90:0,ageOver90:0,documents:0};parties.set(b.partyKey,p);}p.invoice+=b.gross;p.paid+=b.paid;p.outstanding+=b.outstanding;p.documents++;if(!b.outstanding)continue;
   if(!b.due){p.missingDue+=b.outstanding;continue;}const late=days(asOf,b.due);if(late>0)p.overdue+=b.outstanding;else if(late===0)p.dueToday+=b.outstanding;else{p.notDue+=b.outstanding;if(late>=-7)p.dueSoon+=b.outstanding;}if(late<=0)p.age0+=b.outstanding;else if(late<=30)p.age30+=b.outstanding;else if(late<=60)p.age60+=b.outstanding;else if(late<=90)p.age90+=b.outstanding;else p.ageOver90+=b.outstanding;
  }
  const total=(kind,key,rows=period)=>rows.filter(b=>b.kind===kind).reduce((n,b)=>n+b[key],0),netIncome=total('income','amount'),netExpense=total('expense','amount'),cashIn=total('income','paid'),cashOut=total('expense','paid');
  const reminders=asOfBills.filter(b=>b.outstanding>0).map(b=>{const late=b.due?days(asOf,b.due):null,status=late==null?'Missing due date':late>0?'Overdue':late===0?'Due today':late>=-7?'Due within 7 days':'Not due';return{...b,daysOverdue:late==null?null:Math.max(0,late),dueStatus:status,draft:`${b.party||'Party'}: ${b.kind==='income'?'payment receivable':'payment payable'} INR ${(b.outstanding/100).toFixed(2)} against ${b.ref||b.kind+' #'+b.id}, document ${b.d}. ${b.due?'Due '+b.due+'.':'Due date not recorded; please confirm terms.'} Please reconcile before sending a reminder.`};}).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||String(a.id).localeCompare(String(b.id)));
  return{...opts,period,asOfBills,scoped,parties:[...parties.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||b.outstanding-a.outstanding),reminders,issues,summary:{netIncome,netExpense,operatingResult:netIncome-netExpense,cashIn,cashOut,cashSurplus:cashIn-cashOut,receivable:total('income','outstanding',asOfBills),payable:total('expense','outstanding',asOfBills),inputTax:total('expense','tax'),outputTax:total('income','tax'),excluded:scoped.filter(b=>!b.valid).length}};
 }
 return{issues,workers,workerEvents,workerRows,nills,attendance,bills,partyIndex,balance,workerPeriod,snapshot,advanceDuplicates,fundAllocation};
}
function tokenize(query){const tokens=String(query||'').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)||[];return tokens.map(t=>t.replace(/^["']|["']$/g,''));}
function matches(row,query){return tokenize(query).every(token=>{const colon=token.indexOf(':');if(colon>0){const key=token.slice(0,colon).toLowerCase(),val=token.slice(colon+1).replace(/^["']|["']$/g,'');if(['min','max'].includes(key)){if(!numeric(val))return false;return key==='min'?row.amount>=cents(val):row.amount<=cents(val);}if(key==='from'||key==='to'){if(!validDate(val))return false;return key==='from'?row.date>=val:row.date<=val;}if(key==='balance'){return val==='due'?row.balance>0:val==='clear'?row.balance===0:val==='credit'?row.balance<0:false;}if(key==='due'){return norm(row.dueStatus).includes(norm(val));}if(['type','party','manager','worker','ref','status','remark'].includes(key))return norm(row[key]).includes(norm(val));}
 return norm(row.text||Object.values(row).join(' ')).includes(norm(token));});}
return{build,cents,taxPaise,validMoney,validDate,endMonth,shift,norm,days,matches,tokenize};
});
