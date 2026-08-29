# Wikist 代码库完整参考

> 快照日期：2026-08-28
> 适用版本：`1.0.3` 当前工作区
> 用途：供维护者和后续模型快速建立准确的全站心智模型。本文描述已经落地的代码，也明确标注兼容层、实验流水线、已知限制和路线图项目。

## 1. 一句话架构

Wikist 是一个以 Markdown 文件保存词条正文、以 SQLite/MySQL 保存身份和协作状态、由 Webman 作为公网业务入口、Node.js 作为尚在迁移期的内容兼容引擎、原生 JavaScript SPA 作为统一客户端的数学知识社区。

最重要的边界是：

- 词条正文、修订和稳定快照是可移植文件，不以数据库正文作为唯一事实来源。
- Passport、Messaging、Native Community 的身份、权限和业务数据由 Webman/PHP 权威管理。
- Node 仍负责词条文件、Markdown 渲染、搜索、导入导出、备份及一批尚未迁移的协作 API。
- Webman 对未迁移的 `/api/*` 使用受限回环代理转发到 Node；Node 兼容监听器不得公开。
- Centrifugo 只传输实时事件，不保存消息、不鉴权业务操作、不直接访问 Wikist 数据库。
- 前端是 Hash Router SPA；搜索引擎访问的公开词条、问答和讨论另由 Webman 输出服务端 HTML。

## 2. 运行拓扑

```text
Browser / Crawler
        |
        | HTTPS :443
        v
Nginx or Caddy
        |
        +--> Webman :8899                    公网业务入口
        |      +--> Passport / Session       身份权威
        |      +--> Native Community         问答权威
        |      +--> Messaging / Selection    通信与划词批注权威
        |      +--> SEO HTML / Sitemap
        |      +--> LegacyProxyController
        |                 |
        |                 v
        |          Node :8900                仅回环兼容层
        |            +--> PageStore
        |            +--> Markdown renderer
        |            +--> Search / FTS5
        |            +--> Import / Export
        |            +--> Backup / Restore
        |
        +--> Centrifugo :8902 websocket       可选实时传输
                      :8902/api               必须仅回环
```

开发环境可直接运行 Node，但标准启动命令是 `npm start`，由 `tools/start-hybrid.js` 统一启动迁移、Node、Webman 和可选 Centrifugo。

默认端口：

| 组件 | 默认地址 | 公开性 |
| --- | --- | --- |
| Webman | `0.0.0.0:8899` | 只应经 HTTPS 反向代理公开 |
| Node 兼容层 | `127.0.0.1:8900` | 不公开 |
| Centrifugo | `127.0.0.1:8902` | WebSocket 路径可反代，API 不公开 |
| 旧实时网关 | `:8897` | 默认关闭，仅兼容用途 |

## 3. 启动、安装和请求生命周期

### 3.1 启动链

1. `package.json -> npm start` 调用 `tools/start-hybrid.js`。
2. 启动器读取 `webman-backend/.env` 和 `config/site.config.json`，统一公共 URL、可信来源、数据库和实时地址。
3. 解析 PHP/Composer，检查 PHP 扩展和 Webman 依赖。
4. 执行 `webman-backend/tools/migrate.php` 和密钥迁移。
5. 确认至少存在一个活动管理员；首次安装则保留安装所有权流程。
6. Node 使用内部端口和内部令牌启动。
7. Webman 启动为公网入口。
8. 启用实时通信时启动 Centrifugo 和 outbox 消费进程。
9. PID 与栈配置写入 `data/wikist-hybrid.pid.json`、`data/wikist-stack.json`。
10. `stop/restart/status` 复用同一启动器管理进程树。

### 3.2 安装模式

- 未生成 `config/site.config.json` 时，Node 只允许安装页、安装资源和安装 API。
- `/api/install/status` 发放短时安装令牌；写配置或卸载必须验证令牌、来源、限流与安装锁。
- 首位管理员通过独立短时 bootstrap secret 创建，不允许公开注册争抢管理员。
- 安装后 Webman Passport 是身份权威。

### 3.3 普通请求

1. Webman 全局中间件依次设置请求上下文、校验可信来源、解析身份、附加安全头。
2. Webman 原生路由直接进入 Controller -> Service -> Repository。
3. 未迁移路由进入 `LegacyProxyController`，删除外部伪造身份头后，使用内部令牌与已认证身份转发到回环 Node。
4. Node 的 `RequestFirewall` 做请求体预算、限流和安装保护，再进入 `createWikistServer()` 的显式路由分支。
5. 返回 JSON、HTML、静态文件或下载流；错误在生产环境脱敏。

## 4. 数据所有权和存储边界

| 数据 | 主存储 | 权威代码 |
| --- | --- | --- |
| 词条正文与 Front Matter | `content/pages/*.md` | `PageStore` |
| 历史修订 | `content/revisions/<slug>/` | `PageStore` |
| 删除归档 | `content/deleted/` | `PageStore` |
| 稳定版本正文 | `content/reviewed/<slug>/<revision>.md` | `PageStore` + 审阅记录 |
| 站点配置 | `config/site.config.json` | Node config + 运行环境生成器 |
| 用户、会话、权限、社交和协作数据 | `data/wikist.sqlite` 或 MySQL | Webman；Node 兼容读写部分旧表 |
| 上传附件 | `data/uploads/*` | Webman 附件服务 |
| 插件清单 | `plugins/*/plugin.json` | `plugin-registry.js` |
| 插件上游缓存 | `plugins/vendor/` | 审查缓存，不自动执行 |
| 日志、诊断、升级报告 | `logs/`、`data/updates/` 等 | 运维工具 |

SQLite 模式启用 WAL、外键、busy timeout 和 `synchronous=NORMAL`，且 Webman 默认为单写 worker。不要让多台机器同时写同一 SQLite 文件；需要横向扩展时应迁移到 MySQL/PostgreSQL 类数据库并重新验证事务边界。

## 5. 数据库表全景

以下按业务域分组，覆盖当前 Schema 与迁移中创建的表。

### 5.1 身份与安全

- `users`：账户、角色、状态、资料、安全版本、2FA 状态。
- `sessions`：Webman/兼容会话及过期信息。
- `passport_tokens`：邮箱验证、密码重置等一次性 Token。
- `passport_import_map`：旧 Passport 导入映射。
- `wikist_security_state`：站点级安全状态。
- `security_rate_limits`：跨进程共享安全限流状态。
- `captchas`、`guest_profiles`：Node 兼容验证码和访客身份。
- `webman_migrations`：迁移版本记录。

### 5.2 词条协作与知识网络

- `page_permissions`：每页编辑、评论、删除策略。
- `page_edit_events`：编辑审计时间线。
- `page_comments`：词条评论及两层回复模型。
- `page_ratings`：词条星级和评分分布。
- `page_favorites`：用户词条收藏。
- `watch_subscriptions`：词条、分类、语言关注。
- `page_links`：正文 Wiki 链接索引。
- `page_aliases`：别名到规范 slug 的映射。
- `page_stable_revisions`：当前稳定版本指针。
- `page_review_notes`：审阅意见和决定。
- `knowledge_objects`：跨域知识对象规范标识。
- `knowledge_relations`：对象间 `references`、`answers`、`belongs_to` 等关系。
- `wikist_search_index_state`：FTS5 索引运行状态；FTS 虚表是派生数据。

### 5.3 翻译

- `translator_members`：翻译社区成员和语言能力。
- `page_translations`：按词条和目标语言保存草稿、审核与发布译文。
- `translation_memory`：只从已发布译文产生的段落级精确匹配记忆。
- `translation_glossary`：审阅者维护的术语、禁用译法、说明和置信度。

### 5.4 组织与社区审阅

- `writing_organizations`：组织资料、加入策略、共识阈值和状态。
- `organization_members`：成员、角色、申请状态。
- `organization_tasks`：写作、翻译、审阅任务。
- `organization_posts`、`organization_post_replies`：组织论坛主题与平铺回复。
- `organization_post_subscriptions`、`organization_post_favorites`：主题关注和收藏。
- `community_review_votes`、`community_review_consensus`：针对不可变词条/译文快照的组织投票和最终共识。

### 5.5 统一消息与在线状态

