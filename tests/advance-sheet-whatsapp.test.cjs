'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','crm_v38.html'),'utf8');

test('sheet PDF dialog offers WhatsApp share for all companies and selected company',()=>{
 assert.match(html,/id="xsWP">WhatsApp PDF: all companies<\/button>/);
 assert.match(html,/id="xsWQ">WhatsApp PDF: \$\{esc\(cn\(co\)\)\} only<\/button>/);
 assert.match(html,/\$\("#xsWP"\)\.onclick=\(\)=>run\(\(\)=>exportPdf\(1,true\)\)/);
 assert.match(html,/\$\("#xsWQ"\)\.onclick=\(\)=>run\(\(\)=>exportPdf\(0,true\)\)/);
});

test('sheet PDF keeps the original matrix with four workers per page and richer summaries',()=>{
 assert.match(html,/const X0=10,CW=277,DW=18/);
 assert.match(html,/MONTHLY ADVANCE SHEET/);
 assert.match(html,/DATE-WISE REGISTER/);
 assert.match(html,/Math\.ceil\(d\.ws\.length\/4\)/);
 assert.match(html,/d\.ws\.slice\(p\*4,p\*4\+4\)/);
 assert.doesNotMatch(html,/function nillPage\(doc,d\)/,'separate NIL-detail appendix is removed from this sheet PDF');
 assert.match(html,/JAI BALAJI BILLIARDS/);
 assert.match(html,/id="xsLogo"/);
 assert.match(html,/doc\.addImage\(sheetLogo/);
 assert.match(html,/\[\[\"OPEN\",x\.prev,ink\],\[\"ADV\",x\.s\.adv,ink\]/);
 assert.match(html,/NET OUTSTANDING/);
 assert.match(html,/\[\[\"ADV TOTAL\",x=>x\.s\.adv,RGB\.pale\].*\[\"HISAAB NILL\",null,RGB\.sky\]\]/);
 assert.match(html,/HISAAB NILL/,'legacy Till Date Hisab Nil wording is normalized');
 assert.match(html,/text\(rm,bx\+W1,y,W2,RH,"c"/,'transaction remarks are centered within their cells');
 assert.match(html,/align=="c"\?x\+w\/2:x\+1/,'center-aligned text uses the actual cell midpoint');
 assert.match(html,/HISAA\?B\{1,2\}\\s\+NIL/,'legacy spelling variants of the NIL remark are normalized');
});

test('WhatsApp sheet PDF shares the generated PDF file and downloads it when file sharing is unavailable',()=>{
 assert.match(html,/const file=new File\(\[blob\],filename,\{type:"application\/pdf"\}\)/);
 assert.match(html,/navigator\.share\(\{files:\[file\],title:filename,text:/);
 assert.match(html,/WhatsApp kholkar is file ko attach karein/);
});
