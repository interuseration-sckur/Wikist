let installed = false;
let latestContext = null;
let introRunning = false;
let routeTimer = 0;
let routeProgressTimer = 0;
let routeProgress = 0;
let pointerFrame = 0;
const particleTitles = new WeakMap();

const TEXT = {
  "zh-CN": {
    introTitle: "星际跃迁",
    introStatus: "正在校准知识星图",
    introSub: "连接 Wikist 知识核心",
    introSkip: "点击跳过",
    loaderTitle: "知识跃迁中",
    loaderStatus: "正在同步词条、身份与可视化模块",
    blackHole: "引力核心",
  },
  "zh-TW": {
    introTitle: "星際躍遷",
    introStatus: "正在校準知識星圖",
    introSub: "連接 Wikist 知識核心",
    introSkip: "點擊跳過",
    loaderTitle: "知識躍遷中",
    loaderStatus: "正在同步詞條、身份與視覺模組",
    blackHole: "引力核心",
  },
  en: {
    introTitle: "Warp Jump",
    introStatus: "Calibrating the knowledge atlas",
    introSub: "Connecting to the Wikist core",
    introSkip: "Click to skip",
    loaderTitle: "Knowledge Jump",
    loaderStatus: "Synchronizing pages, identity, and visual modules",
    blackHole: "Gravity Core",
  },
};

function settings() {
  return latestContext?.state?.site?.plugins?.cosmicExperience || {};
}

function enabled() {
  return settings().enabled !== false;
}

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

function langKey() {
  const raw = String(
    latestContext?.state?.uiLanguage ||
    document.documentElement.dataset.uiLanguage ||
    document.documentElement.lang ||
    latestContext?.state?.site?.language ||
    "zh-CN"
  );
  if (/^en\b/i.test(raw)) return "en";
  if (/^zh-(tw|hk|mo)\b/i.test(raw)) return "zh-TW";
  return "zh-CN";
}

function text(key) {
  return (TEXT[langKey()] || TEXT["zh-CN"])[key] || TEXT["zh-CN"][key] || key;
}

function maxDpr() {
  const value = Number(settings().maxDpr || 1.5);
  return Math.max(1, Math.min(value, 2));
}

function intensityValue() {
  const mode = String(settings().intensity || "balanced").toLowerCase();
  if (mode === "low") return .72;
  if (mode === "high" || mode === "cinematic") return 1.18;
  return 1;
}

function isLightTheme() {
  return document.documentElement.dataset.theme === "light";
}