- `messaging_conversations`：私信、组织会话、系统会话。
- `messaging_conversation_members`：成员、角色、读游标和归档状态。
- `messaging_messages`：持久消息、回复、撤回状态和客户端 nonce。
- `messaging_message_hidden`：用户侧隐藏，不删除公共消息记录。
- `messaging_attachments`：待绑定/已绑定附件及安全元数据。
- `messaging_object_references`：消息中的词条、问题、回答等知识引用。
- `messaging_mentions`：明确提及收件人。
- `messaging_user_preferences`：通知、在线状态、自动回复偏好。
- `messaging_auto_reply_state`：自动回复去重。
- `messaging_conversation_mutes`：会话禁言。
- `messaging_user_presence`、`messaging_presence_leases`：隐私受控在线状态与多标签租约。
- `messaging_outbox_events`：事务 outbox，供 Centrifugo 发布。
- `messaging_legacy_links`：旧通知和新消息映射。
- `user_messages`、`site_messages`、`site_message_states`：Node 旧收件箱/站点广播兼容表。
- `user_follows`：用户关注关系，也用于作者更新通知。

### 5.6 划词批注

- `content_selections`：以对象、文本指纹、选择器和位置保存高亮。
- `content_selection_comments`：批注讨论。
- `content_selection_likes`：批注点赞。
- `content_selection_activities`：复制、引用、评论等活动记录。

### 5.7 Native Community 问答

- `community_spaces`：公开或组织空间。
- `community_questions`、`community_answers`、`community_comments`：问答主体。
- `community_tags`、`community_question_tags`：标签和关联。
- `community_question_sources`：问题结构化来源。
- `community_votes`、`community_reactions`：投票与轻量反应。
- `community_collections`、`community_follows`：收藏和关注。
- `community_revisions`：问题/回答修订提案与历史。
- `community_activity`：活动流。
- `community_reputation`、`community_reputation_events`：声望汇总和事件账本。
- `community_badges`、`community_badge_awards`、`achievement_sync_state`：徽章、成就和同步状态。
- `community_reports`、`community_reviews`：举报和审核队列。
- `community_views`：阅读统计去重。
- `community_attachments`：问答附件。
- `community_answer_invites`：邀请回答流程。

## 6. Node 代码结构

### 6.1 入口

- `server.js`：读取 `WIKIST_PORT/WIKIST_HOST`，创建并监听 `createWikistServer()`；处理端口占用和权限错误。
- `src/server/app.js`：Node 兼容层的组合根。创建 Store、搜索、FTS、插件、指标和防火墙，并用显式 `pathname + method` 分支实现 API。这里仍是最大的迁移期路由文件。

### 6.2 `src/core` 文件职责

| 文件 | 作用与关键入口 |
| --- | --- |
| `page-store.js` | 词条文件事实来源；缓存、摘要、搜索文档、修订、稳定快照、删除归档、恢复、移动、引用重写和保存。关键类 `PageStore`。 |
| `frontmatter.js` | 解析和序列化无 YAML 依赖的 Front Matter；复杂对象通过 JSON 字段保存。 |
| `markdown.js` | 安全 Markdown 子集、TeX 占位、表格、列表、脚注、引用、容器、图片和插件块渲染；输出 HTML、TOC、引用统计。 |
| `citations.js` | 引用类型、ID/DOI/arXiv/URL 归一化、字段校验、质量计算和格式化。 |
| `slug.js` | URL 解码、slug 规范化、文件名映射和锚点 ID。 |
| `search-index.js` | 内存字段加权索引、中文启发式分词、停用词、单字概念、前缀/模糊/短语、过滤、facet、建议缓存和 FTS 回退。 |
| `fts-index.js` | SQLite FTS5 派生索引；建表、增量同步、删除、重建、恢复、过滤查询和健康状态。 |
| `knowledge-navigation.js` | 分类快照、分类详情和主题树；从页面元数据派生，不建独立分类数据库。 |
| `revision-review.js` | 有预算的当前版/稳定版行差异算法和摘要。 |
| `translation-quality.js` | Markdown 段落切分、源哈希、翻译记忆对和源文变化检测。 |
| `plugin-registry.js` | 插件清单净化、配置 Schema/迁移、Hook 注册、上游同步安全、魔法词、函数图、几何和图表块。 |
| `passport-store.js` | Node 兼容数据库巨型 Store；旧 Passport、词条协作、翻译、组织、评论、消息、关注、评分、知识图和社区审阅。Webman 已是身份/社区/消息权威，新功能不应继续扩张这里的身份职责。 |
| `messaging-bridge.js` | 把旧 `user_messages/site_messages` 镜像进统一会话/消息/outbox，支持已读和撤回同步。 |
| `import-export.js` | Wikist JSON 导入和 Wikipedia API/wikitext 转 Markdown；保留来源信息并显式降级未知模板。 |
| `backup.js` | v2 备份流、逐文件 SHA-256、整体清单、数据库一致性快照、检查、恢复和隔离演练。 |
| `config.js` | 默认配置、安装配置校验、读写/卸载 `site.config.json`。 |
| `runtime-ops.js` | 脱敏内存指标、请求限流、请求体预算、安装令牌和安全响应头。 |
| `http.js` | JSON Body 限制、安全路径拼接、JSON/文本响应、静态文件 ETag/压缩/Range 边界。 |
| `mailer.js` | 邮件公开配置、SMTP DNS/IP SSRF 防护、Nodemailer 发送和站点基础 URL。 |
| `log-redaction.js` | 按敏感键和字符串模式递归脱敏日志。 |

### 6.3 Node API 业务组

`src/server/app.js` 仍处理：

- 安装、站点 bootstrap、运行指标和插件失败上报。
- 词条列表、详情、保存、删除、移动、预览、历史、diff、稳定快照和归档恢复。
- 分类、主题、知识快照、缺失页、孤立页、别名和链接分页。
- 词条评论、评分、收藏、关注、权限和编辑事件。
- 轻量搜索、搜索建议、FTS5 管理。
- 翻译社区、译文工作台、审核、自动草稿、记忆和术语表。
- 组织、任务、论坛、成员、社区共识。
- 导入导出、备份下载/检查/恢复/演练。
- 管理后台的设置、页面、引用、审阅、日志、旧消息、插件、运行状态等。
- 一部分 Passport 兼容接口；Webman 路由优先，正常公网请求不应直接依赖这些身份端点。

## 7. Webman 后端结构

### 7.1 路由所有权

`webman-backend/config/route.php` 禁用默认路由并显式声明：

- 公共 SPA、Passport 页面、健康检查。
- `robots.txt`、Sitemap、公开词条、问答和讨论 SEO 页面。
- 原生 Passport 全流程。
- 原生 Messaging、Selection、Native Community 和成就 API。
- 管理员用户 API。
- 其余 `/api/*` 与 `/plugins/*` 才进入受控 Legacy Proxy。

### 7.2 Controller 层

| Controller | 职责 |
| --- | --- |
| `FrontendController` | 返回 SPA Shell。 |
| `PassportPageController` | 返回独立 Passport 登录/注册页面。 |
| `HealthController` | 综合健康、ready 和 live。 |
| `PassportController` | 验证码、注册登录、邮箱、密码、资料、2FA、实时票据。 |
| `MessagingController` | 会话列表、消息、成员、读状态、禁言、在线、附件、知识对象建议、实时 Token。 |
| `CommunityQaController` | 问题、回答、评论、投票、反应、收藏、关注、修订、举报、审核、声望、徽章和附件。 |
| `SelectionController` | 划词解析、marker、批注评论、点赞、活动和个人高亮。 |
| `AchievementController` | 当前用户和公开用户成就。 |
| `SeoController` | 可抓取目录/详情页、robots 和分片 Sitemap。 |
| `SseController` | 无 Centrifugo 时的认证事件流兼容。 |
| `AdminUserController` | 管理用户列表与角色/状态。 |
| `LegacyProxyController` | 只向回环 Node 转发未迁移路由，并重新建立可信身份边界。 |

### 7.3 Service 层

- 身份安全：`AuthService`、`PasswordService`、`PassportSecurityService`、`TotpService`、`SecretCipher`、`CaptchaService`、`BehaviorCaptchaService`、`LoginRateLimiter`、`CaptchaRateLimiter`、`RequestIpService`。
- 消息实时：`MessagingService`、`MessagingPermissionService`、`MessagingAttachmentService`、`MessagingChannels`、`RealtimeTicketService`、`RealtimeSecurityService`、`CentrifugoTokenService`、`CentrifugoPublisher`。
- 社区：`NativeCommunityService` 是业务主实现；`CommunityQaService` 提供面向 Controller 的门面；`CommunityPermissionService`、`CommunityEventService`、`CommunityMarkdownService`、`CommunityAttachmentService` 分离权限、事件、净化和附件。
- 知识与批注：`SelectionService`、`KnowledgeObjectResolver`、`KnowledgeObjectId`。
- 站点与安全：`MailService`、`AttachmentSecurityService`、`SensitiveDataRedactor`、`OperationalMetrics`、`SqliteWriteGuard`。
- SEO：`SeoContentService` 聚合公开数据，`SeoPageRenderer` 生成服务端 HTML。
- 成就：`AchievementService` 从贡献事实同步成就并提供公开摘要。

