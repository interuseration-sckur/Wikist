const assert = require("assert");
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


const disabledContainer = renderMarkdown("::: warning\ncontent\n:::", { config: { plugins: { markdownAdvanced: { enabled: true }, upstreamContainer: { enabled: false } } } }).html;
assert(!disabledContainer.includes("math-note-warning"), "disabled container plugin should not render warning blocks");

const disabledPlot = renderMarkdown("::: function-plot\nsin(x)\n:::", { config: { plugins: { functionPlot: { enabled: false } } } }).html;
assert(!disabledPlot.includes("wikist-function-plot"), "disabled functionPlot plugin should not render function plots");

const disabledFootnote = renderMarkdown("Footnote[^a]\n\n[^a]: note", { config: { plugins: { markdownAdvanced: { enabled: true }, upstreamFootnote: { enabled: false } } } }).html;
assert(!disabledFootnote.includes("footnote-ref"), "disabled footnote plugin should not render footnotes");
console.log(JSON.stringify({ ok: true, checks: 13, htmlLength: html.length }));
