(() => {
  "use strict";

  const SP = (window.ScannerPro = window.ScannerPro || {});
  const U = (SP.Util = SP.Util || {});

  /* ╔══════════════════════════════════════════════════════════════════════════════╗
     ║                        USER MODIFIABLE VALUES (EDIT HERE)                   ║
     ╠══════════════════════════════════════════════════════════════════════════════╣
     ║  Rendering / Paper                                                         ║
     ║    - RENDER_SCALE: margin restoration scale used after stencil warp         ║
     ║    - A4 base sizes & SCALE: affect internal pixel-per-cm                    ║
     ║                                                                           ║
     ║  Detection / Recolor                                                       ║
     ║    - TARGET_YELLOW: the “canonical” yellow to normalize to                 ║
     ║    - BLUE_DETECTION / ORIGRED_DETECTION / YELLOW_DETECTION thresholds      ║
     ║    - WHITE_THRESHOLD & DARK_PROCESSING: how highlights/shadows are treated ║
     ║    - DESATURATION: how aggressively colors are neutralized                 ║
     ║                                                                           ║
     ║  Stencil + Calibration                                                     ║
     ║    - STENCIL_COLORS: expected printed stencil dot colors                   ║
     ║    - CALIBRATION_TARGETS: desired output RGB for dots & paper white        ║
     ║                                                                           ║
     ║  Overlay                                                                    ║
     ║    - STENCIL_CFG: on-screen overlay dimensions/colors (in px via PX_PER_CM)║
     ║    - MARKER_TARGET: alignment marker location (in px via PX_PER_CM)        ║
     ╚══════════════════════════════════════════════════════════════════════════════╝ */

  /* ╔══════════════════════════════════════════════════════════════════════════════╗
     ║  USER CONFIGURATION - Now loaded from values.config                         ║
     ║                                                                              ║
     ║  Edit values.config to adjust image processing parameters.                  ║
     ║  All values in values.config use 0-100 scale like standard photo editors.   ║
     ║                                                                              ║
     ║  The config is loaded automatically at startup and converted to technical    ║
     ║  values used by the processing algorithms.                                   ║
     ╚══════════════════════════════════════════════════════════════════════════════╝ */

  // Configuration will be loaded from values.config via configLoader.js
  // This will be populated during initialization
  let CONFIG = null;
  SP.Config = null;

  /* Derived dimensions - will be initialized after config loads */
  let PX_PER_CM, A4_W, A4_H, SX, SY, STENCIL_CFG, MARKER_TARGET, ALG;

  const toHex = v => {
    const n = Math.max(0, Math.min(255, v | 0));
    return n.toString(16).padStart(2, "0");
  };

  const rgbToHex = (r, g, b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

  // Initialize dimensions and algorithm object from loaded config
  function initializeDimensions(config) {
    CONFIG = config;
    SP.Config = config;

    PX_PER_CM = (config.BASE_A4_W / config.A4_CM_W) * config.SCALE;
    A4_W = Math.ceil(config.A4_CM_W * PX_PER_CM);
    A4_H = Math.ceil(config.A4_CM_H * PX_PER_CM);
    SX = A4_W / config.BASE_A4_W;
    SY = A4_H / config.BASE_A4_H;

    SP.Dims = {
      PX_PER_CM,
      A4_W, A4_H,
      SX, SY
    };

    /* Stencil configuration (pixel space) */
    const targetYellow = config.TARGET_YELLOW;
    const stencilYellow = targetYellow
      ? rgbToHex(targetYellow.R, targetYellow.G, targetYellow.B)
      : "#ffde00";

    STENCIL_CFG = {
      w: 18 * PX_PER_CM,
      h: 27 * PX_PER_CM,
      x: 1.5 * PX_PER_CM,
      y: 1.5 * PX_PER_CM,
      borderColor: stencilYellow,
      bgColor: "#fff",
      gapMM: 0.4
    };

    MARKER_TARGET = {
      x: 10.375 * PX_PER_CM,
      y: 27.75 * PX_PER_CM
    };

    /* Algorithm object (shared with processing modules) */
    ALG = {
      CFG: {
        A4: [A4_W, A4_H],
        A4_CM: [config.A4_CM_W, config.A4_CM_H],
        PX_CM: PX_PER_CM,
        STENCIL: { w: 18, h: 27, x: 1.5, y: 1.5 },
        MARKER: { x: 10.375, y: 27.75 },
        ROWS: 30,
        COLS: 21
      },
      keys: ["red", "blue", "green", "black", "white"],
      cal: {
        red:   { src: null, dst: config.CALIBRATION_TARGETS.red },
        blue:  { src: null, dst: config.CALIBRATION_TARGETS.blue },
        green: { src: null, dst: config.CALIBRATION_TARGETS.green },
        black: { src: null, dst: config.CALIBRATION_TARGETS.black },
        white: { src: null, dst: config.CALIBRATION_TARGETS.white }
      },
      SC: config.STENCIL_COLORS
    };
    SP.ALG = ALG;

    // Clear cached values in colorTransform.js when config changes
    if (typeof SP.clearColorTransformCache === 'function') {
      SP.clearColorTransformCache();
    }
  }

  const $ = id => document.getElementById(id);

  /* Load configuration from values.config */
  let configReady = false;
  const refreshConfig = async () => {
    const loadedConfig = await SP.loadConfig();
    initializeDimensions(loadedConfig);
    configReady = true;
  };
  (async () => {
    try {
      await refreshConfig();
      console.log('Configuration loaded successfully');
    } catch (err) {
      console.error('Failed to initialize configuration:', err);
      // Use defaults if config fails to load
      const defaultConfig = SP.convertConfigToTechnical({});
      initializeDimensions(defaultConfig);
      configReady = true;
    }
  })();

  /* App state */
  const S = {
    pages: [],
    i: -1,
    crop: 0,
    stencil: 1,
    cv: 0,
    theme: "dark",
    busy: 0
  };
  const Q = { list: [], running: false, active: null };

  /* DOM */
  const E = {
    landing: $("landingPage"),
    modal: $("modalOverlay"),
    sourceModal: $("sourceModal"),
    app: $("appContainer"),
    name: $("scanNameInput"),
    paper: $("paper"),
    img: $("previewImg"),
    crop: $("cropLayer"),
    stencil: $("stencilLayer"),
    viewport: $("viewport"),
    empty: $("emptyState"),
    list: $("pageList"),
    file: $("fileInput"),
    camera: $("cameraInput"),
    loading: $("appLoading"),
    magn: $("magnifier"),
    mag: $("magCanvas"),
    sidebar: $("sidebar"),
    sum: $("pageSummary"),
    tog: $("sidebarToggle"),
    togIcon: $("sidebarToggleIcon"),
    addD: $("btnDesktopAdd"),
    addM: $("btnAddMobile"),
    head: $("mobileSidebarHeader"),
    dd: $("stencilDropdown"),
    ddBtn: $("btnStencilToggle"),
    badge: $("stageBadge"),
    stage: $("stageText")
  };

  const ctx = E.crop.getContext("2d", { willReadFrequently: true });
  const stx = E.stencil.getContext("2d", { willReadFrequently: true });
  const mctx = E.mag.getContext("2d", { willReadFrequently: true });

  const next = U.next || (() => new Promise(requestAnimationFrame));
  const MIN_UI_MS = 200;
  const uiSleep = ms => new Promise(r => setTimeout(r, ms));
  let uiQueue = Promise.resolve();
  let lastUiStamp = 0;

  const scheduleUi = fn => {
    uiQueue = uiQueue.then(async () => {
      const now = performance.now();
      const wait = Math.max(0, lastUiStamp + MIN_UI_MS - now);
      if (wait) await uiSleep(wait);
      await fn();
      lastUiStamp = performance.now();
    });
    return uiQueue;
  };
  const isMobile = () => innerWidth <= 768;

  const DEVICE_MEM_GB = typeof navigator.deviceMemory === "number" ? navigator.deviceMemory : 0;
  const MEM = (() => {
    const touch = typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 0;
    const low = isMobile() || (touch && innerWidth <= 1024) || (DEVICE_MEM_GB && DEVICE_MEM_GB <= 4);
    const baseMax = DEVICE_MEM_GB && DEVICE_MEM_GB <= 2 ? 1600 : 2000;
    return {
      low,
      maxDim: low ? baseMax : 0
    };
  })();

  // Cache toast element
  const toastEl = $("toast");
  const toast = t => {
    toastEl.textContent = t;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1800);
  };

  const stageOnImmediate = t => {
    E.stage.textContent = t;
    E.badge.style.display = "flex";
  };

  const stageOffImmediate = () => { E.badge.style.display = "none"; };
  const stageOn = t => {
    scheduleUi(() => {
      if (S.i < 0) { stageOnImmediate(t); return; }
      const p = S.pages[S.i];
      if (!p || !p.status || p.status !== "done") stageOnImmediate(t);
    });
  };
  const stageOff = () => { scheduleUi(() => stageOffImmediate()); };

  /* Dropdown */
  E.ddBtn.addEventListener("click", e => {
    e.stopPropagation();
    E.dd.classList.toggle("show");
  });

  addEventListener("click", e => {
    if (!e.target.closest("#stencilDropdown")) E.dd.classList.remove("show");
  });

  /* Stencil download */
  function getStencilSVGString() {
    return STENCIL_BG_SVG;
  }

  window.downloadStencil = async (type) => {
    const svg = getStencilSVGString();

    if (type === "svg") {
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "scanner_stencil.svg";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      E.dd.classList.remove("show");
      return;
    }

    const img = new Image();
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = SP.Dims.A4_W;
      c.height = SP.Dims.A4_H;
      const x = c.getContext("2d");
      x.fillStyle = "#fff";
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);

      if (type === "png") {
        const a = document.createElement("a");
        a.download = "scanner_stencil.png";
        a.href = c.toDataURL("image/png");
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        const data = c.toDataURL("image/jpeg", 0.95);
        pdf.addImage(data, "JPEG", 0, 0, 210, 297);
        pdf.save("scanner_stencil.pdf");
      }
      E.dd.classList.remove("show");
    };

    img.src = url;
  };

  /* Zoom & pan */
  const Z = { s: 1, min: 1, max: 3, ox: 0, oy: 0 };
  let pDist = 0, pScale = 1, pX = 0, pY = 0, panning = 0;

  const applyZ = () => { E.paper.style.transform = `translate(${Z.ox}px,${Z.oy}px) scale(${Z.s})`; };
  const resetZ = () => { Z.s = 1; Z.ox = 0; Z.oy = 0; applyZ(); };
  const dist = (a, b) => {
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  E.viewport.addEventListener("touchstart", e => {
    if (S.crop || S.i < 0) return;

    if (e.touches.length === 2) {
      e.preventDefault();
      pDist = dist(e.touches[0], e.touches[1]);
      pScale = Z.s;
      panning = 0;
    } else if (e.touches.length === 1 && Z.s > 1) {
      e.preventDefault();
      panning = 1;
      pX = e.touches[0].clientX - Z.ox;
      pY = e.touches[0].clientY - Z.oy;
    }
  }, { passive: false });

  E.viewport.addEventListener("touchmove", e => {
    if (S.crop || S.i < 0) return;

    if (e.touches.length === 2 && pDist > 0) {
      e.preventDefault();
      let ns = pScale * (dist(e.touches[0], e.touches[1]) / pDist);
      ns = Math.max(Z.min, Math.min(Z.max, ns));
      Z.s = ns;
      applyZ();
    } else if (e.touches.length === 1 && panning && Z.s > 1) {
      e.preventDefault();
      Z.ox = e.touches[0].clientX - pX;
      Z.oy = e.touches[0].clientY - pY;
      applyZ();
    }
  }, { passive: false });

  E.viewport.addEventListener("touchend", e => {
    if (e.touches.length < 2) pDist = 0;
    if (e.touches.length === 0) panning = 0;
    if (Z.s <= 1.01) resetZ();
  });

  E.viewport.addEventListener("touchcancel", () => {
    pDist = 0; panning = 0;
    if (Z.s <= 1.01) resetZ();
  });

  /* Sortable */
  let sortable = null;
  const setupSortable = () => {
    if (sortable) sortable.destroy();

    sortable = new Sortable(E.list, {
      animation: 220,
      easing: "cubic-bezier(0.2,0,0,1)",
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      dragClass: "sortable-drag",
      handle: ".drag-handle",
      direction: "vertical",
      swapThreshold: 0.5,
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 3,
      onEnd: evt => {
        const item = S.pages.splice(evt.oldIndex, 1)[0];
        S.pages.splice(evt.newIndex, 0, item);

        if (S.i === evt.oldIndex) S.i = evt.newIndex;
        else if (S.i > evt.oldIndex && S.i <= evt.newIndex) S.i--;
        else if (S.i < evt.oldIndex && S.i >= evt.newIndex) S.i++;

        if (Q.list.length || Q.active) {
          Q.list = S.pages.filter(p => p && p.status === "queued");
        }

        renderList();
      }
    });
  };

  /* Theme */
  const setTheme = m => {
    S.theme = m;
    document.body.classList.toggle("dark-mode", m === "dark");

    $("themeBtn").innerHTML = m === "dark"
      ? '<span class="material-symbols-rounded">light_mode</span>'
      : '<span class="material-symbols-rounded">dark_mode</span>';

    localStorage.setItem("theme", m);
    cachedThemeColors = null; // Invalidate theme color cache
    if (S.crop) drawCrop();
  };
  $("themeBtn").onclick = () => setTheme(S.theme === "dark" ? "light" : "dark");

  /* Sidebar toggle */
  const toggleSidebar = () => {
    const open = E.sidebar.classList.toggle("open");
    E.tog.setAttribute("aria-expanded", open ? "true" : "false");
    E.togIcon.textContent = open ? "expand_more" : "expand_less";
  };
  E.tog.addEventListener("click", e => { e.stopPropagation(); toggleSidebar(); });
  E.head.addEventListener("click", () => { if (isMobile()) toggleSidebar(); });

  /* Modal & landing */
  $("btnLandingStart").onclick = () => {
    E.modal.classList.add("open");
    E.name.value = "";
    E.name.focus();
  };
  $("btnModalCancel").onclick = () => E.modal.classList.remove("open");
  $("btnModalCreate").onclick = enter;
  E.name.addEventListener("keypress", e => { if (e.key === "Enter") enter(); });

  function enter() {
    $("docTitle").value = E.name.value.trim() || "Untitled Scan";
    E.modal.classList.remove("open");
    E.landing.style.opacity = "0";
    E.landing.style.transform = "scale(1.1)";
    E.landing.style.pointerEvents = "none";
    E.app.classList.remove("hidden");
    setTimeout(() => E.app.classList.add("active"), 50);
  }

  /* Source modal */
  const showSourceModal = () => E.sourceModal.classList.add("open");
  const hideSourceModal = () => E.sourceModal.classList.remove("open");
  $("btnSourceCancel").onclick = hideSourceModal;
  $("btnSourceCamera").onclick = () => { hideSourceModal(); E.camera.click(); };
  $("btnSourceGallery").onclick = () => { hideSourceModal(); E.file.click(); };
  E.sourceModal.addEventListener("click", e => { if (e.target === E.sourceModal) hideSourceModal(); });

  /* Image helpers */
  const loadImg = (src, revokeOnLoad = false) => new Promise((res, rej) => {
    const img = new Image();
    img.decoding = "async";
    let url = src;
    if (src instanceof Blob) {
      url = URL.createObjectURL(src);
      revokeOnLoad = true;
    }
    img.onload = () => {
      if (revokeOnLoad) URL.revokeObjectURL(url);
      res(img);
    };
    img.onerror = e => {
      if (revokeOnLoad) URL.revokeObjectURL(url);
      rej(e);
    };
    img.src = url;
  });

  const mkCvsSized = (img, w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = "high";
    cx.drawImage(img, 0, 0, w, h);
    return c;
  };

  const mkCvs = (img, maxDim = MEM.maxDim) => {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    let tw = w;
    let th = h;
    if (maxDim && Math.max(w, h) > maxDim) {
      const s = maxDim / Math.max(w, h);
      tw = Math.max(1, Math.round(w * s));
      th = Math.max(1, Math.round(h * s));
    }
    return mkCvsSized(img, tw, th);
  };

  const toURL = (c, m = "image/jpeg", q = 0.92) =>
    new Promise(r => c.toBlob(b => r(URL.createObjectURL(b)), m, q));

  const resizeC = (c, w) => {
    const t = document.createElement("canvas");
    const r = c.height / c.width;
    t.width = w;
    t.height = Math.max(1, Math.round(w * r));
    const tx = t.getContext("2d", { willReadFrequently: true });
    tx.imageSmoothingEnabled = true;
    tx.imageSmoothingQuality = "high";
    tx.drawImage(c, 0, 0, t.width, t.height);
    return t;
  };

  const releaseCanvas = c => {
    if (!c) return;
    c.width = 0;
    c.height = 0;
  };

  const releaseStageUrl = (p, force = false) => {
    if (!p || !p.stageUrl) return;
    if (!force && E.img && E.img.src === p.stageUrl) return;
    URL.revokeObjectURL(p.stageUrl);
    p.stageUrl = null;
    p.stageLabel = "";
    p.stageW = 0;
    p.stageH = 0;
  };
  const releaseStencilUrl = p => {
    if (!p || !p.stencilUrl) return;
    URL.revokeObjectURL(p.stencilUrl);
    p.stencilUrl = null;
  };

  const cleanupPage = p => {
    if (!p) return;
    if (p.displayUrl) { URL.revokeObjectURL(p.displayUrl); p.displayUrl = null; }
    if (p.thumbUrl) { URL.revokeObjectURL(p.thumbUrl); p.thumbUrl = null; }
    if (p.previewUrl) { URL.revokeObjectURL(p.previewUrl); p.previewUrl = null; }
    releaseStencilUrl(p);
    releaseStencilCache(p.id);
    releaseStageUrl(p, true);
    if (p.src) releaseCanvas(p.src);
    if (p.processed) releaseCanvas(p.processed);
    p.decodePromise = null;
    p.file = null;
    p.src = null;
    p.processed = null;
  };

  const setPageUrls = (p, displayUrl, thumbUrl) => {
    if (p.displayUrl && p.displayUrl !== displayUrl) URL.revokeObjectURL(p.displayUrl);
    if (p.thumbUrl && p.thumbUrl !== thumbUrl) URL.revokeObjectURL(p.thumbUrl);
    p.displayUrl = displayUrl;
    p.thumbUrl = thumbUrl;
  };

  const dropCanvasesIfLowMem = (p, keep = {}) => {
    if (!MEM.low || !p) return;
    if (p.status === "processing" || p === Q.active) return;
    const selected = S.pages[S.i] === p;
    if (selected && S.stencil) return;
    if (!keep.src && p.src) { releaseCanvas(p.src); p.src = null; }
    if (!keep.processed && p.processed) { releaseCanvas(p.processed); p.processed = null; }
  };

  const trimCanvasCache = keepId => {
    if (!MEM.low) return;
    const len = S.pages.length;
    for (let i = 0; i < len; i++) {
      const p = S.pages[i];
      if (p.id === keepId) continue;
      if (p.status === "processing" || p === Q.active) continue;
      if (p.src) releaseCanvas(p.src);
      if (p.processed) releaseCanvas(p.processed);
      p.src = null;
      p.processed = null;
    }
  };

  const ensureSrcCanvas = async p => {
    if (p.src) return p.src;
    if (!p.file) return null;
    let img = null;
    if (p.decodePromise) {
      try { img = await p.decodePromise; } catch (e) { img = null; }
      p.decodePromise = null;
    }
    if (!img) {
      try { img = await loadImg(p.file); } catch (e) { img = null; }
    }
    if (!img) return null;
    const c = (p.srcW && p.srcH) ? mkCvsSized(img, p.srcW, p.srcH) : mkCvs(img);
    p.src = c;
    if (!p.srcW || !p.srcH) {
      p.srcW = c.width;
      p.srcH = c.height;
    }
    return c;
  };

  const getProcessedSize = p => {
    if (!p) return { w: 0, h: 0 };
    if (p.processed) return { w: p.processed.width, h: p.processed.height };
    return { w: p.processedW || 0, h: p.processedH || 0 };
  };

  const getSrcSize = p => {
    if (!p) return { w: 0, h: 0 };
    if (p.src) return { w: p.src.width, h: p.src.height };
    return { w: p.srcW || 0, h: p.srcH || 0 };
  };

  const findNextPendingIndex = startIdx => {
    const len = S.pages.length;
    if (!len) return -1;
    for (let off = 0; off < len; off++) {
      const idx = (startIdx + off) % len;
      const p = S.pages[idx];
      if (p && p.status && p.status !== "done" && !p.cancelled) return idx;
    }
    return -1;
  };

  const removeFromQueue = id => {
    const idx = Q.list.findIndex(p => p && p.id === id);
    if (idx !== -1) Q.list.splice(idx, 1);
  };

  const enqueuePage = page => {
    Q.list.push(page);
    if (!Q.running) runQueue();
  };

  const runQueue = async () => {
    if (Q.running) return;
    Q.running = true;
    S.busy = 1;
    stageOn("Processing...");

    while (Q.list.length) {
      const page = Q.list.shift();
      if (!page || page.cancelled) continue;
      if (page.status === "done") continue;

      Q.active = page;
      page.status = "processing";
      renderList();

      try {
        const pageIdx = S.pages.indexOf(page);
        if (S.i === -1 && pageIdx !== -1) select(pageIdx);
        const previewId = page.id;
        const previewGuard = () => {
          const sel = S.pages[S.i];
          return !!sel && sel.id === previewId;
        };
        const previewTarget = page;
        const src = await ensureSrcCanvas(page);
        if (!src || page.cancelled) {
          page.status = "error";
          renderList();
          if (page.cancelled || page.deferCleanup) cleanupPage(page);
          continue;
        }

        if (!page.quad) {
          page.quad = [
            { x: 0, y: 0 },
            { x: src.width, y: 0 },
            { x: src.width, y: src.height },
            { x: 0, y: src.height }
          ];
        }

        const out = await process(src, { previewGuard, previewTarget });
        if (page.cancelled || !S.pages.includes(page)) {
          releaseCanvas(out.canvas);
          if (page.cancelled || page.deferCleanup) cleanupPage(page);
          continue;
        }

        const processed = out.canvas;
        const thumbCanvas = resizeC(processed, 100);
        const [displayUrl, thumbUrl] = await Promise.all([
          toURL(processed, "image/jpeg", 0.92),
          toURL(thumbCanvas, "image/jpeg", 0.85)
        ]);
          releaseCanvas(thumbCanvas);

          releaseStencilUrl(page);
          releaseStencilCache(page.id);
          setPageUrls(page, displayUrl, thumbUrl);
        page.processed = processed;
        page.processedW = processed.width;
        page.processedH = processed.height;
        page.yellowUsed = out.usedYellow;
        page.marker = out.marker;
        page.status = "done";
        if (page.previewUrl) {
          URL.revokeObjectURL(page.previewUrl);
          page.previewUrl = null;
        }
        const wasSelected = S.pages[S.i] === page;
        if (!wasSelected) releaseStageUrl(page, true);

        dropCanvasesIfLowMem(page);
        trimCanvasCache(page.id);

        renderList();
        if (wasSelected && !S.crop) {
          const idx = S.pages.indexOf(page);
          const nextIdx = findNextPendingIndex((idx + 1) || 0);
          if (nextIdx !== -1) {
            select(nextIdx);
            releaseStageUrl(page, true);
          } else {
            scheduleUi(syncFinalView);
          }
        }
      } catch (e) {
        console.error(e);
        page.status = "error";
        renderList();
        toast("Error processing image");
      }
    }

    Q.running = false;
    Q.active = null;
    S.busy = 0;
    if (!Q.list.length) stageOff();
    if (S.i >= 0 && !S.crop) scheduleUi(syncFinalView);
  };

  /* Temp preview */
  let _tmpURL = null;
  async function showTemp(c, label, guard, previewTarget) {
    const u = await toURL(c, "image/jpeg", 0.9);
    const cw = c.width;
    const ch = c.height;
    let prevStage = null;

    if (previewTarget) {
      prevStage = previewTarget.stageUrl;
      previewTarget.stageUrl = u;
      previewTarget.stageLabel = label;
      previewTarget.stageW = cw;
      previewTarget.stageH = ch;
      updatePageThumb(previewTarget);
    }

    const isSelected = () => {
      if (guard) {
        if (guard()) return true;
        if (previewTarget) {
          const sel = S.pages[S.i];
          return !!sel && sel.id === previewTarget.id;
        }
        return false;
      }
      if (previewTarget) {
        const sel = S.pages[S.i];
        return !!sel && sel.id === previewTarget.id;
      }
      return true;
    };

    scheduleUi(async () => {
      if (!isSelected()) {
        if (!previewTarget || previewTarget.stageUrl !== u) {
          URL.revokeObjectURL(u);
        }
        if (prevStage && prevStage !== u) URL.revokeObjectURL(prevStage);
        return;
      }

      E.empty.style.display = "none";
      E.paper.style.display = "block";
      E.crop.style.display = "none";
      E.stencil.style.display = "none";
      E.img.style.display = "block";
      E.img.classList.remove("preview-pending");

      const prevTmp = _tmpURL;
      _tmpURL = u;

      let handled = false;
      const finish = (ok) => {
        if (handled) return;
        handled = true;
        if (!isSelected()) {
          if (!previewTarget || previewTarget.stageUrl !== u) {
            URL.revokeObjectURL(u);
          }
          if (prevStage && prevStage !== u) URL.revokeObjectURL(prevStage);
          return;
        }
        if (ok) {
          fitToSize(cw, ch);
          resetZ();
          stageOnImmediate(label);
          if (prevTmp && prevTmp !== u) URL.revokeObjectURL(prevTmp);
          if (prevStage && prevStage !== u) URL.revokeObjectURL(prevStage);
        } else {
          if (!previewTarget || previewTarget.stageUrl !== u) {
            URL.revokeObjectURL(u);
          }
          if (prevStage && prevStage !== u) URL.revokeObjectURL(prevStage);
        }
      };
      E.img.onload = () => finish(true);
      E.img.onerror = () => finish(false);

      E.img.src = u;
      if (E.img.complete && E.img.naturalWidth) finish(true);
      await next();
    });
  }

  /* Initialize app when both config and OpenCV are ready */
    async function initializeApp() {
    // Wait for config to load
    while (!configReady) {
      await new Promise(r => setTimeout(r, 50));
    }

    S.cv = 1;
    E.loading.style.opacity = "0";
    setTimeout(() => E.loading.remove(), 400);
    E.file.disabled = false;

    const sys = matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(localStorage.getItem("theme") || (sys ? "dark" : "light"));

      setupSortable();
      ensureStencilAssets().catch(() => {});

      new ResizeObserver(() => { if (S.i >= 0) fit(); }).observe(E.viewport);
    }

  /* CV ready */
  window.__cvReady = () => {
    initializeApp();
  };

  if (window.__cvReadyFlag) {
    try { window.__cvReady(); } catch(e) {}
  }

  /* File input & drag-drop */
  const trig = () => { isMobile() ? showSourceModal() : E.file.click(); };
  E.addD.onclick = trig;
  E.addM.onclick = trig;

  E.file.onchange = e => {
    if (e.target.files && e.target.files.length) handleFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  E.camera.onchange = e => {
    if (e.target.files && e.target.files.length) handleFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  addEventListener("resize", () => { if (S.cv && S.i >= 0) fit(); });

  function isImageFile(f) { return f && f.type && f.type.startsWith("image/"); }

  function getImagesFromDT(dt) {
    const files = [];
    if (dt.items) {
      const itemsLen = dt.items.length;
      for (let i = 0; i < itemsLen; i++) {
        const item = dt.items[i];
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f && isImageFile(f)) files.push(f);
        }
      }
    } else if (dt.files) {
      const filesLen = dt.files.length;
      for (let i = 0; i < filesLen; i++) {
        const file = dt.files[i];
        if (isImageFile(file)) files.push(file);
      }
    }
    return files;
  }

  ["dragenter", "dragover", "dragleave", "drop"].forEach(ev => {
    document.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false);
  });

  E.viewport.addEventListener("dragenter", () => { if (!S.cv) return; E.viewport.classList.add("drag-over"); });
  E.viewport.addEventListener("dragover",  () => { if (!S.cv) return; E.viewport.classList.add("drag-over"); });
  E.viewport.addEventListener("dragleave", e => { if (!E.viewport.contains(e.relatedTarget)) E.viewport.classList.remove("drag-over"); });

  E.viewport.addEventListener("drop", e => {
    E.viewport.classList.remove("drag-over");
    if (!S.cv) return;

    const files = getImagesFromDT(e.dataTransfer);
    if (files.length > 0) {
      if (!E.app.classList.contains("active")) {
        $("docTitle").value = "Untitled Scan";
        E.landing.style.opacity = "0";
        E.landing.style.transform = "scale(1.1)";
        E.landing.style.pointerEvents = "none";
        E.app.classList.remove("hidden");
        setTimeout(() => { E.app.classList.add("active"); handleFiles(files); }, 50);
      } else handleFiles(files);
    }
  });

  E.landing.addEventListener("dragenter", () => { if (!S.cv) return; E.landing.classList.add("drag-over"); });
  E.landing.addEventListener("dragover",  () => { if (!S.cv) return; E.landing.classList.add("drag-over"); });
  E.landing.addEventListener("dragleave", e => { if (!E.landing.contains(e.relatedTarget)) E.landing.classList.remove("drag-over"); });

  E.landing.addEventListener("drop", e => {
    E.landing.classList.remove("drag-over");
    if (!S.cv) return;

    const files = getImagesFromDT(e.dataTransfer);
    if (files.length > 0) {
      $("docTitle").value = "Untitled Scan";
      E.landing.style.opacity = "0";
      E.landing.style.transform = "scale(1.1)";
      E.landing.style.pointerEvents = "none";
      E.app.classList.remove("hidden");
      setTimeout(() => { E.app.classList.add("active"); handleFiles(files); }, 50);
    }
  });

  /* Processing pipeline (delegates to /processing/*.js) */
  async function process(srcCanvas, opts = {}) {
    const previewGuard = opts.previewGuard || null;
    const previewTarget = opts.previewTarget || null;
    await refreshConfig();
    ALG.keys.forEach(k => ALG.cal[k].src = null);

    await showTemp(srcCanvas, "Original", previewGuard, previewTarget);

    const yR = SP.detectYellow(srcCanvas);
    await showTemp(yR.viz, "Yellow mask", previewGuard, previewTarget);
    releaseCanvas(yR.viz);

    let usedYellow = !!(yR.contourPoints && yR.contourPoints.length > 100);
    if (opts.forceNoYellow) usedYellow = false;

    let corners = yR.corners;
    let edges = yR.edges;

    let pageQuad;
    if (usedYellow) {
      pageQuad = corners ? SP.extrapolatePage(corners) : SP.detectPageEdges(srcCanvas);
    } else {
      pageQuad = opts.overridePageQuad || SP.detectPageEdges(srcCanvas);
    }

    const detViz = SP.detectionViz(srcCanvas, corners, pageQuad, yR.contourPoints);
    await showTemp(detViz, "Detection", previewGuard, previewTarget);
    releaseCanvas(detViz);

    let wrp = null;
    if (usedYellow && corners && edges) {
      const grid = SP.optimizeGrid(edges, ALG.CFG.ROWS, ALG.CFG.COLS);
      const meshViz = SP.meshViz(srcCanvas, grid, corners, edges);
      await showTemp(meshViz, "Mesh", previewGuard, previewTarget);
      releaseCanvas(meshViz);
      wrp = SP.warpGrid(srcCanvas, grid);
    } else {
      const meshViz = SP.detectionViz(srcCanvas, corners, pageQuad, yR.contourPoints);
      await showTemp(meshViz, "Mesh", previewGuard, previewTarget);
      releaseCanvas(meshViz);
      wrp = SP.warpSimple(srcCanvas, pageQuad);
    }

    await showTemp(wrp, "Warp", previewGuard, previewTarget);

    const col = SP.scanColors(wrp);
    let dotCenters = cloneDotCenters(col.dotCenters);
    let dotLineEdges = cloneDotLineEdges(col.dotLineEdges);
    await showTemp(col.viz, "Color window", previewGuard, previewTarget);
    releaseCanvas(col.viz);

    let aligned = wrp;
    let marker = null;

    if (!usedYellow && col.found && col.blackPt) {
      const blob = SP.findBlackBlob(wrp, col.blackPt);
      aligned = SP.alignMarker(wrp, blob);
      if (dotCenters) {
        const dx = MARKER_TARGET.x - blob.x;
        const dy = MARKER_TARGET.y - blob.y;
        shiftDotCenters(dotCenters, dx, dy);
      }
      if (dotLineEdges) {
        const dx = MARKER_TARGET.x - blob.x;
        const dy = MARKER_TARGET.y - blob.y;
        shiftDotLineEdges(dotLineEdges, dx, dy);
      }
      marker = { x: MARKER_TARGET.x, y: MARKER_TARGET.y };
    } else if (usedYellow) {
      marker = { x: MARKER_TARGET.x, y: MARKER_TARGET.y };
    }

    const T = SP.buildTransform();
    const showRecolorStep = async (label, canvas) => showTemp(canvas, label, previewGuard, previewTarget);

    let fin;
    if (T) fin = await SP.applyColorStepsAsync(aligned, T, showRecolorStep);
    else fin = await SP.applyBalanceStepsAsync(aligned, showRecolorStep);

    if (usedYellow) {
      fin = SP.restoreMargins(fin);
      await showTemp(fin, "Recoloring: Restore margins", previewGuard, previewTarget);
      if (dotCenters) mapDotsThroughRestore(dotCenters);
      if (dotLineEdges) mapLineEdgesThroughRestore(dotLineEdges);
    }

    let remeshControls = null;
    if (dotCenters && typeof SP.remeshStencil === "function") {
      remeshControls = buildRemeshControls(dotCenters);
      if (remeshControls) {
        const remeshed = SP.remeshStencil(fin, remeshControls);
        if (remeshed && remeshed !== fin) {
          await showTemp(remeshed, "Remesh", previewGuard, previewTarget);
          releaseCanvas(fin);
          fin = remeshed;
          remeshDotData(dotCenters, dotLineEdges, remeshControls);
        }
      }
    }

    if (fin && typeof SP.removeEdgeYellowZones === "function") {
      SP.removeEdgeYellowZones(fin);
    }
    if (fin && typeof SP.removeDotGrid === "function") {
      SP.removeDotGrid(fin);
    }

    await showTemp(fin, "Final", previewGuard, previewTarget);

    return { canvas: fin, pageQuad, marker, usedYellow };
  }

  /* Page list rendering */
  const getThumbSrc = p => (p ? (p.thumbUrl || p.stageUrl || p.previewUrl) : null);

  function updatePageThumb(p) {
    if (!p) return;
    const card = E.list.querySelector(`.page-card[data-id="${p.id}"]`);
    if (!card) return;
    const wrap = card.querySelector(".thumb-wrap");
    if (!wrap) return;

    const src = getThumbSrc(p);
    let img = wrap.querySelector("img.thumb");
    const placeholder = wrap.querySelector(".thumb-placeholder");

    if (src) {
      if (!img) {
        img = document.createElement("img");
        img.className = "thumb";
        img.alt = "";
        wrap.insertBefore(img, wrap.firstChild);
      }
      img.src = src;
      if (placeholder) placeholder.remove();
    } else {
      if (img) img.remove();
      if (!placeholder) {
        const ph = document.createElement("div");
        ph.className = "thumb-placeholder";
        ph.innerHTML = '<span class="material-symbols-rounded">description</span>';
        wrap.insertBefore(ph, wrap.firstChild);
      }
    }
  }

  function renderList() {
    E.list.innerHTML = "";
    const n = S.pages.length;
    E.sum.textContent = n ? (n === 1 ? "1 page" : n + " pages") : "No pages";

    if (!n) {
      E.list.innerHTML = '<div style="width:100%;text-align:center;padding:20px;color:var(--text-sub);font-size:13px">No pages</div>';
      return;
    }

    const pages = S.pages;
    const currentIdx = S.i;
    for (let i = 0; i < n; i++) {
      const p = pages[i];
      const pending = p.status && p.status !== "done";
      const card = document.createElement("div");
      card.className = "page-card" +
        (i === currentIdx ? " active" : "") +
        (pending ? " pending" : "");
      card.dataset.id = p.id;

      const thumbSrc = getThumbSrc(p);
      const thumbHtml = thumbSrc
        ? `<img src="${thumbSrc}" class="thumb" alt="">`
        : '<div class="thumb-placeholder"><span class="material-symbols-rounded">description</span></div>';
      const spinnerHtml = p.status === "processing"
        ? '<div class="page-spinner spinner" aria-hidden="true"></div>'
        : '';
      const thumbWrap = `<div class="thumb-wrap">${thumbHtml}${spinnerHtml}</div>`;

      card.innerHTML = `
        <span class="material-symbols-rounded drag-handle">drag_indicator</span>
        ${thumbWrap}
        <div class="info">
          <div class="filename">${p.name}</div>
          <div class="page-meta">Page ${i + 1}</div>
        </div>
        <button class="btn-del" type="button" aria-label="Delete page ${i + 1}">
          <span class="material-symbols-rounded" style="font-size:18px">delete</span>
        </button>`;

      card.addEventListener("click", e => { if (!e.target.closest(".btn-del")) select(i); });

      const delBtn = card.querySelector(".btn-del");
      delBtn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();

        const removed = S.pages.splice(i, 1)[0];
        if (removed) {
          removed.cancelled = true;
          removeFromQueue(removed.id);
          if (Q.active === removed || removed.status === "processing") {
            removed.deferCleanup = true;
          } else {
            cleanupPage(removed);
          }
        }

        if (!S.pages.length) {
          S.i = -1;
          E.paper.style.display = "none";
          E.empty.style.display = "flex";
          $("exportBtn").disabled = true;
          $("cropBtn").disabled = true;
          $("autoCropBtn").style.display = "none";
          $("stencilBtn").disabled = true;
          $("stencilBtn").classList.remove("active");
          S.stencil = 0;
          resetZ();
        } else {
          S.i = Math.max(0, Math.min(S.i, S.pages.length - 1));
          select(S.i);
        }

        renderList();
      });

      E.list.appendChild(card);
    }
  }

  /* Stencil compositing */
  const STENCIL_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 29.7" width="21cm" height="29.7cm">
      <defs>
        <filter id="softBlur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.02"/>
        </filter>
        <pattern id="dotGrid" x="1.75" y="1.68" width="0.5" height="0.5" patternUnits="userSpaceOnUse">
          <circle cx="0.25" cy="0.25" r="0.035" fill="#a8a8a8" filter="url(#softBlur)"/>
        </pattern>
      </defs>
      <rect x="0" y="0" width="21" height="29.7" fill="white"/>
      <rect x="1.5" y="1.43" width="18" height="27" rx="0.03" ry="0.03"
            fill="none" stroke="#f0db4c" stroke-width="0.06"/>
      <rect x="1.75" y="1.68" width="17.5" height="25.5" fill="url(#dotGrid)"/>
      <g stroke="#f0db4c" stroke-width="0.06" fill="none">
        <rect x="2.0" y="27.43" width="8.0" height="0.5" rx="0.03" ry="0.03"/>
        <path d="M 2.5 27.43 v 0.5 M 3.0 27.43 v 0.5 M 3.5 27.43 v 0.5
                 M 4.0 27.43 v 0.5 M 4.5 27.43 v 0.5 M 5.0 27.43 v 0.5
                 M 5.5 27.43 v 0.5 M 6.0 27.43 v 0.5 M 6.5 27.43 v 0.5
                 M 7.0 27.43 v 0.5 M 7.5 27.43 v 0.5 M 8.0 27.43 v 0.5
                 M 8.5 27.43 v 0.5 M 9.0 27.43 v 0.5 M 9.5 27.43 v 0.5"/>
        <rect x="11.0" y="27.43" width="8.0" height="0.5" rx="0.03" ry="0.03"/>
        <path d="M 11.5 27.43 v 0.5 M 12.0 27.43 v 0.5 M 12.5 27.43 v 0.5
                 M 13.0 27.43 v 0.5 M 13.5 27.43 v 0.5 M 14.0 27.43 v 0.5
                 M 14.5 27.43 v 0.5 M 15.0 27.43 v 0.5 M 15.5 27.43 v 0.5
                 M 16.0 27.43 v 0.5 M 16.5 27.43 v 0.5 M 17.0 27.43 v 0.5
                 M 17.5 27.43 v 0.5 M 18.0 27.43 v 0.5 M 18.5 27.43 v 0.5"/>
      </g>
      <g stroke="#f0db4c" stroke-width="0.06">
        <circle cx="10.125" cy="27.68" r="0.125" fill="#ff0000"/>
        <circle cx="10.375" cy="27.68" r="0.125" fill="#000000"/>
        <circle cx="10.625" cy="27.68" r="0.125" fill="#0000ff"/>
        <circle cx="10.875" cy="27.68" r="0.125" fill="#6eff12"/>
      </g>
    </svg>`;

  const STENCIL_OVERLAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 29.7" width="21cm" height="29.7cm">
  <rect x="1.5" y="1.43" width="18" height="27" rx="0.03" ry="0.03"
        fill="none" stroke="#f0db4c" stroke-width="0.06"/>
  <g stroke="#f0db4c" stroke-width="0.06" fill="none">
    <rect x="2.0" y="27.43" width="8.0" height="0.5" rx="0.03" ry="0.03"/>
    <path d="M 2.5 27.43 v 0.5 M 3.0 27.43 v 0.5 M 3.5 27.43 v 0.5
             M 4.0 27.43 v 0.5 M 4.5 27.43 v 0.5 M 5.0 27.43 v 0.5
             M 5.5 27.43 v 0.5 M 6.0 27.43 v 0.5 M 6.5 27.43 v 0.5
             M 7.0 27.43 v 0.5 M 7.5 27.43 v 0.5 M 8.0 27.43 v 0.5
             M 8.5 27.43 v 0.5 M 9.0 27.43 v 0.5 M 9.5 27.43 v 0.5"/>
    <rect x="11.0" y="27.43" width="8.0" height="0.5" rx="0.03" ry="0.03"/>
    <path d="M 11.5 27.43 v 0.5 M 12.0 27.43 v 0.5 M 12.5 27.43 v 0.5
             M 13.0 27.43 v 0.5 M 13.5 27.43 v 0.5 M 14.0 27.43 v 0.5
             M 14.5 27.43 v 0.5 M 15.0 27.43 v 0.5 M 15.5 27.43 v 0.5
             M 16.0 27.43 v 0.5 M 16.5 27.43 v 0.5 M 17.0 27.43 v 0.5
             M 17.5 27.43 v 0.5 M 18.0 27.43 v 0.5 M 18.5 27.43 v 0.5"/>
  </g>
  <g stroke="#f0db4c" stroke-width="0.06">
    <circle cx="10.125" cy="27.68" r="0.125" fill="#ff0000"/>
    <circle cx="10.375" cy="27.68" r="0.125" fill="#000000"/>
    <circle cx="10.625" cy="27.68" r="0.125" fill="#0000ff"/>
    <circle cx="10.875" cy="27.68" r="0.125" fill="#6eff12"/>
  </g>
</svg>`;

  let stencilBgImg = null;
  let stencilOverlayImg = null;
  const svgToImg = svg => new Promise((res, rej) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      res(img);
    };
    img.onerror = e => {
      URL.revokeObjectURL(url);
      rej(e);
    };
    img.src = url;
  });

  const ensureStencilAssets = async () => {
    if (!stencilBgImg) stencilBgImg = await svgToImg(STENCIL_BG_SVG);
    if (!stencilOverlayImg) stencilOverlayImg = await svgToImg(STENCIL_OVERLAY_SVG);
    return { bg: stencilBgImg, overlay: stencilOverlayImg };
  };

  const WHITE_ALPHA_THRESH = 250;
  const makeWhiteTransparentCanvas = src => {
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(src, 0, 0);
    const id = cx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] >= WHITE_ALPHA_THRESH && d[i + 1] >= WHITE_ALPHA_THRESH && d[i + 2] >= WHITE_ALPHA_THRESH) {
        d[i + 3] = 0;
      }
    }
    cx.putImageData(id, 0, 0);
    return c;
  };

  const applyStencilToContext = async (ctx, w, h, srcCanvas) => {
    const { bg, overlay } = await ensureStencilAssets();
    const transparent = makeWhiteTransparentCanvas(srcCanvas);
    const PX_CM = (SP.Dims && SP.Dims.PX_PER_CM) || (SP.ALG && SP.ALG.CFG && SP.ALG.CFG.PX_CM) || 0;
    const yShift = PX_CM ? -0.1 * PX_CM : 0;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bg, 0, 0, w, h);
    ctx.drawImage(transparent, 0, yShift, w, h);
    ctx.drawImage(overlay, 0, 0, w, h);
    releaseCanvas(transparent);
  };

  let stencilSeq = 0;
  let stencilCache = { id: null, canvas: null };
  const releaseStencilCache = (id = null) => {
    if (!stencilCache.canvas) return;
    if (id === null || stencilCache.id === id) {
      releaseCanvas(stencilCache.canvas);
      stencilCache = { id: null, canvas: null };
    }
  };
  const applyStencilPreview = async p => {
    if (!p) return;
    const seq = ++stencilSeq;
    let srcCanvas = p.processed;
    let tmpCanvas = null;
    if (!srcCanvas && p.displayUrl) {
      const img = await loadImg(p.displayUrl);
      const w = p.processedW || img.naturalWidth || img.width;
      const h = p.processedH || img.naturalHeight || img.height;
      if (!w || !h) return;
      tmpCanvas = mkCvsSized(img, w, h);
      srcCanvas = tmpCanvas;
    }
    if (!srcCanvas) return;
    if (seq !== stencilSeq) return;
    if (!S.stencil || S.pages[S.i] !== p) { if (tmpCanvas) releaseCanvas(tmpCanvas); return; }
    if (MEM.low) {
      E.stencil.width = srcCanvas.width;
      E.stencil.height = srcCanvas.height;
      const sctx = E.stencil.getContext("2d", { willReadFrequently: true });
      await applyStencilToContext(sctx, E.stencil.width, E.stencil.height, srcCanvas);
    } else {
      let composite = stencilCache.canvas;
      if (!composite || stencilCache.id !== p.id ||
          composite.width !== srcCanvas.width || composite.height !== srcCanvas.height) {
        if (composite) releaseCanvas(composite);
        composite = document.createElement("canvas");
        composite.width = srcCanvas.width;
        composite.height = srcCanvas.height;
        const cctx = composite.getContext("2d", { willReadFrequently: true });
        await applyStencilToContext(cctx, composite.width, composite.height, srcCanvas);
        stencilCache = { id: p.id, canvas: composite };
      }
      E.stencil.width = composite.width;
      E.stencil.height = composite.height;
      const sctx = E.stencil.getContext("2d", { willReadFrequently: true });
      sctx.clearRect(0, 0, E.stencil.width, E.stencil.height);
      sctx.drawImage(composite, 0, 0);
    }
    if (tmpCanvas) releaseCanvas(tmpCanvas);
    if (seq !== stencilSeq || !S.stencil || S.pages[S.i] !== p) return;
    E.img.style.display = "none";
    E.stencil.style.display = "block";
  };

  const cloneDotCenters = centers => {
    if (!centers) return null;
    const out = {};
    const keys = Object.keys(centers);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const p = centers[k];
      out[k] = { x: p.x, y: p.y };
    }
    return out;
  };

  const cloneDotLineEdges = edges => {
    if (!edges) return null;
    const out = {};
    const keys = Object.keys(edges);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const e = edges[k];
      out[k] = {
        x: e.x,
        y: e.y,
        topY: e.topY,
        bottomY: e.bottomY
      };
    }
    return out;
  };

  const shiftDotCenters = (centers, dx, dy) => {
    if (!centers) return centers;
    const keys = Object.keys(centers);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const p = centers[k];
      p.x += dx;
      p.y += dy;
    }
    return centers;
  };

  const shiftDotLineEdges = (edges, dx, dy) => {
    if (!edges) return edges;
    const keys = Object.keys(edges);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const e = edges[k];
      e.x += dx;
      e.y += dy;
      if (e.topY !== null) e.topY += dy;
      if (e.bottomY !== null) e.bottomY += dy;
    }
    return edges;
  };

  const getRestoreTransform = () => {
    if (!SP.Config || !ALG || !SP.Dims) return null;
    const PX_CM = SP.Dims.PX_PER_CM;
    const sx = (ALG.CFG.STENCIL.x * PX_CM) | 0;
    const sy = (ALG.CFG.STENCIL.y * PX_CM) | 0;
    const sw = (ALG.CFG.STENCIL.w * PX_CM) | 0;
    const sh = (ALG.CFG.STENCIL.h * PX_CM) | 0;
    const sc = SP.Config.RENDER_SCALE;
    const cW = (sw * sc + 0.5) | 0;
    const cH = (sh * sc + 0.5) | 0;
    const dX = (sx - (cW - sw) * 0.5) | 0;
    const dY = (sy - (cH - sh) * 0.5) | 0;
    return {
      sx,
      sy,
      sw,
      sh,
      dX,
      dY,
      sX: cW / sw,
      sY: cH / sh
    };
  };

  const mapPointThroughRestore = (pt, t) => {
    if (!pt || !t) return pt;
    let x = pt.x;
    let y = pt.y;
    if (x >= t.sx && x <= t.sx + t.sw && y >= t.sy && y <= t.sy + t.sh) {
      x = t.dX + (x - t.sx) * t.sX;
      y = t.dY + (y - t.sy) * t.sY;
    }
    return { x, y };
  };

  const mapDotsThroughRestore = centers => {
    if (!centers) return centers;
    const t = getRestoreTransform();
    if (!t) return centers;
    const keys = Object.keys(centers);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const mapped = mapPointThroughRestore(centers[k], t);
      centers[k].x = mapped.x;
      centers[k].y = mapped.y;
    }
    return centers;
  };

  const mapLineEdgesThroughRestore = edges => {
    if (!edges) return edges;
    const t = getRestoreTransform();
    if (!t) return edges;
    const keys = Object.keys(edges);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const e = edges[k];
      const ox = e.x;
      const oy = e.y;
      const mappedCenter = mapPointThroughRestore({ x: ox, y: oy }, t);
      e.x = mappedCenter.x;
      e.y = mappedCenter.y;
      if (e.topY !== null) {
        const mappedTop = mapPointThroughRestore({ x: ox, y: e.topY }, t);
        e.topY = mappedTop.y;
      }
      if (e.bottomY !== null) {
        const mappedBottom = mapPointThroughRestore({ x: ox, y: e.bottomY }, t);
        e.bottomY = mappedBottom.y;
      }
    }
    return edges;
  };

  const A4_BLUE_DOTS = [
    { x: 10.125, y: 27.75 },
    { x: 10.375, y: 27.75 },
    { x: 10.625, y: 27.75 },
    { x: 10.875, y: 27.75 }
  ];
  const DOT_ORDER = ["red", "black", "blue", "green"];

  const buildRemeshControls = centers => {
    if (!centers || !ALG || !ALG.CFG) return null;
    const PX_CM = ALG.CFG.PX_CM;
    if (!PX_CM) return null;
    const controls = [];
    for (let i = 0; i < DOT_ORDER.length; i++) {
      const key = DOT_ORDER[i];
      const src = centers[key];
      const tgtCm = A4_BLUE_DOTS[i];
      if (!src || !tgtCm) return null;
      controls.push({
        target: { x: tgtCm.x * PX_CM, y: tgtCm.y * PX_CM },
        source: { x: src.x, y: src.y }
      });
    }
    return controls;
  };

  const remeshDotData = (centers, edges, controls) => {
    if (!centers || !controls || typeof SP.remeshPoints !== "function") return;
    const keys = Object.keys(centers);
    if (!keys.length) return;
    const srcPts = keys.map(k => ({ x: centers[k].x, y: centers[k].y }));
    const mapped = SP.remeshPoints(srcPts, controls);
    for (let i = 0; i < keys.length; i++) {
      if (!mapped[i]) continue;
      centers[keys[i]].x = mapped[i].x;
      centers[keys[i]].y = mapped[i].y;
    }

    if (!edges) return;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const e = edges[k];
      if (!e || !centers[k]) continue;
      const pts = [];
      const idxTop = e.topY !== null ? pts.push({ x: e.x, y: e.topY }) - 1 : -1;
      const idxBottom = e.bottomY !== null ? pts.push({ x: e.x, y: e.bottomY }) - 1 : -1;
      if (pts.length) {
        const mappedPts = SP.remeshPoints(pts, controls);
        if (idxTop >= 0 && mappedPts[idxTop]) e.topY = mappedPts[idxTop].y;
        if (idxBottom >= 0 && mappedPts[idxBottom]) e.bottomY = mappedPts[idxBottom].y;
      }
      e.x = centers[k].x;
      e.y = centers[k].y;
    }
  };

  const drawDotOverlay = (cvs, centers, edges, includeA4Blue = false, includeGrid = false) => {
    if (!cvs) return null;
    const dotKeys = centers ? Object.keys(centers) : [];
    const edgeKeys = edges ? Object.keys(edges) : [];
    const a4cm = ALG && ALG.CFG && ALG.CFG.A4_CM ? ALG.CFG.A4_CM : null;
    const canDrawBlue = includeA4Blue && a4cm;
    const canDrawGrid = includeGrid && a4cm;
    if (!dotKeys.length && !edgeKeys.length && !canDrawBlue && !canDrawGrid) return null;
    const out = document.createElement("canvas");
    out.width = cvs.width;
    out.height = cvs.height;
    const outCtx = out.getContext("2d", { willReadFrequently: true });
    outCtx.drawImage(cvs, 0, 0);

    const TWO_PI = Math.PI * 2;
    const baseRadius = Math.max(3, Math.round(out.width / 400));
    if (canDrawBlue) {
      const scaleX = out.width / a4cm[0];
      const scaleY = out.height / a4cm[1];
      outCtx.fillStyle = "#2563eb";
      for (let i = 0; i < A4_BLUE_DOTS.length; i++) {
        const p = A4_BLUE_DOTS[i];
        outCtx.beginPath();
        outCtx.arc(p.x * scaleX, p.y * scaleY, baseRadius, 0, TWO_PI);
        outCtx.fill();
      }
    }

    if (edges && edgeKeys.length) {
      outCtx.strokeStyle = "#9ca3af";
      outCtx.lineWidth = 7;
      for (let i = 0; i < edgeKeys.length; i++) {
        const e = edges[edgeKeys[i]];
        if (e.topY !== null) {
          outCtx.beginPath();
          outCtx.moveTo(e.x, e.y);
          outCtx.lineTo(e.x, e.topY);
          outCtx.stroke();
        }
        if (e.bottomY !== null) {
          outCtx.beginPath();
          outCtx.moveTo(e.x, e.y);
          outCtx.lineTo(e.x, e.bottomY);
          outCtx.stroke();
        }
      }
    }

    outCtx.fillStyle = "#ff4fb8";
    for (let i = 0; i < dotKeys.length; i++) {
      const p = centers[dotKeys[i]];
      outCtx.beginPath();
      outCtx.arc(p.x, p.y, baseRadius, 0, TWO_PI);
      outCtx.fill();
    }

    if (canDrawGrid) {
      const stepX = (out.width / a4cm[0]) * 0.5;
      const stepY = (out.height / a4cm[1]) * 0.5;
      outCtx.save();
      outCtx.strokeStyle = "rgba(0,0,0,0.25)";
      outCtx.lineWidth = 1;

      for (let x = 0; x <= out.width + 0.1; x += stepX) {
        const px = Math.round(x) + 0.5;
        outCtx.beginPath();
        outCtx.moveTo(px, 0);
        outCtx.lineTo(px, out.height);
        outCtx.stroke();
      }

      for (let y = 0; y <= out.height + 0.1; y += stepY) {
        const py = Math.round(y) + 0.5;
        outCtx.beginPath();
        outCtx.moveTo(0, py);
        outCtx.lineTo(out.width, py);
        outCtx.stroke();
      }
      outCtx.restore();
    }
    return out;
  };

  const drawWarpGridOverlay = (cvs, controls) => {
    if (!cvs || !controls || typeof SP.remeshStencilOverlay !== "function" || !ALG || !ALG.CFG) return null;
    const PX_CM = ALG.CFG.PX_CM;
    if (!PX_CM) return null;

    const grid = document.createElement("canvas");
    grid.width = cvs.width;
    grid.height = cvs.height;
    const gctx = grid.getContext("2d", { willReadFrequently: true });
    gctx.clearRect(0, 0, grid.width, grid.height);

    const sx = ALG.CFG.STENCIL.x * PX_CM;
    const sy = ALG.CFG.STENCIL.y * PX_CM;
    const sw = (ALG.CFG.STENCIL.w * PX_CM + 0.5) | 0;
    const sh = (ALG.CFG.STENCIL.h * PX_CM + 0.5) | 0;

    const step = PX_CM; // 1cm grid
    gctx.strokeStyle = "rgba(0,120,255,0.55)";
    gctx.lineWidth = Math.max(1, Math.round(cvs.width / 900));

    for (let x = sx; x <= sx + sw + 0.1; x += step) {
      const px = Math.round(x) + 0.5;
      gctx.beginPath();
      gctx.moveTo(px, sy);
      gctx.lineTo(px, sy + sh);
      gctx.stroke();
    }

    for (let y = sy; y <= sy + sh + 0.1; y += step) {
      const py = Math.round(y) + 0.5;
      gctx.beginPath();
      gctx.moveTo(sx, py);
      gctx.lineTo(sx + sw, py);
      gctx.stroke();
    }

    const warped = SP.remeshStencilOverlay(grid, controls);
    if (!warped) return null;

    const out = document.createElement("canvas");
    out.width = cvs.width;
    out.height = cvs.height;
    const octx = out.getContext("2d", { willReadFrequently: true });
    octx.drawImage(cvs, 0, 0);
    octx.drawImage(warped, 0, 0);
    return out;
  };

  function fitToSize(sw, sh) {
    if (!sw || !sh) return;
    const asp = sw / sh;
    const pad = 40;
    const aw = E.viewport.clientWidth - pad;
    const ah = E.viewport.clientHeight - pad;

    let w = aw;
    let h = aw / asp;
    if (h > ah) { h = ah; w = ah * asp; }

    E.paper.style.width = w + "px";
    E.paper.style.height = h + "px";
  }

  function fit() {
    if (S.i < 0) return;

    const p = S.pages[S.i];
    const size = S.crop ? getSrcSize(p) : getProcessedSize(p);
    const sw = size.w;
    const sh = size.h;
    if (!sw || !sh) return;
    fitToSize(sw, sh);

      if (S.crop) {
        if (!p.src) {
          ensureSrcCanvas(p).then(() => {
            if (S.crop && S.pages[S.i] === p) fit();
          });
          return;
        }
        drawCrop();
      }

      resetZ();
    }

  function syncFinalView() {
    if (S.i < 0 || S.crop) return;
    const p = S.pages[S.i];
    if (!p) return;
    E.paper.style.display = "block";
    E.empty.style.display = "none";
    E.img.classList.remove("preview-pending");
    E.img.onload = null;
      if (p.displayUrl) {
        E.img.src = p.displayUrl;
        E.img.style.display = "block";
      } else {
        E.img.style.display = "none";
      }
      E.crop.style.display = "none";
      const ready = !p.status || p.status === "done";
      $("cropBtn").disabled = !ready;
      $("stencilBtn").disabled = !ready;
      $("stencilBtn").classList.toggle("active", !!S.stencil);
      E.stencil.style.display = "none";
      if (S.stencil && ready) {
        applyStencilPreview(p);
      }
      fit();
      stageOffImmediate();
      releaseStageUrl(p, true);
    if (MEM.low && !S.crop) dropCanvasesIfLowMem(p);
  }

  /* Selection */
  function select(i) {
    if (i < 0 || i >= S.pages.length) return;
    if (S.crop) toggleCrop();

    const prev = S.pages[S.i];
    S.i = i;
    renderList();

    const p = S.pages[i];
    E.paper.style.display = "block";
    E.empty.style.display = "none";
    E.img.onload = null;

    E.crop.style.display = "none";
    const ready = !p.status || p.status === "done";
    $("cropBtn").disabled = !ready;
    $("stencilBtn").disabled = !ready;
    $("stencilBtn").classList.toggle("active", !!S.stencil);

    if (!ready) {
      const stageSrc = p.stageUrl || p.previewUrl;
      const useOriginal = !!(p.previewUrl && !p.stageUrl);
      const sw = p.stageUrl ? p.stageW : (p.previewW || 0);
      const sh = p.stageUrl ? p.stageH : (p.previewH || 0);
      const loadingStage = stageSrc && stageSrc === p.stageUrl;
      if (stageSrc && (!sw || !sh)) {
        E.img.onload = () => {
          const w = E.img.naturalWidth || E.img.width;
          const h = E.img.naturalHeight || E.img.height;
          if (loadingStage) { p.stageW = w; p.stageH = h; }
          else { p.previewW = w; p.previewH = h; }
          fitToSize(w, h);
        };
      }
      if (stageSrc) {
        E.img.src = stageSrc;
        E.img.style.display = "block";
      } else {
        E.img.style.display = "none";
      }
      E.img.classList.toggle("preview-pending", useOriginal);
      E.stencil.style.display = "none";
      stageOnImmediate(p.stageLabel || (p.status === "processing" ? "Processing..." : "Queued..."));

      if (sw && sh) {
        fitToSize(sw, sh);
      }
      resetZ();
      trimCanvasCache(p.id);
      if (MEM.low && !S.crop) dropCanvasesIfLowMem(p);
      if (prev && prev.status === "done") releaseStageUrl(prev, true);
      return;
    }

      E.img.classList.remove("preview-pending");
      if (p.displayUrl) {
        E.img.src = p.displayUrl;
        E.img.style.display = "block";
      } else {
        E.img.style.display = "none";
      }

      E.stencil.style.display = "none";
      if (S.stencil) {
        applyStencilPreview(p);
      }
      fit();
      stageOffImmediate();
    trimCanvasCache(p.id);
    if (MEM.low && !S.crop) dropCanvasesIfLowMem(p);
    if (prev && prev.status === "done") releaseStageUrl(prev, true);
  }

  /* Crop mode */
  async function toggleCrop() {
    if (S.i < 0) return;

    const btn = $("cropBtn");
    const auto = $("autoCropBtn");
    const stb = $("stencilBtn");
    const p = S.pages[S.i];
    if (!S.crop) {
      if (p.status && p.status !== "done") {
        toast("Processing...");
        return;
      }
      const src = await ensureSrcCanvas(p);
      if (!src) return;
      S.crop = 1;

      btn.innerHTML = `<span class="material-symbols-rounded">check</span><span class="label-text">Done</span>`;
      btn.classList.add("active");

      auto.style.display = "flex";
      stb.style.display = "none";

      E.img.style.display = "none";
      E.stencil.style.display = "none";
      E.crop.style.display = "block";

      E.crop.width = src.width;
      E.crop.height = src.height;

      drawCrop();
    } else {
      S.crop = 0;

      btn.innerHTML = `<span class="material-symbols-rounded">crop</span><span class="label-text">Crop</span>`;
      btn.classList.remove("active");

      auto.style.display = "none";
      stb.style.display = "flex";
      E.stencil.style.display = "block";

      p.status = "processing";
      renderList();

      toast("Applying…");

      setTimeout(async () => {
        const src = p.src || await ensureSrcCanvas(p);
        if (!src) return;
        const out = await process(src, { overridePageQuad: p.quad, forceNoYellow: false });
        const processed = out.canvas;

        const thumbCanvas = resizeC(processed, 100);
        const [displayUrl, thumbUrl] = await Promise.all([
          toURL(processed, "image/jpeg", 0.92),
          toURL(thumbCanvas, "image/jpeg", 0.85)
        ]);
          releaseCanvas(thumbCanvas);

          releaseStencilUrl(p);
          releaseStencilCache(p.id);
          setPageUrls(p, displayUrl, thumbUrl);
        p.processed = processed;
        p.processedW = processed.width;
        p.processedH = processed.height;
        p.yellowUsed = out.usedYellow;
        p.marker = out.marker;
        p.status = "done";

        dropCanvasesIfLowMem(p);
        trimCanvasCache(p.id);

        select(S.i);
        renderList();
        stageOff();
        scheduleUi(syncFinalView);
      }, 10);
    }

    fit();
  }

  function toggleStencil() {
    if (S.i < 0 || S.crop) return;
    const p = S.pages[S.i];
    if (p.status && p.status !== "done") {
      toast("Processing...");
      return;
    }
    S.stencil = !S.stencil;
    $("stencilBtn").classList.toggle("active", !!S.stencil);
    E.stencil.style.display = "none";
    if (S.stencil) {
      applyStencilPreview(p);
    } else if (p.displayUrl) {
      E.img.src = p.displayUrl;
      E.img.style.display = "block";
    }
  }

  async function autoCrop() {
    if (S.i < 0) return;
    const p = S.pages[S.i];
    if (p.status && p.status !== "done") {
      toast("Processing...");
      return;
    }
    toast("Detecting…");
    const src = p.src || await ensureSrcCanvas(p);
    if (!src) return;
    setTimeout(() => {
      const q = SP.detectPageEdges(src);
      if (q) { p.quad = q; drawCrop(); }
    }, 10);
  }

  /* Crop drawing & magnifier */
  // Cache theme colors
  let cachedThemeColors = null;
  function getThemeColors() {
    if (!cachedThemeColors) {
      const styles = getComputedStyle(document.body);
      cachedThemeColors = {
        primary: styles.getPropertyValue("--md-sys-color-primary").trim(),
        container: styles.getPropertyValue("--md-sys-color-primary-container").trim()
      };
    }
    return cachedThemeColors;
  }

  function drawCrop() {
    const p = S.pages[S.i];
    const w = E.crop.width;
    const h = E.crop.height;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(p.src, 0, 0);

    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    const quad = p.quad;
    const quadLen = quad.length;
    for (let i = 0; i < quadLen; i++) {
      const pt = quad[i];
      if (i) ctx.lineTo(pt.x, pt.y); else ctx.moveTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.fill("evenodd");

    const colors = getThemeColors();
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = Math.max(2, w / 300);
    ctx.beginPath();
    for (let i = 0; i < quadLen; i++) {
      const pt = quad[i];
      if (i) ctx.lineTo(pt.x, pt.y); else ctx.moveTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.stroke();

    const rad = Math.max(5, w / 80);
    const rad2 = rad * 2;
    const radHalf = rad * 0.5;
    const TWO_PI = Math.PI * 2;

    for (let i = 0; i < quadLen; i++) {
      const pt = quad[i];
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, rad2, 0, TWO_PI);
      ctx.fillStyle = colors.container;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radHalf, 0, TWO_PI);
      ctx.fillStyle = colors.primary;
      ctx.fill();
    }
  }

  function updateMagnifier(x, y) {
    const p = S.pages[S.i];
    if (!p || !p.src) return;
    const size = 140;
    const halfSize = 70;
    const halfSizeZoom = 35; // size / 2 / zoom (where zoom = 2)

    E.mag.width = size;
    E.mag.height = size;
    mctx.clearRect(0, 0, size, size);

    mctx.drawImage(p.src, x - halfSizeZoom, y - halfSizeZoom, halfSize, halfSize, 0, 0, size, size);

    const colors = getThemeColors();

    mctx.beginPath();
    mctx.moveTo(halfSize, 0);
    mctx.lineTo(halfSize, size);
    mctx.moveTo(0, halfSize);
    mctx.lineTo(size, halfSize);
    mctx.strokeStyle = colors.primary;
    mctx.lineWidth = 2;
    mctx.stroke();

    const r = E.crop.getBoundingClientRect();
    const sx = r.width / E.crop.width;
    const sy = r.height / E.crop.height;
    const screenX = r.left + x * sx;
    const screenY = r.top + y * sy;
    const yOff = screenY < 150 ? 80 : (isMobile() ? -140 : -90);

    E.magn.style.display = "block";
    E.magn.style.left = screenX + "px";
    E.magn.style.top = (screenY + yOff) + "px";
    E.magn.style.transform = "translate(-50%,-50%)";
  }

  /* Drag handlers */
  let drag = -1;

  E.crop.addEventListener("mousedown", e => startDrag(e.clientX, e.clientY));
  addEventListener("mousemove", e => moveDrag(e.clientX, e.clientY));
  addEventListener("mouseup", endDrag);

  E.crop.addEventListener("touchstart", e => {
    e.preventDefault();
    startDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  addEventListener("touchmove", e => {
    if (drag !== -1) e.preventDefault();
    if (e.touches.length) moveDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  addEventListener("touchend", endDrag);

  function startDrag(cx, cy) {
    if (S.i < 0) return;

    const p = S.pages[S.i];
    const r = E.crop.getBoundingClientRect();
    const sx = E.crop.width / r.width;
    const sy = E.crop.height / r.height;

    const x = (cx - r.left) * sx;
    const y = (cy - r.top) * sy;

    let min = 1e18, idx = -1;
    const quad = p.quad;
    const quadLen = quad.length;
    for (let i = 0; i < quadLen; i++) {
      const pt = quad[i];
      const dx = pt.x - x;
      const dy = pt.y - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < min) { min = d; idx = i; }
    }

    const hit = E.crop.width * (isMobile() ? 0.12 : 0.05);
    drag = min > hit ? -1 : idx;

    if (drag !== -1) updateMagnifier(p.quad[drag].x, p.quad[drag].y);
  }

  function moveDrag(cx, cy) {
    if (drag === -1) return;

    const p = S.pages[S.i];
    const r = E.crop.getBoundingClientRect();
    const sx = E.crop.width / r.width;
    const sy = E.crop.height / r.height;

    let x = (cx - r.left) * sx;
    let y = (cy - r.top) * sy;

    x = Math.max(0, Math.min(E.crop.width, x));
    y = Math.max(0, Math.min(E.crop.height, y));

    p.quad[drag] = { x, y };

    requestAnimationFrame(drawCrop);
    updateMagnifier(x, y);
  }

  function endDrag() {
    drag = -1;
    E.magn.style.display = "none";
  }

  /* Buttons */
  $("cropBtn").onclick = toggleCrop;
  $("autoCropBtn").onclick = autoCrop;
  $("stencilBtn").onclick = toggleStencil;

  $("exportBtn").onclick = async () => {
    if (!S.pages.length) return;

    toast("Generating PDF…");
    await new Promise(r => setTimeout(r, 100));

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pdfW = doc.internal.pageSize.getWidth();
    const pdfH = doc.internal.pageSize.getHeight();

    // Reuse canvas for all pages
    const t = document.createElement("canvas");
    const tctx = t.getContext("2d", { willReadFrequently: true });

    const drawPageImage = async p => {
      if (p.processed) {
        t.width = p.processed.width;
        t.height = p.processed.height;
        tctx.drawImage(p.processed, 0, 0);
        return true;
      }
      if (!p.displayUrl) return false;
      const img = await loadImg(p.displayUrl);
      const w = p.processedW || img.naturalWidth || img.width;
      const h = p.processedH || img.naturalHeight || img.height;
      if (!w || !h) return false;
      t.width = w;
      t.height = h;
      tctx.drawImage(img, 0, 0, w, h);
      return true;
    };

    const pagesLen = S.pages.length;
    for (let i = 0; i < pagesLen; i++) {
      if (i) doc.addPage();

      const p = S.pages[i];
      const ok = await drawPageImage(p);
      if (!ok) continue;

        if (S.stencil) await applyStencilToContext(tctx, t.width, t.height, t);

      const r = Math.min(pdfW / t.width, pdfH / t.height);
      const w = t.width * r;
      const h = t.height * r;
      const pdfX = (pdfW - w) * 0.5;
      const pdfY = (pdfH - h) * 0.5;
      const data = t.toDataURL("image/jpeg", 0.82);

      doc.addImage(data, "JPEG", pdfX, pdfY, w, h);
    }

    doc.save(($("docTitle").value || "scan") + ".pdf");
    toast("PDF Downloaded");
  };

  /* handleFiles */
  async function handleFiles(files) {
    if (!S.cv || !files || !files.length) return;

    const newPages = [];
    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi];
      if (!isImageFile(file)) continue;

        const page = {
          id: Date.now() + Math.random(),
          file,
          name: file.name,
          status: "queued",
          previewUrl: URL.createObjectURL(file),
        decodePromise: null,
        src: null,
        srcW: 0,
        srcH: 0,
        previewW: 0,
          previewH: 0,
          stageUrl: null,
          stageLabel: "",
          stageW: 0,
          stageH: 0,
          stencilUrl: null,
          processed: null,
          processedW: 0,
          processedH: 0,
        displayUrl: null,
        thumbUrl: null,
        quad: null,
        marker: null,
        yellowUsed: 0
      };

      if (!MEM.low) {
        page.decodePromise = loadImg(file).then(img => {
          if (img) {
            page.previewW = img.naturalWidth || img.width;
            page.previewH = img.naturalHeight || img.height;
          }
          return img;
        }).catch(() => null);
      }

      newPages.push(page);
    }

    if (!newPages.length) return;

    E.empty.style.display = "none";
    S.pages.push(...newPages);
    renderList();
    $("exportBtn").disabled = !S.pages.length;

    newPages.forEach(enqueuePage);
  }

  // Expose for drag-drop triggers created above
  window.handleFiles = handleFiles;

})();








