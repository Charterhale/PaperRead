import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const mode=process.argv[2]||'after';
const application=await electron.launch({executablePath:'/Users/Apple/Applications/PaperRead.app/Contents/MacOS/PaperRead',args:[],timeout:30000});
try{
 const page=await application.firstWindow();await page.waitForSelector('.brand');
 const snapshot=await page.evaluate(async()=>{
  const hash=async(value)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const records=await new Promise((resolve,reject)=>{const request=indexedDB.open('paperlens-library',1);request.onsuccess=()=>{const db=request.result;const rows=db.transaction('papers').objectStore('papers').getAll();rows.onsuccess=()=>{resolve(rows.result);db.close();};rows.onerror=()=>reject(rows.error);};request.onerror=()=>reject(request.error);});
  const papers=await Promise.all(records.map(async r=>({id:r.id,analysis:await hash(JSON.stringify(r.analysis||null)),notes:await hash(r.notes||''),revisions:await hash(JSON.stringify(r.revisions||[])),pdf:r.pdf?await hash(r.pdf):null,supplements:await hash(JSON.stringify(r.supplements||[])),supplementLinks:await hash(JSON.stringify(r.supplementLinks||[])),attachments:await Promise.all(Object.entries(r.supplementPdfs||{}).map(async([id,data])=>({id,hash:await hash(data)}))),sections:r.analysis?.sections.length||0})));
  const annotations={};for(const key of Object.keys(localStorage).filter(k=>/^paperlens-pdf-/.test(k)&&k!=='paperlens-pdf-mode'))annotations[key]=await hash(localStorage.getItem(key)||'');
  return {papers:papers.sort((a,b)=>a.id.localeCompare(b.id)),annotations};
 });
 const path='artifacts/v0.7.4-installed-data-before.json';
 if(mode==='before'){await writeFile(path,JSON.stringify(snapshot,null,2));console.log(JSON.stringify({baseline:true,papers:snapshot.papers.length,sections:snapshot.papers.reduce((n,x)=>n+x.sections,0),annotationStores:Object.keys(snapshot.annotations).length}));}
 else{const before=JSON.parse(await readFile(path,'utf8'));assert.deepEqual(snapshot,before);assert.equal(await application.evaluate(({app})=>app.getVersion()),'0.7.4');await page.waitForSelector('.pdf-page-drawing canvas');const headings=await page.locator('.reader-section>summary h2').allTextContents();assert.ok(headings.length);assert.ok(headings.every(t=>! /^(?:续|证据性质|致谢|作者贡献|参考文献)$/.test(t.trim())));console.log(JSON.stringify({version:'0.7.4',papers:snapshot.papers.length,sections:snapshot.papers.reduce((n,x)=>n+x.sections,0),analysesNotesRevisionsPdfsAttachmentsAnnotations:'all hashes identical',nativePdf:'rendered'}));await writeFile('artifacts/v0.7.4-installed-data-check.json',JSON.stringify({version:'0.7.4',preserved:true,papers:snapshot.papers.length,sections:snapshot.papers.reduce((n,x)=>n+x.sections,0)},null,2));}
 const exited=new Promise(resolve=>application.process().once('exit',resolve));await application.evaluate(({app})=>setImmediate(()=>app.quit()));await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('App quit timeout')),8000))]);
}finally{await application.close();}
