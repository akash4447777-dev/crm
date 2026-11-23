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
 assert.match(html,/const PER=4,X0=10,DW=18/);
 assert.match(html,/Math\.ceil\(d\.ws\.length\/4\)/);
 assert.match(html,/d\.ws\.slice\(p\*4,p\*4\+4\)/);
 assert.match(html,/for\(let start=0;start<workerIds\.length;start\+=4\)/,'NIL detail pages are also grouped by at most four workers');
 assert.match(html,/OPEN \"\+num0\(x\.prev\)\+\" · ADV \"\+num0\(x\.s\.adv\)/);
 assert.match(html,/NET OUTSTANDING/);
 assert.match(html,/\[\"ENTRIES\",x=>x\.cells\.filter/);
});

test('WhatsApp sheet PDF shares the generated PDF file and downloads it when file sharing is unavailable',()=>{
 assert.match(html,/const file=new File\(\[blob\],filename,\{type:"application\/pdf"\}\)/);
 assert.match(html,/navigator\.share\(\{files:\[file\],title:filename,text:/);
 assert.match(html,/WhatsApp kholkar is file ko attach karein/);
});
