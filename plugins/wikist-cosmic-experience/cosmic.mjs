let installed = false;
let latestContext = null;
let introRunning = false;
const particleTitles = new WeakMap();

const TEXT = {
  "zh-CN": {
    introTitle: "连接知识核心",
    introSkip: "点击跳过",
    blackHole: "引力核心",
  },
  "zh-TW": {
    introTitle: "連接知識核心",
    introSkip: "點擊跳過",
    blackHole: "引力核心",
  },
  en: {
    introTitle: "Connecting to the knowledge core",
    introSkip: "Click to skip",
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

function siteName() {
  return String(latestContext?.state?.site?.name || "Wikist").trim() || "Wikist";
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

    .wikist-warp-logo {
      display: block;
      width: 104px;
      height: 104px;
      margin: 0 auto 2px;
      object-fit: contain;
      filter: drop-shadow(0 0 24px rgba(56, 232, 255, .24));
    }

    .wikist-warp-copy span {
      color: #7cffb4;
      font-size: .8rem;
      font-weight: 900;
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    .wikist-warp-copy strong {
      font-size: clamp(2.25rem, 7vw, 5.4rem);
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

    :root[data-theme="light"] .wikist-warp-copy span {
      color: #007a68;
    }

    :root[data-theme="light"] .wikist-warp-copy small {
      color: rgba(20, 49, 41, .68);
    }

    .wikist-warp-progress {
      position: relative;
      overflow: hidden;
      height: 6px;
      border: 1px solid rgba(56, 232, 255, .28);
      border-radius: 999px;
      background: rgba(255, 255, 255, .08);
      box-shadow: 0 0 30px rgba(56, 232, 255, .16);
    }

    .wikist-warp-progress i {
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
      .wikist-black-hole::before {
        animation: none !important;
        transition: none !important;
      }
    }
  `;
  document.head.appendChild(style);
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
      <img class="wikist-warp-logo" src="/assets/wikist-logo.png" alt="">
      <span data-cosmic-site-name></span>
      <strong data-cosmic-text="introTitle">${text("introTitle")}</strong>
      <div class="wikist-warp-progress" aria-hidden="true"><i></i></div>
      <small data-cosmic-text="introSkip">${text("introSkip")}</small>
    </div>`;
  document.body.appendChild(overlay);
  updateLocalizedText();

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
    node.textContent = text(key);
  });
  document.querySelectorAll("[data-cosmic-site-name]").forEach((node) => {
    node.textContent = siteName();
  });
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
  showIntro();
  hydrateBlackHole(root || document);
  hydrateParticleTitles(root || document);
}

function installEvents() {
  if (installed) return;
  installed = true;
  document.addEventListener("wikist:route-ready", () => {
    window.setTimeout(() => hydrate(document), 0);
  });
  document.addEventListener("wikist:language-change", () => updateLocalizedText());
  document.addEventListener("wikist:theme-change", () => {
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
