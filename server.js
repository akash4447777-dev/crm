// CRM Sender - sends PDF statements by WhatsApp, Email and SMS. Needs Node 18+.
const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const E=process.env,PORT=E.PORT||3000,KEY=E.API_KEY||"",BASE=(E.PUBLIC_URL||"").replace(/\/$/,"");
const FD=path.join(__dirname,"files");fs.mkdirSync(FD,{recursive:true});
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,x-api-key","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const out=(res,c,o)=>{res.writeHead(c,{"Content-Type":"application/json",...H});res.end(JSON.stringify(o))};
const body=req=>new Promise((ok,no)=>{let b="";req.on("data",d=>{b+=d;if(b.length>25e6){no(new Error("File too large"));req.destroy()}});req.on("end",()=>{try{ok(b?JSON.parse(b):{})}catch(e){no(e)}});req.on("error",no)});
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
const ver=n=>+((n.match(/v(\d+)/i)||[0,0])[1]);
const page=()=>{const l=fs.readdirSync(__dirname).filter(n=>/^crm.*\.html$/i.test(n)).sort((a,b)=>ver(a)-ver(b)||a.localeCompare(b));return l.length?path.join(__dirname,l[l.length-1]):null};
const CH={email,whatsapp,sms};
http.createServer(async(req,res)=>{try{const u=req.url.split("?")[0];
if(req.method=="OPTIONS"){res.writeHead(204,H);return res.end()}
if(req.method=="GET"&&/^\/f\/[a-f0-9]{24}\.pdf$/.test(u)){const f=path.join(FD,path.basename(u));if(!fs.existsSync(f))return out(res,404,{error:"Not found"});res.writeHead(200,{"Content-Type":"application/pdf",...H});return res.end(fs.readFileSync(f))}
if(req.method=="GET"&&(u=="/"||u=="/crm.html")){const f=page();if(!f)return out(res,404,{error:"Put crm.html next to server.js"});res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});return res.end(fs.readFileSync(f))}
if(!KEY)return out(res,500,{error:"Server has no API_KEY set"});
if(req.headers["x-api-key"]!==KEY)return out(res,401,{error:"Wrong secret key"});
if(req.method=="GET"&&u=="/health")return out(res,200,{ok:true,email:has.email(),whatsapp:has.whatsapp(),sms:has.sms()});
if(req.method=="POST"&&u=="/send"){const d=await body(req);if(!CH[d.channel])return out(res,400,{error:"Unknown channel"});if(!has[d.channel]())return out(res,400,{error:d.channel+" is not set up on the server"});
if(!d.to||!d.pdf)return out(res,400,{error:"Missing recipient or PDF"});await CH[d.channel](d);return out(res,200,{ok:true})}
out(res,404,{error:"Not found"})}catch(e){out(res,500,{error:String(e.message||e)})}}).listen(PORT,()=>console.log("CRM Sender running on port "+PORT));
