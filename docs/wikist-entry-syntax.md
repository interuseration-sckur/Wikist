# Wikist 词条语法与功能说明

## 1. 文档适用范围

- **源码基线**：Git commit `f6cbbf79795a352d68ad006011c4a41a2a102ea7`，`package.json` 版本 `1.0.3`。
- **检查日期**：2026-08-22。
- **覆盖范围**：词条 Markdown 文件、Front Matter、受控正文解析器、数学公式、链接与知识关系、图片、结构化引用、编辑/审阅/翻译、导入导出和搜索字段。
- **不在范围内**：EoM 抓取器、法律许可判断、站点 UI 说明、评论/问答/通信正文语法，以及尚未接入词条生产链的插件能力。

本文以运行代码、测试、数据库约束和真实词条为依据。Wikist 的主正文解析器是 `src/core/markdown.js` 中的受控解析器，不是完整 CommonMark、MediaWiki 或 Markdown-it 实现。

## 2. 最小可用词条

```markdown
---
title: 群作用
---

# 群作用

群作用描述一个群如何以保持群运算的方式作用在集合上。
```

词条文件保存于 `content/pages/<slug>.md`。`slug` 来自文件路径或 API 路径，不写在 Front Matter 中；空 slug 会归一化为 `home`。底层 `PageStore.savePage()` 只需有效 slug 即可保存，缺少标题时以 slug 代替；前端编辑器要求填写 slug 和标题，因此自动导入也应始终提供二者。正文位于结束分隔线后的 Markdown 区域，元数据位于文件开头的 Front Matter。

可选字段包括摘要、分类、难度、状态、质量、作者、图片、来源、别名、消歧、数学元数据和引用。保存时系统自动设置或保留 `createdAt`，刷新 `updatedAt`，并生成 `revisionId`、渲染后的 `html`、`toc`、`citationStats` 和 `bytes`；这些生成字段不应由转换程序写入正文。

## 3. 完整标准词条示例

下例中的 `source.example.invalid` 是保留域名，导入前必须替换为已核验的真实来源和图片地址。

```markdown
---
title: 群作用
summary: 群作用是群到集合对称变换群的同态，用于统一描述对称性与轨道结构。
categories: [代数学, 群论]
difficulty: 本科
status: review
quality: B
author: EoM 中文译校组
heroImage: https://source.example.invalid/images/group-action.png
importSource: encyclopedia-of-mathematics
importTitle: Group action
importLang: en
importRevision: source-revision-pending
importUrl: https://source.example.invalid/group-action
importFetchedAt: 2026-08-22T00:00:00.000Z
importLicense: 待人工核验
aliases: [group-action-cn]
canonicalNames: [群作用, group action]
classifications: [20-XX]
topic: 数学/代数/群论
prerequisites: [group]
relatedPages: [orbit-stabilizer-theorem]
notation: [G|作用群|全文, X|被作用集合|全文]
references: [{"id":"source-entry","type":"web","authors":["来源作者待核验"],"title":"Group action","url":"https://source.example.invalid/group-action","accessed":"2026-08-22","language":"en","note":"EoM 原词条；作者、许可与修订号待核验"}]
---

# 群作用

群作用把群元素解释为集合上的变换。设群为 $G$，集合为 $X$。

::: definition 群作用
一个左群作用是映射

$$
G\times X\longrightarrow X,\qquad (g,x)\longmapsto g\cdot x,
$$

使得 $e\cdot x=x$ 且 $(gh)\cdot x=g\cdot(h\cdot x)$。
:::

## 等价描述 {#equivalent-description}

群作用等价于群同态 $G\to\operatorname{Sym}(X)$。这一观点把作用与 [[group|群]] 的表示方式联系起来。[@source-entry]

## 例子

1. 群 $G$ 通过左乘作用于自身。
2. 对称群作用于其底层集合。

> 翻译时不得省略作用方向、单位元条件和相容条件。

[[File:https://source.example.invalid/images/group-action.png|right|thumb|320px|alt=群作用示意图|caption=群作用示意图；图片来源待核验]]

## 相关概念

- [[group|群]]
- [[orbit-stabilizer-theorem|轨道-稳定子定理]]
- [外部来源](https://source.example.invalid/group-action)

::: note 来源与翻译
正文由英文来源翻译；原文标题、来源 URL、抓取时间和许可状态记录于元数据。所有“待核验”项在发布稳定版本前必须人工处理。
:::
```

## 4. 词条字段

“可导入”指 `/api/pages/import/wikist` 的 **JSON 包格式**；Markdown 导入模式只接收 slug、title、summary、categories、difficulty、status、quality、author、heroImage、references、body。普通保存仍受站点编辑开关和逐页权限约束。

