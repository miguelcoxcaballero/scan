(() => {
  "use strict";
  const SP = (window.ScannerPro = window.ScannerPro || {});
  const U = SP.Util;

  function solve4(G, b) {
    const M = G.map((r, i) => [...r, b[i]]);

    for (let col = 0; col < 4; col++) {
      let piv = col;
      for (let r = col + 1; r < 4; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      if (Math.abs(M[piv][col]) < 1e-8) return null;

      if (piv !== col) [M[piv], M[col]] = [M[col], M[piv]];

      const pv = M[col][col];
      for (let j = col; j < 5; j++) M[col][j] /= pv;

      for (let r = 0; r < 4; r++) {
        if (r !== col) {
          const f = M[r][col];
          for (let j = col; j < 5; j++) M[r][j] -= f * M[col][j];
        }
      }
    }
    return [M[0][4], M[1][4], M[2][4], M[3][4]];
  }

  SP.buildTransform = function buildTransform() {
    const ALG = SP.ALG;
    for (const k of ALG.keys) if (!ALG.cal[k].src) return null;

    const Ssrc = [];
    const Tr = [], Tg = [], Tb = [];

    for (const k of ALG.keys) {
      const s = ALG.cal[k].src;
      const d = ALG.cal[k].dst;
      Ssrc.push([s[0], s[1], s[2], 1]);
      Tr.push(d[0]); Tg.push(d[1]); Tb.push(d[2]);
    }

    const G = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
    for (const s of Ssrc) {
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) G[r][c] += s[r] * s[c];
    }

    const mb = T => {
      const b = [0,0,0,0];
      for (let i = 0; i < 5; i++) for (let r = 0; r < 4; r++) b[r] += Ssrc[i][r] * T[i];
      return b;
    };

    const rR = solve4(G, mb(Tr));
    const rG = solve4(G, mb(Tg));
    const rB = solve4(G, mb(Tb));
    return (rR && rG && rB) ? [rR, rG, rB] : null;
  };

  const isBlue = (cfg, r, g, b) => {
    const mx = r > g ? r : g;
    const mxClamped = mx > 1 ? mx : 1;
    return b - mx >= cfg.BLUE_DETECTION.MIN_DIFF &&
           b >= cfg.BLUE_DETECTION.MIN_BLUE &&
           b / mxClamped >= cfg.BLUE_DETECTION.RATIO;
  };

  // Cache edge bounds calculation
  let cachedEdgeBounds = null;
  let cachedColorRect = null;
  const edgeBounds = () => {
    if (!cachedEdgeBounds) {
      const ALG = SP.ALG;
      const PX = ALG.CFG.PX_CM;
      cachedEdgeBounds = {
        sx: (ALG.CFG.STENCIL.x * PX) | 0,
        sy: (ALG.CFG.STENCIL.y * PX) | 0,
        sw: (ALG.CFG.STENCIL.w * PX) | 0,
        sh: (ALG.CFG.STENCIL.h * PX) | 0,
        em: 15
      };
    }
    return cachedEdgeBounds;
  };

  const DOT_COLOR_DIST_MAX = 1600;
  const dotColorDist = (r1, g1, b1, r2, g2, b2) => {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
  };

  const getDotColors = () => {
    const ALG = SP.ALG;
    if (!ALG) return null;
    const out = [];
    const cal = ALG.cal;
    if (cal && cal.red && cal.red.src) {
      out.push(cal.red.src, cal.black.src, cal.blue.src, cal.green.src);
    } else if (ALG.SC) {
      out.push(
        [ALG.SC.red.r, ALG.SC.red.g, ALG.SC.red.b],
        [ALG.SC.black.r, ALG.SC.black.g, ALG.SC.black.b],
        [ALG.SC.blue.r, ALG.SC.blue.g, ALG.SC.blue.b],
        [ALG.SC.green.r, ALG.SC.green.g, ALG.SC.green.b]
      );
    }
    return out.length ? out : null;
  };

  const isDotColor = (r, g, b, dotColors) => {
    if (!dotColors) return false;
    const len = dotColors.length;
    for (let i = 0; i < len; i++) {
      const dc = dotColors[i];
      if (dotColorDist(r, g, b, dc[0], dc[1], dc[2]) < DOT_COLOR_DIST_MAX) return true;
    }
    return false;
  };

  const colorRectBounds = () => {
    if (!cachedColorRect) {
      const D = SP.Dims;
      if (!D) return { x1: -1, y1: -1, w: 0, h: 0 };
      const oX1 = (1105 * D.SX + 0.5) | 0;
      const oY1 = (3200 * D.SY + 0.5) | 0;
      const oX2 = (1370 * D.SX + 0.5) | 0;
      const nW = ((oX2 - oX1) * 0.6 + 0.5) | 0;
      const nH = (170 * D.SY * 0.6 + 0.5) | 0;
      const centerX = (oX1 + oX2) * 0.5;
      cachedColorRect = {
        x1: (centerX - nW * 0.5 + 0.5) | 0,
        y1: oY1,
        w: nW,
        h: nH
      };
    }
    return cachedColorRect;
  };

  // Clear cache when config reloads
  SP.clearColorTransformCache = function() {
    cachedEdgeBounds = null;
    cachedColorRect = null;
  };

  // Cache detection thresholds
  const ORIG_YG_GREEN_MIN = 70;
  const ORIG_YG_GREEN_BLUE_RATIO = 1.3;

  // Grayscale conversion coefficients (ITU-R BT.709)
  const GRAY_R = 0.299;
  const GRAY_G = 0.587;
  const GRAY_B = 0.114;

  // Alternate grayscale coefficients (ITU-R BT.2020)
  const GRAY_R2 = 0.2126;
  const GRAY_G2 = 0.7152;
  const GRAY_B2 = 0.0722;

  function processPixel(cfg, oR, oG, oB, r, g, b, edge, skipYellow) {
    const origBlue = isBlue(cfg, oR, oG, oB);

    const origRed = oR > cfg.ORIGRED_DETECTION.MIN_RED &&
      oR > oG * cfg.ORIGRED_DETECTION.RED_TO_GREEN &&
      oR > oB * cfg.ORIGRED_DETECTION.RED_TO_BLUE;

    const origYG = oG > ORIG_YG_GREEN_MIN && oG > oB * ORIG_YG_GREEN_BLUE_RATIO;
    // Avoid pulling strong greens toward the yellow target.
    const strongGreen = oG > oR * 1.3 && oG > oB * 1.6;

    const minRG = oR < oG ? oR : oG;
    const rgDiff = Math.abs(oR - oG);
    const rgClose = rgDiff < Math.min(cfg.YELLOW_DETECTION.RG_DIFF_MAX, 24);
    let isY = oR > cfg.YELLOW_DETECTION.MIN_RED &&
      oG > cfg.YELLOW_DETECTION.MIN_GREEN &&
      rgClose &&
      oG > oR * cfg.YELLOW_DETECTION.GREEN_TO_RED_MIN &&
      oB < minRG * cfg.YELLOW_DETECTION.BLUE_RATIO_MAX;
    if (strongGreen && isY) isY = false;

    const mx = oR > oG ? (oR > oB ? oR : oB) : (oG > oB ? oG : oB);
    const mn = oR < oG ? (oR < oB ? oR : oB) : (oG < oB ? oG : oB);
    const sat = mx ? (mx - mn) / mx : 0;
    const isYStrong = isY && sat > 0.3 && minRG > 120;
    const redEdge = !origBlue && !isYStrong &&
      r > 200 && r - g > 60 && r - b > 60;

    const origYellow = !skipYellow && edge && isYStrong;
    if (origYellow) return (255 << 16) | (222 << 8) | 0;

    if (!origBlue) {
      const minRGB = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (b > minRGB) b = minRGB;

      let maxRGB = r > g ? (r > b ? r : b) : (g > b ? g : b);

      if (maxRGB < cfg.DARK_PROCESSING.THRESHOLD_1) {
        const dk = 1 - maxRGB / cfg.DARK_PROCESSING.THRESHOLD_1;
        const n = r < g ? (r < b ? r : b) : (g < b ? g : b);
        const dkQuarter = dk * 0.25;
        r -= (r - n) * dk;
        g -= (g - n) * dk;
        b -= (b - n) * dk;
        r *= 1 - dkQuarter;
        g *= 1 - dkQuarter;
        b *= 1 - dkQuarter;
        maxRGB = r > g ? (r > b ? r : b) : (g > b ? g : b);
      }

      if (maxRGB < cfg.DARK_PROCESSING.THRESHOLD_2) {
        const n = r < g ? (r < b ? r : b) : (g < b ? g : b);
        const factor = 1 - (1 - maxRGB / cfg.DARK_PROCESSING.THRESHOLD_2) * 0.35;
        r = g = b = n * factor;
        maxRGB = r;
      }

      if (maxRGB < cfg.DARK_PROCESSING.THRESHOLD_3) {
        const n = r < g ? (r < b ? r : b) : (g < b ? g : b);
        const v = n * maxRGB / cfg.DARK_PROCESSING.THRESHOLD_3 * 0.6;
        r = g = b = v;
      }
    }

    r = U.clamp(r); g = U.clamp(g); b = U.clamp(b);

    const skip = edge;

    if (!skip && !redEdge) {
      const mn = Math.min(r, g, b);
      const rng = Math.max(r, g, b) - mn;
      let ws = 0;
      const WT = cfg.WHITE_THRESHOLD;

      if (mn > WT.LEVEL_1.MIN && rng < WT.LEVEL_1.RANGE) {
        ws = (mn - WT.LEVEL_1.MIN) / 135 * (1 - rng / WT.LEVEL_1.RANGE) * WT.LEVEL_1.STRENGTH;
      }
      if (mn > WT.LEVEL_2.MIN && rng < WT.LEVEL_2.RANGE) ws = Math.max(ws, WT.LEVEL_2.STRENGTH);
      if (mn > WT.LEVEL_3.MIN && rng < WT.LEVEL_3.RANGE) ws = Math.max(ws, WT.LEVEL_3.STRENGTH);
      if (mn > WT.LEVEL_4.MIN && rng < WT.LEVEL_4.RANGE) ws = Math.max(ws, WT.LEVEL_4.STRENGTH);
      if (mn > WT.LEVEL_5.MIN && rng < WT.LEVEL_5.RANGE) ws = Math.max(ws, WT.LEVEL_5.STRENGTH);
      if (mn > WT.LEVEL_6.MIN && rng < WT.LEVEL_6.RANGE) ws = WT.LEVEL_6.STRENGTH;

      if (ws > 0) {
        const bl = ws * ws * (3 - 2 * ws);
        r += (255 - r) * bl;
        g += (255 - g) * bl;
        b += (255 - b) * bl;
      }
    }

    const wasY = !skipYellow && !origRed && !origBlue && isYStrong;
    const isR = r > 120 && r > g * 1.3 && r > b;
    const isRSoft = redEdge && r > g && r > b;

    if (isR || origRed || isRSoft) {
      if (b > g * 0.7) b -= (b - g * 0.5) * 0.85;
      const gr = r * GRAY_R + g * GRAY_G + b * GRAY_B;
      const ds = cfg.DESATURATION.RED_STRENGTH;
      const grDiffR = (gr - r) * ds;
      const grDiffG = (gr - g) * ds;
      const grDiffB = (gr - b) * ds;
      r += grDiffR; g += grDiffG; b += grDiffB;
    }

    if (origBlue) {
      const gr = r * GRAY_R + g * GRAY_G + b * GRAY_B;
      const ds = cfg.DESATURATION.BLUE_STRENGTH;
      const grDiffR = (gr - r) * ds;
      const grDiffG = (gr - g) * ds;
      const grDiffB = (gr - b) * ds;
      r += grDiffR; g += grDiffG; b += grDiffB;
      const maxRG = r > g ? r : g;
      if (maxRG < 180 && b - maxRG < 25) {
        const newB = maxRG + 35;
        b = newB < 255 ? newB : 255;
      }
    }

    if (!origBlue && !origRed && !origYG && !wasY && !isR && !isRSoft) {
      const gr = r * GRAY_R + g * GRAY_G + b * GRAY_B;
      const ds = cfg.DESATURATION.NEUTRAL_STRENGTH;
      const grDiffR = (gr - r) * ds;
      const grDiffG = (gr - g) * ds;
      const grDiffB = (gr - b) * ds;
      r += grDiffR; g += grDiffG; b += grDiffB;
    }

    if (!origBlue) {
      const fm = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (b > mn) b = mn;
      if (fm < 150) {
        const bl = 1 - fm / 150;
        const rDiff = (r - mn) * bl;
        const gDiff = (g - mn) * bl;
        const bDiff = (b - mn) * bl;
        r -= rDiff;
        g -= gDiff;
        b -= bDiff;
      }
      if (fm < 90) {
        const minVal = (r < g ? (r < b ? r : b) : (g < b ? g : b)) * 0.8;
        r = g = b = minVal;
      }
    }

    if (!skip && !redEdge) {
      const WT = cfg.WHITE_THRESHOLD;
      const fmn = Math.min(r, g, b);
      const frg = Math.max(r, g, b) - fmn;

      if (fmn > 245) {
        r = g = b = 255;
      } else if (fmn > WT.FINAL_MIN && frg < WT.FINAL_RANGE) {
        const sn = (fmn - WT.FINAL_MIN) / 25;
        r += (255 - r) * sn; g += (255 - g) * sn; b += (255 - b) * sn;
        if (Math.min(r, g, b) > 250) r = g = b = 255;
      }
    }

    if (wasY && !origYellow) {
      const TYR = cfg.TARGET_YELLOW.R, TYG = cfg.TARGET_YELLOW.G, TYB = cfg.TARGET_YELLOW.B;
      r = TYR; g = TYG; b = TYB;
    }

    const rr = (U.clamp(r) + 0.5) | 0;
    const gg = (U.clamp(g) + 0.5) | 0;
    const bb = (U.clamp(b) + 0.5) | 0;
    return (rr << 16) | (gg << 8) | bb;
  }

  SP.applyColorAsync = async function applyColorAsync(src, T, progress) {
    const cfg = SP.Config;
    const [rR, rG, rB] = T;
    const c = src.getContext("2d", { willReadFrequently: true });
    const id = c.getImageData(0, 0, src.width, src.height);
    const d = id.data;
    const w = src.width;
    const h = src.height;
    const { sx, sy, sw, sh, em } = edgeBounds();
    const { x1: crx, y1: cry, w: crw, h: crh } = colorRectBounds();
    const dotColors = getDotColors();
    const crx2 = crx + crw;
    const cry2 = cry + crh;

    const rR0 = rR[0], rR1 = rR[1], rR2 = rR[2], rR3 = rR[3];
    const rG0 = rG[0], rG1 = rG[1], rG2 = rG[2], rG3 = rG[3];
    const rB0 = rB[0], rB1 = rB[1], rB2 = rB[2], rB3 = rB[3];
    const sxPlusSw = sx + sw;
    const syPlusSh = sy + sh;

    for (let y = 0, idx = 0; y < h; y++) {
      const inY = y >= sy && y < syPlusSh;
      const yMinusSy = y - sy;
      const edgeY = inY && (yMinusSy < em || (syPlusSh - y) < em);
      const inColorRow = y >= cry && y < cry2;

      for (let x = 0; x < w; x++, idx += 4) {
        const oR = d[idx], oG = d[idx + 1], oB = d[idx + 2];

        let r = rR0 * oR + rR1 * oG + rR2 * oB + rR3;
        let g = rG0 * oR + rG1 * oG + rG2 * oB + rG3;
        let b = rB0 * oR + rB1 * oG + rB2 * oB + rB3;

        let edge = false;
        if (inY && x >= sx && x < sxPlusSw) {
          const dl = x - sx;
          const dr = sxPlusSw - x;
          edge = edgeY || dl < em || dr < em;
        }

        const inColorRect = inColorRow && x >= crx && x < crx2;
        const skipYellow = inColorRect && isDotColor(oR, oG, oB, dotColors);
        const p = processPixel(cfg, oR, oG, oB, r, g, b, edge, skipYellow);
        d[idx] = p >>> 16;
        d[idx + 1] = (p >>> 8) & 255;
        d[idx + 2] = p & 255;
      }

      if ((y & 15) === 0) {
        if (progress) progress(y, h);
        await U.next();
      }
    }

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d", { willReadFrequently: true }).putImageData(id, 0, 0);
    return out;
  };

  SP.applyBalanceAsync = async function applyBalanceAsync(cvs, progress) {
    const cfg = SP.Config;
    const c = cvs.getContext("2d", { willReadFrequently: true });
    const id = c.getImageData(0, 0, cvs.width, cvs.height);
    const d = id.data;
    const w = cvs.width;
    const h = cvs.height;
    const { sx, sy, sw, sh, em } = edgeBounds();
    const { x1: crx, y1: cry, w: crw, h: crh } = colorRectBounds();
    const dotColors = getDotColors();
    const crx2 = crx + crw;
    const cry2 = cry + crh;

    const step = Math.max(1, ((d.length / 4 / 50000) | 0));
    const rv = [], gv = [], bv = [];
    for (let i = 0; i < d.length; i += 4 * step) { rv.push(d[i]); gv.push(d[i + 1]); bv.push(d[i + 2]); }

    const pct = (a, p) => a.slice().sort((x, y) => x - y)[(a.length * p) | 0];

    const p98R = pct(rv, 0.98), p98G = pct(gv, 0.98), p98B = pct(bv, 0.98);
    const p02R = pct(rv, 0.02), p02G = pct(gv, 0.02), p02B = pct(bv, 0.02);

    const rnR = Math.max(1, p98R - p02R);
    const rnG = Math.max(1, p98G - p02G);
    const rnB = Math.max(1, p98B - p02B);

    const scaleR = 251 / rnR;
    const scaleG = 251 / rnG;
    const scaleB = 251 / rnB;
    const sxPlusSw = sx + sw;
    const syPlusSh = sy + sh;

    for (let y = 0, idx = 0; y < h; y++) {
      const inY = y >= sy && y < syPlusSh;
      const yMinusSy = y - sy;
      const edgeY = inY && (yMinusSy < em || (syPlusSh - y) < em);
      const inColorRow = y >= cry && y < cry2;

      for (let x = 0; x < w; x++, idx += 4) {
        const oR = d[idx], oG = d[idx + 1], oB = d[idx + 2];

        let r = (oR - p02R) * scaleR + 3;
        let g = (oG - p02G) * scaleG + 3;
        let b = (oB - p02B) * scaleB + 3;

        let edge = false;
        if (inY && x >= sx && x < sxPlusSw) {
          const dl = x - sx;
          const dr = sxPlusSw - x;
          edge = edgeY || dl < em || dr < em;
        }

        const inColorRect = inColorRow && x >= crx && x < crx2;
        const skipYellow = inColorRect && isDotColor(oR, oG, oB, dotColors);
        const p = processPixel(cfg, oR, oG, oB, r, g, b, edge, skipYellow);
        d[idx] = p >>> 16;
        d[idx + 1] = (p >>> 8) & 255;
        d[idx + 2] = p & 255;
      }

      if ((y & 15) === 0) {
        if (progress) progress(y, h);
        await U.next();
      }
    }

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d", { willReadFrequently: true }).putImageData(id, 0, 0);
    return out;
  };

  SP.restoreMargins = function restoreMargins(cvs) {
    const ALG = SP.ALG;
    const out = document.createElement("canvas");
    const outW = cvs.width;
    const outH = cvs.height;
    out.width = outW;
    out.height = outH;

    const outCtx = out.getContext("2d", { willReadFrequently: true });
    outCtx.fillStyle = "#fff";
    outCtx.fillRect(0, 0, outW, outH);

    const PX_CM = ALG.CFG.PX_CM;
    const sx = (ALG.CFG.STENCIL.x * PX_CM) | 0;
    const sy = (ALG.CFG.STENCIL.y * PX_CM) | 0;
    const sw = (ALG.CFG.STENCIL.w * PX_CM) | 0;
    const sh = (ALG.CFG.STENCIL.h * PX_CM) | 0;

    const sc = SP.Config.RENDER_SCALE;
    const cW = (sw * sc + 0.5) | 0; // Fast ceil
    const cH = (sh * sc + 0.5) | 0;
    const dX = (sx - (cW - sw) * 0.5) | 0;
    const dY = (sy - (cH - sh) * 0.5) | 0;

    outCtx.drawImage(cvs, sx, sy, sw, sh, dX, dY, cW, cH);

    const m = new U.MM();
    try {
      const s = m.t(cv.imread(out));
      const bl = m.t(new cv.Mat());
      const sh2 = m.t(new cv.Mat());

      cv.GaussianBlur(s, bl, new cv.Size(3, 3), 0);
      cv.addWeighted(s, 1.6, bl, -0.6, 0, sh2);

      return U.mat2C(sh2);
    } catch (e) {
      return out;
    } finally {
      m.d();
    }
  };
})();
