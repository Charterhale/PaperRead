// Retrieval is local and bounded. The original document and analysis are untouched.
import { ApiError, LIMITS, requiredString } from './validation.mjs';
const stop = new Set(['what', 'which', 'this', 'that', 'does', 'paper', 'figure', 'about', 'please', '研究', '什么', '文献', '文章', '这个', '怎么', '如何']);
function terms(value) {
  const lower = value.toLowerCase(), found = lower.match(/[a-z][a-z0-9_-]{1,}|[\p{Script=Han}]+/gu) || [];
  return [...new Set(found.flatMap(word => /[\p{Script=Han}]/u.test(word) ? Array.from({ length: Math.max(0, word.length - 1) }, (_, i) => word.slice(i, i + 2)) : [word]).filter(word => !stop.has(word)))];
}
function passages(text, page, kind) {
  const items = [];
  for (let start = 0; start < text.length; start += 1_000) items.push({ page, kind, start, text: text.slice(start, start + 1_300) });
  return items;
}
function select(items, query, maximum, anchors = []) {
  const ranked = items.map((item, index) => {
    const lower = item.text.toLowerCase();
    const score = query.reduce((sum, term) => sum + (lower.includes(term) ? (/^[a-z]/.test(term) ? 6 : 1) : 0), 0);
    return { item, index, score: score + (anchors.includes(item.page) ? 0.5 : 0) };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  let size = 0;
  const chosen = [];
  for (const entry of ranked) {
    const length = JSON.stringify(entry.item).length;
    if (size + length > maximum) continue;
    chosen.push(entry); size += length;
    if (chosen.length >= 18) break;
  }
  return chosen.sort((a, b) => a.index - b.index).map(({ item }) => item);
}
export function questionContext(body, pages) {
  const question = requiredString(body.question, '问题', LIMITS.questionCharacters);
  const messages = body.messages ?? [];
  if (!Array.isArray(messages) || messages.length > 200) throw new ApiError(400, 'INVALID_MESSAGES', '对话历史格式不正确。');
  for (const message of messages) if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new ApiError(400, 'INVALID_MESSAGES', '对话历史格式不正确。');
  const history = messages.slice(-6).map(message => ({ role: message.role, content: message.content.slice(-1_000) }));
  const query = terms(question + ' ' + history.filter(m => m.role === 'user').slice(-1).map(m => m.content).join(' '));
  const section = body.analysis?.sections?.find?.(s => s.id === body.activeSectionId);
  const anchors = [section?.page, body.page].filter(n => Number.isInteger(n) && n >= 1 && n <= pages.length);
  const source = select(pages.flatMap((text, index) => passages(text, index + 1, 'original')), query, 26_000, anchors);
  const analysis = body.analysis;
  const candidates = [];
  const add = (text, page, kind) => { if (typeof text === 'string') candidates.push(...passages(text, page, kind)); };
  add(analysis?.overview, 1, 'overview');
  for (const s of Array.isArray(analysis?.sections) ? analysis.sections : []) {
    add([s.title, s.summary, s.proves, s.markdown].filter(v => typeof v === 'string').join('\n'), s.page, 'analysis');
    for (const f of Array.isArray(s.figures) ? s.figures : []) {
      add([f.title, f.caption].filter(v => typeof v === 'string').join('\n'), f.page, 'figure');
      for (const p of Array.isArray(f.panels) ? f.panels : []) add(['label', 'type', 'question', 'method', 'groups', 'xAxis', 'yAxis', 'readout', 'result', 'statistics', 'takeaway', 'explanation'].map(key => typeof p[key] === 'string' ? p[key] : '').join('\n'), f.page, 'panel');
    }
  }
  const related = select(candidates, query, 13_000, anchors);
  // The short outline helps whole-paper questions without resending every panel.
  const outline = (Array.isArray(analysis?.sections) ? analysis.sections : []).slice(0, 200).map(s => ({ page: s.page, title: String(s.title || '').slice(0, 180), finding: String(s.proves || s.summary || '').slice(0, 140) }));
  let outlineJson = JSON.stringify(outline);
  if (outlineJson.length > 25_000) outlineJson = JSON.stringify(outline.map(({ page, title }) => ({ page, title })));
  return { question, historyJson: JSON.stringify(history), analysisJson: JSON.stringify(related), outlineJson, sourceJson: JSON.stringify(source), context: { mode: 'retrieved', pages: [...new Set(source.map(item => item.page))], totalPages: pages.length } };
}
