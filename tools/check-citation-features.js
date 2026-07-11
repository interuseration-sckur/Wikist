const fs = require("fs");
const path = require("path");
const { normalizeArxiv, normalizeDoi, normalizeReferences, referenceQuality } = require("../src/core/citations");
const { PageStore } = require("../src/core/page-store");
const { renderMarkdown } = require("../src/core/markdown");

const tempRoot = path.join(process.cwd(), "data", "wikist-citation-test");
fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
fs.mkdirSync(tempRoot, { recursive: true });

try {
  const references = normalizeReferences([
    {
      id: "hardy1908",
      type: "book",
      authors: ["Hardy, G. H."],
      title: "A Course of Pure Mathematics",
      year: "1908",
      publisher: "Cambridge University Press",
      doi: "https://doi.org/10.1017/CBO9780511705876",
    },
    {
      id: "riemann1851",
      type: "article",
      authors: "Riemann, B.",
      title: "Grundlagen fur eine allgemeine Theorie der Functionen einer veranderlichen complexen Grosse",
      year: "1851",
      containerTitle: "Inaugural Dissertation",
      pages: "1-54",
      arxiv: "arXiv:2401.01234v2",
    },
    { id: "incomplete", type: "article", title: "Incomplete source" },
  ]);
  const rendered = renderMarkdown("A claim [@hardy1908, p. 42; see @riemann1851].\n\nA weak claim {{cite-needed|requires a historical source}}.\n\nUnknown [@missing-source].", { references });
  const pages = new PageStore(tempRoot, {});
  const page = pages.savePage("citation-lab", {
    title: "Citation Lab",
    references,
    body: "A claim [@hardy1908].\n\n{{cite-needed|source needed}}",
  });
  const exported = pages.exportPage("citation-lab");
  const checks = {
    doiNormalized: normalizeDoi("doi:10.1017/CBO9780511705876") === "10.1017/cbo9780511705876",
    arxivNormalized: normalizeArxiv("https://arxiv.org/abs/2401.01234v2") === "2401.01234v2",
    inlineCitationRendered: rendered.html.includes("citation-ref") && rendered.html.includes("ref-hardy1908"),
    referenceListRendered: rendered.html.includes("参考文献") && rendered.html.includes("DOI: 10.1017/cbo9780511705876"),
    missingCitationFlagged: rendered.citationStats.unresolved.includes("missing-source") && rendered.html.includes("citation-missing"),
    citationNeededTracked: rendered.citationStats.citationNeeded === 1 && rendered.html.includes("citation-needed"),
    qualityFlagsIncomplete: referenceQuality(references[2]).issues.length >= 3,
    pagePersistsReferences: page.references.length === 3 && page.citationStats.total === 3 && page.citationStats.citationNeeded === 1,
    exportPreservesReferences: exported.page.references.length === 3 && exported.page.references[0].doi === "10.1017/cbo9780511705876",
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) {
    console.error(JSON.stringify({ ok: false, failed, checks, stats: rendered.citationStats, page }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length, qualityScore: rendered.citationStats.qualityScore }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
}