### 7.4 Repository 层

- `UserRepository`：用户、会话安全版本和公开资料。
- `PassportTokenRepository`：一次性安全 Token。
- `SiteConfigRepository`：站点配置读取。
- `MessagingRepository`：会话、消息、成员、附件、引用、在线、outbox。
- `CommunityRepository`：Native Community 全部查询和持久化。
- `SelectionRepository`：划词、批注、点赞和活动。
- `KnowledgeGraphRepository`：知识对象和关系。
- `AuditRepository`：安全审计记录与保留清理。
- `CompatibilitySessionRepository`：兼容旧 Cookie/Session。

### 7.5 中间件和进程

- `RequestContextMiddleware`：请求 ID、上下文与基础计时。
- `TrustedOriginMiddleware`：写请求 Origin/CSRF 校验。
- `AuthContextMiddleware`：恢复用户身份并附加 `UserIdentity`。
- `SecurityHeadersMiddleware`：CSP、HSTS、frame、nosniff 等响应头。
- `RequireAuthMiddleware`、`RequireAdminMiddleware`：路由级认证与管理员门禁。
- `StaticFile`：Webman 静态资源缓存和版本处理。
- `Http`：Webman 主 HTTP 进程。
- `MessagingOutboxProcess`：单消费者领取 outbox 并发布 Centrifugo，含失败重试和清理。
- `RealtimeGateway`：旧 WebSocket 兼容，默认关闭。
- `Monitor`：开发环境文件/内存监控。

## 8. 身份、角色和权限

角色顺序：

```text
member < creator < editor < senior_editor < admin
```

- `member`：基础登录用户。
- `creator`：内容创建职责。
- `editor`：编辑职责。
- `senior_editor`：审阅、页面权限和编辑控制台。
- `admin`：用户、全局设置、备份恢复、插件上游、运行防护等系统权限。

页面另有独立策略：

- `editPolicy`: `guest | user | locked`
- `commentPolicy`: `guest | user | locked`
- `deletePolicy`: `user | senior_editor | locked`

安全原则：

- 密码变更、重置、封禁、2FA 变化提升安全版本，使旧 Session 和实时 Token 失效。
- Cookie 为 HttpOnly、SameSite，生产环境 Secure。
- 邮箱更改先进入待验证状态；找回密码只接受已验证邮箱。
- 2FA 使用 TOTP 和恢复码；启停均要求二次确认。
- 行为验证码用于注册；算术验证码只保留 Node 兼容测试边界。
- 管理员敏感操作要求管理员身份和近期认证。
- 访客编辑/评论需要昵称和邮箱，并获得稳定访客 Cookie 与审计身份。

## 9. 词条模型和 Markdown

### 9.1 Front Matter

主要字段包括：

- 基础：`title`、`summary`、`author`、`status`、`quality`、`difficulty`、`language`、`createdAt`、`updatedAt`。
- 导航：`categories`、`topic`、`aliases`、`redirectTarget`、`disambiguation`、`disambiguationTargets`。
- 数学：`prerequisites`、`relatedPages`、`canonicalNames`、`notation`、`classifications`。
- 来源：`references`。
- 导入来源：`importTitle`、`importUrl`、`importSource`、`importRevision`、`importFetchedAt`、`importLicense`、`importLang`。

复杂数组/对象以单行 JSON 保存。真正的权限、稳定审阅状态、译文、组织归属和账户身份不伪装成 Front Matter。

### 9.2 已实现正文能力

- 标题、段落、强调、粗体、删除线、高亮、上下标、行内代码和代码块。
- 有序/无序列表和任务列表。
- GFM 表格、定义列表、引用块、水平线。
- 脚注 `[^id]`。
- Wiki 链接 `[[slug|label]]`、外链和页内锚点。
- TeX：`$...$`、`$$...$$`、`\(...\)`、`\[...\]`，浏览器由 MathJax 3 排版。
- Markdown 图片属性和 MediaWiki 风格 `[[File:...]]` 图片布局。
- 结构化引用 `[@id]`、引用簇、定位信息和 `{{cite-needed|...}}`。
- `definition/theorem/proof/example/warning/note` 等冒号容器。
- 魔法词和受控 `#if/#ifeq/#ifexpr`。
- 函数图、几何板、数据图表插件块。
- 自动 TOC、标题自定义 ID 和安全锚点。

### 9.3 明确限制

- 原始 HTML/HTML 注释会被转义。
- 没有 MediaWiki 模板执行器、Lua、任意 HTML、通用脚本或任意服务端插件。
- 没有公式自动编号和交叉引用体系。
- 没有通用音频/视频/文件正文附件语法；正文主要支持图片 URL。
- `status=draft` 不是私有草稿系统，当前页面文件仍可公开读取。
- 没有词条自动保存和未保存正文的服务端预览。
- Wikipedia 导入是可审计转换器，不保证模板无损。

## 10. 词条完整业务链

### 10.1 保存

1. 规范化 slug 和字段，验证引用与权限。
2. 更新前把旧 Markdown 复制到修订目录。
3. 原子写入新 Markdown。
4. 清理 PageStore 缓存并发出变更事件。
5. 增量更新内存搜索、FTS5、页面链接和别名。
6. 写编辑事件和审计日志。
7. 通知词条/分类/语言关注者及作者关注者。

### 10.2 删除与恢复

- 删除不是直接丢弃，而是移动到 `content/deleted/`。
- 清理链接和别名索引，保留审计记录。
- 后台归档页可检查并恢复；恢复再次同步索引。

### 10.3 安全移动

- 拒绝目标冲突和陈旧目标。
- 移动正文、修订目录和稳定快照。
- 在事务边界内重键权限、评论、评分、收藏、关注、译文、审阅和知识关系。
- 增量重写正文 Wiki 链接和结构化元数据引用。
- 可保留旧 slug 重定向；重定向不计入分类/主题数量。

### 10.4 审阅

- 当前 revision ID 与稳定指针不同即进入待审。
- `senior_editor/admin` 可批准、要求修改、撤回自己的意见。
- 批准时写稳定 Markdown 快照和数据库指针。
- diff 采用有上限的行比较，避免大正文造成无界内存。
- 组织审阅可对精确 revision/译文快照投票，达到阈值后复用相同稳定发布路径。

## 11. 搜索与知识导航

### 11.1 内存搜索

`SearchIndex` 建立字段文档并按标题、分类、摘要、正文等权重评分，支持：

- 中文字符和拉丁词启发式分词。
- 配置停用词和受控单字数学概念。
- 前缀、有限编辑距离模糊、引号短语。
- `title:`、`category:`、`quality:`、`difficulty:` 等查询/筛选。
- 分页、facet、摘要片段和建议。
- 增量建议索引；页面保存不触发全站重建。

### 11.2 FTS5

- 可选，和 Passport 使用同一 SQLite 文件。
- Markdown 始终是事实来源，FTS 是可重建派生数据。
- 页面保存/删除/恢复只更新对应记录。
- 历史数据由管理员显式 backfill。
- FTS 不可用、索引未完成、模糊/短语条件不适合时自动回退内存引擎。
- 后台提供状态、重建和恢复；故障不阻止词条保存。

### 11.3 知识导航

- 分类和 slash 主题路径从 Front Matter 即时派生层级。
- `page_links` 提供独立分页的出链/反链、缺失页和孤立页。
- `page_aliases` 解析旧名或替代名。
- 悬浮预览按页面或知识对象加载并在前端缓存。
- 推荐结合分类、主题、链接和页面质量，不引入外部推荐服务。

## 12. 引用和内容质量

- 引用类型：`article/book/chapter/preprint/conference/thesis/web/dataset/other`。
- 支持作者、题名、容器、出版社、年份、卷期页、DOI、arXiv、URL、访问日期、说明和语言。
- 引用键小写且唯一；DOI/arXiv/URL/年份有格式校验。
- 页面渲染统计已引用、未引用、未解析、待补来源、记录完整度和可核验标识。
- 后台来源审阅筛选无来源、未知引用、待补来源和不完整记录。
- 内容质量标签和稳定审阅是两套概念：Front Matter 质量描述内容成熟度，稳定指针证明某个版本经过审核。

## 13. 翻译体系

- `#/translate/<slug>` 先选择目标语言；实际工作台使用 `?lang=`。
- 状态流：`draft -> review -> published`，也可进入 `changes_requested`。
- 读者只能直接选择已发布译文；翻译者和审阅者可看到工作状态。
- 保存新译文会使旧审核失效。
- 进度按源文/译文 Markdown 度量；自动草稿是基础辅助，不是外部机器翻译服务。
- 翻译记忆只由已发布译文按段落哈希生成。
- 术语表可搜索、分页，记录推荐译法、替代/禁用译法、领域、说明和置信度。
- 工作台保存源文快照并显示源文变化片段。
- 词条移动会重键译文并修复译文中的 Wiki 链接。

