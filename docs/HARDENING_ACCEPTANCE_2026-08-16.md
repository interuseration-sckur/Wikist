# Wikist Hardening 验收矩阵（2026-08-16）

本文件记录 `Wikist_MASTER_HARDENING_TODO_2026-08-16.txt` 的核验结果。原文是审计输入，不直接作为实现依据；每项先由代码、数据库迁移或可重复测试确认，再决定修复方式。

## 结论

- 清单中的 P0 代码问题已落实到实现与回归测试。
- P1 安全、数据库、部署、更新、备份、附件、插件和可观测性问题已纳入自动检查或运维诊断。
- 真实公网 TLS/WSS、反向代理、操作系统出站策略与生产压力只能在目标服务器验收，已列入发布门禁，不伪装成本地已验证。
- Node 兼容层仍只承载尚未迁入 Webman 的内容引擎。Passport、Messaging、Native Community 的主数据与公开路由均由 Webman 掌管；边界见 `docs/LEGACY_MATRIX.md`。

## 2026-08-16 新增问题 A-K

| 范围 | 处理结果 | 验收证据 |
| --- | --- | --- |
| A SQLite 写锁与 Messaging 500 | SQLite 单机配置固定单 Webman worker；WAL、busy timeout、外键、写入耗时/重试指标、有限抖动重试已启用。GET 不再同步成员或成就写入；在线状态写入合并；Outbox 单消费者、批量领取与保留清理已完成。 | `npm run check:contention`、`npm run check:runtime`、`npm run check:webman`、`npm run doctor -- --sqlite` |
| B 公网站点 URL 唯一事实来源 | `site.config.json.publicUrl` 为持久来源，`WIKIST_PUBLIC_URL` 只作显式运行覆盖；APP_URL、可信来源、Cookie、邮件和 WSS 均由同一运行环境计算。 | `tools/runtime-env.js`、`npm run config:show`、`npm run config:validate` |
| C 本地迁云清理 | 迁移工具会备份后统一站点、Webman、systemd 与实时通信配置，并扫描 localhost、旧域名和旧端口残留。 | `npm run migrate:server`、`npm run check:deployment` |
| D 端口残留 | Webman 8899、Node 兼容层 8900、Centrifugo API 8902 固定分工；后两者只允许回环访问。 | `npm run doctor -- --urls`、部署测试 17 项 |
| E 部署模式 | 安装器支持本地开发、单机生产和高级反向代理；生产服务安装要求公开 HTTPS Origin。 | 安装器、`tools/install-service.js` |
| F 更新识别换地址 | 更新预检会比较持久配置、Webman 环境、systemd 环境与 WSS 地址；不一致时在停止服务前中止并给出迁移命令。 | `node tools/update.js --preflight-only --allow-dirty --yes` |
| G Realtime | 浏览器只连接公开 WSS；Centrifugo API 固定回环；业务数据由 Wikist 保存，Centrifugo 只传输事件；禁用时保留 SSE/刷新兼容路径。 | `docs/REALTIME_MESSAGING.md`、健康接口、部署诊断 |
| H 测试与 CI | 增加 URL/迁云、权限矩阵、路径、秘密、SQLite 竞争、干净安装和重复迁移测试。 | `.github/workflows/security.yml` |
| I 部署体验 | 增加 `config:show`、`config:validate`、`doctor`、`repair`、`migrate:server`、Ubuntu 安装和 systemd 生成入口。 | 对应 CLI 的本地回归 |
| J 合并策略 | 重复审计项按身份、边界、文件、数据、部署、供应链六类收敛，避免重复实现。 | 本矩阵与 `SECURITY.md` |
| K Definition of Done | 代码、迁移、测试、诊断、升级预检和部署验收均成为发布门禁。 | `npm run check` 与 CI |

## 身份、会话与权限（P0-01 至 P1-17）

