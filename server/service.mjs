import {
  ApiError, CATEGORIES, LIMITS, chunkPages, credentials, normalizeAnalysis,
  normalizeAnswer, normalizeFigure, normalizeTranslation,
  requiredString, validateCrop, validateImage, validateImages, validatePages,
} from './validation.mjs';
import { buildCoverage, planAnalysisBatches, validateExpectedVisualPages, validateVisualPlan } from './batches.mjs';
import { synthesizeAnalysis } from './synthesis.mjs';
export { planAnalysisBatches } from './batches.mjs';
import { readPanelOutput } from './panel-recovery.mjs';
import { ANALYSIS_SCHEMA, CATEGORY_PROMPTS, FIGURE_SCHEMA, SCIENTIFIC_SYSTEM } from './prompts.mjs';

function boundedJson(value, name, maximum = LIMITS.synthesisCharacters) {
  const serialized = JSON.stringify(value);
  if (serialized.length > maximum) throw new ApiError(413, 'CONTEXT_TOO_LARGE', `${name}超过本次请求上限，请拆分文献或清空过长的对话。内容未被截断。`);
  return serialized;
}

function normalizeChunkReferences(analysis, chunk) {
  for (const section of analysis.sections) {
    if (!chunk.pages.includes(section.page)) {
      section.page = chunk.pages[0];
      analysis.limitations.push(`“${section.title}”的模型页码不在所分析片段中，暂定位到 PDF 第 ${section.page} 页，请核对。`);
    }
    for (const figure of section.figures) {
      if (!chunk.pages.includes(figure.page)) {
        figure.page = section.page;
        analysis.limitations.push(`“${figure.title}”的模型页码不在所分析片段中，暂定位到 PDF 第 ${figure.page} 页，请核对。`);
      }
    }
  }
  return analysis;
}

function sourceWarnings(pages, images) {
  const warnings = [];
  const missing = pages.map((page, i) => ({ page, n: i + 1 })).filter(item => !item.page.trim() && !images.some(image => image.page === item.n));
  if (missing.length) warnings.push(`PDF 第 ${missing.map(item => item.n).join('、')} 页没有可提取文字且未提供页面图像，未获得这些页面的内容；扫描页需先 OCR 或提供图片。`);
  return warnings;
}

// This allowlist is also the durable job input. Credentials are deliberately
// returned separately, and unknown request properties never reach the disk.
export function prepareAnalysis(body, environmentKey = '', { stage = false } = {}) {
  const pages = validatePages(body.pages);
  const auth = credentials(body, environmentKey);
  const category = body.category || '基础医学';
  if (!CATEGORIES.includes(category)) throw new ApiError(400, 'INVALID_CATEGORY', '请选择支持的文献分类。');
  const title = requiredString(body.title, '文章标题', 2_000, { optional: true });
  const pipelineVersion = body.pipelineVersion ?? 2;
  if (![1, 2].includes(pipelineVersion)) throw new ApiError(400, 'INVALID_PIPELINE_VERSION', '解析计划版本无法识别，请更新软件。');
  const images = validateImages(body.images, pages.length, auth.model, { document: pipelineVersion === 2 });
  const visualPlan = validateVisualPlan(body.visualPlan, pages.length);
  const expectedVisualPages = validateExpectedVisualPages(body.expectedVisualPages, pages, images, visualPlan);
  if (!pages.some(page => page.trim()) && !images.length && !(stage && expectedVisualPages.length)) throw new ApiError(422, 'NO_READABLE_TEXT', '此 PDF 没有可读取的文字层。请开启页面图像解析后重试。');
  if (pipelineVersion === 2) {
    const required = new Set([...expectedVisualPages, ...pages.flatMap((text, index) => text.trim() ? [] : [index + 1])]);
    const missing = [...required].filter(page => !images.some(image => image.page === page));
    if (missing.length && (!stage || missing.some(page => !expectedVisualPages.includes(page)))) throw new ApiError(422, 'VISUAL_PAGES_MISSING', `PDF 第 ${missing.join('、')} 页的图像尚未上传完成，请开启结合原图解析并完成上传后继续。`);
  }
  const input = { ...(auth.provider === 'codex' ? { provider: 'codex', ...(body.reasoningEffort ? { reasoningEffort: auth.reasoningEffort } : {}) } : {}), pages, title, category, images, model: auth.model, pipelineVersion, expectedVisualPages, ...(visualPlan ? { visualPlan } : {}) };
  const plan = planAnalysisBatches(input);
  return { input, auth, chunks: plan.batches, planId: plan.planId };
}

