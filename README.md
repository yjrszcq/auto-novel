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

阅读器使用原文、译文、译文-原文、原文-译文和“每次询问”五种模式。没有
可用译文时会回退到原文；缺失的单段译文会明确提示而不会生成空内容。旧的
`/workspace/reader/:novelId/:chapterId` 地址会自动转到
`/books/:bookId/read/:chapterId`，已有书签可继续使用。

书籍正文和当前译文继续来自现有的本地小说记录，不会被书架复制。书架状态、
阅读设置、单书偏好、进度、书签、批注、封面和阅读统计则保存在当前浏览器
的 IndexedDB 中。进度按稳定段落 ID 保存，导入时会为旧章节补齐这些 ID；
清除浏览器站点数据或换用设备不会自动同步或恢复这些阅读数据。

阅读器正文按纯文本渲染。词典、朗读和“发送到交互翻译”均须由用户主动
触发；后者只在本次浏览器会话中交接选中文本，实际翻译仍使用用户已配置的
服务。

## 部署

1. 使用以下命令快速部署项目

   ```bash
   docker run -d --name auto-novel -p 8011:80 -v ./config:/app/config --restart unless-stopped szcq/auto-novel
   ```

2. 浏览器访问 `http://localhost:8011`

容器首次启动时会在 `/app/config` 中补齐缺失的默认配置文件；因此应始终挂载该目录，保存自己的配置。首页背景与 Logo 可通过挂载目录中的 `config.json` 配置：

```json
{
  "logoImage": "images/logo.png",
  "homeBackgroundImage": "images/banner.webp"
}
```

将 Logo 或背景图上传到映射目录的 `images/` 后，在 `logoImage` 或 `homeBackgroundImage` 填入相对路径，例如 `images/logo.png`。值以 `http://` 或 `https://` 开头时会被当作远程图片链接，其他非空值均作为相对 `/app/config` 的本地文件路径处理。

默认背景已复制到 `images/banner.webp` 并写入 `homeBackgroundImage`。该配置留空时，首页仍会使用源码内置的同一张默认背景图兜底。

`html/` 中的 HTML 文件也可直接编辑，用于显示应用内说明：

- `html/info.html`：首页公告。
- `html/info-gpt.html`：GPT 工作区说明。
- `html/info-sakura.html`：Sakura 工作区说明。

已有配置目录根部的 `info*.html` 会在容器启动时自动复制到新的 `html/` 目录（若目标文件不存在），无需手动迁移。

## 声明

- 本仓库基于[轻小说机翻机器人](https://n.novelia.cc/)进行修改，在此致敬原作者：[auto-novel/auto-novel](https://github.com/auto-novel/auto-novel)。

- 镜像 [`szcq/auto-novel`](https://hub.docker.com/r/szcq/auto-novel) 由 GitHub Actions 自动构建打包，完全基于公开的开源代码生成，请放心使用。

- 阅读器和书架功能由本项目自行实现；candle-reader、TaleBook 与 Koodo Reader
  仅作为架构和交互参考，未复制其代码或资源，因此本次没有新增
  `THIRD_PARTY_NOTICES.md`。将来若复用第三方代码，会随代码加入准确的版权和
  许可证声明。

- 本项目以仓库内的 [GNU GPL v3](LICENSE) 发布；依赖包仍遵循各自的许可证。

- 感谢使用。
