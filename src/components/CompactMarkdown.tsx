import { useEffect, useState } from 'react';
import ReadingMarkdown from './ReadingMarkdown';
import { readingText } from '../lib/analysisEditing';
import { ChevronDown, ChevronUp } from 'lucide-react';

/** A presentation-only preview; editing, export and backup retain the full source. */
export default function CompactMarkdown({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const sync = (e: Event) => setExpanded(Boolean((e as CustomEvent).detail));
    window.addEventListener('paperread-text-preview', sync);
    return () => window.removeEventListener('paperread-text-preview', sync);
  }, []);
  const long = text.trim().length > 220;
  return <div className={'compact-markdown ' + (long && !expanded ? 'is-preview' : '')}>
    <div className="prose"><ReadingMarkdown>{readingText(text)}</ReadingMarkdown></div>
    {long && <button className="text-disclosure" title={expanded ? '收起' : '展开完整说明'} aria-label={expanded ? '收起' : '展开完整说明'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</button>}
  </div>;
}
