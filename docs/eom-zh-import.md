# EoM 中文语料最终化与导入

本文只描述已经完成翻译和审校的 EoM 中文语料如何生成最终包并导入 Wikist。`work/body-output` 是翻译中间数据，不能直接导入页面数据库。

## 发布边界

标准链路如下：

1. 完成正文输出审计，并把仍需人工判断的条目标记为 `needsReview=true` 且填写 `issues`。
2. 使用 `eom-zh-package.js` 从最新全局标题表、正文输入和正文输出生成独立发布目录。
3. 只有 `manifest.json` 中 `status="ready"`、计数完整且 `checksums.sha256` 全部匹配的发布包可进入导入器。
4. 使用 `eom-zh-import.js` 在 Wikist 主机本地通过 `PageStore` 导入。真实导入时必须停止 Wikist 服务。

发布包只包含：

```text
<package>/
  build-state.json
  manifest.json
  checksums.sha256
  pages/00000001.json
  ...
```

`pages/*.json` 是最终验证通过的 `wikist-page` 包。`build-state.json` 仅供打包断点恢复，不会被导入。导入器拒绝 `building` 包、待审条目、未列入清单的页面、校验和错误、残留 protected token，以及旧式 `--source` 翻译目录。

## Windows 打包

先做只读计划；路径由调用方指定，不存在 G 盘默认值：

```powershell
node tools/eom-zh-package.js `
  --root="D:\corpus\wikist-zh" `
  --package="D:\releases\eom-zh-2026-08" `
  --batch-size=250 `
  --dry-run
```

确认后分批执行。重复同一命令会读取 `build-state.json` 并继续；未全部完成时状态是 `building`，进程退出码为 2，这是“尚未 ready”而不是已写页面损坏：

```powershell
node tools/eom-zh-package.js `
  --root="D:\corpus\wikist-zh" `
  --package="D:\releases\eom-zh-2026-08" `
  --batch-size=250
```

标题表或已经入包的输出发生变化时，工具会拒绝在旧发布目录继续写入。此时应使用新的 `--package` 目录，不能手工改动既有 ready 包。

语料尚未齐备时，只可用明确 ID 做隔离解析验证，不要生成或导入全量包：

```powershell
node tools/eom-zh-package.js `
  --root="D:\corpus\wikist-zh-sample" `
  --package="D:\scratch\eom-zh-sample-package" `
  --ids=200,224 `
  --dry-run
```

## Windows 本地导入

先校验完整发布包并查看本批动作。dry-run 不创建导入状态、不保存页面，也不打开 Passport 数据库：

```powershell
node tools/eom-zh-import.js `
  --root="E:\wki" `
  --package="D:\releases\eom-zh-2026-08" `
  --batch-size=200 `
  --dry-run
```

真实导入前停止本地 Wikist 进程，然后逐批重复：

```powershell
node tools/eom-zh-import.js `
  --root="E:\wki" `
  --package="D:\releases\eom-zh-2026-08" `
  --batch-size=200
```

默认策略是只创建不存在的 slug；任何已有页面都跳过。只有明确要求更新已有 EoM 页面时使用 `--overwrite`。即使启用该参数，`importSource` 不是 `encyclopedia-of-mathematics` 的页面仍受保护。首次实际写入前默认备份 `content/pages`、`content/revisions` 和 Passport SQLite 文件；只有已有外部备份时才考虑 `--no-backup`。

断点状态默认位于：

```text
<wikist-root>/data/imports/eom-zh/<package-content-sha256>-create-only.state.json
<wikist-root>/data/imports/eom-zh/<package-content-sha256>-overwrite.state.json
```

每个成功导入或确定跳过的条目都会立即写入状态。失败条目不会标记完成，修复运行环境后重跑同一命令即可。创建模式和覆盖模式使用不同状态，避免改变策略时误用旧断点。

如需显式指定 `--state`，路径必须位于 `<wikist-root>/data/imports` 内；导入器拒绝指向内容目录或经过符号链接逃逸的状态路径。

## Ubuntu 导入

先把完整、不可变的 ready 包放到服务器，例如 `/srv/wikist-import/eom-zh-2026-08`。Ubuntu 包装脚本会先执行一次包校验和 dry-run；真实批次期间停止 systemd 服务，完成后重启并运行 production doctor：

```bash
sudo bash tools/import-eom-zh-ubuntu.sh \
  --root=/opt/wikist \
  --package=/srv/wikist-import/eom-zh-2026-08 \
  --service=wikist \
  --batch-size=200 \
  --dry-run

sudo bash tools/import-eom-zh-ubuntu.sh \
  --root=/opt/wikist \
  --package=/srv/wikist-import/eom-zh-2026-08 \
  --service=wikist \
  --batch-size=200
```

重复第二条命令直至输出中的 `remainingAfterBatch` 为 0。无 systemd 的维护环境可指定 `--service=none`，但仍必须自行保证没有 Wikist 进程写页面或数据库。覆盖既有 EoM 页面需显式增加 `--overwrite`。

从 Windows 上传并触发一个远端批次时，可使用：

```powershell
.\tools\push-eom-zh.ps1 `
  -HostName "wikist.example.org" `
  -UserName "root" `
  -Package "D:\releases\eom-zh-2026-08" `
  -RemoteAppRoot "/opt/wikist" `
  -BatchSize 200 `
  -DryRun
```

去掉 `-DryRun` 才会执行远端真实批次。脚本在本机先调用正式导入器验证包，生成传输归档及 SHA-256，远端复核后按包内容哈希保存，再调用 Ubuntu 包装脚本。重复上传同一内容哈希不会创建另一份有效发布目录；若检测到同名半包或损坏目录，会先改名为 `.invalid.<时间>` 隔离，再从已校验归档恢复。

## HTTP 接口说明

Wikist 的 `/api/pages/import/wikist` 要求已登录并具有编辑权限的会话；项目编辑 token 不是独立的批量导入凭据。为避免新增绕过登录的接口，发布导入器采用主机内 `PageStore` 安全接口，并要求真实导入时停止服务。因此 `--base-url` 和 `--token` 会被明确拒绝，不会降级为未认证 HTTP 写入。

## 验证

修改打包或导入工具后至少运行：

```powershell
node --check tools/eom-zh-package.js
node --check tools/eom-zh-release-import.js
node --check tools/eom-zh-import.js
node --check tools/check-eom-zh-release.js
node tools/check-eom-zh-release.js
node tools/check-eom-zh-pipeline.js
```

Ubuntu 脚本另运行 `bash -n tools/import-eom-zh-ubuntu.sh`，Windows 推送脚本使用 PowerShell AST 解析器做语法检查。当前中文语料未完成前，不执行全量真实打包或导入。
