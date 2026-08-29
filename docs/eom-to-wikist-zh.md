# EoM 中文词条转换与导入

本流程把 `G:\Wikist-EoM` 中的 Encyclopedia of Mathematics 原始归档转换为 Wikist 中文词条。原始归档只读，所有中间结果和最终包写入 `G:\Wikist-EoM\wikist-zh`。

## 结果目录

- `mappings/`：全局标题、链接、重定向、引用与术语映射。
- `work/`：可续跑的标题和正文翻译分区。
- `packages/`：可导入 Wikist 的 JSON 词条包。
- `entries/`：便于人工审阅的 Markdown 正文。
- `manifests/`：逐词条状态、来源版本与校验状态。
- `reports/`：链接、引用、公式、重定向、来源和失败项报告。
- `validation/`：发布清单及包文件 SHA-256。

## 生成流程

以下命令在 Wikist 根目录执行。路径含空格时必须保留引号。

```powershell
npm run eom:zh:index -- --source="G:\Wikist-EoM" --output="G:\Wikist-EoM\wikist-zh" --parts=8 --force
npm run eom:zh:titles -- --root="G:\Wikist-EoM\wikist-zh" --parts=8
npm run eom:zh:prepare -- --source="G:\Wikist-EoM" --root="G:\Wikist-EoM\wikist-zh" --parts=8 --force
npm run eom:zh:finalize -- --source="G:\Wikist-EoM" --root="G:\Wikist-EoM\wikist-zh" --force
npm run eom:zh:validate -- --source="G:\Wikist-EoM" --root="G:\Wikist-EoM\wikist-zh"
```

标题与正文翻译结果分别写入 `work/title-output/` 和 `work/body-output/`。任务可以中断后继续；已完成文件默认不会被覆盖。每个正文翻译文件必须保留全部 `@@WIKIST_*@@` 保护标记，完成数学术语和逻辑审校后才能标记为已验证。

随时查看分片进度：

```powershell
npm run eom:zh:status -- --root="G:\Wikist-EoM\wikist-zh"
```

正文采用多代理分片翻译和交叉审校。公式、内部链接目标、引用键、URL、数字和 Wikist 控制标记在翻译前会被保护；审校完成的输出必须设置 `needsReview: false`，并删除 `machine-draft-awaiting-agent-audit` 问题标记。仅经过机械翻译但尚未审校的文件不能计入完成数。

## 来源与许可

每个词条包都保存 EoM 原标题、页面 ID、修订号、来源哈希和原始页面链接。EoM 页面权利状态并不完全相同：明确声明 CC BY-SA 的页面会保留该声明；没有明确声明的页面标记为需要逐页核验。公开发布前应检查源页许可与署名要求，不能把整个归档统一标成同一种开放许可。

## 本地导入

先执行只读预检：

```powershell
npm run eom:zh:import -- --source="G:\Wikist-EoM\wikist-zh" --wikist-root="E:\wki" --dry-run
```

正式导入前停止 Wikist，再运行：

```powershell
npm run stop
npm run eom:zh:import -- --source="G:\Wikist-EoM\wikist-zh" --wikist-root="E:\wki"
npm start
```

默认不会覆盖已有词条。再次同步 EoM 新修订时，可增加 `--overwrite-eom`；它只允许覆盖此前由 EoM 导入的同源词条。仅导入已完成审校的词条时增加 `--validated-only`。

导入前会自动备份页面与 SQLite 数据库，备份位于 `data/import-backups/eom-zh-*`；导入报告位于 `data/imports/`。

## 上传 Ubuntu

在 Windows 端运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\push-eom-zh.ps1 `
  -HostName math.sx `
  -UserName root `
  -SourceRoot "G:\Wikist-EoM\wikist-zh"
```

脚本会生成压缩包和 SHA-256，上传、远端校验、停止服务、备份、导入、重启并运行生产健康检查。服务器上的默认接收目录为 `/opt/wikist/data/imports/eom-wikist-zh`。

也可以先自行上传结果目录，再在服务器执行：

```bash
cd /opt/wikist
sudo bash tools/import-eom-zh-ubuntu.sh \
  --app-root=/opt/wikist \
  --source=/opt/wikist/data/imports/eom-wikist-zh \
  --service=wikist
```

## 验收

必须同时满足：

1. `reports/progress.json` 中 `complete` 为 `true`。
2. 链接、引用、公式、语法、重定向和来源报告没有未处理错误。
3. `validation/packages.sha256` 与实际包一致。
4. 导入预检没有失败项。
5. 抽查定义、定理、证明、公式、引文和重定向均能在 Wikist 正常渲染。

状态为 `needs_review` 的词条不是失败项，但必须保留明确问题记录；不得把它们冒充成已经人工审定的稳定版本。
