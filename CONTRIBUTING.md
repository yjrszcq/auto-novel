# 贡献代码

感谢您有兴趣为这个项目做出贡献！为了高效协作，请遵循以下规范。

- 在编写代码前，请先通过 Issue 讨论变更计划，确保与现有开发方向一致。
- 提交 Pull Request 时，请保持内容精简，每次聚焦一个独立的修改点，以便快速检视和合入。
- 如果使用 AI 辅助编写，请务必自己检视一遍。

## 如何参与前端开发

本项目是纯前端应用，基于 Vue 3、TypeScript、Vite 与 [Naive UI](https://www.naiveui.com/zh-CN) 开发。翻译任务和本地小说数据均保存在浏览器端；项目不包含后端、数据库或 Elasticsearch 服务。

首先准备开发环境：

```bash
git clone https://github.com/yjrszcq/auto-novel.git
cd auto-novel/web
corepack enable
pnpm install --frozen-lockfile # 安装依赖
pnpm prepare                   # 设置Git钩子
```

常用命令如下：

```bash
pnpm dev          # 启动开发服务器
pnpm test         # 运行 Vitest
pnpm run build    # 生产构建与类型检查
pnpm run lint     # 检查 src 目录
pnpm run test:e2e   # 运行本地 IndexedDB 阅读器浏览器流程
```

首次运行浏览器流程前，请在 `web/` 目录执行一次
`corepack pnpm exec playwright install chromium`；测试会自行启动 Vite 预览服务。
Docker 变更可在仓库根目录使用 `docker build -t auto-novel:local web` 验证。

## 阅读器与隐私边界

书架和阅读器的正文、译文与阅读状态均以浏览器本地数据为边界。请勿为这些
数据添加账号、服务端同步或隐式正文上传；面向翻译服务的请求必须保留为用户
主动操作。段落 ID 是进度、书签和批注的稳定定位键，修改导入器或章节结构时
必须保留或安全迁移它们。正文和译文必须继续按纯文本渲染。

EPUB 导入必须优先使用 EPUB3 nav 或 EPUB2 NCX，并保持目录标题、层级、锚点和
spine 顺序。无目录时只能回退到 spine，不能重新遍历整个 manifest。修改章节
切分时必须同时验证译文导出和旧书惰性迁移；无法逐段精确映射的旧书必须保持
原状并给出可重新导入的提示。

本地书籍的原始 EPUB、原始元信息与展示覆盖必须保持分离。元信息和封面只在
用户启用下载嵌入时写入临时下载副本，不得替换 IndexedDB 保存的原文件；展示
覆盖还必须区分“从未修改”和“用户主动清空”。

阅读器外壳适配自 Candle Reader v1.0.2。修改相关交互时请保留
`THIRD_PARTY_NOTICES.md` 中的 MIT 声明，不要提交 TaleBook 宿主模板、Candle
Reader 预构建 bundle、Vuetify 或远程阅读服务。`auto` 阅读流在电脑上解析为
横向分页、手机上解析为纵向滚动；两种流都必须验证稳定进度、目录、双语模式、
书签、批注、朗读和选中文本交接。

运行时默认配置位于 `web/config/`。Docker 镜像会将其复制到 `/app/default-config`，并在启动时为挂载的 `/app/config` 补齐缺失文件。请通过挂载目录修改 `config.json`、`html/info*.html` 和 `images/` 中的本地图片；`config.json` 中的图片路径均相对 `/app/config`。不要将个人配置或密钥提交到仓库。

提交前请至少运行与改动相符的检查；涉及构建、路由、任务模型或运行时配置时，运行 `pnpm test` 与 `pnpm run build`。涉及阅读器交互或响应式布局时还必须运行 `pnpm run test:e2e`。
