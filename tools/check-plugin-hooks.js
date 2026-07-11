const assert = require("assert");
const {
  HOOK_API_VERSION,
  cleanManifest,
  pluginCatalog,
  pluginHookCapabilities,
  pluginRuntimeStatus,
  runMarkdownPreprocessHooks,
  runSearchEnhancementHooks,
} = require("../src/core/plugin-registry");
const { renderMarkdown } = require("../src/core/markdown");

const declared = cleanManifest({
  id: "hookSample",
  name: "Hook Sample",
  hooks: ["markdown.preprocess", "admin.panel", "unknown.hook"],
  permissions: ["content:transform", "ui:admin-panel", "unsafe:all"],
  entry: "manifest-only",
}, "hook-sample");

assert.strictEqual(HOOK_API_VERSION, "1.0", "Hook API version should be stable");
assert.deepStrictEqual(declared.hooks, ["markdown.preprocess", "admin.panel"], "unknown hooks must be removed from manifests");
assert.deepStrictEqual(declared.permissions, ["content:transform", "ui:admin-panel"], "unknown permissions must be removed from manifests");
assert(pluginHookCapabilities(declared).every((item) => item.granted), "declared Hook permissions should be granted");

const blocked = cleanManifest({
  id: "blockedHook",
  hooks: ["search.enhance"],
  permissions: [],
}, "blocked-hook");
assert.strictEqual(pluginHookCapabilities(blocked)[0].state, "blocked", "missing permission must block the Hook");

const serverOnly = cleanManifest({
  id: "serverOnly",
  entry: "serverModule",
  serverModule: "server.js",
  hooks: ["markdown.preprocess"],
  permissions: ["content:transform"],
}, "server-only");
const serverRuntime = pluginRuntimeStatus(serverOnly);
assert.strictEqual(serverRuntime.executable, false, "external server modules must never auto-execute");
assert.strictEqual(serverRuntime.state, "server-declared", "server modules should remain declared only");

const config = {
  name: "Wikist Hooks",
  plugins: {
    magicWords: { enabled: true, custom: { HOOK_NAME: "Controlled Hook" } },
    functionPlot: { enabled: true, defaultHeight: 300, grid: true },
  },
};
const preprocessed = runMarkdownPreprocessHooks("{{SITENAME}} {{HOOK_NAME}}", { config, page: { title: "Hook Page" } });
assert.strictEqual(preprocessed, "Wikist Hooks Controlled Hook", "Markdown preprocessing should route through the core Hook dispatcher");

const rendered = renderMarkdown("::: function-plot\nsin(x)\n:::", { config });
assert(rendered.html.includes("wikist-function-plot"), "block rendering should route through the core Hook dispatcher");

const searchPayload = { query: "group", items: [], total: 0, facets: {}, pagination: {} };
assert.strictEqual(runSearchEnhancementHooks(searchPayload, { query: "group" }), searchPayload, "search enhancement should preserve the core result when no enhancer changes it");

const hookConsole = pluginCatalog(process.cwd()).find((plugin) => plugin.id === "pluginHooks");
assert(hookConsole, "the Hook API console plugin should be discoverable");
assert.strictEqual(hookConsole.runtime.state, "client-active", "the Hook API console should use the trusted client module boundary");
assert(hookConsole.hookCapabilities.some((item) => item.name === "admin.panel" && item.granted), "the console should declare the admin.panel permission");

console.log(JSON.stringify({ ok: true, checks: 12, hookApi: HOOK_API_VERSION, samplePlugin: hookConsole.id }, null, 2));
