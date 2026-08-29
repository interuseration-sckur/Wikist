#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = process.platform === "win32" ? "G:\\Wikist-EoM\\wikist-zh" : path.join(process.cwd(), "data", "eom-wikist-zh");

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, parts: 8, json: false };
  for (const arg of argv) {
    if (arg.startsWith("--root=")) options.root = path.resolve(arg.slice(7));
    else if (arg.startsWith("--parts=")) options.parts = Number(arg.slice(8));
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.parts) || options.parts < 1 || options.parts > 64) throw new Error("--parts must be 1..64.");
  return options;
}

function jsonlCount(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean).length;
}

function directoryJsonCount(directory) {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).length;
}

function reviewedCount(directory) {
  if (!fs.existsSync(directory)) return 0;
  let reviewed = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const value = JSON.parse(fs.readFileSync(path.join(directory, entry.name), "utf8").replace(/^\uFEFF/, ""));
      if (value.needsReview === false && !(value.issues || []).some((issue) => issue?.code === "machine-draft-awaiting-agent-audit")) reviewed += 1;
    } catch (_error) {}
  }
  return reviewed;
}

function status(options) {
  const parts = [];
  for (let part = 1; part <= options.parts; part += 1) {
    const name = `part-${String(part).padStart(2, "0")}`;
    const bodyOutput = path.join(options.root, "work", "body-output", name);
    parts.push({
      part,
      titleInput: jsonlCount(path.join(options.root, "work", "title-input", `${name}.jsonl`)),
      titleOutput: jsonlCount(path.join(options.root, "work", "title-output", `${name}.jsonl`)),
      bodyInput: jsonlCount(path.join(options.root, "work", "body-input", `${name}.jsonl`)),
      bodyOutput: directoryJsonCount(bodyOutput),
      bodyReviewed: reviewedCount(bodyOutput),
    });
  }
  const report = {
    root: options.root,
    parts,
    totals: parts.reduce((sum, part) => ({
      titleInput: sum.titleInput + part.titleInput,
      titleOutput: sum.titleOutput + part.titleOutput,
      bodyInput: sum.bodyInput + part.bodyInput,
      bodyOutput: sum.bodyOutput + part.bodyOutput,
      bodyReviewed: sum.bodyReviewed + part.bodyReviewed,
    }), { titleInput: 0, titleOutput: 0, bodyInput: 0, bodyOutput: 0, bodyReviewed: 0 }),
    packages: directoryJsonCount(path.join(options.root, "packages")),
  };
  return report;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write("Usage: node tools/eom-zh-status.js [--root=PATH] [--parts=8] [--json]\n");
    else {
      const report = status(options);
      if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else {
        process.stdout.write("part  title       body        reviewed\n");
        for (const part of report.parts) process.stdout.write(`${String(part.part).padStart(2, "0")}    ${part.titleOutput}/${part.titleInput}  ${part.bodyOutput}/${part.bodyInput}  ${part.bodyReviewed}\n`);
        process.stdout.write(`total ${report.totals.titleOutput}/${report.totals.titleInput}  ${report.totals.bodyOutput}/${report.totals.bodyInput}  ${report.totals.bodyReviewed}; packages ${report.packages}\n`);
      }
    }
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { status };
