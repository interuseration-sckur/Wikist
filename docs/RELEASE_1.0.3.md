# Wikist 1.0.3 发布说明

发布日期：2026-08-16  
升级来源：Wikist 1.0.x  
数据库迁移上限：`0022_open_organization_community`  
核心前端资源：`wikist-core-20260816-205`

Wikist 1.0.3 是升级备份热修复版本。它修复 1.0.2 升级流程在 `[3/9] CHECKPOINT + BACKUP` 阶段提示“流式全站备份需要脱敏数据库快照”并停止的问题，不改变词条、用户、问答、讨论或消息数据结构。

## 修复内容

- 升级备份自动创建一次性脱敏 SQLite 快照，打包完成后立即清理。
- 备份保留恢复所需的账号和业务数据，但排除 Session、临时令牌、验证码、在线租约与待确认安全字段。
- 更新在拉取代码前失败时自动恢复原 systemd 服务，减少意外停机。
- 发布检查增加真实流式备份、快照脱敏和临时文件清理验证。

## 已遇到 1.0.2 备份错误的站点

旧升级器会在拉取修复前失败，因此先按 [生产部署故障排查](PRODUCTION_TROUBLESHOOTING.md) 中的“升级备份缺少脱敏快照”步骤引导更新备份核心，再重新执行正常升级命令。

## 正常升级

```bash
npm run update -- --strategy=git --remote=origin --branch=main --service=wikist --yes
```

升级后执行：

```bash
npm run doctor
npm run check
npm run restart
npm run status
```
