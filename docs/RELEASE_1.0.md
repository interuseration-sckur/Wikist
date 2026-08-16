# Wikist 1.0 发布与升级说明

发布日期：2026-08-15  
数据库迁移上限：`0016_organization_forum_knowledge`  
核心前端资源：`wikist-core-20260816-203`

## 发布边界

Wikist 1.0 以 Webman/Workerman 作为公开 HTTP、Passport、权限、Native Community 和实时通信业务核心。Node 兼容服务仅监听回环地址，继续承载尚未迁移的 Markdown、词条文件、翻译、插件与部分维护 API。浏览器仍使用同一站点地址，不直接访问兼容服务。

1. Passport 是唯一账号、会话与账号状态来源。
2. Wikist 数据库是用户、组织、问答、消息、批注、关系与审计数据的唯一事实来源。
3. Centrifugo 仅分发已经授权的实时事件，不持有 Wikist 业务数据。
4. 词条正文继续保存在 `content/pages/`，修订与归档继续使用原目录，不会被数据库迁移改写。
5. Apache Answer 运行时与旧 Bridge 已移除；Wikist Native Community 是问答主路径。

## 1.0 主要能力

- 数学优先的 Markdown Wiki、公式、结构块、脚注、函数图、几何与图表插件。
- 当前版本与稳定审阅版本、来源审阅、差异比较和社区审核。
- Passport、邮箱验证、找回密码、TOTP、用户组、公开主页与社交关系。
- 协作组织、任务、成员、论坛、社区审阅和组织内部问答。
- Native Community 的问题、回答、评论、邀请、投票、Reaction、收藏、关注、标签、修订、举报、治理与成就。
- Messaging/Centrifugo 的私信、组织群聊、通知、附件、引用、已读与在线状态。
- 组织群聊的群主、管理员、成员与禁言治理；成员操作使用紧凑菜单，在线状态由活动租约与实时频道共同校验。
- 全局 Knowledge Object / Relation，把词条、修订、划词、问答、组织、用户、消息与组织论坛互相连接。
- SQLite WAL、FTS5 回退、增量缓存、备份校验、健康检查和请求防护。

## 版本升级矩阵

| 来源版本 | 升级路径 | 数据处理 |
| --- | --- | --- |
| 全新安装 | 安装依赖后运行 `php update.php`，再启动 Wikist | 建立基础 schema 和 `0002` 至 `0016` 全部迁移 |
| 旧纯 Node 版本 | 先完整备份，再用 `tools/update.js` 拉取 1.0 | 保留现有 SQLite、Markdown、修订、配置和上传；建立 Webman/Passport/Community 表并导入兼容消息 |
| `0.13.x` | 使用 `tools/update.js` | 补齐实时通信、划词、知识对象、Native Community、成就、来源和论坛关系迁移 |
| `0.14.x` | 使用 `tools/update.js` | 通常只补齐未执行的 `0014` 至 `0016`；以 `update.php --dry-run` 实际结果为准 |
| 已使用 MySQL | 先由数据库工具完成一致性备份，再运行 `php update.php --no-backup` | 迁移脚本同时提供 SQLite/MySQL 分支；Node 兼容模块全部迁移前不得随意切换现有数据库驱动 |

不要按版本号手工挑选迁移。`webman_migrations` 会记录已执行项，所有迁移按文件名顺序幂等执行。

## 数据库差异

| 迁移 | 新增或调整 |
| --- | --- |
| `0001` | Webman Passport 基础表与既有 Wikist 主 schema |
| `0002` | 旧消息导入统一 Messaging 数据模型 |
| `0003`–`0005` | 在线状态、标签页租约、通信偏好和组织群聊治理 |
| `0006`–`0008` | 正文划词、个人活动、批注与扁平 `@` 回复 |
| `0009` | 全局知识对象与关系索引 |
| `0010`–`0012` | Native Community、邀请回答与低噪声活动清理 |
| `0013` | 删除已停用的 Answer Bridge 专用表，不删除 Wikist 原生问答数据 |
| `0014` | 全站成就同步状态与成长历程 |
| `0015` | 问题来源：直接提问、词条、划词和协作组织 |
| `0016` | 将既有组织论坛主题/回复回填为知识对象，建立组织、回答和引用关系 |

