#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { mediaWikiToProtectedMarkdown, restoreTokens, flattenNestedProtectedTokens, formulaBalanceIssues } = require("./eom-zh-convert");
const { parseReferenceRows, referenceId, sourceReferenceUses, titleSlug } = require("./eom-zh-index");
const { importPackage, sha256 } = require("./eom-zh-release-import");
const { chunks, tokenErrors, translationPrompt } = require("./eom-zh-local-draft");
const { applyTitleOverrides, readTitleOverrides, titleAuditIssues } = require("./eom-zh-titles");

const checks = {};
const source = `{{TEX|done}}{{MSC|03}}
One [[Binary relation|relation]] $R$ is transitive. {{Cite|a1}}

==References==
<table><TR><TD>[a1]</TD><TD>R. Author, ''A Book'', Publisher (2011) {{ISBN|1234567890}}</TD></TR></table>`;
const references = parseReferenceRows(source);
checks.referenceKeyStable = references.length === 1 && references[0].id === "a1" && references[0].reference.title === "A Book";
const duplicateReferences = parseReferenceRows("<table><tr><td>[a]</td><td>First</td></tr><tr><td>[a]</td><td>Second</td></tr></table>");
checks.distinctDuplicateReferencesPreserved = duplicateReferences.length === 2
  && duplicateReferences[0].id === "a"
  && /^a--[a-f0-9]{12,}$/.test(duplicateReferences[1].id)
  && duplicateReferences.every((item) => item.keyAudit.status === "same-key-distinct")
  && new Set(duplicateReferences.map((item) => item.id)).size === 2;
const duplicateReferenceIds = parseReferenceRows("<table><tr><td>[a]</td><td>First</td></tr><tr><td>[a]</td><td>Second</td></tr></table>").map((item) => item.id);
checks.conflictReferenceIdsDeterministic = JSON.stringify(duplicateReferenceIds) === JSON.stringify(duplicateReferences.map((item) => item.id));
const identicalReferences = parseReferenceRows("<table><tr><td>[same]</td><td>A. Author, Book (2001)</td></tr><tr><td>[same]</td><td>A. Author, Book (2001)</td></tr></table>");
checks.identicalDuplicateReferencesAudited = identicalReferences.length === 1
  && identicalReferences[0].duplicateCount === 2
  && identicalReferences[0].definitionOccurrences.length === 2
  && identicalReferences[0].keyAudit.status === "same-key-identical";
const collidingReferenceSource = `First use [[#References|[x]]].

==References==
<table><tr><td>[x]</td><td>A. Author, ''First source'' (2001)</td></tr></table>

Second use [[#References|[x]]].

==References==
<table><tr><td>[x]</td><td>B. Author, ''Second source'' (2002)</td></tr></table>`;
const collidingDefinitions = parseReferenceRows(collidingReferenceSource);
const collidingUses = sourceReferenceUses(collidingReferenceSource, {}, collidingDefinitions)
  .filter((item) => item.sourceKind === "reference-anchor");
checks.collidingReferenceUsesBoundByPosition = collidingDefinitions.length === 2
  && collidingUses.length === 2
  && collidingUses[0].id === collidingDefinitions[0].id
  && collidingUses[1].id === collidingDefinitions[1].id
  && collidingUses.every((item) => item.bindingStatus === "inferred" && item.bindingConfidence === "medium");
const invalidNamedReferenceSource = `<ref name="Krasnosel'skii">A. Author, ''Named source'' (2003)</ref> Later <ref name="KRASNOSEL’SKII"/>`;
const invalidNamedDefinitions = parseReferenceRows(invalidNamedReferenceSource);
const invalidNamedUses = sourceReferenceUses(invalidNamedReferenceSource, {}, invalidNamedDefinitions);
checks.invalidNamedReferenceIdStable = invalidNamedDefinitions.length === 1
  && invalidNamedDefinitions[0].id === referenceId("Krasnosel'skii", "")
  && /^[a-z0-9][a-z0-9._:-]{0,95}$/.test(invalidNamedDefinitions[0].id)
  && invalidNamedUses.length === 2
  && invalidNamedUses.every((item) => item.id === invalidNamedDefinitions[0].id && item.bindingStatus === "bound");
