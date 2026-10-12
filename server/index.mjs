import express from 'express';
import { createBackupStore } from './backups.mjs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCodexClient } from './codex.mjs';
import { createDeepSeekClient } from './deepseek.mjs';
import { createServices } from './service.mjs';
import { createJobManager } from './jobs.mjs';
import { ApiError, CATEGORIES, LIMITS, MODELS } from './validation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const DEVELOPMENT_PORTS = new Set(['5173', '5174', '5175', '5176', '5177', '5178', '5179', '5180']);

function localRequestGuard(production) {
  return (req, res, next) => {
    let host;
    try { host = new URL(`http://${req.headers.host}`); } catch { return next(new ApiError(403, 'LOCAL_ACCESS_ONLY', '本地阅读服务只接受本机访问。')); }
    if (!LOOPBACK_HOSTS.has(host.hostname) || host.username || host.password || host.pathname !== '/') return next(new ApiError(403, 'LOCAL_ACCESS_ONLY', '本地阅读服务只接受 localhost 或 127.0.0.1 访问。'));
    const origin = req.headers.origin;
    if (origin) {
      let parsed;
      try { parsed = new URL(origin); } catch { return next(new ApiError(403, 'ORIGIN_NOT_ALLOWED', '此网页来源无权访问本地文献服务。')); }
      const samePort = parsed.port === host.port;
      const devPort = !production && DEVELOPMENT_PORTS.has(parsed.port);
      if (!['http:', 'https:'].includes(parsed.protocol) || !LOOPBACK_HOSTS.has(parsed.hostname) || parsed.username || parsed.password || parsed.pathname !== '/' || (!samePort && !devPort)) {
        return next(new ApiError(403, 'ORIGIN_NOT_ALLOWED', '此网页来源无权访问本地文献服务。'));
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

export function createApp({
  fetchImpl = globalThis.fetch,
  codexOptions = {},
  apiKey = process.env.DEEPSEEK_API_KEY || '',
  timeoutMs = 150_000,
  totalTimeoutMs = 15 * 60_000,
  production = false,
  staticDir = path.join(ROOT, 'dist'),
  requestBodyLimit = '25mb',
  jobArchiveBodyLimit = '250mb',
  maxConcurrentRequests = 3,
  jobDir = path.join(ROOT, '.paperlens-jobs'),
  maxConcurrentJobs = 1,
  backupDir = path.join(ROOT, '.paperlens-backups'),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (production) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    next();
  });
  app.use(localRequestGuard(production));
  const backups=createBackupStore(backupDir);
  app.get('/api/backups',async(req,res)=>res.json({items:await backups.list(),directory:backups.directory}));
  app.get('/api/backups/:id',async(req,res)=>{res.type('application/gzip').send(await backups.read(req.params.id));});
  app.post('/api/backups',express.raw({type:'application/gzip',limit:'1gb'}),async(req,res)=>{res.status(201).json(await backups.save(req.body,Number(req.query.keep||7)));});
  app.use('/api', (req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) return next(new ApiError(415, 'JSON_REQUIRED', '接口只接受 JSON 请求。'));
    next();
  });
  app.post('/api/jobs/restore', express.json({ limit: jobArchiveBodyLimit, strict: true }));
  app.use('/api', express.json({ limit: requestBodyLimit, strict: true }));
  app.use('/api', (req, res, next) => {
    if (req.method === 'POST' && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return next(new ApiError(400, 'INVALID_INPUT', '请求内容必须是 JSON 对象。'));
    next();
  });
  const deepseekComplete = createDeepSeekClient({ fetchImpl, timeoutMs });
  const codex = createCodexClient(codexOptions);
  const complete = request => request.provider === 'codex' ? codex.complete(request) : deepseekComplete(request);
  app.get('/api/codex/models', async(req,res,next)=>{try{res.json(await codex.models());}catch(error){next(error);}});
  app.get('/api/codex/status', async (req,res) => res.json(await codex.status()));
  app.post('/api/codex/check', async (req,res,next) => { try { const result = await codex.complete({ system:'只返回 JSON。', text:'这是连接测试，不含论文。返回 {"ok":true}。' }); res.json({ok:result.ok === true}); } catch(error) { next(error); } });
  const services = createServices({ complete, environmentKey: apiKey });
  const jobs = createJobManager({ directory: jobDir, services, environmentKey: apiKey, concurrency: maxConcurrentJobs });
  app.locals.jobs = jobs;
  let activeRequests = 0;

  app.get('/api/health', (req, res) => res.json({
    ok: true,
    service: 'PaperRead',
    hasApiKey: Boolean(apiKey.trim()),
    defaultProvider: 'codex',
    providers: ['codex','deepseek'],
    defaultModel: 'codex-auto',
    models: ['codex-auto',...MODELS],
    categories: CATEGORIES,
    limits: LIMITS,
    privacy: 'PDF 原件保存在本机。使用 AI 功能时，所需文字和所选图片发送至你手动选择的 Codex 或 DeepSeek；Codex 使用本机订阅登录；API Key 不写入本地服务日志或文件。',
  }));

  function endpoint(service) {
    return async (req, res, next) => {
      if (activeRequests >= maxConcurrentRequests) return next(new ApiError(429, 'TOO_MANY_REQUESTS', '正在处理其他解析请求，请等候完成后重试。'));
      activeRequests += 1;
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, totalTimeoutMs);
      timeout.unref?.();
      const cancel = () => { if (!res.writableEnded) controller.abort(); };
      req.once('aborted', cancel);
      res.once('close', cancel);
      try {
        const result = await service(req.body, controller.signal);
        if (timedOut) throw new ApiError(504, 'REQUEST_TIMEOUT', '全文处理超过 15 分钟，已停止后续请求。请拆分 PDF 后重试。');
        if (!res.destroyed) res.json(result);
      } catch (error) {
        if (!res.destroyed) next(timedOut ? new ApiError(504, 'REQUEST_TIMEOUT', '全文处理超时，已停止后续请求。请拆分 PDF 后重试。') : error);
      } finally {
        clearTimeout(timeout);
        req.removeListener('aborted', cancel);
        res.removeListener('close', cancel);
        activeRequests -= 1;
      }
    };
  }

  for (const name of ['analyze', 'ask', 'translate', 'figure']) app.post(`/api/${name}`, endpoint(services[name]));
  // Job creation returns immediately. Its lifetime belongs to the local app,
  // not to the HTTP connection or the currently selected paper.
  app.post('/api/jobs', async (req, res) => res.status(202).json(await jobs.create(req.body)));
  app.post('/api/jobs/stage', async (req, res) => res.status(202).json(await jobs.create(req.body, { stage: true })));
  app.post('/api/jobs/:id/images', async (req, res) => res.json(await jobs.upload(req.params.id, req.body)));
  app.post('/api/jobs/:id/start', async (req, res) => res.status(202).json(await jobs.start(req.params.id, req.body)));
  app.get('/api/jobs', async (req, res) => res.json({ jobs: await jobs.list() }));
  app.get('/api/jobs/archive', async (req, res) => res.json(await jobs.archive()));
  app.post('/api/jobs/restore', async (req, res) => res.json(await jobs.restore(req.body)));
  app.get('/api/jobs/:id', async (req, res) => res.json(await jobs.get(req.params.id)));
  app.post('/api/jobs/:id/cancel', async (req, res) => res.json(await jobs.cancel(req.params.id)));
  app.post('/api/jobs/:id/retry', async (req, res) => res.status(202).json(await jobs.retry(req.params.id, req.body)));
  app.delete('/api/jobs/:id', async (req, res) => res.json(await jobs.remove(req.params.id)));
  app.use('/api', (req, res, next) => next(new ApiError(404, 'NOT_FOUND', '接口不存在。')));

  if (production) {
    app.use(express.static(staticDir, { index: false, dotfiles: 'deny' }));
    app.get('/{*path}', (req, res, next) => {
      const indexFile = path.join(staticDir, 'index.html');
      if (!existsSync(indexFile)) return next(new ApiError(503, 'FRONTEND_NOT_BUILT', '尚未生成界面，请先运行构建步骤。'));
      // Treat dist as the serving root so an enclosing .codex directory is not
      // mistaken for a requested hidden file. Dotfiles inside dist stay denied.
      res.sendFile('index.html', { root: staticDir, dotfiles: 'deny' });
    });
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: req.path === '/api/jobs/restore' ? '后台任务备份超过本次恢复大小上限，请减少任务数量后重新备份。未提交内容至 DeepSeek。' : '请求内容超过 25 MiB，请减少页面图片尺寸或拆分文献。没有提交内容至 DeepSeek。', code: 'BODY_TOO_LARGE' });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: '无法读取请求中的 JSON 内容。', code: 'INVALID_JSON' });
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message, code: error.code });
    // Do not log req.body, authorization, API responses, or error causes.
    res.status(500).json({ error: '本地文献服务暂时无法完成请求，请重新尝试。', code: 'INTERNAL_ERROR' });
  });
  return app;
}

export async function startServer({ port = Number(process.env.PORT || 5179), host = '127.0.0.1', ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535.');
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('PaperRead only binds to the loopback interface.');
  const app = createApp(options);
  return await new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.jobs = app.locals.jobs;
    server.once('close', () => { void server.jobs.close(); });
    server.requestTimeout = 120_000;
    server.headersTimeout = 30_000;
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const server = await startServer({ production: process.argv.includes('--production') || process.env.NODE_ENV === 'production' });
    console.log(`PaperRead 本地服务：http://127.0.0.1:${server.address().port}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.jobs.close(); server.close(); server.closeAllConnections?.(); });
  } catch {
    console.error('PaperRead 服务未能启动。请检查端口是否被占用，以及 PORT 配置。');
    process.exitCode = 1;
  }
}
