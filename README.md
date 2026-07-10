# Wikist

[中文](#中文) | [English](#english)

---

## 中文

Wikist 是一个面向中文数学与科学知识共同体的轻量级 Wiki 框架。它以 Markdown 文件为核心内容格式，以 SQLite 承载账号、评论、权限、审计与协作数据，目标是在保持可迁移、可审查、可部署的基础上，提供比传统 Wiki 更适合数学表达、可视化建模和现代浏览器交互的知识平台。

发布日期：2026-07-10

### 项目定位

Wikist 不是问答社区，也不是松散笔记系统。它更像一个为严肃知识写作重新设计的轻量 Wiki 内核：词条要能被长期维护，公式要能稳定渲染，证明与定义要有清晰结构，讨论和权限要能被审计，整站也要能直接复制、备份和迁移。

适合场景：

- 数学、物理、计算机科学等专业知识百科。
- 小型研究团队、学习社区、课程知识库。
- 需要开放编辑、评论、修订记录和用户身份的中文知识站点。
- 希望避开重型 PHP/MySQL 运维栈的个人或团队 Wiki。

### 核心特色

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

### 与 MediaWiki 的对比

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

### 仓库内容

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

### 环境要求

- 本地语法检查需要 Node.js 18 或更高版本。
- 云端生产部署推荐 Node.js 24 LTS，最低应使用包含 `node:sqlite` 的 Node.js 22.5.0 或更新版本。
- Windows、Linux 或 macOS 终端环境。

Wikist Passport 当前使用 Node.js 的 `node:sqlite`。如果部署环境的 Node 构建不包含该模块，可将 `src/core/passport-store.js` 替换为 `better-sqlite3`、PostgreSQL 或 MySQL 适配层，并保持相同接口。

### 首次安装

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

### 常用命令

```powershell
npm run check
```

该命令执行核心 JavaScript 语法检查。`tools/` 中还保留了 Markdown、搜索、评论评分、备份、收藏、数学建模、消息优先级和安全邮件等功能检查脚本；其中部分脚本会创建临时数据或需要演示内容，因此首装发布包只把 `npm run check` 作为基础验证命令。

### 内容与数据模型

Wikist 把代码、内容和用户数据分开：

- 词条 Markdown：`content/pages/`
- 修订快照：`content/revisions/`
- 删除归档：`content/deleted/`
- 账号、评论、评分、收藏、消息、翻译、审计：SQLite
- 站点配置：`config/site.config.json`
- 插件清单：`plugins/*/plugin.json`

这种结构的优点是：代码可以公开，内容可以私有，用户数据可以本地备份，站点也可以整体复制迁移。

### 插件机制

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

### 云端部署完整教程

下面以 Ubuntu 云服务器、Nginx、systemd 和 HTTPS 为例。所有项目相关路径均使用占位符，请把 `...你的路径...` 替换为你自己的目录，例如你可以选择家目录、数据盘、网站目录或容器挂载目录。

建议先确定这些变量：

```bash
APP_DIR="...你的路径.../wikist"
ENV_FILE="...你的路径.../wikist.env"
BACKUP_DIR="...你的路径.../wikist-backups"
DOMAIN="wiki.example.com"
RUN_USER="wikist"
PORT="8899"
```

#### 1. 服务器准备

云服务器推荐 Ubuntu 22.04 / 24.04。云厂商安全组放行：

- TCP `22`：SSH。
- TCP `80`：HTTP，用于 Nginx 和证书申请。
- TCP `443`：HTTPS。

不要直接对公网开放 `8899`。Wikist 默认监听 `127.0.0.1:8899`，公网流量应由 Nginx 转发。

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl nginx ufw
```

#### 2. 安装 Node.js

生产环境推荐 Node.js 24 LTS：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt install -y nodejs
node -v
npm -v
node -e "require('node:sqlite'); console.log('node:sqlite ok')"
```

如果最后一条命令失败，说明当前 Node 运行时不包含 `node:sqlite`，请升级 Node，或替换 Passport SQLite 适配层。

#### 3. 获取项目并安装依赖

```bash
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER:$USER" "$APP_DIR"
git clone https://github.com/interuseration-sckur/Wikist.git "$APP_DIR"
cd "$APP_DIR"
npm install --omit=dev
npm run check
mkdir -p data logs content/pages content/revisions content/deleted
```

如果服务器访问 GitHub 很慢，可以在本地打包后上传到 `...你的路径...`，再在服务器解压。

#### 4. 创建运行用户和环境文件

```bash
sudo useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin --user-group "$RUN_USER" || true
sudo chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"
sudo mkdir -p "$(dirname "$ENV_FILE")"
openssl rand -hex 32
```

编辑环境文件：

```bash
sudo nano "$ENV_FILE"
```

写入：

```ini
NODE_ENV=production
WIKIST_HOST=127.0.0.1
WIKIST_PORT=8899
WIKIST_PASSPORT_SECRET=replace-with-a-long-random-secret
```

可选：如果你希望写入 API 或编辑请求必须携带令牌，可继续加入：

```ini
WIKIST_EDIT_TOKEN=replace-with-an-edit-token
```

`WIKIST_PASSPORT_SECRET` 必须长期稳定保存。不要在已有用户后随意更换，否则会影响会话和二次验证密钥。

#### 5. 创建 systemd 服务

```bash
sudo nano /etc/systemd/system/wikist.service
```

把下面的 `...你的路径...` 换成你的真实路径：

```ini
[Unit]
Description=Wikist Wiki Service
After=network.target

[Service]
Type=simple
User=wikist
Group=wikist
WorkingDirectory=...你的路径.../wikist
EnvironmentFile=...你的路径.../wikist.env
ExecStart=/usr/bin/node ...你的路径.../wikist/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable wikist
sudo systemctl start wikist
sudo systemctl status wikist
curl http://127.0.0.1:8899/install.html
```

#### 6. 配置 Nginx 反向代理

```bash
sudo nano /etc/nginx/sites-available/wikist
```

写入，并把域名换成你的域名：

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name wiki.example.com;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8899;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

启用：

```bash
sudo ln -sf /etc/nginx/sites-available/wikist /etc/nginx/sites-enabled/wikist
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

此时访问：

```text
http://wiki.example.com/install.html
```

#### 7. 配置 HTTPS

```bash
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx -d wiki.example.com
sudo certbot renew --dry-run
```

之后访问：

```text
https://wiki.example.com/install.html
```

#### 8. 初始化 Wikist

首次访问未初始化站点时，Wikist 会强制跳转到 `/install.html`。安装器会写入 `config/site.config.json`。

建议填写：

- 站点名称、语言、许可证和简介。
- SQLite 路径：`data/wikist.sqlite`。
- 编辑策略：生产环境建议选择登录后编辑。
- SMTP：用于邮箱验证和找回密码，可先不启用，稍后在后台补充。
- 公开站点地址：`https://wiki.example.com`。

提交安装配置后必须重启：

```bash
sudo systemctl restart wikist
```

重启后访问首页。如果站点还没有管理员，首页会引导创建首位管理员账号。首个账号会自动获得 `admin` 权限，然后可以进入后台、创建词条、管理用户、配置插件和设置备份。

#### 9. 备份

重点备份：

- `...你的路径.../wikist/content/`
- `...你的路径.../wikist/data/`
- `...你的路径.../wikist/config/site.config.json`
- `...你的路径.../wikist.env`

示例：

```bash
sudo mkdir -p "$BACKUP_DIR"
sudo tar -czf "$BACKUP_DIR/wikist-$(date +%F).tar.gz" \
  -C "$APP_DIR" content data config/site.config.json \
  -C "$(dirname "$ENV_FILE")" "$(basename "$ENV_FILE")"
```

#### 10. 更新

```bash
cd "$APP_DIR"
sudo systemctl stop wikist
sudo -u "$RUN_USER" git pull --ff-only
npm install --omit=dev
npm run check
sudo systemctl start wikist
```

如果使用手动上传包，先备份 `content/`、`data/`、`config/site.config.json` 和环境文件，再覆盖代码文件，不要覆盖本地运行数据。

#### 11. 高可自定义部署

你可以按自己的基础设施调整：

- 项目目录：`...你的路径.../wikist`
- 环境文件：`...你的路径.../wikist.env`
- 备份目录：`...你的路径.../wikist-backups`
- 数据库路径：通过安装器设置为项目内相对路径，例如 `data/wikist.sqlite`
- 监听端口：修改 `WIKIST_PORT`
- 反向代理：Nginx、Caddy、Traefik 或云厂商网关均可
- HTTPS：Certbot、云证书、Caddy 自动证书均可
- 邮件：后台或安装器配置 SMTP
- 前端资源：通过后台配置 CDN、自定义 CSS、自定义 JS
- 插件：通过 `plugins/*/plugin.json` 管理，第三方源码缓存放在本地 `plugins/vendor/`

### 常见部署问题

**`curl http://127.0.0.1:8899/install.html` 成功，但公网 IP 失败。**

这是因为 Wikist 默认只监听本机 `127.0.0.1`。生产环境应访问 Nginx 的 `80/443`，也就是 `http://你的域名/install.html` 或 `https://你的域名/install.html`。确认云安全组和系统防火墙已放行 `80`、`443`。

**想用 `http://公网IP:8899` 直接访问。**

不推荐。临时测试时可以设置 `WIKIST_HOST=0.0.0.0` 并放行 `8899`，但正式环境应保持 `127.0.0.1`，由 Nginx 对外提供 HTTPS。

**Nginx 返回 502。**

检查 Wikist 是否运行：`sudo systemctl status wikist`。再检查本机端口：`curl http://127.0.0.1:8899/install.html`。如果本机失败，查看日志：`journalctl -u wikist -f`。

**提示找不到 `node:sqlite`。**

升级到 Node.js 24 LTS，或至少使用包含 `node:sqlite` 的 Node.js 22.5.0 以上版本。

**安装后仍停留在安装页。**

安装写入 `config/site.config.json` 后必须重启服务：`sudo systemctl restart wikist`。重启前运行中的进程不会加载新配置。

**安装后没有管理员。**

重启后访问首页，Wikist 会在没有管理员时显示首位管理员创建页。首个账号自动成为 `admin`。如果你迁移了旧数据库，请确认 `data/wikist.sqlite` 是否已经包含用户。

**无法写入配置、数据库或词条。**

检查权限：`...你的路径.../wikist` 应归运行用户所有，尤其是 `config/`、`data/`、`content/`。

**域名无法访问。**

检查 DNS A 记录是否指向服务器公网 IP，云安全组是否开放 `80/443`，Nginx 的 `server_name` 是否是你的域名。

**HTTPS 申请失败。**

确认域名已经解析到当前服务器，并且 HTTP `80` 能从公网访问。证书申请前不要只开放 `443`。

**SMTP 邮件失败。**

确认 SMTP 主机、端口、用户名、授权码、发件人地址正确。很多邮箱服务商需要单独生成 SMTP 授权码，而不是登录密码。

**GitHub 拉取很慢或失败。**

可以在本地打包上传到 `...你的路径...`，服务器只负责解压、安装依赖和重启服务。

### 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

---

## English

Wikist is a lightweight wiki framework for Chinese-first mathematics and science knowledge communities. It uses Markdown files as the primary article format and SQLite for accounts, comments, permissions, audit logs, and collaboration data. The goal is to keep a wiki portable, inspectable, and easy to deploy while making mathematical writing, visual modeling, and modern browser interaction feel native.

Release date: 2026-07-10

### Project Positioning

Wikist is not a Q&A site and not a loose note collection. It is a compact wiki kernel designed for serious knowledge writing: articles should be maintainable over time, formulas should render reliably, definitions and proofs should have clear structure, discussions and permissions should be auditable, and the whole site should be easy to copy, back up, and migrate.

Good fits include:

- Mathematics, physics, computer science, and other technical encyclopedias.
- Small research groups, learning communities, and course knowledge bases.
- Chinese knowledge sites that need open editing, comments, revision records, and user identity.
- Personal or team wikis that want to avoid a heavy PHP/MySQL operations stack.

### Core Strengths

- **Lightweight core**: the backend uses Node.js standard HTTP APIs without Express or other large server frameworks. The core is compact and easier to audit or customize.
- **Install-first configuration**: visit `/install.html` on first run to generate `config/site.config.json` with site identity, SQLite path, editing policy, and SMTP settings.
- **Portable content**: articles are Markdown files in `content/pages/`; revisions live in `content/revisions/`, making backup, migration, diffing, and manual maintenance straightforward.
- **Math-first writing**: Wikist includes TeX formulas, structured definition/theorem/proof blocks, footnotes, definition lists, tables, task lists, MediaWiki-style images, and wiki links.
- **Innovative function-plot integration**: write `::: function-plot` blocks directly inside articles to render interactive function graphs with pan, zoom, special functions, and implicit expressions.
- **Visual modeling**: JSXGraph geometry boards and Chart.js data charts are built in, allowing draggable geometric constructions, sequences, statistics, and experimental data to live inside articles.
- **Modern editing experience**: the frontend is a single-page app with routes for reading, editing, translation, comments, permissions, history, favorites, messages, and administration. Writing centers on Markdown source and rendered output.
- **Built-in Passport identity layer**: registration, login, HttpOnly sessions, CAPTCHA, password changes, email verification, password recovery, TOTP, public user pages, and contribution attribution are included.
- **Auditable collaboration**: edit events, visitor identity, comments, ratings, favorites, broadcasts, permission changes, backup restores, and admin actions can be written to SQLite for review.
- **Highly customizable**: site name, languages, navigation, home modules, home copy, plugin settings, CDN URLs, custom CSS/JS, SMTP, and security policies can be configured through files or the admin UI.
- **Plugin-oriented extension model**: plugins are declared with `plugins/*/plugin.json`; trusted core logic, trusted client modules, manifest-only entries, and reviewed upstream source caches are separated by design.
- **Portable backups**: backups can package content, configuration, plugin manifests, and optionally user data. Restore paths are allowlisted and safety backups are created before recovery.

### Comparison With MediaWiki

| Dimension | Wikist | MediaWiki |
| :--- | :--- | :--- |
| Technology stack | Node.js + Markdown files + SQLite | PHP + MySQL/MariaDB, usually with a web server stack |
| Deployment complexity | Single project directory; configure through `/install.html` after startup | More dependencies; production usually involves PHP-FPM, database services, extensions, and cache components |
| Content storage | Articles are Markdown files, easy to copy, inspect, Git-track, and manually migrate | Pages mostly live in a database; export and migration usually need dedicated tooling |
| Mathematical writing | TeX, structured blocks, function plots, geometry boards, and charts are built around math writing | Formula support is available through extensions, but visual modeling usually depends on extra extensions or templates |
| Visualization | `function-plot`, JSXGraph, and Chart.js are part of article syntax | Strong at encyclopedia scale and templates; visualization depends on installed extensions |
| Editing experience | Modern SPA routing with Markdown editing and frontend rendering | Mature classic and visual editors, but the overall system is heavier |
| Permissions and identity | Lightweight Passport, visitor audit, page permissions, and comment permissions | Very mature user, permission, and extension ecosystem for large public encyclopedias |
| Plugin safety boundary | Unknown third-party code is not executed by default; plugins are registered and reviewed first | Powerful extension ecosystem, but extension installation and maintenance cost is higher |
| Best scale | Personal, team, small to medium professional knowledge communities | Large public wikis, multilingual encyclopedias, and complex community governance |
| Customization | JSON configuration, admin settings, plugin manifests, custom CSS/JS | LocalSettings.php, extensions, skins, templates, Lua/Scribunto, and more |
| Design direction | Lightweight, portable, math-first, fast to customize | General encyclopedia platform, large-scale collaboration, mature ecosystem |

In short, MediaWiki is like a mature city: rich ecosystem, deep governance tools, and excellent for very large encyclopedias. Wikist is a lightweight workbench tuned for mathematical and scientific knowledge: smaller to deploy, more transparent in storage, closer to formulas and visualization, and easier to adapt when building a controlled, portable knowledge core from scratch.

### Repository Contents

This repository is a minimal, install-first public release. It includes:

- `src/`: Node.js server core.
- `public/`: browser UI, installer, styles, and local frontend assets.
- `plugins/`: trusted plugin manifests and client modules.
- `docs/`: architecture, installation, Passport, comments and permissions, content quality, and roadmap docs.
- `tools/`: startup and feature check scripts.
- `config/site.config.example.json`: example site configuration.
- `content/*/.gitkeep`: empty runtime directory placeholders.

This repository intentionally excludes local deployment data:

- `data/`: SQLite databases, users, sessions, comments, ratings, favorites, messages, audit logs, and backups.
- `logs/`: runtime logs.
- `content/pages/`: local article content.
- `content/revisions/`: local revision history.
- `content/deleted/`: local deleted-page archives.
- `config/site.config.json`: each site's own generated install configuration.
- `plugins/vendor/`: third-party source caches that should be re-synced and reviewed locally.

### Requirements

- Local syntax checks require Node.js 18 or newer.
- Production deployments should use Node.js 24 LTS, or at least Node.js 22.5.0 or newer with `node:sqlite`.
- Windows, Linux, or macOS terminal access.

Wikist Passport currently uses Node.js `node:sqlite`. If your Node build does not include that module, replace `src/core/passport-store.js` with a `better-sqlite3`, PostgreSQL, or MySQL adapter while preserving the same interface.

### First Install

Start the server:

```powershell
node server.js
```

On Windows, you can also use:

```powershell
.\run-wikist-server.cmd
```

Then open:

```text
http://127.0.0.1:8899/install.html
```

The installer writes `config/site.config.json`, including:

- Site name, tagline, language, and license.
- Relative SQLite path, usually `data/wikist.sqlite`.
- Open editing, login-required editing, or token-protected editing policy.
- Optional SMTP for email verification and password recovery.

Restart the server after installation so the new configuration is loaded.

### Common Command

```powershell
npm run check
```

This runs the core JavaScript syntax check. Additional feature check scripts remain under `tools/` for Markdown, search, comments and ratings, backups, favorites, mathematical modeling, message priorities, and security email features. Some of them create temporary data or expect demo content, so the first-install release treats `npm run check` as the baseline validation command.

### Content And Data Model

Wikist separates code, content, and user data:

- Article Markdown: `content/pages/`
- Revision snapshots: `content/revisions/`
- Deleted archives: `content/deleted/`
- Accounts, comments, ratings, favorites, messages, translations, and audit logs: SQLite
- Site configuration: `config/site.config.json`
- Plugin manifests: `plugins/*/plugin.json`

This means code can be public, content can remain private, user data can be backed up locally, and a whole site can be copied or migrated directly.

### Plugin Model

Plugins use a local directory model inspired by MediaWiki extensions:

```text
plugins/
  my-plugin/
    plugin.json
```

Supported runtime states:

- `core:*`: trusted features executed directly by Wikist core.
- `clientModule`: trusted browser modules loaded from `/plugins/<plugin>/...` on demand.
- `clone-ready`: upstream repository metadata only; source can be synced to `plugins/vendor/` and reviewed before use.
- `manifest-only`: admin catalog, configuration, and documentation only; no code execution.

Sync third-party vendor source:

```powershell
node tools/sync-vendor-plugins.js
```

### Full Cloud Deployment

The recommended production setup is Ubuntu, Node.js 24 LTS, systemd, Nginx, and HTTPS. Project-specific paths use placeholders; replace `...your-path...` with your own directory.

Suggested variables:

```bash
APP_DIR="...your-path.../wikist"
ENV_FILE="...your-path.../wikist.env"
BACKUP_DIR="...your-path.../wikist-backups"
DOMAIN="wiki.example.com"
RUN_USER="wikist"
PORT="8899"
```

#### 1. Prepare The Server

Open these inbound ports in your cloud firewall:

- TCP `22` for SSH.
- TCP `80` for HTTP and certificate issuance.
- TCP `443` for HTTPS.

Do not expose `8899` publicly in production. Wikist should listen on `127.0.0.1:8899`, with Nginx forwarding public traffic.

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl nginx ufw
```

#### 2. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt install -y nodejs
node -v
npm -v
node -e "require('node:sqlite'); console.log('node:sqlite ok')"
```

If `node:sqlite` fails to load, upgrade Node.js or replace the Passport SQLite adapter.

#### 3. Clone And Install

```bash
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER:$USER" "$APP_DIR"
git clone https://github.com/interuseration-sckur/Wikist.git "$APP_DIR"
cd "$APP_DIR"
npm install --omit=dev
npm run check
mkdir -p data logs content/pages content/revisions content/deleted
```

If GitHub is slow from your server, upload a local archive to `...your-path...` and unzip it there.

#### 4. Runtime User And Environment

```bash
sudo useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin --user-group "$RUN_USER" || true
sudo chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"
sudo mkdir -p "$(dirname "$ENV_FILE")"
openssl rand -hex 32
sudo nano "$ENV_FILE"
```

Environment file:

```ini
NODE_ENV=production
WIKIST_HOST=127.0.0.1
WIKIST_PORT=8899
WIKIST_PASSPORT_SECRET=replace-with-a-long-random-secret
```

Optional edit token:

```ini
WIKIST_EDIT_TOKEN=replace-with-an-edit-token
```

Keep `WIKIST_PASSPORT_SECRET` stable after users exist.

#### 5. systemd Service

```bash
sudo nano /etc/systemd/system/wikist.service
```

Replace `...your-path...` with your real paths:

```ini
[Unit]
Description=Wikist Wiki Service
After=network.target

[Service]
Type=simple
User=wikist
Group=wikist
WorkingDirectory=...your-path.../wikist
EnvironmentFile=...your-path.../wikist.env
ExecStart=/usr/bin/node ...your-path.../wikist/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable wikist
sudo systemctl start wikist
sudo systemctl status wikist
curl http://127.0.0.1:8899/install.html
```

#### 6. Nginx Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/wikist
```

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name wiki.example.com;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8899;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -sf /etc/nginx/sites-available/wikist /etc/nginx/sites-enabled/wikist
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Open:

```text
http://wiki.example.com/install.html
```

#### 7. HTTPS

```bash
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx -d wiki.example.com
sudo certbot renew --dry-run
```

Then open:

```text
https://wiki.example.com/install.html
```

#### 8. Initialize Wikist

Before initialization, Wikist redirects normal homepage access to `/install.html`. The installer writes `config/site.config.json`.

Recommended values:

- Site name, language, license, and tagline.
- SQLite path: `data/wikist.sqlite`.
- Editing policy: login-required editing for production.
- SMTP: optional at first, useful for email verification and password recovery.
- Public base URL: `https://wiki.example.com`.

Restart after installation:

```bash
sudo systemctl restart wikist
```

After restart, open the homepage. If no administrator exists, Wikist shows the first-admin setup screen. The first account automatically receives the `admin` role and can enter the admin console, create pages, manage users, configure plugins, and run backups.

#### 9. Backups

Back up:

- `...your-path.../wikist/content/`
- `...your-path.../wikist/data/`
- `...your-path.../wikist/config/site.config.json`
- `...your-path.../wikist.env`

Example:

```bash
sudo mkdir -p "$BACKUP_DIR"
sudo tar -czf "$BACKUP_DIR/wikist-$(date +%F).tar.gz" \
  -C "$APP_DIR" content data config/site.config.json \
  -C "$(dirname "$ENV_FILE")" "$(basename "$ENV_FILE")"
```

#### 10. Updates

```bash
cd "$APP_DIR"
sudo systemctl stop wikist
sudo -u "$RUN_USER" git pull --ff-only
npm install --omit=dev
npm run check
sudo systemctl start wikist
```

When updating from an uploaded archive, back up `content/`, `data/`, `config/site.config.json`, and the environment file first. Do not overwrite runtime data.

#### 11. Customization

You can customize:

- Project directory: `...your-path.../wikist`
- Environment file: `...your-path.../wikist.env`
- Backup directory: `...your-path.../wikist-backups`
- SQLite path: a project-relative path such as `data/wikist.sqlite`
- Listen port: `WIKIST_PORT`
- Reverse proxy: Nginx, Caddy, Traefik, or a cloud gateway
- HTTPS: Certbot, cloud certificates, or Caddy automation
- Mail: SMTP from the installer or admin settings
- Assets: CDN base, custom CSS, and custom JS from admin settings
- Plugins: `plugins/*/plugin.json`, with reviewed vendor source in local `plugins/vendor/`

### Deployment Troubleshooting

**`curl http://127.0.0.1:8899/install.html` works, but public IP access fails.**

Wikist listens on localhost by default. Access Nginx on `80/443` instead: `http://your-domain/install.html` or `https://your-domain/install.html`. Check cloud firewall and server firewall rules.

**Direct `http://public-ip:8899` access is needed for a quick test.**

Temporarily set `WIKIST_HOST=0.0.0.0` and open `8899`, but switch back to `127.0.0.1` behind HTTPS for production.

**Nginx returns 502.**

Check `sudo systemctl status wikist`, test `curl http://127.0.0.1:8899/install.html`, then inspect `journalctl -u wikist -f`.

**`node:sqlite` is missing.**

Use Node.js 24 LTS or at least Node.js 22.5.0+ with the module included.

**The installer still appears after installation.**

Restart Wikist: `sudo systemctl restart wikist`. The running process does not load the generated config until restart.

**No administrator exists after installation.**

After restart, open the homepage. Wikist will show the first-admin setup page. The first account becomes `admin`. If you migrated data, check whether `data/wikist.sqlite` already contains users.

**Configuration, database, or pages cannot be written.**

Ensure `...your-path.../wikist` and especially `config/`, `data/`, and `content/` are writable by the runtime user.

**Domain access fails.**

Check DNS A record, cloud firewall `80/443`, Nginx `server_name`, and whether Nginx was reloaded.

**HTTPS issuance fails.**

The domain must already resolve to this server, and public HTTP `80` must be reachable before certificate issuance.

**SMTP fails.**

Check host, port, username, app password or authorization code, and sender address. Many mail providers do not allow the normal login password for SMTP.

**GitHub cloning is slow or blocked.**

Upload a local archive to `...your-path...`, unzip it, install dependencies, and restart Wikist.

### Changelog

See [CHANGELOG.md](CHANGELOG.md).