const imageReference = parseReferenceRows('<table><tr><td>[img]</td><td>A. Author, "Before <img src="/images/formula.svg" alt="x < y > z" title="ignored"> after", Journal (2004)</td></tr></table>')[0];
checks.referenceImageAndQuotedTitlePreserved = imageReference.reference.title.includes("Before [image: x &lt; y &gt; z; https://encyclopediaofmath.org/images/formula.svg] after")
  && imageReference.reference.note.includes("[image: x &lt; y &gt; z; https://encyclopediaofmath.org/images/formula.svg]")
  && imageReference.reference.url === ""
  && imageReference.reference.inlineMedia.length === 1
  && imageReference.reference.inlineMedia[0].alt === "x < y > z"
  && imageReference.reference.inlineMedia[0].url === "https://encyclopediaofmath.org/images/formula.svg"
  && imageReference.reference.reviewFlags.includes("inline-reference-image")
  && imageReference.reference.sourceText.includes('title="ignored"');
const noAltImageReference = parseReferenceRows("<table><tr><td>[plot]</td><td>A. Author, <img src='https://example.test/plot.png' data-note='x > y'> (2005)</td></tr></table>")[0];
checks.referenceImageWithoutAltKeepsUrl = noAltImageReference.reference.note.includes("[image: https://example.test/plot.png]")
  && noAltImageReference.reference.inlineMedia[0].url === "https://example.test/plot.png";
checks.nonBibliographicBracketFormulaIgnored = parseReferenceRows("A formula follows.\n[X,A]\\leftarrow [Y,B]\\rightarrow [Z,C]").length === 0;
const inlineReferences = parseReferenceRows("Statement.<ref>A. Author, ''A Paper'' (1999)</ref>");
checks.inlineReferenceStable = inlineReferences.length === 1 && /^inline-[a-f0-9]{16}$/.test(inlineReferences[0].id);
const wikiTableReferences = parseReferenceRows('|valign="top"|{{Ref|bk}}||valign="top"| A. Author, "Book" (2005) {{DOI|10.1/example}}');
checks.wikiReferenceRow = wikiTableReferences.length === 1 && wikiTableReferences[0].id === "bk" && wikiTableReferences[0].reference.year === "2005";