| 字段 | 是否必填 | 数据类型 | 用途 | 限制 | 实现依据 |
| -- | ---: | ---- | -- | -- | ---- |
| `slug` | 是 | 字符串 | 文件/API 标识及层级路径 | 空值变 `home`；空白变 `-`；禁用 `.`、`..`、控制字符及 `<>:"\|?*`；可含 `/`；JSON 可导入 | `src/core/slug.js::normalizeSlug` |
| `title` | 建议必填 | 字符串 | 页面标题、搜索标题 | 缺省为 slug；导入器截至 120 字符；普通保存未设服务端长度上限 | `PageStore.getPage/savePage`、`parseWikistImport` |
| `summary` | 否 | 字符串 | 顶部摘要、搜索摘要、预览 | 默认空；Markdown 导入截至 220 字符，普通保存未设同等限制 | 同上、`SearchIndex.documentForPage` |
| `body` | 建议必填 | 字符串 | 正文 Markdown | JSON/Markdown 导入最多 4 MiB；渲染默认最多 2 MiB、50000 行，因此默认有效上限取两者较小值，即 2 MiB | `parseWikistImport`、`renderMarkdown` |
| `categories` | 否 | 字符串数组 | 分类目录、关注分类、搜索 | 默认 `[]`；Front Matter 使用单行数组；无统一长度校验 | `PageStore`、`knowledgeSnapshot` |
| `difficulty` | 否 | 字符串 | 难度筛选和页头 | 默认“未分级”；UI 提供入门/本科/研究生/专题/未分级，服务端未限定枚举 | `editorFields`、`PageStore.savePage` |
| `status` | 否 | 字符串 | 内容工作状态和搜索 | 默认 `draft`；UI 使用 `draft/review/stable`；不等同数据库中的已审阅稳定快照 | `PageStore`、`page_stable_revisions` |
| `quality` | 否 | 字符串 | 质量等级、推荐和搜索 | 默认 `C`；UI 使用 `A/B/C/Draft`，服务端未限定枚举 | `PageStore`、`qualityRank` |
| `author` | 否 | 字符串 | 署名和作者关联 | 默认 `Wikist`/贡献者；前端保存通常取会话身份；普通保存 API 对自带值未统一强制覆盖 | `PageStore.savePage`、页面保存路由 |
| `heroImage` | 否 | 字符串 | 词条顶部大图 | URL/路径由前端显示；字段本身没有下载或 MIME 校验 | `PageStore`、`articleHeader` |
| `importSource` | 否 | 字符串 | 来源系统标识 | 默认空；JSON 可导入 | `PageStore` |
| `importTitle` | 否 | 字符串 | 原文标题 | 默认空；JSON 可导入 | `PageStore` |
| `importLang` | 否 | 字符串 | 导入源语言 | 默认空；不同于已发布译文语言 | `PageStore` |
| `importRevision` | 否 | 字符串 | 原来源修订标识 | 读取时转为字符串 | `PageStore` |
| `importUrl` | 否 | 字符串 | 原始页面 URL | PageStore 不验证 URL；转换程序必须验证 | `PageStore` |
| `importFetchedAt` | 否 | 字符串 | 抓取时间 | PageStore 不校验日期格式 | `PageStore` |
| `importLicense` | 否 | 字符串 | 原来源许可记录 | 仅记录，不进行法律判断 | `PageStore` |
| `aliases` | 否 | 字符串数组 | 可替代 slug | 创建者及以上角色可改；别名索引另存 `page_aliases`；不得冲突现有 slug | `syncPageAliases`、页面保存路由 |
| `redirectTarget` | 否 | 字符串 | 重定向到另一词条 | 目标必须存在且不能是自身；权限同别名 | `resolveLivePage`、页面保存路由 |
| `disambiguation` | 否 | 布尔 | 标记消歧页 | 默认 `false` | `PageStore`、`disambiguationPanelHtml` |
| `disambiguationTargets` | 否 | 字符串数组 | `slug|显示名|摘要` | 去重，最多 24 项 | `normalizeDisambiguationTargets` |
| `prerequisites` | 否 | slug 数组 | 前置知识 | 规范化，最多 40 项 | `normalizeSlugList`、`mathematicalMetadataHtml` |
| `relatedPages` | 否 | slug 数组 | 结构化相关词条 | 规范化，最多 40 项；不自动生成反向链接 | 同上 |
| `canonicalNames` | 否 | 字符串数组 | 规范名、跨语言名、搜索身份词 | 最多 40 项，每项 160 字符 | `normalizeTextList`、`SearchIndex` |
| `notation` | 否 | 字符串数组 | `符号|含义|范围` | 最多 48 项；长度依次 80/140/80 | `normalizeNotation` |
| `classifications` | 否 | 字符串数组 | MSC/ACM 等分类号 | 最多 24 项，每项 100 字符 | `PageStore` |
| `topic` | 否 | 字符串 | 主题树路径 | `/` 分层，最多 180 字符 | `normalizeTopic` |
| `references` | 否 | 对象数组 | 结构化来源 | 最多 120 条；Front Matter 必须为单行 JSON 数组 | `citations.js`、`citationInputError` |
| `createdAt` | 自动 | 日期字符串 | 创建时间 | 新建时自动生成，已有值保留 | `PageStore.savePage` |
| `updatedAt` | 自动 | 日期字符串 | 当前保存时间 | 每次保存覆盖；不要写入来源更新时间 | `PageStore.savePage` |

