# PaperRead 本地解析服务

此目录提供 Express 后端；原始 PDF 的保存与文字/页面图片提取由客户端完成。后台任务会将文献文字、所选图片、已完成片段和最终解析保存在本机任务目录，以支持重启恢复。API Key 仅在内存中使用，不写入任务文件；日志不输出密钥、文献内容或上游响应。

## 启动与嵌入

- 开发：项目根目录运行 `npm run dev`，API 默认监听 `127.0.0.1:5179`。
- 构建后运行：`npm run build`，然后 `npm start`；界面与接口由同一本地服务提供。
- 端口可使用 `PORT` 环境变量配置。只允许绑定回环地址。
- 可在进程环境中提供 `DEEPSEEK_API_KEY`。客户端传来的非空 Key 优先，不在服务器保存。
- `createApp(options)` 返回 Express 应用。`jobDir` 默认为项目 `.paperlens-jobs`；Electron 应传入用户数据目录中的 `jobs`。后台任务默认同时处理 1 篇，可通过 `maxConcurrentJobs` 调整（最多 3）。
- `await startServer({ port: 0, production: true })` 返回已经监听的 `http.Server`，可供 Electron 获取临时端口并在退出时关闭；关闭前可 `await server.jobs.close()` 保存暂停状态和检查点。

## 接口

所有 POST 请求为 JSON，成功时直接返回所列对象，失败时返回 `{ error, code }`。页码始终为 PDF 物理页序，从 1 开始。

| 接口 | 输入 | 输出 |
| --- | --- | --- |
| `GET /api/health` | — | `ok, hasApiKey, models, defaultModel, categories, limits, privacy` |
| `POST /api/analyze` | `pages: string[], category, title?, apiKey?, model?, images?: {page, dataUrl}[]` | `Analysis`，与 `src/types.ts` 一致 |
| `POST /api/ask` | `pages, analysis?, question, messages?: {role, content}[], apiKey?, model?` | `{answer: string}` |
| `POST /api/translate` | `text, apiKey?, model?` | `{translation: string, terms: string[], explanation: string}` |
| `POST /api/figure` | `pages, figure, pageImage?: dataUrl, crop?: {region: {x,y,width,height}, label?}, apiKey?, model?` | `Figure`，保留输入 Figure ID 与目标页 |

| `POST /api/jobs` | `paperId, title, pages, category, apiKey?, model?, images?` | `202 BackgroundJob` |
| `GET /api/jobs` | — | `{jobs: BackgroundJob[]}`，完成项包含 `result` |
| `GET /api/jobs/archive` | — | `{format:'paperlens-jobs', version:1, exportedAt, records:[{job,input,checkpoints}]}`，含输入和检查点，不含密钥 |
| `POST /api/jobs/restore` | `{archive, conflicts:'skip'|'replace'}` | `{restored,skipped,replaced}`，分别为新增、跳过、覆盖数 |
| `GET /api/jobs/:id` | — | `BackgroundJob` |
| `POST /api/jobs/:id/cancel` | `{}` | 取消后的 `BackgroundJob` |
| `POST /api/jobs/:id/retry` | `{apiKey?}` | `202 BackgroundJob`，跳过已经保存的片段 |
| `DELETE /api/jobs/:id` | — | `{ok: true}`；运行中先取消，再删除任务记录 |

`BackgroundJob` 包含 `id, paperId, title, status, progress, message, createdAt, updatedAt`，失败时有 `error`，完成时有 `result: Analysis`。状态为 queued/running/paused/completed/failed/cancelled。进度依据已完成的片段与最终整合步骤计算，100 表示最终文档已写入本机。相同文献不能同时有两条活动任务。重启时未完成任务变为 paused，用户提供密钥或使用环境密钥后继续；不会自动重复收费请求。每个片段结束后原子写入检查点。取消与重启只重用已完整保存的片段，正在生成但未返回的片段仍需重试。

任务归档包含全文输入、所选图片、已完成片段和结果，可以随完整文献库备份迁移。恢复会先验证整个归档；缺少必要内容、非法页码、非法图片或重复任务 ID 均拒绝整批导入。未知字段（包括凭据字段）按层剔除。所有未完成任务恢复为 paused，不自动提交请求；需要重新提供密钥后继续。重复任务按 conflicts 选择跳过或覆盖，但活动任务始终跳过。每份归档最多 200 条，恢复请求默认上限 250 MiB，可配置 `jobArchiveBodyLimit`。磁盘写入失败会尝试回滚本次恢复，若回滚失败会明确报错。

## 解析与证据范围

全文上限 160 页、800,000 字符、单页 80,000 字符。全文按最多 40,000 字符的片段顺序解析，每个字符均保留原来的 PDF 页序；单页过长时带有分段编号。长文最后整合总览与章节顺序。即使整合响应漏列章节，程序也保留所有已解析章节和 Figure。

图片上限 24 张，单张 4 MiB，合计 16 MiB；仅允许本地生成的 PNG、JPEG、WebP、GIF 数据，不接受远程图片地址。默认模型 `deepseek-flash` 接收图像；`deepseek-v4-pro` 仅用于文字。文字解析只依据正文与图注，空白文字页会记录实际覆盖缺口。正文不再为每幅图追加重复的“证据边界”段落或原文位置；定位使用结构化 page 字段。子图增加 question/method/groups/readout/result/statistics/takeaway 七个细节字段，旧版字段仍兼容。Analysis 的 evidenceTable 为五类文献分别提取关键字段，长文整合保留各片段的不同内容。

长文问答也逐块检查全文，然后整合与问题相关的证据。单图精读只提交目标页及前后一页文字和指定图片。提供 crop 时，region 使用页面相对坐标（0–1），pageImage 必须是实际裁剪图；提示明确仅解析框选区域，不声称它是整页。输入超限时拒绝请求，不静默截断。

模型输出使用 JSON 模式，并在本地验证字段结构、数量和长度；不完整或截断的模型输出不会成为已完成解析。越界的章节页码会限制到文档范围并写入显式提示。单次上游请求默认 150 秒超时，同步端点操作最多 15 分钟；后台任务不受浏览器请求断开或切换文献影响。任务取消会中止正在进行的上游调用，后续分段不再提交。已经发送的请求可能已产生 DeepSeek 费用，服务不自动重试。

## 测试与官方接口依据

`node --test tests/api.test.mjs tests/jobs.test.mjs` 使用模拟的上游响应，覆盖四个同步工作接口、后台队列完成/失败重试/取消/删除/重启恢复、检查点与密钥不落盘、子图裁剪与详细字段、长文覆盖、模型结构异常、越界页码、超时、取消、Key 隔离、跨站访问限制及生产静态服务，不需要真实 Key，也不产生 API 费用。真实文章的模型内容质量和实际账户计费不由这些模拟测试验证。

接口于 2026-10-12 对照 DeepSeek 官方文档确认：

- [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)：官方固定地址、JSON 输出、`deepseek-flash` / `deepseek-v4-pro` 模型名与思考模式开关。
- [图像理解](https://api-docs.deepseek.com/guides/vision/)：Flash 的图像输入与 `image_url` 内容块。
- [更新日志](https://api-docs.deepseek.com/updates/)：当前模型替代关系。
