# Wikist

<p align="center">
  <img src="public/assets/wikist-logo.png" alt="Wikist" width="128">
</p>

<p align="center">
  面向数学与科学知识社区的开放 Wiki 框架
</p>

> 当前稳定版本：`1.0.0`

Wikist 用于建设专业、可验证、可持续协作的知识站点。它将 Wiki、问答、组织协作、翻译、评论、消息与内容审阅放在同一套用户和知识体系中，适合个人、团队、学校社团和中小型专业社区部署。

## 功能概要

- **专业 Wiki**：Markdown 写作、公式、脚注、目录、图片排版、重定向、别名、消歧、分类和知识链接。
- **数学内容**：TeX 公式、函数图像、几何画板、图表和可扩展数学插件。
- **内容质量**：结构化来源、DOI、arXiv、版本差异、稳定版本、来源审阅和社区审核。
- **原生社区**：问题、回答、评论、投票、收藏、关注、标签、举报、声望和成就。
- **协作组织**：组织主页、成员、任务、论坛、内部问答、组织群聊和权限管理。
- **实时通信**：私信、群聊、通知、@ 提及、附件、知识引用、已读状态和在线状态。
- **知识互动**：划词批注、喜欢、引用、词条评分、相关问题和知识对象之间的关联。
- **多语言协作**：站点语言切换、翻译工作台、翻译社区、术语表和译文审核。
- **统一账号**：注册、登录、邮箱验证、找回密码、头像、公开主页、关注关系和二次验证。
- **站点管理**：用户、词条、评论、社区、插件、备份、导入导出、首页内容和站点设置。
- **主题与响应式**：浅色/深色主题，适配桌面、平板和手机。
- **可移植部署**：默认使用本地数据库与文件目录，支持网页安装、备份、恢复和升级。

## 快速安装

### 环境要求

- PHP `8.1` 或更高版本，并启用 PDO、mbstring、OpenSSL、cURL 和 GD。
- Node.js `18` 或更高版本，推荐使用 Node.js `24 LTS`。
- Composer。
- Git。

### 获取并启动

```bash
git clone https://github.com/interuseration-sckur/Wikist.git
cd Wikist
npm install
npm run setup:stack
npm start
```

首次启动时，Wikist 会准备所需组件并执行数据库升级。随后访问：

```text
http://127.0.0.1:8899/install.html
```

在安装页完成站点名称、简介、语言、数据库和管理员相关设置。安装完成后重启服务：

```bash
npm run restart
```

Windows 也可以直接使用：

```powershell
.\run-wikist-server.cmd
```

### 常用命令

```bash
npm start          # 启动 Wikist
npm run stop       # 停止 Wikist
npm run restart    # 重启 Wikist
npm run status     # 查看运行状态
npm run check      # 执行发布前检查
```

## 首次使用

1. 打开安装页并完成基础配置。
2. 创建首个账号；空站点的首个账号会进入管理员初始化流程。
3. 在后台设置站点标题、简介、导航、首页内容、邮件和安全策略。
4. 创建第一篇词条，并根据需要填写分类、来源、别名和语言信息。
5. 在后台生成一次全站备份，确认备份下载和恢复入口可用。

## 内容创作

### 创建与编辑词条

登录后使用顶部的新建或编辑入口。编辑页支持可视化编辑与 Markdown，并将扩展信息默认折叠，避免干扰正文写作。

建议每篇专业词条至少包含：

- 清晰定义与适用范围。
- 主要性质、定理或结论。
- 必要示例与反例。
- 与其他词条的链接。
- 可核验的参考来源。

语法和写作示例见 [语法与写作指南](docs/CONTENT_QUALITY.md) 和 [结构化引用指南](docs/CITATIONS.md)。

### 审阅与稳定版本

词条保存后会保留修订记录。具备权限的成员可以比较差异、提出审核意见，并将通过审核的版本设为稳定版本。普通读者可以在当前版本和稳定版本之间查看明确状态。

### 翻译

在词条页选择“翻译”，先确定目标语言，再进入双栏工作台。译文可保存为草稿、提交审核并在通过后发布。翻译社区成员还可以维护术语表和复用已审阅译文。

## 社区与协作

### 问答社区

问答区支持提问、回答、评论、投票、收藏、关注、邀请回答和内容审核。问题可以引用词条、页面、修订、用户或组织，优质回答也可以整理回 Wiki。

### 协作组织

用户可以创建或加入协作组织。组织拥有独立首页、成员目录、协作任务、学术论坛、内部问答和群聊。组织角色决定内容、成员和群聊治理权限。

### 消息与通知

消息中心统一显示私信、组织群聊和系统通知。聊天支持附件、回复、撤回、知识引用、已读状态和在线状态。词条更新、@ 提及、问答互动和组织事件会按权限进入通知中心。

## 站点管理

管理员可以在后台管理：

- 用户、用户组和账号状态。
- 词条、归档、权限和版本审阅。
- 评论、来源、问答和社区治理。
- 协作组织、消息和全站通知。
- 插件、搜索索引和站点外观。
- 导入导出、备份、恢复和运行健康。

