import type { JournalInfo } from './bibliography';
import type { Paper, SmartGroup } from '../types';

export type LibraryScope = 'all'|'recent'|'unfiled'|'duplicates'|'starred'|'reading'|'done'|`folder:${string}`|`smart:${string}`;
export type LibrarySort = 'added'|'read'|'title'|'authors'|'journal'|'year'|'cas'|'emerging'|'jcr'|'impact'|'citations'|'tags';
export function duplicatePaperIds(papers: Paper[]): Set<string> {
  const keys = new Map<string, Set<string>>(), duplicates = new Set<string>();
  for (const p of papers) {
    const doi = (p.doi || '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');
    for (const key of [p.fileHash ? 'hash:' + p.fileHash : '', doi ? 'doi:' + doi : ''].filter(Boolean)) {
      const ids = keys.get(key) || new Set<string>(); ids.add(p.id); keys.set(key, ids);
    }
  }
  for (const ids of keys.values()) if (ids.size > 1) ids.forEach(id => duplicates.add(id));
  return duplicates;
}
export function libraryPapers(papers: Paper[], options: {scope:LibraryScope;folderIds:string[];query:string;sort:LibrarySort;descending:boolean;category?:string;status?:string;duplicates?:Set<string>;journals?:Record<string,JournalInfo|null>;smartGroup?:SmartGroup}) {
  const {scope,folderIds,sort,descending} = options, duplicates=options.duplicates || duplicatePaperIds(papers);
  const words=options.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return papers.filter(p=>{
    if(p.deletedAt || p.mergedInto || p.demo)return false;
    if(scope.startsWith('folder:')&&!paperFolders(p).includes(scope.slice(7)))return false;
    if(scope==='starred'&&!p.starred || scope==='reading'&&p.readingStatus!=='reading' || scope==='done'&&p.readingStatus!=='done')return false;
    if(scope==='recent'&&!p.lastReadAt || scope==='unfiled'&&paperFolders(p).some(id=>folderIds.includes(id)) || scope==='duplicates'&&!duplicates.has(p.id))return false;
    if(options.smartGroup&&!matchesSmart(p,options.smartGroup,options.journals?.[p.id]))return false;
    if(options.category&&options.category!=='all'&&p.category!==options.category)return false;
    if(options.status&&options.status!=='all'&&(p.readingStatus||'unread')!==options.status)return false;
    if(words.length){const haystack=[p.title,p.titleTranslation?.original===p.title?p.titleTranslation.text:'',p.authors,p.journal,p.year,p.doi,p.pmid,p.fileName,p.notes,...(p.tags||[]),...(p.pages||[]),p.analysis?.overview].join(' ').toLocaleLowerCase();if(!words.every(word=>haystack.includes(word)))return false;}
    return true;
  }).sort((a,b)=>{
    const metric=(p:Paper):number|undefined=>{const j=options.journals?.[p.id];if(sort==='cas')return j?.cas?.zone;if(sort==='emerging')return j?.emerging?.zone;if(sort==='jcr')return j?.jcr?.quartile?Number(j.jcr.quartile.slice(1)):undefined;if(sort==='impact')return j?.jcr?.impactFactor&&/^\d+(\.\d+)?$/.test(j.jcr.impactFactor)?Number(j.jcr.impactFactor):undefined;if(sort==='citations')return p.citationCount;};
    if(['cas','emerging','jcr','impact','citations'].includes(sort)){const x=metric(a),y=metric(b);if(x===undefined||y===undefined)return (x===undefined?1:0)-(y===undefined?1:0)||a.id.localeCompare(b.id);return (descending?-1:1)*(x-y)||a.id.localeCompare(b.id);}
    const result=sort==='added'?a.addedAt-b.addedAt:sort==='read'?(a.lastReadAt||0)-(b.lastReadAt||0):sort==='year'?(Number(a.year)||0)-(Number(b.year)||0):sort==='tags'?(a.tags||[]).join(' ').localeCompare((b.tags||[]).join(' '),'zh-CN'):(a[sort as 'title'|'authors'|'journal']||'').localeCompare(b[sort as 'title'|'authors'|'journal']||'','zh-CN',{numeric:true,sensitivity:'base'});
    return (descending?-result:result)||a.id.localeCompare(b.id);
  });
}
export type BibliographicPatch = Pick<Paper,'title'|'authors'|'journal'|'year'|'doi'|'pmid'|'officialUrl'|'category'|'folderId'|'tags'|'readingStatus'|'starred'>;

/** Old libraries keep their scalar folder without a data migration. */
export function paperFolders(p:Pick<Paper,'folderId'|'folderIds'>):string[]{return [...new Set((p.folderIds??[p.folderId]).filter(id=>id&&id!=='__unfiled'))];}
export function withFolders(ids:string[]):Pick<Paper,'folderId'|'folderIds'>{const folderIds=[...new Set(ids.filter(id=>id&&id!=='__unfiled'))];return {folderIds,folderId:folderIds[0]||'__unfiled'};}
export function matchesSmart(p:Paper,g:SmartGroup,j?:JournalInfo|null){
 if(g.category&&g.category!=='all'&&p.category!==g.category||g.status&&g.status!=='all'&&(p.readingStatus||'unread')!==g.status)return false;
 if(g.yearFrom&&(!p.year||Number(p.year)<Number(g.yearFrom))||g.yearTo&&(!p.year||Number(p.year)>Number(g.yearTo)))return false;
 if(g.tag&&!(p.tags||[]).includes(g.tag))return false;
 if(g.cas&&String(j?.cas?.zone)!==g.cas||g.jcr&&j?.jcr?.quartile!==g.jcr)return false;
 const words=g.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean),text=[p.title,p.authors,p.journal,p.notes,...p.pages,...(p.tags||[])].join(' ').toLocaleLowerCase();return words.every(w=>text.includes(w));
}
