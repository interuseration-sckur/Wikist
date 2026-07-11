function revisionIdFromDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().replace(/[:.]/g, "-");
}

function splitLines(value) {
  const text = String(value || "").replace(/\r\n/g, "\n");
  return text ? text.split("\n") : [];
}

function edgeDiff(before, after) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) suffix += 1;
  return [
    ...before.slice(0, prefix).map((text) => ({ type: "equal", text })),
    ...before.slice(prefix, before.length - suffix).map((text) => ({ type: "remove", text })),
    ...after.slice(prefix, after.length - suffix).map((text) => ({ type: "add", text })),
    ...before.slice(before.length - suffix).map((text) => ({ type: "equal", text })),
  ];
}

function buildLineDiff(previous, current, options = {}) {
  const before = splitLines(previous);
  const after = splitLines(current);
  const maxCells = Math.max(10_000, Number(options.maxCells) || 160_000);
  if (!before.length && !after.length) return [];
  if (before.length * after.length > maxCells) return edgeDiff(before, after);

  const rows = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      rows[left][right] = before[left] === after[right]
        ? rows[left + 1][right + 1] + 1
        : Math.max(rows[left + 1][right], rows[left][right + 1]);
    }
  }

  const output = [];
  let left = 0;
  let right = 0;
  while (left < before.length && right < after.length) {
    if (before[left] === after[right]) {
      output.push({ type: "equal", text: before[left] });
      left += 1;
      right += 1;
    } else if (rows[left + 1][right] >= rows[left][right + 1]) {
      output.push({ type: "remove", text: before[left] });
      left += 1;
    } else {
      output.push({ type: "add", text: after[right] });
      right += 1;
    }
  }
  while (left < before.length) output.push({ type: "remove", text: before[left++] });
  while (right < after.length) output.push({ type: "add", text: after[right++] });
  return output;
}

module.exports = {
  buildLineDiff,
  revisionIdFromDate,
};