页面译文不写入上述文件。它们存于 SQLite `page_translations`，字段包括 `language`、`source_language`、`title`、`summary`、`source_md`、`translated_md`、`progress`、`status`、译者/审阅者和时间。基础词条默认源语言为 `zh-CN`；自动转换程序如要保留英文原文，仍需走翻译接口或另行保留源文本，不能只写 `importLang`。

## 5. 正文语法

#### 段落与标题

写法：

```text
普通段落的连续行会用空格连接。

## 二级标题 {#custom-id .extra-class}
```

效果：空行分段；`#` 至 `######` 生成标题和目录项。限制：自定义 ID/类仅在 `upstreamAttrs` 启用时生效；自动 ID 最长 80 字符。实现依据：`renderMarkdown`、`slugToId`。

#### 强调与行内扩展

写法：

```text
**粗体** *斜体* ~~删除~~ ==高亮== ^上标^ ~下标~ `行内代码`
```

效果：分别生成强调、删除、高亮、上下标和代码。限制：解析器使用正则，不具备完整 CommonMark 嵌套规则；数学上下标应写在公式中。实现依据：`renderInline`。

#### 列表

写法：

```text
- 无序项
- 第二项

1. 有序项
2. 第二项

- [x] 已完成
- [ ] 未完成
```

效果：生成无序、有序或只读任务列表。限制：任务列表依赖 `upstreamTaskLists`；缩进不会建立可靠的嵌套列表，应使用扁平列表。实现依据：`renderList`。

#### 引用块

写法：

```text
> 引用内容
> 可含受支持的块级语法。
```

效果：生成 `blockquote`，内部递归解析。限制：总嵌套深度最多 16。实现依据：`renderMarkdown`。

#### 代码块

写法：

````text
```javascript
const n = 1;
```
````

效果：生成带语言类名的转义代码块。限制：`function-plot` 等已注册围栏会被插件接管；代码块不执行。实现依据：`renderMarkdown`、`renderPluginFence`。

#### 表格

写法：

```text
| 对象 | 含义 |
| :--- | ---: |
| G | 群 |
```

效果：生成可横向滚动表格并支持左右/居中对齐。限制：行必须以 `|` 开头和结尾，且第二行必须是有效分隔行；单元格内未实现转义竖线。实现依据：`renderTable`。

#### 分隔线

写法：

```text
---
```

效果：生成水平线。限制：文件开头的 `---` 可能开启 Front Matter；正文中需与上下内容分行。实现依据：`renderMarkdown`、`parseFrontMatter`。

#### 定义列表

写法：

```text
轨道
: 元素在群作用下可到达点的集合。
```

效果：生成定义列表。限制：依赖 `upstreamDeflist`；定义行必须以 `: ` 开头。实现依据：`renderDefinitionList`。

#### 语义提示块

写法：

```text
::: theorem 定理名称
定理内容。
:::
```

效果：生成带语义样式的块。内置名称为 `theorem`、`definition`、`example`、`proof`、`note`、`warning`、`tip`、`danger`、`info`，不依赖通用容器插件。限制：围栏至少三个冒号；结束围栏冒号数不得少于开始围栏。实现依据：`renderContainer`。

#### 自定义容器

写法：

```text
:::: spoiler 自定义标题
内容
::::
```

效果：生成通用 `wikist-container-*` 容器。限制：依赖 `upstreamContainer`；它不是可折叠的 `<details>`。实现依据：`renderContainer`。

#### 魔法词和条件函数

写法：

```text
{{SITENAME}} {{PAGENAME}} {{PAGESLUG}} {{CURRENTDATE}}
{{#if: 条件 | 真值 | 假值 }}
{{#ifeq: A | A | 相等 | 不相等 }}
{{#ifexpr: 2 < 3 | 成立 | 不成立 }}
```

效果：渲染前替换站点、页面、日期变量或条件结果。还支持 `TAGLINE`、`CURRENTYEAR`、`CURRENTMONTH`、`CURRENTDAY` 和后台配置的自定义键。限制：依赖 `magicWords`；不是 MediaWiki 模板系统；`#ifexpr` 仅允许受控数字/逻辑表达式，最长 160 字符。实现依据：`applyMagicWords`、`renderParserFunction`。

#### 数学可视化插件块

写法：

```text
::: function-plot
title: Gamma 与单位圆
xDomain: -5, 5
gamma(x)
implicit: x^2 + y^2 = 1
:::

::: geometry
point A: 0, 0
point B: 2, 0
segment A B
:::

::: math-chart
labels: 1, 2, 3
series: a_n | 1, 0.5, 0.25
:::
```

