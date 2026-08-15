"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const files = [
  "public/assets/app.js",
  "public/passport/index.html",
  "public/passport/passport.js",
  "public/install.html",
  "public/assets/install.js",
];
const sources = new Map(files.map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]));
const combined = [...sources.values()].join("\n");

const retiredCopy = [
  "扁平楼层讨论",
  "不再生成难以追踪的二级树",
  "最多显示两级；更深层回复会自动转为 @ 提及",
  "共享同一套 Wikist 身份和权限",
  "关注只保存订阅关系，不复制词条内容",
  "后台群发只保存一条全站消息",
  "SQLite FTS5 将索引持久保存在本站数据库中",
  "这会一次性读取现有词条并写入持久索引",
  "轻量固定窗口防护覆盖站点",
  "类似 MediaWiki 的 Common.css / Common.js",
  "由可信客户端模块通过 Hook API 注册的后台面板",
  "输入关键词以建立可追踪的知识引用",
  "建立一个可追踪、可恢复、可参与协作的知识身份",
  "建立一個可追蹤、可恢復、可參與協作的知識身份",
  "一次身份验证，连接",
  "轨道黎明",
  "极昼档案",
  "深空切片",
];

for (const phrase of retiredCopy) {
  if (combined.includes(phrase)) throw new Error(`Retired explanatory UI copy remains: ${phrase}`);
}

const requiredCopy = [
  ["public/assets/app.js", "回复成员以 @ 提及，并同步到站内信。"],
  ["public/assets/app.js", "联系成员、进入组织群聊或引用知识内容。"],
  ["public/assets/app.js", "查看索引状态，并执行修复或重建。"],
  ["public/assets/app.js", "搜索并选择要引用的内容。"],
  ["public/assets/app.js", "查看贡献规范，并按组织约定推进任务与审阅。"],
  ["public/assets/app.js", "paginationHtml(pagination, \"协作组织\")"],
  ["public/assets/app.js", "bindPagination(document.querySelector(\".community-organization-column\")"],
  ["public/passport/passport.js", "使用 ${name} 账户参与词条、协作、消息与审阅。"],
  ["public/install.html", "填写站点、数据和邮件设置后完成安装。"],
];

for (const [file, phrase] of requiredCopy) {
  if (!sources.get(file).includes(phrase)) throw new Error(`Required action-oriented UI copy is missing from ${file}: ${phrase}`);
}

console.log(`Wikist UI copy checks passed (${files.length} UI sources).`);
