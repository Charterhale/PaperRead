import type { Paper } from '../types';
export interface JournalInfo {name:string;aliases:string[];issns:string[];indexes?:string[];cas?:{zone:number;top:boolean;edition:number};emerging?:{zone:number;top:boolean;edition:number};jcr?:{quartile:string;impactFactor:string;dataYear:string;edition:number;subjects:string};}
export interface JournalSource {name:string;sha256:string;count:number;casEdition:number;emergingEdition:number;jcrEdition:number;jifDataYears:string[];}
export type MetadataPatch=Pick<Paper,'authors'|'journal'|'year'|'doi'|'issns'|'citationCount'|'citationUpdatedAt'>;
export function doiFromPaper(p:Pick<Paper,'doi'|'pages'>){return p.doi||p.pages.slice(0,2).join(' ').match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0]?.replace(/[.,;]+$/,'');}
export function metadataPatch(latest:Paper,found:MetadataPatch):Partial<Paper>{
 const patch:Partial<Paper>={};for(const field of ['authors','journal','year','doi'] as const)if(!latest[field]?.trim()&&found[field]?.trim())patch[field]=found[field];
 if(!latest.issns?.length&&found.issns?.length&&(!latest.journal||latest.journal.toLowerCase()===found.journal?.toLowerCase()))patch.issns=found.issns;
 if(typeof found.citationCount==='number'&&Number.isSafeInteger(found.citationCount)&&found.citationCount>=0){patch.citationCount=found.citationCount;patch.citationUpdatedAt=found.citationUpdatedAt||Date.now();}
 return patch;
}
export function authorLabel(authors?:string){if(!authors)return '—';const parts=authors.split(/[,，;；、]/).map(x=>x.trim()).filter(Boolean);if(parts.length<2)return parts[0];const first=parts[0];return (/\p{Script=Han}/u.test(first)?first:first.split(/\s+/).slice(-1)[0])+' 等';}

export const badgeLabels={cas:'中科院分区',emerging:'新锐分区',jcr:'JCR 分区',impact:'影响因子',citations:'被引次数'};
export type BadgeKey=keyof typeof badgeLabels;
export const defaultBadgeOrder:BadgeKey[]=['cas','emerging','jcr','impact','citations'];
export function badgeOrder(value:unknown):BadgeKey[]{return [...new Set([...(Array.isArray(value)?value.filter((x):x is BadgeKey=>typeof x==='string'&&Object.hasOwn(badgeLabels,x)):[]),...defaultBadgeOrder])];}
