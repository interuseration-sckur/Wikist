# Wikist 安装、配置与升级指南

本文面向本地试用、Ubuntu 单机生产部署、宝塔/Nginx 反向代理和既有站点升级。生产环境推荐使用“Webman 公共入口 + Node 兼容层 + Centrifugo 实时传输”的统一进程组，不要分别手工启动三套服务。

## 1. 运行组成

| 组件 | 默认监听 | 是否公开 | 用途 |
| --- | --- | --- | --- |
| Webman | `127.0.0.1:8899` | 通过 HTTPS 反向代理 | 页面、Passport、API 和业务权限 |
| Node 兼容层 | `127.0.0.1:8900` | 否 | 尚在迁移期的兼容 API |
| Centrifugo | `127.0.0.1:8902` | 仅代理 WebSocket 路径 | 消息、通知、在线状态和实时事件 |

数据库、消息、用户、权限和通知均由 Wikist 保存。Centrifugo 只传输已授权事件，`8902/api` 不得暴露到公网。

## 2. 环境要求

- Ubuntu 22.04 或 24.04；Windows 可用于本地开发。
- PHP `8.4.1+`，启用 PDO、SQLite、mbstring、OpenSSL、cURL、GD、intl、XML、ZIP；生产环境启用 OPcache。
- Node.js `22.5+`，必须支持 `node:sqlite`。
- Composer 2、Git、Nginx 或 Caddy。
- 一个已解析到服务器的域名及有效 HTTPS 证书。
- 单机 SQLite 部署默认使用一个 Webman 写入进程；不要把同一 SQLite 文件挂载给多台服务器同时写入。

## 3. Ubuntu 推荐安装

建议把核心程序放在 `/opt/wikist`：

```bash
sudo git clone https://github.com/interuseration-sckur/Wikist.git /opt/wikist
cd /opt/wikist
sudo bash tools/install-ubuntu.sh --public-url=https://wiki.example.com
```

脚本会完成：

1. 安装并校验 Node.js、PHP 扩展和项目私有 Composer。
2. 安装依赖并准备 Centrifugo。
3. 创建 `wikist` 服务账号和受限运行目录。
4. 生成 `/etc/wikist/wikist.env` 与 `wikist.service`。
5. 初始化数据库迁移并启动统一进程组。

安装结束后访问 `https://wiki.example.com/install.html`，按照页面创建站点资料和首位管理员。公开注册不会自动获得管理员权限。

### 自定义服务用户

```bash
sudo bash tools/install-ubuntu.sh \
  --public-url=https://wiki.example.com \
  --user=wikist
```

除非明确暂不需要消息实时传输，否则不要使用 `--no-realtime`。

## 4. 手动安装

```bash
git clone https://github.com/interuseration-sckur/Wikist.git
cd Wikist
npm ci
composer install --working-dir=webman-backend --no-dev --optimize-autoloader
npm run setup:stack
npm start
```

本地访问 `http://127.0.0.1:8899/install.html`。生产环境不要长期用 `npm start` 或 `root` 保持前台进程，应安装 systemd 服务：

```bash
npm run service:install -- \
  --public-url=https://wiki.example.com \
  --user=wikist
```

先检查 `data/deployment/` 中生成的环境、systemd 和代理样例，再应用：

```bash
sudo npm run service:install -- \
  --public-url=https://wiki.example.com \
  --user=wikist \
  --apply --yes
```

服务安装器会接管以下运行目录中的既有文件，避免从旧版或 root 启动迁移后出现 `EACCES`：

```text
data/
content/
config/
logs/
plugins/vendor/
public/uploads/
webman-backend/runtime/
```

敏感环境和实时配置使用 `0600`/`0640`，不要执行 `chmod -R 777`。

## 5. Nginx 配置

