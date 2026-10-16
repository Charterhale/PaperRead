import { chineseTitle } from '../lib/readingStructure';
/** Keep the original title in storage; figure references are quieter metadata. */
export function titleParts(title: string, fallback = '研究结果') {
  const pattern = /(?:(?:Extended\s+Data|Supplementary)\s+)?(?:Fig(?:ure)?\.?|Table)\s*\d+[a-z]?(?:\s*[–−-]\s*(?:\d+)?[a-z])?(?:\s*[,，]\s*(?:\d+)?[a-z](?:\s*[–−-]\s*(?:\d+)?[a-z])?)*(?:\s*(?:及|和)(?:相关)?(?:延伸数据|补充图))?/gi;
  const references: string[] = title.match(pattern) || [];
  const text = title.replace(pattern, '').replace(/[,，、]\s*([)）])/g, '$1').replace(/[(（]\s*[)）]/g, '').replace(/\s+/g, ' ').replace(/^[\s|·:：,，-]+|[\s|·:：,，-]+$/g, '').trim();
  const translated = /^([^(（]+)[(（]([^()（）]*[\p{Script=Han}][^()（）]*)[)）]\s*$/u.exec(text);
  // When the title already includes a Chinese translation, use that as the
  // reading heading. The unmodified bilingual title remains in its tooltip.
  const heading = translated && /[a-z]/i.test(translated[1]) && !/[\p{Script=Han}]/u.test(translated[1]) ? translated[2].trim() : text;
  return { text: chineseTitle(heading || title, fallback), references };
}
export default function ReadingTitle({ title, fallback, referenceTitles = [] }: { title: string; fallback?: string; referenceTitles?: string[] }) {
  const parts = titleParts(title, fallback);
  parts.references = [...new Set([...parts.references, ...referenceTitles.flatMap(t=>titleParts(t).references)])];
  return <span className="reading-title" title={title}><span>{parts.text}</span>{parts.references.length > 0 && <small className="title-references">{parts.references.join(' · ')}</small>}</span>;
}
