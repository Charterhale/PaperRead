import { ApiError } from './validation.mjs';

export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

// Only the official endpoint is used. Keys exist in request memory only and
// upstream errors are deliberately not reflected to the browser or logged.
export function createDeepSeekClient({ fetchImpl = globalThis.fetch, timeoutMs = 150_000 } = {}) {
  return async function complete({ apiKey, model, system, text, images = [], signal, maxTokens = 24_000 }) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    timeout.unref?.();
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const content = images.length ? [
      { type: 'text', text },
      ...images.flatMap(image => [
        { type: 'text', text: `以下图片对应 PDF 物理页码第 ${image.page} 页。` },
        { type: 'image_url', image_url: { url: image.dataUrl, detail: 'high' } },
      ]),
    ] : text;
    try {
      if (controller.signal.aborted) throw new ApiError(499, 'REQUEST_CANCELLED', '请求已取消。');
      const response = await fetchImpl(DEEPSEEK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content }],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          max_tokens: maxTokens,
          stream: false,
        }),
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        // Reading or reflecting the upstream body could expose submitted text
        // or credentials. Return stable, actionable application errors instead.
        if (response.status === 401 || response.status === 403) throw new ApiError(401, 'DEEPSEEK_AUTH', 'DeepSeek 未接受此 API Key，请检查密钥与账户权限。');
        if (response.status === 402) throw new ApiError(402, 'DEEPSEEK_BALANCE', 'DeepSeek 账户余额不足，请在官方平台检查余额。');
        if (response.status === 429) throw new ApiError(429, 'DEEPSEEK_RATE_LIMIT', 'DeepSeek 当前请求过于频繁，请稍后重试。');
        if (response.status === 400 || response.status === 422) throw new ApiError(502, 'DEEPSEEK_REJECTED', 'DeepSeek 未接受这次请求，请检查模型设置、页面图片和文档大小。');
        throw new ApiError(502, 'DEEPSEEK_UNAVAILABLE', 'DeepSeek 服务暂时不可用，请稍后重试。');
      }
      let payload;
      try { payload = await response.json(); } catch { throw new ApiError(502, 'INVALID_AI_RESPONSE', 'DeepSeek 未返回有效响应，请稍后重试。'); }
      const choice = payload?.choices?.[0];
      if (choice?.finish_reason === 'length') throw new ApiError(502, 'AI_RESPONSE_TRUNCATED', '本次模型输出达到长度上限，结果尚不完整。请拆分文章或缩小提问范围后重试。');
      if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new ApiError(502, 'INCOMPLETE_AI_RESPONSE', 'DeepSeek 未完成本次解析，请重试。');
      const value = choice?.message?.content;
      if (typeof value !== 'string' || !value.trim()) throw new ApiError(502, 'EMPTY_AI_RESPONSE', 'DeepSeek 返回了空内容，请稍后重试。');
      if (value.length > 500_000) throw new ApiError(502, 'AI_RESPONSE_TOO_LARGE', 'DeepSeek 返回内容超过单次解析上限，请拆分文章后重试。');
      try {
        const parsed = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        return parsed;
      } catch { throw new ApiError(502, 'INVALID_AI_JSON', 'DeepSeek 返回的文档结构无法读取，请重试。未保存不完整结果。'); }
    } catch (error) {
      if (timedOut) throw new ApiError(504, 'DEEPSEEK_TIMEOUT', 'DeepSeek 响应超时。本次请求已取消，可稍后重试。');
      if (signal?.aborted || controller.signal.aborted) throw new ApiError(499, 'REQUEST_CANCELLED', '请求已取消。');
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, 'DEEPSEEK_NETWORK', '暂时无法连接 DeepSeek，请检查网络连接后重试。');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  };
}