- 删除用户名管理员白名单、最老用户自动提权和公开注册争抢首任管理员。初始化管理员只能通过短时安装所有权流程创建，并在事务内保证唯一性。
- `senior_editor` 与系统管理员分离；备份恢复、插件上游、站点设置、防火墙、用户管理等敏感入口要求管理员与最近登录确认。
- 词条删除策略执行真实角色判断；组织协调者不能变更 Owner；评论修改/删除重新检查父资源与组织可见性。
- 改密、重置、封禁和二次验证变更都会提升安全版本并注销旧 Session/实时令牌。
- 邮箱变更采用待验证状态；找回密码只接受已验证邮箱；可用性接口不再精确枚举邮箱。
- 二次验证启用前不会覆盖旧密钥，关闭或重置必须验证密码与当前二次验证/恢复码。
- 验证与重置 Token 原子消费；登录不存在用户时执行 dummy hash，降低计时枚举。
- 来源校验不再被 Bearer 前缀绕过，生产环境缺失 Origin/可信来源时 fail closed；敏感写入具备 CSRF Token；Cookie 使用 HttpOnly、SameSite 与生产 Secure。
- 自动验收：`npm run check:authorization`、`npm run check:security`、`npm run check:webman`。
- 评论、收藏、消息、审阅、知识导航、翻译和协作社区测试使用独立数据库夹具，不再通过验证码注册测试用户；验证码仍由认证安全测试单独覆盖，避免无关功能因验证题型变化而阻断升级。

## 内容、XSS 与浏览器边界（P0-18 至 P1-25）

- 删除可执行 `customJs`；自定义 CSS 经过属性、URL 与长度白名单处理。
- Markdown 与 Community HTML 均进行服务端净化和客户端二次净化；所有 URL sink 使用安全 URL 解析。
- 禁止 SVG、HTML、脚本协议与非 raster Data URL；错误页变量经过 HTML 转义。
- Markdown 有输入、嵌套、节点、函数图像系列/采样和 CPU 安全预算。
- 自动验收：`npm run check:hardening`（16 组 XSS 载荷与病理输入）。

## 插件与供应链（P0-26 至 P1-33、P1-90 至 P1-97）

- `plugins/vendor` 只作审查缓存，禁止 HTTP 暴露；静态插件仅允许白名单资源扩展名。
- 插件 Manifest、权限、Hook 与配置 Schema 均校验；服务端 Hook 默认不执行，客户端模块显式声明权限。
- 上游同步限制协议、仓库、大小、超时、磁盘空间与符号链接；不会直接 `require` 第三方服务端代码。
- npm/Composer 安装禁用生命周期脚本与 Composer 插件；依赖锁文件、Dependabot、秘密扫描、发布清单与可选签名已接入。
- Centrifugo、Node 与 Composer 安装均固定来源并校验摘要；GitHub Actions 固定到提交 SHA。
- CSP Report-Only、安全响应头和 HTTPS HSTS 已启用。
- 自动验收：`npm run check:hooks`、`npm run check:secrets`、`npm audit --omit=dev`、CI Composer audit。

## 文件、附件与备份（P0-34 至 P1-52、P0/P1-70）

- 完整备份/恢复只允许系统管理员；恢复目标经过根目录、realpath、符号链接与 NoFollow 检查。
- 备份覆盖配置、词条、修订、数据库和上传文件；运行 Session、验证码、短时 Token 与 Presence 不进入可下载备份。
- 备份支持 HMAC 签名策略、流式生成、体积/文件数上限、并发互斥、冷却、校验和隔离恢复演练。
- 上传执行扩展名/MIME/magic/decode 三层检查、像素上限、ZIP 文件数/展开体积/路径检查、用户配额、待绑定配额、磁盘保留与过期孤儿清理。
- 私有 PDF 默认下载；文件名同时输出安全 ASCII 与 RFC 5987 UTF-8 名称。
- 静态文件、上传、PageStore、插件和恢复路径统一拒绝 traversal 与 symlink 逃逸。
- 自动验收：`npm run check:backup`、`npm run check:paths`、隔离恢复检查。

## 网络、代理与隐私（P1-53 至 P1-57、P1-68 至 P1-75）

- SMTP 目标拒绝本机、内网、链路本地、保留地址及解析漂移，避免后台配置成为 SSRF 通道。
- Legacy Proxy 强制回环、去除外部身份头、限制请求/响应体、拒绝迁移后路由回落。
- 客户端 IP 只信任显式 CIDR 代理链；来源与代理配置不可使用通配符。
- 普通配置 API 不返回密钥；备份和审计日志执行敏感字段脱敏；生产 500 不返回内部异常、路径或 SQL。
- 在线状态默认不公开，只有用户允许且查看者具备关系/会话权限时返回。
- 自动验收：`npm run check:hardening`、`npm run check:authorization`、`npm run check:secrets`。

