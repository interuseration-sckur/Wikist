# Wikist 安装与迁移

## 首次安装

1. 安装 Node.js 18 或更高版本。
2. 解压或克隆 Wikist 到服务器目录。
3. 在项目根目录运行 `node server.js`，或 Windows 下运行 `run-wikist-server.cmd`。
4. 打开 `http://你的域名:8899/install.html`，填写站点名称、SQLite 相对路径、编辑策略和可选 SMTP 参数。
5. 页面提示成功后停止并重新启动服务。

安装器会写入 `config/site.config.json`。用户、会话、评论、评分和审计日志存放在该配置指定的 SQLite 文件中，默认是 `data/wikist.sqlite`。

## 迁移

迁移时复制以下目录和文件：

- `content/`
- `data/`
- `config/site.config.json`
- `plugins/`（包含自制插件与 vendor 依赖）
- `public/assets/`（包含本地界面资源）

在新机器安装 Node.js 后运行 `node server.js` 即可。数据库路径必须保持为项目目录内的相对路径；这是为了让整站复制、备份与回档保持一致。

## 重新配置

已完成配置的站点会锁定安装器，避免公开入口覆盖现有数据。如确有维护需要，临时设置环境变量后重启：

```powershell
$env:WIKIST_INSTALL_MODE = "1"
node server.js
```

随后重新打开 `/install.html`。该操作会覆盖基础站点配置，不会删除 SQLite 数据库或词条文件；重配前仍建议先使用后台“全站备份”。完成后移除该环境变量并重启。

## Windows 启动

`run-wikist-server.cmd` 与 `tools/run-wikist-server.cmd` 会以当前项目目录为根目录启动服务。它们会优先使用系统 Node.js，其次寻找 `runtime/node/node.exe`，并校验 Node 主版本不低于 18。

默认端口是 `8899`，不会自动改用其他端口。若该端口上运行的是旧版 Wikist，可显式重启它：

```powershell
.\run-wikist-server.cmd --restart
```

启动器会先确认端口响应的是 Wikist，再停止旧实例并以新代码重新监听同一端口。若端口被其他程序占用，启动器会拒绝结束它。若确实要固定使用另一端口，可在启动前设置：

```powershell
$env:WIKIST_PORT = "9000"
.\run-wikist-server.cmd
```

对外部署时可额外设置 `WIKIST_HOST=0.0.0.0`，并通过反向代理提供 HTTPS。
