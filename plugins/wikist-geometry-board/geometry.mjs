let assetsPromise = null;
let resizeObserver = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.JXG) { resolve(); return; }
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("JSXGraph 资源加载失败。")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("JSXGraph 资源加载失败。"));
    document.head.appendChild(script);
  });
}

function ensureAssets(settings) {
  if (!document.querySelector("link[data-wikist-jsxgraph]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = settings.cssCdn || "https://cdn.jsdelivr.net/npm/jsxgraph@1.10.1/distrib/jsxgraph.css";
    link.dataset.wikistJsxgraph = "true";
    document.head.appendChild(link);
  }
  if (!assetsPromise) assetsPromise = loadScript(settings.cdn || "https://cdn.jsdelivr.net/npm/jsxgraph@1.10.1/distrib/jsxgraphcore.js");
  return assetsPromise;
}

function readConfig(figure) {
  try {
    return JSON.parse(figure.querySelector(".geometry-board-config")?.textContent || "{}");
  } catch (_error) {
    return {};
  }
}

function palette() {
  const light = document.documentElement.dataset.theme === "light";
  return light ? { point: "#0969da", line: "#1f2328", fill: "rgba(9,105,218,.14)" } : { point: "#7cffb4", line: "#bdebe0", fill: "rgba(56,232,255,.13)" };
}

function sizeFor(target, config) {
  const width = Math.max(240, Math.floor(target.getBoundingClientRect().width || target.clientWidth || 680));
  const configured = Number(config.height || 380) || 380;
  const height = Math.max(220, Math.min(configured, Math.round(width * (width < 520 ? .72 : .58))));
  return { width, height };
}

async function renderFigure(figure, settings, index) {
  const target = figure.querySelector(".geometry-board-target");
  if (!target) return;
  const config = readConfig(figure);
  await ensureAssets(settings);
  const id = target.id || `wikist-geometry-${Date.now()}-${index}`;
  target.id = id;
  if (figure._wikistGeometryBoard) window.JXG.JSXGraph.freeBoard(figure._wikistGeometryBoard);
  const draw = () => {
    const { width, height } = sizeFor(target, config);
    target.style.height = `${height}px`;
    const colors = palette();
    const board = window.JXG.JSXGraph.initBoard(id, {
      boundingbox: Array.isArray(config.bbox) && config.bbox.length === 4 ? config.bbox : [-6, 6, 6, -6],
      axis: config.axis !== false,
      grid: config.grid !== false,
      keepaspectratio: false,
      showCopyright: false,
      showNavigation: true,
      pan: { enabled: true },
      zoom: { enabled: true },
    });
    const points = new Map();
    (config.points || []).forEach((point) => {
      points.set(point.id, board.create("point", [Number(point.x), Number(point.y)], {
        name: point.label || point.id,
        size: 3,
        face: "o",
        strokeColor: colors.point,
        fillColor: colors.point,
        label: { strokeColor: colors.line },
      }));
    });
    (config.shapes || []).forEach((shape) => {
      const refs = (shape.points || []).map((name) => points.get(name)).filter(Boolean);
      if (shape.type === "polygon" && refs.length >= 3) board.create("polygon", refs, { borders: { strokeColor: colors.line, strokeWidth: 2 }, fillColor: colors.fill, fillOpacity: .22, vertices: { visible: false } });
      if (shape.type === "segment" && refs.length === 2) board.create("segment", refs, { strokeColor: colors.line, strokeWidth: 2 });
      if (shape.type === "line" && refs.length === 2) board.create("line", refs, { strokeColor: colors.line, strokeWidth: 1.7 });
      if (shape.type === "circle" && refs.length === 2) board.create("circle", refs, { strokeColor: colors.point, strokeWidth: 2, fillColor: colors.fill, fillOpacity: .12 });
    });
    figure._wikistGeometryBoard = board;
    figure.dataset.geometryRendered = "true";
    figure.dataset.geometryWidth = String(width);
  };
  draw();
  if (!resizeObserver && "ResizeObserver" in window) {
    resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const current = entry.target.closest(".wikist-geometry-board");
        if (!current?._wikistGeometryBoard) return;
        const nextWidth = Math.round(entry.contentRect.width || 0);
        if (!nextWidth || Math.abs(nextWidth - Number(current.dataset.geometryWidth || 0)) < 12) return;
        current._wikistGeometryBoard.resizeContainer(nextWidth, Math.max(220, Math.round(nextWidth * .58)), true);
        current.dataset.geometryWidth = String(nextWidth);
      });
    });
  }
  if (resizeObserver && target.dataset.geometryObserved !== "true") {
    resizeObserver.observe(target);
    target.dataset.geometryObserved = "true";
  }
}

export function activate(context) {
  const hydrate = async () => {
    const settings = context.state.site?.plugins?.geometryBoard || {};
    const figures = [...document.querySelectorAll(".wikist-geometry-board:not([data-geometry-rendered])")];
    if (!figures.length || settings.enabled === false) return;
    await Promise.all(figures.map((figure, index) => renderFigure(figure, settings, index).catch((error) => {
      figure.dataset.geometryRendered = "error";
      const target = figure.querySelector(".geometry-board-target");
      if (target) target.textContent = `几何建模渲染失败：${error.message}`;
    })));
  };
  document.addEventListener("wikist:plugins-hydrate", () => hydrate());
  return hydrate();
}
