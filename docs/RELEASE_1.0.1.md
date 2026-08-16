# Wikist 1.0.1 发布说明

发布日期：2026-08-16  
升级来源：Wikist 1.0.0  
数据库迁移上限：`0022_open_organization_community`  
核心前端资源：`wikist-core-20260816-203`

Wikist 1.0.1 是 1.0 正式版的首个补丁版本，重点改善安全边界、升级可靠性、实时通信恢复和跨尺寸界面稳定性。现有站点可以原地升级，不需要重新安装或清空数据。

## 主要改进

- 加强 Passport、权限、可信来源、附件、文件路径、密钥、日志脱敏和实时频道保护。
- 升级器增加预检、校验备份、数据库迁移报告和失败恢复；补充健康检查、修复、管理员恢复和服务器迁移工具。
- 改善 SQLite 并发写入、备份校验、恢复演练和运行指标检查。
- 修复实时通信重连、后台接口回退、静态资源缓存和协作路由问题。
- 完善词条、分类、组织、问答、账户中心、后台与手机端的响应式显示。
- 组织知识社区保持开放协作，成员管理和治理操作继续执行组织角色权限。

## 升级前

1. 在后台“全站备份”生成并下载最新备份。
2. 确认当前站点可以正常启动，数据库和词条目录可读写。
3. 对有本地代码修改的站点，先提交修改，或在升级命令中使用 `--stash-dirty`。

先执行预检：

```bash
npm run update -- --preflight-only --yes
```

## 执行升级

Git 部署：

```bash
npm run update -- --strategy=git --remote=origin --branch=main --service=wikist --yes
```

需要临时保留本地代码改动时：

```bash
npm run update -- --strategy=git --remote=origin --branch=main --service=wikist --stash-dirty --yes
```

发布包部署：

```bash
npm run update -- --strategy=local --source=/path/to/wikist-1.0.1 --service=wikist --yes
```

## 升级后

```bash
npm run doctor
npm run check
npm run restart
npm run status
```

浏览器应加载带 `wikist-core-20260816-203` 版本号的核心资源。若仍显示旧界面，请重启 Wikist，并清理浏览器或 CDN 缓存。

## 回滚

升级失败时优先使用升级报告中记录的恢复点。也可以在后台导入升级前生成的全站备份。不要只回退代码而保留未确认兼容的新数据库结构。

详细安装、迁移和生产部署步骤见 [安装与部署指南](INSTALL.md)，逐项变更见 [升级日志](UPGRADE_CHANGELOG.md)。
