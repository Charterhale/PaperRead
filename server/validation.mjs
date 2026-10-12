export const LIMITS = Object.freeze({
  pages: 160,
  totalCharacters: 800_000,
  pageCharacters: 80_000,
  chunkCharacters: 40_000,
  images: 24,
  documentImages: 160,
  documentImageBytes: 640 * 1024 * 1024,
  batchImages: 6,
  batchImageBytes: 12 * 1024 * 1024,
  imageBytes: 4 * 1024 * 1024,
  totalImageBytes: 16 * 1024 * 1024,
  synthesisCharacters: 180_000,
  questionCharacters: 8_000,
  translationCharacters: 16_000,
});

export const CATEGORIES = ['基础医学', '生信分析', '纳米材料', '临床研究', '综述 / Meta'];
export const MODELS = ['deepseek-flash', 'deepseek-v4-pro'];

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function requiredString(value, name, maximum, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string') throw new ApiError(400, 'INVALID_INPUT', `${name}必须是文本。`);
  if (value.length > maximum) throw new ApiError(413, 'INPUT_TOO_LARGE', `${name}超过 ${maximum.toLocaleString('en-US')} 字符上限；没有截断或提交这部分内容。`);
  if (!optional && !value.trim()) throw new ApiError(400, 'INVALID_INPUT', `${name}不能为空。`);
  return value;
}

export function credentials(body, environmentKey) {
  const provider = body.provider ?? (body.model === 'codex-auto' ? 'codex' : 'deepseek');
  if (!['codex','deepseek'].includes(provider)) throw new ApiError(400, 'INVALID_PROVIDER', '请选择 Codex 或 DeepSeek。');
  if (provider === 'codex') {
    const model=body.model||'codex-auto',reasoningEffort=body.reasoningEffort||'medium';
    if(model!=='codex-auto'&&!/^gpt-[a-zA-Z0-9._-]{1,90}$/.test(model))throw new ApiError(400,'INVALID_MODEL','请选择本机 Codex 提供的 OpenAI 模型。');
    if(!['low','medium','high'].includes(reasoningEffort))throw new ApiError(400,'INVALID_REASONING_EFFORT','请选择低、中或高推理强度。');
    return { provider, model, reasoningEffort, apiKey: '' };
  }
  const model = body.model || 'deepseek-flash';
  if (!MODELS.includes(model)) throw new ApiError(400, 'INVALID_MODEL', '请选择 deepseek-flash 或 deepseek-v4-pro。');
  if (body.apiKey !== undefined && typeof body.apiKey !== 'string') throw new ApiError(400, 'INVALID_KEY', 'API Key 格式不正确。');
  const apiKey = (body.apiKey?.trim() || environmentKey || '').trim();
  if (!apiKey) throw new ApiError(401, 'API_KEY_REQUIRED', '请在设置中填写 DeepSeek API Key，或为本地服务设置 DEEPSEEK_API_KEY。');
  if (!/^[\x21-\x7e]{8,512}$/.test(apiKey)) throw new ApiError(400, 'INVALID_KEY', 'API Key 格式不正确，请检查是否包含空格或换行。');
  return { provider, model, apiKey };
}

export function validatePages(value) {
  if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, 'INVALID_PAGES', '请先上传 PDF 并提取页面文字。');
  if (value.length > LIMITS.pages) throw new ApiError(413, 'TOO_MANY_PAGES', `本文超过 ${LIMITS.pages} 页上限，请拆分 PDF；没有截断或提交内容。`);
  let total = 0;
  for (const page of value) {
    if (typeof page !== 'string') throw new ApiError(400, 'INVALID_PAGES', '每一页的内容必须是文本。');
    if (page.length > LIMITS.pageCharacters) throw new ApiError(413, 'PAGE_TOO_LARGE', `单页超过 ${LIMITS.pageCharacters.toLocaleString('en-US')} 字符，请检查 PDF 的文字层。`);
    total += page.length;
  }
  if (total > LIMITS.totalCharacters) throw new ApiError(413, 'PAPER_TOO_LARGE', `全文超过 ${LIMITS.totalCharacters.toLocaleString('en-US')} 字符上限，请拆分 PDF；没有截断或提交内容。`);
  return value;
}

