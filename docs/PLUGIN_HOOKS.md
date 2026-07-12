# 可控插件 Hook API

Wikist 的插件 Hook API 面向可审查的扩展，而不是让 manifest 变成服务端任意代码执行入口。插件必须在 `plugin.json` 中同时声明 Hook 名称与其所需权限；后台会展示声明、权限状态和运行边界。

## 当前 Hook

| Hook | 侧 | 所需权限 | 用途 |
| :--- | :--- | :--- | :--- |
| `markdown.preprocess` | 服务端 | `content:transform` | 在 Markdown 解析前执行受控文本转换。 |
| `markdown.block` | 服务端 | `content:render` | 将声明的围栏块转换为框架认可的 HTML 占位结构。 |
| `search.enhance` | 服务端 | `search:enhance` | 在搜索响应返回前整理结果元数据。 |
| `admin.panel` | 客户端 | `ui:admin-panel` | 注册受后台角色保护的自定义管理页面。 |

服务端 Hook **仅由已经编入 Wikist 核心源码的处理器注册**。即使第三方 manifest 写了 `serverModule`、服务端 Hook 和权限，Wikist 也只会显示“服务端模块已声明”，不会 `require()`、`import()` 或执行它。要让新的服务端处理器可用，维护者必须审查代码并将其显式纳入核心发行版。

客户端模块仍限定为本地 `plugins/<directory>/` 下、manifest 明确标记为 `clientModule` 的可信模块。权限声明是可见的能力契约和管理边界，不是浏览器 JavaScript 的安全沙箱；因此不应把未经审查的第三方代码改为 `clientModule`。

## Manifest 示例

```json
{
  "id": "proofTools",
  "name": "证明工具",
  "entry": "clientModule",
  "clientModule": "proof-tools.mjs",
  "hooks": ["admin.panel"],
  "permissions": ["ui:admin-panel"],
  "configKeys": ["enabled"]
}
```

创建 manifest 时，后台只接受上表中的 Hook 与权限名。未知名称会被拒绝；缺少对应权限的 Hook 会保留为“已阻断”状态，不能注册。

## 配置 Schema 与声明式迁移

`plugin.json` 可声明 `configVersion`、`configSchema` 与 `configMigrations`。Schema 是轻量 JSON Schema 子集，支持对象、字符串、数字 / 整数、布尔值、数组、默认值、枚举、最小 / 最大值与字符串长度；保存后台配置时会先校验，再写入站点配置。

迁移不是 JavaScript。它只能声明字段重命名、默认值与删除字段，因此不会把配置升级变成新的服务端执行入口：

```json
{
  "configVersion": 2,
  "configSchema": {
    "type": "object",
    "properties": {
      "enabled": { "type": "boolean", "default": true },
      "sampleCount": { "type": "integer", "minimum": 1, "maximum": 1000, "default": 24 }
    },
    "additionalProperties": false
  },
  "configMigrations": [
    {
      "from": 1,
      "to": 2,
      "rename": { "samples": "sampleCount" },
      "defaults": { "enabled": true },
      "remove": ["legacyMode"]
    }
  ]
}
```

配置会保存内部版本标记 `__wikistConfigVersion`。启动时和后台保存时都会应用缺失的声明式迁移；校验失败的配置会在健康检查中标出，且不会让外部 `serverModule` 获得执行权限。

## 客户端后台面板

受信任模块可使用加载上下文中的 `hooks` 对象。面板只会在资深编辑或管理员可访问的后台里出现，并且会随着插件停用而从导航中消失。

```js
export function activate(context) {
  context.hooks.register("admin.panel", {
    id: "overview",
    title: "证明工具",
    description: "维护证明模板与校验规则。",
    render({ root, state }) {
      root.textContent = `${state.site.name} 的证明工具`;
    },
  });
}
```

`id` 必须使用字母、数字和短横线。框架会生成独立的后台路由，插件不需要也不能覆盖核心路由。`hooks.allows("admin.panel")` 可用于模块在注册前自检。

## 内置示例与检查

`plugins/wikist-plugin-hooks/` 是一个启用状态下的客户端示例，注册 **后台 -> Hook API** 页面，用于展示当前站点每个插件的 Hook、权限和服务端执行状态。

运行下面的检查可验证 manifest 过滤、权限阻断、服务端不执行边界、Markdown/搜索 Hook 分发以及示例模块发现：

```powershell
npm run check:hooks
```
