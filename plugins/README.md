# Wikist 插件目录

Wikist 插件采用类似 MediaWiki extensions 的本地目录方式：

1. 在 `plugins/` 下放入一个插件目录，例如 `plugins/my-plugin/`。
2. 在插件目录中创建 `plugin.json`。
3. 重启服务或刷新后台插件管理页，Wikist 会扫描 `plugins/*/plugin.json`。
4. 在后台“插件管理”中启用、配置插件。

最小 `plugin.json` 示例：

```json
{
  "id": "myPlugin",
  "name": "我的插件",
  "type": "extension",
  "version": "1.0.0",
  "source": "local:my-plugin",
  "description": "插件说明",
  "syntax": ["::: my-plugin", ":::"],
  "configKeys": ["enabled"],
  "defaultConfig": { "enabled": true },
  "entry": "manifest-only"
}
```

当前支持三类插件清单：

- `core:*`：由 Wikist 核心提供执行逻辑，例如 `core:functionPlot`、`core:magicWords`、`core:markdownAdvanced`。
- `manifest-only`：进入后台管理、分页、配置、启停，适合先登记插件。
- `clone-ready`：记录高质量上游仓库与接入方向，服务器网络允许时 clone 到 `plugins/vendor/` 后再升级执行入口。


## 客户端模块

可信本地插件可以从清单升级为客户端模块：

```json
{
  "id": "myPlugin",
  "entry": "clientModule",
  "clientModule": "client.js",
  "configKeys": ["enabled"],
  "defaultConfig": { "enabled": true }
}
```

`client.js` 需要放在对应插件目录内，例如 `plugins/my-plugin/client.js`，并导出 `activate(context)` 或默认函数。Wikist 只在后台启用该插件、且 `entry` 明确为 `clientModule` 时加载它。

```js
export function activate({ root, plugin }) {
  root.querySelectorAll(`[data-plugin="${plugin.id}"]`).forEach((node) => {
    node.dataset.ready = "true";
  });
}
```

服务端模块字段 `serverModule` 已预留，当前不会自动执行；需要进入核心启动流程、审查权限边界后再接入。
## 推荐上游仓库

当前已登记：

- `markdown-it`：高性能 CommonMark/GFM 主干。
- `markdown-it-footnote`：脚注。
- `markdown-it-attrs`：块属性与样式参数。
- `markdown-it-task-lists`：GitHub 任务列表。
- `markdown-it-container`：自定义容器块。
- `markdown-it-deflist`：定义列表。

本地缓存目录见 `plugins/vendor/README.md`。

## 安全说明

插件代码属于本地可信代码，和 MediaWiki 扩展一样，安装前应审查来源、许可证、维护状态与权限边界。Wikist 默认只执行 `core:*`，上游仓库清单不会自动执行外部代码。
## 高级搜索插件

- `wikist-advanced-search`：Wikist 内置高级搜索插件层，参考 MiniSearch 的轻量字段索引思路，支持分页、字段权重、前缀匹配、模糊匹配、分类/质量/难度筛选。
- 上游参考仓库：`https://github.com/lucaong/minisearch`。如果服务器能访问 GitHub，可在后台插件管理中同步到 `plugins/vendor/minisearch`。