## 14. 组织、论坛和社区审阅

组织角色：

```text
member < writer / translator / reviewer < coordinator < owner
```

- 创建者成为 owner；最后一个活动 owner 不能被降级。
- 加入策略为公开加入或申请审核。
- 每用户创建数和加入数有配额。
- 任务类型为 `write/translate/review`，状态为 `open/claimed/ready/closed`。
- 组织主页是 Markdown 公约；任务、论坛、成员分别分页，不在一个长页面无界加载。
- 论坛支持搜索、类别、open/resolved/locked、排序、置顶、关注、收藏和分页回复。
- 回复采用平铺楼层；回复某人写入 `@username`，避免无限嵌套。
- 论坛正文使用 `{{ref:type|id|label}}` 保存知识引用，渲染为引用卡片。
- 论坛主题/回复同步进 `knowledge_objects/relations`，但不复制到公开 Q&A 表。
- 组织可针对精确词条 revision 或译文 snapshot 形成阈值共识。
- 通知复用统一消息，不另建组织通知系统。

## 15. Native Community 问答

已实现能力：

- 问题列表、详情、搜索、标签、组织空间和来源筛选。
- 提问、编辑、软删除、关闭、重开、邀请回答。
- 回答、编辑、删除、采纳和撤销采纳。
- 对问题/回答/评论的评论、投票、表情反应、收藏、关注。
- 修订提案、版本列表和差异。
- 活动流、声望事件、徽章和成就。
- 举报、审核队列、组织范围审核和审核决定。
- 安全附件和从回答生成 Wiki 草稿。
- 相关对象和知识对象预览。
- `page` 外部类型统一规范为 `wiki_entry`，避免重复对象身份。
- 组织可见性在列表、详情、搜索、预览、关系和通知各层独立执行。

`NativeCommunityService` 是核心业务实现；Controller 不应直接拼数据库操作。写操作通过 `SqliteWriteGuard` 做有限锁重试，事件通过 `CommunityEventService` 同步知识图、声望、通知和 outbox。

## 16. 划词、高亮和批注

- `selection-toolbar.js` 在正文、问题、回答、组织帖子和消息引用对象上监听选择。
- 保存对象类型/ID、文本、上下文、位置选择器和指纹，用于正文变化后的重新定位。
- 可复制、引用到评论/问题/消息、添加批注、点赞和删除自己的高亮。
- 批注支持回复和深链定位。
- `selection-toolbar.css` 只负责浮动工具条、marker 和批注对话框的专属样式。
- 账户中心 `highlights` 区域分页展示个人高亮。

## 17. 统一消息和实时通信

### 17.1 持久业务

- 私信和组织会话共用一套 conversation/message 模型。
- 支持消息回复、撤回窗口、个人隐藏、附件、`@mention`、知识对象引用和读游标。
- 会话支持归档、免打扰、成员角色、禁言和在线状态隐私。
- 个人/系统通知也进入统一收件箱，而不是浏览器临时通知。

### 17.2 实时层

- 业务写入和 outbox 同事务提交。
- `MessagingOutboxProcess` 批量领取待发布事件并推送 Centrifugo。
- 客户端只能订阅服务器签发的频道，不允许浏览器业务 publish。
- Centrifugo 关闭时保留 SSE 和轮询回退。
- 在线状态使用 TTL、心跳和 lease；GET 请求不做无条件同步写入。

### 17.3 客户端

- 顶栏消息 Popover 展示会话预览和未读数。
- `#/messages` 是完整三栏工作台：会话列表、消息线程、上下文/成员栏。
- 支持旧消息向上分页、输入状态、提及选择、知识引用选择、附件和连接状态。
- 移动端收束为可切换区域，避免三栏重叠。

## 18. 前端应用

### 18.1 Shell

`public/index.html` 固定三栏布局：

- 左栏：品牌、搜索、账户摘要、主导航、Passport 链接。
- 中栏：顶部搜索/快捷导航/语言/主题/消息/编辑操作、主内容和页脚。
- 右栏：TOC、推荐、最近更新。
- 移动端：侧栏抽屉、遮罩和页面工具折叠菜单。

### 18.2 Router

`public/assets/app.js` 约一万行，是当前 SPA 组合根。`parseRoute()` 解析 hash，`route()` 负责路由切换、滚动、消息订阅清理、编辑器销毁、异步 generation 防陈旧写入和渲染后 hydration。

主要路由：

| 路由 | 页面 |
| --- | --- |
| `#/` | 知识入口 Portal |
| `#/page/:slug` | 词条/首页 |
| `#/search/:query` | 高级搜索 |
| `#/new`、`#/edit/:slug` | 新建/编辑 |
| `#/history/:slug` | 修订历史 |
| `#/review/:slug` | 稳定版本审阅 |
| `#/comments/:slug` | 评论讨论 |
| `#/permissions/:slug` | 页面权限 |
| `#/translate/:slug` | 语言选择/翻译工作台 |
| `#/translation-glossary` | 术语表 |
| `#/favorites`、`#/watchlist`、`#/following` | 个人知识订阅 |
| `#/account`、`#/highlights`、`#/user/:name` | 账户、划词和公开资料 |
| `#/knowledge`、`#/category/:path`、`#/topic/:path` | 知识网络和分类导航 |
| `#/community`、`#/organizations` | 组织发现和个人组织身份 |
| `#/organization/:slug` | 组织主页/任务/论坛/成员/问答/治理 |
| `#/questions` | Native Community 问答 |
| `#/messages/:conversation` | 通信工作台 |
| `#/import-export`、`#/archive/:id` | 内容交换和归档 |
| `#/admin/:section` | 后台各模块 |

登录、注册、找回、重置、验证路由会跳转独立 `/passport` 页面。

### 18.3 `app.js` 功能簇

- 全局状态、API 包装、URL/HTML 净化、SweetAlert 统一弹窗。
- 主题、语言、OpenCC、MathJax 和第三方脚本按需加载。
- 页面建议、悬浮预览、最近更新、推荐和 TOC。
- 词条主页面及收藏、关注、链接、问答、评分、翻译和组织面板。
- Vditor 可视化编辑器与纯文本回退、引用编辑器和元数据字段。
- 搜索、分类、主题、知识图和管理报告。
- 翻译工作台、记忆、术语和社区审阅。
- 组织工作区、论坛引用 Picker、任务和成员管理。
- Passport 会话摘要、公开用户、关注关系、账户设置和成就。
- 统一消息工作台、实时订阅和回退轮询。
- 后台：概览、用户、组织、问答治理、页面、引用、审阅、评论、搜索索引、运行健康、日志、广播、导入、归档、备份、设置和插件。
- 渲染后统一 hydration：MathJax、函数图、几何、图表、客户端插件、链接预览、图片查看和划词 marker。

### 18.4 独立前端模块

- `community-qa.js/css`：问答客户端状态、列表/详情/编辑/投票/审核等，与主 SPA 通过挂载 API 协作。
- `selection-toolbar.js/css`：跨内容对象的选择定位和批注交互。
- `passport/index.html + passport.js/css`：登录、注册、找回、重置、验证、2FA 场景；独立主题和背景选择。
- `install.html + install.js/css`：安装表单、部署模式预览、SMTP 字段和安装状态。
- `seo-reader.css`：服务端可抓取页面的轻量阅读样式。
- `vendor/sweetalert2/wikist-adapter.js`：把弹窗外观和行为收敛到 Wikist 语义。

## 19. Design System

### 19.1 文件边界

- `public/assets/styles.css`：布局、尺寸、Grid/Flex、页面结构、响应式断点和业务组件排版。
- `public/assets/design-system.css`：语义颜色、表面、边框、阴影、控件状态和 Light Mode 皮肤。
- 专属 CSS：Community、Selection、Passport、Installer、SEO Reader。

`design-system.css` 被 `npm run check:ui` 禁止写定位、宽高、间距、Grid、Flex、Overflow 等布局属性。设计系统可以换皮，不能暗改布局契约。

### 19.2 视觉原则

- 深色优先，低对比表面承载高密度知识内容；Light Mode 使用同一语义变量覆盖。
- 青色主动作、绿色成功、琥珀提醒、玫红危险。
- 动画主要使用 `transform/opacity`，尊重 `prefers-reduced-motion`。
- 正文、搜索、社区和后台优先可扫描性；首页允许有限科技视觉。
- 不依赖 Tailwind/React，不持续运行纯装饰动画。