效果：分别生成交互函数图、几何板和折线/散点/柱状数据图。限制：依赖 `functionPlot`、`geometryBoard`、`mathChart`；函数最多 8 组，几何点/形各 24 个，图表数据集 12 组且每组 240 个值；浏览器还需成功加载相应 CDN。实现依据：`parseFunctionPlotBlock`、`parseGeometryBlock`、`parseMathChartBlock` 及 `tools/check-math-modeling-features.js`。

#### 自动目录和锚点

写法：

```text
## 轨道 {#orbit}
[跳到轨道](#orbit)
```

效果：标题产生 `toc` 数据，前端渲染目录；锚点链接在当前页面跳转。限制：没有 `[[TOC]]` 标记；自定义 ID 依赖 `upstreamAttrs`。实现依据：`renderMarkdown`、`renderToc`。

#### 已确认不支持的正文写法

原始 HTML 和 HTML 注释都会被转义；没有通用反斜杠转义规则、专用折叠块、MediaWiki 模板转嵌、自动编号公式、公式交叉引用、嵌套列表保证或正文附件标记。需要显示标记原文时优先使用行内代码或代码块。

## 6. 数学公式

Wikist 后端将 TeX 包装为安全 HTML 占位，浏览器再加载 **MathJax 3 `tex-chtml`** 完成排版；没有 KaTeX。站点默认 CDN 在 `src/core/config.js`，实际地址可由 `config/site.config.json::math.cdn` 修改。

```text
行内：$G/H$ 或 \(G/H\)

独立单行：$$|G|=[G:H]|H|$$

独立多行：
$$
\begin{aligned}
|G| &= [G:H]|H|,\\
[G:H] &= |G|/|H|.
\end{aligned}
$$
```

- 多行显示也可使用 `\[` 与 `\]` 各占一行；同一行的 `$$...$$`、`\[...\]` 会生成行内显示容器。
- Markdown 解析发生在 MathJax 之前；TeX 会先转义 HTML 字符，`_` 不会被误解析为斜体。
- `\begin{aligned}` 等是否可用取决于 MathJax 默认 TeX 包。源码没有自定义允许/禁止环境表、宏表、`\newcommand` 配置、公式编号或 `\ref` 体系，不能在转换程序中假定这些能力。
- MathJax 配置仅确认 `processEscapes: true` 和四类分隔符。后端不执行 TeX，也没有逐命令危险列表；安全边界是正文 HTML 转义和客户端 MathJax。MathJax 加载/排版失败会被前端捕获，页面可能保留原 TeX 占位，不会自动回退为图片。
- JSON 字符串中的反斜杠必须写成 `\\`；Markdown 文件本身直接写 `\`。不要把来源 HTML 的 `<math>` 原样导入，Wikipedia 转换器会先改成上述分隔符。

实现依据：`src/core/markdown.js::renderInline/renderMarkdown`、`public/assets/app.js::ensureMathJax/typesetMath`、`src/core/config.js::DEFAULT_CONFIG.math`。

## 7. 链接和词条关系

| 能力 | 写法或存储 | 行为 |
|---|---|---|
| 内部链接 | `[[group]]`、`[[group|群]]` | 生成 `#/page/<slug>`；显示文字可含行内语法 |
| 缺失词条 | 同上 | 链接保留；前端预览显示未创建，`page_links` 计入缺失词条 |
| 外部链接 | `[名称](https://example.org)`、`<https://example.org>`、裸 HTTP(S) URL | 只放行 HTTP(S)、`mailto:`、站内 hash/绝对路径；其他 href 变 `#` |
| 页内锚点 | `[名称](#heading-id)` | 跳到标题 ID |
| 别名 | Front Matter/API `aliases` + SQLite `page_aliases` | 请求别名时解析到目标词条；不是正文语法 |
| 重定向 | `redirectTarget` | 读取页面时转向一个已存在词条；移动词条可保留旧 slug 重定向 |
| 消歧 | `disambiguation` + `disambiguationTargets` | 前端展示多指向面板 |
| 前置/相关词条 | `prerequisites`、`relatedPages` | 结构化展示，不自动产生正文链接或反向链接 |
| 出链/反向链接 | 正文 `[[...]]` 自动抽取至 `page_links` | 正常保存后增量同步，页面知识区分页展示 |
| 分类/主题 | `categories`、`topic` | 分类目录、主题树；不是上下位词条数据库 |
| 引用关系 | `[@id]` 对应 `references` | 只关联本词条的结构化来源，不等同词条关系 |

链接抽取会忽略 File/Image/Category 命名空间和外部 URL，并把 `[[slug#片段]]` 的关系目标归一为 `slug`；正文渲染没有为跨词条片段链接提供独立保证。别名只有在 `syncPageAliases()` 执行后才进入数据库索引；JSON 导入路由会同步正文链接，但未调用别名同步，这是当前冲突点。

实现依据：`renderInline`、`extractWikiLinks/syncPageLinks/pageKnowledge`、`resolveLivePage`、`mathematicalMetadataHtml`。