const converted = mediaWikiToProtectedMarkdown({
  source,
  titleEntry: { zhTitle: "传递关系" },
  links: [{ status: "resolved", sourceTarget: "Binary relation", targetSlug: "eom/binary-relation", targetSourceTitle: "Binary relation", targetZhTitle: "二元关系", line: 2 }],
  references,
});
checks.metadataTemplateRemoved = !converted.markdown.includes("{{TEX") && !converted.markdown.includes("{{MSC");
checks.referenceTableRemoved = !converted.markdown.includes("A Book");
const referenceSectionConverted = mediaWikiToProtectedMarkdown({
  source: "Body.\n\n==References==\n* {{Ref|bk}} A. Author, Book (2005)\n\n==See also==\nRelated material.",
  titleEntry: { zhTitle: "测试" },
  links: [],
  references: wikiTableReferences,
});
checks.referenceSectionRemoved = !referenceSectionConverted.markdown.includes("A. Author") && referenceSectionConverted.markdown.includes("## See also");
const mergedMeaningConverted = mediaWikiToProtectedMarkdown({
  source: "First meaning.\n\n==References==\n* {{Ref|bk}} A. Author, Book (2005)\n\n'''Second meaning.''' This definition must survive.",
  titleEntry: { zhTitle: "合并义项" },
  links: [],
  references: wikiTableReferences,
});
checks.referenceSectionDoesNotConsumeFollowingMeaning = mergedMeaningConverted.markdown.includes("Second meaning") && mergedMeaningConverted.markdown.includes("This definition must survive");
const formulaTableAfterReferences = mediaWikiToProtectedMarkdown({
  source: "==References==\n<table><tr><td>[x]</td><td>$x+y=0$</td></tr></table>",
  titleEntry: { zhTitle: "公式表" },
  links: [],
  references: [],
});
const formulaTableAfterReferencesRestored = restoreTokens(formulaTableAfterReferences.markdown, formulaTableAfterReferences.protectedTokens);
checks.nonBibliographicTablePreserved = formulaTableAfterReferencesRestored.output.includes("x+y=0");
const wikiTableConverted = mediaWikiToProtectedMarkdown({
  source: "{| class=\"wikitable\"\n! Object !! Value\n|-\n| Group || 4\n|}",
  titleEntry: { zhTitle: "测试" },
  links: [],
  references: [],
});
const wikiTableRestored = restoreTokens(wikiTableConverted.markdown, wikiTableConverted.protectedTokens);
checks.wikiTableConverted = wikiTableRestored.output.includes("| Object | Value |") && wikiTableRestored.output.includes("| Group | 4 |");
const looseWikiTables = mediaWikiToProtectedMarkdown({
  source: String.raw`Before
{|

$X \vdash_\mathcal{S} A \Longleftrightarrow A \in Cn(X)$
|}
Between
{|
|-

$Cn_\mathcal{A}(X)=\cap\lbrace Y \mid X\subseteq Y\rbrace$
|}
After`,
  titleEntry: { zhTitle: "裸内容公式表" },
  links: [],
  references: [],
});
const looseWikiTablesRestored = restoreTokens(looseWikiTables.markdown, looseWikiTables.protectedTokens);
checks.looseWikiTableFormulaPayloadPreserved = looseWikiTablesRestored.errors.length === 0
  && looseWikiTablesRestored.output.includes(String.raw`$X \vdash_\mathcal{S} A \Longleftrightarrow A \in Cn(X)$`)
  && looseWikiTablesRestored.output.includes(String.raw`$Cn_\mathcal{A}(X)=\cap\lbrace Y \mid X\subseteq Y\rbrace$`)
  && !looseWikiTables.issues.some((issue) => issue.code === "unparsed-wiki-table" || issue.code === "orphan-protected-token");
const transcluded = mediaWikiToProtectedMarkdown({
  source: "{{:Golden ratio/Fig1}}",
  titleEntry: { zhTitle: "黄金分割" },
  links: [],
  references: [],
  transclusionTargets: new Map([["golden ratio/fig1", { sourceTitle: "Golden ratio/Fig1", zhTitle: "黄金分割图 1", targetSlug: "eom/golden-ratio-fig1" }]]),
});
const transcludedRestored = restoreTokens(transcluded.markdown, transcluded.protectedTokens);
checks.transclusionLinked = transcludedRestored.output.includes("[[eom/golden-ratio-fig1|转包含：黄金分割图 1]]");
const asyConverted = mediaWikiToProtectedMarkdown({ source: "<asy>draw((0,0)--(1,1));</asy>", titleEntry: { zhTitle: "图" }, links: [], references: [] });
const asyRestored = restoreTokens(asyConverted.markdown, asyConverted.protectedTokens);
checks.asymptoteProtected = asyRestored.output.includes("```asy") && asyRestored.output.includes("draw((0,0)--(1,1));");
checks.mathProtected = converted.protectedTokens.some((item) => item.type === "MATH" && item.value === "$R$");
const multilineMath = mediaWikiToProtectedMarkdown({ source: "A formula $x +\ny$ remains intact.", titleEntry: { zhTitle: "跨行公式" }, links: [], references: [] });
checks.multilineInlineMathProtected = multilineMath.protectedTokens.some((item) => item.type === "MATH" && item.value === "$x +\ny$");
const nestedTokens = mediaWikiToProtectedMarkdown({
  source: "<outer data=\"<table>$&$</table>\">tail</outer>",
  titleEntry: { zhTitle: "嵌套 token" },
  links: [],
  references: [],
});
const nestedTokensRestored = restoreTokens(nestedTokens.markdown, nestedTokens.protectedTokens);
checks.nestedProtectedTokensFlattened = nestedTokensRestored.errors.length === 0
  && nestedTokens.protectedTokens.length === 2
  && nestedTokens.protectedTokens.every((item) => !/@@WIKIST_[A-Z]+_\d{6}@@/.test(item.value))
  && nestedTokensRestored.output.includes("$&$");
