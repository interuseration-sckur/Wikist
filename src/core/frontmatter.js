function parseScalar(value, key) {
  const trimmed = String(value || "").trim();
  if (key === "references" && trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch (_error) {}
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  if ((key === "categories" || key === "aliases") && trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseFrontMatter(source) {
  const text = String(source || "");
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { data: {}, body: text };
  }

  const normalized = text.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return { data: {}, body: text };
  }

  const raw = normalized.slice(4, end);
  const data = {};

  for (const line of raw.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    data[key] = parseScalar(value, key);
  }

  return {
    data,
    body: normalized.slice(end + 5),
  };
}

function serializeFrontMatter(data, body) {
  const lines = ["---"];
  const sorted = [
    "title",
    "summary",
    "categories",
    "difficulty",
    "status",
    "quality",
    "author",
    "createdAt",
    "updatedAt",
  ];
  const keys = [
    ...sorted.filter((key) => Object.prototype.hasOwnProperty.call(data, key)),
    ...Object.keys(data).filter((key) => !sorted.includes(key)).sort(),
  ];

  for (const key of keys) {
    const value = data[key];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: ${key === "references" ? JSON.stringify(value) : `[${value.join(", ")}]`}`);
    } else {
      lines.push(`${key}: ${String(value).replace(/\n/g, " ")}`);
    }
  }

  lines.push("---", "");
  return `${lines.join("\n")}${String(body || "").replace(/^\s+/, "")}`;
}

module.exports = {
  parseFrontMatter,
  serializeFrontMatter,
};