## 8. 图片、文件和媒体

支持两种正文图片写法：

```text
![替代文本](https://example.org/image.png "图注"){.right .wrap width=320px}

[[File:/uploads/example.png|right|thumb|320px|alt=替代文本|caption=图注|link=https://example.org]]
```

- URL 可为 `http://`、`https://`、`/`、`./`，或 PNG/JPEG/GIF/WebP 的 base64 `data:image`；远程 SVG URL/本地 SVG 路径可显示，但 **data SVG** 被拒绝。
- 选项支持 `left/right/center/wide/full/inline`、`wrap/nowrap`、`thumb/frame`、`border`、宽度、`alt`、`caption`、`link` 和受限类名。裸数字宽度需为 2 至 4 位，或使用 `px/%/rem/em/ch/vw`。
- 图片生成懒加载元素并接入前端点击预览。远程资源不会因写入词条而自动下载、生成缩略图或校验版权。
- 词条编辑器只有图片 URL/正文语法；现有上传服务属于通信和问答附件，没有确认可供普通词条正文直接上传的专用接口。
- 未发现词条正文的音频、视频、通用文件附件语法。图片 `src` 没有逐页权限层；引用 `/uploads/` 时访问控制取决于对应静态/附件路由。

实现依据：`parseMarkdownImage`、`parseMediaWikiImage`、`sanitizeSrc`、`renderImageFigure`、`bindImageViewer`。

## 9. 引用和参考文献

脚注与结构化引用是两套功能：

```text
脚注正文[^note]

[^note]: 补充说明；依赖 upstreamFootnote。

单条引用 [@hardy1908]
带定位 [@hardy1908, p. 42]
多条引用 [@hardy1908; @noether1921]
待补来源 {{cite-needed|需要原始出处}}
```

`references` 是最多 120 个对象的数组。支持类型 `article`、`book`、`chapter`、`preprint`、`conference`、`thesis`、`web`、`dataset`、`other`；字段为 `id`、`type`、`authors`、`title`、`containerTitle`、`publisher`、`year`、`volume`、`issue`、`pages`、`doi`、`arxiv`、`url`、`accessed`、`note`、`language`。

引用键会转为小写，格式为 `[a-z0-9][a-z0-9._:-]{0,95}`；同一 API 请求中不能重复。DOI、arXiv、HTTP(S) URL 和四位年份有专门校验。正文首次引用确定编号，重复引用复用编号；多引用形成一组。页面末尾自动附加全部结构化来源，未在正文使用的记录也会列出并计入 `uncited`。未知引用键会保留为未解析提示，质量统计会标记缺字段、待补来源、可核验标识和完整度。

已确认没有 ISBN 字段、BibTeX 解析器或 MediaWiki 引用模板。脚注只保存文本，不自动转为结构化来源。Front Matter 的 `references` 必须是单行合法 JSON；格式不合法时会被读为空数组。

实现依据：`src/core/citations.js`、`markdown.js::citationRefHtml/renderReferences/citationStats`、`app.js::citationInputError`。

## 10. 分类、标签和元数据

- **分类/标签**：Wikist 没有独立 `tags` 字段；统一写入 `categories`。`classifications` 用于 MSC/ACM 等分类号，`topic` 用于主题路径。
- **语言与翻译**：`importLang` 仅描述导入来源。已发布译文位于 `page_translations`，语言代码通过 `normalizeTranslationLang` 规范化；保存译文计算进度，达到 95% 自动进入 `review`，审阅通过后为 `published`。
- **原文与来源**：`importTitle`、`importUrl`、`importSource`、`importRevision`、`importFetchedAt`、`importLicense` 保存来源信息；结构化文献另写 `references`。
- **作者/译者**：基础作者在 `author`；译者和审阅者来自 Passport 用户 ID 和 `page_translations`，不应伪装为 Front Matter 字段。
- **时间**：`createdAt/updatedAt` 是 Wikist 文件生命周期；来源更新时间应放 `importRevision`、`importFetchedAt` 或引用 `note`，不可冒充 `updatedAt`。
- **可见性/组织归属**：词条模型没有 `visibility` 或 `organizationId`。组织可创建关联任务和社区审阅，但词条本体是公开知识页。
- **审核状态**：`status` 是内容元数据；真正“已审阅稳定版本”由 `page_stable_revisions` 和 `content/reviewed/` 快照决定。
- **搜索**：标题、slug、别名、规范名、摘要、正文和分类进入词条搜索；质量、难度、分类等可筛选。

实现依据：`PageStore`、`SearchIndex.documentForPage`、`translator_members/page_translations`、`saveTranslation/reviewTranslation`。

## 11. 编辑和发布功能