站点自己的数据库、配置、词条、上传文件和日志不会提交到公开仓库。

## 更新

更新前请先在后台生成全站备份，并确认工作目录中没有尚未保存的核心代码改动。

推荐使用更新脚本：

```bash
npm run update -- --strategy=git --remote=origin --branch=main --service=wikist --yes
```

如果本地存在需要临时保留的代码改动：

```bash
npm run update -- --strategy=git --remote=origin --branch=main --service=wikist --stash-dirty --yes
```

使用下载并解压的发布包更新：

```bash
npm run update -- --strategy=local --source=/path/to/wikist-release --service=wikist --yes
```

更新程序会保护站点配置、数据库、词条、修订、归档、上传文件和本地插件缓存。更新完成后建议执行：

```bash
npm run check
npm run restart
```

更完整的升级说明见 [升级日志](docs/UPGRADE_CHANGELOG.md)。

## 备份与恢复

后台“全站备份”可以生成包含站点内容与配置的备份包，并显示处理进度。恢复前会再次生成安全备份。

建议：

- 大版本更新前生成备份。
- 定期把备份下载到另一台设备或对象存储。
- 首次上线前完成一次测试恢复。
- 不要只备份代码目录而忽略数据库和词条内容。

## 云端部署提示

- 生产环境建议使用独立运行用户，不要长期以 `root` 运行。
- 确保运行用户可以写入 `config/`、`data/`、`content/`、`public/uploads/` 和需要使用的插件目录。
- 公网只暴露 Wikist 主入口；使用 Nginx、Caddy 或同类网关配置域名与 HTTPS。
- 反向代理后请保留真实主机、协议和客户端地址请求头。
- 使用 systemd、Supervisor 或容器编排工具保持服务运行。

完整步骤见 [安装与部署指南](docs/INSTALL.md)。

## 常见问题

### 提示缺少 PHP 或 Composer

确认 PHP 版本不低于 8.1，并能在终端执行 `php -v` 和 `composer --version`。Windows 也可以通过 `WIKIST_PHP` 与 `WIKIST_COMPOSER` 指定路径。

### 8899 端口已被占用

通常表示 Wikist 已经在运行。先执行：

```bash
npm run status
npm run restart
```

不要同时启动两套 Wikist 进程。

### 云端创建词条或插件时报无权限

检查站点运行用户是否拥有运行目录的写权限，尤其是 `config/`、`data/`、`content/`、`public/uploads/` 和 `plugins/vendor/`。不要使用 `chmod -R 777`。

### 更新后仍显示旧界面

先重启 Wikist，再强制刷新浏览器。使用 CDN 时还需要清理 CDN 缓存。

### 安装页提示来源不受信任

确认通过当前站点域名打开安装页，并让反向代理正确传递 `Host`、协议和客户端地址。不要复用升级前已经打开的安装页标签。

### 自己触发了请求保护

等待提示时间结束，或由服务器管理员重启 Wikist 清理当前进程中的临时限制。上线后请根据真实访问量在后台调整防护阈值，不建议直接关闭保护。

## 文档

- [安装与部署](docs/INSTALL.md)
- [1.0 发布说明](docs/RELEASE_1.0.md)
- [升级日志](docs/UPGRADE_CHANGELOG.md)
- [写作与内容质量](docs/CONTENT_QUALITY.md)
- [引用与来源](docs/CITATIONS.md)
- [实时消息](docs/REALTIME_MESSAGING.md)
- [原生社区](docs/NATIVE_COMMUNITY.md)
- [协作组织](docs/WRITING_COMMONS.md)
- [插件使用](plugins/README.md)
- [完整文档目录](docs/ARCHITECTURE.md)

## 参与项目

欢迎提交 Issue、功能建议、文档改进和代码贡献。提交前请先运行：

```bash
npm run check
```

项目地址：[interuseration-sckur/Wikist](https://github.com/interuseration-sckur/Wikist)

## 第三方组件

第三方组件的许可证与声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

## English

Wikist is an open wiki framework for mathematical and scientific knowledge communities. It combines professional articles, Q&A, organizations, translation, realtime messaging, review workflows, and knowledge references under one account system.

### Quick Start

Requirements: PHP 8.1+, Node.js 18+, Composer, and Git.

```bash
git clone https://github.com/interuseration-sckur/Wikist.git
cd Wikist
npm install
npm run setup:stack
npm start
```

Open `http://127.0.0.1:8899/install.html`, complete the setup, and restart Wikist with `npm run restart`.

### Everyday Commands

```bash
npm start
npm run stop
npm run restart
npm run status
npm run check
```

### Update

Create a full backup first, then run:

```bash
npm run update -- --strategy=git --remote=origin --branch=main --service=wikist --yes
```

See [Installation](docs/INSTALL.md), [Release 1.0](docs/RELEASE_1.0.md), and the [Upgrade Changelog](docs/UPGRADE_CHANGELOG.md) for further guidance.
