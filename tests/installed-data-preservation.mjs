import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pathModule from 'node:path';
import {homedir} from 'node:os';
import { readFile, writeFile, access } from 'node:fs/promises';
const mode=process.argv[2]||'after',expectedVersion=process.env.PAPERREAD_EXPECT_VERSION||'0.9.0';
const application=await electron.launch({executablePath:process.env.PAPERREAD_INSTALLED_APP||pathModule.join(homedir(),'Applications/PaperRead.app/Contents/MacOS/PaperRead'),args:[],timeout:30000});
try{
 const page=await application.firstWindow();await page.waitForSelector('.brand');
 const snapshot=await page.evaluate(async()=>{
  const hash=async(value)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const records=await new Promise((resolve,reject)=>{const request=indexedDB.open('paperlens-library',1);request.onsuccess=()=>{const db=request.result;const rows=db.transaction('papers').objectStore('papers').getAll();rows.onsuccess=()=>{resolve(rows.result);db.close();};rows.onerror=()=>reject(rows.error);};request.onerror=()=>reject(request.error);});
  const papers=await Promise.all(records.map(async r=>({id:r.id,analysis:await hash(JSON.stringify(r.analysis||null)),notes:await hash(r.notes||''),revisions:await hash(JSON.stringify(r.revisions||[])),pdf:r.pdf?await hash(r.pdf):null,supplements:await hash(JSON.stringify(r.supplements||[])),supplementLinks:await hash(JSON.stringify(r.supplementLinks||[])),attachments:await Promise.all(Object.entries(r.supplementPdfs||{}).map(async([id,data])=>({id,hash:await hash(data)}))),sections:r.analysis?.sections.length||0})));
  const annotations={};for(const key of Object.keys(localStorage).filter(k=>/^paperlens-pdf-/.test(k)&&k!=='paperlens-pdf-mode'))annotations[key]=await hash(localStorage.getItem(key)||'');
  const conversations={};for(const key of Object.keys(localStorage).filter(k=>/^pl-chat-/.test(k)))conversations[key]=await hash(localStorage.getItem(key)||'');
  return {papers:papers.sort((a,b)=>a.id.localeCompare(b.id)),annotations,conversations};
 });
 const path=process.env.PAPERREAD_DATA_BASELINE||'artifacts/v0.9.0-installed-data-before.json';
 if(mode==='before'){await writeFile(path,JSON.stringify(snapshot,null,2));console.log(JSON.stringify({baseline:true,papers:snapshot.papers.length,sections:snapshot.papers.reduce((n,x)=>n+x.sections,0),annotationStores:Object.keys(snapshot.annotations).length,conversations:Object.keys(snapshot.conversations).length}));}
 else{const before=JSON.parse(await readFile(path,'utf8'));assert.deepEqual(snapshot,before);assert.equal(await application.evaluate(({app})=>app.getVersion()),expectedVersion);await page.waitForSelector('.library-home');if(await page.locator('.home-title-cell>button').count())await page.locator('.home-title-cell>button').first().click();else {await page.getByRole('button',{name:'正在阅读',exact:true}).first().click();await page.getByRole('button',{name:'示例文献',exact:true}).click();}await page.waitForSelector('.pdf-page-drawing canvas');const headings=await page.locator('.reader-section>summary h2').allTextContents();assert.ok(headings.length);if(headings.some(t=>/^(?:续|证据性质|致谢|作者贡献|参考文献)$/.test(t.trim())))console.log(JSON.stringify({headings}));assert.ok(headings.every(t=>! /^(?:续|证据性质|致谢|作者贡献|参考文献)$/.test(t.trim())));if(process.env.PAPERREAD_CHECK_DOCUMENTS==='1'){
 const ids=snapshot.papers.filter(p=>p.sections>0).map(p=>p.id);
 await page.waitForFunction(async ids=>{for(const id of ids){const response=await fetch('/api/documents/'+encodeURIComponent(id)+'/source');if(!response.ok)return false;}return true;},ids,{timeout:60000,polling:1000});
 const documents=await page.evaluate(async ids=>Promise.all(ids.map(id=>fetch('/api/documents/'+encodeURIComponent(id)).then(r=>r.json()).then(info=>({id,...info})))),ids);
 for(const info of documents){assert.ok(info.hasPdf);assert.match(info.files.source,/^原文-.+-.+-.+\.md$/);assert.match(info.files.analysis,/^解析-.+-.+-.+\.md$/);await access(pathModule.join(info.folder,info.files.source));await access(pathModule.join(info.folder,info.files.analysis));const original=snapshot.papers.find(p=>p.id===info.id);assert.equal(createHash('sha256').update(await readFile(pathModule.join(info.folder,'原文.pdf'))).digest('hex'),original.pdf);}
 await writeFile('artifacts/v'+expectedVersion+'-local-document-check.json',JSON.stringify({documents:documents.map(info=>({id:info.id,folder:info.folder,files:info.files})),allThreeFilesPresent:true,pdfsIdentical:true},null,2));console.log(JSON.stringify({localDocumentFolders:documents.length,allThreeFilesPresent:true,pdfsIdentical:true}));
 }console.log(JSON.stringify({version:expectedVersion,papers:snapshot.papers.length,sections:snapshot.papers.reduce((n,x)=>n+x.sections,0),analysesNotesRevisionsPdfsAttachmentsAnnotationsAndConversations:'all hashes identical',nativePdf:'rendered'}));await writeFile('artifacts/v'+expectedVersion+'-installed-data-check.json',JSON.stringify({version:expectedVersion,preserved:true,papers:snapshot.papers.length,sections:snapshot.papers.reduce((n,x)=>n+x.sections,0)},null,2));}
 const exited=new Promise(resolve=>application.process().once('exit',resolve));await application.evaluate(({app})=>setImmediate(()=>app.quit()));await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('App quit timeout')),8000))]);
}finally{await application.close();}
