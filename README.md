# Wikist

Wikist 是一个面向中文数学与科学知识共同体的轻量级 Wiki 框架。它以 Markdown 文件为核心内容格式，以 SQLite 承载账号、评论、权限、审计与协作数据，目标是在保持可迁移、可审查、可部署的基础上，提供比传统 Wiki 更适合数学表达、可视化建模和现代浏览器交互的知识平台。

发布日期：2026-07-10

## 项目定位

Wikist 不是问答社区，也不是松散笔记系统。它更像一个为严肃知识写作重新设计的轻量 Wiki 内核：词条要能被长期维护，公式要能稳定渲染，证明与定义要有清晰结构，讨论和权限要能被审计，整站也要能直接复制、备份和迁移。

适合场景：

- 数学、物理、计算机科学等专业知识百科。
- 小型研究团队、学习社区、课程知识库。
- 需要开放编辑、评论、修订记录和用户身份的中文知识站点。
- 希望避开重型 PHP/MySQL 运维栈的个人或团队 Wiki。

## 核心特色

- **轻量化内核**：后端使用 Node.js 标准 HTTP 服务，不依赖 Express 等大型框架；核心逻辑集中，便于审查和二次开发。
- **安装即配置**：首次部署访问 `/install.html`，通过网页写入 `config/site.config.json`，配置站点身份、SQLite 路径、编辑策略和 SMTP。
- **内容可迁移**：词条以 Markdown 文件存放在 `content/pages/`，修订记录存放在 `content/revisions/`，便于备份、迁移、版本比较和人工维护。
- **数学优先**：内置 TeX 公式、结构化定义/定理/证明块、脚注、定义列表、表格、任务列表、MediaWiki 风格图片语法和知识链接。
- **创新融入 function-plot**：通过 `::: function-plot` 围栏直接在词条中绘制交互式函数图像，支持拖拽、缩放、特殊函数和隐函数表达，更适合数学概念的直观展示。
- **可视化建模能力**：除函数图像外，还内置 JSXGraph 几何板和 Chart.js 数据曲线建模，可在词条中展示可拖拽几何构造、数列、统计图和实验数据。
- **现代化编辑体验**：前端是单页应用，提供词条阅读、编辑、翻译、评论、权限、历史、收藏、消息、后台管理等路由；写作过程围绕 Markdown 源文和即时渲染结果展开。
- **内置 Passport 身份层**：支持注册、登录、HttpOnly 会话、验证码、密码修改、邮箱验证、找回密码、TOTP 二次验证、公开用户主页和贡献身份记录。
- **协作审计完整**：编辑事件、访客身份、评论、评分、收藏、全站消息、权限调整、备份回档和后台操作可写入 SQLite 供追溯。
- **高可自定义**：站点名称、语言、导航、首页模块、首页文案、插件启停、CDN 地址、自定义 CSS/JS、SMTP、安全策略等都可通过配置或后台维护。
- **插件化扩展**：插件以 `plugins/*/plugin.json` 登记，支持核心执行、可信客户端模块、仅清单管理和上游仓库缓存审查，不默认执行未知第三方代码。
- **可移植备份**：整站备份可打包内容、配置、插件清单，并可选择是否包含用户数据；恢复流程带路径白名单和安全备份。

## 与 MediaWiki 的对比

| 维度 | Wikist | MediaWiki |
| :--- | :--- | :--- |
| 技术栈 | Node.js + 文件 Markdown + SQLite | PHP + MySQL/MariaDB，通常需要 Web 服务器栈 |
| 部署复杂度 | 单项目目录，启动后通过 `/install.html` 配置 | 依赖较多，生产部署通常需要 PHP-FPM、数据库、扩展和缓存组件 |
| 内容存储 | 词条是 Markdown 文件，易复制、审查、Git 化和人工迁移 | 页面主要存于数据库，导出迁移通常依赖专门工具 |
| 数学表达 | TeX、结构块、函数图、几何板、数据图表面向数学写作内置 | 可通过扩展支持数学公式，但可视化建模通常需要额外扩展或模板体系 |
| 可视化能力 | `function-plot`、JSXGraph、Chart.js 直接进入词条语法 | 强项在百科规模和模板系统，可视化能力取决于站点安装的扩展 |
| 编辑体验 | 现代 SPA 路由，Markdown 编辑与前端渲染结合 | 经典 Wiki 编辑器和可视化编辑器生态成熟，但整体更重 |
| 权限与身份 | 内置轻量 Passport、访客审计、页面权限、评论权限 | 用户、权限、扩展生态非常成熟，适合大型公共百科 |
| 插件安全边界 | 默认只执行核心可信插件，第三方先登记和审查 | 扩展能力强，但扩展安装和维护成本较高 |
| 适用规模 | 个人、团队、小到中型专业知识社区 | 大型公共 Wiki、多语言百科、复杂社区治理 |
| 可定制方式 | JSON 配置、后台设置、插件清单、自定义 CSS/JS | LocalSettings.php、扩展、皮肤、模板、Lua/Scribunto 等 |
| 设计取向 | 轻量、可移植、数学优先、快速二次开发 | 通用百科平台、大规模协作、成熟生态 |

