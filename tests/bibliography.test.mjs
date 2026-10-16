import { test } from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
process.env.PAPERREAD_JOURNAL_FILE=fileURLToPath(new URL('./fixtures/journals.json',import.meta.url));
const {matchJournal,journalSource,sameTitle,crossrefMetadata,createBibliographyService}=await import('../server/bibliography.mjs');
const work={DOI:'10.1234/example',title:['A detailed study of cellular ageing across tissues'],type:'journal-article','container-title':['Example Communications'],ISSN:['1234-5678'],author:[{given:'Alice',family:'Lee'},{given:'Bo',family:'Wang'}],'published-print':{'date-parts':[[2025,1]]},'published-online':{'date-parts':[[2024,12]]},created:{'date-parts':[[2026]]}};
test('synthetic local catalog matches exact title, punctuation, abbreviation and ISSN, without fuzzy guesses',()=>{
 for(const query of [{journal:'Example Communications'},{journal:'EX. COMMUN.'},{issns:['1234-5678']}]){const j=matchJournal(query);assert.equal(j.name,'Example Communications');assert.equal(j.cas.zone,1);assert.equal(j.emerging.edition,2026);assert.equal(j.jcr.dataYear,'2025');assert.equal(j.jcr.impactFactor,'18.1');}
 assert.equal(matchJournal({journal:'Example Communication'}),null);assert.equal(matchJournal({journal:'Example Journal',issns:['1234-5678']}),null);assert.equal(matchJournal({issns:['-']}),null);assert.equal(matchJournal({journal:'Example & Research'}).jcr.impactFactor,'9.9');assert.equal(journalSource.count,3);assert.deepEqual(journalSource.jifDataYears,['2025']);
});
test('metadata returns registered authors, journal and publication year rather than indexing year',()=>{
 const m=crossrefMetadata(work);assert.equal(m.authors,'Alice Lee, Bo Wang');assert.equal(m.year,'2025');assert.equal(m.journal,'Example Communications');assert.equal(crossrefMetadata({...work,type:'book-chapter'}),null);assert.equal(crossrefMetadata({DOI:'10.1/a'}),null);
});
test('DOI retrieval is bounded, cached and does not send PDF or analysis content',async()=>{
 const calls=[];const resolve=createBibliographyService({fetchImpl:async(url,opts)=>{calls.push({url,opts});return Response.json({message:work});}});
 assert.equal((await resolve({doi:'https://doi.org/10.1234/example',title:'中文标题',pages:['PRIVATE']})).metadata.authors,'Alice Lee, Bo Wang');await resolve({doi:'10.1234/example',title:'中文标题'});assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.crossref.org/works/10.1234%2Fexample');assert.equal(calls[0].opts.body,undefined);assert.equal(calls[0].opts.redirect,'error');
 await assert.rejects(()=>resolve({title:'x'.repeat(1300)}),/格式错误/);
});
test('title lookup rejects near matches and ambiguous identical titles',async()=>{
 assert.equal(sameTitle(work.title[0],'A completely unrelated cellular biology study'),false);assert.equal(sameTitle(work.title[0],work.title[0].toUpperCase()),true);
 for(const items of [[{...work,title:['Different article']}],[work,work],[]]){const r=createBibliographyService({fetchImpl:async()=>Response.json({message:{items}})});assert.equal((await r({doi:work.DOI,title:work.title[0]})).metadata,null);}
 const r=createBibliographyService({fetchImpl:async()=>Response.json({message:{items:[work]}})});assert.equal((await r({doi:work.DOI,title:work.title[0]})).metadata.year,'2025');
});
test('missing or failed upstream metadata does not fabricate a record',async()=>{
 const missing=createBibliographyService({fetchImpl:async()=>new Response('',{status:404})});assert.equal((await missing({doi:'10.1234/no',title:'Example title'})).metadata,null);
 const failed=createBibliographyService({fetchImpl:async()=>{throw Error('network');}});await assert.rejects(()=>failed({title:work.title[0]}),/暂时无法/);
});
test('automatic patches only fill empty fields and never overwrite manual metadata or reading content',async()=>{
 const {metadataPatch,authorLabel,doiFromPaper}=await import('../src/lib/bibliography.ts');const p={title:'unchanged',authors:'Manual author',journal:'User journal',year:'2020',notes:'private note',analysis:{sections:[1]},pages:['doi:10.1234/example'],issns:[]};const original=JSON.stringify(p);assert.deepEqual(metadataPatch(p,{authors:'API author',journal:'API journal',year:'2025',doi:'10.1234/example',issns:['1234-5678']}),{doi:'10.1234/example'});assert.equal(JSON.stringify(p),original);assert.equal(authorLabel('Alice Lee, Bo Wang'),'Lee 等');assert.equal(doiFromPaper(p),'10.1234/example');
});
test('a DOI not found in the registry falls back to exact title; HTML journal and author names become plain text',async()=>{
 let calls=0;const resolve=createBibliographyService({fetchImpl:async url=>{calls++;return url.includes('?query.title=')?Response.json({message:{items:[{...work,'container-title':['Example &amp; Research'],author:[{given:'A',family:'&lt;Lee&gt;'}]}]}}):new Response('',{status:404});}});const value=await resolve({doi:'10.1234/malformed)',title:work.title[0]});assert.equal(calls,2);assert.equal(value.metadata.journal,'Example & Research');assert.equal(value.metadata.authors,'A <Lee>');assert.equal(matchJournal({journal:value.metadata.journal}).cas.zone,1);
});
test('a DOI resolving to a different article cannot silently fill the wrong bibliography',async()=>{
 let calls=0;const resolve=createBibliographyService({fetchImpl:async url=>{calls++;return Response.json({message:url.includes('?query.title=')?{items:[work]}:{...work,title:['An unrelated registered article about clinical procedures']}});}});const value=await resolve({doi:'10.1234/other',title:work.title[0]});assert.equal(calls,2);assert.equal(value.metadata.title,work.title[0]);
});
test('citation counts preserve real zero and mark unknown as unknown; explicit refresh bypasses the cache',async()=>{
 let count=0;const r=createBibliographyService({fetchImpl:async()=>Response.json({message:{...work,'is-referenced-by-count':count++}})});const first=await r({doi:work.DOI,title:work.title[0]});assert.equal(first.metadata.citationCount,0);assert.ok(first.metadata.citationUpdatedAt>0);assert.equal((await r({doi:work.DOI,title:work.title[0]})).metadata.citationCount,0);assert.equal((await r({doi:work.DOI,title:work.title[0],refresh:true})).metadata.citationCount,1);assert.equal(crossrefMetadata(work).citationCount,undefined);
});
test('title-only translation uses a small request and leaves paragraph translation behavior intact',async()=>{
 const {createServices}=await import('../server/service.mjs');const requests=[];const service=createServices({complete:async input=>{requests.push(input);return {translation:'衰老细胞图谱'};},environmentKey:''});const value=await service.translate({provider:'codex',model:'codex-auto',mode:'title',text:'Atlas of ageing cells'});assert.deepEqual(value,{translation:'衰老细胞图谱'});assert.equal(requests[0].maxTokens,900);assert.equal(requests[0].images,undefined);assert.ok(requests[0].text.includes('Atlas of ageing cells'));await assert.rejects(()=>service.translate({provider:'codex',model:'codex-auto',mode:'title',text:'x'.repeat(1201)}),/标题过长/);
});