function ensureStyle() {
  if (document.querySelector("style[data-wikist-cosmic-experience]")) return;
  const style = document.createElement("style");
  style.dataset.wikistCosmicExperience = "true";
  style.textContent = `
    :root {
      --wikist-cosmic-x: 52%;
      --wikist-cosmic-y: 42%;
      --wikist-cosmic-tilt-x: 0px;
      --wikist-cosmic-tilt-y: 0px;
    }

    .wikist-cosmic-nebula-layer {
      position: fixed;
      inset: -8%;
      z-index: 1;
      pointer-events: none;
      opacity: 0;
      transition: opacity .42s ease;
      background:
        radial-gradient(circle at var(--wikist-cosmic-x) var(--wikist-cosmic-y), rgba(56, 232, 255, .18), transparent 24%),
        radial-gradient(circle at calc(var(--wikist-cosmic-x) - 22%) calc(var(--wikist-cosmic-y) + 16%), rgba(124, 255, 180, .11), transparent 28%),
        conic-gradient(from 132deg at calc(var(--wikist-cosmic-x) + 8%) calc(var(--wikist-cosmic-y) + 4%), transparent 0 28%, rgba(255, 209, 102, .09), transparent 46% 100%);
      mix-blend-mode: screen;
      transform: translate3d(var(--wikist-cosmic-tilt-x), var(--wikist-cosmic-tilt-y), 0) scale(1.02);
      will-change: opacity, transform;
    }

    .wikist-cosmic-nebula-layer.active {
      opacity: .78;
    }

    :root[data-theme="light"] .wikist-cosmic-nebula-layer {
      opacity: 0;
      mix-blend-mode: multiply;
    }

    :root[data-theme="light"] .wikist-cosmic-nebula-layer.active {
      opacity: .18;
    }

    .wikist-warp-intro {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      place-items: center;
      overflow: hidden;
      background: #010409;
      color: #f2fdff;
      cursor: pointer;
    }

    :root[data-theme="light"] .wikist-warp-intro {
      background:
        radial-gradient(circle at 50% 45%, rgba(0, 126, 167, .20), transparent 24%),
        radial-gradient(circle at 38% 58%, rgba(0, 139, 95, .12), transparent 32%),
        linear-gradient(180deg, #f8fffd 0%, #eaf7f5 100%);
      color: #143129;
    }

    .wikist-warp-intro canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }

    .wikist-warp-copy {
      position: relative;
      z-index: 1;
      display: grid;
      gap: 14px;
      width: min(560px, calc(100vw - 40px));
      text-align: center;
      text-shadow: 0 0 28px rgba(56, 232, 255, .32);
    }

    .wikist-warp-copy span {
      color: #7cffb4;
      font-size: .8rem;
      font-weight: 900;
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    .wikist-warp-copy strong {
      font-size: clamp(2.4rem, 8vw, 6.8rem);
      line-height: 1;
      letter-spacing: 0;
    }

    .wikist-warp-copy small {
      color: rgba(237, 247, 242, .72);
      font-size: .9rem;
    }

    :root[data-theme="light"] .wikist-warp-copy {
      text-shadow: 0 0 24px rgba(0, 126, 167, .16);
    }

    :root[data-theme="light"] .wikist-warp-copy span,
    :root[data-theme="light"] .wikist-cosmic-route-loader strong {
      color: #007a68;
    }

    :root[data-theme="light"] .wikist-warp-copy small,
    :root[data-theme="light"] .wikist-cosmic-route-loader span {
      color: rgba(20, 49, 41, .68);
    }

    .wikist-warp-progress,
    .wikist-cosmic-route-meter {
      position: relative;
      overflow: hidden;
      height: 6px;
      border: 1px solid rgba(56, 232, 255, .28);
      border-radius: 999px;
      background: rgba(255, 255, 255, .08);
      box-shadow: 0 0 30px rgba(56, 232, 255, .16);
    }

    .wikist-warp-progress i,
    .wikist-cosmic-route-meter i {
      display: block;
      width: var(--progress, 8%);
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #38e8ff, #7cffb4, #ffd166);
      box-shadow: 0 0 18px rgba(124, 255, 180, .5);
      transition: width .28s ease;
    }

    .wikist-warp-intro.leaving {
      opacity: 0;
      transform: scale(1.04);
      transition: opacity .36s ease, transform .36s ease;
    }

    .wikist-cosmic-route-loader {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at 50% 48%, rgba(56, 232, 255, .12), transparent 32%),
        color-mix(in srgb, #010409 94%, transparent);
      backdrop-filter: blur(10px);
      color: #f2fdff;
      opacity: 0;
      pointer-events: none;
      transition: opacity .2s ease;
      overflow: hidden;
    }

    :root[data-theme="light"] .wikist-cosmic-route-loader {
      background:
        radial-gradient(circle at 50% 48%, rgba(0, 126, 167, .1), transparent 32%),
        rgba(244, 251, 249, .94);
      color: #143129;
    }

    .wikist-cosmic-route-loader::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(rgba(56, 232, 255, .055) 1px, transparent 1px),
        linear-gradient(90deg, rgba(56, 232, 255, .055) 1px, transparent 1px);
      background-size: 48px 48px;
      mask-image: radial-gradient(circle at center, #000 0 24%, transparent 72%);
      opacity: .5;
    }

    :root[data-theme="light"] .wikist-cosmic-route-loader::before {
      background:
        linear-gradient(rgba(0, 126, 167, .06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 126, 167, .06) 1px, transparent 1px);
      background-size: 48px 48px;
      opacity: .42;
    }

    .wikist-cosmic-route-loader.visible {
      opacity: 1;
    }

    .wikist-cosmic-route-panel {
      position: relative;
      z-index: 1;
      width: min(390px, calc(100vw - 42px));
      padding: 28px;
      border: 1px solid rgba(56, 232, 255, .28);
      border-radius: 8px;
      background: rgba(5, 15, 18, .86);
      box-shadow: 0 18px 70px rgba(0, 0, 0, .32), inset 0 0 34px rgba(56, 232, 255, .045);
    }

    :root[data-theme="light"] .wikist-cosmic-route-panel {
      border-color: rgba(0, 126, 167, .24);
      background: rgba(255, 255, 255, .9);
      box-shadow: 0 18px 70px rgba(25, 80, 68, .12), inset 0 0 34px rgba(0, 126, 167, .04);
    }

    .wikist-cosmic-route-mark {
      display: grid;
      width: 42px;
      height: 42px;
      place-items: center;
      margin: 0 auto 16px;
      border: 1px solid rgba(56, 232, 255, .42);
      border-radius: 50%;
      color: #38e8ff;
      font-weight: 900;
      box-shadow: 0 0 24px rgba(56, 232, 255, .14);
    }

    .wikist-cosmic-route-loader strong,
    .wikist-cosmic-route-loader span {
      display: block;
      text-align: center;
    }

    .wikist-cosmic-route-loader strong {
      color: #7cffb4;
      font-size: .82rem;
      font-weight: 900;
      letter-spacing: .08em;
    }

    .wikist-cosmic-route-loader span {
      margin: 9px 0 14px;
      color: rgba(237, 247, 242, .78);
      font-size: .94rem;
    }

    .wikist-black-hole {
      position: absolute;
      inset: 30px 8% 12px;
      z-index: 1;
      display: grid;
      place-items: center;
      pointer-events: none;
      opacity: .98;
    }

    .wikist-black-hole::before,
    .wikist-black-hole::after {
      content: "";
      position: absolute;
      border-radius: 50%;
    }

    .wikist-black-hole::before {
      width: min(320px, 78%);
      aspect-ratio: 2.55 / 1;
      background:
        conic-gradient(from 0deg, rgba(56, 232, 255, 0), rgba(56, 232, 255, .65), rgba(255, 209, 102, .55), rgba(124, 255, 180, .45), rgba(56, 232, 255, 0)),
        radial-gradient(ellipse at center, transparent 0 34%, rgba(56, 232, 255, .22) 36%, transparent 72%);
      filter: blur(.2px) drop-shadow(0 0 24px rgba(56, 232, 255, .34));
      transform: rotate(-10deg);
      animation: wikist-disk-spin 10s linear infinite;
    }

    .wikist-black-hole::after {
      width: 82px;
      aspect-ratio: 1;
      background:
        radial-gradient(circle, #000 0 45%, rgba(3, 7, 11, .96) 46% 60%, rgba(56, 232, 255, .36) 62%, transparent 72%);
      box-shadow: 0 0 44px rgba(56, 232, 255, .28), inset 0 0 20px #000;
    }

    .wikist-black-hole span {
      position: absolute;
      bottom: 8px;
      color: rgba(237, 247, 242, .46);
      font-size: .68rem;
      font-weight: 900;
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    :root[data-theme="light"] .wikist-black-hole {
      opacity: .90;
    }

    :root[data-theme="light"] .wikist-black-hole::before {
      background:
        conic-gradient(from 0deg, rgba(0, 126, 167, 0), rgba(0, 126, 167, .42), rgba(255, 184, 77, .34), rgba(0, 139, 95, .30), rgba(0, 126, 167, 0)),
        radial-gradient(ellipse at center, transparent 0 34%, rgba(0, 126, 167, .14) 36%, transparent 72%);
      filter: blur(.2px) drop-shadow(0 0 20px rgba(0, 126, 167, .18));
    }

    :root[data-theme="light"] .wikist-black-hole::after {
      background:
        radial-gradient(circle, #f8fffd 0 30%, rgba(15, 43, 37, .18) 31% 48%, rgba(0, 126, 167, .28) 50%, transparent 72%);
      box-shadow: 0 0 36px rgba(0, 126, 167, .16), inset 0 0 16px rgba(0, 126, 167, .18);
    }

    :root[data-theme="light"] .wikist-black-hole span {
      color: rgba(20, 49, 41, .52);
    }

    @keyframes wikist-disk-spin {
      from { transform: rotate(-10deg); }
      to { transform: rotate(350deg); }
    }

    .wikist-particle-title {
      position: relative;
      display: inline-block;
      color: #f4fbff !important;
      text-shadow: 0 0 26px rgba(56, 232, 255, .28), 0 0 54px rgba(124, 255, 180, .14) !important;
    }

    .wikist-particle-title.cosmic-title-brand {
      color: transparent !important;
      text-shadow: none !important;
    }

    .wikist-particle-title canvas {
      position: absolute;
      inset: -12% 0 -18%;
      width: 100%;
      height: 132%;
      pointer-events: none;
      mix-blend-mode: screen;
      opacity: .92;
    }

    :root[data-theme="light"] .wikist-particle-title canvas {
      mix-blend-mode: normal;
      opacity: .96;
    }

    @media (max-width: 760px) {
      .wikist-black-hole {
        inset: 26px 0 92px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .wikist-cosmic-nebula-layer,
      .wikist-black-hole::before {
        animation: none !important;
        transition: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureNebula() {
  if (settings().parallaxNebula === false || reducedMotion()) return;
  let layer = document.querySelector(".wikist-cosmic-nebula-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "wikist-cosmic-nebula-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
  }
  const active = Boolean(document.querySelector(".sci-home, .auth-cyber-layout"));
  layer.classList.toggle("active", active);
}

function handlePointerMove(event) {
  if (pointerFrame || settings().parallaxNebula === false || reducedMotion()) return;
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = 0;
    const x = Math.max(0, Math.min(1, event.clientX / Math.max(1, window.innerWidth)));
    const y = Math.max(0, Math.min(1, event.clientY / Math.max(1, window.innerHeight)));
    document.documentElement.style.setProperty("--wikist-cosmic-x", `${Math.round(x * 100)}%`);
    document.documentElement.style.setProperty("--wikist-cosmic-y", `${Math.round(y * 100)}%`);
    document.documentElement.style.setProperty("--wikist-cosmic-tilt-x", `${((x - .5) * 18).toFixed(2)}px`);
    document.documentElement.style.setProperty("--wikist-cosmic-tilt-y", `${((y - .5) * 14).toFixed(2)}px`);
  });
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr());
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width, height };
}

function showIntro() {
  const config = settings();
  if (introRunning || config.intro === false || reducedMotion()) return;
  if (config.introOnce !== false) {
    try {
      if (sessionStorage.getItem("wikist-cosmic-intro")) return;
      sessionStorage.setItem("wikist-cosmic-intro", "1");
    } catch (_error) {}
  }
  introRunning = true;
  const overlay = document.createElement("div");
  overlay.className = "wikist-warp-intro";
  overlay.innerHTML = `
    <canvas aria-hidden="true"></canvas>
    <div class="wikist-warp-copy">
      <span data-cosmic-text="introStatus">${text("introStatus")}</span>
      <strong data-cosmic-text="introTitle">${text("introTitle")}</strong>
      <div class="wikist-warp-progress" aria-hidden="true"><i></i></div>
      <small data-cosmic-text="introSub">${text("introSub")} · ${text("introSkip")}</small>
    </div>`;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector("canvas");
  const lines = [];
  const count = Math.round(80 * intensityValue());
  for (let index = 0; index < count; index += 1) {
    lines.push({
      angle: Math.random() * Math.PI * 2,
      distance: Math.random(),
      speed: Math.random() * .018 + .012,
      hue: Math.random() > .58 ? 184 : Math.random() > .32 ? 146 : 42,
    });
  }
  let animation = 0;
  let start = performance.now();
  let introSize = setupCanvas(canvas);
  const resizeIntro = () => { introSize = setupCanvas(canvas); };
  window.addEventListener("resize", resizeIntro);
  const draw = (now) => {
    const { context, width, height } = introSize;
    const light = isLightTheme();
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.max(width, height) * .86;
    const progress = Math.min(1, (now - start) / 1650);
    overlay.style.setProperty("--progress", `${Math.round(progress * 100)}%`);
    context.fillStyle = light ? "#f8fffd" : "#010409";
    context.fillRect(0, 0, width, height);
    const nebula = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
    nebula.addColorStop(0, light ? "rgba(0,126,167,.18)" : "rgba(56,232,255,.28)");
    nebula.addColorStop(.26, light ? "rgba(0,139,95,.10)" : "rgba(124,255,180,.11)");
    nebula.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = nebula;
    context.fillRect(0, 0, width, height);
    lines.forEach((line) => {
      line.distance += line.speed * (1.2 + progress * 3);
      if (line.distance > 1) line.distance = Math.random() * .08;
      const inner = line.distance * radius * .08;
      const outer = line.distance * radius;
      const x1 = cx + Math.cos(line.angle) * inner;
      const y1 = cy + Math.sin(line.angle) * inner;
      const x2 = cx + Math.cos(line.angle) * outer;
      const y2 = cy + Math.sin(line.angle) * outer;
      const gradient = context.createLinearGradient(x1, y1, x2, y2);
      gradient.addColorStop(0, `hsla(${line.hue},95%,70%,0)`);
      gradient.addColorStop(1, light
        ? `hsla(${line.hue},72%,36%,${.14 + progress * .30})`
        : `hsla(${line.hue},95%,74%,${.22 + progress * .52})`);
      context.strokeStyle = gradient;
      context.lineWidth = 1 + progress * 2.4;
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    });
    if (progress < 1 && overlay.isConnected) animation = requestAnimationFrame(draw);
    else closeIntro();
  };
  const closeIntro = () => {
    if (!overlay.isConnected) return;
    overlay.classList.add("leaving");
    window.setTimeout(() => {
      cancelAnimationFrame(animation);
      window.removeEventListener("resize", resizeIntro);
      overlay.remove();
      introRunning = false;
    }, 380);
  };
  overlay.addEventListener("click", closeIntro, { once: true });
  start = performance.now();
  animation = requestAnimationFrame(draw);
}

function updateLocalizedText() {
  document.querySelectorAll("[data-cosmic-text]").forEach((node) => {
    const key = node.dataset.cosmicText;
    if (key === "introSub") node.textContent = `${text("introSub")} · ${text("introSkip")}`;
    else node.textContent = text(key);
  });
}

function showRouteLoader() {
  if (settings().routeLoader === false || reducedMotion()) return;
  document.documentElement.setAttribute("data-wikist-route-loader-provider", "cosmic");
  let loader = document.querySelector(".wikist-cosmic-route-loader");
  if (!loader) {
    loader = document.createElement("div");
    loader.className = "wikist-cosmic-route-loader";
    loader.innerHTML = `
      <div class="wikist-cosmic-route-panel">
        <b class="wikist-cosmic-route-mark" aria-hidden="true">W</b>
        <strong data-cosmic-text="loaderTitle">${text("loaderTitle")}</strong>
        <span data-cosmic-text="loaderStatus">${text("loaderStatus")}</span>
        <div class="wikist-cosmic-route-meter" aria-hidden="true"><i></i></div>
      </div>`;
    document.body.appendChild(loader);
  }
  routeProgress = 12;
  loader.style.setProperty("--progress", `${routeProgress}%`);
  loader.classList.add("visible");
  window.clearInterval(routeProgressTimer);
  routeProgressTimer = window.setInterval(() => {
    routeProgress = Math.min(86, routeProgress + Math.random() * 12 + 3);
    loader.style.setProperty("--progress", `${Math.round(routeProgress)}%`);
  }, 180);
}

function hideRouteLoader() {
  window.clearTimeout(routeTimer);
  routeTimer = 0;
  window.clearInterval(routeProgressTimer);
  routeProgressTimer = 0;
  const loader = document.querySelector(".wikist-cosmic-route-loader");
  if (document.documentElement.getAttribute("data-wikist-route-loader-provider") === "cosmic") {
    document.documentElement.removeAttribute("data-wikist-route-loader-provider");
  }
  if (!loader) return;
  loader.style.setProperty("--progress", "100%");
  window.setTimeout(() => {
    loader.classList.remove("visible");
    window.setTimeout(() => loader.remove(), 260);
  }, 120);
}

function hydrateBlackHole(root = document) {
  if (settings().authBlackHole === false) return;
  const consoles = [
    ...(root.matches?.(".auth-cosmic-console") ? [root] : []),
    ...Array.from(root.querySelectorAll?.(".auth-cosmic-console") || []),
  ];
  consoles.forEach((consoleEl) => {
    if (consoleEl.querySelector(".wikist-black-hole")) return;
    consoleEl.insertAdjacentHTML("afterbegin", `<div class="wikist-black-hole" aria-hidden="true"><span data-cosmic-text="blackHole">${text("blackHole")}</span></div>`);
  });
}

function targetPointsFromText(title, width, height, dpr) {
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.floor(width * dpr);
  offscreen.height = Math.floor(height * dpr);
  const context = offscreen.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const style = getComputedStyle(title);
  const fontSize = parseFloat(style.fontSize) || 48;
  const fontWeight = style.fontWeight || "900";
  const fontFamily = style.fontFamily || "system-ui, sans-serif";
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  context.fillText(title.textContent.trim(), width / 2, height / 2, width);
  const image = context.getImageData(0, 0, Math.floor(width * dpr), Math.floor(height * dpr)).data;
  const step = Math.max(3, Math.round(4 / intensityValue()));
  const points = [];
  for (let y = 0; y < height * dpr; y += step * dpr) {
    for (let x = 0; x < width * dpr; x += step * dpr) {
      const alpha = image[(Math.floor(y) * Math.floor(width * dpr) + Math.floor(x)) * 4 + 3];
      if (alpha > 80) points.push({ x: x / dpr, y: y / dpr });
    }
  }
  const max = Math.round(1600 * intensityValue());
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  return points.filter((_point, index) => index % stride === 0).slice(0, max);
}

function renderParticleTitle(title, canvas) {
  const rect = title.getBoundingClientRect();
  const width = Math.max(120, Math.floor(rect.width));
  const height = Math.max(64, Math.floor(rect.height * 1.2));
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr());
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const targets = targetPointsFromText(title, width, height, dpr);
  const particles = targets.map((target, index) => ({
    tx: target.x,
    ty: target.y,
    x: width * (.5 + (Math.random() - .5) * 1.8),
    y: height * (.5 + (Math.random() - .5) * 2.2),
    delay: (index % 37) * 7,
    hue: index % 5 === 0 ? 42 : index % 3 === 0 ? 146 : 184,
  }));
  const started = performance.now();
  const renderState = { canvas, animation: 0 };
  const draw = (now) => {
    const elapsed = now - started;
    const light = isLightTheme();
    context.clearRect(0, 0, width, height);
    particles.forEach((particle, index) => {
      const local = Math.max(0, Math.min(1, (elapsed - particle.delay) / 1650));
      const ease = 1 - Math.pow(1 - local, 3);
      const x = particle.x + (particle.tx - particle.x) * ease;
      const y = particle.y + (particle.ty - particle.y) * ease;
      const twinkle = elapsed > 1700 ? Math.sin(elapsed * .006 + index) * .18 + .82 : .95;
      context.fillStyle = light
        ? `hsla(${particle.hue},72%,34%,${(.48 + ease * .42) * twinkle})`
        : `hsla(${particle.hue},95%,78%,${(.4 + ease * .6) * twinkle})`;
      context.fillRect(x, y, 2.2, 2.2);
      if (index % 5 === 0) {
        context.fillStyle = light
          ? `hsla(${particle.hue},78%,46%,${(.20 + ease * .28) * twinkle})`
          : `hsla(${particle.hue},95%,88%,${(.2 + ease * .34) * twinkle})`;
        context.fillRect(x - .8, y - .8, 3.6, 3.6);
      }
    });
    if (elapsed < 5200 && canvas.isConnected) renderState.animation = requestAnimationFrame(draw);
  };
  const previous = particleTitles.get(title);
  if (previous?.animation) cancelAnimationFrame(previous.animation);
  renderState.animation = requestAnimationFrame(draw);
  particleTitles.set(title, renderState);
}

function hydrateParticleTitles(root = document) {
  if (settings().titleParticles === false || reducedMotion()) return;
  const titles = [
    ...(root.matches?.("[data-cosmic-title]") ? [root] : []),
    ...Array.from(root.querySelectorAll?.("[data-cosmic-title]") || []),
  ];
  titles.forEach((title) => {
    if (title.dataset.cosmicParticles === "true") return;
    title.dataset.cosmicParticles = "true";
    title.classList.add("wikist-particle-title");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    title.appendChild(canvas);
    requestAnimationFrame(() => renderParticleTitle(title, canvas));
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(() => renderParticleTitle(title, canvas));
      observer.observe(title);
    }
  });
}

function refreshParticleTitles(root = document) {
  Array.from(root.querySelectorAll?.(".wikist-particle-title[data-cosmic-title]") || []).forEach((title) => {
    const canvas = title.querySelector("canvas");
    if (canvas) requestAnimationFrame(() => renderParticleTitle(title, canvas));
  });
}

function hydrate(root = document) {
  if (!enabled()) return;
  ensureStyle();
  updateLocalizedText();
  ensureNebula();
  showIntro();
  hydrateBlackHole(root || document);
  hydrateParticleTitles(root || document);
}

function installEvents() {
  if (installed) return;
  installed = true;
  document.addEventListener("pointermove", handlePointerMove, { passive: true });
  document.addEventListener("wikist:route-loading", () => {
    if (!enabled() || settings().routeLoader === false || reducedMotion()) return;
    document.documentElement.setAttribute("data-wikist-route-loader-provider", "cosmic");
    window.clearTimeout(routeTimer);
    routeTimer = window.setTimeout(showRouteLoader, 140);
  });
  document.addEventListener("wikist:route-ready", () => {
    hideRouteLoader();
    window.setTimeout(() => hydrate(document), 0);
  });
  document.addEventListener("wikist:language-change", () => updateLocalizedText());
  document.addEventListener("wikist:theme-change", () => {
    ensureNebula();
    refreshParticleTitles(document);
  });
  document.addEventListener("wikist:plugins-hydrate", (event) => {
    latestContext = { ...latestContext, ...(event.detail || {}) };
    hydrate(event.detail?.root || document);
  });
}

export function activate(context) {
  latestContext = context;
  installEvents();
  hydrate(context.root || document);
}

export default activate;