const orphanProtector = {
  tokens: [{ token: "@@WIKIST_MATH_900001@@", type: "MATH", value: "$x$" }],
};
const orphanIssues = [];
flattenNestedProtectedTokens("plain text", orphanProtector, orphanIssues);
checks.orphanProtectedTokenRetained = orphanProtector.tokens.length === 1
  && orphanIssues.some((issue) => issue.code === "orphan-protected-token" && issue.token === "@@WIKIST_MATH_900001@@");
const sharedChild = { token: "@@WIKIST_MATH_900002@@", type: "MATH", value: "$y$" };
const firstParent = { token: "@@WIKIST_CODE_900003@@", type: "CODE", value: `first ${sharedChild.token}` };
const secondParent = { token: "@@WIKIST_CODE_900004@@", type: "CODE", value: `second ${sharedChild.token}` };
const multipleParentProtector = { tokens: [sharedChild, firstParent, secondParent] };
const multipleParentIssues = [];
flattenNestedProtectedTokens(
  `${firstParent.token} ${secondParent.token}`,
  multipleParentProtector,
  multipleParentIssues,
);
checks.multipleParentProtectedTokenRetained = multipleParentProtector.tokens.length === 3
  && multipleParentIssues.some((issue) => issue.code === "multiple-parent-protected-token"
    && issue.token === sharedChild.token
    && issue.parents.length === 2);
checks.linkTargetProtected = converted.protectedTokens.some((item) => item.type === "TARGET" && item.value === "eom/binary-relation");
checks.citationProtected = converted.protectedTokens.some((item) => item.type === "CITE" && item.value === "a1");
const anchoredCitation = mediaWikiToProtectedMarkdown({ source: "See [[#References|[a1]]].", titleEntry: { zhTitle: "锚点引用" }, links: [], references });
const anchoredCitationRestored = restoreTokens(anchoredCitation.markdown, anchoredCitation.protectedTokens);
checks.referenceAnchorConverted = anchoredCitationRestored.output.includes("[@a1]") && !anchoredCitationRestored.output.includes("encyclopediaofmath.org/wiki/");
const categoryAligned = mediaWikiToProtectedMarkdown({
  source: "[[Category:Relations]] [[Binary relation|relation]]",
  titleEntry: { zhTitle: "传递关系" },
  links: [
    { status: "external-or-namespace", sourceTarget: "Category:Relations" },
    { status: "resolved", sourceTarget: "Binary relation", targetSlug: "eom/binary-relation", targetZhTitle: "二元关系" },
  ],
  references: [],
});
checks.namespaceLinkAlignment = categoryAligned.protectedTokens.some((item) => item.type === "TARGET" && item.value === "eom/binary-relation");
const unsupportedNamespace = mediaWikiToProtectedMarkdown({ source: "[[Unknown:Target|visible text]]", titleEntry: { zhTitle: "命名空间" }, links: [], references: [] });
checks.unsupportedNamespaceKeepsLabel = unsupportedNamespace.markdown.includes("visible text");
const imageConverted = mediaWikiToProtectedMarkdown({
  source: "[[File:Ellipse.svg|right|300px|Figure for [[Ellipse|an ellipse]]]]",
  titleEntry: { zhTitle: "椭圆" },
  links: [
    { status: "external-or-namespace", sourceTarget: "File:Ellipse.svg" },
    { status: "resolved", sourceTarget: "Ellipse", targetSlug: "eom/ellipse", targetZhTitle: "椭圆" },
  ],
  references: [],
});
const imageRestored = restoreTokens(imageConverted.markdown, imageConverted.protectedTokens);
checks.imageConverted = imageRestored.output.includes("[[File:https://encyclopediaofmath.org/wiki/Special:Redirect/file/Ellipse.svg|right|thumb|300px") && imageRestored.output.includes("caption=Figure for an ellipse");
const htmlImageConverted = mediaWikiToProtectedMarkdown({
  source: '<img src="/images/example.svg" alt="Example diagram" width="320" />',
  titleEntry: { zhTitle: "HTML 图片" },
  links: [],
  references: [],
});
const htmlImageRestored = restoreTokens(htmlImageConverted.markdown, htmlImageConverted.protectedTokens);
checks.htmlImagePreserved = htmlImageRestored.output.includes("[[File:https://encyclopediaofmath.org/images/example.svg|center|thumb|320px") && htmlImageRestored.output.includes("caption=Example diagram");
const galleryConverted = mediaWikiToProtectedMarkdown({
  source: "<gallery>\nFile:One.svg|First\nFile:Two.svg|Second\n</gallery>",
  titleEntry: { zhTitle: "图库" },
  links: [],
  references: [],
});
const galleryRestored = restoreTokens(galleryConverted.markdown, galleryConverted.protectedTokens);
checks.galleryPreserved = galleryRestored.output.includes("Special:Redirect/file/One.svg") && galleryRestored.output.includes("Special:Redirect/file/Two.svg");

