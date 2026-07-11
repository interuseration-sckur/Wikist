# Wikist

[中文](#中文) | [English](#english)

---

## 中文

Wikist 是一个面向中文数学与科学知识共同体的轻量级 Wiki 框架。它以 Markdown 文件为核心内容格式，以 SQLite 承载账号、评论、权限、审计与协作数据，目标是在保持可迁移、可审查、可部署的基础上，提供比传统 Wiki 更适合数学表达、可视化建模和现代浏览器交互的知识平台。

发布日期：2026-07-10
最近更新：2026-07-11

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
- **科幻控制台界面**：首页和 Wikist Passport 融入代码窗口、贡献矩阵、知识活跃度和安全信号等 GitHub 式信息层级，既保留专业感，也提升登录注册与首屏识别度。
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

### 本地运行与调试

本地开发或预览时，推荐直接在你的本地运行目录启动服务：

```powershell
cd ...你的路径...\wikist
node server.js
```

访问：

```text
http://127.0.0.1:8899/
http://127.0.0.1:8899/#/login
http://127.0.0.1:8899/#/register
```

本地调试新版 UI 时，建议临时关闭 `config/site.config.json` 里的 `assets.cdnBase`，让浏览器直接加载本地 `/assets/app.js` 和 `/assets/styles.css`。如果 `assets.cdnBase` 指向 CDN，但 CDN 没有同步当前版本资源，例如 `wikist-core-20260711-49`，浏览器会继续加载旧资源或得到 404，看起来就像本地没有任何变化。

本地确认命令：

```powershell
curl http://127.0.0.1:8899/
curl http://127.0.0.1:8899/assets/app.js?v=wikist-core-20260711-49
curl http://127.0.0.1:8899/assets/styles.css?v=wikist-core-20260711-49
```

如果修改了 `config/site.config.json`、服务端代码或资源版本号，重启本地服务后再刷新浏览器。浏览器仍不变时，使用强制刷新或清理站点缓存。

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
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

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
- `...你的路径.../wikist/public/uploads/`
- `...你的路径.../wikist.env`

示例：

```bash
sudo mkdir -p "$BACKUP_DIR"
sudo tar -czf "$BACKUP_DIR/wikist-$(date +%F).tar.gz" \
  -C "$APP_DIR" content data config/site.config.json \
  -C "$(dirname "$ENV_FILE")" "$(basename "$ENV_FILE")"
```

#### 10. 更新

Wikist 提供类似 MediaWiki `update.php` 思路的维护脚本：

```bash
node tools/update.js --help
```

它会按顺序执行：

- 可选停止 systemd 服务。
- 生成升级前备份到 `data/backups/`。
- 按策略同步最新核心代码。
- 执行 `npm install --omit=dev`。
- 执行 `npm run check`。
- 写入升级报告到 `data/updates/latest.json`。
- 可选重新启动 systemd 服务。

如果你的云端还是旧版本，还没有 `tools/update.js`，先手动拉取一次：

```bash
cd "$APP_DIR"
sudo systemctl stop wikist
sudo -u "$RUN_USER" git fetch origin main
sudo -u "$RUN_USER" git merge --ff-only origin/main
npm install --omit=dev
npm run check
sudo systemctl start wikist
```

之后日常更新可以使用 Git 策略：

```bash
cd "$APP_DIR"
sudo node tools/update.js --strategy=git --remote=origin --branch=main --service=wikist --yes
```

升级到 `2026-07-11` 或更新版本后，核心前端资源版本应变为 `wikist-core-20260711-49`。如果你使用了 CDN、对象存储或浏览器强缓存，更新后建议清理 CDN 缓存，或在浏览器开发者工具 Network 面板确认 `/assets/app.js?v=wikist-core-20260711-49` 和 `/assets/styles.css?v=wikist-core-20260711-49` 已返回新内容。

先预演不改文件：

```bash
node tools/update.js --strategy=git --dry-run
```

如果服务器访问 GitHub 慢或失败，可以在本地下载/解压新版 Wikist，然后上传到服务器旁边，例如 `...你的路径.../wikist-release`，再使用本地包策略：

```bash
cd "$APP_DIR"
sudo node tools/update.js --strategy=local --source=...你的路径.../wikist-release --service=wikist --yes
```

本地包策略只同步核心代码和内置插件目录，默认保护：

- `data/`
- `logs/`
- `content/pages/`
- `content/revisions/`
- `content/deleted/`
- `config/site.config.json`
- `plugins/vendor/`
- `public/uploads/`
- `node_modules/`

升级失败时优先查看：

```bash
cat "$APP_DIR/data/updates/latest.json"
journalctl -u wikist -f
```

如果需要回滚站点数据，可用升级前生成的 `data/backups/wikist-pre-update-*.json.gz` 在后台“全站备份”中恢复。代码层回滚建议优先使用 Git 回到上一个稳定提交，再执行 `npm install --omit=dev` 和 `npm run check`。

如果更新时出现：

```text
fatal: detected dubious ownership in repository at '/opt/wikist'
```

这是因为使用 `sudo node tools/update.js` 时，Git 进程身份是 `root`，而仓库目录通常归 `wikist` 用户所有。新版 `tools/update.js` 会对当前命令自动加入临时 `safe.directory`，不需要污染全局 Git 配置。旧版本脚本可先临时执行：

```bash
sudo git config --global --add safe.directory /opt/wikist
```

随后重新运行更新命令。更推荐的长期方式是更新到包含该修复的新版 `tools/update.js`。

如果更新时出现：

```text
Tracked working tree changes exist. Commit/stash them first
```

说明 Git 发现仓库里的已跟踪文件被本地改过。先查看：

```bash
cd /opt/wikist
sudo git status --short
```

推荐处理顺序：

- 如果改动是误操作或升级残留，先备份需要的文件，再恢复这些代码文件。
- 如果改动是你有意修改的代码，先提交到自己的分支或 fork，再更新。
- 如果只是想先完成升级并保留现场，使用新版更新器的自动暂存：

```bash
sudo node tools/update.js --strategy=git --remote=origin --branch=main --service=wikist --stash-dirty --yes
```

`--stash-dirty` 会执行 `git stash push --include-untracked`，并把 stash 信息写入 `data/updates/latest.json`。升级完成后可查看：

```bash
sudo git stash list
sudo git stash show --stat stash@{0}
```

不要直接 `git reset --hard`，除非你已经确认这些本地改动不需要保留。

#### 11. 卸载配置与初始化回滚

当你需要重新走安装器、回滚错误站点配置、重新绑定域名/SMTP/SQLite 路径时，不要手动删除数据。推荐流程：

1. 在环境文件中临时加入：

```ini
WIKIST_INSTALL_MODE=1
```

2. 重启：

```bash
sudo systemctl restart wikist
```

3. 打开：

```text
https://wiki.example.com/install.html
```

4. 在维护区输入确认词：

```text
UNINSTALL_CONFIG
```

安装器会把 `config/site.config.json` 移动到 `data/backups/config-uninstall/`，不会删除 `content/`、`data/`、用户、评论、消息或词条。随后重启服务，站点会重新进入安装器。

如果要恢复被卸载的配置，把备份文件复制回：

```bash
cp "$APP_DIR/data/backups/config-uninstall/site.config....json" "$APP_DIR/config/site.config.json"
sudo systemctl restart wikist
```

恢复完成后移除 `WIKIST_INSTALL_MODE=1` 并再次重启，避免安装器长期处于维护模式。

#### 12. 高可自定义部署

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
- 站点图标：把图片放到 `public/uploads/` 后在后台填写 `/uploads/site-icon.png`，或填写 HTTPS 图标地址
- 插件：通过 `plugins/*/plugin.json` 管理，第三方源码缓存放在本地 `plugins/vendor/`

#### 13. 中文区访问慢与 CDN 调整

如果站点在中文区访问缓慢，常见原因是浏览器加载 MathJax、Vditor、function-plot、Chart.js、JSXGraph、OpenCC 等前端资源时跨境网络不稳定。建议优先使用配置方式调整，不要直接修改核心代码。

本地加载 CSS / JS 很快而云端需要 7-8 秒，通常不是文件本身体积问题。`app.js` 和 `styles.css` 只有数百 KB，本地 `127.0.0.1` 没有公网时延；云端慢多半来自未命中浏览器缓存、未压缩传输、Nginx/网关没有正确透传缓存头，或首屏触发了跨境 CDN 请求。

新版 Wikist 已内置这些优化：

- `/assets/` 静态资源支持 `ETag`、`Last-Modified`、`304 Not Modified`、Brotli/gzip 压缩。
- 带 `?v=wikist-core-...` 的核心 CSS / JS 使用长期缓存；升级时版本号会变化。
- `index.html` 保持 `no-cache`，保证后台配置、CDN Base 和图标变更能及时生效。
- SweetAlert2 改为首次弹窗时按需加载，不再占用首页首屏请求。
- MathJax 改为页面检测到公式后再加载，普通首页不会被数学 CDN 拖慢。
- 页面切换后的公式、插件、函数图和语言转换会合并到一次浏览器空闲任务中执行，避免同一次路由重复扫描 DOM。
- 后台控制台复用短期登录态缓存，消息徽标改为后台刷新，切换后台选项时不再被用户接口阻塞。
- `public/uploads/` 用于站点本地图标等资源，并被更新程序保护。

可选方案：

- 在安装器中填写“资源 CDN 基址”，或安装后进入后台设置里的 CDN / 自定义资源配置。
- 将常用前端资源同步到你自己的对象存储、CDN 或同机静态目录，然后把 CDN 基址改为你的域名。若 CDN Base 为 `https://你的CDN域名/wikist`，则本地资源会映射到 `/wikist/assets/...`、插件资源会映射到 `/wikist/plugins/...`，jsDelivr npm 资源会映射到 `/wikist/npm/...`。
- 对数学公式较多的站点，优先保证 MathJax CDN 可访问。
- 对可视化词条较多的站点，优先保证 function-plot、Chart.js、JSXGraph 相关资源可访问。
- 若使用 Nginx，确认没有把 `/assets/` 强制改成 `no-store`，并启用 gzip；如果由对象存储/CDN 托管静态资源，给 `/assets/`、`/plugins/`、`/uploads/` 设置合适缓存头。

排查方式：

```bash
curl -I -H "Accept-Encoding: br,gzip" https://你的域名/assets/app.js?v=wikist-core-20260711-49
curl -I https://你的CDN域名/wikist/assets/styles.css?v=wikist-core-20260711-49
journalctl -u wikist -f
```

重点看响应头里是否有 `cache-control`、`etag`、`content-encoding: br` 或 `content-encoding: gzip`。浏览器里可以打开开发者工具的 Network 面板，查看是否有 CDN 脚本长时间 pending、timeout 或 blocked。确认慢点来自 CDN 后，再替换 CDN 基址。

如果 CSS / JS 已经很快，但“切换词条、后台切换选项”仍然卡顿，继续看 Network 里的 API 耗时：`/api/pages/...`、`/api/recent`、`/api/admin/...` 如果持续很慢，通常是云服务器 CPU/磁盘 IO、SQLite 文件权限、反向代理超时或跨区网络造成；如果 API 很快但前端仍卡，请确认浏览器拿到的是 `wikist-core-20260711-49` 之后的新版前端资源。

更换站点图标：

```bash
sudo mkdir -p ...你的路径.../wikist/public/uploads
sudo cp ...你的路径.../site-icon.png ...你的路径.../wikist/public/uploads/site-icon.png
sudo chown -R wikist:wikist ...你的路径.../wikist/public/uploads
sudo systemctl restart wikist
```

然后进入后台“站点设置”，把“站点图标 URL”设置为：

```text
/uploads/site-icon.png
```

也可以直接填写 HTTPS 图标地址，例如 `https://你的CDN域名/wikist/uploads/site-icon.png`。

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
Last updated: 2026-07-11

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
- **Sci-fi console UI**: the homepage and Wikist Passport use code-window, contribution-matrix, activity-signal, and security-signal patterns inspired by GitHub-style information hierarchy.
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

### Local Run And Preview

For local development or visual verification, start Wikist from your local runtime directory:

```powershell
cd ...your-path.../wikist
node server.js
```

Then open:

```text
http://127.0.0.1:8899/
http://127.0.0.1:8899/#/login
http://127.0.0.1:8899/#/register
```

When testing a new UI locally, it is usually better to keep `assets.cdnBase` empty in `config/site.config.json` so the browser loads local `/assets/app.js` and `/assets/styles.css` directly. If `assets.cdnBase` points to a CDN that does not yet contain the current build, such as `wikist-core-20260711-49`, the browser may keep showing old assets or hit 404 responses, making it look like the local code did not change.

Useful local checks:

```powershell
curl http://127.0.0.1:8899/
curl http://127.0.0.1:8899/assets/app.js?v=wikist-core-20260711-49
curl http://127.0.0.1:8899/assets/styles.css?v=wikist-core-20260711-49
```

After changing `config/site.config.json`, server-side code, or asset version numbers, restart the local service and then hard-refresh the browser if needed.

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
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

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
- `...your-path.../wikist/public/uploads/`
- `...your-path.../wikist.env`

Example:

```bash
sudo mkdir -p "$BACKUP_DIR"
sudo tar -czf "$BACKUP_DIR/wikist-$(date +%F).tar.gz" \
  -C "$APP_DIR" content data config/site.config.json \
  -C "$(dirname "$ENV_FILE")" "$(basename "$ENV_FILE")"
```

#### 10. Updates

Wikist includes a maintenance updater inspired by MediaWiki's update workflow:

```bash
node tools/update.js --help
```

It performs:

- Optional systemd service stop.
- Pre-update backup into `data/backups/`.
- Core code synchronization according to the selected strategy.
- `npm install --omit=dev`.
- `npm run check`.
- Update report writing to `data/updates/latest.json`.
- Optional systemd service start.

If your cloud server is still on an older version without `tools/update.js`, pull it once manually:

```bash
cd "$APP_DIR"
sudo systemctl stop wikist
sudo -u "$RUN_USER" git fetch origin main
sudo -u "$RUN_USER" git merge --ff-only origin/main
npm install --omit=dev
npm run check
sudo systemctl start wikist
```

After that, use the Git strategy for routine updates:

```bash
cd "$APP_DIR"
sudo node tools/update.js --strategy=git --remote=origin --branch=main --service=wikist --yes
```

After updating to the `2026-07-11` build or later, the core frontend asset version should be `wikist-core-20260711-49`. If you use a CDN, object storage, or aggressive browser caching, purge the CDN cache or verify in the browser Network panel that `/assets/app.js?v=wikist-core-20260711-49` and `/assets/styles.css?v=wikist-core-20260711-49` are serving the new files.

Dry run:

```bash
node tools/update.js --strategy=git --dry-run
```

If GitHub access is slow or blocked, upload an extracted Wikist release directory such as `...your-path.../wikist-release`, then use the local strategy:

```bash
cd "$APP_DIR"
sudo node tools/update.js --strategy=local --source=...your-path.../wikist-release --service=wikist --yes
```

The local strategy syncs core code and built-in plugin directories while protecting:

- `data/`
- `logs/`
- `content/pages/`
- `content/revisions/`
- `content/deleted/`
- `config/site.config.json`
- `plugins/vendor/`
- `public/uploads/`
- `node_modules/`

When an update fails, inspect:

```bash
cat "$APP_DIR/data/updates/latest.json"
journalctl -u wikist -f
```

To roll back site data, restore the generated `data/backups/wikist-pre-update-*.json.gz` from the admin backup page. To roll back code, return to the previous stable Git commit, then run `npm install --omit=dev` and `npm run check`.

If the updater reports:

```text
fatal: detected dubious ownership in repository at '/opt/wikist'
```

Git is protecting a repository owned by a different user. This commonly happens when `sudo node tools/update.js` runs as `root` while `/opt/wikist` is owned by `wikist`. The newer `tools/update.js` adds a temporary `safe.directory` only for the current Git command, so global Git configuration is not polluted. For an older updater, run:

```bash
sudo git config --global --add safe.directory /opt/wikist
```

Then run the update command again. The preferred long-term fix is to update to the version of `tools/update.js` that includes this handling.

If the updater reports:

```text
Tracked working tree changes exist. Commit/stash them first
```

Git found local changes in tracked repository files. Inspect them first:

```bash
cd /opt/wikist
sudo git status --short
```

Recommended order:

- If the changes are accidental or left from a failed update, back up anything important and restore those code files.
- If the changes are intentional code changes, commit them to your own branch or fork before updating.
- If you want to finish the update while preserving the local state, use the newer updater's automatic stash mode:

```bash
sudo node tools/update.js --strategy=git --remote=origin --branch=main --service=wikist --stash-dirty --yes
```

`--stash-dirty` runs `git stash push --include-untracked` and records the stash information in `data/updates/latest.json`. After the update, inspect it with:

```bash
sudo git stash list
sudo git stash show --stat stash@{0}
```

Avoid `git reset --hard` unless you have confirmed the local changes can be discarded.

#### 11. Uninstall Config And Initialization Rollback

When you need to rerun the installer, roll back a bad site configuration, or rebind domain / SMTP / SQLite settings, do not delete runtime data manually.

1. Temporarily add this to your environment file:

```ini
WIKIST_INSTALL_MODE=1
```

2. Restart:

```bash
sudo systemctl restart wikist
```

3. Open:

```text
https://wiki.example.com/install.html
```

4. In the maintenance section, enter:

```text
UNINSTALL_CONFIG
```

The installer moves `config/site.config.json` into `data/backups/config-uninstall/`. It does not delete `content/`, `data/`, users, comments, messages, or articles. Restart the service and the site will enter the installer again.

To restore an uninstalled config:

```bash
cp "$APP_DIR/data/backups/config-uninstall/site.config....json" "$APP_DIR/config/site.config.json"
sudo systemctl restart wikist
```

Remove `WIKIST_INSTALL_MODE=1` and restart again after maintenance.

#### 12. Customization

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
- Site icon: place a file in `public/uploads/` and set `/uploads/site-icon.png` in admin settings, or use an HTTPS icon URL
- Plugins: `plugins/*/plugin.json`, with reviewed vendor source in local `plugins/vendor/`

### Deployment Troubleshooting

**`curl http://127.0.0.1:8899/install.html` works, but public IP access fails.**

Wikist listens on localhost by default. Access Nginx on `80/443` instead: `http://your-domain/install.html` or `https://your-domain/install.html`. Check cloud firewall and server firewall rules.

**Direct `http://public-ip:8899` access is needed for a quick test.**

Temporarily set `WIKIST_HOST=0.0.0.0` and open `8899`, but switch back to `127.0.0.1` behind HTTPS for production.

**Nginx returns 502.**

Check `sudo systemctl status wikist`, test `curl http://127.0.0.1:8899/install.html`, then inspect `journalctl -u wikist -f`.

**CSS / JS is fast locally but slow on the cloud server.**

Localhost hides latency. On a public server, repeated uncached transfers, missing compression, proxy header overrides, or slow external CDNs become visible. Current Wikist emits `ETag`, `Last-Modified`, versioned long-cache headers, and Brotli/gzip for static assets. Verify:

```bash
curl -I -H "Accept-Encoding: br,gzip" https://your-domain/assets/app.js?v=wikist-core-20260711-49
```

Look for `cache-control`, `etag`, and `content-encoding`. If you set a CDN Base, mirror local assets under `/assets/...`, plugin assets under `/plugins/...`, and jsDelivr-compatible packages under `/npm/...`.

For page or admin-tab switching lag, the current frontend batches math rendering, plugin hydration, function plots, and language conversion into one idle post-render task. Admin pages also reuse a short-lived user-session cache and refresh message badges in the background. If switching still feels slow after updating, inspect `/api/pages/...`, `/api/recent`, and `/api/admin/...` timings in Network; persistent API latency usually points to server CPU, disk IO, SQLite permissions, reverse-proxy timeout, or cross-region network issues.

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
