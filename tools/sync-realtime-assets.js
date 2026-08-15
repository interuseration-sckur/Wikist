"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "node_modules", "centrifuge", "dist", "centrifuge.js");
const target = path.join(root, "public", "assets", "vendor", "centrifuge", "centrifuge.js");

if (!fs.existsSync(source)) {
  throw new Error("centrifuge-js 未安装，请先运行 npm install。");
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log(`Centrifuge browser client synced: ${path.relative(root, target)}`);
