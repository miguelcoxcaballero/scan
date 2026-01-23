(() => {
  "use strict";
  const SP = (window.ScannerPro = window.ScannerPro || {});
  const U = SP.Util;

  function yellowViz(w, h, mask, mw, mh, pts, crs) {
    const vc = document.createElement("canvas");
    vc.width = w;
    vc.height = h;
    const vctx = vc.getContext("2d", { willReadFrequently: true });

    const mc = document.createElement("canvas");
    mc.width = mw;
    mc.height = mh;
    const mx = mc.getContext("2d", { willReadFrequently: true });
    const id = mx.createImageData(mw, mh);
    const idData = id.data;

    const maskLen = mask.length;
    for (let i = 0, j = 0; i < maskLen; i++, j += 4) {
      const v = mask[i] ? 255 : 0;
      idData[j] = v;
      idData[j + 1] = v;
      idData[j + 2] = 0;
      idData[j + 3] = 255;
    }

    mx.putImageData(id, 0, 0);
    vctx.imageSmoothingEnabled = false;
    vctx.drawImage(mc, 0, 0, w, h);

    const ptsLen = pts ? pts.length : 0;
    if (ptsLen) {
      vctx.strokeStyle = "#0f0";
      vctx.lineWidth = 3;
      vctx.beginPath();
      vctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < ptsLen; i++) {
        const pt = pts[i];
        vctx.lineTo(pt.x, pt.y);
      }
      vctx.closePath();
      vctx.stroke();
    }

    if (crs && crs.length === 4) {
      const cc = ["#f00", "#0f0", "#00f", "#f0f"];
      const TWO_PI = Math.PI * 2;
      for (let i = 0; i < 4; i++) {
        const p = crs[i];
        vctx.beginPath();
        vctx.arc(p.x, p.y, 12, 0, TWO_PI);
        vctx.fillStyle = cc[i];
        vctx.fill();
      }
    }

    return vc;
  }

  function detectionViz(cvs, yq, pq, pts) {
    const c = document.createElement("canvas");
    const cw = cvs.width;
    c.width = cw;
    c.height = cvs.height;
    const vctx = c.getContext("2d", { willReadFrequently: true });
    vctx.drawImage(cvs, 0, 0);

    const lw = Math.max(2, cw / 300);

    const ptsLen = pts ? pts.length : 0;
    if (ptsLen) {
      vctx.strokeStyle = "#ff0";
      vctx.lineWidth = lw;
      vctx.beginPath();
      vctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < ptsLen; i++) {
        const pt = pts[i];
        vctx.lineTo(pt.x, pt.y);
      }
      vctx.closePath();
      vctx.stroke();
    }

    if (pq && pq.length === 4) {
      vctx.strokeStyle = "#0af";
      vctx.lineWidth = lw * 2;
      vctx.setLineDash([15, 10]);
      vctx.beginPath();
      vctx.moveTo(pq[0].x, pq[0].y);
      for (let i = 1; i < 4; i++) {
        const pt = pq[i];
        vctx.lineTo(pt.x, pt.y);
      }
      vctx.closePath();
      vctx.stroke();
      vctx.setLineDash([]);
    }

    if (yq && yq.length === 4) {
      vctx.strokeStyle = "#0f0";
      vctx.lineWidth = lw * 1.5;
      vctx.beginPath();
      vctx.moveTo(yq[0].x, yq[0].y);
      for (let i = 1; i < 4; i++) {
        const pt = yq[i];
        vctx.lineTo(pt.x, pt.y);
      }
      vctx.closePath();
      vctx.stroke();

      const cc = ["#f00", "#0f0", "#00f", "#f0f"];
      const TWO_PI = Math.PI * 2;
      for (let i = 0; i < 4; i++) {
        const p = yq[i];
        vctx.beginPath();
        vctx.arc(p.x, p.y, 15, 0, TWO_PI);
        vctx.fillStyle = cc[i];
        vctx.fill();
      }
    }

    return c;
  }

  const isYellowHSV = (r, g, b) => {
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const d = mx - mn;

    if (mx < 70 || d < 30) return false;
    const s = d / mx;
    if (s < 0.25) return false;

    let h;
    if (d === 0) h = 0;
    else if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;

    h *= 60;
    if (h < 0) h += 360;

    return h >= 38 && h <= 78 && b < mx * 0.78;
  };

  function detectYellow(cvs) {
    const oW = cvs.width;
    const oH = cvs.height;
    const maxDim = oW > oH ? oW : oH;
    const sc = maxDim > 1000 ? 1000 / maxDim : 1;
    const w = (oW * sc) | 0;
    const h = (oH * sc) | 0;

    const tc = document.createElement("canvas");
    tc.width = w;
    tc.height = h;
    const tctx = tc.getContext("2d", { willReadFrequently: true });
    tctx.drawImage(cvs, 0, 0, w, h);

    const data = tctx.getImageData(0, 0, w, h).data;
    const dataLen = data.length;
    const cat = new Uint8Array(w * h);

    for (let i = 0, j = 0; i < dataLen; i += 4, j++) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (isYellowHSV(r, g, b)) cat[j] = 1;
    }

    const br = Math.max(3, (w * 0.003) | 0);
    const dil = new Uint8Array(w * h);

    // Optimized dilation: iterate through set pixels only
    for (let y = 0; y < h; y++) {
      const yIdx = y * w;
      for (let x = 0; x < w; x++) {
        if (cat[yIdx + x] === 1) {
          const nyMin = Math.max(0, y - br);
          const nyMax = Math.min(h - 1, y + br);
          const nxMin = Math.max(0, x - br);
          const nxMax = Math.min(w - 1, x + br);

          for (let ny = nyMin; ny <= nyMax; ny++) {
            const nyIdx = ny * w;
            for (let nx = nxMin; nx <= nxMax; nx++) {
              dil[nyIdx + nx] = 1;
            }
          }
        }
      }
    }

    const closed = new Uint8Array(w * h);
    const er = Math.max(1, br - 1);

    // Optimized erosion
    for (let y = 0; y < h; y++) {
      const yIdx = y * w;
      for (let x = 0; x < w; x++) {
        const idx = yIdx + x;
        if (dil[idx] === 1) {
          let ok = true;
          const nyMin = y - er;
          const nyMax = y + er;
          const nxMin = x - er;
          const nxMax = x + er;

          outer: for (let dy = nyMin; dy <= nyMax; dy++) {
            if (dy < 0 || dy >= h) { ok = false; break; }
            const dyIdx = dy * w;
            for (let dx = nxMin; dx <= nxMax; dx++) {
              if (dx < 0 || dx >= w || dil[dyIdx + dx] !== 1) {
                ok = false;
                break outer;
              }
            }
          }
          if (ok) closed[idx] = 1;
        }
      }
    }

    const closedLen = closed.length;
    const yIdx = [];
    for (let i = 0; i < closedLen; i++) if (closed[i] === 1) yIdx.push(i);

    const fMask = new Uint8Array(w * h);

    if (yIdx.length) {
      const vis = new Uint8Array(w * h);
      let best = null;
      let maxArea = -1;

      for (const si of yIdx) {
        if (vis[si]) continue;

        const comp = [];
        const stk = [si];
        vis[si] = 1;

        let minX = w, maxX = 0, minY = h, maxY = 0;

        while (stk.length) {
          const idx = stk.pop();
          comp.push(idx);

          const x = idx % w;
          const y = (idx / w) | 0;

          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;

          // Check 8-connected neighbors
          const neighbors = [
            idx - w - 1, idx - w, idx - w + 1,
            idx - 1,              idx + 1,
            idx + w - 1, idx + w, idx + w + 1
          ];
          const validX = [x > 0, true, x < w - 1, x > 0, x < w - 1, x > 0, true, x < w - 1];
          const validY = [y > 0, y > 0, y > 0, true, true, y < h - 1, y < h - 1, y < h - 1];

          for (let i = 0; i < 8; i++) {
            if (validX[i] && validY[i]) {
              const ni = neighbors[i];
              if (closed[ni] === 1 && !vis[ni]) {
                vis[ni] = 1;
                stk.push(ni);
              }
            }
          }
        }

        const bW = maxX - minX + 1;
        const bH = maxY - minY + 1;
        if (bW < 10 || bH < 10) continue;

        const lM = new Uint8Array(bW * bH);
        const oM = new Uint8Array(bW * bH);

        for (const idx of comp) {
          const lx = idx % w - minX;
          const ly = ((idx / w) | 0) - minY;
          lM[ly * bW + lx] = 1;
        }

        const fs = [];
        for (let lx = 0; lx < bW; lx++) {
          if (!lM[lx] && !oM[lx]) { fs.push({ x: lx, y: 0 }); oM[lx] = 1; }
          const bi = (bH - 1) * bW + lx;
          if (!lM[bi] && !oM[bi]) { fs.push({ x: lx, y: bH - 1 }); oM[bi] = 1; }
        }
        for (let ly = 1; ly < bH - 1; ly++) {
          const li = ly * bW;
          const ri = ly * bW + bW - 1;
          if (!lM[li] && !oM[li]) { fs.push({ x: 0, y: ly }); oM[li] = 1; }
          if (!lM[ri] && !oM[ri]) { fs.push({ x: bW - 1, y: ly }); oM[ri] = 1; }
        }

        // Optimized flood fill with 4-connected neighbors
        while (fs.length) {
          const p = fs.pop();
          const px = p.x, py = p.y;

          // Check right
          if (px + 1 < bW) {
            const li = py * bW + px + 1;
            if (!lM[li] && !oM[li]) { oM[li] = 1; fs.push({ x: px + 1, y: py }); }
          }
          // Check left
          if (px > 0) {
            const li = py * bW + px - 1;
            if (!lM[li] && !oM[li]) { oM[li] = 1; fs.push({ x: px - 1, y: py }); }
          }
          // Check down
          if (py + 1 < bH) {
            const li = (py + 1) * bW + px;
            if (!lM[li] && !oM[li]) { oM[li] = 1; fs.push({ x: px, y: py + 1 }); }
          }
          // Check up
          if (py > 0) {
            const li = (py - 1) * bW + px;
            if (!lM[li] && !oM[li]) { oM[li] = 1; fs.push({ x: px, y: py - 1 }); }
          }
        }

        let oC = 0;
        const oMLen = oM.length;
        for (let k = 0; k < oMLen; k++) if (oM[k]) oC++;

        const enc = bW * bH - oC;
        if (enc > maxArea) { maxArea = enc; best = { comp, bW, bH, minX, minY, lM, oM }; }
      }

      if (best) {
        const { comp, bW, bH, minX, minY, lM, oM } = best;
        const maskSize = bW * bH;
        const iM = new Uint8Array(maskSize);
        let hasIn = false;

        for (let i = 0; i < maskSize; i++) {
          if (!lM[i] && !oM[i]) { iM[i] = 1; hasIn = true; }
        }

        if (hasIn) {
          const kd = 5;
          for (const idx of comp) {
            const lx = idx % w - minX;
            const ly = ((idx / w) | 0) - minY;
            let found = false;
            for (let dy = -kd; dy <= kd && !found; dy++) {
              for (let dx = -kd; dx <= kd && !found; dx++) {
                const nx = lx + dx, ny = ly + dy;
                if (nx >= 0 && nx < bW && ny >= 0 && ny < bH) {
                  if (iM[ny * bW + nx] === 1) { fMask[idx] = 1; found = true; }
                }
              }
            }
          }
        } else {
          for (const idx of comp) fMask[idx] = 1;
        }
      }
    }

    const m = new U.MM();
    try {
      const mm = m.t(new cv.Mat(h, w, cv.CV_8UC1));
      const mmData = mm.data;
      const fMaskLen = fMask.length;
      for (let i = 0; i < fMaskLen; i++) mmData[i] = fMask[i] ? 255 : 0;

      const cnts = m.t(new cv.MatVector());
      cv.findContours(mm, cnts, m.t(new cv.Mat()), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);

      let bc = null, ba = 0;
      for (let i = 0; i < cnts.size(); i++) {
        const c = cnts.get(i);
        const a = cv.contourArea(c);
        if (a > ba) { ba = a; bc = c; }
      }

      if (!bc || ba < w * h * 0.01) {
        return { contourPoints: null, corners: null, edges: null, viz: SP.emptyViz(oW, oH) };
      }

      const cpts = [];
      for (let i = 0; i < bc.rows; i++) {
        cpts.push({ x: bc.intPtr(i, 0)[0] / sc, y: bc.intPtr(i, 0)[1] / sc });
      }

      const peri = cv.arcLength(bc, true);
      const ap = m.t(new cv.Mat());
      cv.approxPolyDP(bc, ap, 0.02 * peri, true);

      let corners = null;
      let edges = null;

      if (ap.rows === 4) {
        const raw = [];
        for (let j = 0; j < 4; j++) raw.push({ x: ap.intPtr(j, 0)[0] / sc, y: ap.intPtr(j, 0)[1] / sc });
        corners = U.orderQuad(raw);
        edges = SP.splitEdges(cpts, corners);
      }

      return { contourPoints: cpts, corners, edges, viz: yellowViz(oW, oH, fMask, w, h, cpts, corners) };
    } catch (e) {
      return { contourPoints: null, corners: null, edges: null, viz: SP.emptyViz(oW, oH) };
    } finally {
      m.d();
    }
  }

  SP.detectYellow = detectYellow;
  SP.detectionViz = detectionViz;
})();
