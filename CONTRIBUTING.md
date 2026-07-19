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
pnpm test:performance # 运行翻译/阅读器性能契约
pnpm run build    # 生产构建与类型检查
pnpm run lint     # 检查源码、单元测试与端到端测试，要求零告警
pnpm run test:e2e # 运行本地 IndexedDB 阅读器浏览器流程
pnpm run test:gate # 运行完整核心回归门禁
pnpm audit --prod # 检查生产依赖漏洞
pnpm outdated     # 检查直接依赖版本
```

`test:performance` 是确定性工作量门禁，不以易波动的墙钟耗时为断言：它检查服务
请求并发和数量、GPT/Sakura 共享池的高水位/热加入/停止重排、独立接口限流、取消/恢复
落库范围、缓存身份/去重/容量、千章 IndexedDB 请求数以及长章节 DOM 窗口。修改
翻译算法、调度、缓存或阅读器数据层时应至少运行该命令。

GPT 和 Sakura 工作区各自只有一个任务协调器，已启动的翻译器卡片只向对应共享池
提供请求容量；不要重新引入“每张卡领取整项任务”的执行路径，也不要混用两种
服务的提示词或 API 适配。每个工作者上限为 1–16，全池实际上限是已启动工作者
之和并受未完成工作高水位约束。Sakura 依赖已完成的译文前文，因此同章分段必须
保持顺序，只能在独立章节之间共享容量；同一池的检测模型/版本、分段长度和前文
长度必须一致。停止工作者应重排在途分段，停止任务才保存未完成章节并结束任务。

首次运行浏览器流程前，请在 `web/` 目录执行一次
`corepack pnpm exec playwright install chromium`；测试会自行启动 Vite 预览服务。
Docker 变更可在仓库根目录使用 `docker build -t auto-novel:local web` 验证。
对已经启动的实例，可在 `web/` 目录使用
`PLAYWRIGHT_BASE_URL=http://127.0.0.1:8011 pnpm test:e2e` 复用完整浏览器套件，
或使用 `pnpm test:runtime-smoke http://127.0.0.1:8011 docker` 快速检查上传、
深路由、运行时资源、阅读器不透明主题栏和浏览器错误。

## 阅读器与隐私边界

书架和阅读器的正文、译文与阅读状态均以浏览器本地数据为边界。请勿为这些
数据添加账号、服务端同步或隐式正文上传；面向翻译服务的请求必须保留为用户
主动操作。段落 ID 是进度、书签和批注的稳定定位键，当前数据结构内修改导入器
或章节结构时必须保持这些 ID 稳定。正文和译文必须继续按纯文本渲染。

项目不维护旧版应用数据兼容层。破坏设置、任务、工作区、书架、阅读器或缓存
结构时，应切换明确的新存储键、数据库名或数据库版本，并在文档中说明数据
重置；不要加入旧字段回填、旧路由跳转或启动时迁移代码。EPUB2 NCX、EPUB2
封面元数据和保守的异常 EPUB 回退属于外部文件格式支持，不属于旧版应用兼容。

EPUB 导入必须优先使用 EPUB3 nav 或 EPUB2 NCX，并保持目录标题、层级、锚点和
spine 顺序。无目录时只能回退到 spine，不能重新遍历整个 manifest。修改章节
切分时必须同时验证当前格式的导入、阅读、译文导出和稳定段落定位。
富 EPUB 内容必须留在已清理的隔离 DOM 中；不得执行书内脚本、加载远程出版物
资源或把翻译服务输出当作 HTML。新增媒体类型或回退规则时同步更新
`docs/epub-support.md` 与真实 ZIP 浏览器夹具。

本地书籍的原始 EPUB、原始元信息与展示覆盖必须保持分离。元信息和封面只在
用户启用下载嵌入时写入临时下载副本，不得替换 IndexedDB 保存的原文件；展示
覆盖还必须区分“从未修改”和“用户主动清空”。

阅读器外壳适配自 Candle Reader v1.0.2。修改相关交互时请保留
`THIRD_PARTY_NOTICES.md` 中的 MIT 声明，不要提交 TaleBook 宿主模板、Candle
Reader 预构建 bundle、Vuetify 或远程阅读服务。`auto` 阅读流在电脑上解析为
横向分页、手机上解析为纵向滚动；两种流都必须验证稳定进度、目录、双语模式、
书签、批注、朗读和选中文本交接。

运行时默认配置位于 `web/config/`。Docker 镜像会将其复制到
`/app/default-config`，并在启动时为挂载的 `/app/config` 补齐当前结构中缺失的
文件。请通过挂载目录修改 `config.json`、`html/info*.html` 和 `images/` 中的
本地图片；`config.json` 中的图片路径均相对 `/app/config`。根目录旧版
`info*.html` 不会被读取或迁移。不要将个人配置或密钥提交到仓库。

提交前请至少运行与改动相符的检查；涉及构建、路由、任务模型或运行时配置时，
运行 `pnpm lint`、`pnpm test` 与 `pnpm run build`。依赖变更还应运行
`pnpm audit --prod` 和 `pnpm outdated`；涉及阅读器交互或响应式布局时还必须
运行 `pnpm run test:e2e`。