## 数据库、实时通信与资源控制（P1-58 至 P1-63、P1-76 至 P1-82）

- Webman 是 Passport、Community、Messaging 的 Schema 与数据所有者；Node 兼容层不在启动时建表、迁移、修复或同步迁移模块。
- 数据库触发器/约束保护最后管理员、组织 Owner、角色和引用完整性。
- APP、Legacy、Centrifugo API 与 Token 密钥分离；生产环境禁止默认密钥或 APP_SECRET 回退。
- Centrifugo 生产 Origin 只允许站点真实域名，浏览器不能发布业务事件；安全版本变化会撤销实时令牌。
- 共享数据库限流、请求体上限、备份互斥、搜索/导入/Markdown 预算与 SQLite 指标已启用。
- 自动验收：`npm run check:contention`（6 进程、480 写入）、`npm run check:runtime`、`npm run check:performance`。

## 安装、升级与运行（P0-64 至 P0-89、Release Hardening 附录）

- 生产启动强制随机 APP_SECRET、可信 Origin、HTTPS Cookie、独立实时密钥和内部端口。
- 安装模式有短时所有权密钥、TTL、限流和显式关闭状态，不向普通访客发放站点所有权。
- PHP 实际最低版本为 8.4.1，Composer 锁文件与扩展要求一致；启动日志显示真实 PHP/Composer 路径与版本。
- 更新器在停服务前完成 URL、PHP、Composer、扩展、数据库、磁盘、目录和 systemd 预检；随后停止写入、checkpoint、完整备份、更新代码、禁脚本安装、迁移、检查、启动和烟雾测试。
- 更新器自身变化时通过协议 v2 状态文件交给新版本继续执行；失败时保持服务停止并保留报告，避免假成功。
- systemd 单元使用专用账号、`UMask=0027`、`NoNewPrivileges`、`ProtectSystem=strict` 与最小可写目录。
- Ubuntu 22.04/24.04 一键安装固定 Node 22.18、PHP 8.4、校验 Composer 与 Centrifugo，支持离线 Centrifugo。
- 健康接口分为 live/ready，Doctor 只读，Repair 显式执行修复；配置展示对密钥只显示 configured/missing。
- 自动验收：`npm run check:deployment`、`node tools/update.js --preflight-only --allow-dirty --yes`、Ubuntu CI 矩阵。

## 必须在目标服务器完成的发布验收

这些检查依赖真实域名、证书、网关和操作系统，仓库测试不能代替：

1. `https://站点域名/api/health/ready` 返回 200，且 `wss://站点域名/connection/websocket` 可完成 TLS 握手。
2. 公网无法访问 8900、8902；Centrifugo API 只监听回环。
3. Nginx/Caddy 正确传递 Host、Proto 与受信客户端地址；`npm run doctor -- --urls` 无错误。
4. 以服务账号运行 `npm run doctor -- --all`，确认可写目录归属正确且没有 `777`。
5. 先执行完整备份与隔离还原演练，再执行正式更新；失败演练确认服务不会带着半迁移状态启动。
6. 在预发布环境执行登录、编辑、搜索、消息、问答、上传的 10-50 并发与 500 次刷新测试，并查看 SQLite lock、P95、缓存命中与插件失败指标。
7. 由主机防火墙/容器网络实施出站白名单；应用内 SSRF 校验不能替代 OS egress policy。
8. 若启用独立媒体域，必须保持鉴权、私有附件下载与 CSP 一致。当前安全默认是经鉴权 API 同源下载，不直接公开上传目录。

## 本地验收记录

2026-08-16 已通过：

- `npm run check`
- `npm run check:authorization`
- `npm run check:hardening`
- `npm run check:contention`
- `npm run check:security`
- `npm run check:backup`
- `npm run check:runtime`
- `npm run check:hooks`
- `npm run check:performance`
- `npm run check:secrets`
- `npm run check:deployment`
- `npm run config:validate`
- `npm run doctor -- --all`
- Composer `validate --strict` 与 `check-platform-reqs --no-dev`
- Composer `audit --locked --no-interaction`（未发现安全公告）
- 当前站点数据库迁移重复执行成功；迁移前 SQLite 一致性快照通过 `quick_check`，迁移后 `doctor --all` 为 0 失败、0 警告

GitHub CI 仍保留联网 `composer audit --locked` 作为发布门禁；网络不可用时应报告依赖库不可达，不能将其误报为“无漏洞”。
