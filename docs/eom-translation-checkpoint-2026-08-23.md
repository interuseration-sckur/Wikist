# EoM 中文翻译暂停存档（2026-08-23）

机器可读存档：[checkpoint-2026-08-23.json](G:/Wikist-EoM/wikist-zh/reports/checkpoint-2026-08-23.json)

- 存档时间：`2026-08-23T06:57:38+08:00`
- checkpoint SHA-256：`c808c7a9d989c12faaa8027194b505c4c0c1af2bb100bbc964e934fad8357de0`
- 标题：`9985/9985`；prepared：`8419/8419`
- 正文输出：`356` 个文件、`356` 个唯一 sourceId、重复 `0`
- 未执行数据库导入，未修改正文输出，未创建 Git commit

## 分片恢复点

| 分片 | 已落盘 | 最后完成 | 从 sourceId 恢复 |
|---|---:|---:|---:|
| part-01 | 42 | 347 | 355 |
| part-02 | 45 | 356 | 364 |
| part-03 | 44 | 349 | 357 |
| part-04 | 27 | 222 | 230 |
| part-05 | 48 | 399 | 407 |
| part-06 | 54 | 440 | 448 |
| part-07 | 52 | 449 | 457 |
| part-08 | 44 | 370 | 378 |

part-07 的 `sourceId=449` 已复验：审计 `pass`、token `pass`，文件为 `work/body-output/part-07/00000449.json`，SHA-256 为 `ffe982af6ae168d13ee0f165ca0ab9f44d7fa9223a9b58bfae521cb2943a6942`。

## 完整性状态

现有审计工具以 `--audit-only` 运行，52 项回归全部通过。356 份输出的 token 数量与顺序全部通过；重复、空正文、UTF-8 和 token 异常均为 `0`。当前整体状态仍为 `failed`：

- 阻塞：`176` 的最新标题映射不一致；`216` 有 3 个 issue 缺少 `code`；`383、391、399` 的 issue 不是对象。
- 警告：`111` 的首个标题行与规范 `zhTitle` 不一致。
- 非标准 schema 文件数 `1`，review/issues 一致性失败文件数 `4`。

不得在恢复时静默 normalize 这些正文输出；应逐条审校后重新运行：

```powershell
node tools/eom-zh-normalize-output.js `
  --root=G:\Wikist-EoM\wikist-zh `
  --audit-only `
  --report=G:\Wikist-EoM\wikist-zh\reports\body-output-integrity.json
```

## 工具状态

最终化、打包和导入工具修改已保存在 `E:\wki`，当前为暂停且未提交状态。正文数据库导入和全量发布包写入均未执行；发布链隔离回归上次通过 `34` 项。恢复工作前先校验 checkpoint 中的逐文件 SHA-256，再从表中各分片的恢复 sourceId 继续。
