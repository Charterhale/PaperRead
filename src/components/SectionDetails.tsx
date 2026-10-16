import ReadingMarkdown from './ReadingMarkdown';
import { readingText } from '../lib/analysisEditing';

/** One optional reading layer; retain the saved Markdown and all source links. */
export default function SectionDetails({ text }: { paperId: string; sectionId: string; text: string }) {
  return <div className="section-markdown prose"><ReadingMarkdown>{readingText(text)}</ReadingMarkdown></div>;
}
