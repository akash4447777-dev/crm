// CRM Server: login (Gmail / mobile), shared data for all devices, approvals by Super Admin, PDF sending. Node 20+.
const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const E=process.env,PORT=E.PORT||3000,KEY=E.API_KEY||"",BASE=(E.PUBLIC_URL||"").replace(/\/$/,"");
const SU=(E.SUPABASE_URL||"").replace(/\/$/,""),SK=E.SUPABASE_KEY||"",OWNER=String(E.OWNER||"").trim().toLowerCase();
const SECRET=E.AUTH_SECRET||"";
const SC=require("./security-core.cjs");
const FD=path.join(__dirname,"files");fs.mkdirSync(FD,{recursive:true});
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,x-api-key,Authorization","Access-Control-Allow-Methods":"GET,POST,PUT,OPTIONS"};
const out=(res,c,o)=>{res.writeHead(c,{"Content-Type":"application/json",...H});res.end(JSON.stringify(o))};
const body=req=>new Promise((ok,no)=>{let b="";req.on("data",d=>{b+=d;if(b.length>40e6){no(new Error("Too large"));req.destroy()}});req.on("end",()=>{try{ok(b?JSON.parse(b):{})}catch(e){no(e)}});req.on("error",no)});
/* ---------- database (Supabase REST, table kv) ---------- */
const dbh=()=>{const h={apikey:SK,"Content-Type":"application/json"};if(SK.startsWith("eyJ"))h.Authorization="Bearer "+SK;return h};
async function dbGet(key,cols){const r=await fetch(`${SU}/rest/v1/kv?key=eq.${key}&select=${cols}`,{headers:dbh()});if(!r.ok)throw new Error("DB read failed "+r.status+" "+(await r.text()).slice(0,150));return (await r.json())[0]||null}
async function dbCas(key,base,value){let r;if(!base){r=await fetch(`${SU}/rest/v1/kv?on_conflict=key`,{method:"POST",headers:{...dbh(),Prefer:"resolution=ignore-duplicates,return=representation"},body:JSON.stringify({key,ver:1,value})})}
else r=await fetch(`${SU}/rest/v1/kv?key=eq.${key}&ver=eq.${base}&select=ver`,{method:"PATCH",headers:{...dbh(),Prefer:"return=representation"},body:JSON.stringify({ver:base+1,value})});
if(!r.ok)throw new Error("DB write failed "+r.status+" "+(await r.text()).slice(0,150));return (await r.json()).length?base+1:null}
/* ---------- users ---------- */
let UC=null,UT=0;
async function users(){const r=await dbGet("users","ver,value");const sealed=await SECURITY.checkStored("users",r,true);UC={ver:r?r.ver:0,list:r?(r.value.list||[]):[],sealed};UT=Date.now();return UC}
async function saveUsers(mut,actor=null,action="account-registration"){for(let i=0;i<6;i++){UC=null;const u=await users();if(u.list.length&&!u.sealed&&!SC.isSuper(actor))SC.fail(503,"Super Admin must initialize the security baseline first.");const list=JSON.parse(JSON.stringify(u.list)),res=mut(list);if(res&&res.err)return res;const ids=new Set([...u.list.map(x=>x.id),...list.map(x=>x.id)]),changes=[];for(const id of ids){const old=u.list.find(x=>x.id===id),next=list.find(x=>x.id===id);if(!SC.equal(old,next))changes.push({collection:"users",id,company:"",before:old?pub(old):null,after:next?pub(next):null,credentialChanged:!!(old&&next&&(old.h!==next.h||old.salt!==next.salt))});}const result=await SECURITY.commit("users",u.ver,{list},actor,action,changes);if(result.ok){UC=null;return res}}throw new Error("Users busy, try again")}
const normId=s=>{s=String(s||"").trim().toLowerCase();if(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))return{em:s};const d=s.replace(/\D/g,"");return d.length>=10?{ph:d.slice(-10)}:null};
const findU=(list,id)=>{const n=normId(id);return n?list.find(u=>(n.em&&u.em==n.em)||(n.ph&&u.ph==n.ph)):null};
const hp=(p,s)=>crypto.scryptSync(String(p),s,32).toString("hex"),pub=SC.pub;
const sign=s=>crypto.createHmac("sha256",SECRET).update(s).digest("hex"),same=SC.safeEqual;
const mkTok=u=>{const b=u.id+"."+(Date.now()+30*864e5)+"."+(u.av||0);return b+"."+sign(b)};
async function auth(req){const t=String(req.headers.authorization||"").replace(/^Bearer /,""),p=t.split(".");if(SECRET.length<32||p.length!==4||!same(sign(p.slice(0,3).join(".")),p[3])||+p[1]<Date.now())return null;const us=await users(),u=us.list.find(x=>x.id===p[0]);if(!us.sealed&&!(u?.role==="super"&&OWNER&&((u.em&&u.em===OWNER)||(u.ph&&OWNER.replace(/\D/g,"").slice(-10)===u.ph))))return null;return u&&u.status==="active"&&String(u.av||0)===p[2]?u:null}
const SECURITY=require("./security-service.cjs")({url:SU,headers:dbh,dbGet,key:E.AUDIT_SIGNING_KEY||""});
const securityRoutes=require("./security-routes.cjs")({service:SECURITY,dbGet,users,saveUsers,out,body});
const statementRoutes=require("./statements-routes.cjs")({service:SECURITY,out,body,saveUsers});
const tries=new Map();const blocked=k=>{const t=tries.get(k);return t&&t.n>=6&&Date.now()-t.t<6e5};const fail=k=>{const t=tries.get(k)||{n:0,t:0};t.n++;t.t=Date.now();tries.set(k,t)};
/* ---------- sending ---------- */
const has={email:()=>!!(E.BREVO_API_KEY||(E.SMTP_USER&&E.SMTP_PASS)),whatsapp:()=>!!(E.WA_TOKEN&&E.WA_PHONE_ID),sms:()=>!!(E.TWILIO_SID&&E.TWILIO_TOKEN&&E.TWILIO_FROM&&BASE)};
async function email(d){if(E.BREVO_API_KEY){const r=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":E.BREVO_API_KEY,"Content-Type":"application/json",accept:"application/json"},body:JSON.stringify({sender:{name:d.company,email:E.BREVO_SENDER||E.SMTP_USER},to:[{email:d.to,name:d.name}],subject:`${d.company} - Advance statement ${d.month}`,textContent:d.text,attachment:[{name:d.filename,content:d.pdf}]})});
if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.message||"Brevo error "+r.status)}return}
const t=require("nodemailer").createTransport({host:E.SMTP_HOST||"smtp.gmail.com",port:+(E.SMTP_PORT||465),secure:+(E.SMTP_PORT||465)==465,auth:{user:E.SMTP_USER,pass:E.SMTP_PASS}});
await t.sendMail({from:`"${d.company}" <${E.SMTP_USER}>`,to:d.to,subject:`${d.company} - Advance statement ${d.month}`,text:d.text,attachments:[{filename:d.filename,content:Buffer.from(d.pdf,"base64"),contentType:"application/pdf"}]})}
async function whatsapp(d){const g="https://graph.facebook.com/v20.0/"+E.WA_PHONE_ID,h={Authorization:"Bearer "+E.WA_TOKEN},fd=new FormData();
fd.append("messaging_product","whatsapp");fd.append("type","application/pdf");fd.append("file",new Blob([Buffer.from(d.pdf,"base64")],{type:"application/pdf"}),d.filename);
let r=await fetch(g+"/media",{method:"POST",headers:h,body:fd}),j=await r.json();if(!j.id)throw new Error((j.error&&j.error.message)||"WhatsApp upload failed");
const m=E.WA_TEMPLATE?{type:"template",template:{name:E.WA_TEMPLATE,language:{code:E.WA_LANG||"en"},components:[{type:"header",parameters:[{type:"document",document:{id:j.id,filename:d.filename}}]},{type:"body",parameters:[d.name,d.month,String(Math.round(d.amount))].map(text=>({type:"text",text}))}]}}:{type:"document",document:{id:j.id,filename:d.filename,caption:d.text}};
r=await fetch(g+"/messages",{method:"POST",headers:{...h,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:d.to,...m})});j=await r.json();if(j.error)throw new Error(j.error.message)}
async function sms(d){const t=crypto.randomBytes(12).toString("hex");fs.writeFileSync(path.join(FD,t+".pdf"),Buffer.from(d.pdf,"base64"));
const p=new URLSearchParams({To:"+"+d.to,From:E.TWILIO_FROM,Body:`${d.company}: ${d.month} advance baaki Rs ${Math.round(d.amount)}. Statement: ${BASE}/f/${t}.pdf`});
const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${E.TWILIO_SID}/Messages.json`,{method:"POST",headers:{Authorization:"Basic "+Buffer.from(E.TWILIO_SID+":"+E.TWILIO_TOKEN).toString("base64")},body:p}),j=await r.json();if(j.code||j.error_message)throw new Error(j.message||j.error_message)}
const CH={email,whatsapp,sms};
const ver=n=>+((n.match(/v(\d+)/i)||[0,0])[1]);
const page=()=>{const l=fs.readdirSync(__dirname).filter(n=>/^crm.*\.html$/i.test(n)).sort((a,b)=>ver(a)-ver(b)||a.localeCompare(b));return l.length?path.join(__dirname,l[l.length-1]):null};
/* ---------- routes ---------- */
const app=http.createServer(async(req,res)=>{try{const u=req.url.split("?")[0],M=req.method;
if(M=="OPTIONS"){res.writeHead(204,H);return res.end()}
if(M=="GET"&&/^\/f\/[a-f0-9]{24}\.pdf$/.test(u)){const f=path.join(FD,path.basename(u));if(!fs.existsSync(f))return out(res,404,{error:"Not found"});res.writeHead(200,{"Content-Type":"application/pdf",...H});return res.end(fs.readFileSync(f))}
if(M=="GET"&&(u=="/"||u=="/crm.html")){const f=page();if(!f)return out(res,404,{error:"Put crm.html next to server.js"});res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});return res.end(fs.readFileSync(f))}
if(M=="GET"&&u=="/auth/status")return out(res,200,{server:true,storage:!!(SU&&SK),owner:!!OWNER,securityVersion:15,securityConfigured:SECRET.length>=32&&(E.AUDIT_SIGNING_KEY||"").length>=32});
if((u.startsWith("/auth/")||u.startsWith("/security")||u.startsWith("/statements")||u.startsWith("/data"))&&(SECRET.length<32||(E.AUDIT_SIGNING_KEY||"").length<32))return out(res,503,{error:"Set AUTH_SECRET and a separate AUDIT_SIGNING_KEY (32+ random characters each); apply migrations/015_security.sql."});
if(!(SU&&SK)&&u.startsWith("/auth")||!(SU&&SK)&&["/data","/users","/me","/security","/statements"].some(p=>u.startsWith(p)))return out(res,500,{error:"Server par SUPABASE_URL / SUPABASE_KEY set nahi hai"});
if(M=="POST"&&u=="/auth/register"){const d=await body(req),n=normId(d.id);if(!n)return out(res,400,{error:"Sahi Gmail ya 10 digit mobile number likho"});if(String(d.password||"").length<6)return out(res,400,{error:"Password kam se kam 6 akshar ka ho"});
const name=String(d.name||"").trim().slice(0,40)||"User";
const r=await saveUsers(list=>{if(findU(list,d.id))return{err:"Ye Gmail / number pehle se registered hai"};const first=!list.length;
if(first&&!(OWNER&&((n.em&&n.em==OWNER)||(n.ph&&OWNER.replace(/\D/g,"").slice(-10)==n.ph))))return{err:"Pehla account sirf owner ka ho sakta hai. Render mein OWNER set karo."};
const salt=crypto.randomBytes(8).toString("hex");list.push({id:crypto.randomBytes(6).toString("hex"),name,...n,salt,h:hp(d.password,salt),role:first?"super":"admin",status:first?"active":"pending",at:new Date().toISOString()});return{ok:true,status:first?"active":"pending"}});
return r.err?out(res,400,{error:r.err}):out(res,200,r)}
if(M=="POST"&&u=="/auth/login"){const d=await body(req),k=(req.socket.remoteAddress||"")+"|"+String(d.id).toLowerCase();if(blocked(k))return out(res,429,{error:"Bahut galat try. 10 minute baad dobara karo."});
const us=await users(),x=findU(us.list,d.id);if(!x||!same(hp(d.password||"",x.salt),x.h)){fail(k);return out(res,401,{error:"Gmail/number ya password galat hai"})}
if(!us.sealed&&!(x.role==="super"&&OWNER&&((x.em&&x.em===OWNER)||(x.ph&&OWNER.replace(/\D/g,"").slice(-10)===x.ph))))return out(res,403,{error:"Super Admin must initialize Security Center first."});
if(x.status=="pending")return out(res,403,{error:"Aapki request Super Admin ke paas hai. Approve hone par login chalega."});if(x.status!="active")return out(res,403,{error:"Ye account band hai. Super Admin se baat karo."});
tries.delete(k);return out(res,200,{token:mkTok(x),user:pub(x)})}
if(M=="POST"&&u=="/send"){const me=await auth(req);if(!me)return out(res,401,{error:"Login required. API-key-only sending is disabled for company security."});SC.writer(me);
const d=await body(req);const {env}=await SECURITY.readData(me),worker=(env.data.w||[]).find(w=>String(w.id)===String(d.workerId));if(!worker||!SC.can(me,worker.c))return out(res,403,{error:"Worker/company access denied."});if(!CH[d.channel])return out(res,400,{error:"Unknown channel"});if(!has[d.channel]())return out(res,400,{error:d.channel+" is not set up on the server"});if(!d.to||!d.pdf)return out(res,400,{error:"Missing recipient or PDF"});await CH[d.channel](d);return out(res,200,{ok:true})}
if(M=="GET"&&u=="/health"&&KEY&&req.headers["x-api-key"]===KEY)return out(res,200,{ok:true,email:has.email(),whatsapp:has.whatsapp(),sms:has.sms()});
const me=await auth(req);if(!me)return out(res,401,{error:"Login karo",login:true});
if(await statementRoutes(req,res,u,M,me))return;
if(await securityRoutes(req,res,u,M,me))return;
if(M=="GET"&&u=="/me")return out(res,200,{user:pub(me)});
if(M=="POST"&&u=="/auth/password"){const d=await body(req);if(!same(hp(d.old||"",me.salt),me.h))return out(res,400,{error:"Current password galat hai"});if(String(d.next||"").length<6)return out(res,400,{error:"Naya password kam se kam 6 akshar ka ho"});
await saveUsers(l=>{const x=l.find(y=>y.id==me.id);x.salt=crypto.randomBytes(8).toString("hex");x.h=hp(d.next,x.salt);x.av=(x.av||0)+1;return{ok:true}},me,"password-change");return out(res,200,{ok:true})}
if(M=="GET"&&u=="/data/ver"){const r=await dbGet("data","ver");const o={ver:r?r.ver:0};if(me.role=="super")o.pending=(await users()).list.filter(x=>x.status=="pending").length;return out(res,200,o)}
if(M=="GET"&&u=="/data"){const r=await dbGet("data","ver,value");return out(res,200,r?{ver:r.ver,data:r.value}:{ver:0,data:null})}
if(M=="PUT"&&u=="/data"){const d=await body(req);if(!d.data||!Array.isArray(d.data.w)||!Array.isArray(d.data.adv))return out(res,400,{error:"Invalid data"});const v=await dbCas("data",+d.base||0,d.data);
if(v)return out(res,200,{ok:true,ver:v});const r=await dbGet("data","ver,value");return out(res,409,{conflict:true,ver:r?r.ver:0,data:r?r.value:null})}
if(u.startsWith("/users")){if(me.role!="super")return out(res,403,{error:"Sirf Super Admin"});
if(M=="GET"&&u=="/users")return out(res,200,{users:(await users()).list.map(pub).sort((a,b)=>(b.status=="pending")-(a.status=="pending"))});
if(M=="POST"&&u=="/users/add"){const d=await body(req),n=normId(d.id);if(!n||String(d.password||"").length<6)return out(res,400,{error:"Sahi Gmail/number aur 6+ akshar ka password do"});
const r=await saveUsers(l=>{if(findU(l,d.id))return{err:"Pehle se registered hai"};const salt=crypto.randomBytes(8).toString("hex");l.push({id:crypto.randomBytes(6).toString("hex"),name:String(d.name||"").trim().slice(0,40)||"User",...n,salt,h:hp(d.password,salt),role:"admin",status:"active",at:new Date().toISOString()});return{ok:true}},me,"user-create");return r.err?out(res,400,{error:r.err}):out(res,200,r)}
if(M=="POST"&&u=="/users/act"){const d=await body(req),r=await saveUsers(l=>{const x=l.find(y=>y.id==d.uid);if(!x)return{err:"User nahi mila"};
if(d.act=="approve"){x.status="active";x.role="admin"}else if(d.act=="block"){if(x.id==me.id)return{err:"Apne aap ko block nahi kar sakte"};x.status="blocked"}else if(d.act=="unblock")x.status="active";
else if(d.act=="reset"){if(String(d.value||"").length<6)return{err:"Password kam se kam 6 akshar ka ho"};x.salt=crypto.randomBytes(8).toString("hex");x.h=hp(d.value,x.salt)}
else if(d.act=="remove"){if(x.id==me.id)return{err:"Apne aap ko remove nahi kar sakte"};l.splice(l.indexOf(x),1)}else return{err:"Unknown action"};x.av=(x.av||0)+1;return{ok:true}},me,"user-"+d.act);return r.err?out(res,400,{error:r.err}):out(res,200,r)}}
out(res,404,{error:"Not found"})}catch(e){out(res,e.status||500,{error:e.status?e.message:"Server operation failed. No unconfirmed change should be treated as saved."})}});
module.exports=app;
if(require.main===module)app.listen(PORT,"0.0.0.0",()=>console.log("CRM server running on port "+app.address().port));
  
