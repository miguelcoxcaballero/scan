(() => {
  "use strict";
  const SP = (window.ScannerPro = window.ScannerPro || {});
  const U = (SP.Util = SP.Util || {});

  U.next = () => new Promise(requestAnimationFrame);
  U.clamp = (v, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);
  U.lerp = (a, b, t) => ({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  U.d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  U.orderQuad = (pts) => {
    if (!pts || pts.length !== 4) return pts;
    const s = pts.slice().sort((a, b) => a.y - b.y);
    const t = s.slice(0, 2).sort((a, b) => a.x - b.x);
    const bo = s.slice(2).sort((a, b) => a.x - b.x);
    return [t[0], t[1], bo[1], bo[0]];
  };

  class MM {
    constructor() { this.m = []; }
    t(x) { if (x && x.delete) this.m.push(x); return x; }
    d() {
      this.m.forEach(x => { try { if (!x.isDeleted()) x.delete(); } catch(e) {} });
      this.m = [];
    }
  }
  U.MM = MM;

  U.mat2C = (mat) => {
    const c = document.createElement("canvas");
    c.width = mat.cols;
    c.height = mat.rows;
    cv.imshow(c, mat);
    return c;
  };

  SP.emptyViz = (w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d");
    x.fillStyle = "#000";
    x.fillRect(0, 0, w, h);
    return c;
  };

  // Edge splitting (used by yellow detection)
  SP.splitEdges = function splitEdges(cpts, corners) {
    if (!cpts || !corners || corners.length !== 4) return null;

    const n = cpts.length;
    const ci = new Array(4);

    for (let c = 0; c < 4; c++) {
      const corner = corners[c];
      let md = 1e18, mi = 0;
      for (let i = 0; i < n; i++) {
        const p = cpts[i];
        const d = U.d2(p, corner);
        if (d < md) { md = d; mi = i; }
      }
      ci[c] = mi;
    }

    const edges = { top: [], right: [], bottom: [], left: [] };
    const order = ["top", "right", "bottom", "left"];

    const calcLen = arr => {
      let s = 0;
      const arrLen = arr.length;
      for (let k = 1; k < arrLen; k++) {
        const curr = arr[k];
        const prev = arr[k - 1];
        s += U.d2(prev, curr);
      }
      return s;
    };

    for (let e = 0; e < 4; e++) {
      const si = ci[e];
      const ei = ci[(e + 1) & 3]; // Modulo 4 using bitwise AND

      const f = [];
      let i = si;
      while (true) {
        f.push({ ...cpts[i] });
        if (i === ei) break;
        i = (i + 1) % n;
      }

      const b = [];
      let j = si;
      while (true) {
        b.push({ ...cpts[j] });
        if (j === ei) break;
        j = (j - 1 + n) % n;
      }

      edges[order[e]] = calcLen(f) <= calcLen(b) ? f : b;
    }

    return edges;
  };

  // Cache Gaussian kernel
  const GAUSS_SIGMA = 2;
  const GAUSS_RADIUS = 4;
  const GAUSS_SIZE = GAUSS_RADIUS * 2 + 1;
  const gaussKernel = (() => {
    const k = new Float32Array(GAUSS_SIZE);
    let ks = 0;
    const sig2 = 2 * GAUSS_SIGMA * GAUSS_SIGMA;
    for (let i = -GAUSS_RADIUS; i <= GAUSS_RADIUS; i++) {
      const wt = Math.exp(-i * i / sig2);
      k[i + GAUSS_RADIUS] = wt;
      ks += wt;
    }
    for (let i = 0; i < GAUSS_SIZE; i++) k[i] /= ks;
    return k;
  })();

  const smoothPoints = pts => {
    const ptsLen = pts.length;
    let sm = new Array(ptsLen);
    for (let i = 0; i < ptsLen; i++) {
      sm[i] = { ...pts[i] };
    }

    for (let it = 0; it < 3; it++) {
      const ns = new Array(ptsLen);
      ns[0] = { ...sm[0] };
      ns[ptsLen - 1] = { ...sm[ptsLen - 1] };

      for (let i = 1; i < ptsLen - 1; i++) {
        let sx = 0, sy = 0, sw = 0;
        for (let j = -GAUSS_RADIUS; j <= GAUSS_RADIUS; j++) {
          const idx = i + j;
          if (idx >= 0 && idx < ptsLen) {
            const w = gaussKernel[j + GAUSS_RADIUS];
            const pt = sm[idx];
            sx += pt.x * w;
            sy += pt.y * w;
            sw += w;
          }
        }
        ns[i] = { x: sx / sw, y: sy / sw };
      }
      sm = ns;
    }
    return sm;
  };

  SP.smoothResample = function smoothResample(pts, cnt) {
    if (!pts || pts.length < 2) {
      const fillPt = pts ? { ...pts[0] } : { x: 0, y: 0 };
      const result = new Array(cnt);
      for (let i = 0; i < cnt; i++) result[i] = { ...fillPt };
      return result;
    }

    const sm = smoothPoints(pts);

    const smLen = sm.length;
    const al = new Float32Array(smLen);
    al[0] = 0;
    for (let i = 1; i < smLen; i++) {
      const curr = sm[i];
      const prev = sm[i - 1];
      al[i] = al[i - 1] + U.d2(prev, curr);
    }
    const tl = al[smLen - 1];
    if (!tl) {
      const fillPt = { ...sm[0] };
      const result = new Array(cnt);
      for (let i = 0; i < cnt; i++) result[i] = { ...fillPt };
      return result;
    }

    const rs = new Array(cnt);
    const cntMinus1 = cnt - 1;
    const alLen = al.length;
    const smLenMinus1 = smLen - 1;

    for (let i = 0; i < cnt; i++) {
      const tgt = i / cntMinus1 * tl;
      let lo = 0, hi = alLen - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (al[mid] <= tgt) lo = mid; else hi = mid;
      }
      const seg = al[lo + 1] - al[lo];
      const t = seg > 0 ? (tgt - al[lo]) / seg : 0;
      const nextIdx = lo + 1 < smLen ? lo + 1 : smLenMinus1;
      rs[i] = U.lerp(sm[lo], sm[nextIdx], t);
    }

    rs[0] = { ...sm[0] };
    rs[cntMinus1] = { ...sm[smLenMinus1] };
    return rs;
  };

  SP.axisResample = function axisResample(pts, cnt) {
    if (!pts || pts.length < 2) {
      const fillPt = pts ? { ...pts[0] } : { x: 0, y: 0 };
      const result = new Array(cnt);
      for (let i = 0; i < cnt; i++) result[i] = { ...fillPt };
      return result;
    }

    const sm = smoothPoints(pts);
    const smLen = sm.length;
    const start = sm[0];
    const end = sm[smLen - 1];
    const vx = end.x - start.x;
    const vy = end.y - start.y;
    const len2 = vx * vx + vy * vy;
    if (len2 < 1e-6) return SP.smoothResample(pts, cnt);

    const tvals = new Float32Array(smLen);
    tvals[0] = 0;
    for (let i = 1; i < smLen; i++) {
      const pt = sm[i];
      let t = ((pt.x - start.x) * vx + (pt.y - start.y) * vy) / len2;
      if (t < tvals[i - 1] + 1e-4) t = tvals[i - 1] + 1e-4;
      tvals[i] = t;
    }
    const tLast = tvals[smLen - 1];
    if (tLast <= 0) return SP.smoothResample(pts, cnt);
    for (let i = 1; i < smLen; i++) tvals[i] /= tLast;

    const rs = new Array(cnt);
    const cntMinus1 = cnt - 1;
    for (let i = 0; i < cnt; i++) {
      const tgt = i / cntMinus1;
      let lo = 0, hi = smLen - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (tvals[mid] <= tgt) lo = mid; else hi = mid;
      }
      const t0 = tvals[lo];
      const t1 = tvals[lo + 1];
      const seg = t1 - t0;
      const t = seg > 0 ? (tgt - t0) / seg : 0;
      rs[i] = U.lerp(sm[lo], sm[lo + 1], t);
    }
    rs[0] = { ...sm[0] };
    rs[cntMinus1] = { ...sm[smLen - 1] };
    return rs;
  };

  SP.axisResampleY = function axisResampleY(pts, cnt) {
    if (!pts || pts.length < 2) {
      const fillPt = pts ? { ...pts[0] } : { x: 0, y: 0 };
      const result = new Array(cnt);
      for (let i = 0; i < cnt; i++) result[i] = { ...fillPt };
      return result;
    }

    const sm = smoothPoints(pts);
    const smLen = sm.length;
    const startY = sm[0].y;
    const endY = sm[smLen - 1].y;
    const dy = endY - startY;
    if (Math.abs(dy) < 1e-6) return SP.smoothResample(pts, cnt);

    const tvals = new Float32Array(smLen);
    tvals[0] = 0;
    for (let i = 1; i < smLen; i++) {
      let t = (sm[i].y - startY) / dy;
      if (t < tvals[i - 1] + 1e-4) t = tvals[i - 1] + 1e-4;
      tvals[i] = t;
    }
    const tLast = tvals[smLen - 1];
    if (tLast <= 0) return SP.smoothResample(pts, cnt);
    for (let i = 1; i < smLen; i++) tvals[i] /= tLast;

    const rs = new Array(cnt);
    const cntMinus1 = cnt - 1;
    for (let i = 0; i < cnt; i++) {
      const tgt = i / cntMinus1;
      let lo = 0, hi = smLen - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (tvals[mid] <= tgt) lo = mid; else hi = mid;
      }
      const t0 = tvals[lo];
      const t1 = tvals[lo + 1];
      const seg = t1 - t0;
      const t = seg > 0 ? (tgt - t0) / seg : 0;
      rs[i] = U.lerp(sm[lo], sm[lo + 1], t);
    }
    rs[0] = { ...sm[0] };
    rs[cntMinus1] = { ...sm[smLen - 1] };
    return rs;
  };

  // Image preprocessing (OpenCV)
  // Cache CLAHE parameters
  const CLAHE_CLIP_LIMIT = 2;
  const CLAHE_TILE_SIZE = 8;

  SP.preprocess = function preprocess(cvs) {
    const m = new U.MM();
    try {
      const src = m.t(cv.imread(cvs));
      const lab = m.t(new cv.Mat());

      cv.cvtColor(src, lab, cv.COLOR_RGBA2RGB);
      cv.cvtColor(lab, lab, cv.COLOR_RGB2Lab);

      const planes = m.t(new cv.MatVector());
      cv.split(lab, planes);

      const clahe = m.t(new cv.CLAHE(CLAHE_CLIP_LIMIT, new cv.Size(CLAHE_TILE_SIZE, CLAHE_TILE_SIZE)));
      const lChannel = planes.get(0);
      clahe.apply(lChannel, lChannel);

      cv.merge(planes, lab);

      const res = m.t(new cv.Mat());
      cv.cvtColor(lab, res, cv.COLOR_Lab2RGB);

      return U.mat2C(res);
    } catch (e) {
      return null;
    } finally {
      m.d();
    }
  };
})();
