function decodePathPart(value) {
  try {
    return decodeURIComponent(value || "");
  } catch (_error) {
    return value || "";
  }
}

function normalizeSlug(input) {
  const decoded = decodePathPart(input)
    .trim()
    .replace(/\\/g, "/")
    .replace(/\s+/g, "-")
    .replace(/^\/+|\/+$/g, "");

  const slug = decoded || "home";
  const parts = slug.split("/").filter(Boolean);

  if (!parts.length) {
    return "home";
  }

  for (const part of parts) {
    if (
      part === "." ||
      part === ".." ||
      /[\u0000-\u001f<>:"|?*]/u.test(part)
    ) {
      throw new Error("Invalid page slug.");
    }
  }

  return parts.join("/");
}

function slugToFileName(slug) {
  return `${normalizeSlug(slug)}.md`;
}

function fileNameToSlug(fileName) {
  return fileName.replace(/\\/g, "/").replace(/\.md$/i, "");
}

function slugToId(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";
}

module.exports = {
  decodePathPart,
  fileNameToSlug,
  normalizeSlug,
  slugToFileName,
  slugToId,
};