| 功能 | 当前实现 |
|---|---|
| 新建/编辑 | `POST` 或 `PUT /api/pages/<slug>`；Vditor WYSIWYG 与纯文本回退共用正文值 |
| 自动保存 | 未发现词条自动保存或本地草稿恢复；只有明确提交才写文件 |
| 草稿/发布 | `status` 可标 `draft/review/stable`，但保存后当前文件即公开可读，不是私有草稿系统 |
| 预览 | Vditor 提供编辑器内预览；`/api/pages/<slug>/preview` 是链接悬浮摘要，不是未保存正文的服务端预览 |
| 版本历史 | 更新前复制旧 Markdown 到 `content/revisions/<slug>/`；编辑事件另存数据库 |
| 审阅/差异 | `/review` 记录意见；通过时复制稳定快照；`/diff` 比较当前与稳定正文 |
| 回滚 | 历史版本读取与恢复路由已实现；恢复仍产生审计/编辑记录 |
| 锁定 | `page_permissions.edit_policy=locked` 阻止编辑；还支持 `guest/user` |
| 删除/恢复 | 删除移入 `content/deleted/` 并清理链接/别名；归档接口可恢复 |
| 权限 | 评论策略 `guest/user/locked`；删除策略 `user/senior_editor/locked`；权限管理需相应角色 |
| 组织审阅 | 组织任务可对词条/译文投票达成共识；不形成私有组织词条 |
| 批量导入 | 接口一次导入一个包；批量循环由外部程序控制，需登录并满足编辑权限 |
| 导入/导出 | `GET /api/pages/export?slug=...&format=json|markdown`；`POST /api/pages/import/wikist`，正文上限 4 MiB、请求上限 8 MiB |

JSON 导入已有词条必须显式传 `overwrite: true`。每次导入会保存页面、记录编辑事件、同步正文链接并通知关注者。导入 JSON 的别名不会在该路由中同步到 `page_aliases`；需在导入后通过正常编辑保存或专门别名管理流程复核。

## 12. Encyclopedia of Mathematics 字段映射

下表仅规定“来源存在该内容时”的转换位置。

| EoM 内容 | Wikist 存储位置 | 转换规则 | 无法直接转换时的处理 |
|---|---|---|---|
| 原文标题 | `importTitle`、`canonicalNames` | 原样保留；可将英文规范名加入后者 | 标“待核验”，不得猜测 |
| 中文标题 | `title` | 采用审校后的数学中文名 | 暂用原文名并在摘要标待核验 |
| 词条正文 | `body` | 转为 UTF-8 Wikist Markdown | 无法识别结构放 `::: warning` 待处理，不保留布局 HTML |
| 定义 | `::: definition` | 保留条件、量词、记号和定义域 | 结构不清时保留普通段落并标记 |
| 定理 | `::: theorem` | 原名可核验时写标题 | 不补造名称 |
| 证明 | `::: proof` | 保留逻辑步骤和引用 | 缺失证明不得生成 |
| 公式 | `$...$`、`$$...$$` | 保留 TeX 语义；规范分隔符 | 未识别宏置于代码块并标待人工转换 |
| 章节结构 | `##` 至 `######` | 保持原层级，正文只保留一个主标题 | 层级冲突按语义人工调整 |
| 交叉引用 | `[[slug|中文名]]` | 仅指向确定存在或计划创建的 slug | 暂用外链或纯文本，不制造不存在关系 |
| 参考文献 | `references` + `[@id]` | 结构化作者、题名、年份、页码、DOI/arXiv/URL | 字段缺失原样记录并标待核验 |
| 作者信息 | `references.authors` 或来源说明 | 原词条作者与文献作者不得混用 | 无法确认时不写 `author` |
| MSC 分类 | `classifications` | 原样保留已确认编号 | 不从正文猜测 |
| 关键词 | `categories`、`canonicalNames` | 主题词进分类，异名进规范名 | 无对应项则不生成 |
| 原始网址 | `importUrl`，必要时引用 `url` | 使用规范绝对 URL | 非 HTTP(S) 地址标待核验 |
| 来源说明 | `importSource`、`importLicense`、正文 note | 标明 EoM、翻译和核验状态 | 不作法律结论 |
| 更新时间 | `importRevision`/引用 `note` | 与 Wikist `updatedAt` 分离 | 无日期则留空 |
| 图片 | 正文图片语法或 `heroImage` | 保留 alt、图注和来源；远程 URL 可直接引用 | 许可/MIME 不明则不导入图片 |
| 外部链接 | `[文字](URL)` | 仅保留可核验 HTTP(S) 链接 | 无效协议改为纯文本 |

> 批量抓取、翻译和发布前，必须另行核查 Encyclopedia of Mathematics 的许可条款、robots.txt、来源署名要求和适用法律。

## 13. 推荐的标准导入模板

推荐让 LLM 输出 JSON 包，再由程序调用正式导入接口；这样可稳定保留全部结构化字段。占位符必须由转换程序替换，不能把尖括号占位文本直接发布。

