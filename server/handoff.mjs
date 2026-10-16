import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {ApiError} from './validation.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createPaperPostHandoff({directory,documents,launch=async()=>{}}){let queue=Promise.resolve();return body=>{const task=queue.catch(()=>{}).then(async()=>{
 if(typeof body.paperId!=='string'||!body.paper||body.paper.id!==body.paperId||typeof body.paper.title!=='string'||!body.analysis||!Array.isArray(body.analysis.sections)||!body.analysis.sections.length)throw new ApiError(400,'ANALYSIS_REQUIRED','请先完成文献解析，再投送到公众号写作器');
 const source=await documents.handoffFiles(body.paperId,body.analysis);const names={pdf:'原文.pdf',source:'原文.md',analysis:'解析.md',structured:'解析.json'};
 const files=Object.fromEntries(Object.entries(source).map(([key,bytes])=>[key,{name:names[key],sha256:hash(bytes)}]));
 const paper=Object.fromEntries(['id','title','translatedTitle','authors','journal','year','doi','pmid','category'].filter(k=>typeof body.paper[k]==='string').map(k=>[k,body.paper[k]]));
 const id=hash(JSON.stringify({paper,files})).slice(0,32);await mkdir(directory,{recursive:true,mode:0o700});if((await lstat(directory)).isSymbolicLink())throw Error('投送目录不能使用符号链接');const destination=path.join(directory,id);
 let exists=false;try{const stat=await lstat(destination);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('投送目录异常');exists=true;const old=JSON.parse(await readFile(path.join(destination,'bundle.json'),'utf8'));if(old.format!=='paperread-to-paperpost'||old.id!==id||JSON.stringify(old.files)!==JSON.stringify(files))throw Error('投送包校验失败');for(const [key,item] of Object.entries(files)){const file=path.join(destination,item.name);if((await lstat(file)).isSymbolicLink()||hash(await readFile(file))!==item.sha256)throw Error('投送包文件已变化，请检查本地目录');}}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!exists){const staging=path.join(directory,'.'+randomUUID()+'.tmp');await mkdir(staging,{mode:0o700});try{for(const [key,bytes] of Object.entries(source))await writeFile(path.join(staging,names[key]),bytes,{mode:0o600});await writeFile(path.join(staging,'bundle.json'),JSON.stringify({format:'paperread-to-paperpost',version:1,id,createdAt:Date.now(),paper,files},null,2),{mode:0o600});await rename(staging,destination);}finally{await rm(staging,{recursive:true,force:true});}}
 let opened=true;try{await launch('paperpost://paperread?bundle='+id);}catch{opened=false;}
 return {id,directory:destination,opened,reused:exists};
 });queue=task;return task;};}
