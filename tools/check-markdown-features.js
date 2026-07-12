const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { renderMarkdown } = require("../src/core/markdown");

const config = {
  plugins: {
    magicWords: { enabled: true, custom: { PROJECT: "Wikist" } },
    functionPlot: { enabled: true, defaultHeight: 320, grid: true },
    upstreamAttrs: { enabled: true },
    upstreamContainer: { enabled: true },
    upstreamDeflist: { enabled: true },
    upstreamFootnote: { enabled: true },
    upstreamTaskLists: { enabled: true },
    markdownAdvanced: { enabled: true },
  },
  name: "Wikist",
  tagline: "开放数学知识",
};

const sample = `
::: warning
content
:::

:::: theorem 四冒号
content
::::

:::: spoiler 自定义
content
::::

:::: function-plot
title: plot
sin(x)
::::

- [x] task

Term
: definition

| A | B |
| :--- | :--- |
| 1 | 2 |

Footnote[^a]

Inline math $S_3$, $F^*(G)$, and \\(N_G(P)/C_G(P)\\).

[[sylow-p-subgroup|Sylow $p$-subgroup]]

\\[
x_i^2 + y_i^2 = 1
\\]

[^a]: note

## Heading {#lab-heading}

[[File:/assets/wikist-emblem.svg|right|thumb|180px|caption]]
`;

const result = renderMarkdown(sample, { config, page: { slug: "wikist-syntax-lab", title: "Lab" } });
const html = result.html;

assert(html.includes('math-note-warning'), 'three-colon warning container should render');
assert(html.includes('math-note-theorem'), 'four-colon theorem container should render');
assert(html.includes('wikist-container-spoiler'), 'custom upstream container should render');
assert(html.includes('wikist-function-plot'), 'four-colon function-plot should render');
assert(html.includes('task-list-item'), 'task list should render');
assert(html.includes('definition-list'), 'definition list should render');
assert(html.includes('table-scroll'), 'table should render');
assert(html.includes('footnote-ref'), 'footnote should render');
assert(html.includes('id="lab-heading"'), 'heading attrs should render');
assert(html.includes('wiki-image'), 'MediaWiki image should render');
assert(!html.includes('<pre><code class="language-warning"'), 'warning must not fall back to code');
assert(html.includes('<span class="math-inline">\\(S_3\\)</span>'), 'dollar-delimited inline TeX should be protected');
assert(html.includes('<span class="math-inline">\\(F^*(G)\\)</span>'), 'inline TeX punctuation should be preserved');
assert(html.includes('<span class="math-inline">\\(N_G(P)/C_G(P)\\)</span>'), 'parenthesized inline TeX should render');
assert(html.includes('<div class="math-block">\\['), 'bracket-delimited display TeX should render');
assert(!html.includes('S<em>3') && !html.includes('N<em>G'), 'TeX underscores must not become emphasis markup');


const disabledContainer = renderMarkdown("::: warning Group $G$\ncontent\n:::", { config: { plugins: { markdownAdvanced: { enabled: true }, upstreamContainer: { enabled: false } } } }).html;
assert(disabledContainer.includes("math-note-warning"), "native Wikist semantic blocks must render without the optional container plugin");
assert(disabledContainer.includes('<span class="math-inline">\\(G\\)</span>'), "semantic block titles should render inline TeX");

const disabledCustomContainer = renderMarkdown("::: spoiler\ncontent\n:::", { config: { plugins: { markdownAdvanced: { enabled: true }, upstreamContainer: { enabled: false } } } }).html;
assert(!disabledCustomContainer.includes("wikist-container-spoiler"), "disabled container plugin should not render arbitrary custom blocks");

const disabledPlot = renderMarkdown("::: function-plot\nsin(x)\n:::", { config: { plugins: { functionPlot: { enabled: false } } } }).html;
assert(!disabledPlot.includes("wikist-function-plot"), "disabled functionPlot plugin should not render function plots");

const disabledFootnote = renderMarkdown("Footnote[^a]\n\n[^a]: note", { config: { plugins: { markdownAdvanced: { enabled: true }, upstreamFootnote: { enabled: false } } } }).html;
assert(!disabledFootnote.includes("footnote-ref"), "disabled footnote plugin should not render footnotes");

const appSource = fs.readFileSync(path.join(__dirname, "../public/assets/app.js"), "utf8");
assert(appSource.includes('displayMath: [["\\\\[", "\\\\]"], ["$$", "$$"]]'), "MathJax must recognize bracket-delimited display TeX");
console.log(JSON.stringify({ ok: true, checks: 21, htmlLength: html.length }));
