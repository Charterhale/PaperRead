import { readFileSync } from 'node:fs';
import { ApiError } from './validation.mjs';
const data=JSON.parse(readFileSync(process.env.PAPERREAD_JOURNAL_FILE||new URL('./data/journals.json',import.meta.url),'utf8'));
export const journalSource={...data.source,count:data.journals.length};
export const normalizeJournal=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/&/g,'and').replace(/[^\p{L}\p{N}]/gu,'');
const names=new Map(),issns=new Map();
function index(map,key,row){if(!key)return;const set=map.get(key)||new Set();set.add(row);map.set(key,set);}
for(const row of data.journals){for(const name of [row.name,...row.aliases])index(names,normalizeJournal(name),row);for(const issn of row.issns)if(/^\d{4}-\d{3}[\dX]$/i.test(issn))index(issns,issn.toUpperCase(),row);}
export function matchJournal({journal='',issns:ids=[]}={}){
 const named=names.get(normalizeJournal(journal)),identified=new Set(ids.flatMap(id=>[...(issns.get(String(id).toUpperCase())||[])]));
 if(named?.size===1){const row=[...named][0];return identified.size&&!identified.has(row)?null:row;}
 if(named?.size>1)return null;
 return identified.size===1?[...identified][0]:null;
}
export const plainText=value=>String(value||'').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'\"',apos:"'",nbsp:' '})[key]).replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,value)=>{const n=value[0].toLowerCase()==='x'?parseInt(value.slice(1),16):Number(value);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/\s+/g,' ').trim();
export function normalizeDoi(value){const d=String(value||'').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'').replace(/[.,;]+$/,'');return /^10\.\d{4,9}\/[^\s?#]+$/i.test(d)?d:undefined;}
const titleKey=s=>plainText(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function sameTitle(a,b){const x=titleKey(a),y=titleKey(b);if(x.length<20||y.length<20)return x.length>8&&x===y;return x===y||(Math.min(x.length,y.length)/Math.max(x.length,y.length)>.94&&(x.includes(y)||y.includes(x)));}
export function crossrefMetadata(work){
 if(!work?.DOI||!work.title?.[0]||!work['container-title']?.[0]||work.type&&work.type!=='journal-article')return null;
 const authors=(work.author||[]).map(a=>plainText([a.given,a.family].filter(Boolean).join(' ')||a.name||'')).filter(Boolean).join(', ');
 // Prefer journal issue year when supplied; avoid the API indexing/creation year.
 const year=[work['published-print'],work['published-online'],work.published,work.issued].map(d=>d?.['date-parts']?.[0]?.[0]).find(v=>Number.isInteger(v)&&v>=1800&&v<=2100);
 return {title:plainText(work.title[0]),doi:work.DOI,authors,journal:plainText(work['container-title'][0]),year:year?String(year):'',issns:(work.ISSN||[]).filter(x=>/^\d{4}-\d{3}[\dX]$/i.test(x)),...(Number.isInteger(work['is-referenced-by-count'])&&work['is-referenced-by-count']>=0?{citationCount:work['is-referenced-by-count'],citationUpdatedAt:Date.now()}:{}),source:'Crossref',sourceUrl:'https://api.crossref.org/works/'+encodeURIComponent(work.DOI)};
}
export function createBibliographyService({fetchImpl=globalThis.fetch}={}){
 const cache=new Map();let active=0;
 return async function resolve(body){
  if(typeof body?.title!=='string'||body.title.length>1200||body.doi!==undefined&&typeof body.doi!=='string'||body.doi?.length>500)throw new ApiError(400,'INVALID_METADATA','文献资料格式错误');
  const doi=normalizeDoi(body.doi),title=body.title.trim();if(!doi&&title.length<20)return {metadata:null};
  const key=doi?.toLowerCase()||titleKey(title),saved=cache.get(key);if(!body.refresh&&saved&&saved.expires>Date.now())return saved.value;
  if(active>=3)throw new ApiError(429,'METADATA_BUSY','期刊资料正在补齐，请稍后重试');active++;
  const read=async url=>{const r=await fetchImpl(url,{headers:{Accept:'application/json','User-Agent':'PaperRead/0.8.1 (bibliographic metadata lookup)'},signal:AbortSignal.timeout(15000),redirect:'error'});if(r.status===404)return null;if(!r.ok)throw Error('upstream');return r.json();};
  try{
   let work;
   if(doi){const value=await read('https://api.crossref.org/works/'+encodeURIComponent(doi));work=value?.message;}
   if(work&&(!crossrefMetadata(work)||(!/\p{Script=Han}/u.test(title)&&(title.match(/[A-Za-z]+/g)||[]).length>=5&&!sameTitle(title,work.title?.[0]))))work=undefined;
   if(!work&&title.length>=20){const value=await read('https://api.crossref.org/works?query.title='+encodeURIComponent(title)+'&rows=3&filter=type:journal-article');const matches=(value?.message?.items||[]).filter(w=>sameTitle(title,w.title?.[0]));if(matches.length===1)work=matches[0];}
   const metadata=crossrefMetadata(work),value={metadata};if(metadata){cache.set(key,{expires:Date.now()+86400000,value});if(cache.size>1000)cache.delete(cache.keys().next().value);}return value;
  }catch{throw new ApiError(502,'METADATA_NETWORK','暂时无法补齐期刊资料，可稍后重试');}finally{active--;}
 };
}