```json
{
  "format": "json",
  "overwrite": false,
  "package": {
    "format": "wikist-page",
    "version": 1,
    "page": {
      "slug": "<ascii-or-unicode-slug>",
      "title": "<中文标题>",
      "summary": "<中文摘要>",
      "categories": ["<学科>", "<主题>"],
      "difficulty": "本科",
      "status": "review",
      "quality": "Draft",
      "author": "<实际译者或导入账号署名>",
      "heroImage": "",
      "importSource": "encyclopedia-of-mathematics",
      "importTitle": "<原文标题>",
      "importLang": "en",
      "importRevision": "<原修订标识或空字符串>",
      "importUrl": "<已核验绝对 URL>",
      "importFetchedAt": "<ISO 8601 抓取时间>",
      "importLicense": "<核验后的许可说明或待人工核验>",
      "aliases": [],
      "disambiguation": false,
      "disambiguationTargets": [],
      "prerequisites": [],
      "relatedPages": [],
      "canonicalNames": ["<原文规范名>"],
      "notation": ["G|群|全文"],
      "classifications": [],
      "topic": "数学/<学科路径>",
      "references": [],
      "body": "# <中文标题>\n\n<严格转换后的 Wikist Markdown>"
    }
  }
}
```

最小 JSON 请求：

```json
{
  "format": "json",
  "package": {
    "page": {
      "slug": "group-action",
      "title": "群作用",
      "body": "# 群作用\n\n群作用描述群在集合上的对称变换。"
    }
  }
}
```

接口为 `POST /api/pages/import/wikist`，请求需登录、通过编辑权限，并使用 `Content-Type: application/json; charset=utf-8`。如改用 `format: markdown`，元数据不是从正文 Front Matter 自动提取，而要作为请求顶层字段分别提交；因此 EoM 转换链应优先使用 JSON 包。

## 14. 转换约束

后续 LLM 和转换程序必须遵守：

1. 不改变定义、命题、条件、量词、否定、作用方向和符号作用域。
2. 不补造定理名称、证明、例子、作者、年份、DOI、MSC 或参考文献。
3. 公式保持 TeX 语义；只转换分隔符和已确认的兼容写法。
4. 原文内容与译者补充必须分开；补充内容使用明确的 `::: note` 并说明性质。
5. 只给确定存在或同批准备创建的对象生成 `[[内部链接]]`。
6. 无法识别的原始结构标“待人工处理”，不得静默删除。
7. 不把 EoM HTML、模板、样式、导航或页面布局代码写入正文。
8. 引用信息无法核实时保留可确认字段并标缺失，不猜测补齐。
9. 图片必须保留替代文本、图注、来源和许可核验状态。
10. 原文更新时间写入来源字段，不冒充 Wikist `updatedAt`。
11. 中文标题采用通行数学术语；存在歧义时保留原文规范名并进入人工术语审校。
12. JSON 中 TeX 反斜杠双写，生成 Markdown 文件后只能保留单个反斜杠。
13. `references` 使用唯一、稳定、小写引用键；正文引用键必须存在。
14. 译文默认以 `status: review`、`quality: Draft` 进入人工审阅，不直接声称稳定或 A 级。
15. 不依赖原始 HTML、MediaWiki 模板、BibTeX、公式编号或其他未支持语法。

## 15. 导入前检查清单

- [ ] slug 合法、唯一，且未被词条或别名占用。
- [ ] `title`、`summary`、`body` 为 UTF-8 中文文本。
- [ ] JSON 可解析，请求体未超过 8 MiB，正文未超过 4 MiB。
- [ ] 正文同时满足渲染器限制；默认部署中不得超过 2 MiB 或 50000 行。
- [ ] 标题层级连续，正文只保留一个主标题。
- [ ] 所有公式分隔符成对，JSON 反斜杠已正确转义。
- [ ] 内部链接目标存在或列入同批创建计划。
- [ ] 引用键合法、唯一，正文引用均能解析。
- [ ] DOI、arXiv、URL 和年份通过接口校验。
- [ ] 图片 URL/路径、alt、图注和许可状态已核验。
- [ ] 分类、主题、MSC、规范名未由模型臆测。
- [ ] `importTitle/importUrl/importLang/importFetchedAt` 已保留。
- [ ] 译者署名与来源作者没有混淆。
- [ ] 来源修订时间未写入 `updatedAt`。
- [ ] 没有原始 HTML、模板残片、脚本、样式或未解析实体。
- [ ] 自定义容器、脚注、定义列表等所需插件处于启用状态。
- [ ] 别名导入后安排数据库别名索引复核。
- [ ] 消歧页不要依赖“导出 JSON 后原样再导入”；先把 `disambiguationTargets` 对象数组转换为 `slug|显示名|说明` 字符串数组并复核。
- [ ] 目标页权限允许导入；覆盖已有页时明确传 `overwrite: true`。
- [ ] 所有“待人工核验/处理”项可被检索并进入审阅流程。

## 16. 已确认不支持、未启用或待确认的功能

本次按独立能力计数确认 **55 项**（语法、字段处理、关系、引用、导入和审阅能力），发现 **12 项**未启用、冲突或资料不足。

