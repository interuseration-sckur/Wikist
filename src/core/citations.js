const CITATION_TYPES = ["article", "book", "chapter", "preprint", "conference", "thesis", "web", "dataset", "other"];

function cleanText(value, maxLength = 2000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeCitationId(value, fallback = "") {
  const normalized = cleanText(value, 96).toLowerCase().replace(/\s+/g, "-");
  if (/^[a-z0-9][a-z0-9._:-]{0,95}$/.test(normalized)) return normalized;
  return fallback;
}

function normalizeDoi(value) {
  const raw = cleanText(value, 320)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi\s*:\s*/i, "")
    .replace(/[.,;]+$/, "");
  if (!raw) return "";
  return /^10\.\d{4,9}\/[\w.()/:;-]+$/i.test(raw) ? raw.toLowerCase() : "";
}

function normalizeArxiv(value) {
  const raw = cleanText(value, 120)
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/abs\//i, "")
    .replace(/^arxiv\s*:\s*/i, "")
    .replace(/[.,;]+$/, "");
  if (!raw) return "";
  return /^(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z-]+)?\/\d{7}(?:v\d+)?)$/i.test(raw) ? raw : "";
}

function normalizeUrl(value) {
  const raw = cleanText(value, 1000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch (_error) {
    return "";
  }
}

function normalizeYear(value) {
  const year = Number(String(value || "").match(/\d{4}/)?.[0] || 0);
  return year >= 1000 && year <= 3000 ? String(year) : "";
}

function normalizeAuthors(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[;\n]/);
  return [...new Set(raw.map((author) => cleanText(author, 180)).filter(Boolean))].slice(0, 40);
}

function makeReferenceId(record, index, usedIds) {
  const author = (record.authors?.[0] || "source").replace(/[^a-z0-9]+/gi, "").toLowerCase().slice(0, 22);
  const year = record.year || "nd";
  const title = String(record.title || "reference").replace(/[^a-z0-9]+/gi, "").toLowerCase().slice(0, 20);
  const base = normalizeCitationId(`${author || "source"}-${year}-${title || index + 1}`, `source-${index + 1}`);
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function normalizeReference(input = {}, index = 0, usedIds = new Set()) {
  const source = input && typeof input === "object" ? input : {};
  const authors = normalizeAuthors(source.authors || source.author);
  const title = cleanText(source.title, 500);
  const year = normalizeYear(source.year);
  const doi = normalizeDoi(source.doi);
  const arxiv = normalizeArxiv(source.arxiv || source.arXiv);
  const url = normalizeUrl(source.url || source.link);
  const type = CITATION_TYPES.includes(String(source.type || "").toLowerCase()) ? String(source.type).toLowerCase() : "other";
  const partial = {
    type,
    authors,
    title,
    containerTitle: cleanText(source.containerTitle || source.journal || source.publication, 400),
    publisher: cleanText(source.publisher, 240),
    year,
    volume: cleanText(source.volume, 80),
    issue: cleanText(source.issue || source.number, 80),
    pages: cleanText(source.pages || source.page, 120),
    doi,
    arxiv,
    url,
    accessed: cleanText(source.accessed || source.accessDate, 40),
    note: cleanText(source.note, 800),
    language: cleanText(source.language, 40),
  };
  const id = normalizeCitationId(source.id || source.key) || makeReferenceId(partial, index, usedIds);
  usedIds.add(id);
  return { id, ...partial };
}

function normalizeReferences(value) {
  const input = Array.isArray(value) ? value : [];
  const usedIds = new Set();
  return input.slice(0, 120).map((item, index) => normalizeReference(item, index, usedIds));
}

function referenceIssues(reference = {}) {
  const issues = [];
  if (!reference.authors?.length) issues.push("缺少作者");
  if (!reference.title) issues.push("缺少题名");
  if (!reference.year) issues.push("缺少年份");
  if (reference.type === "article" && !reference.containerTitle) issues.push("缺少期刊或出版物");
  if (["article", "preprint", "web", "dataset"].includes(reference.type) && !reference.doi && !reference.arxiv && !reference.url) issues.push("缺少可核验标识符");
  return issues;
}

function referenceQuality(reference = {}) {
  const issues = referenceIssues(reference);
  let score = 0;
  if (reference.authors?.length) score += 16;
  if (reference.title) score += 20;
  if (reference.year) score += 12;
  if (reference.containerTitle || reference.publisher) score += 12;
  if (reference.volume || reference.issue || reference.pages) score += 8;
  if (reference.doi) score += 20;
  else if (reference.arxiv) score += 16;
  else if (reference.url) score += 10;
  if (reference.accessed && reference.type === "web") score += 4;
  if (reference.note) score += 2;
  return { score: Math.max(0, Math.min(100, score)), issues, verifiable: Boolean(reference.doi || reference.arxiv || reference.url) };
}

function formatReferenceText(reference = {}) {
  const parts = [];
  if (reference.authors?.length) parts.push(reference.authors.join(", "));
  if (reference.year) parts.push(`(${reference.year})`);
  if (reference.title) parts.push(reference.title);
  if (reference.containerTitle) parts.push(reference.containerTitle);
  const detail = [reference.volume, reference.issue ? `(${reference.issue})` : "", reference.pages ? `pp. ${reference.pages}` : ""].filter(Boolean).join(" ");
  if (detail) parts.push(detail);
  if (reference.publisher) parts.push(reference.publisher);
  return parts.filter(Boolean).join(". ");
}

module.exports = {
  CITATION_TYPES,
  normalizeCitationId,
  normalizeDoi,
  normalizeArxiv,
  normalizeUrl,
  normalizeReferences,
  referenceIssues,
  referenceQuality,
  formatReferenceText,
};
