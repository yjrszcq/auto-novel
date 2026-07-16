# 轻小说机翻机器人

本仓库将[轻小说机翻机器人](https://n.novelia.cc/)精简为了纯前端应用，专注于管理 GPT / Sakura 工作区与本地小说翻译任务。

## 功能

- 管理 GPT / Sakura 工作区，排队并追踪本地小说翻译任务。
- 通过本地文件创建翻译项目，并导出 EPUB / TXT。
- 搜索本地上传的小说与缓存的任务记录。
- 支持设置并发翻译。
- 支持自定义公告、网站 Logo 与首页背景图。

历史 Web / Wenku 远程任务已不再支持。工作区加载时会自动清除这些旧任务，保留本地任务及历史 `personal/`、`personal2/` 本地任务。

## 本地书架与阅读器

“书架”位于侧边栏的“工作区”和“设置”之间。导入的本地小说会自动
加入书架；移出书架只改变书架状态，删除小说才会删除正文、译文和关联的
阅读数据。

阅读器支持原文、译文、译文-原文和原文-译文四种显示模式。全局阅读偏好可
在设置页选择，单书偏好可在书籍详情中覆盖。没有可用译文时会回退到原文；
缺失的单段译文会明确提示而不会生成空内容。旧的
`/workspace/reader/:novelId/:chapterId` 地址会自动转到
`/books/:bookId/read/:chapterId`，已有书签可继续使用。

EPUB 优先使用书内的 EPUB3 Navigation Document 或 EPUB2 NCX 作为目录，支持
嵌套目录、同一 XHTML 内的锚点章节和跨 spine 文档章节；只有在书内目录缺失
或损坏时才按 spine 保守回退，不会把 `nav.xhtml` 等清单文件强行当成章节。
旧版导入的 EPUB 会在打开详情或阅读器时尝试从浏览器保存的原文件安全迁移：
只有正文可以逐段精确对应时才会原子更新章节及阅读位置；无法确认时保留旧
数据并提示重新导入，不会覆盖已有译文、书签或批注。

书籍正文和当前译文继续来自现有的本地小说记录，不会被书架复制。书架状态、
阅读设置、单书偏好、进度、书签、批注、封面和阅读统计则保存在当前浏览器
的 IndexedDB 中。进度按稳定段落 ID 保存，导入时会为旧章节补齐这些 ID；
清除浏览器站点数据或换用设备不会自动同步或恢复这些阅读数据。

阅读器正文按纯文本渲染。词典、朗读和“发送到交互翻译”均须由用户主动
触发；后者只在本次浏览器会话中交接选中文本，实际翻译仍使用用户已配置的
服务。

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
- `html/info-gpt.html`：GPT 工作区说明。
- `html/info-sakura.html`：Sakura 工作区说明。

已有配置目录根部的 `info*.html` 会在容器启动时自动复制到新的 `html/` 目录（若目标文件不存在），无需手动迁移。

## 声明

- 本仓库基于[轻小说机翻机器人](https://n.novelia.cc/)进行修改，在此致敬原作者：[auto-novel/auto-novel](https://github.com/auto-novel/auto-novel)。

- 镜像 [`szcq/auto-novel`](https://hub.docker.com/r/szcq/auto-novel) 由 GitHub Actions 自动构建打包，完全基于公开的开源代码生成，请放心使用。

- 阅读器界面和交互以 Candle Reader v1.0.2 为适配基线；版权、适配范围与完整
  MIT 许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本仓库没有
  复制 TaleBook 宿主模板或 Candle Reader 预构建资源。

- 本项目以仓库内的 [GNU GPL v3](LICENSE) 发布；依赖包仍遵循各自的许可证。

- 感谢使用。