`0016` 只读取既有论坛 Markdown 并建立索引，不修改主题正文。新主题和回复在保存时增量同步，不需要全量重建。

## 推荐升级流程

### Linux / Git 部署

```bash
cd /opt/wikist
sudo node tools/update.js \
  --strategy=git \
  --remote=origin \
  --branch=main \
  --service=wikist \
  --yes
```

### 本地发布包

```bash
node tools/update.js --strategy=local --source=/path/to/wikist-release --service=wikist --yes
```

本地策略会复制 `webman-backend/database/migrations/`；1.0 之前的更新器遗漏该目录时，必须先更新 `tools/update.js` 和 `update.php`，再执行完整升级。

### 仅预检数据库

```bash
php update.php --dry-run
```

Windows 使用仓库内 PHP：

```powershell
.\.runtime\php\php.exe update.php --dry-run
.\.runtime\php\php.exe update.php
```

### 仅数据库维护

```bash
php update.php --from=0.14.0
```

默认流程会：

1. 读取当前数据库驱动与 `webman_migrations`。
2. 显示待执行迁移。
3. SQLite 执行 WAL checkpoint，并通过 `VACUUM INTO` 创建一致性快照。
4. 计算备份文件 SHA-256。
5. 执行 Webman schema 与待执行迁移。
6. 运行 Webman 基础环境检查。
7. 再次查询迁移状态，并写入 `data/updates/php-latest.json`。

`tools/update.js` 已生成整站备份时，会以 `--no-backup --skip-check` 调用 `update.php`，随后由主更新器执行更完整的检查，避免重复制作大型备份。

## 受保护数据

升级器不会用发布包覆盖：

- `config/site.config.json`
- `content/pages/`
- `content/revisions/`
- `content/reviewed/`
- `content/deleted/`
- `data/`
- `logs/`
- `plugins/vendor/`
- `public/uploads/`

自定义核心代码不属于运行数据。部署前应提交到自己的分支，或使用 `--stash-dirty` 让更新器记录临时 stash。

## 验证

```bash
node -p "require('./package.json').version"
php update.php --dry-run
npm run check
npm run check:community
npm run check:v10
```

预期版本为 `1.0.0`，数据库显示 `No pending migrations.`。浏览器应请求带 `wikist-core-20260816-203` 的核心 CSS/JS。

重点人工检查：

- Passport 登录、退出、验证码与 TOTP。
- 词条阅读、公式、编辑、修订和稳定版本。
- 问题、回答、评论、收藏、关注和来源筛选。
- 组织论坛主题/回复的知识引用选择、保存和渲染。
- 私信、组织群聊、通知、在线和已读状态。
- 后台用户、组织、Community、备份和运行健康页面。
- 深色、浅色、桌面与窄屏布局。

## 回滚

1. 停止 Wikist 服务。
2. 将代码回到升级前的 Git 提交或发布目录。
3. SQLite 用 `data/backups/wikist-db-pre-1.0-*.sqlite` 替换当前数据库前，先再次备份当前失败现场。
4. 如果由 `tools/update.js` 升级，也可从 `wikist-pre-update-*.json.gz` 恢复整站数据。
5. 恢复后执行 `npm install --omit=dev`，再重启并检查日志。

不要只删除 `webman_migrations` 记录来伪造回滚。部分迁移会创建或清理真实数据表，必须恢复数据库快照。

## 报告位置

- 主更新器：`data/updates/latest.json`
- 数据库维护器：`data/updates/php-latest.json`
- SQLite 升级前快照：`data/backups/wikist-db-pre-1.0-*.sqlite`

报告不包含用户密码、Session、SMTP 密钥或消息正文。
