import { ApiError, LIMITS, normalizeSynthesis } from './validation.mjs';
import { SCIENTIFIC_SYSTEM } from './prompts.mjs';

function orderedItems(items, ids) {
  const byId = new Map(items.map(item => [item.id, item]));
  const ordered = [];
  for (const id of ids) if (byId.has(id)) { ordered.push(byId.get(id)); byId.delete(id); }
  return { items: [...ordered, ...byId.values()], omitted: byId.size > 0 };
}

function groupMaterials(nodes, maximum = 90_000) {
  const groups = [];
  let group = [], length = 2;
  for (const node of nodes) {
    const size = JSON.stringify(node.material).length + 1;
    if (group.length && (length + size > maximum || group.length >= 160)) { groups.push(group); group = []; length = 2; }
    group.push(node); length += size;
  }
  if (group.length) groups.push(group);
  return groups;
}

// The model only summarizes and orders. It never gets authority to replace the
// detailed sections, figures or panels that were already saved by each batch.
export async function synthesizeAnalysis(results, { complete, auth, signal, onProgress }) {
  const checkCancelled = () => { if (signal?.aborted) throw new ApiError(499, 'REQUEST_CANCELLED', '请求已取消。'); };
  const summarize = async (source, ids, intermediate = false) => {
    checkCancelled();
    const serialized = JSON.stringify(source);
    if (serialized.length > LIMITS.synthesisCharacters) throw new ApiError(500, 'SYNTHESIS_PLAN_INVALID', '全文整合计划超出单批限制，请重试。');
    return normalizeSynthesis(await complete({
      ...auth, signal, maxTokens: 10_000, system: SCIENTIFIC_SYSTEM,
      text: `任务：根据以下顺序完整的文献分段解析，${intermediate ? '整合这一组材料的研究逻辑与主要发现，供下一层全文汇总' : '整合全文的研究逻辑与主要发现'}。正文小节与图片将由程序完整保留，你只生成总览和顺序，不得删除任何小节。orderedSectionIds 必须包含每个输入 id 恰好一次，优先遵循论文原有顺序，并把跨片段的连续结果相邻排列；汇总节点的 id 代表整组内容，不得拆掉其中的结果。不要为了连贯而补造机制或数据。不要添加模板式证据边界与局限性。返回 JSON：{"title":"真实文章标题","subtitle":"可核对的文章信息","overview":"全文科学问题—研究设计—主要发现—结论","orderedSectionIds":["所有小节或汇总节点 id"],"limitations":[]}。\n本层允许排序的 id：${JSON.stringify(ids)}。\n不可信的分段解析材料：\n${serialized}`,
    }));
  };
  const source = results.map(part => ({
    title: part.title, subtitle: part.subtitle, overview: part.overview,
    sections: part.sections.map(({ id, title, page, summary, proves }) => ({ id, title, page, summary, proves })),
    limitations: part.limitations,
  }));
  const sections = results.flatMap(part => part.sections);
  if (JSON.stringify(source).length <= LIMITS.synthesisCharacters && sections.length <= 300) {
    const synthesis = await summarize(source, sections.map(section => section.id));
    const ordered = orderedItems(sections, synthesis.orderedSectionIds);
    return { synthesis, sections: ordered.items, omitted: ordered.omitted };
  }
  // Flatten before grouping: one batch can itself contain more summary text
  // than a single synthesis request, so a batch boundary cannot be a size cap.
  let nodes = results.flatMap((part, index) => [
    { id: `overview-${index + 1}`, material: { id: `overview-${index + 1}`, title: part.title, subtitle: part.subtitle, overview: part.overview }, sections: [] },
    ...part.sections.map(section => ({ id: section.id, material: { id: section.id, title: section.title, page: section.page, summary: section.summary, proves: section.proves }, sections: [section] })),
  ]);
  let level = 0, omitted = false;
  while (JSON.stringify(nodes.map(node => node.material)).length > LIMITS.synthesisCharacters || nodes.length > 300) {
    checkCancelled();
    const groups = groupMaterials(nodes);
    const next = [];
    for (let index = 0; index < groups.length; index += 1) {
      await onProgress(94, `正在分层整合全文：第 ${level + 1} 层 ${index + 1}/${groups.length}`);
      const group = groups[index];
      const summary = await summarize(group.map(node => node.material), group.map(node => node.id), true);
      const ordered = orderedItems(group, summary.orderedSectionIds);
      omitted ||= ordered.omitted;
      const id = `summary-${level + 1}-${index + 1}`;
      next.push({ id, material: { id, title: summary.title, subtitle: summary.subtitle, overview: summary.overview }, sections: ordered.items.flatMap(node => node.sections) });
    }
    nodes = next; level += 1;
  }
  const synthesis = await summarize(nodes.map(node => node.material), nodes.map(node => node.id));
  const ordered = orderedItems(nodes, synthesis.orderedSectionIds);
  return { synthesis, sections: ordered.items.flatMap(node => node.sections), omitted: omitted || ordered.omitted };
}