### 19.3 变量层

- 页面：`--bg`、`--panel`、`--panel-2/3`、`--panel-strong`。
- 文本：`--text`、`--muted`、`--muted-2`。
- 边界：`--line`、`--line-strong`。
- 状态：`--cyan`、`--green`、`--amber`、`--rose` 及 soft 背景。
- 交互：`--surface-input`、`--surface-hover`、`--surface-overlay`、`--focus-ring`。
- UI 表面：`--ui-surface-page/nav/card/raised/control/popover`。
- UI 边框/阴影：`--ui-border*`、`--ui-highlight`、`--ui-shadow-control/card/raised/popover`。
- 动效：`--ui-transition`、`--ui-transition-slow`。
- 圆角：`--radius-sm`、`--radius`、`--radius-lg`。

### 19.4 组件与状态

按钮、输入框、菜单、Tabs、分页、卡片、表格、Toast、弹窗、Popover、导航、消息气泡、后台表格均覆盖默认、hover、focus、active、disabled；危险动作必须使用危险语义变量，键盘焦点必须使用统一 focus ring。

### 19.5 响应式契约

- 宽屏为左导航 + 中内容 + 右信息栏。
- 中等宽度收起右栏或调整工作区。
- 移动端左栏成为抽屉，页面工具进入 `<details>`，头部操作压缩。
- 管理后台次级导航在覆盖正文前切换抽屉。
- 消息三栏、组织工作区、表格、评分、引用质量和审阅控件都有独立窄屏规则。
- 检查器会验证文本不溢出、移动导航不重复、编辑器和后台不被遮挡。

## 20. 插件系统

### 20.1 执行模型

- `core:*`：执行逻辑编译在 Wikist 核心中。
- `clientModule`：只有启用、路径安全且属于可信本地插件时动态 import。
- `manifest-only`：只展示和配置，不执行。
- `clone-ready`：只登记上游仓库并缓存到 `plugins/vendor/`，不自动执行。
- `serverModule` 字段仅描述，永不自动 `require`。

Hook API 版本为 `1.0`。当前受控 Hook 包括 Markdown 预处理、块渲染、搜索增强和后台面板；每个 Hook 必须有对应 capability。后台面板同时要求 `admin.panel` 和 `ui:admin-panel`。

### 20.2 内置插件

| 插件 | 作用 |
| --- | --- |
| `wikist-markdown-advanced` | 任务列表、脚注、定义列表、属性、图片扩展等高级 Markdown。 |
| `wikist-magic-words` | 站点/页面/日期变量及受控解析函数。 |
| `wikist-function-plot` | function-plot + D3，可选 math.js，支持显式/隐式函数。 |
| `wikist-geometry-board` | JSXGraph 可拖拽几何构造。 |
| `wikist-math-chart` | Chart.js 折线、散点和柱状数据模型。 |
| `wikist-opencc-chinese` | zh-CN/zh-TW 显示层转换。 |
| `wikist-advanced-search` | 字段权重、模糊、前缀、过滤和搜索 Hook。 |
| `wikist-cosmic-experience` | 首页/Passport 的可关闭 Canvas 视觉层。 |
| `wikist-plugin-hooks` | 受控后台面板 Hook 示例和能力展示。 |

已登记但默认不执行的上游生态：`markdown-it`、attrs、container、deflist、footnote、task-lists。

### 20.3 供应链保护

- 只接受安全 GitHub HTTPS 仓库格式。
- 限制上游文件数量、总体积、超时、磁盘余量和符号链接。
- `plugins/vendor` 不通过 HTTP 暴露。
- Manifest、配置 Schema、配置迁移、Hook 和权限均净化/校验。
- 客户端模块失败只记录脱敏指标，不应拖垮词条渲染。

## 21. SEO 和公开阅读

- SPA 内容本身不是爬虫唯一入口。
- Webman 提供 `/wiki`、`/questions`、`/discussions` 目录和详情 HTML。
- `robots.txt`、Sitemap Index 和按 wiki/questions/discussions 分片 Sitemap。
- SEO 读取只包含公开、可索引内容；组织可见性继续执行。
- 页面生成 canonical、结构化数据、基础 meta 和轻量 `seo-reader.css`。
- 配置可关闭 SEO、禁止草稿索引、调整 Sitemap 分片大小。

## 22. 导入、导出和备份

### 22.1 内容交换

- Wikist JSON/Markdown 导出保留正文和元数据。
- Wikist JSON 导入校验格式、slug、引用、覆盖标志和正文预算。
- Wikipedia 导入调用 MediaWiki API，转换标题、链接、表格、图片、数学和常见结构，并保留来源/许可字段。
- 未支持模板必须留下可见降级或问题记录，不静默伪造结果。

### 22.2 备份

- `wikist-site-backup` v2 使用 gzip JSON 容器、逐文件哈希和整体清单哈希。
- 包含配置、词条、修订、审核快照、插件 Manifest、上传；可选用户数据库。
- SQLite 使用 `VACUUM INTO` 一致性快照，不直接遗漏 WAL。
- 会话、验证码、短时 Token 和 Presence 不进入可下载备份。
- 恢复执行路径白名单、realpath/symlink/NoFollow、大小/数量、哈希和本站数据库路径校验。
- 恢复前先创建安全备份；后台可在系统临时目录做隔离还原演练。
- 可配置备份 HMAC 签名要求。

## 23. EoM 中文语料流水线

这一组是已加入当前工作区、但语料尚未全量发布的离线工具，不属于在线请求链。

1. `archive-eom.js`：抓取 Encyclopedia of Mathematics API，建立不可变原始归档、关系和校验。
2. `eom-zh-index.js`：解析标题、重定向、引用、媒体、关系和术语，生成全局映射及分片输入。
3. `eom-zh-titles.js`：合并标题翻译、应用高置信人工 override、处理冲突和完整性报告。
4. `eom-zh-convert.js prepare/finalize`：保护公式/链接/引用 Token，转换 MediaWiki 结构，生成正文输入并严格最终化输出。
5. `eom-zh-local-draft.js`：离线草稿辅助，不代表审校完成。
6. `eom-zh-normalize-output.js`：只读审计或显式规范化，检查 schema、Token、标题、issues 和 UTF-8。
7. `eom-zh-package.js`：只从完整输出生成不可变 ready 发布包和 SHA-256 清单。
8. `eom-zh-release-import.js`：主机内使用 `PageStore` 分批导入，断点、备份、create-only/overwrite 隔离。
9. `eom-zh-import.js`：发布导入器入口包装。
10. `import-eom-zh-ubuntu.sh`、`push-eom-zh.ps1`：停止服务、本地/远端校验、传输、导入、重启和 doctor。

截至 2026-08-23 checkpoint：标题 `9985/9985`，prepared `8419/8419`，正文仅完成 356 条，仍有结构化审校阻塞，未执行全量数据库导入。后续模型不得把这个 checkpoint 描述为已发布完成。

## 24. 运维工具索引

| 工具 | 作用 |
| --- | --- |
| `start-hybrid.js` | 统一启动/停止/重启/状态、迁移、端口和子进程生命周期。 |
| `setup-community-stack.js` | 生成栈配置、固定版本/校验和安装 Centrifugo。 |
| `runtime-env.js` | 从站点配置和 `.env` 计算唯一有效运行环境。 |
| `config.js` | `config:show/config:validate`，只显示密钥是否配置。 |
| `run-php-tool.js` | 使用项目选定 PHP 调用 Webman 工具。 |
| `production-doctor.js` | URL、权限、进程、端口、HTTP/WSS、Nginx 和目录诊断；可显式 repair。 |
| `migrate-server.js` | 本地迁云/换域名，备份并统一 site/env/stack/Centrifugo/systemd 配置。 |
| `install-service.js` | 生成并应用 systemd/Nginx/环境配置，使用最小权限。 |
| `install-ubuntu.sh` | Ubuntu 一键安装依赖、PHP、Composer、Node、服务和配置。 |
| `update.js` | 预检、停写、checkpoint、完整备份、Git/本地包更新、禁脚本安装、迁移、检查、启动、烟雾测试和协议 v2 自更新续跑。 |
| `create-release-manifest.js` | 发布文件清单、SHA-256、Git commit 和可选签名。 |
| `recover-admin.js` | 调用受控管理员恢复流程。 |
| `sync-realtime-assets.js` | 同步固定版本 Centrifuge 浏览器资源。 |
| `sync-vendor-plugins.js` | 同步已登记上游插件审查缓存。 |

`webman-backend/tools`：

