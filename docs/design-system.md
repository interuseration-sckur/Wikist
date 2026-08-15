# Wikist Design System

Wikist 的视觉层采用“稳定布局、可替换组件皮肤”的原则。主题更新只能改变颜色、边框质感、圆角、阴影、图标和交互状态；现有页面栏位、模块顺序、尺寸、间距及响应式断点属于业务界面契约。

公共视觉规则位于 `public/assets/design-system.css`。它借鉴 Basecoat 的语义组件、状态和 Dark Mode 组织方式，并把 Magic UI 的边缘高光、层级阴影等效果收敛为原生 CSS；项目不引入 Tailwind、React 或持续运行的装饰动画。

## 视觉语言

- 深色优先，以低对比 Surface、细边框和清晰文字层级承载高密度知识内容。
- 青色用于主要动作与焦点，绿色用于通过和完成，琥珀色用于提醒，玫红色用于危险操作。
- 动画只使用 `transform`、`opacity` 等轻量属性，并遵守 `prefers-reduced-motion`。
- 首页可以保留有限的科技视觉增强；正文、搜索、社区和后台优先保证扫描效率。

## 语义变量

- 页面层级：`--bg`、`--panel`、`--panel-2`、`--panel-3`、`--panel-strong`
- 边界层级：`--line`、`--line-strong`
- 文本层级：`--text`、`--muted`、`--muted-2`
- 状态色：`--cyan`、`--green`、`--amber`、`--rose`
- 交互表面：`--surface-input`、`--surface-hover`、`--surface-overlay`
- 状态底色：`--accent-soft`、`--success-soft`、`--warning-soft`、`--danger-soft`
- 焦点与阴影：`--focus-ring`、`--shadow-soft`、`--shadow`
- 圆角：`--radius-sm`、`--radius`、`--radius-lg`
- 公共组件表面：`--ui-surface-nav`、`--ui-surface-card`、`--ui-surface-control`、`--ui-surface-popover`
- 公共组件边界与阴影：`--ui-border`、`--ui-border-strong`、`--ui-highlight`、`--ui-shadow-control`、`--ui-shadow-card`、`--ui-shadow-popover`

组件不得重新写入与这些变量近似的固定色值。Light Mode 通过同一组语义变量切换，不额外维护一套结构样式。

## 组件状态

按钮、输入框、菜单、Tabs、分页、卡片、表格、Toast 和弹窗必须具备默认、悬停、焦点、激活与禁用状态。键盘焦点统一使用 `--focus-ring`，危险操作统一使用 `--rose` 与 `--danger-soft`。

## 布局护栏

运行 `npm run check:ui` 会检查三栏外壳、内容宽度、编辑器、搜索、评论、后台、移动导航和加载动画 Logo 等关键结构。该检查还会拒绝 `design-system.css` 中的定位、宽高、间距、Grid、Flex 和 Overflow 等布局属性，保证组件皮肤不能悄悄改变页面结构。视觉改造若确实需要修改布局，必须先明确更新界面契约及对应检查项。
