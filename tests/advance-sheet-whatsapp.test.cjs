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

test('WhatsApp sheet PDF shares the generated PDF file and downloads it when file sharing is unavailable',()=>{
 assert.match(html,/const file=new File\(\[blob\],filename,\{type:"application\/pdf"\}\)/);
 assert.match(html,/navigator\.share\(\{files:\[file\],title:filename,text:/);
 assert.match(html,/WhatsApp kholkar is file ko attach karein/);
});
