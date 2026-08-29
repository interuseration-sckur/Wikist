# 搜索引擎收录

Wikist 为已发布词条、公开问答和协作组织公开讨论提供可渐进增强的服务端页面。搜索引擎不需要执行 `#/` 单页应用即可读取标题、摘要、正文、作者、时间、回答和公开回复；普通浏览器会在同一个干净 URL 上启动完整 Wikist 界面，不再显示另一套简化页面。

## 公开地址

- 词条目录：`https://你的域名/wiki`
- 词条：`https://你的域名/wiki/词条-slug`
- 问答目录：`https://你的域名/questions`
- 问题：`https://你的域名/questions/问题-id`
- 讨论目录：`https://你的域名/discussions`
- Sitemap：`https://你的域名/sitemap.xml`
- Robots：`https://你的域名/robots.txt`

这些地址既用于公开阅读与搜索引擎收录，也直接承载 Wikist 原生交互界面。网页源代码保留可抓取正文，JavaScript 启动后复用既有词条、问答和组织 UI；从页面继续导航时再进入常规 `#/` 应用路由。服务端默认输出浅色主题，浏览器在样式加载前读取用户已保存的主题；接管期间只显示 Wikist 原生“正在接入知识节点”动画，不会闪过另一套深色页面。

## 开启收录

1. 在后台“站点设置”填写唯一的 HTTPS 公开地址，例如 `https://math.sx`。
2. 开启“允许搜索引擎收录”。草稿收录默认关闭，生产站建议保持关闭。
3. 重启 Wikist，使 Webman 和内容兼容服务加载同一份配置。
4. 确认 Nginx 将普通页面请求代理到 `127.0.0.1:8899`，不要为 `/wiki`、`/questions`、`/discussions` 或 `/sitemap.xml` 单独配置静态 404。

默认进入 Sitemap 的内容：

- 非草稿、非归档、非隐藏、非重定向的词条。
- 已通过社区审核的公开问题；已关闭问题仍保留。
- 启用中的协作组织所发布、且未删除或隐藏的讨论与公开回复。

后台、账号页、API、安装器、草稿和删除内容不会进入 Sitemap。404 与服务异常页面同时发送 `noindex`。

## 上线检查

在服务器执行：

```bash
curl -I https://math.sx/wiki
curl -I https://math.sx/questions
curl -I https://math.sx/discussions
curl -I https://math.sx/sitemap.xml
curl https://math.sx/robots.txt
```

打开一个具体词条、问题和讨论，查看网页源代码，确认存在：

- 完整正文，而不是只有空的 SPA 容器。
- 唯一的 `rel="canonical"`。
- 词条的 `Article`、问答的 `QAPage`、讨论的 `DiscussionForumPosting` JSON-LD。
- 正确的站点标题、简介、更新时间和作者。

项目自检：

```bash
npm run check:seo
```

## 提交搜索引擎

将 `https://math.sx/sitemap.xml` 提交到 Google Search Console、Bing Webmaster Tools 等站长平台。Sitemap 会按词条、问答和讨论自动分片；每次请求都从当前公开内容生成，导入、创建、更新、恢复或删除词条后无需手工维护 XML。

站点应持续保持：

- 一个稳定的 HTTPS 域名。
- 公开地址不包含端口、查询参数或 `#` 片段。
- 页面之间使用可抓取的 `/wiki/...`、`/questions/...`、`/discussions/...` 链接。
- 不用 `robots.txt` 代替权限控制；非公开内容必须由 Wikist 权限层拒绝访问。

## 品牌词与站点链接

首页会以后台设置的站点名作为正式站点名，并在结构化数据中声明站点域名去掉标点后的别名。例如公开地址为 `https://math.sx` 时，会声明 `mathsx` 为别名；也可在 `seo.brandAliases` 中配置额外品牌别名。首页同时提供知识库、站内问答和协作社区三个可抓取的公开入口。

Google 的“站点链接”由其系统自动生成，不能手动指定链接或保证展示。发布后，应在 Google Search Console 验证 `https://math.sx`、提交 Sitemap，并对首页请求重新抓取；在 Bing Webmaster Tools 也验证站点并提交同一 Sitemap。保持首页与三个公开入口可访问、标题和品牌名一致，能提高这些入口成为站点链接的可能性。

XML 会立刻反映内容变更，但搜索引擎抓取和建立索引通常不是即时完成。上线后先检查 Sitemap 已读取、页面没有 `noindex`，再等待搜索引擎完成抓取。
