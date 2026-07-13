# 轻小说机翻机器人

本仓库将[轻小说机翻机器人](https://n.novelia.cc/)精简为了纯前端应用，专注于管理 GPT / Sakura 工作区与本地小说翻译任务。

## 功能

- 管理 GPT / Sakura 工作区，排队并追踪本地小说翻译任务。
- 通过本地文件创建翻译项目，并导出 EPUB / TXT。
- 搜索本地上传的小说与缓存的任务记录。
- 支持设置并发翻译。
- 支持自定义公告、网站 Logo 与首页背景图。

历史 Web / Wenku 远程任务已不再支持。工作区加载时会自动清除这些旧任务，保留本地任务及历史 `personal/`、`personal2/` 本地任务。

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

- 感谢使用。
