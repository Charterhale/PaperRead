import {createHash, randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,lstat,rm,access} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ApiError} from './validation.mjs';
const engineRoot=path.dirname(fileURLToPath(import.meta.url)).replace(/\.asar(?=[/\\])/g,'.asar.unpacked');
const native=path.join(engineRoot,'native','paperread-ocr');
const python=path.join(engineRoot,'runtime','python','bin','python3.12');
const converter=path.join(engineRoot,'runtime','pdf_to_md.py');
export function safeName(value,fallback,max=90){const clean=String(value||'').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').replace(/^[. ]+|[. ]+$/g,'');let result='';for(const ch of clean||fallback){if(Buffer.byteLength(result+ch)>max)break;result+=ch;}return result||fallback;}

export function documentMarkdownNames(entry){const stem=safeName(entry.stem||entry.folder,'未命名文献',220);return {source:'原文-'+stem+'.md',analysis:'解析-'+stem+'.md'};}
export function sourceMarkdown({title,pages,ocrPages=[]}){return `# ${String(title||'未命名文献').replace(/[\r\n]/g,' ')}\n\n[原文 PDF](./原文.pdf)\n\n`+pages.map((text,i)=>`## 第 ${i+1} 页\n\n${text.trim()||'> 此页没有可提取的文字，请查看原文 PDF；页面图像仍会参与解析。'}${ocrPages.includes(i+1)?'\n\n<!-- 本页文字由本机 OCR 识别 -->':''}\n\n[查看原页](./原文.pdf#page=${i+1})`).join('\n\n');}
const fields={question:'研究问题',groups:'分组与图例',xAxis:'横轴',yAxis:'纵轴',readout:'怎么读图',result:'结果',takeaway:'说明什么',method:'方法',statistics:'统计',explanation:'完整讲解'};
export function analysisMarkdown(a){return `# ${a.title}\n\n${a.overview||''}\n\n`+(a.sections||[]).map((s,i)=>`## ${i+1}. ${s.title}\n\n${s.summary}\n\n${s.proves}\n\n${s.markdown}\n\n`+(s.figures||[]).map(f=>`### ${f.title}\n\n${f.caption}\n\n`+(f.panels||[]).map(p=>`#### ${p.label} · ${p.type}\n\n`+Object.entries(fields).filter(([k])=>p[k]).map(([k,label])=>`**${label}**\n\n${p[k]}`).join('\n\n')).join('\n\n')).join('\n\n')).join('\n\n')+'\n';}
export function createDocumentStore(root,{ocrExecutable=native}={}){
 const queue=new Map();let serial=Promise.resolve();
 const key=id=>{if(typeof id!=='string'||!id||id.length>200)throw new ApiError(400,'INVALID_ID','文献标识无效');return createHash('sha256').update(id).digest('hex');};
 async function noLink(file){try{if((await lstat(file)).isSymbolicLink())throw Error('文献目录含符号链接，请选择独立文件夹');}catch(e){if(e.code!=='ENOENT')throw e;}}
 async function atomic(file,content){await noLink(file);const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,content,{mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true}).catch(()=>{});}}
 function run(id,fn){key(id);const pending=serial.catch(()=>{}).then(fn);serial=pending;queue.set(id,pending);return pending.finally(()=>{if(queue.get(id)===pending)queue.delete(id);});}
 async function metadata(id){await noLink(root);await mkdir(path.join(root,'.index'),{recursive:true,mode:0o700});await noLink(path.join(root,'.index'));let entry;try{entry=JSON.parse(await readFile(path.join(root,'.index',key(id)+'.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}if(entry&&(!entry.folder||path.basename(entry.folder)!==entry.folder||['.','..'].includes(entry.folder)))throw Error('文献目录索引损坏');return entry;}
 async function locate(id,details={}){let entry=await metadata(id);const previous=entry;details={...entry?.details,...Object.fromEntries(Object.entries(details).filter(([,v])=>v!==undefined))};const stem=[safeName(details.journal,'未知期刊',48),safeName(details.year,'未知年份',10),safeName(details.title,'未命名文献',150)].join('-');
  if(!entry||details.title&&entry.stem!==stem){let folder=stem;let dest=path.join(root,folder);try{await access(dest);if(entry?.folder!==folder){folder=stem+'-'+key(id).slice(0,8);dest=path.join(root,folder);}}catch{}
   await noLink(dest);if(entry&&entry.folder!==folder){await noLink(path.join(root,entry.folder));await rename(path.join(root,entry.folder),dest);}else await mkdir(dest,{recursive:true,mode:0o700});entry={...entry,id,folder,stem,details:{title:details.title,journal:details.journal,year:details.year}};await atomic(path.join(root,'.index',key(id)+'.json'),JSON.stringify(entry));}
  const dir=path.join(root,entry.folder);await noLink(dir);
  const names=documentMarkdownNames(entry),prior=previous?documentMarkdownNames(previous):{};
  for(const [kind,legacy] of Object.entries({source:'原文.md',analysis:'解析.md'})){
   const target=path.join(dir,names[kind]);await noLink(target);
   if(await access(target).then(()=>true,()=>false))continue;
   for(const name of [...new Set([prior[kind],legacy].filter(Boolean))]){const old=path.join(dir,name);await noLink(old);try{await rename(old,target);break;}catch(error){if(error.code!=='ENOENT')throw error;}}
  }
  return entry;
 }
 async function scan(pdf,pages){const wanted=pages.flatMap((p,i)=>p.trim().length<40?[i+1]:[]);if(!wanted.length)return {pages,ocrPages:[]};try{await access(ocrExecutable);}catch{return {pages,ocrPages:[]};}
  const output=await new Promise((resolve,reject)=>execFile(ocrExecutable,[pdf,wanted.join(',')],{timeout:300000,maxBuffer:24*1024*1024},(e,stdout)=>e?reject(e):resolve(stdout)));
  const found=JSON.parse(output),copy=[...pages],ocrPages=[];for(const [page,text] of Object.entries(found)){const n=Number(page);if(wanted.includes(n)&&typeof text==='string'&&text.trim().length>copy[n-1].trim().length){copy[n-1]=text;ocrPages.push(n);}}return {pages:copy,ocrPages};
 }
 return {
  root,
  async savePdf(id,bytes){if(!Buffer.isBuffer(bytes)||bytes.length>150*1024*1024||!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new ApiError(400,'INVALID_PDF','PDF 文件无效');return run(id,async()=>{const e=await locate(id);const hash=createHash('sha256').update(bytes).digest('hex');if(e.pdfHash!==hash||!await access(path.join(root,e.folder,'原文.pdf')).then(()=>true,()=>false)){await atomic(path.join(root,e.folder,'原文.pdf'),bytes);await atomic(path.join(root,'.index',key(id)+'.json'),JSON.stringify({...e,pdfHash:hash,extracted:false}));}return {folder:path.join(root,e.folder)};});},
  async sync(id,body,{ocr=false}={}){if(typeof body.title!=='string'||body.title.length>2000||!Array.isArray(body.pages)||body.pages.length>10000||body.pages.some(p=>typeof p!=='string')||body.pages.join('').length>20000000||body.analysisMarkdown!==undefined&&(typeof body.analysisMarkdown!=='string'||body.analysisMarkdown.length>20000000))throw new ApiError(400,'INVALID_DOCUMENT','文献文档格式无效');
   return run(id,async()=>{const e=await locate(id,body),dir=path.join(root,e.folder);let result={pages:body.pages,ocrPages:[]};
    const extracting=ocr||body.analysisMarkdown!==undefined;
    if(e.extracted){try{result=JSON.parse(await readFile(path.join(dir,'.source.json'),'utf8'));}catch{if(!extracting)throw Error('原文 Markdown 缓存缺失，请重新解析');e.extracted=false;}}
    if(extracting&&!e.extracted){
      const hasPdf=await access(path.join(dir,'原文.pdf')).then(()=>true,()=>false);
      if(hasPdf){
        let conversion;try{conversion=JSON.parse(await new Promise((resolve,reject)=>execFile(python,[converter,path.join(dir,'原文.pdf'),'--json'],{timeout:300000,maxBuffer:40*1024*1024,env:{...process.env,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:path.join(engineRoot,'runtime','python','lib','python3.12','site-packages')}},(error,out)=>error?reject(error):resolve(out))));}catch{throw new ApiError(500,'MARKITDOWN_FAILED','MarkItDown 提取未完成；PDF 已保存，请重试。');}
        if(!Array.isArray(conversion.pages)||conversion.pages.length!==body.pages.length)throw new ApiError(500,'SOURCE_PAGE_MISMATCH','Markdown 与 PDF 页数不一致，已停止解析，请重试');
        result=await scan(path.join(dir,'原文.pdf'),conversion.pages);result.engine=conversion.engine;
      }
      await atomic(path.join(dir,'.source.json'),JSON.stringify(result));
      await atomic(path.join(dir,documentMarkdownNames(e).source),sourceMarkdown({...body,...result}));
    }
    if(e.extracted&&!await access(path.join(dir,documentMarkdownNames(e).source)).then(()=>true,()=>false))await atomic(path.join(dir,documentMarkdownNames(e).source),sourceMarkdown({...body,...result}));
    if(body.analysisMarkdown!==undefined)await atomic(path.join(dir,documentMarkdownNames(e).analysis),body.analysisMarkdown);
    await atomic(path.join(root,'.index',key(id)+'.json'),JSON.stringify({...e,extracted:e.extracted||extracting}));
    return {folder:dir,hasPdf:await access(path.join(dir,'原文.pdf')).then(()=>true,()=>false),...result};
   });},
  async result(id,analysis){return run(id,async()=>{if(!await metadata(id))return;const e=await locate(id);await atomic(path.join(root,e.folder,documentMarkdownNames(e).analysis),analysisMarkdown(analysis));});},
  async info(id){return run(id,async()=>{const e=await metadata(id);if(!e)return null;const folder=path.join(root,e.folder);await noLink(folder);return {folder,files:{pdf:'原文.pdf',...documentMarkdownNames(e)},pdfHash:e.pdfHash,hasPdf:await access(path.join(folder,'原文.pdf')).then(()=>true,()=>false)};});},
  async handoffFiles(id,analysis){return run(id,async()=>{if(!await metadata(id))throw new ApiError(404,'SOURCE_MISSING','本地文献文件尚未准备');const e=await locate(id);const dir=path.join(root,e.folder);await noLink(dir);const files={};for(const [key,name] of Object.entries({pdf:'原文.pdf',source:documentMarkdownNames(e).source})){const file=path.join(dir,name);await noLink(file);try{files[key]=await readFile(file);}catch{throw new ApiError(404,'SOURCE_MISSING','缺少'+name+'，请先生成原文 Markdown');}}files.analysis=Buffer.from(analysisMarkdown(analysis),'utf8');files.structured=Buffer.from(JSON.stringify(analysis),'utf8');return files;});},
  async readSource(id){return run(id,async()=>{if(!await metadata(id))throw new ApiError(404,'SOURCE_MISSING','请先点击解析，生成原文 Markdown');const e=await locate(id);const file=path.join(root,e.folder,documentMarkdownNames(e).source);await noLink(path.join(root,e.folder));await noLink(file);try{return await readFile(file,'utf8');}catch{throw new ApiError(404,'SOURCE_MISSING','请先点击解析，生成原文 Markdown');}});},
  async removePdf(id){return run(id,async()=>{const e=await metadata(id);if(!e)return;const dir=path.join(root,e.folder);await noLink(dir);await noLink(path.join(dir,'原文.pdf'));await rm(path.join(dir,'原文.pdf'),{force:true});});},
 };
}
