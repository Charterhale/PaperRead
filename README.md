# PaperRead

医学文献深度阅读工作台 · **0.9.9** · macOS Apple Silicon

左侧读 PDF，中间读解析和笔记，右侧目录联动定位。支持基础医学、生信分析、纳米材料、临床研究及综述 / Meta。

[下载 Mac 版](https://github.com/Charterhale/PaperRead/releases/tag/v0.9.9) · [查看源码](https://github.com/Charterhale/PaperRead)

## 阅读界面

以下截图使用内置虚构教学文献，不含个人文献、笔记、标注或密钥。

![浅色阅读界面](docs/reader-light.png)

![深色阅读界面](docs/reader-dark.png)

![历史对话](docs/reader-chat-history.png)

## 主要功能

- **三栏联动**：点击章节或逻辑节点，同时定位解析和 PDF；各栏可拖动调整宽度、独立滚动。
- **按原文结果逻辑阅读**：研究背景对应 Introduction，解析保留 Results 各小节的顺序与中文编号；研究主线只呈现结果，不加入背景、研究缺口、方法和补充章节。大纲去除延伸数据和补充图后缀。
- **以图为中心**：子图展开后优先展示“怎么看”和“结果”；分组、颜色、坐标等读图细节保留。支持框选精读、固定对照、折叠和编辑。
- **PDF 阅读**：缩放、手形平移、文字选择、划词翻译、自选颜色高亮、书签、搜索、旋转、下载和打印。图像先显示，文字层随后加载。
- **本机 AI**：默认调用已登录的官方 Codex CLI，使用自己的 ChatGPT 订阅；也可手动切换 DeepSeek API。支持模型及低 / 中 / 高推理强度选择、文献问答、翻译和后台分批解析。
- **文献整理**：文件夹、分区、排序、重命名、标签、收藏、阅读状态、期刊官网链接和统一搜索。
- **资料保留**：Markdown 笔记、解析编辑历史、回收站、完整备份与恢复、每日自动备份。
- **缓存与节能**：查看缓存大小、手动清理、每天 / 每周 / 每 30 天定时清理；空闲时降低检查频率，可选择更省电。
- **明暗与专注模式**：浅色、深色主题；一键收起两侧栏，解析字号独立调整。

![分区设置](docs/settings-light.png)

## 安装与开始

1. 在 [Releases](https://github.com/Charterhale/PaperRead/releases/tag/v0.9.9) 下载 `PaperRead-0.9.9-macOS-arm64.zip`，解压并把 `PaperRead.app` 拖入“应用程序”。
2. 打开软件，先使用内置教学文献熟悉界面，再拖入自己的 PDF。
3. 若使用 Codex，请先安装官方 Codex CLI，并使用自己的 ChatGPT 账号登录；在左下角“设置”检查连接、选择模型和推理强度。无需 OpenAI API Key，订阅用量与日常 Codex 共享，可用模型和额度以自己的账号实际权限为准。
4. 使用 DeepSeek 时，在设置中手动切换服务并填写自己的 API Key。

当前安装包面向 **Apple Silicon Mac**，没有 Apple 开发者公证。下载页提供 SHA-256 校验文件。更新前建议在软件内导出完整备份。

## 本地数据与 AI 请求

导入时保存 PDF 与标题中文释义；仅按下解析后才用 Microsoft MarkItDown 提取原文 MD，并结合原图解析。PDF、原文 MD 和解析 MD 放在同一个“期刊-年份-标题”文件夹。可将两份 MD 投送到公众号写作器复用。

文献、笔记和标注存储在本机。桌面版继续沿用 `~/Library/Application Support/PaperLens`，更名无需迁移原有文献。

普通 PDF 阅读、标注、编辑和文献管理不需要向 AI 服务发送内容；调用解析、问答、翻译或精读时，相关材料会发往所选模型服务。软件不附带订阅、API Key 或个人文献库。DeepSeek 密钥仅在当前窗口及任务所需内存中保留，不写入备份；本机 Codex 使用其自身登录状态。

后台解析会逐页识别含图及扫描页面，自动分批处理并保存检查点，失败后可继续。完全退出应用后任务不会继续运行。当前单篇支持最多 160 页；扫描图像可以参与 AI 解析，但没有文字层的页面不能直接划词。

PDF 高亮与书签保存在本机，不直接改写原 PDF。图表解释由模型生成，支持随时对照原图并手动编辑。

## 从源码运行

需要 Node.js 22.12 或更新的受支持版本及 npm。桌面打包还需要 macOS Swift 编译工具和 Python 3.12 的 macOS arm64 独立运行环境（例如 [python-build-standalone](https://github.com/astral-sh/python-build-standalone) 的 install_only 包）。运行环境不存入 Git；将其解压后准备依赖：

```bash
node scripts/setup-runtime.mjs /absolute/path/to/standalone-python
```

期刊分区表由使用者自行提供，公开包不包含个人表格。可用 `scripts/import-journal-table.py` 整理本地表；桌面版读取 `~/Library/Application Support/PaperLens/Journal Catalog/journals.json`。

```bash
npm ci
npm run dev
```

构建与桌面打包：

```bash
npm test
npm run build
npm run desktop
npm run package:mac
```

桌面产物位于 `release/PaperRead-darwin-arm64/`。当前脚本针对 macOS arm64；Intel Mac 需要调整架构并单独验证。开发网页和桌面版使用不同的本机存储空间，资料迁移请使用软件内的完整备份。

## 项目结构

```text
src/        阅读界面、PDF、解析、文献库与本地存储
server/     本机 API、Codex / DeepSeek、后台任务和检查点
electron/   桌面窗口与本机服务
scripts/    打包、演示文献与截图
tests/      接口、数据保留、PDF 与阅读交互检查
docs/       演示截图
```

## 0.9.9 最终版

设置改为分类布局，缓存大小、定时清理和节能选项位于“文献与数据”。返回文献库和开关左侧栏分别使用独立按钮，切换侧栏保留 PDF 及解析阅读位置。历史对话可随时展开和固定收起。

完整变化见 [版本说明](docs/release-0.9.9.md)。
