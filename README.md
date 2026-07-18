# 轻小说机翻机器人

本仓库将[轻小说机翻机器人](https://n.novelia.cc/)精简为了纯前端应用，专注于管理 GPT / Sakura 工作区与本地小说翻译任务。

## 功能

- 管理 GPT / Sakura 工作区，排队并追踪本地小说翻译任务。GPT 工作区仅使用
  OpenAI 兼容的 Chat Completions API，不使用 ChatGPT 网页接口或访问令牌。
- 通过本地文件创建翻译项目，并导出 EPUB / TXT。
- 搜索本地上传的小说与缓存的任务记录。
- 支持设置并发翻译。
- 支持自定义公告、网站 Logo 与首页背景图。

当前版本只读取当前命名空间和数据结构，不包含旧版任务、设置、工作区、阅读器
或缓存迁移。跨越破坏性存储版本升级时，旧浏览器数据不会被导入；需要保留的
小说应在升级前导出，并在升级后重新导入。

## 本地书架与阅读器

“书架”位于侧边栏的“工作区”和“设置”之间。导入的本地小说会自动
加入书架；移出书架只改变书架状态，删除小说才会删除正文、译文和关联的
阅读数据。

阅读器支持原文、译文、译文-原文和原文-译文四种显示模式。全局阅读偏好可
在设置页选择，单书偏好可在书籍详情中覆盖。没有可用译文时会回退到原文；
缺失的单段译文会明确提示而不会生成空内容。当前阅读地址为
`/books/:bookId/read/:chapterId?`，旧版阅读地址不再处理。

EPUB 优先使用书内的 EPUB3 Navigation Document 或 EPUB2 NCX 作为目录，支持
嵌套目录、同一 XHTML 内的锚点章节和跨 spine 文档章节；只有在书内目录缺失
或损坏时才按 spine 保守回退，不会把 `nav.xhtml` 等清单文件强行当成章节。

书籍详情页可编辑本地展示用的书名、作者、简介、封面链接和语言。尚未编辑的
字段读取 EPUB 原始元信息；主动清空并保存后会保持为空，“还原原始元信息”则
重新填入 EPUB 自带值。原始 EPUB 始终保持不变。设置页可分别控制原文、译文
下载副本是否嵌入当前展示元信息，单本书也可选择跟随全局、开启或关闭；启用
时封面链接优先于本地自定义封面，两者都没有则保留 EPUB 原封面。

封面展示优先级为：封面链接、本地自定义封面、EPUB 内嵌封面、运行时配置的
默认封面、彩色文字封面。填写封面链接后不会预加载或在失败时回闪低优先级
封面；清空链接后，保留在浏览器中的自定义封面会重新生效。

书籍正文和当前译文继续来自现有的本地小说记录，不会被书架复制。书架状态、
阅读设置、单书偏好、进度、书签、批注、封面和阅读统计则保存在当前浏览器
的 IndexedDB 中。进度按稳定段落 ID 保存；清除浏览器站点数据、升级到采用
新存储命名空间的版本或换用设备，都不会自动同步或恢复这些阅读数据。

阅读器正文按纯文本渲染。词典、朗读和“发送到交互翻译”均须由用户主动
触发；后者只在本次浏览器会话中交接选中文本，实际翻译仍使用用户已配置的
服务。

书籍有效语言包含中文时，阅读器直接显示原文，并隐藏整章未翻译状态、翻译
本章入口和阅读版本询问。文本选择、AI 查词和选中翻译仍然保留，可用于正文
中偶尔出现的外语句子。

### 阅读器操作

- 点击正文中部可呼出或收起顶部状态栏和底部导航；文本选择或面板打开时不会
  误触。`Esc` 优先关闭面板，再次按下可收起控制栏。
- 底部的“目录”使用 EPUB 原生树形目录并标记当前章和翻译状态；“工具”集中
  提供阅读版本、书签、批注、朗读、翻译本章、前后章、详情和工作区入口。
- 阅读流默认为“自动”：电脑使用双页横向分页，手机使用单栏纵向滚动。设置中
  也可固定为分页或滚动；分页支持左右边缘点击、滚轮、方向键、PageUp、
  PageDown 和空格键。
- 阅读位置优先按稳定段落 ID 恢复，并保存当前流式位置。切换显示模式、阅读流
  或排版设置时会尽量保持当前段落。

## 本地预览

在仓库根目录运行 `./start-local.sh`，即可启动不使用 Docker 的 Vite 开发服务器。它会读取 `web/config/config.json` 和 `web/config/images/`，默认访问地址为 `http://127.0.0.1:5173`。

## 翻译调度与缓存

- “并发量”是单个翻译器在所有并行章节和分段之间共享的请求上限，可设置为
  1–16。它不会形成“章节并发 × 分段并发”的乘积；遇到 HTTP 429/5xx 时会按
  服务端 `Retry-After` 和错峰退避自动等待。提高并发可能增加服务费用和限流，
  建议从 1–2 开始，以服务商明确允许的并发为准。
- Sakura 的分段长度为 100–8000，前文长度为 0–8000，均使用中日韩字符权重为
  1、ASCII 约为 0.5、空白约为 0.25 的加权预算，不等同于模型 token 数。
  Sakura 为保证译文上下文，单章内分段保持顺序；并发主要发生在章节之间。
- GPT 和 Sakura 的分段缓存分别最多保留 5000 条、约 50 MiB，超限按最近最少
  使用顺序清理。相同的并发请求会合并为一次服务商请求；端点、模型、相关术语
  和 Sakura 实际使用的译文前文都会参与缓存标识。“强制重翻”会绕过已有缓存。
- 工作区显示当前缓存容量及本次会话的命中、未命中、并发合并、实际请求和故障
  数。清空缓存不会删除书籍正文或已经保存到章节中的译文。

## 开发与检查

在 `web/` 目录使用仓库声明的 pnpm 版本：

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm test
corepack pnpm test:performance
corepack pnpm run build
corepack pnpm test:e2e
corepack pnpm test:gate
corepack pnpm audit --prod
corepack pnpm outdated
```

首次运行浏览器测试前执行
`corepack pnpm exec playwright install chromium`。生产构建同时执行 Vite 构建和
Vue TypeScript 检查；lint 覆盖应用源码、单元测试和端到端测试，并以零告警为
通过标准。

`test:gate` 会依次执行严格 lint、全部 Vitest、生产构建/类型检查和完整
Playwright 核心流程，不需要商业翻译服务凭据。Playwright 默认自行启动 Vite；
`test:performance` 使用本地临时 HTTP 服务和 fake IndexedDB，验证分段、并发、
退避、取消/恢复、缓存、千章读取和长章节窗口，也不需要真实 API Key。
如需验证已经启动的本地或容器实例，可指定地址，例如：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8011 corepack pnpm test:e2e
corepack pnpm test:runtime-smoke http://127.0.0.1:8011 docker
```

`test:runtime-smoke` 的模式可选 `start-local`、`preview` 或 `docker`，会实际
上传 TXT、打开书架/详情/阅读器深路由，并检查运行时配置、资源、上下栏透明度、
控制台错误和失败请求。

## 部署

1. 使用以下命令快速部署项目

   ```bash
   docker run -d --name auto-novel -p 8011:80 -v ./config:/app/config --restart unless-stopped szcq/auto-novel
   ```

2. 浏览器访问 `http://localhost:8011`

容器首次启动时会在 `/app/config` 中补齐缺失的默认配置文件；因此应始终挂载该目录，保存自己的配置。首页背景、Logo 与无封面书籍的默认封面可通过挂载目录中的 `config.json` 配置：

```json
{
  "logoImage": "images/logo.png",
  "homeBackgroundImage": "images/banner.webp",
  "defaultBookCoverImage": "images/default-cover.webp"
}
```

将 Logo、背景图或默认书籍封面上传到映射目录的 `images/` 后，在 `logoImage`、`homeBackgroundImage` 或 `defaultBookCoverImage` 填入相对路径，例如 `images/logo.png`。值以 `http://` 或 `https://` 开头时会被当作远程图片链接，其他非空值均作为相对 `/app/config` 的本地文件路径处理。

默认背景已复制到 `images/banner.webp` 并写入 `homeBackgroundImage`。该配置留空时，首页仍会使用源码内置的同一张默认背景图兜底。

`defaultBookCoverImage` 仅用于没有自定义封面或 EPUB 内嵌封面的书籍；留空时继续使用当前的彩色文字封面兜底。

`html/` 中的 HTML 文件也可直接编辑，用于显示应用内说明：

- `html/info.html`：首页公告。
- `html/info-bookshelf.html`：书架页说明。
- `html/info-gpt.html`：GPT 工作区说明。
- `html/info-sakura.html`：Sakura 工作区说明。

容器只读取上述当前目录结构，不读取或迁移配置目录根部的旧版 `info*.html`。

## 声明

- 本仓库基于[轻小说机翻机器人](https://n.novelia.cc/)进行修改，在此致敬原作者：[auto-novel/auto-novel](https://github.com/auto-novel/auto-novel)。

- 镜像 [`szcq/auto-novel`](https://hub.docker.com/r/szcq/auto-novel) 由 GitHub Actions 自动构建打包，完全基于公开的开源代码生成，请放心使用。

- 阅读器界面和交互以 Candle Reader v1.0.2 为适配基线；版权、适配范围与完整
  MIT 许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本仓库没有
  复制 TaleBook 宿主模板或 Candle Reader 预构建资源。

- 本项目以仓库内的 [GNU GPL v3](LICENSE) 发布；依赖包仍遵循各自的许可证。

- 感谢使用。
