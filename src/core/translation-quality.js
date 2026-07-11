const crypto = require("crypto");

function normalizeSegment(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sourceHash(value) {
  return crypto.createHash("sha256").update(normalizeSegment(value)).digest("base64url");
}

function preview(value, limit = 118) {
  const text = normalizeSegment(value).replace(/\s+/g, " ");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function splitMarkdownSegments(markdown) {
  return normalizeSegment(markdown)
    .split(/\n\s*\n/g)
    .map((text, index) => ({ index, text: text.trim(), hash: sourceHash(text), preview: preview(text) }))
    .filter((segment) => segment.text);
}

function translationMemoryPairs(sourceMarkdown, translatedMarkdown) {
  const source = splitMarkdownSegments(sourceMarkdown);
  const translated = splitMarkdownSegments(translatedMarkdown);
  const pairs = [];
  const count = Math.min(source.length, translated.length);
  for (let index = 0; index < count; index += 1) {
    const sourceSegment = source[index];
    const translatedSegment = translated[index];
    if (!sourceSegment?.text || !translatedSegment?.text) continue;
    if (normalizeSegment(sourceSegment.text) === normalizeSegment(translatedSegment.text)) continue;
    pairs.push({
      sourceHash: sourceSegment.hash,
      sourceText: sourceSegment.text,
      targetText: translatedSegment.text,
    });
  }
  return pairs;
}

function translationSourceChanges(previousMarkdown, currentMarkdown) {
  const previous = splitMarkdownSegments(previousMarkdown);
  const current = splitMarkdownSegments(currentMarkdown);
  const previousHashes = new Set(previous.map((segment) => segment.hash));
  const currentHashes = new Set(current.map((segment) => segment.hash));
  const added = current.filter((segment) => !previousHashes.has(segment.hash));
  const removed = previous.filter((segment) => !currentHashes.has(segment.hash));
  return {
    hasChanges: added.length > 0 || removed.length > 0,
    previousSegmentCount: previous.length,
    currentSegmentCount: current.length,
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: added.length + removed.length,
    changedSegments: added.slice(0, 8).map((segment) => ({ type: "added", index: segment.index + 1, preview: segment.preview })),
    removedSegments: removed.slice(0, 4).map((segment) => ({ type: "removed", index: segment.index + 1, preview: segment.preview })),
  };
}

module.exports = {
  normalizeSegment,
  preview,
  sourceHash,
  splitMarkdownSegments,
  translationMemoryPairs,
  translationSourceChanges,
};
