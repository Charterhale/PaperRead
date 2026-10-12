import type { Settings } from '../types';
export function migrateSettings(saved: Partial<Settings> = {}): Settings {
  const provider = saved.provider === 'deepseek' ? 'deepseek' : 'codex';
  const deepseekModel = saved.deepseekModel || (saved.model?.startsWith('deepseek-') ? saved.model : 'deepseek-flash');
  const codexModel=saved.codexModel||(saved.provider==='codex'&&saved.model?.startsWith('gpt-')?saved.model:'codex-auto');
  return { provider, codexModel, model: provider === 'codex' ? codexModel : deepseekModel, deepseekModel, reasoningEffort:saved.reasoningEffort||'medium', vision: saved.vision ?? true, apiKey: '' };
}
export function aiRequest(settings: Settings) {
  return { provider: settings.provider || 'codex', model: settings.model, ...(settings.provider==='codex'?{reasoningEffort:settings.reasoningEffort||'medium'}:{}), ...(settings.provider === 'deepseek' ? { apiKey: settings.apiKey } : {}) };
}
export function aiLabel(settings: Settings) { return settings.provider === 'deepseek' ? 'DeepSeek' : 'Codex'; }
export function supportsVision(settings: Settings) { return settings.provider !== 'deepseek' || settings.model === 'deepseek-flash'; }
