#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const {
  extractSourceRelations,
  mergeApiPage,
  pagePaths,
  parseArgs,
  safeTitle,
  sha256,
} = require("./archive-eom");

const source = `#REDIRECT [[Group action#Definition]]
{{MSC|20}}
{{Cite|Isaacs|Serre}}
[[Group theory|groups]] and [[Category:Algebra]]
{{Ref|Isaacs}} I.M. Isaacs, ''Finite Group Theory'' {{MR|12345}} {{ZBL|67890}}
<ref name="note">Preserved note</ref>`;
const relations = extractSourceRelations(source);
assert.deepStrictEqual(relations.redirectTarget, { title: "Group action", anchor: "Definition" });
assert(relations.wikilinks.some((item) => item.target === "Group theory" && item.label === "groups"));
assert(relations.citationUses.some((item) => item.keys.includes("Isaacs") && item.keys.includes("Serre")));
assert(relations.referenceDefinitions.some((item) => item.key === "Isaacs"));
assert(relations.identifiers.some((item) => item.scheme === "MR" && item.value === "12345"));
assert(relations.namedReferences.some((item) => item.name === "note" && item.content === "Preserved note"));

const merged = mergeApiPage(
  { pageid: 1, links: [{ ns: 0, title: "A" }], extlinks: [{ url: "https://example.org/a" }] },
  { pageid: 1, title: "Test", links: [{ ns: 0, title: "A" }, { ns: 0, title: "B" }], extlinks: [{ url: "https://example.org/b" }] },
);
assert.strictEqual(merged.links.length, 2);
assert.strictEqual(merged.extlinks.length, 2);

assert.strictEqual(safeTitle('A<B>:C/"D"'), "A_B__C__D_");
assert.strictEqual(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

const options = parseArgs(["--output=G:\\Wikist-EoM-Test", "--namespaces=0,100", "--batch-size=10", "--delay-ms=500", "--max-pages=3"]);
assert.deepStrictEqual(options.namespaces, [0, 100]);
assert.strictEqual(options.maxPages, 3);
const locations = pagePaths(path.resolve("G:\\Wikist-EoM-Test"), { pageid: 418, ns: 0, title: "Special functions" });
assert(locations.source.endsWith(path.join("pages", "ns-0", "0000", "00000418--Special functions.md")));

console.log(JSON.stringify({ ok: true, checks: 12 }, null, 2));