- `migrate.php`、`migrate-secrets.php`：Schema 和秘密迁移。
- `doctor.php`：只读数据库/环境诊断。
- `repair.php`：显式修复。
- `database.php`：数据库工具公共入口。
- `recover-admin.php`：管理员恢复。
- `import-legacy-passport.php`：一次性旧 Passport 导入。
- `check.php`、`check-messaging.php`、`check-native-community.php`、`check-selections.php`、`check-seo.php`：PHP 侧回归。
- `contention-worker.php`：SQLite 多进程竞争测试 worker。

## 25. 自动检查和 CI

`npm run check` 是发布前基础门禁，包含语法检查以及 UI、文案、权限、备份、SEO、Webman 等执行测试。

专项命令：

- `check:webman`：Webman 路由、基础、消息、划词、社区和语法。
- `check:markdown`、`check:citations`、`check:models`：渲染、引用和数学插件。
- `check:search`、`check:knowledge`、`check:v08`：搜索、链接、移动、分类和导航。
- `check:reviews`、`check:v09`、`check:v10`：稳定审阅、翻译质量、组织共识。
- `check:community`、`check:comments`、`check:favorites`、`check:messages`：业务功能。
- `check:runtime`、`check:performance`、`check:contention`：WAL、FTS 恢复、指标、预算和并发写。
- `check:hardening`、`check:paths`、`check:secrets`、`check:security`、`check:authorization`：XSS、路径、秘密、认证和权限矩阵。
- `check:deployment`、`check:seo`、`check:backup`、`check:import`：生产部署和数据可恢复性。
- `check:hooks`：Manifest、配置迁移、Hook 权限和服务端默认不执行。
- `check:ui`、`check:copy`：三栏布局、移动端、组件边界和中文操作文案。
- `check:eom-*`：EoM 原始归档、转换、发布包和导入隔离。

`.github/workflows/security.yml` 在 push、PR 和定时任务上执行秘密扫描、硬化、部署、Composer 无脚本/无插件安装与 audit、完整 npm 检查、SQLite 竞争、干净安装、重复迁移、doctor、配置校验和更新预检。

## 26. 安全和可靠性不变量

后续修改不得破坏：

1. Node 兼容层和 Centrifugo API 只监听回环。
2. 生产必须使用 HTTPS、强 `APP_SECRET`、显式可信 Origin 和独立实时密钥。
3. 外部请求不能伪造内部身份头；Legacy Proxy 必须重新签发内部身份。
4. SQLite 单机只使用一个 Webman 写 worker。
5. Markdown、Community HTML、URL、附件和错误输出必须净化。
6. 自定义 JS 禁止；自定义 CSS 只允许受控属性/URL。
7. 上传必须检查扩展名、MIME、magic bytes、解码、像素/压缩包预算、配额和磁盘余量。
8. 插件上游缓存不得直接执行服务端代码或公开为静态目录。
9. 备份恢复、词条路径、插件路径和静态文件必须拒绝 traversal/symlink 逃逸。
10. SMTP 必须阻止内网/保留地址和 DNS 漂移 SSRF。
11. 日志和指标不得记录密码、Token、Cookie、邮箱、正文、搜索词或原始 IP。
12. FTS、推荐、缓存和实时传输都是派生/传输层，不能成为正文或消息事实来源。
13. 数据迁移必须可重复执行；更新失败时服务保持停止并留下报告，不能伪装成功。

## 27. 配置模型

`config/site.config.json` 保存站点层配置：品牌、公开 URL、部署模式、语言、默认页、许可、SEO、MathJax、CDN/图标/自定义 CSS、编辑策略、Passport 数据库、请求防护、SMTP 和插件设置。

`webman-backend/.env` 保存运行和秘密：APP/公共 URL、Webman worker、数据库连接、Session、可信来源/代理、Legacy Proxy、消息附件、配额、Centrifugo、签名键和安全预算。

优先级原则：持久 `site.config.json.publicUrl` 是站点事实来源，显式 `WIKIST_PUBLIC_URL` 可作为运行覆盖；工具会检查 APP_URL、可信来源、Cookie、WSS、Nginx 和 systemd 是否一致。

## 28. 目录和文档索引

### 28.1 顶层目录

- `config/`：站点配置示例和部署生成配置。
- `content/`：页面、修订、删除归档和审核快照。
- `data/`：数据库、PID、栈配置、备份、升级、导入状态和附件。
- `docs/`：产品、架构、功能、部署、升级和安全文档。
- `logs/`：运行日志。
- `plugins/`：内置插件清单/客户端模块及 vendor 审查缓存。
- `public/`：SPA、Passport、安装器、CSS、JS、图像和浏览器 vendor。
- `src/`：Node 内容兼容核心。
- `tools/`：Node/PowerShell/Bash 运维、测试和离线导入工具。
- `webman-backend/`：PHP 公网业务后端、迁移、Schema、工具和 Composer 依赖。

### 28.2 文档职责

- `ARCHITECTURE.md`：官方高层架构和设计立场。
- `CODEBASE_REFERENCE.md`：本文，代码级总索引。
- `design-system.md`：视觉变量和布局护栏。
- `INSTALL.md`、`PRODUCTION_TROUBLESHOOTING.md`：部署、Nginx、升级和故障诊断。
- `WEBMAN_MIGRATION.md`、`LEGACY_MATRIX.md`：Webman/Node 所有权迁移。
- `PASSPORT.md`、`REALTIME_MESSAGING.md`、`NATIVE_COMMUNITY.md`：身份、通信、问答。
- `WRITING_COMMONS.md`：组织、任务、论坛和社区共识。
- `KNOWLEDGE_NAVIGATION.md`、`SEARCH_FTS5.md`、`SEARCH_ENGINE_INDEXING.md`：知识图、搜索和 SEO。
- `REVISION_REVIEW.md`、`TRANSLATION_REVIEW.md`、`TRANSLATION_QUALITY.md`：审阅与翻译。
- `CITATIONS.md`、`CONTENT_QUALITY.md`、`wikist-entry-syntax.md`：写作、来源和全部词条语法。
- `PLUGIN_HOOKS.md`、`plugins/README.md`：插件执行模型和 Hook。
- `RUNTIME_RELIABILITY.md`、`HARDENING_ACCEPTANCE_2026-08-16.md`、`SECURITY.md`：可靠性、安全验收和披露。
- `RELEASE_*`、`UPGRADE_CHANGELOG.md`：发布与历史变更。
- `ROADMAP.md`：已交付与规划混合文档；阅读时必须看每节的 Delivered 标记。
- `eom-*.md`：EoM 离线语料状态、打包和导入，不是在线产品功能完成证明。

## 29. 已实现与尚未实现

已经实现：稳定版本审阅、结构化引用、关注通知、别名/重定向/消歧、安全移动、分类/主题、数学元数据、翻译记忆/术语/源变化、SQLite FTS5、受控 Hook、组织/任务/论坛/共识、统一消息、Native Community、划词批注、SEO HTML、备份恢复和完整部署工具。

仍属于后续方向：

- 按 revision/content hash 的持久 Markdown HTML 缓存。
- 本地响应式图片变体和完整媒体处理流水线。
- 更完整的 MediaWiki XML/Wiki.js 交换适配器。
- 更丰富的语言感知标题/链接预览和翻译覆盖报表。
- 更完整的公开质量治理指标。
- 任意第三方服务端插件执行。
- 分布式数据库、消息队列、Elasticsearch、图数据库等大规模基础设施。

不要因为 Roadmap 出现某个标题就假设已经实现；以代码、迁移、路由和自动检查四者为准。

## 30. 当前工作区注意事项

本文生成时工作区已有未提交改动，主要涉及：

- 高级搜索配置与搜索索引。
- 前端 `app.js/styles.css/index.html`。
- 插件注册表。
- Native Community 服务及检查。
- EoM 中文转换、打包、发布导入工具和文档。

这些改动不是本文创建过程产生的，维护者不得用 reset/checkout 覆盖。当前 `.gitignore` 另包含 Codex 临时过程文件规则。

## 31. 后续模型的推荐阅读顺序

1. 本文和 `docs/ARCHITECTURE.md`。
2. `package.json`、`tools/start-hybrid.js`、`webman-backend/config/route.php`。
3. 与任务相关的 Webman Controller -> Service -> Repository。
4. 涉及词条时读 `PageStore`、`markdown.js`、`src/server/app.js` 对应路由。
5. 涉及 UI 时从 `route()` 找 `render*()`，再读 `styles.css` 和 `design-system.css`。
6. 涉及数据库时同时检查基准 Schema、全部后续 migration 和 SQLite/MySQL 双实现。
7. 涉及权限时同时检查路由中间件、Service assert、数据库约束和 `check:authorization`。
8. 修改后运行最小专项检查，再运行 `npm run check`；数据库/部署/安全变更还要运行对应专项门禁。

