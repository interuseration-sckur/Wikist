# Wikist Passport

Wikist Passport 是 Wikist 唯一的账号与认证中心。当前公开入口、会话、验证码、登录注册、邮箱验证、密码恢复、TOTP 和用户管理均由 Webman 负责；Node 兼容服务不能创建账号或公开认证接口。

## 页面入口

- `/passport?mode=login`：登录，支持用户名或邮箱及可选 TOTP。
- `/passport?mode=register`：注册；首次安装会自动切换为首位管理员初始化。
- `/passport?mode=forgot`：发送密码重置邮件。
- `/passport?mode=reset&token=...`：使用一次性令牌设置新密码。
- `/passport?mode=verify&token=...`：验证绑定邮箱。

旧地址 `#/login`、`#/register`、`#/forgot-password`、`#/reset-password/...` 与 `#/verify-email/...` 会自动进入对应的新 Passport 页面。页面继承原 Passport 的场景切换、八套内置背景、自定义背景与强调色，并完整适配桌面、平板、手机及深浅主题。

## 人机验证

Passport 默认提供两种完全本地化的行为验证码，由服务端在每次生成时随机选择，浏览器不提供类型切换入口：

- 滑块拼图：服务端生成缺口、校验横向坐标与容错范围。
- 按序点选：服务端生成汉字或符号序列并校验点选顺序。

实现基于 `fastknife/ajcaptcha`，图片、字体、缓存与校验均留在本站，不再依赖旧模板中的 `captcha.sckur.com` iframe。服务端会把随机类型与原始令牌的 HMAC 绑定到当前 Session，检查时忽略客户端提交的类型并消费该令牌，避免类型篡改和重放。校验成功后签发与当前浏览器 Session 绑定的单次凭证，登录、注册或找回密码消费后立即失效，默认有效期 5 分钟。旧算术验证码 API 暂时保留为兼容回退。

行为验证码需要 PHP GD 与 OpenSSL。默认每个来源每分钟最多请求 40 次，可通过 `CAPTCHA_ATTEMPTS_PER_MINUTE` 调整，但不能低于 12。

## 数据与兼容

默认数据库仍为：

```text
data/wikist.sqlite
```

Webman 直接复用 Wikist 的 `users`、`sessions` 与 `passport_tokens` 等表，不创建第二套账号库。旧 `wikist_passport` Session 在迁移期可继续识别；新 Webman 登录也会创建兼容会话，使尚未迁移的 Node API 看到同一用户。

旧 Node scrypt 密码只通过回环地址和每次启动随机生成的内部令牌校验一次。校验成功后 Webman 立即把密码升级为 PHP 当前推荐哈希，浏览器无法访问该内部桥。

## 安全能力

- 用户名或邮箱登录，注册时检查用户名与邮箱冲突。
- HttpOnly、SameSite Session；登录后重新生成 Session ID。
- 可选邮箱验证登录门槛与 SMTP 验证邮件。
- 短时、单次、哈希存储的邮箱验证和密码重置令牌。
- 用户可选 TOTP 二次验证；设置接口使用 `BaconQrCode` 在内存中生成标准 `otpauth://` PNG 二维码，同时保留可横向滚动的手动密钥和配置链接。
- TOTP 密钥使用站点密钥加密保存，只有输入首个有效动态码后才会启用；设置响应使用 `Cache-Control: no-store`，二维码不写入磁盘。
- 密码修改或重置后清理旧会话。
- 禁用账号在登录页显示明确的阻断提示，公开主页数据仍按站点规则保留。
- 登录和验证码分别限速；写请求执行可信来源检查。

## 主要 API

- `GET /api/passport/captcha/behavior`（服务端随机返回 `blockPuzzle` 或 `clickWord`；旧 `type` 查询参数会被安全忽略）
- `POST /api/passport/captcha/behavior/check`
- `GET /api/passport/availability`
- `POST /api/passport/login`
- `POST /api/passport/register`
- `POST /api/passport/logout`
- `GET /api/passport/me`
- `POST /api/passport/email/verification`
- `POST /api/passport/email/verify`
- `POST /api/passport/password/forgot`
- `POST /api/passport/password/reset`
- `POST /api/passport/password`
- `GET|POST /api/passport/security/...`

所有迁移完成的 JSON 响应带有 `X-Wikist-Backend: webman`，便于部署方区分 Webman 与 Node 兼容流量。
