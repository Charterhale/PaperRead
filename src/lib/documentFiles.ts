import type {Paper} from '../types';
import {getPdf} from './storage';
import {exportMarkdown} from './markdown';
const queues=new Map<string,Promise<unknown>>();
async function request(path:string,options:RequestInit={}){const r=await fetch('/api/documents/'+path,options),value=await r.json();if(!r.ok)throw Error(value.error||'本地文献文件保存失败');return value;}
export function syncDocument(paper:Paper,bytes?:Uint8Array,ocr=false):Promise<{folder:string;hasPdf:boolean;pages:string[];ocrPages:number[]}>{
 if(paper.demo||paper.pdfRemoved)return Promise.resolve({folder:'',hasPdf:false,pages:paper.pages,ocrPages:[]});
 const task=(queues.get(paper.id)||Promise.resolve()).catch(()=>{}).then(async()=>{
  const info=await request(encodeURIComponent(paper.id));
  if(bytes&&paper.fileHash&&info?.hasPdf&&info.pdfHash===paper.fileHash)bytes=undefined;
  if(!bytes&&!info?.hasPdf)bytes=(await getPdf(paper.id))||undefined;
  if(bytes)await request(encodeURIComponent(paper.id)+'/pdf',{method:'POST',headers:{'Content-Type':'application/pdf'},body:Uint8Array.from(bytes).buffer});
  return request(encodeURIComponent(paper.id)+'/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:paper.title,journal:paper.journal,year:paper.year,pages:paper.pages,analysisMarkdown:paper.analysis?exportMarkdown(paper):undefined,ocr})});
 });queues.set(paper.id,task);void task.finally(()=>{if(queues.get(paper.id)===task)queues.delete(paper.id);}).catch(()=>{});return task;
}
export async function openDocumentFolder(p:Paper,bytes?:Uint8Array){await syncDocument(p,bytes);return request(encodeURIComponent(p.id)+'/open',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}
export async function removeDocumentPdf(id:string){await queues.get(id)?.catch(()=>{});return request(encodeURIComponent(id)+'/pdf',{method:'DELETE'});}
