import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createBackupStore } from '../server/backups.mjs';
import { startServer } from '../server/index.mjs';
const archive=gzipSync(JSON.stringify({format:'paperlens-backup',version:1,createdAt:new Date().toISOString(),papers:[],local:{},jobs:{format:'paperlens-jobs',version:1,records:[]}}));
test('automatic snapshots rotate only verified managed backups and detect corrupt bytes',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'paperlens-backups-'));
  try{
    const store=createBackupStore(dir);await writeFile(path.join(dir,'manual.paperlens.gz'),'preserve');
    for(let i=0;i<5;i++)await store.save(archive,3);
    const items=await store.list();assert.equal(items.length,3);assert.deepEqual(await store.read(items[0].id),archive);
    await assert.rejects(store.save(Buffer.from('invalid'),3));assert.equal((await store.list()).length,3);
    assert.ok((await readdir(dir)).includes('manual.paperlens.gz'));
    await assert.rejects(store.read('../../secret'));
    await writeFile(path.join(dir,items[0].id),Buffer.alloc(archive.length,0));
    await assert.rejects(store.read(items[0].id),/校验失败/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('backup HTTP routes accept local compressed snapshots and reject foreign origins',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'paperlens-backup-http-')),server=await startServer({port:0,backupDir:path.join(dir,'backups'),jobDir:path.join(dir,'jobs')});
  const url='http://127.0.0.1:'+server.address().port;
  try{
    const bad=await fetch(url+'/api/backups',{method:'POST',headers:{origin:'https://evil.example','Content-Type':'application/gzip'},body:archive});assert.equal(bad.status,403);
    const result=await fetch(url+'/api/backups?keep=3',{method:'POST',headers:{'Content-Type':'application/gzip'},body:archive});assert.equal(result.status,201);const saved=await result.json();
    assert.equal((await(await fetch(url+'/api/backups')).json()).items.length,1);
    assert.deepEqual(Buffer.from(await(await fetch(url+'/api/backups/'+saved.id)).arrayBuffer()),archive);
    const invalid=await fetch(url+'/api/backups',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(invalid.status,400);
  }finally{await server.jobs.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
