import type { CropRegion } from '../types';
export function rotateRegion(r:CropRegion,rotation:number):CropRegion{
  const {x,y,width,height}=r;
  if(rotation===90)return {x:1-y-height,y:x,width:height,height:width};
  if(rotation===180)return {x:1-x-width,y:1-y-height,width,height};
  if(rotation===270)return {x:y,y:1-x-width,width:height,height:width};
  return r;
}
export function validRegion(r:CropRegion){return [r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=1.002&&r.y+r.height<=1.002;}
export const normalizedText=(s:string)=>s.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}]/gu,'');
export function matchingTextRange(parts:string[],query:string){
  const term=normalizedText(query);if(term.length<2)return null;
  const normalized=parts.map(normalizedText),text=normalized.join('');
  const start=text.indexOf(term);if(start<0)return null;
  let offset=0;const indexes:number[]=[];
  normalized.forEach((str,i)=>{if(offset+str.length>start&&offset<start+term.length)indexes.push(i);offset+=str.length;});
  return indexes;
}
export function figureText(title:string){return title.match(/(?:Extended\s+Data\s+)?(?:Fig(?:ure)?\.?|图)\s*\d+/i)?.[0]||title;}
