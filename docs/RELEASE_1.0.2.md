# Wikist 1.0.2 发布说明

发布日期：2026-08-16  
升级来源：Wikist 1.0.0 / 1.0.1  
数据库迁移上限：`0022_open_organization_community`  
核心前端资源：`wikist-core-20260816-205`

Wikist 1.0.2 是面向公开部署、实时通信和知识收录的补丁版本。现有站点可以原地升级，不需要重新安装或清空用户、词条、问答、讨论和消息数据。

## 主要改进

- 已发布词条、公开问答与公开组织讨论可通过稳定地址被搜索引擎读取，并提供站点地图、规范链接和内容摘要。
- 浏览器访问公开地址时继续使用 Wikist 原有完整界面，默认主题、加载动画和交互体验保持一致。
- 修复词条预渲染中的重复一级标题，保持正文标题结构清晰。
- 增加生产环境检查与修复工具，覆盖服务账号、目录权限、站点配置、内部端口、实时通信和反向代理。
- 完善 Ubuntu、systemd、宝塔面板与 Nginx 的安装、升级和故障处理说明。
- 改善只读文件系统和历史权限不一致场景下的启动可靠性。

## 升级前

1. 在后台“全站备份”生成并下载最新备份。
2. 确认当前站点能够正常启动，数据库、配置、词条和上传目录可访问。
3. 有本地代码修改时先提交，或在升级命令中使用 `--stash-dirty`。

先执行预检：

```bash
npm run update -- --preflight-only --yes
```

## 执行升级

```bash
npm run update -- --strategy=git --remote=origin --branch=main --service=wikist --yes
```

需要临时保留本地代码改动时：

```bash
npm run update -- --strategy=git --remote=origin --branch=main --service=wikist --stash-dirty --yes
```

发布包部署：

```bash
npm run update -- --strategy=local --source=/path/to/wikist-1.0.2 --service=wikist --yes
```

## 升级后

```bash
npm run doctor
npm run check
npm run restart
npm run status
```

生产环境建议额外执行：

```bash
sudo npm run doctor:production -- --public-url=https://wiki.example.com --service=wikist
```

公开站点还应检查 `/robots.txt`、`/sitemap.xml`、词条公开地址和实时消息连接。完整步骤见 [安装与部署指南](INSTALL.md)、[生产部署故障排查](PRODUCTION_TROUBLESHOOTING.md) 与 [搜索引擎收录指南](SEARCH_ENGINE_INDEXING.md)。