const captionLinkConverted = mediaWikiToProtectedMarkdown({
  source: "[[File:diagram.png|right|frame|A [[Chord|chord]] in a circle.]]",
  titleEntry: { zhTitle: "图注链接测试" },
  links: [{ sourceTarget: "File:diagram.png", status: "external-or-namespace" }, { sourceTarget: "Chord", status: "resolved", targetSlug: "eom/chord" }],
  references: [],
});
const captionLinkRestored = restoreTokens(captionLinkConverted.markdown, captionLinkConverted.protectedTokens);
checks.imageCaptionLinkPreserved = captionLinkRestored.output.includes("caption=A chord in a circle.") && captionLinkRestored.output.includes("图注关联：[[eom/chord|chord]]");

const entityConverted = mediaWikiToProtectedMarkdown({
  source: "A &amp; B, <code>x &lt; y</code>, and [https://example.test/?a=1&amp;b=2 source].",
  titleEntry: { zhTitle: "实体测试" },
  links: [],
  references: [],
});
const entityRestored = restoreTokens(entityConverted.markdown, entityConverted.protectedTokens);
checks.entitiesAndInlineCode = entityRestored.output.includes("A & B") && entityRestored.output.includes("`x < y`") && entityRestored.output.includes("https://example.test/?a=1&b=2");

