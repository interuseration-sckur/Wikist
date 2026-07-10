let assetsPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Chart) { resolve(); return; }
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("Chart.js 资源加载失败。")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Chart.js 资源加载失败。"));
    document.head.appendChild(script);
  });
}

function readConfig(figure) {
  try {
    return JSON.parse(figure.querySelector(".math-chart-config")?.textContent || "{}");
  } catch (_error) {
    return {};
  }
}

function palette(index) {
  const light = document.documentElement.dataset.theme === "light";
  const colors = light ? ["#0969da", "#d1246f", "#238636", "#9a6700"] : ["#38e8ff", "#7cffb4", "#ffd166", "#ff5f8a"];
  return colors[index % colors.length];
}

function themeColors() {
  return document.documentElement.dataset.theme === "light"
    ? { text: "#57606a", grid: "rgba(31,35,40,.12)" }
    : { text: "#9bb0a8", grid: "rgba(237,247,242,.10)" };
}

async function renderFigure(figure, settings) {
  const config = readConfig(figure);
  if (!assetsPromise) assetsPromise = loadScript(settings.cdn || "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js");
  await assetsPromise;
  const target = figure.querySelector(".math-chart-target");
  const canvas = target?.querySelector("canvas");
  if (!canvas) return;
  if (figure._wikistChart) figure._wikistChart.destroy();
  const colors = themeColors();
  const isScatter = config.type === "scatter";
  const labels = Array.isArray(config.labels) ? config.labels : [];
  const datasets = (config.datasets || []).map((series, index) => {
    const color = series.color || palette(index);
    const values = Array.isArray(series.values) ? series.values : [];
    return {
      label: series.label || `数据 ${index + 1}`,
      data: isScatter ? values.map((value, valueIndex) => ({ x: Number(labels[valueIndex]) || valueIndex + 1, y: value })) : values,
      borderColor: color,
      backgroundColor: `${color}33`,
      pointBackgroundColor: color,
      pointRadius: isScatter ? 3 : 2.5,
      pointHoverRadius: 4,
      borderWidth: 2,
      tension: .24,
      fill: false,
    };
  });
  figure._wikistChart = new window.Chart(canvas, {
    type: config.type || "line",
    data: { labels: isScatter ? undefined : labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 220 },
      plugins: { legend: { labels: { color: colors.text, boxWidth: 12, usePointStyle: true } }, title: { display: false } },
      scales: {
        x: { title: { display: Boolean(config.xLabel), text: config.xLabel, color: colors.text }, ticks: { color: colors.text }, grid: { display: config.grid !== false, color: colors.grid } },
        y: { title: { display: Boolean(config.yLabel), text: config.yLabel, color: colors.text }, ticks: { color: colors.text }, grid: { display: config.grid !== false, color: colors.grid } },
      },
    },
  });
  figure.dataset.chartRendered = "true";
}

export function activate(context) {
  const hydrate = async () => {
    const settings = context.state.site?.plugins?.mathChart || {};
    const figures = [...document.querySelectorAll(".wikist-math-chart:not([data-chart-rendered])")];
    if (!figures.length || settings.enabled === false) return;
    await Promise.all(figures.map((figure) => renderFigure(figure, settings).catch((error) => {
      figure.dataset.chartRendered = "error";
      const target = figure.querySelector(".math-chart-target");
      if (target) target.textContent = `数据建模渲染失败：${error.message}`;
    })));
  };
  document.addEventListener("wikist:plugins-hydrate", () => hydrate());
  return hydrate();
}