简而言之，MediaWiki 更像一座成熟的大型城市：生态完整、治理工具丰富、适合超大规模百科。Wikist 更像一个为数学与科学知识重新打磨的轻量工作台：部署更小、内容更透明、公式和可视化更贴近专业写作，适合从零搭建一个可控、可迁移、可扩展的知识核心。

## 仓库内容

本仓库是最小化、安装优先的公开发布包，包含：

- `src/`：Node.js 服务端核心。
- `public/`：浏览器界面、安装器、样式和本地前端资源。
- `plugins/`：可信插件清单与客户端模块。
- `docs/`：架构、安装、Passport、评论权限、内容质量和路线图文档。
- `tools/`：启动脚本和功能检查脚本。
- `config/site.config.example.json`：站点配置示例。
- `content/*/.gitkeep`：空内容目录占位。

本仓库刻意不上传本地部署数据：

- `data/`：SQLite 数据库、用户、会话、评论、评分、收藏、消息、审计日志和备份。
- `logs/`：运行日志。
- `content/pages/`：当前本地词条。
- `content/revisions/`：本地修订历史。
- `content/deleted/`：本地删除归档。
- `config/site.config.json`：每个站点自己的安装配置。
- `plugins/vendor/`：可重新同步并本地审查的第三方源码缓存。

## 环境要求

- Node.js 18 或更高版本。
- Windows、Linux 或 macOS 终端环境。

Wikist Passport 当前使用 Node.js 的 `node:sqlite`。如果部署环境的 Node 构建不包含该模块，可将 `src/core/passport-store.js` 替换为 `better-sqlite3`、PostgreSQL 或 MySQL 适配层，并保持相同接口。

## 首次安装

启动服务：

```powershell
node server.js
```

Windows 也可以使用：

```powershell
.\run-wikist-server.cmd
```

然后打开：

```text
http://127.0.0.1:8899/install.html
```

安装器会写入 `config/site.config.json`，包括：

- 站点名称、标语、语言和许可证。
- SQLite 相对路径，默认建议为 `data/wikist.sqlite`。
- 开放编辑、登录编辑或令牌编辑策略。
- 可选 SMTP，用于邮箱验证和找回密码。

安装成功后重启服务，使新配置生效。

## 常用命令

```powershell
npm run check
```

该命令执行核心 JavaScript 语法检查。`tools/` 中还保留了 Markdown、搜索、评论评分、备份、收藏、数学建模、消息优先级和安全邮件等功能检查脚本；其中部分脚本会创建临时数据或需要演示内容，因此首装发布包只把 `npm run check` 作为基础验证命令。

## 内容与数据模型

Wikist 把代码、内容和用户数据分开：

- 词条 Markdown：`content/pages/`
- 修订快照：`content/revisions/`
- 删除归档：`content/deleted/`
- 账号、评论、评分、收藏、消息、翻译、审计：SQLite
- 站点配置：`config/site.config.json`
- 插件清单：`plugins/*/plugin.json`

这种结构的优点是：代码可以公开，内容可以私有，用户数据可以本地备份，站点也可以整体复制迁移。

## 插件机制

插件采用类似 MediaWiki extensions 的本地目录模型：

```text
plugins/
  my-plugin/
    plugin.json
```

支持的运行状态：

- `core:*`：由 Wikist 核心直接执行的可信功能。
- `clientModule`：可信浏览器模块，从 `/plugins/<plugin>/...` 按需加载。
- `clone-ready`：只登记上游仓库，源码可同步到 `plugins/vendor/` 后再审查。
- `manifest-only`：只进入后台管理、配置和文档展示，不执行代码。

同步第三方 vendor 源码：

```powershell
node tools/sync-vendor-plugins.js
```

## 生产建议

设置稳定的 Passport 密钥：

```powershell
$env:WIKIST_PASSPORT_SECRET = "replace-with-a-long-random-secret"
```

如需写入令牌保护：

```powershell
$env:WIKIST_EDIT_TOKEN = "replace-with-an-edit-token"
node server.js
```

对外部署时建议放在 HTTPS 反向代理之后。只有在防火墙和反向代理已配置好时，再设置：

```powershell
$env:WIKIST_HOST = "0.0.0.0"
```

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。
