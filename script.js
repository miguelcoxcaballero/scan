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
      y: 1.43 * PX_PER_CM,
      borderColor: stencilYellow,
      bgColor: "#fff",
      gapMM: 0.4
    };

    MARKER_TARGET = {
      x: 10.375 * PX_PER_CM,
      y: 27.675 * PX_PER_CM
    };

    /* Algorithm object (shared with processing modules) */
    ALG = {
      CFG: {
        A4: [A4_W, A4_H],
        A4_CM: [config.A4_CM_W, config.A4_CM_H],
        PX_CM: PX_PER_CM,
        STENCIL: { w: 18, h: 27, x: 1.5, y: 1.43 },
        MARKER: { x: 10.375, y: 27.675 },
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
  (async () => {
    try {
      const loadedConfig = await SP.loadConfig();
      initializeDimensions(loadedConfig);
      configReady = true;
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
  const isMobile = () => innerWidth <= 768;

  // Cache toast element
  const toastEl = $("toast");
  const toast = t => {
    toastEl.textContent = t;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1800);
  };

  const stageOn = t => {
    E.stage.textContent = t;
    E.badge.style.display = "flex";
  };

  const stageOff = () => { E.badge.style.display = "none"; };

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
    const y = (STENCIL_CFG && STENCIL_CFG.borderColor) ? STENCIL_CFG.borderColor : "#ffde00";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 29.7" width="21cm" height="29.7cm">
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
            fill="none" stroke="${y}" stroke-width="0.06"/>
      <rect x="1.75" y="1.68" width="17.5" height="25.5" fill="url(#dotGrid)"/>
      <g stroke="${y}" stroke-width="0.06" fill="none">
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
      <g stroke="${y}" stroke-width="0.06">
        <circle cx="10.125" cy="27.68" r="0.125" fill="#ff0000"/>
        <circle cx="10.375" cy="27.68" r="0.125" fill="#000000"/>
        <circle cx="10.625" cy="27.68" r="0.125" fill="#0000ff"/>
        <circle cx="10.875" cy="27.68" r="0.125" fill="#6eff12"/>
      </g>
    </svg>`;
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
  const loadImg = file => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });

  const mkCvs = img => {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
    return c;
  };

  const toURL = (c, m = "image/jpeg", q = 0.92) =>
    new Promise(r => c.toBlob(b => r(URL.createObjectURL(b)), m, q));

  const resizeC = (c, w) => {
    const t = document.createElement("canvas");
    const r = c.height / c.width;
    t.width = w;
    t.height = Math.round(w * r);
    t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
    return t;
  };

  /* Temp preview */
  let _tmpURL = null;
  async function showTemp(c, label) {
    stageOn(label);
    E.empty.style.display = "none";
    E.paper.style.display = "block";
    E.crop.style.display = "none";
    E.stencil.style.display = "none";
    E.img.style.display = "block";

    const u = await toURL(c, "image/jpeg", 0.9);
    if (_tmpURL) { URL.revokeObjectURL(_tmpURL); _tmpURL = null; }
    _tmpURL = u;
    E.img.src = u;

    const asp = c.width / c.height;
    const pad = 40;
    const aw = E.viewport.clientWidth - pad;
    const ah = E.viewport.clientHeight - pad;

    let w = aw;
    let h = aw / asp;
    if (h > ah) { h = ah; w = ah * asp; }

    E.paper.style.width = w + "px";
    E.paper.style.height = h + "px";
    resetZ();
    await next();
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
  const trig = () => { if (S.busy) return; isMobile() ? showSourceModal() : E.file.click(); };
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

  E.viewport.addEventListener("dragenter", () => { if (!S.cv || S.busy) return; E.viewport.classList.add("drag-over"); });
  E.viewport.addEventListener("dragover",  () => { if (!S.cv || S.busy) return; E.viewport.classList.add("drag-over"); });
  E.viewport.addEventListener("dragleave", e => { if (!E.viewport.contains(e.relatedTarget)) E.viewport.classList.remove("drag-over"); });

  E.viewport.addEventListener("drop", e => {
    E.viewport.classList.remove("drag-over");
    if (!S.cv || S.busy) return;

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

  E.landing.addEventListener("dragenter", () => { if (!S.cv || S.busy) return; E.landing.classList.add("drag-over"); });
  E.landing.addEventListener("dragover",  () => { if (!S.cv || S.busy) return; E.landing.classList.add("drag-over"); });
  E.landing.addEventListener("dragleave", e => { if (!E.landing.contains(e.relatedTarget)) E.landing.classList.remove("drag-over"); });

  E.landing.addEventListener("drop", e => {
    E.landing.classList.remove("drag-over");
    if (!S.cv || S.busy) return;

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
    ALG.keys.forEach(k => ALG.cal[k].src = null);

    await showTemp(srcCanvas, "Original");

    const pre = SP.preprocess(srcCanvas);
    if (pre) await showTemp(pre, "Enhanced");

    const yR = SP.detectYellow(srcCanvas);
    await showTemp(yR.viz, "Yellow mask");

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

    await showTemp(SP.detectionViz(srcCanvas, corners, pageQuad, yR.contourPoints), "Detection");

    let wrp = null;
    if (usedYellow && corners && edges) {
      const grid = SP.optimizeGrid(edges, ALG.CFG.ROWS, ALG.CFG.COLS);
      await showTemp(SP.meshViz(srcCanvas, grid, corners, edges), "Mesh");
      wrp = SP.warpGrid(srcCanvas, grid);
    } else {
      await showTemp(SP.detectionViz(srcCanvas, corners, pageQuad, yR.contourPoints), "Mesh");
      wrp = SP.warpSimple(srcCanvas, pageQuad);
    }

    await showTemp(wrp, "Warp");

    const col = SP.scanColors(wrp);
    await showTemp(col.viz, "Color window");

    let aligned = wrp;
    let marker = null;

    if (!usedYellow && col.found && col.blackPt) {
      aligned = SP.alignMarker(wrp, SP.findBlackBlob(wrp, col.blackPt));
      marker = { x: MARKER_TARGET.x, y: MARKER_TARGET.y };
    } else if (usedYellow) {
      marker = { x: MARKER_TARGET.x, y: MARKER_TARGET.y };
    }

    const T = SP.buildTransform();
    const showRecolorStep = async (label, canvas) => showTemp(canvas, label);

    let fin;
    if (T) fin = await SP.applyColorStepsAsync(aligned, T, showRecolorStep);
    else fin = await SP.applyBalanceStepsAsync(aligned, showRecolorStep);

    if (usedYellow) {
      fin = SP.restoreMargins(fin);
      await showTemp(fin, "Recoloring: Restore margins");
    }

    await showTemp(fin, "Final");

    return { canvas: fin, pageQuad, marker, usedYellow };
  }

  /* Page list rendering */
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
      const card = document.createElement("div");
      card.className = "page-card" + (i === currentIdx ? " active" : "");

      const thumbHtml = p.thumbUrl
        ? `<img src="${p.thumbUrl}" class="thumb" alt="">`
        : '<div class="thumb-placeholder"><span class="material-symbols-rounded">description</span></div>';

      card.innerHTML = `
        <span class="material-symbols-rounded drag-handle">drag_indicator</span>
        ${thumbHtml}
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

        S.pages.splice(i, 1);

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

  /* Overlay */
  function _overlay(c, w, h) {
    if (!S.stencil || !SP.Dims) return;

    const scaleX = w / SP.Dims.A4_W;
    const scaleY = h / SP.Dims.A4_H;

    const x = STENCIL_CFG.x * scaleX;
    const y = STENCIL_CFG.y * scaleY;
    const W = STENCIL_CFG.w * scaleX;
    const H = STENCIL_CFG.h * scaleY;

    const lw = 8 * scaleX;
    const STENCIL_GAP_CM = STENCIL_CFG.gapMM / 10;
    const gap = STENCIL_GAP_CM * SP.Dims.PX_PER_CM * scaleX;
    const off = lw * 0.5 + gap;

    c.fillStyle = STENCIL_CFG.bgColor;
    c.fillRect(0, 0, w, h);

    c.globalCompositeOperation = "destination-out";
    c.fillRect(x + off, y + off, W - 2 * off, H - 2 * off);

    c.globalCompositeOperation = "source-over";
    c.strokeStyle = STENCIL_CFG.borderColor;
    c.lineWidth = lw;
    c.strokeRect(x, y, W, H);
  }

  function drawOverlay(target, w, h, exportMode = 0) {
    if (exportMode) {
      const o = document.createElement("canvas");
      o.width = w;
      o.height = h;
      const oc = o.getContext("2d", { willReadFrequently: true });
      _overlay(oc, w, h);
      target.drawImage(o, 0, 0);
      return;
    }

    if (target.canvas === E.stencil) {
      E.stencil.width = w;
      E.stencil.height = h;
    }

    target.clearRect(0, 0, w, h);
    _overlay(target, w, h);
  }

  function fit() {
    if (S.i < 0) return;

    const p = S.pages[S.i];
    const sw = S.crop ? p.src.width : p.processed.width;
    const sh = S.crop ? p.src.height : p.processed.height;
    const asp = sw / sh;
    const pad = 40;
    const aw = E.viewport.clientWidth - pad;
    const ah = E.viewport.clientHeight - pad;

    let w = aw;
    let h = aw / asp;
    if (h > ah) { h = ah; w = ah * asp; }

    E.paper.style.width = w + "px";
    E.paper.style.height = h + "px";

    if (S.crop) drawCrop();
    else drawOverlay(stx, p.processed.width, p.processed.height);

    resetZ();
  }

  /* Selection */
  function select(i) {
    if (i < 0 || i >= S.pages.length) return;
    if (S.crop) toggleCrop();

    S.i = i;
    renderList();

    const p = S.pages[i];
    E.paper.style.display = "block";
    E.empty.style.display = "none";

    if (p.displayUrl) {
      E.img.src = p.displayUrl;
      E.img.style.display = "block";
    } else {
      E.img.style.display = "none";
    }

    E.crop.style.display = "none";
    $("cropBtn").disabled = false;
    $("stencilBtn").disabled = false;
    $("stencilBtn").classList.toggle("active", !!S.stencil);
    E.stencil.style.display = "block";

    drawOverlay(stx, p.processed.width, p.processed.height);
    fit();
  }

  /* Crop mode */
  function toggleCrop() {
    if (S.i < 0) return;

    S.crop = !S.crop;
    const btn = $("cropBtn");
    const auto = $("autoCropBtn");
    const stb = $("stencilBtn");
    const p = S.pages[S.i];

    if (S.crop) {
      btn.innerHTML = `<span class="material-symbols-rounded">check</span><span class="label-text">Done</span>`;
      btn.classList.add("active");

      auto.style.display = "flex";
      stb.style.display = "none";

      E.img.style.display = "none";
      E.stencil.style.display = "none";
      E.crop.style.display = "block";

      E.crop.width = p.src.width;
      E.crop.height = p.src.height;

      drawCrop();
    } else {
      btn.innerHTML = `<span class="material-symbols-rounded">crop</span><span class="label-text">Crop</span>`;
      btn.classList.remove("active");

      auto.style.display = "none";
      stb.style.display = "flex";
      E.stencil.style.display = "block";

      toast("Applying…");

      setTimeout(async () => {
        const out = await process(p.src, { overridePageQuad: p.quad, forceNoYellow: false });

        p.processed = out.canvas;
        p.displayUrl = await toURL(out.canvas, "image/jpeg", 0.92);
        p.thumbUrl = await toURL(resizeC(out.canvas, 100), "image/jpeg", 0.85);
        p.yellowUsed = out.usedYellow;
        p.marker = out.marker;

        select(S.i);
        renderList();
        stageOff();
      }, 10);
    }

    fit();
  }

  function toggleStencil() {
    if (S.i < 0 || S.crop) return;
    S.stencil = !S.stencil;
    $("stencilBtn").classList.toggle("active", !!S.stencil);
    drawOverlay(stx, S.pages[S.i].processed.width, S.pages[S.i].processed.height);
  }

  function autoCrop() {
    if (S.i < 0) return;
    toast("Detecting…");
    setTimeout(() => {
      const p = S.pages[S.i];
      const q = SP.detectPageEdges(p.src);
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

    const pagesLen = S.pages.length;
    for (let i = 0; i < pagesLen; i++) {
      if (i) doc.addPage();

      const p = S.pages[i];
      t.width = p.processed.width;
      t.height = p.processed.height;

      tctx.drawImage(p.processed, 0, 0);

      if (S.stencil || p.marker) drawOverlay(tctx, t.width, t.height, 1);

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
    if (!S.cv || !files || !files.length || S.busy) return;

    S.busy = 1;
    E.empty.style.display = "none";
    stageOn("Processing…");

    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi];
      try {
        const img = await loadImg(file);
        const src = mkCvs(img);
        const out = await process(src);
        const processed = out.canvas;

        const displayUrl = await toURL(processed, "image/jpeg", 0.92);
        const thumbUrl = await toURL(resizeC(processed, 100), "image/jpeg", 0.85);

        S.pages.push({
          id: Date.now() + Math.random(),
          src,
          processed,
          displayUrl,
          thumbUrl,
          quad: out.pageQuad || [
            { x: 0, y: 0 },
            { x: src.width, y: 0 },
            { x: src.width, y: src.height },
            { x: 0, y: src.height }
          ],
          name: file.name,
          marker: out.marker,
          yellowUsed: out.usedYellow
        });
      } catch (e) {
        console.error(e);
        toast("Error processing image");
      }
    }

    renderList();
    select(S.pages.length - 1);
    $("exportBtn").disabled = !S.pages.length;
    stageOff();
    S.busy = 0;
  }

  // Expose for drag-drop triggers created above
  window.handleFiles = handleFiles;

})();