const metadataConverted = mediaWikiToProtectedMarkdown({
  source: "{{DEF}}{{Disambiguation}}{{Anchor|local section}}See {{OEIS|A000110}}.",
  titleEntry: { zhTitle: "模板测试" },
  links: [],
  references: [],
});
const metadataRestored = restoreTokens(metadataConverted.markdown, metadataConverted.protectedTokens);
checks.eomMetadataTemplates = !metadataRestored.output.includes("{{") && metadataRestored.output.includes("[OEIS A000110](https://oeis.org/A000110)") && metadataConverted.issues.some((issue) => issue.code === "source-anchor-removed");
const structured = mediaWikiToProtectedMarkdown({
  source: "'''Theorem 2.''' Every object has 3 properties.",
  titleEntry: { zhTitle: "测试" },
  links: [],
  references: [],
});
const structuredRestored = restoreTokens(structured.markdown, structured.protectedTokens);
checks.semanticContainer = structuredRestored.output.includes("::: theorem Theorem 2") && structuredRestored.output.includes("\n:::");
const sectionStructured = mediaWikiToProtectedMarkdown({
  source: "==Definition==\nAn object with a property.\n\n==Properties==\nIt has one property.",
  titleEntry: { zhTitle: "测试" },
  links: [],
  references: [],
});
const sectionRestored = restoreTokens(sectionStructured.markdown, sectionStructured.protectedTokens);
checks.semanticSection = sectionRestored.output.includes("::: definition Definition") && sectionRestored.output.includes("\n:::\n## Properties");
checks.numericLiteralsProtected = structured.protectedTokens.filter((item) => item.type === "NUMBER").map((item) => item.value).join(",") === "2,3";
const restored = restoreTokens(converted.markdown, converted.protectedTokens);
checks.restoreClean = restored.errors.length === 0 && restored.output.includes("[[eom/binary-relation|relation]]") && restored.output.includes("[@a1]");
checks.tokenMismatchDetected = tokenErrors(converted.markdown, converted.markdown.replace(converted.protectedTokens[0].token, "")).length === 1;
checks.formulaBalanceDetected = formulaBalanceIssues("$$x").some((item) => item.code === "unbalanced-display-math");
checks.inlineFormulaBalanceDetected = formulaBalanceIssues("$x").some((item) => item.code === "unbalanced-inline-math");
const selfClosingSource = "First<ref name=note/> remains. Later <ref name=other>Other reference</ref> tail.";
const selfClosingRefs = parseReferenceRows(selfClosingSource);
const selfClosingConverted = mediaWikiToProtectedMarkdown({ source: selfClosingSource, titleEntry: { zhTitle: "自闭合引用" }, links: [], references: selfClosingRefs });
const selfClosingRestored = restoreTokens(selfClosingConverted.markdown, selfClosingConverted.protectedTokens);
checks.selfClosingRefDoesNotConsumeBody = selfClosingRestored.output.includes("remains. Later") && selfClosingRestored.output.includes("tail.") && !selfClosingRefs.some((item) => item.reference.note.includes("remains. Later"));
checks.stableSlug = titleSlug("*-Autonomous category", 995) === "eom/star-autonomous-category";
checks.titleConfidenceAudit = titleAuditIssues("Uncertain theorem", { zhTitle: "Uncertain theorem", titleConfidence: "high", titleNotes: "译名待核验" }).length === 2;
const reviewedTitleOverrides = readTitleOverrides();
const simplicialSetOverride = reviewedTitleOverrides.find((item) => item.sourceId === 5049);
const titleOverrideFixture = [{
  sourceId: 5049,
  sourceTitle: "Simplicial set",
  zhTitle: "单纯集合",
  titleConfidence: "high",
  titleNotes: "",
}];
const titleOverrideApplication = applyTitleOverrides(titleOverrideFixture, [simplicialSetOverride]);
checks.titleOverrideTableReviewed = reviewedTitleOverrides.length === 18
  && reviewedTitleOverrides.every((item) => item.titleConfidence === "high");
checks.titleOverrideAppliedDeterministically = titleOverrideApplication.conflicts.length === 0
  && titleOverrideApplication.applications.length === 1
  && titleOverrideFixture[0].zhTitle === "单纯集"
  && titleOverrideFixture[0].titleNotes === simplicialSetOverride.reason;
const titleOverrideMismatch = applyTitleOverrides(
  [{ sourceId: 5049, sourceTitle: "Different source", zhTitle: "旧题名" }],
  [simplicialSetOverride],
);
checks.titleOverrideSourceMismatchAudited = titleOverrideMismatch.applications.length === 0
  && titleOverrideMismatch.conflicts.length === 1
  && titleOverrideMismatch.conflicts[0].conflict === "source-title-mismatch";
