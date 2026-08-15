# Wikist 安装与迁移

## 首次安装

1. 安装 Node.js 18 或更高版本、PHP 8.1 或更高版本；准备 Composer。Windows 便携运行时也可放入 `.runtime/php` 与 `.runtime/composer`。
2. 解压或克隆 Wikist 到服务器目录。
3. 将 Centrifugo 可执行文件放入 `.runtime/centrifugo/`，然后运行 `npm run setup:stack`；也可以直接执行 `npm start` 让启动器自动初始化。
4. 运行 `npm start`；Windows 也可直接运行 `run-wikist-server.cmd`，缺少栈配置时它会自动初始化。
5. 打开 `http://你的域名:8899/install.html`，填写站点名称、SQLite 相对路径、编辑策略和可选 SMTP 参数。
6. 页面提示成功后执行 `npm stop`，再用相同统一入口启动。

统一进程组包含 Webman `8899`、Node 兼容层 `8900` 和 Centrifugo `8902`。生产反向代理只应指向 Webman 公共端口，另外两个端口保持回环或内网可见。

`npm run setup:stack` 可安全重复执行：它会保留已有 Centrifugo 密钥和端口，并刷新本地实时通信配置。生成的私钥位于 `data/`，不得提交到 Git。

安装器会写入 `config/site.config.json`。用户、会话、评论、评分和审计日志存放在该配置指定的 SQLite 文件中，默认是 `data/wikist.sqlite`。

通过反向代理安装时建议转发 `Host $http_host` 与 `X-Forwarded-Host $http_host`，但安装校验不依赖外部域名与内部 Host 相等，因此兼容 Docker、面板代理和隧道。安全边界由短时安装令牌、客户端绑定与浏览器跨站标记承担。默认安装保护允许十分钟内 60 次安装页/API 请求，触发后冷却 60 秒。

## 迁移

迁移时复制以下目录和文件：

- `content/`
- `data/`
- `config/site.config.json`
- `plugins/`（包含自制插件与 vendor 依赖）
- `public/assets/`（包含本地界面资源）

在新机器准备 Node.js、PHP、Composer 与 Centrifugo 运行时后，执行 `npm run setup:stack` 和 `npm start`。数据库路径必须保持为项目目录内的相对路径；这是为了让整站复制、备份与回档保持一致。

## 重新配置

已完成配置的站点会锁定安装器，避免公开入口覆盖现有数据。如确有维护需要，临时设置环境变量后重启：

```powershell
$env:WIKIST_INSTALL_MODE = "1"
npm start
```

随后重新打开 `/install.html`。该操作会覆盖基础站点配置，不会删除 SQLite 数据库或词条文件；重配前仍建议先使用后台“全站备份”。完成后移除该环境变量并重启。

## Windows 启动

`run-wikist-server.cmd` 与 `tools/run-wikist-server.cmd` 会以当前项目目录为根目录启动全部服务。它们会优先使用系统 Node.js，其次寻找 `runtime/node/node.exe`，并校验 Node 主版本不低于 18。

支持的统一管理命令：

```powershell
.\run-wikist-server.cmd --setup
.\run-wikist-server.cmd --status
.\run-wikist-server.cmd --stop
.\run-wikist-server.cmd --restart
```

默认端口是 `8899`，不会自动改用其他端口。若该端口上运行的是旧版 Wikist，可显式重启它：

```powershell
.\run-wikist-server.cmd --restart
```

启动器只会结束 `data/wikist-hybrid.pid.json` 中属于当前项目的完整进程组，再以新代码监听同一组端口；不会按端口猜测或结束其他程序。PID 记录缺失而端口仍被占用时，启动器会拒绝启动。若确实要固定使用另一端口，可在启动前设置：

```powershell
$env:WIKIST_PORT = "9000"
.\run-wikist-server.cmd
```

对外部署时可额外设置 `WIKIST_HOST=0.0.0.0`，并通过反向代理提供 HTTPS。