## 32. 修改代码时的判断规则

- 新身份、消息、问答能力优先进入 Webman，不再扩张 Node Passport 兼容面。
- 新词条文件能力应通过 `PageStore`，不要在路由里直接拼文件路径。
- 新数据库行为应通过 Service/Repository 和迁移，兼顾 SQLite/MySQL。
- 新前端页面接入统一 Hash Router、导航、错误处理、route generation 和 hydration。
- 新视觉样式先判断是布局还是皮肤；布局写 `styles.css`，皮肤写 design system，并更新 UI 检查契约。
- 新插件能力必须声明 Hook 和 permission；不得自动执行 `serverModule`。
- 新缓存/索引必须可重建且不能取代 Markdown/消息事实来源。
- 新后台功能必须区分 `senior_editor` 与 `admin`，敏感系统操作只给管理员。
- 新批量工具必须支持 dry-run、断点、原子写、校验、备份和明确失败状态。

这份参考的目标不是替代源码，而是让下一位维护者知道应该从哪里读、哪些边界不能跨、哪些功能已经存在，以及一次修改会波及哪些数据、API、UI 和检查。

## 33. Webman 精确文件索引

### 33.1 基础与领域文件

| 文件 | 作用 |
| --- | --- |
| `webman-backend/app/functions.php` | Webman 应用级公共函数加载点。 |
| `webman-backend/app/http/ApiResponse.php` | 统一成功/失败 JSON Envelope、状态码和错误码。 |
| `webman-backend/app/domain/passport/UserIdentity.php` | 当前认证用户的不可变领域身份和能力读取。 |
| `webman-backend/app/domain/passport/RolePolicy.php` | 角色顺序、能力和角色合法性判断。 |
| `webman-backend/app/exception/ApiException.php` | 带 HTTP 状态、业务错误码和详情的 API 异常。 |
| `webman-backend/app/exception/Handler.php` | 全局异常记录和生产脱敏响应。 |

### 33.2 Controller 文件

| 文件 | 作用 |
| --- | --- |
| `FrontendController.php` | 主 SPA HTML。 |
| `PassportPageController.php` | 独立 Passport HTML。 |
| `HealthController.php` | `/api/health`、live、ready。 |
| `PassportController.php` | CAPTCHA、登录注册、邮箱、密码、资料、2FA 和实时票据。 |
| `MessagingController.php` | 会话、消息、成员、偏好、在线、附件、知识建议、实时 Token。 |
| `CommunityQaController.php` | Native Community 全部公开与认证动作。 |
| `SelectionController.php` | 划词 marker、批注、点赞和活动。 |
| `AchievementController.php` | 用户成就列表和公开摘要。 |
| `SeoController.php` | 公开目录、详情 HTML、robots 和 Sitemap。 |
| `SseController.php` | 认证 SSE 事件流。 |
| `AdminUserController.php` | 管理员用户列表和更新。 |
| `LegacyProxyController.php` | 受限回环兼容代理。 |

### 33.3 Service 文件

| 文件 | 作用 |
| --- | --- |
| `AchievementService.php` | 从站内贡献同步徽章，提供分页和公开摘要。 |
| `AttachmentSecurityService.php` | MIME/magic/解码、容量、配额、过期附件和下载文件名。 |
| `AuthService.php` | 当前身份、登录、注册和退出。 |
| `BehaviorCaptchaService.php` | 行为轨迹 CAPTCHA 创建、校验和一次性证明。 |
| `CaptchaRateLimiter.php` | CAPTCHA 频率限制。 |
| `CaptchaService.php` | 传统图片/问题 CAPTCHA 兼容服务。 |
| `CentrifugoPublisher.php` | 服务端 publish、presence、断开用户。 |
| `CentrifugoTokenService.php` | 连接和频道订阅 JWT。 |
| `CommunityAttachmentService.php` | 问答附件保存、绑定、鉴权和响应数据。 |
| `CommunityEventService.php` | 问答事件、通知、知识图、声望和 outbox 联动。 |
| `CommunityMarkdownService.php` | CommonMark 渲染和 HTML 净化。 |
| `CommunityPermissionService.php` | 空间可见性和问答写/删/关闭/采纳/投票/审核权限。 |
| `CommunityQaService.php` | Controller 面向的问答门面。 |
| `KnowledgeObjectId.php` | 规范知识对象类型和全局 ID。 |
| `KnowledgeObjectResolver.php` | 批量解析/建议词条、问题、回答、组织和用户。 |
| `LoginRateLimiter.php` | 登录共享限流和失败记录。 |
| `MailService.php` | Webman 邮件模板、SMTP 目标和发送。 |
| `MessagingAttachmentService.php` | 消息附件上传、绑定、下载鉴权和清理。 |
| `MessagingChannels.php` | 用户/会话/系统 Centrifugo 频道命名。 |
| `MessagingPermissionService.php` | 会话读取、发言、管理、成员和在线状态权限。 |
| `MessagingService.php` | 统一消息核心业务和 outbox 写入。 |
| `NativeCommunityService.php` | 原生问答主业务实现与事务编排。 |
| `OperationalMetrics.php` | Webman 运行、数据库锁和业务计时指标。 |
| `PassportSecurityService.php` | 邮箱、密码重置、2FA、恢复码、安全版本和会话撤销。 |
| `PasswordService.php` | 密码哈希、验证、dummy hash 和 rehash。 |
| `QrCodeService.php` | TOTP 设置二维码生成。 |
| `RealtimeSecurityService.php` | 实时频道和身份安全版本校验。 |
| `RealtimeTicketService.php` | 旧网关短时连接票据。 |
| `RequestIpService.php` | 只信任配置 CIDR 的客户端地址解析。 |
| `SecretCipher.php` | 2FA 等敏感字段加密。 |
| `SelectionService.php` | 文本选择解析、重定位、marker、批注和活动。 |
| `SensitiveDataRedactor.php` | PHP 日志/审计敏感字段脱敏。 |
| `SeoContentService.php` | 聚合公开 Wiki、问答、讨论和 Sitemap 数据。 |
| `SeoPageRenderer.php` | 安全、可抓取的服务端阅读 HTML。 |
| `SqliteWriteGuard.php` | SQLite 写事务、busy 检测、有限抖动重试和指标。 |
| `TotpService.php` | TOTP 密钥、验证码和恢复码辅助。 |

### 33.4 Repository 文件

| 文件 | 作用 |
| --- | --- |
| `AuditRepository.php` | 审计写入和保留期清理。 |
| `CommunityRepository.php` | 问答、标签、投票、修订、声望、审核、附件等 SQL。 |
| `CompatibilitySessionRepository.php` | 从旧 Passport Cookie 恢复兼容会话。 |
| `KnowledgeGraphRepository.php` | 知识对象 upsert、关系和反向查询。 |
| `MessagingRepository.php` | 会话、消息、读状态、成员、附件、引用、在线和 outbox SQL。 |
| `PassportTokenRepository.php` | 一次性 Token 创建、查询和原子消费。 |
| `SelectionRepository.php` | 选择器、高亮、评论、点赞和活动 SQL。 |
| `SiteConfigRepository.php` | 安全读取站点配置及公开字段。 |
| `UserRepository.php` | 用户、角色、资料、安全版本和会话状态。 |

### 33.5 Middleware、Process 和配置文件

- `middleware/RequestContextMiddleware.php`：请求 ID、上下文和计时。
- `middleware/TrustedOriginMiddleware.php`：Origin、CSRF 和写请求来源。
- `middleware/AuthContextMiddleware.php`：身份恢复。
- `middleware/SecurityHeadersMiddleware.php`：CSP/HSTS 等。
- `middleware/RequireAuthMiddleware.php`、`RequireAdminMiddleware.php`：认证/管理员门禁。
- `middleware/StaticFile.php`：Webman 静态缓存响应。
- `process/Http.php`：Webman HTTP handler。
- `process/Monitor.php`：开发文件和内存监控。
- `process/RealtimeGateway.php`：旧 WebSocket。
- `process/MessagingOutboxProcess.php`：Centrifugo outbox 消费。
- `config/route.php`：全部公网路由和 fallback。
- `config/middleware.php`：全局中间件顺序。
- `config/process.php`：worker 数、监听和后台进程。
- `config/wikist.php`：Wikist 业务、Legacy、Messaging、Community、附件和 Centrifugo 配置。
- `config/database.php`：SQLite/MySQL 连接、WAL/busy timeout/pool。
- `config/session.php`：Session 驱动、Cookie、安全和生命周期。
- `config/server.php`、`app.php`、`bootstrap.php`、`autoload.php`：Webman 运行基础。
- `config/static.php`、`view.php`、`translation.php`：静态、模板和语言。
- `config/log.php`、`exception.php`：日志和异常。
- `config/cache.php`、`redis.php`：可选缓存/Redis；不是基线业务依赖。
- `config/container.php`、`dependence.php`：容器和依赖绑定。
- `config/centrifugo.example.json`：实时服务器安全示例。
- `config/plugin/webman/*`：Webman Console、Validation、Redis Queue 包的标准配置；Redis Queue 未作为 Wikist 基线消息事实来源。