checks.chunkingPreservesText = chunks("a\n\n" + "b".repeat(1200), 1000).join("") === "a\n\n" + "b".repeat(1200);
checks.linkedTitleContext = translationPrompt("Test", "", { linkedTerms: "Ring = 环" }).includes("Linked-entry title mapping:\nRing = 环");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wikist-eom-import-check-"));
const sourceRoot = path.join(root, "release");
const wikistRoot = path.join(root, "wikist");
fs.mkdirSync(path.join(sourceRoot, "pages"), { recursive: true });
fs.mkdirSync(path.join(wikistRoot, "config"), { recursive: true });
fs.writeFileSync(path.join(wikistRoot, "package.json"), "{}\n", "utf8");
fs.writeFileSync(path.join(wikistRoot, "config", "site.config.json"), '{"passport":{"enabled":false}}\n', "utf8");
const packages = [
  { id: 1, slug: "eom/group", title: "群", redirectTarget: "" },
  { id: 2, slug: "eom/groups", title: "群（别名）", redirectTarget: "eom/group" },
];
const releaseEntries = [];
for (const item of packages) {
  const relativePath = `pages/${String(item.id).padStart(8, "0")}.json`;
  const bytes = Buffer.from(`${JSON.stringify({
    format: "wikist-page",
    version: 1,
    source: { site: "Encyclopedia of Mathematics", pageid: item.id, title: `Source ${item.id}`, revisionId: String(item.id) },
    translation: { status: "validated", issues: [] },
    page: {
      slug: item.slug,
      title: item.title,
      redirectTarget: item.redirectTarget,
      importSource: "encyclopedia-of-mathematics",
      importRevision: String(item.id),
      references: [],
      body: item.redirectTarget ? "" : "Validated article body.",
    },
  }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(sourceRoot, ...relativePath.split("/")), bytes);
  releaseEntries.push({
    sequence: releaseEntries.length,
    sourceId: item.id,
    sourceTitle: `Source ${item.id}`,
    slug: item.slug,
    title: item.title,
    redirectTarget: item.redirectTarget,
    sourceRevisionId: String(item.id),
    sourceOutputSha256: "",
    path: relativePath,
    sha256: sha256(bytes),
  });
}
const sourceIds = releaseEntries.map((entry) => entry.sourceId);
const contentEntries = releaseEntries.map(({ sequence, ...entry }) => entry);
const releaseManifest = {
  format: "wikist-eom-zh-package",
  formatVersion: 1,
  status: "ready",
  contentSha256: sha256(Buffer.from(JSON.stringify({ sourceIds, entries: contentEntries }), "utf8")),
  selection: { expectedEntries: 2, sourceIdsSha256: sha256(Buffer.from(sourceIds.join(","), "ascii")) },
  counts: { expected: 2, packaged: 2, pending: 0, invalid: 0, articles: 1, redirects: 1 },
  entries: releaseEntries,
};
const manifestBytes = Buffer.from(`${JSON.stringify(releaseManifest, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(sourceRoot, "manifest.json"), manifestBytes);
fs.writeFileSync(path.join(sourceRoot, "checksums.sha256"), `${releaseEntries.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n${sha256(manifestBytes)}  manifest.json\n`, "utf8");
const originalWrite = process.stdout.write;
let dryRun;
process.stdout.write = () => true;
try {
  dryRun = importPackage({ packagePath: sourceRoot, root: wikistRoot, batchSize: 200, statePath: "", overwrite: false, backup: false, dryRun: true });
} finally {
  process.stdout.write = originalWrite;
}
checks.importPreflight = dryRun.packageEntries === 2 && dryRun.plannedImports === 2 && dryRun.failedPreflight === 0;
fs.rmSync(root, { recursive: true, force: true });

for (const [name, passed] of Object.entries(checks)) assert.strictEqual(passed, true, `failed: ${name}`);
process.stdout.write(`${JSON.stringify({ passed: Object.keys(checks).length, checks }, null, 2)}\n`);
