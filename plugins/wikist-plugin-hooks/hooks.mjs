function element(tag, className, text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function renderCapability(capability) {
  const chip = element("span", `plugin-hook-chip ${capability.granted ? "declared" : "blocked"}`);
  chip.textContent = `${capability.name} · ${capability.permission}`;
  chip.title = capability.detail || capability.description || "";
  return chip;
}

export function activate(context) {
  if (!context.hooks?.allows("admin.panel")) return null;
  return context.hooks.register("admin.panel", {
    id: "api",
    title: "Hook API",
    description: "查看插件 Hook、权限声明与服务端执行边界。",
    order: 950,
    render({ root, state }) {
      root.replaceChildren();
      const intro = element("div", "plugin-hook-intro");
      intro.append(
        element("strong", "", "受控扩展边界"),
        element("p", "", "服务端模块仅登记，只有已编入 Wikist 核心的 Hook 才会执行；客户端面板需要同时声明 admin.panel 与 ui:admin-panel。"),
      );
      root.appendChild(intro);

      const grid = element("div", "plugin-hook-grid");
      const catalog = state.site?.pluginCatalog || [];
      catalog.forEach((plugin) => {
        const card = element("article", "plugin-hook-card");
        const heading = element("div", "plugin-hook-card-head");
        heading.append(element("strong", "", plugin.name || plugin.id), element("small", "", plugin.id || ""));
        card.appendChild(heading);
        const capabilities = plugin.hookCapabilities || [];
        if (capabilities.length) {
          const chips = element("div", "plugin-hook-list");
          capabilities.forEach((capability) => chips.appendChild(renderCapability(capability)));
          card.appendChild(chips);
        } else {
          card.appendChild(element("small", "plugin-hook-empty", "未声明 Hook"));
        }
        if (plugin.serverModule) card.appendChild(element("small", "plugin-hook-server-note", "服务端模块：仅声明，默认不执行"));
        grid.appendChild(card);
      });
      root.appendChild(grid);
    },
  });
}

export default activate;