## 34. 数据库迁移序列

| 迁移 | 作用 |
| --- | --- |
| `0002_import_legacy_messaging.php` | 导入旧消息并建立统一 Messaging 初始结构/映射。 |
| `0003_messaging_presence.php` | 用户在线状态。 |
| `0004_messaging_presence_leases.php` | 多标签/连接 Presence lease。 |
| `0005_messaging_preferences_and_moderation.php` | 偏好、关注、自动回复和会话禁言。 |
| `0006_content_selections.php` | 划词、高亮、批注和点赞。 |
| `0007_selection_activities.php` | 划词复制/引用等活动。 |
| `0008_selection_comment_replies.php` | 批注回复结构升级。 |
| `0009_knowledge_objects.php` | 跨域知识对象和关系。 |
| `0010_native_community.php` | 原生问答完整 Schema。 |
| `0011_community_answer_invites.php` | 邀请回答。 |
| `0012_quiet_reaction_activity.php` | 降低轻量反应活动噪声。 |
| `0013_remove_answer_bridge.php` | 移除旧回答桥接边界。 |
| `0014_site_achievements.php` | 全站成就同步状态。 |
| `0015_community_question_sources.php` | 问题结构化来源。 |
| `0016_organization_forum_knowledge.php` | 组织论坛历史内容写入统一知识图。 |
| `0017_passport_security_hardening.php` | Passport 安全状态与加固字段。 |
| `0018_legacy_compatibility_schema.php` | Node 兼容仍需的表/字段和搜索状态。 |
| `0019_shared_security_limits.php` | 跨 Webman worker/请求的共享限流。 |
| `0020_security_invariants.php` | 最后管理员、最后 Owner、角色和引用等数据库约束/触发器。 |
| `0021_presence_privacy.php` | 在线状态隐私字段与默认策略。 |
| `0022_open_organization_community.php` | 组织社区开放/可见性能力更新。 |

基准文件 `database/schema/wikist.sqlite.sql`、`wikist.mysql.sql` 用于新安装；`wikist.legacy.sqlite.sql` 只用于兼容/迁移测试。任何 Schema 修改都必须同步新安装基准、增量 migration 和 SQLite/MySQL 方言。

## 35. 前端和插件精确文件索引

### 35.1 Public 文件

- `public/index.html`：SPA Shell 和静态资源版本号。
- `public/assets/app.js`：主应用 Router、页面和跨域 UI 状态。
- `public/assets/styles.css`：全站布局与业务组件。
- `public/assets/design-system.css`：语义皮肤和组件状态。
- `public/assets/community-qa.js`、`community-qa.css`：Native Community 客户端。
- `public/assets/selection-toolbar.js`、`selection-toolbar.css`：划词交互。
- `public/install.html`、`assets/install.js`、`assets/install.css`：安装器。
- `public/passport/index.html`、`passport/passport.js`、`passport/passport.css`：独立通行证。
- `public/assets/seo-reader.css`：SEO 服务端页面。
- `public/assets/function-plot-check.html`：函数图浏览器加载/渲染检查页。
- `public/assets/wikist-logo.png`：完整 Logo；`wikist-icon.png`：应用图标；`wikist-emblem.svg`：安装/品牌徽记。
- `public/passport/assets/passport-cn.ttf`：Passport 中文展示字体。
- `public/passport/assets/themes/*.jpg`：Passport 可选背景。
- `public/uploads/.gitkeep`：站点本地上传目录占位，真实上传被 Git 忽略。
- `public/assets/vendor/centrifuge/*`：固定版本浏览器实时客户端及说明/许可。
- `public/assets/vendor/sweetalert2/*`：固定版本弹窗库、Wikist adapter、说明和许可。

### 35.2 插件执行文件

- `plugins/wikist-cosmic-experience/cosmic.mjs`：Canvas 开场、登录黑洞和标题粒子，处理 DPR、强度和 reduced motion。
- `plugins/wikist-geometry-board/geometry.mjs`：加载 JSXGraph 并 hydration 几何占位。
- `plugins/wikist-math-chart/chart.mjs`：加载 Chart.js 并 hydration 数据图。
- `plugins/wikist-plugin-hooks/hooks.mjs`：注册受权限保护的后台插件面板示例。
- 函数图和魔法词的服务端解析位于 `plugin-registry.js`；函数图客户端还由 `app.js` hydration。
- 每个插件目录的 `plugin.json` 是名称、版本、类型、语法、配置、Hook、权限和入口的唯一 Manifest。

## 36. 检查脚本逐文件索引

| 文件 | 验证重点 |
| --- | --- |
| `check-authorization-matrix.js` | 角色、敏感后台和对象权限矩阵。 |
| `check-backup-features.js` | v2 包、哈希、数据库快照、恢复和压缩。 |
| `check-citation-features.js` | 引用解析、编号、质量和错误输入。 |
| `check-comment-rating-features.js` | 评论层级、删除权、评分身份和统计。 |
| `check-deployment-hardening.js` | URL、端口、服务、更新预检和生产配置。 |
| `check-favorite-features.js` | 收藏写入、分页和用户边界。 |
| `check-hardening-boundaries.js` | XSS、病理 Markdown、URL 和浏览器边界。 |
| `check-import-export-features.js` | Wikist/Wikipedia 转换与覆盖规则。 |
| `check-knowledge-features.js` | 链接、别名、缺失/孤立报告和导航。 |
| `check-markdown-features.js` | 全部 Markdown 扩展语法。 |
| `check-math-modeling-features.js` | 函数图、几何和图表配置预算。 |
| `check-message-priority-features.js` | 旧消息优先级和收件箱兼容。 |
| `check-native-community.js` | 调用 PHP 原生社区验收。 |
| `check-page-performance-features.js` | 页面列表/摘要、缓存和大站点预算。 |
| `check-path-security.js` | traversal、symlink 和允许根目录。 |
| `check-plugin-hooks.js` | Hook、权限、Schema、迁移和不执行服务端模块。 |
| `check-review-features.js` | 稳定快照、意见、diff 和队列。 |
| `check-runtime-reliability.js` | WAL、FTS 故障、指标、限流和安装令牌。 |
| `check-search-features.js` | 中文、单字概念、模糊、前缀、过滤、建议和 FTS。 |
| `check-secrets.js` | 仓库秘密和危险默认值。 |
| `check-security-email-features.js` | 邮箱验证、重置、2FA 和 SMTP 安全。 |
| `check-seo-features.js` | 可抓取页面、canonical、robots 和 Sitemap。 |
| `check-sqlite-contention.js` | 多进程 SQLite 写竞争和最终计数。 |
| `check-ui-copy.js` | 用户操作文案、遗留词和一致性。 |
| `check-ui-layout.js` | 设计系统边界、三栏、移动端、后台和文本溢出。 |
| `check-v08-knowledge-features.js` | v0.8 移动、分类、元数据和语言链接。 |
| `check-v09-translation-quality-features.js` | 记忆、术语、源变化和权限。 |
| `check-v10-community-features.js` | 组织、任务、论坛、通知和阈值共识。 |
| `check-webman.js` | PHP 语法、路由、身份、消息、划词、社区和迁移边界。 |
| `legacy-test-fixtures.js` | 为仍需 Node 兼容 Store 的测试创建隔离用户/会话。 |
| `check-eom-archiver.js` | EoM 原始归档结构、校验和关系。 |
| `check-eom-zh-pipeline.js` | 标题/正文转换、Token 和审计流水线。 |
| `check-eom-zh-release.js` | ready 包、清单、断点、导入隔离和拒绝条件。 |
| `eom-zh-debug-preflight.js` | EoM 当前工作目录和中间产物的只读诊断。 |
| `eom-zh-status.js` | 汇总各分片、状态、缺失和阻塞项。 |
| `eom-zh-validate.js` | 最终词条包结构、Markdown、引用和来源字段。 |
| `eom-zh-title-overrides.json` | 已人工确认的高置信标题修正，不是运行生成缓存。 |

辅助启动脚本：`tools/run-wikist-server.cmd` 是 Windows 统一入口，`tools/start.ps1` 和 `start-8901.ps1` 是本地调试包装；生产仍以 `start-hybrid.js` 和服务管理器为准。