普通页面和 API 代理到 Webman；WebSocket 必须使用精确路由代理到 Centrifugo：

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name wiki.example.com;

    # 配置 ssl_certificate 与 ssl_certificate_key。

    location = /connection/websocket {
        proxy_pass http://127.0.0.1:8902;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache off;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:8899;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

`/connection/websocket` 若落入 `location /`，浏览器会持续显示“正在恢复实时连接”，公网握手会收到带 `X-Wikist-Backend: webman` 的 `404`。

### 宝塔面板

宝塔站点通常包含：

```nginx
include /www/server/panel/vhost/nginx/extension/wiki.example.com/*.conf;
include /www/server/panel/vhost/nginx/proxy/wiki.example.com/*.conf;
```

可以把上面的 WebSocket `location` 保存到：

```text
/www/server/panel/vhost/nginx/extension/wiki.example.com/wikist-realtime.conf
```

也可以让修复工具生成、校验并热重载该片段：

```bash
cd /opt/wikist
sudo npm run repair:production -- \
  --public-url=https://wiki.example.com \
  --service=wikist \
  --nginx-include=/www/server/panel/vhost/nginx/extension/wiki.example.com/wikist-realtime.conf
```

不要把 `/health`、`/api`、`8900` 或完整 `8902` 代理到公网。

## 6. 生产环境配置

systemd 的权威环境文件是 `/etc/wikist/wikist.env`。常用配置如下：

| 配置 | 示例 | 说明 |
| --- | --- | --- |
| `APP_URL` | `https://wiki.example.com` | 站点规范地址 |
| `WIKIST_PUBLIC_URL` | 同上 | 浏览器公共地址 |
| `TRUSTED_ORIGINS` | 同上 | 允许的浏览器来源，禁止通配符 |
| `WEBMAN_HOST` | `127.0.0.1` | 生产环境保持回环 |
| `WEBMAN_PORT` | `8899` | Webman 入口 |
| `LEGACY_NODE_URL` | `http://127.0.0.1:8900` | Node 兼容层，仅内部使用 |
| `CENTRIFUGO_ENABLED` | `true` | 启用实时传输 |
| `CENTRIFUGO_PUBLIC_URL` | `wss://wiki.example.com/connection/websocket` | 浏览器 WebSocket 地址 |
| `CENTRIFUGO_API_URL` | `http://127.0.0.1:8902/api` | Webman 发布接口，仅内部使用 |
| `SESSION_SECURE` | `true` | HTTPS Cookie |

`APP_SECRET`、`LEGACY_NODE_TOKEN`、`CENTRIFUGO_API_KEY` 和 `CENTRIFUGO_TOKEN_HMAC_SECRET` 必须使用安装器生成的独立随机值，不要复制到工单、日志或公开仓库。systemd 启动时不会再回写项目中的 `.env`。

### 站点初始化清单

完成网页安装后，建议按顺序设置：

1. 在“站点设置”填写站点标题、简介、规范公共地址、默认语言和版权信息。
2. 在“邮件设置”填写 SMTP 主机、端口、加密方式、发件账号和发件名称，发送测试邮件后再开放注册。
3. 在“用户组与权限”确认管理员、审阅者、资深编辑和普通用户权限，不要把后台权限授予默认用户组。
4. 在“首页内容”配置特色词条、资讯和数学进展；在“站点导航”只保留常用功能入口。
5. 在“搜索索引”检查 FTS5 状态并执行一次索引健康检查。
6. 在“全站备份”生成、下载并验证第一份备份，再开始批量导入内容。

SMTP 常见组合：端口 `465` 使用隐式 TLS，端口 `587` 使用 STARTTLS。生产环境不要关闭证书校验，也不要把邮箱密码写入 README、提交记录或聊天日志。

### CDN 与反向代理

- CDN 回源必须保留 `Host` 和 HTTPS 协议信息，WebSocket 路径必须允许 Upgrade。
- 不缓存 `/api/`、`/passport`、`/install.html`、`/connection/websocket` 和带登录 Cookie 的响应。
- 静态资源可按文件指纹缓存；升级后应清理 CDN 缓存。
- 若 CDN 不支持 WebSocket，先绕过 `/connection/websocket`，不要让前端长期退化为轮询。

修改域名时不要逐个编辑文件，使用：

```bash
npm run migrate:server -- \
  --public-url=https://new-wiki.example.com \
  --mode=single-production --yes

sudo npm run service:install -- \
  --public-url=https://new-wiki.example.com \
  --user=wikist --apply --yes
```

## 7. 上线验收

```bash
cd /opt/wikist
sudo npm run doctor:production -- \
  --public-url=https://wiki.example.com \
  --service=wikist
```

检查内容包括：

- systemd 服务与实际运行账号；
- 数据、词条、配置、上传和运行目录可读写性；
- Centrifugo 栈、配置和 systemd 密钥一致性；
- `8899`、`8900`、`8902` 三个回环监听；
- 本地与公网 WebSocket `101 Switching Protocols`；
- 活跃 Nginx 配置中的精确实时路由。

还应执行：

```bash
npm run doctor -- --all
npm run status
sudo systemctl status wikist --no-pager -l
```

## 8. 升级

升级前在后台生成并下载一次全站备份，然后执行不会停止服务的预检：

```bash
npm run update -- --preflight-only --yes
```

Git 部署：

```bash
npm run update -- \
  --strategy=git \
  --remote=origin \
  --branch=main \
  --service=wikist \
  --yes
```

需要保留本地改动时加入 `--stash-dirty`。发布包部署使用：

```bash
npm run update -- \
  --strategy=local \
  --source=/path/to/extracted-wikist-release \
  --service=wikist \
  --yes
```

升级器会保护 `config/site.config.json`、数据库、词条、修订、归档、日志、上传和本地插件数据，并在停止写入前完成预检与恢复点创建。完成后执行：

```bash
npm run doctor -- --all
sudo npm run doctor:production -- --public-url=https://wiki.example.com --service=wikist
```

## 9. 迁移与恢复

迁移服务器时复制：

```text
content/
data/
config/site.config.json
plugins/vendor/ 及自制插件
public/uploads/
```

不要复制旧机器的 PID 文件后直接启动。新机器准备运行时后重新执行 `setup:stack`、数据库迁移和 `service:install`。域名改变时执行 `migrate:server`。

生产修复工具会在修改前把环境、站点、栈和实时配置保存到 `data/production-repairs/<UTC 时间>/`。完整备份仍应使用后台“全站备份”；修复快照只用于配置级回退。

### 防火墙与最小暴露

以 UFW 为例，只开放 SSH 与 Web 端口：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

不要开放 `8899`、`8900`、`8902`。确认它们仅绑定回环地址：

```bash
sudo ss -ltnp | grep -E ':(8899|8900|8902)\b'
```

备份至少保留一份服务器外副本。每次大版本升级前做一次恢复演练，确认数据库、词条、上传文件、插件配置和站点密钥能一并恢复。

## 10. Windows 本地启动

```powershell
.\run-wikist-server.cmd --setup
.\run-wikist-server.cmd
.\run-wikist-server.cmd --status
.\run-wikist-server.cmd --restart
.\run-wikist-server.cmd --stop
```

默认端口固定为 `8899`。若 PID 记录缺失但端口仍被其他程序占用，启动器会拒绝结束未知进程。确需改端口时设置 `WIKIST_PORT`，不要依赖自动换端口。

## 11. 延伸文档

- [生产部署故障排查](PRODUCTION_TROUBLESHOOTING.md)
- [统一实时消息](REALTIME_MESSAGING.md)
- [升级日志](UPGRADE_CHANGELOG.md)
- [安全加固验收](HARDENING_ACCEPTANCE_2026-08-16.md)
