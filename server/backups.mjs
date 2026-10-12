import { mkdir, readdir, readFile, open, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { ApiError } from './validation.mjs';

const unzip=promisify(gunzip), valid=/^auto-[0-9]{13}-[a-f0-9-]{36}\.paperlens\.gz$/;
const digest=b=>createHash('sha256').update(b).digest('hex');
export function createBackupStore(directory){
  let writing=false;
  async function list(){
    await mkdir(directory,{recursive:true,mode:0o700});
    const items=[];
    for(const name of await readdir(directory)){
      if(!valid.test(name))continue;
      try{const meta=JSON.parse(await readFile(path.join(directory,name+'.json'),'utf8'));const info=await stat(path.join(directory,name));if(info.size===meta.bytes)items.push({...meta,id:name});}catch{/* Incomplete writes are never offered for restore. */}
    }
    return items.sort((a,b)=>b.createdAt-a.createdAt);
  }
  async function save(bytes,keep=7){
    if(writing)throw new ApiError(409,'BACKUP_BUSY','已有备份正在保存，请稍后重试。');
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>1024**3)throw new ApiError(400,'INVALID_BACKUP','备份大小无效。');
    if(![3,7,14,30].includes(keep))throw new ApiError(400,'INVALID_RETENTION','请选择保留 3、7、14 或 30 份。');
    writing=true;let temp;
    try{
      let archive;try{archive=JSON.parse(await unzip(bytes,{maxOutputLength:1024**3}));}catch{throw new ApiError(400,'INVALID_BACKUP','备份压缩包校验失败，原有备份未改变。');}
      if(archive?.format!=='paperlens-backup'||archive.version!==1||!Array.isArray(archive.papers)||!archive.local||archive.jobs?.format!=='paperlens-jobs')throw new ApiError(400,'INVALID_BACKUP','这不是完整的 PaperLens 备份。');
      const createdAt=Date.now(),id=`auto-${createdAt}-${randomUUID()}.paperlens.gz`,file=path.join(directory,id);
      await mkdir(directory,{recursive:true,mode:0o700});temp=file+'.tmp';
      const handle=await open(temp,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
      const sha256=digest(bytes);if(digest(await readFile(temp))!==sha256)throw new Error('备份写入校验失败');
      await rename(temp,file);temp=undefined;
      const meta={createdAt,bytes:bytes.length,paperCount:archive.papers.length,sha256};
      const h=await open(file+'.json.tmp','wx',0o600);try{await h.writeFile(JSON.stringify(meta));await h.sync();}finally{await h.close();}await rename(file+'.json.tmp',file+'.json');
      // Only this managed directory and our generated names participate in retention.
      for(const old of (await list()).slice(keep)){await unlink(path.join(directory,old.id));await unlink(path.join(directory,old.id+'.json')).catch(()=>{});}
      return {id,...meta};
    }finally{writing=false;if(temp)await unlink(temp).catch(()=>{});}
  }
  async function read(id){
    if(!valid.test(id))throw new ApiError(400,'INVALID_BACKUP_ID','备份编号无效。');
    let bytes,meta;try{bytes=await readFile(path.join(directory,id));meta=JSON.parse(await readFile(path.join(directory,id+'.json'),'utf8'));}catch{throw new ApiError(404,'BACKUP_NOT_FOUND','备份不存在。');}
    if(digest(bytes)!==meta.sha256)throw new ApiError(422,'BACKUP_CORRUPT','备份校验失败，请选择另一份备份。');
    return bytes;
  }
  return {list,save,read,directory};
}