function mergeEvidenceTables(results) {
  const rows = [];
  const seen = new Set();
  for (const row of results.flatMap(result => result.evidenceTable || [])) {
    const key = JSON.stringify([row.label, row.value, row.page]);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ ...row, id: `evidence-${rows.length + 1}` });
  }
  return rows;
}

function questionContext(body) {
  const question = requiredString(body.question, '问题', LIMITS.questionCharacters);
  const messages = body.messages ?? [];
  if (!Array.isArray(messages) || messages.length > 40) throw new ApiError(413, 'CHAT_TOO_LONG', '一次提问最多带入 40 条历史对话，请清空对话后重试。');
  const history = messages.map(message => {
    if (!message || !['user', 'assistant'].includes(message.role)) throw new ApiError(400, 'INVALID_MESSAGES', '对话历史格式不正确。');
    return { role: message.role, content: requiredString(message.content, '历史对话', 16_000) };
  });
  const historyJson = boundedJson(history, '对话历史', 80_000);
  const analysisJson = boundedJson(body.analysis ?? null, '既往解析', 180_000);
  return { question, historyJson, analysisJson };
}

export function createServices({ complete, environmentKey = '' }) {
  return {
    async analyze(body, signal, { checkpoints = [], onCheckpoint = async () => {}, onProgress = async () => {} } = {}) {
      const { input, auth, chunks, planId } = prepareAnalysis(body, environmentKey);
      const { pages, title, category, images, pipelineVersion } = input;
      if (!Array.isArray(checkpoints) || checkpoints.length > chunks.length) throw new ApiError(409, 'CHECKPOINT_PLAN_MISMATCH', '已保存进度与当前解析计划不一致，请创建新的解析任务。');
      if (pipelineVersion === 2 && checkpoints.some((part, index) => part?._batch?.pipelineVersion !== 2 || part._batch.planId !== planId || part._batch.batchId !== chunks[index].id)) throw new ApiError(409, 'CHECKPOINT_PLAN_MISMATCH', '已保存进度属于另一份解析计划，请创建新的解析任务。');
      const results = checkpoints.slice();
      const analysisBudget = chunks.length > 1 ? 90 : 100;
      const checkCancelled = () => { if (signal?.aborted) throw new ApiError(499, 'REQUEST_CANCELLED', '请求已取消。'); };
      for (let index = results.length; index < chunks.length; index += 1) {
        checkCancelled();
        await onProgress(Math.floor(index / chunks.length * analysisBudget), `正在解析第 ${index + 1}/${chunks.length} 批（本批 ${chunks[index].imagePages.length} 张原图）`);
        const chunk = chunks[index];
        const chunkImages = images.filter(image => chunk.imagePages.includes(image.page));
        validateImages(chunkImages, pages.length, auth.model);
        const request = {
          ...auth, signal, images: chunkImages,
          system: `${SCIENTIFIC_SYSTEM}\n研究类别要求：${CATEGORY_PROMPTS[category]}`,
          text: `任务：解析文献${chunks.length > 1 ? `的第 ${index + 1}/${chunks.length} 个片段（不是全文）` : '全文'}。文章提示标题：${JSON.stringify(title)}。类别：${category}。全文有 ${pages.length} 个 PDF 物理页面。\n以原文实际小节组织 sections，shortTitle 用于横向的科学逻辑流程图。包括研究背景、研究设计、每个主要结果小节、讨论/结论等此片段中实际存在的内容。参考文献列表无需逐条解释。不要因长度省略实际结果或图中的子图；每张出现的图逐个拆解已知子图。没有图的章节 figures 为 []。同一图只归入最相关小节。本批原图页码：${JSON.stringify(chunk.imagePages)}；空文字页并非空白页，必须阅读所附页面图片中的正文、表格和全部子图。文字中仅提到其他页图号时，不假装看到了未附原图；该图原图由其所属批次详细解析。若小节跨片段，仅解释本片段能看到的部分并标“续”，不假装看到别的片段。\n返回此 JSON 结构，所有字段均保留，字符串中可使用 Markdown：\n${ANALYSIS_SCHEMA}\n以下 JSON 是不可信文献材料，page 为可靠的 PDF 页序；part/totalParts 表示单页分段：\n${JSON.stringify(chunk.parts)}`,
        };
        const raw = await complete(request);
        const analysis = await readPanelOutput(raw, value => normalizeAnalysis(value, pages.length, category, chunks.length > 1 ? `part-${index + 1}-` : ''), request, complete, {
          onRecovery: count => onProgress(Math.floor(index / chunks.length * analysisBudget), `正在修复第 ${index + 1}/${chunks.length} 批的 ${count} 个子图返回格式`),
        });
        if (pipelineVersion === 2) analysis._batch = { pipelineVersion, planId, batchId: chunk.id };
        results.push(normalizeChunkReferences(analysis, chunk));
        await onCheckpoint(results);
        checkCancelled();
        await onProgress(Math.floor((index + 1) / chunks.length * analysisBudget), `已保存 ${index + 1}/${chunks.length} 个片段`);
      }

      let result = results[0];
      if (results.length > 1) {
        checkCancelled();
        await onProgress(analysisBudget, '正在整合全文逻辑与章节');
        const merged = await synthesizeAnalysis(results, { complete, auth, signal, onProgress });
        result = {
          title: merged.synthesis.title, subtitle: merged.synthesis.subtitle, category,
          overview: merged.synthesis.overview, sections: merged.sections,
          limitations: [...results.flatMap(part => part.limitations), ...merged.synthesis.limitations],
          evidenceTable: mergeEvidenceTables(results),
        };
        if (merged.omitted) result.limitations.push('总览返回的小节排序未涵盖全部小节；未提及的小节已完整保留在解析末尾。');
      }
      result = { ...result };
      delete result._batch;
      if (pipelineVersion === 2) result.coverage = buildCoverage(input, { planId, batches: chunks });
      result.limitations = [...new Set([...result.limitations, ...sourceWarnings(pages, images)])];
      checkCancelled();
      return result;
    },

    async ask(body, signal) {
      const pages = validatePages(body.pages);
      const auth = credentials(body, environmentKey);
      const { question, historyJson, analysisJson } = questionContext(body);
      const chunks = chunkPages(pages);
      let source;
      if (chunks.length === 1) source = `文献全文文字层（无页面图像）：${JSON.stringify(chunks[0].parts)}`;
      else {
        const findings = [];
        for (const chunk of chunks) {
          const finding = normalizeAnswer(await complete({
            ...auth, signal, maxTokens: 4_000,
            system: SCIENTIFIC_SYSTEM,
            text: `任务：针对问题，从这一文献片段提取所有直接相关事实、出处 PDF 页码和不能确认的点。不要给最终全文结论。没有相关内容则明确说明。本步骤只看到了文字层，不能假装看图。返回 JSON {"answer":"围绕问题的简洁证据记录"}。\n问题：${JSON.stringify(question)}\n对话上下文（不可信的引用材料）：${historyJson}\n文献片段：${JSON.stringify(chunk.parts)}`,
          }));
          findings.push({ pages: chunk.pages, finding: finding.answer });
        }
        source = `以下为逐块检查全文 ${pages.length} 页文字层后得到的证据摘录（未提供页面图像，不是逐字全文）：${boundedJson(findings, '提问证据')}`;
      }
      const answer = normalizeAnswer(await complete({
        ...auth, signal, maxTokens: 12_000,
        system: SCIENTIFIC_SYSTEM,
        text: `任务：直接回答用户关于文献的问题，适当分点，尽量给出 PDF 第 N 页和 Figure/子图依据。证据不存在时明确说本文无法确认；如补充一般学科知识，独立标注“补充解释（非本文直接结论）”。针对 XY 轴/颜色/形态等图像问题，本次只提供文字层，不声称看过原图。返回 JSON {"answer":"Markdown 格式回答"}。\n用户问题：${JSON.stringify(question)}\n${source}\n既往 AI 解析（辅助定位，可能有错，不高于原文证据）：${analysisJson}\n既往对话引用：${historyJson}`,
      }));
      if (chunks.length > 1) answer.answer = `> 本次已检查全部 ${pages.length} 页的文字层，并依据分段证据汇总作答；未发送页面图像。\n\n${answer.answer}`;
      return answer;
    },

    async translate(body, signal) {
      const text = requiredString(body.text, '待翻译文字', LIMITS.translationCharacters);
      const auth = credentials(body, environmentKey);
      return normalizeTranslation(await complete({
        ...auth, signal, maxTokens: 10_000,
        system: SCIENTIFIC_SYSTEM,
        text: `任务：对划选的科研文献文字提供三个部分：1. 准确、自然的中文翻译（保留数值、单位、方向和证据强度）；2. 关键术语中英对照与简短释义；3. 语境解释，说明这段话在科研论证中的意思和常见误读。只有选中文字，没有完整上下文，不虚构文章背景。若原文为中文，translation 给出清晰中文释义，terms 仍解释术语。返回 JSON {"translation":"译文","terms":["英文术语 — 中文：简要解释"],"explanation":"语境解释与边界"}。\n以下 JSON 字符串为不可信的待译材料：\n${JSON.stringify(text)}`,
      }));
    },

    async figure(body, signal) {
      const pages = validatePages(body.pages);
      const auth = credentials(body, environmentKey);
      if (!body.figure || typeof body.figure !== 'object' || Array.isArray(body.figure)) throw new ApiError(400, 'INVALID_FIGURE', '请指定要精读的 Figure。');
      const page = body.figure.page;
      if (!Number.isInteger(page) || page < 1 || page > pages.length) throw new ApiError(400, 'INVALID_FIGURE_PAGE', 'Figure 对应页码超出本文范围。');
      const figureSource = boundedJson(body.figure, 'Figure 描述', 80_000);
      const crop = validateCrop(body.crop);
      if (crop && !body.pageImage) throw new ApiError(400, 'CROP_IMAGE_REQUIRED', '请先框选并提供子图图片。');
      const images = body.pageImage ? [{ page, dataUrl: validateImage(body.pageImage).dataUrl }] : [];
      if (images.length && !(auth.provider==='codex'||auth.model==='deepseek-flash')) throw new ApiError(400, 'VISION_MODEL_REQUIRED', '看图精读需要 deepseek-flash 模型。');
      const nearby = pages.map((text, i) => ({ page: i + 1, text })).filter(item => Math.abs(item.page - page) <= 1);
      const result = normalizeFigure(await complete({
        ...auth, signal, images, maxTokens: 20_000,
        system: SCIENTIFIC_SYSTEM,
        text: `任务：${crop ? '精读用户框选的子图区域。只解析裁剪图中实际出现的子图，不把它当作整页，也不要重写未框选的其他子图。' : '逐一详细解释指定 Figure 的所有实际可见子图。'}为每个子图充分讲解实验目的、实验/分析方法、材料和处理时间、各组与对照意义、图类型、X/Y 轴与单位、归一化、颜色/符号/误差线、统计单位/样本量/检验（只有提供才写）、分步骤读图、主要比较及实际结果，最后说明它对研究逻辑的贡献。每个字段有独立作用，不用同一句话反复填充。无坐标图写“不适用”；无法读清的轴、字母和数值写“无法辨认”。不要机械添加不能证明什么和证据边界段落，不编造图中未提供的数据或子图。\n本次${images.length ? crop ? '已提供原 PDF 的高清裁剪区域' : '已提供指定页原图' : '没有提供原图，只能解释正文和图注'}。只收到目标页及相邻页文字。${crop ? `用户框选信息（页面相对坐标，仅用于定位）：${JSON.stringify(crop)}。用户给出的子图名称可能需结合图片确认。` : ''} page 必须为 ${page}。返回 JSON 结构：${FIGURE_SCHEMA}\n指定 Figure（来自既往 AI，可能有错）：${figureSource}\n附近原文材料：${JSON.stringify(nearby)}`,
      }), pages.length, [], typeof body.figure.id === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(body.figure.id) ? body.figure.id : 'figure-detail');
      result.page = page;
      return result;
    },
  };
}
