# Wikist 生产部署故障排查

本手册用于 Ubuntu/systemd/Nginx 部署。先确认最新一条错误，不要把同一段日志中较早的重启记录当成当前故障。

## 一键诊断与修复

只检查，不修改：

```bash
cd /opt/wikist
sudo npm run doctor:production -- \
  --public-url=https://wiki.example.com \
  --service=wikist
```

自动修复运行目录所有权、环境与实时密钥一致性，并重启服务：

```bash
sudo npm run repair:production -- \
  --public-url=https://wiki.example.com \
  --service=wikist
```

宝塔站点可同时安装 WebSocket 路由：

```bash
sudo npm run repair:production -- \
  --public-url=https://wiki.example.com \
  --service=wikist \
  --nginx-include=/www/server/panel/vhost/nginx/extension/wiki.example.com/wikist-realtime.conf
```

修复前快照写入 `data/production-repairs/`。工具不会打印任何密钥，也不会自动公开 Centrifugo API。
标准 Nginx 与宝塔 `/www/server/nginx/sbin/nginx` 均可识别；配置测试失败时会恢复原片段，只有 `nginx -t` 通过后才会热重载。

## 获取有效日志

```bash
sudo systemctl status wikist --no-pager -l
sudo journalctl -u wikist -n 100 --no-pager -o cat
npm run status
npm run config:show
```

服务反复重启时先停止，再检查权限，避免旧错误与新错误交错：

```bash
sudo systemctl stop wikist
sudo systemctl reset-failed wikist
```

不要粘贴 `/etc/wikist/wikist.env`、`webman-backend/.env` 或 Centrifugo 配置全文。

## `Wikist stack is not running`

这是结果，不是根因。继续读取 journal 中它之前的第一条 `Error:`。统一启动器只有在 Webman、Node 兼容层和已启用的 Centrifugo 均成功监听后才会写入运行状态。任一子进程退出都会关闭整组服务。

## 读取 `.env` 或 `site.config.json` 时 `EACCES`

```text
EACCES: permission denied, open '/opt/wikist/webman-backend/.env'
EACCES: permission denied, open '/opt/wikist/config/site.config.json'
```

常见原因是早期以 root 启动或解压，既有文件仍归 root 所有，而 systemd 使用独立服务用户。优先运行 `repair:production`。

查看路径中每一级权限：

```bash
namei -l /opt/wikist/config/site.config.json
sudo systemctl show wikist -p User -p Group -p ReadWritePaths -p ProtectSystem
```

不要使用 `chmod -R 777`，它会让数据库、Session、密钥和上传目录暴露给不相关用户。

## 写入 `.env.<pid>.tmp` 时 `EROFS`

```text
EROFS: read-only file system, open '/opt/wikist/webman-backend/.env.<pid>.tmp'
```

`ProtectSystem=strict` 正在正常保护源码目录。正确修复是升级启动器：systemd 下以 `/etc/wikist/wikist.env` 为权威配置，不允许启动过程回写源码目录。不要把整个 `webman-backend/` 加入 `ReadWritePaths`。

更新后重新安装服务配置：

```bash
sudo npm run service:install -- \
  --public-url=https://wiki.example.com \
  --user=wikist --apply --yes
```

## Node 兼容层 `8900` 等待超时

```text
Node compatibility service did not begin listening on 127.0.0.1:8900
```

它通常是上游错误的连锁结果。检查同一轮启动中更早的 Node 异常，例如配置不可读、数据库不可写或端口占用。不要只延长等待时间。

```bash
sudo ss -ltnp | grep -E ':(8899|8900|8902)\b'
sudo journalctl -u wikist -n 100 --no-pager -o cat
```

## 浏览器持续“正在恢复实时连接”

先测试 Centrifugo 本地握手：

```bash
curl --http1.1 --max-time 4 -i -N \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Origin: https://wiki.example.com' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  http://127.0.0.1:8902/connection/websocket
```

再测试公网：

```bash
curl --http1.1 --max-time 4 -i -N \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Origin: https://wiki.example.com' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://wiki.example.com/connection/websocket
```

`101 Switching Protocols` 后 curl 超时是正常的，表示 WebSocket 保持打开。

### 本地 101，公网 404

若公网响应包含 `X-Wikist-Backend: webman` 和 `not_found`，说明 `/connection/websocket` 被通用 `location /` 转发到了 Webman。必须在 HTTPS `server` 中加入精确路由：

```nginx
location = /connection/websocket {
    proxy_pass http://127.0.0.1:8902;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 两边均 101，浏览器仍失败

检查浏览器开发者工具“网络”：

- `POST /api/messaging/realtime/token` 应返回 `200`。
- `/connection/websocket` 应显示 `101`。
- 页面来源必须与 `TRUSTED_ORIGINS` 一致。

再运行生产诊断，确认 `realtime.token_secret` 和 `realtime.api_key` 均为 `OK`。它们不一致时，Webman 签发的 JWT 无法被 Centrifugo 验证。

## `/health` 返回 404

Centrifugo 健康路由需要在生成配置中启用。新版 `setup:stack` 默认写入 `health.enabled=true`：

```bash
npm run setup:stack -- --no-download
sudo systemctl restart wikist
curl -i http://127.0.0.1:8902/health
```

健康路由只用于服务器内部探针，不要通过 Nginx 暴露。即使旧配置返回 404，只要 WebSocket 本地握手返回 101，实时监听仍可能正常。

## Nginx 返回 502

先判断 8899 是否监听：

```bash
sudo ss -ltnp | grep ':8899\b'
sudo systemctl status wikist --no-pager -l
```

未监听时修复 Wikist 服务，不要先修改 Nginx。已监听时检查代理目标是否仍是 `127.0.0.1:8899`，并执行 `nginx -t`。

## 更新后页面仍旧

```bash
npm run status
sudo systemctl restart wikist
```

随后清理 CDN 缓存并强制刷新浏览器。不要修改 Git tag 指向，也不要只覆盖 `public/assets` 而跳过后端、迁移和版本清单。

## 安全边界

- 公网只开放 80/443。
- `8899`、`8900`、`8902` 保持回环监听。
- 只代理 `/connection/websocket`，不代理 Centrifugo `/api` 与 `/health`。
- systemd 保留 `ProtectSystem=strict` 和 `NoNewPrivileges=true`。
- 运行数据由服务账号拥有，核心源码无需可写。
- 故障日志只提供错误、状态和脱敏检查结果，不提供密钥文件全文。

## 修复后验收

```bash
sudo npm run doctor:production -- \
  --public-url=https://wiki.example.com \
  --service=wikist

npm run doctor -- --all
npm run status
```

最终应满足：systemd 为 `active`，三个内部端口均监听，本地和公网 WebSocket 均为 101，浏览器显示“实时已连接”。
