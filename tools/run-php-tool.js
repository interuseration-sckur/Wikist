#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { buildRuntimeEnvironment } = require("./runtime-env");

const root = path.resolve(__dirname, "..");
const tool = String(process.argv[2] || "").replace(/[^A-Za-z0-9._-]/g, "");
if (!tool || !tool.endsWith(".php")) throw new Error("Missing Webman PHP tool name.");
const toolPath = path.join(root, "webman-backend", "tools", tool);
if (!fs.existsSync(toolPath)) throw new Error(`Unknown Webman tool: ${tool}`);

const candidates = [
  process.env.WIKIST_PHP,
  process.platform === "win32" ? path.join(root, ".runtime", "php", "php.exe") : "",
  process.platform === "win32" ? path.join(root, "runtime", "php", "php.exe") : "",
  process.platform === "win32" ? "php.exe" : "php",
].filter(Boolean);
const php = candidates.find((candidate) => {
  const result = childProcess.spawnSync(candidate, ["-r", "echo PHP_VERSION_ID;"], { encoding: "utf8", windowsHide: true });
  return !result.error && result.status === 0 && Number(result.stdout) >= 80401;
});
if (!php) throw new Error("Wikist requires PHP 8.4.1 or newer. Set WIKIST_PHP when PHP is not in PATH.");

const result = childProcess.spawnSync(php, [toolPath, ...process.argv.slice(3)], {
  cwd: root,
  env: buildRuntimeEnvironment(root).env,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
