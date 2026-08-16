"use strict";

const assert = require("assert");
const { renderMarkdown } = require("../src/core/markdown");

assert.throws(
  () => renderMarkdown("x".repeat(2 * 1024 * 1024 + 1)),
  /超过渲染上限/,
  "oversized Markdown must be rejected",
);
assert.throws(
  () => renderMarkdown(`${">".repeat(18)} nested`),
  /嵌套层级超过安全限制/,
  "deep recursive Markdown must be rejected",
);

const hostilePayloads = [
  "[x](javascript:alert(1))",
  "[x](JaVaScRiPt:alert(1))",
  "[x](java&#x73;cript:alert(1))",
  "[x](vbscript:msgbox(1))",
  "[x](data:text/html,<script>alert(1)</script>)",
  "![x](data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+)",
  "![x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  '<img src=x onerror="alert(1)">',
  '<img srcset="javascript:alert(1) 1x">',
  '<a href="javascript:alert(1)">x</a>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<svg><script>alert(1)</script></svg>',
  '<math><a href="javascript:alert(1)">x</a></math>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<object data="data:text/html,<script>alert(1)</script>"></object>',
  '<form action="javascript:alert(1)"><button>go</button></form>',
];
const hostile = hostilePayloads.join("\n\n");
const hostileHtml = renderMarkdown(hostile).html.toLowerCase();
assert(!/<(?:a|img)[^>]+(?:href|src)=["']?(?:javascript|vbscript|data:text\/html)/i.test(hostileHtml), "active URLs must not reach rendered HTML sinks");
assert(!hostileHtml.includes('<img src="data:image/svg'), "SVG data URLs must not reach an image sink");
assert(!hostileHtml.includes("<script"), "raw script elements must not reach rendered HTML");
assert(!/<img[^>]+onerror=/i.test(hostileHtml), "raw event handlers must not reach an image sink");
assert(!/<(?:iframe|object|form|math|svg)\b/i.test(hostileHtml), "active raw HTML elements must not reach rendered HTML");
assert(!/<(?:img|iframe)[^>]+\bsrc(?:doc|set)=/i.test(hostileHtml), "secondary source attributes must not reach rendered HTML sinks");

const pathologicalStartedAt = Date.now();
for (const input of [
  "[".repeat(120000) + "]".repeat(120000),
  "*".repeat(180000),
  Array.from({ length: 12000 }, (_, index) => `${index}. [x](https://example.test/${index})`).join("\n"),
]) {
  try { renderMarkdown(input); } catch (error) {
    assert(/安全预算|渲染上限/.test(error.message), "pathological Markdown must fail through a bounded resource guard");
  }
}
assert(Date.now() - pathologicalStartedAt < 5000, "pathological Markdown corpus exceeded the CPU budget");

const plotLines = [
  "::: function-plot",
  `title: ${"T".repeat(500)}`,
  "xDomain: -999999999,999999999",
  "samples: 999999",
  ...Array.from({ length: 20 }, (_, index) => `curve${index} := sin(x + ${index})`),
  ":::",
];
const plotHtml = renderMarkdown(plotLines.join("\n")).html;
const payloadText = plotHtml.match(/<script type="application\/json" class="function-plot-config">([^<]+)<\/script>/)?.[1] || "";
const payload = JSON.parse(payloadText);
assert.strictEqual(payload.data.length, 8, "function plots must cap series count");
assert.strictEqual(payload.samples, 1800, "function plots must cap samples");
assert.deepStrictEqual(payload.xAxis.domain, [-10, 10], "unbounded domains must fall back safely");
assert(payload.title.length <= 120, "function plot titles must be bounded");

console.log(JSON.stringify({ ok: true, checks: 14, xssPayloads: hostilePayloads.length, plotSeries: payload.data.length, plotSamples: payload.samples }, null, 2));