export function validateImage(dataUrl) {
  if (typeof dataUrl !== 'string') throw new ApiError(400, 'INVALID_IMAGE', '页面图片必须是本地生成的图片数据。');
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) throw new ApiError(400, 'INVALID_IMAGE', '仅接受 PNG、JPEG、WebP 或 GIF 的 base64 页面图片，不接受外部图片地址。');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > LIMITS.imageBytes) throw new ApiError(413, 'IMAGE_TOO_LARGE', '单张页面图片超过 4 MiB，请降低渲染尺寸。');
  const valid = (
    (match[1] === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (match[1] === 'jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (match[1] === 'gif' && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) ||
    (match[1] === 'webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
  );
  if (!valid) throw new ApiError(400, 'INVALID_IMAGE', '页面图片的格式与内容不匹配。');
  return { dataUrl, bytes: bytes.length };
}

export function validateImages(value, pageCount, model, { document = false } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ApiError(400, 'INVALID_IMAGES', '图片列表格式不正确。');
  if (value.length > (document ? LIMITS.documentImages : LIMITS.images)) throw new ApiError(413, 'TOO_MANY_IMAGES', document ? `一篇文献最多接收 ${LIMITS.documentImages} 张页面图片。` : `单批上传最多接收 ${LIMITS.images} 张图片，请分批上传。`);
  if (value.length && !(model==='deepseek-flash'||model==='codex-auto'||model?.startsWith('gpt-'))) throw new ApiError(400, 'VISION_MODEL_REQUIRED', '页面看图解析需要 deepseek-flash，请切换模型或关闭页面图片解析。');
  let total = 0;
  const used = new Set();
  return value.map((item) => {
    if (!item || !Number.isInteger(item.page) || item.page < 1 || item.page > pageCount) throw new ApiError(400, 'INVALID_IMAGE_PAGE', '图片对应的 PDF 页码超出本文范围。');
    if (used.has(item.page)) throw new ApiError(400, 'DUPLICATE_IMAGE_PAGE', '同一页的图片请只提交一次。');
    used.add(item.page);
    const image = validateImage(item.dataUrl);
    total += image.bytes;
    if (total > (document ? LIMITS.documentImageBytes : LIMITS.totalImageBytes)) throw new ApiError(413, 'IMAGES_TOO_LARGE', document ? '本文图片总量超过 640 MiB，请降低渲染尺寸。' : '单批图片合计超过 16 MiB，请分批上传。');
    return { page: item.page, dataUrl: image.dataUrl };
  });
}

// Preserve every input character, including long individual pages. Page numbers
// always refer to physical PDF pages, not printed page numbers in the article.
export function chunkPages(pages, maxCharacters = LIMITS.chunkCharacters) {
  const chunks = [];
  let current = [];
  let count = 0;
  const flush = () => {
    if (current.length) chunks.push({ parts: current, pages: [...new Set(current.map(p => p.page))] });
    current = [];
    count = 0;
  };
  pages.forEach((text, index) => {
    const parts = Math.max(1, Math.ceil(text.length / maxCharacters));
    for (let part = 0; part < parts; part += 1) {
      const value = text.substring(part * maxCharacters, (part + 1) * maxCharacters);
      if (count + value.length > maxCharacters) flush();
      current.push({ page: index + 1, part: part + 1, totalParts: parts, text: value });
      count += value.length;
    }
  });
  flush();
  return chunks;
}

function outputText(value, name, maximum = 16_000, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > maximum) {
    throw new ApiError(502, 'INVALID_AI_SCHEMA', `阅读助手返回的${name}不符合文档结构，请重新尝试。`);
  }
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function outputList(value, name, maximum) {
  if (!Array.isArray(value) || value.length > maximum) throw new ApiError(502, 'INVALID_AI_SCHEMA', `阅读助手返回的${name}列表不符合文档结构，请重新尝试。`);
  return value;
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(502, 'INVALID_AI_SCHEMA', '阅读助手返回了无效的文档结构，请重新尝试。');
  return value;
}

function outputPage(page, pageCount, warnings, subject) {
  if (Number.isInteger(page) && page >= 1 && page <= pageCount) return page;
  const fallback = Number.isFinite(page) ? Math.max(1, Math.min(pageCount, Math.round(page))) : 1;
  warnings.push(`${subject}的原始页码未被可靠识别，暂定位到第 ${fallback} 页，请在 PDF 中核对。`);
  return fallback;
}

// Models sometimes return Markdown paragraphs as arrays or named fields. Keep
// their content intact instead of rejecting an otherwise readable subfigure.
function panelText(value, name, maximum, optional = false) {
  let nodes = 0;
  function render(item, depth = 0) {
    if (++nodes > 500 || depth > 8) throw new ApiError(502, 'INVALID_AI_SCHEMA', `阅读助手返回的${name}结构过于复杂，请重新尝试。`);
    if (item === undefined || item === null) return '';
    if (typeof item === 'string') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return String(item);
    if (typeof item === 'boolean') return String(item);
    if (Array.isArray(item)) return item.map(v => render(v, depth + 1)).filter(v => v.trim()).join('\n\n');
    if (typeof item === 'object') {
      const entries = Object.entries(item);
      if (entries.some(([key]) => /^(?:__proto__|prototype|constructor|api.?key|authorization|password|secret|credential|access.?token|refresh.?token)$/i.test(key))) throw new ApiError(502, 'INVALID_AI_SCHEMA', `阅读助手返回的${name}结构无法读取，请重新尝试。`);
      return entries.map(([key, v]) => { const text=render(v, depth + 1);return text.trim()?`**${key}**：${text}`:''; }).filter(Boolean).join('\n\n');
    }
    throw new ApiError(502, 'INVALID_AI_SCHEMA', `阅读助手返回的${name}不符合文档结构，请重新尝试。`);
  }
  return outputText(render(value), name, maximum, optional);
}

export function normalizePanel(raw) {
  try {
    object(raw);
    const field=(key,name,max,optional=false,value=raw[key])=>{
      try{return panelText(value,name,max,optional);}
      catch(error){error.panelField=key;throw error;}
    };
    const details=Object.fromEntries(['question', 'method', 'groups', 'readout', 'result', 'statistics', 'takeaway']
      .filter(key=>raw[key]!==undefined)
      .map(key=>[key,field(key,'子图详细解读',12_000,true)]));
    const explanation=field('explanation','子图解读',12_000,true,raw.explanation??raw.interpretation??raw.description);
    // Detailed fields already form a readable explanation; do not force a
    // second paragraph that repeats all of them or fabricate one for blanks.
    if (!explanation.trim() && !['question','method','groups','readout','result','takeaway'].some(key=>details[key]?.trim()&&!/^(未报告|未提供|无法辨认|不适用|未知|无|n\/a|none)$/i.test(details[key].trim()))) {
      const error=new ApiError(502,'INVALID_AI_SCHEMA','阅读助手未返回此子图的可读解读，已保存的其他批次可以继续使用。');error.panelField='explanation';throw error;
    }
    return {
      label:field('label','子图标识',200),
      type:field('type','图形类型',2_000),
      xAxis:field('xAxis','横轴说明',2_000,true,raw.xAxis??raw.x_axis??'未提供'),
      yAxis:field('yAxis','纵轴说明',2_000,true,raw.yAxis??raw.y_axis??'未提供'),
      explanation,evidence:field('evidence','补充说明',6_000,true),...details,
    };
  } catch(error) { if(error.code==='INVALID_AI_SCHEMA')error.panelFormat=true;throw error; }
}

export function normalizeFigure(raw, pageCount, warnings = [], id = 'figure-1') {
  object(raw);
  return {
    id,
    title: outputText(raw.title, '图片标题', 1_000),
    page: outputPage(raw.page, pageCount, warnings, raw.title),
    caption: outputText(raw.caption ?? '', '图注', 16_000, true),
    panels: outputList(raw.panels, '子图', 100).map(normalizePanel),
  };
}

export function normalizeEvidenceTable(raw, pageCount, prefix = '') {
  return outputList(raw ?? [], '专用信息表', 120).map((row, index) => {
    object(row);
    return {
      id: `${prefix}evidence-${index + 1}`,
      label: outputText(row.label, '信息表字段名', 500),
      value: outputText(row.value, '信息表内容', 12_000, true),
      ...(Number.isInteger(row.page) && row.page >= 1 && row.page <= pageCount ? { page: row.page } : {}),
    };
  });
}

export function validateCrop(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_CROP', '子图框选区域格式不正确。');
  const region = value.region;
  if (!region || !['x', 'y', 'width', 'height'].every(key => typeof region[key] === 'number' && Number.isFinite(region[key])) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1.00001 || region.y + region.height > 1.00001) {
    throw new ApiError(400, 'INVALID_CROP', '子图区域应为页面范围内的相对坐标。');
  }
  return { region: { x: region.x, y: region.y, width: region.width, height: region.height }, label: requiredString(value.label, '子图名称', 200, { optional: true }) };
}

export function normalizeAnalysis(raw, pageCount, category, prefix = '') {
  object(raw);
  const warnings = [];
  const sections = outputList(raw.sections, '章节', 60).map((section, index) => {
    object(section);
    const id = `${prefix}section-${index + 1}`;
    return {
      id,
      title: outputText(section.title, '章节标题', 1_000),
      shortTitle: outputText(section.shortTitle || section.title, '导航标题', 1_000),
      page: outputPage(section.page, pageCount, warnings, section.title),
      summary: outputText(section.summary, '章节概括', 10_000),
      proves: outputText(section.proves, '证据总结', 10_000),
      markdown: outputText(section.markdown, '章节正文', 40_000),
      figures: outputList(section.figures, '图片', 80).map((figure, figureIndex) => normalizeFigure(figure, pageCount, warnings, `${id}-figure-${figureIndex + 1}`)),
    };
  });
  if (!sections.length) throw new ApiError(502, 'EMPTY_ANALYSIS', '阅读助手未返回可阅读的章节，请检查 PDF 文字层后重试。');
  return {
    title: outputText(raw.title, '文章标题', 2_000),
    subtitle: outputText(raw.subtitle ?? '', '文章信息', 4_000, true),
    category,
    overview: outputText(raw.overview, '全文概括', 20_000),
    sections,
    limitations: [...outputList(raw.limitations ?? [], '待核对信息', 100).map(item => outputText(item, '待核对信息', 6_000)), ...warnings],
    evidenceTable: normalizeEvidenceTable(raw.evidenceTable, pageCount, prefix),
  };
}

export function normalizeSynthesis(raw) {
  object(raw);
  return {
    title: outputText(raw.title, '文章标题', 2_000),
    subtitle: outputText(raw.subtitle ?? '', '文章信息', 4_000, true),
    overview: outputText(raw.overview, '全文概括', 20_000),
    orderedSectionIds: outputList(raw.orderedSectionIds, '章节顺序', 20_000).map(value => outputText(value, '章节标识', 200)),
    limitations: outputList(raw.limitations ?? [], '待核对信息', 100).map(value => outputText(value, '待核对信息', 6_000)),
  };
}

export function normalizeTranslation(raw) {
  object(raw);
  return {
    translation: outputText(raw.translation, '译文', 40_000),
    terms: outputList(raw.terms, '术语', 80).map(value => outputText(value, '术语', 2_000)),
    explanation: outputText(raw.explanation, '语境解释', 20_000),
  };
}

export function normalizeAnswer(raw) {
  object(raw);
  return { answer: outputText(raw.answer, '回答', 60_000) };
}
