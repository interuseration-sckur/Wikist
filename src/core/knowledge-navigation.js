function cleanName(value, max = 120) {
  return String(value || "").trim().replace(/\s*\/\s*/g, "/").replace(/^\/+|\/+$/g, "").slice(0, max);
}

function pagePreview(page) {
  return {
    slug: page.slug,
    title: page.title,
    summary: page.summary || "",
    categories: page.categories || [],
    quality: page.quality || "C",
    difficulty: page.difficulty || "未分级",
    status: page.status || "draft",
    topic: page.topic || "",
    updatedAt: page.updatedAt || "",
  };
}

function parentPath(value) {
  const parts = cleanName(value).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function childName(parent, value) {
  const normalized = cleanName(value);
  const prefix = parent ? `${parent}/` : "";
  if (!normalized.startsWith(prefix)) return "";
  const rest = normalized.slice(prefix.length);
  return rest.includes("/") ? rest.split("/")[0] : rest;
}

function qualityDistribution(pages) {
  const distribution = {};
  for (const page of pages) {
    const quality = String(page.quality || "C");
    distribution[quality] = (distribution[quality] || 0) + 1;
  }
  return distribution;
}

function categorySnapshot(pages = []) {
  const pageList = pages.filter((page) => page && !page.redirectTarget);
  const categories = new Map();
  const topics = new Map();
  const categoryDescendants = new Map();
  const topicDescendants = new Map();
  const addPath = (map, descendants, value, page) => {
    const parts = cleanName(value).split("/").filter(Boolean);
    for (let index = 1; index <= parts.length; index += 1) {
      const name = parts.slice(0, index).join("/");
      if (!map.has(name)) map.set(name, []);
      if (!descendants.has(name)) descendants.set(name, new Map());
      descendants.get(name).set(page.slug, page);
    }
    const direct = map.get(parts.join("/"));
    if (direct && !direct.some((item) => item.slug === page.slug)) direct.push(page);
  };
  for (const page of pageList) {
    for (const rawCategory of page.categories || []) {
      const name = cleanName(rawCategory);
      if (!name) continue;
      addPath(categories, categoryDescendants, name, page);
    }
    const topic = cleanName(page.topic);
    if (topic) {
      addPath(topics, topicDescendants, topic, page);
    }
  }
  const pathItems = (map, descendants) => [...map.entries()].map(([name, directPages]) => {
    const matchedPages = [...(descendants.get(name)?.values() || [])];
    return {
      name,
      parent: parentPath(name),
      directPageCount: directPages.length,
      pageCount: matchedPages.length,
      qualities: qualityDistribution(matchedPages),
      updatedAt: matchedPages.map((page) => page.updatedAt).filter(Boolean).sort().reverse()[0] || "",
    };
  }).sort((a, b) => b.pageCount - a.pageCount || a.name.localeCompare(b.name, "zh-CN"));
  const categoryItems = pathItems(categories, categoryDescendants);
  const topicItems = pathItems(topics, topicDescendants);
  return {
    categories,
    topics,
    categoryItems,
    topicItems,
    rootCategoryItems: categoryItems.filter((item) => !item.parent),
    rootTopicItems: topicItems.filter((item) => !item.parent),
  };
}

function categoryDetail(pages = [], category = "") {
  const name = cleanName(category);
  const snapshot = categorySnapshot(pages);
  const direct = (snapshot.categories.get(name) || []).slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt) || a.title.localeCompare(b.title, "zh-CN"));
  const children = snapshot.categoryItems
    .filter((item) => item.parent === name)
    .map((item) => ({ ...item, label: childName(name, item.name) || item.name }));
  const ancestors = [];
  let cursor = parentPath(name);
  while (cursor) {
    ancestors.unshift(cursor);
    cursor = parentPath(cursor);
  }
  return {
    name,
    exists: snapshot.categories.has(name) || children.length > 0,
    ancestors,
    children,
    pages: direct.map(pagePreview),
    qualityDistribution: qualityDistribution(direct),
    topics: [...new Set(direct.map((page) => cleanName(page.topic)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    updatedAt: direct.map((page) => page.updatedAt).filter(Boolean).sort().reverse()[0] || "",
  };
}

function topicDetail(pages = [], topic = "") {
  const name = cleanName(topic);
  const snapshot = categorySnapshot(pages);
  const direct = (snapshot.topics.get(name) || []).slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt) || a.title.localeCompare(b.title, "zh-CN"));
  const children = snapshot.topicItems
    .filter((item) => item.parent === name)
    .map((item) => ({ ...item, label: childName(name, item.name) || item.name }));
  return {
    name,
    exists: snapshot.topics.has(name) || children.length > 0,
    children,
    pages: direct.map(pagePreview),
    qualityDistribution: qualityDistribution(direct),
  };
}

module.exports = {
  categorySnapshot,
  categoryDetail,
  cleanName,
  topicDetail,
};
