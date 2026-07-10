const { loadConfig } = require("../src/core/config");
const { renderMarkdown } = require("../src/core/markdown");

const config = loadConfig(process.cwd()).config;
const source = [
  "::: function-plot",
  "gamma(x)",
  "implicit: x^2 + y^2 = 4",
  ":::",
  "",
  "::: geometry",
  "point A: 0, 0",
  "point B: 2, 0",
  "segment A B",
  ":::",
  "",
  "::: math-chart",
  "labels: 1, 2",
  "series: a_n | 1, .5",
  ":::",
].join("\n");

const html = renderMarkdown(source, { config }).html;
const checks = {
  functionPlotBlock: html.includes("wikist-function-plot"),
  mathEngineEnabled: html.includes('"requiresMathjs":true'),
  geometryBlock: html.includes("wikist-geometry-board"),
  chartBlock: html.includes("wikist-math-chart"),
  noCodeFallback: !html.includes("language-function-plot") && !html.includes("language-geometry") && !html.includes("language-math-chart"),
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length }, null, 2));