### 已确认不支持

1. 原始 HTML、HTML 注释、脚本和样式直通；解析器统一转义。
2. 专用折叠块、可靠嵌套列表、通用 Markdown 反斜杠转义。
3. 公式自动编号、公式引用、自定义 MathJax 宏配置和明确 TeX 环境白名单。
4. ISBN 字段、BibTeX 导入和 MediaWiki 引用模板。
5. 词条正文音视频、通用附件和专用图片上传接口。
6. 私有词条或组织专属词条可见性字段。

### 代码存在但未确认启用

1. `upstreamMarkdownIt` 配置存在但本次站点配置为 `false`；主运行路径仍是 `markdown.js`。
2. 任意自定义容器、脚注、任务列表、定义列表、标题属性依赖插件开关；本次检查的 `config/site.config.json` 为启用，其他部署不能默认相同。
3. 服务端第三方 Hook 默认不执行，只有受信任核心 Hook 可参与词条预处理和块渲染。

### 实现冲突或资料不足

1. 旧语法文档将 Markdown-it 描述为主解析器，与运行代码和测试不一致；本文以 `markdown.js` 为准。
2. JSON 导入会保存 `aliases`，但导入路由没有调用 `syncPageAliases()`；别名数据库索引需导入后复核。
3. UI 对难度、状态、质量提供固定选项，PageStore/API 没有完全相同的枚举校验；外部导入必须主动使用标准值。
4. `status: stable` 只是页面元数据；真正稳定版本必须存在 `page_stable_revisions` 记录和 reviewed 快照。
5. 普通页面保存 API 对客户端提供的 `author` 未做统一不可伪造约束；批量导入应由可信账号和审计记录保证署名。
6. 站点配置中的 MathJax URL 可能使用宽版本 `@3`，默认配置为固定 `3.2.2`，加载器仅对特定旧值做迁移；部署前应核对实际返回配置。
7. EoM 的许可、robots、作者字段和页面结构不属于本地源码事实，必须在抓取阶段另行核验。
8. Vditor 的编辑预览能力大于后端受控解析器；编辑器中可见的效果不能视为已支持，保存后的 `renderMarkdown()` 结果才是准绳。
9. JSON 导出把 `disambiguationTargets` 写成对象数组，保存端却按字符串列表解析；消歧页原样导出再导入会把目标对象转成无效文本，迁移时必须先转换并人工复核。

## 17. 实现依据索引

| 模块 | 文件路径 | 类、函数或组件 | 作用 |
|---|---|---|---|
| Front Matter | `src/core/frontmatter.js` | `parseFrontMatter`、`serializeFrontMatter` | 单行元数据解析和序列化 |
| slug | `src/core/slug.js` | `normalizeSlug`、`slugToId` | 词条路径和标题锚点 |
| 词条存储 | `src/core/page-store.js` | `PageStore` | Markdown 文件、修订、稳定快照、归档和字段规范化 |
| 正文解析 | `src/core/markdown.js` | `renderMarkdown`、`renderInline` | 受控 Markdown、公式占位、图片、引用、目录 |
| 插件语法 | `src/core/plugin-registry.js` | `applyMagicWords`、`renderPluginBlock` | 魔法词和受信任块插件 |
| 引用模型 | `src/core/citations.js` | `normalizeReferences`、`referenceQuality` | 结构化来源校验、格式和质量 |
| 导入转换 | `src/core/import-export.js` | `parseWikistImport`、`fetchWikipediaPage` | Wikist JSON/Markdown 导入及 Wikipedia 转换 |
| API/权限 | `src/server/app.js` | 页面导入、保存、审阅、差异、删除路由 | 写入校验、审计和知识同步 |
| 用户/关系库 | `src/core/passport-store.js` | `syncPageLinks`、`syncPageAliases`、翻译/权限方法 | 链接、别名、稳定审阅、翻译和逐页权限 |
| 搜索 | `src/core/search-index.js`、`src/core/fts-index.js` | `SearchIndex`、持久索引 | 标题、身份词、摘要、正文和分类索引 |
| 前端渲染 | `public/assets/app.js` | `articleHeader`、`mathematicalMetadataHtml`、`typesetMath`、编辑器 | 页面展示、MathJax、Vditor 和结构化面板 |
| 语法测试 | `tools/check-markdown-features.js` | 21 项断言 | 容器、表格、脚注、图片和公式回归 |
| 引用测试 | `tools/check-citation-features.js` | 10 项断言 | 引用编号、质量、持久化和导出 |
| 导入测试 | `tools/check-import-export-features.js` | 7 项断言 | 导入、同步和导出 |
| 审阅/知识测试 | `tools/check-review-features.js`、`tools/check-knowledge-features.js` | 回归脚本 | 稳定版本、差异、链接、别名与知识网络 |
| 真实样例 | `content/pages/wikist-syntax-lab.md` 等 | 当前词条文件 | 运行语法与字段交叉验证 |
