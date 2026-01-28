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

  // Flatten config for hot pixel loops.
  const buildFastConfig = cfg => ({
    BLUE_MIN_DIFF: cfg.BLUE_DETECTION.MIN_DIFF,
    BLUE_MIN_BLUE: cfg.BLUE_DETECTION.MIN_BLUE,
    BLUE_RATIO: cfg.BLUE_DETECTION.RATIO,
    ORIGRED_MIN_RED: cfg.ORIGRED_DETECTION.MIN_RED,
    ORIGRED_RED_TO_GREEN: cfg.ORIGRED_DETECTION.RED_TO_GREEN,
    ORIGRED_RED_TO_BLUE: cfg.ORIGRED_DETECTION.RED_TO_BLUE,
    YELLOW_MIN_RED: cfg.YELLOW_DETECTION.MIN_RED,
    YELLOW_MIN_GREEN: cfg.YELLOW_DETECTION.MIN_GREEN,
    YELLOW_RG_DIFF_MAX: Math.min(cfg.YELLOW_DETECTION.RG_DIFF_MAX, 24),
    YELLOW_GREEN_TO_RED_MIN: cfg.YELLOW_DETECTION.GREEN_TO_RED_MIN,
    YELLOW_BLUE_RATIO_MAX: cfg.YELLOW_DETECTION.BLUE_RATIO_MAX,
    DARK_T1: cfg.DARK_PROCESSING.THRESHOLD_1,
    DARK_T2: cfg.DARK_PROCESSING.THRESHOLD_2,
    DARK_T3: cfg.DARK_PROCESSING.THRESHOLD_3,
    WHITE_THRESHOLD: cfg.WHITE_THRESHOLD,
    DESATURATION: cfg.DESATURATION,
    TARGET_YELLOW: cfg.TARGET_YELLOW,
    TARGET_RED_R: cfg.CALIBRATION_TARGETS.red[0],
    TARGET_RED_G: cfg.CALIBRATION_TARGETS.red[1],
    TARGET_RED_B: cfg.CALIBRATION_TARGETS.red[2],
    TARGET_BLUE_R: cfg.CALIBRATION_TARGETS.blue[0],
    TARGET_BLUE_G: cfg.CALIBRATION_TARGETS.blue[1],
    TARGET_BLUE_B: cfg.CALIBRATION_TARGETS.blue[2],
    CONTRAST_TARGET_RANGE: cfg.CONTRAST_TARGET_RANGE,
    CONTRAST_MIN_SCALE: cfg.CONTRAST_MIN_SCALE,
    EXPOSURE_TARGET_MID: cfg.EXPOSURE_TARGET_MID,
    EXPOSURE_TARGET_LOW: cfg.EXPOSURE_TARGET_LOW,
    EXPOSURE_TARGET_HIGH: cfg.EXPOSURE_TARGET_HIGH,
    EXPOSURE_MAX_GAIN: cfg.EXPOSURE_MAX_GAIN
  });

  const PURIFY_SAT_MIN = 0.24;
  const PURIFY_LUMA_MIN = 70;
  const PURIFY_RED_GAP = 38;
  const PURIFY_BLUE_GAP = 26;

  // Percentile from histogram to avoid sort allocations.
  const pctFromHist = (hist, total, p) => {
    const target = (total * p) | 0;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
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
    const WT = cfg.WHITE_THRESHOLD;
    const DS = cfg.DESATURATION;
    const TY = cfg.TARGET_YELLOW;

    const mxRG = oR > oG ? oR : oG;
    const mxClamped = mxRG > 1 ? mxRG : 1;
    const origBlue = oB - mxRG >= cfg.BLUE_MIN_DIFF &&
      oB >= cfg.BLUE_MIN_BLUE &&
      oB / mxClamped >= cfg.BLUE_RATIO;

    const origRed = oR > cfg.ORIGRED_MIN_RED &&
      oR > oG * cfg.ORIGRED_RED_TO_GREEN &&
      oR > oB * cfg.ORIGRED_RED_TO_BLUE;

    const origYG = oG > ORIG_YG_GREEN_MIN && oG > oB * ORIG_YG_GREEN_BLUE_RATIO;
    // Avoid pulling greens toward the yellow target.
    const strongGreen = oG > oR * 1.3 && oG > oB * 1.6;
    const greenProtect = oG > 80 && oG > oR * 1.15 && oG > oB * 1.25 &&
      (oG - oR) > 18 && (oG - oB) > 18;
    const blueMinBlue = Math.max(24, cfg.BLUE_MIN_BLUE - 10);
    const blueMinDiff = Math.max(4, cfg.BLUE_MIN_DIFF - 6);
    const blueRatio = Math.max(1.05, cfg.BLUE_RATIO - 0.12);
    const blueLike = !origRed && !strongGreen &&
      oB >= blueMinBlue &&
      (oB - mxRG) >= blueMinDiff &&
      oB / mxClamped >= blueRatio;
    const blueSoft = !origRed && !strongGreen &&
      oB >= 40 && (oB - oR) > 12 && (oB - oG) > 12;
    const origBlueish = origBlue || blueLike || blueSoft;

    const minRG = oR < oG ? oR : oG;
    const rgDiff = Math.abs(oR - oG);
    const rgClose = rgDiff < cfg.YELLOW_RG_DIFF_MAX;
    let isY = oR > cfg.YELLOW_MIN_RED &&
      oG > cfg.YELLOW_MIN_GREEN &&
      rgClose &&
      oG > oR * cfg.YELLOW_GREEN_TO_RED_MIN &&
      oB < minRG * cfg.YELLOW_BLUE_RATIO_MAX;
    if ((strongGreen || greenProtect) && isY) isY = false;

    const mx = oR > oG ? (oR > oB ? oR : oB) : (oG > oB ? oG : oB);
    const mn = oR < oG ? (oR < oB ? oR : oB) : (oG < oB ? oG : oB);
    const sat = mx ? (mx - mn) / mx : 0;
    const isYStrong = isY && sat > 0.3 && minRG > 120;
    const yellowLike = !strongGreen && !greenProtect &&
      minRG > 110 &&
      rgDiff < Math.min(cfg.YELLOW_RG_DIFF_MAX + 6, 30) &&
      oR > (cfg.YELLOW_MIN_RED - 5) &&
      oG > (cfg.YELLOW_MIN_GREEN - 5) &&
      oB < minRG * (cfg.YELLOW_BLUE_RATIO_MAX + 0.08);
    const redEdge = origRed && !origBlue && !isYStrong &&
      r > 200 && r - g > 60 && r - b > 60;

    const origYellow = !skipYellow && edge && isYStrong;
    if (origYellow) return (255 << 16) | (222 << 8) | 0;

    if (!origBlueish) {
      const minRGB = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (b > minRGB) b = minRGB;

      let maxRGB = r > g ? (r > b ? r : b) : (g > b ? g : b);

      if (maxRGB < cfg.DARK_T1) {
        const dk = 1 - maxRGB / cfg.DARK_T1;
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

      if (maxRGB < cfg.DARK_T2) {
        const n = r < g ? (r < b ? r : b) : (g < b ? g : b);
        const factor = 1 - (1 - maxRGB / cfg.DARK_T2) * 0.35;
        r = g = b = n * factor;
        maxRGB = r;
      }

      if (maxRGB < cfg.DARK_T3) {
        const n = r < g ? (r < b ? r : b) : (g < b ? g : b);
        const v = n * maxRGB / cfg.DARK_T3 * 0.6;
        r = g = b = v;
      }
    }

    r = U.clamp(r); g = U.clamp(g); b = U.clamp(b);

    const skip = edge;

    if (!skip && !redEdge) {
      const mn = Math.min(r, g, b);
      const rng = Math.max(r, g, b) - mn;
      let ws = 0;

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

    const wasY = !skipYellow && !origRed && !origBlueish && !greenProtect &&
      (isYStrong || yellowLike);
    if (wasY) {
      r = TY.R; g = TY.G; b = TY.B;
    }

    const origRedish = origRed || (oR > oG * 1.1 && oR > oB * 1.1);
    const isR = origRedish && r > 120 && r > g * 1.3 && r > b;
    const isRSoft = redEdge && r > g && r > b;

    if (isR || origRed || isRSoft) {
      if (b > g * 0.7) b -= (b - g * 0.5) * 0.85;
      const gr = r * GRAY_R + g * GRAY_G + b * GRAY_B;
      const ds = DS.RED_STRENGTH;
      const grDiffR = (gr - r) * ds;
      const grDiffG = (gr - g) * ds;
      const grDiffB = (gr - b) * ds;
      r += grDiffR; g += grDiffG; b += grDiffB;
    }

    if (origBlueish) {
      const gr = r * GRAY_R + g * GRAY_G + b * GRAY_B;
      const ds = DS.BLUE_STRENGTH;
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

    if (!origBlueish && !origRed && !origYG && !wasY && !isR && !isRSoft) {
      const gr = r * GRAY_R + g * GRAY_G + b * GRAY_B;
      const ds = DS.NEUTRAL_STRENGTH;
      const grDiffR = (gr - r) * ds;
      const grDiffG = (gr - g) * ds;
      const grDiffB = (gr - b) * ds;
      r += grDiffR; g += grDiffG; b += grDiffB;
    }

    if (!origBlueish) {
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

    if (!skip && !redEdge && !origBlueish && !origRed && !origYG && !wasY && !isR && !isRSoft) {
      const maxNow = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const minNow = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const rangeNow = maxNow - minNow;
      const satNow = maxNow ? rangeNow / maxNow : 0;
      const lumaNow = r * GRAY_R + g * GRAY_G + b * GRAY_B;
      if (satNow < 0.14 && lumaNow > 135 && rangeNow < 38) {
        const t = Math.min(1, (lumaNow - 135) / 80);
        const s = Math.min(1, (0.14 - satNow) / 0.14);
        const w = t * s;
        const boost = 0.3 + 0.5 * w;
        r += (255 - r) * boost;
        g += (255 - g) * boost;
        b += (255 - b) * boost;
      }
    }

    if (wasY && !origYellow) {
      const TYR = TY.R, TYG = TY.G, TYB = TY.B;
      r = TYR; g = TYG; b = TYB;
    }

    const yellowCleanup = !skipYellow && !origRed && !origBlueish && !strongGreen && !greenProtect &&
      r > 170 && g > 150 && Math.abs(r - g) < 50 &&
      b < Math.min(r, g) * 0.75 &&
      oB < minRG * (cfg.YELLOW_BLUE_RATIO_MAX + 0.12);
    if (yellowCleanup) {
      r = TY.R; g = TY.G; b = TY.B;
    }

    const oMax = oR > oG ? (oR > oB ? oR : oB) : (oG > oB ? oG : oB);
    const oMin = oR < oG ? (oR < oB ? oR : oB) : (oG < oB ? oG : oB);
    const satOrig = oMax ? (oMax - oMin) / oMax : 0;

    if (satOrig > PURIFY_SAT_MIN && oMax > PURIFY_LUMA_MIN) {
      if (isYStrong) {
        r = TY.R; g = TY.G; b = TY.B;
      } else {
        const redSnap = origRed && !isYStrong && !isY && !yellowLike &&
          (oR - oG) > PURIFY_RED_GAP && (oR - oB) > PURIFY_RED_GAP &&
          oR > oG * 1.6 && oR > oB * 1.35;
        const blueSnap = origBlueish &&
          (oB - oR) > PURIFY_BLUE_GAP && (oB - oG) > PURIFY_BLUE_GAP;
        if (redSnap) {
          r = cfg.TARGET_RED_R; g = cfg.TARGET_RED_G; b = cfg.TARGET_RED_B;
        } else if (blueSnap) {
          r = cfg.TARGET_BLUE_R; g = cfg.TARGET_BLUE_G; b = cfg.TARGET_BLUE_B;
        }
      }
    }

    const rr = (U.clamp(r) + 0.5) | 0;
    const gg = (U.clamp(g) + 0.5) | 0;
    const bb = (U.clamp(b) + 0.5) | 0;
    return (rr << 16) | (gg << 8) | bb;
  }

  const floatsToCanvas = (rArr, gArr, bArr, w, h) => {
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d", { willReadFrequently: true });
    const id = ctx.createImageData(w, h);
    const d = id.data;
    const len = rArr.length;
    for (let i = 0, j = 0; i < len; i++, j += 4) {
      d[j] = (U.clamp(rArr[i]) + 0.5) | 0;
      d[j + 1] = (U.clamp(gArr[i]) + 0.5) | 0;
      d[j + 2] = (U.clamp(bArr[i]) + 0.5) | 0;
      d[j + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return out;
  };

  const applyMatrixPass = async (src, T) => {
    const c = src.getContext("2d", { willReadFrequently: true });
    const w = src.width;
    const h = src.height;
    const id = c.getImageData(0, 0, w, h);
    const d = id.data;
    const total = w * h;
    const rArr = new Float32Array(total);
    const gArr = new Float32Array(total);
    const bArr = new Float32Array(total);
    const [rR, rG, rB] = T;
    const rR0 = rR[0], rR1 = rR[1], rR2 = rR[2], rR3 = rR[3];
    const rG0 = rG[0], rG1 = rG[1], rG2 = rG[2], rG3 = rG[3];
    const rB0 = rB[0], rB1 = rB[1], rB2 = rB[2], rB3 = rB[3];

    for (let y = 0, p = 0, idx = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p++, idx += 4) {
        const oR = d[idx], oG = d[idx + 1], oB = d[idx + 2];
        rArr[p] = rR0 * oR + rR1 * oG + rR2 * oB + rR3;
        gArr[p] = rG0 * oR + rG1 * oG + rG2 * oB + rG3;
        bArr[p] = rB0 * oR + rB1 * oG + rB2 * oB + rB3;
      }
      if ((y & 15) === 0) await U.next();
    }

    return { rArr, gArr, bArr, w, h, orig: d };
  };

  const applyContrastPass = async (rArr, gArr, bArr, w, h, cfg) => {
    const len = rArr.length;
    const step = Math.max(1, ((len / 50000) | 0));
    const hist = new Uint32Array(256);
    let samples = 0;

    for (let i = 0; i < len; i += step) {
      const l = rArr[i] * GRAY_R + gArr[i] * GRAY_G + bArr[i] * GRAY_B;
      const li = l < 0 ? 0 : l > 255 ? 255 : l | 0;
      hist[li]++;
      samples++;
    }

    const total = samples || 1;
    const p05 = pctFromHist(hist, total, 0.05);
    const p50 = pctFromHist(hist, total, 0.5);
    const p95 = pctFromHist(hist, total, 0.95);
    const range = Math.max(1, p95 - p05);
    const targetRange = cfg.CONTRAST_TARGET_RANGE;
    if (range <= targetRange) return { rArr, gArr, bArr, applied: false };

    const minScale = cfg.CONTRAST_MIN_SCALE;
    const scaleFull = targetRange / range;
    let scale = Math.max(minScale, Math.min(1, scaleFull));
    let offset = p50 - p50 * scale;
    let strength = Math.min(1, (range - targetRange) / 120);
    if (strength < 0.08) return { rArr, gArr, bArr, applied: false };

    scale = 1 + (scale - 1) * strength;
    offset = offset * strength;

    for (let y = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p++) {
        const r0 = rArr[p];
        const g0 = gArr[p];
        const b0 = bArr[p];
        const maxNow = r0 > g0 ? (r0 > b0 ? r0 : b0) : (g0 > b0 ? g0 : b0);
        const minNow = r0 < g0 ? (r0 < b0 ? r0 : b0) : (g0 < b0 ? g0 : b0);
        const satNow = maxNow ? (maxNow - minNow) / maxNow : 0;
        const lumaNow = r0 * GRAY_R + g0 * GRAY_G + b0 * GRAY_B;
        let w = 1;
        if (satNow < 0.18 && lumaNow > 140) {
          const t = Math.min(1, (lumaNow - 140) / 90);
          const s = Math.min(1, (0.18 - satNow) / 0.18);
          w = 1 - 0.75 * s * t;
        }
        const adjR = (r0 * scale + offset - r0) * w;
        const adjG = (g0 * scale + offset - g0) * w;
        const adjB = (b0 * scale + offset - b0) * w;
        rArr[p] = r0 + adjR;
        gArr[p] = g0 + adjG;
        bArr[p] = b0 + adjB;
      }
      if ((y & 15) === 0) await U.next();
    }

    return { rArr, gArr, bArr, applied: true };
  };

  const applyExposurePass = async (rArr, gArr, bArr, w, h, cfg) => {
    const len = rArr.length;
    const step = Math.max(1, ((len / 50000) | 0));
    const hist = new Uint32Array(256);
    let samples = 0;

    for (let i = 0; i < len; i += step) {
      const l = rArr[i] * GRAY_R + gArr[i] * GRAY_G + bArr[i] * GRAY_B;
      const li = l < 0 ? 0 : l > 255 ? 255 : l | 0;
      hist[li]++;
      samples++;
    }

    const total = samples || 1;
    const p02 = pctFromHist(hist, total, 0.02);
    const p50 = pctFromHist(hist, total, 0.5);
    const p98 = pctFromHist(hist, total, 0.98);
    const targetMid = cfg.EXPOSURE_TARGET_MID;
    const targetLow = cfg.EXPOSURE_TARGET_LOW;
    const targetHigh = cfg.EXPOSURE_TARGET_HIGH;
    const needBright = p50 < (targetMid - 15) || p02 < (targetLow - 6);
    const needDark = p50 > (targetMid + 18) && p98 > (targetHigh + 5);

    if (!needBright && !needDark) {
      return { rArr, gArr, bArr, applied: false };
    }

    let scale = 1;
    let offset = 0;
    let strength = 0;

    if (needBright) {
      const gainMid = targetMid / Math.max(1, p50);
      scale = Math.min(cfg.EXPOSURE_MAX_GAIN, Math.max(1.0, gainMid));
      if (p02 < targetLow) offset = Math.min(40, (targetLow - p02) * 0.7);
      strength = Math.min(1, (targetMid - p50) / 80);
      strength = Math.max(0.25, strength);
    } else {
      const gainMid = targetMid / Math.max(1, p50);
      scale = Math.max(0.75, Math.min(1.0, gainMid));
      if (p98 > targetHigh + 5 && p02 > targetLow + 5) {
        offset = -Math.min(25, (p98 - targetHigh) * 0.25);
      }
      strength = Math.min(0.6, (p50 - targetMid) / 80);
      if (strength < 0.12) return { rArr, gArr, bArr, applied: false };
    }

    if (strength < 0.08) return { rArr, gArr, bArr, applied: false };

    scale = 1 + (scale - 1) * strength;
    offset = offset * strength;

    if (!needBright) {
      const predictedMid = p50 * scale + offset;
      if (predictedMid < (targetMid - 20)) return { rArr, gArr, bArr, applied: false };
    }

    for (let y = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p++) {
        const r0 = rArr[p];
        const g0 = gArr[p];
        const b0 = bArr[p];
        const maxNow = r0 > g0 ? (r0 > b0 ? r0 : b0) : (g0 > b0 ? g0 : b0);
        const minNow = r0 < g0 ? (r0 < b0 ? r0 : b0) : (g0 < b0 ? g0 : b0);
        const satNow = maxNow ? (maxNow - minNow) / maxNow : 0;
        const lumaNow = r0 * GRAY_R + g0 * GRAY_G + b0 * GRAY_B;
        let w = 1;
        if (satNow < 0.18 && lumaNow > 140) {
          const t = Math.min(1, (lumaNow - 140) / 90);
          const s = Math.min(1, (0.18 - satNow) / 0.18);
          w = 1 - 0.7 * s * t;
        }
        const adjR = (r0 * scale + offset - r0) * w;
        const adjG = (g0 * scale + offset - g0) * w;
        const adjB = (b0 * scale + offset - b0) * w;
        rArr[p] = r0 + adjR;
        gArr[p] = g0 + adjG;
        bArr[p] = b0 + adjB;
      }
      if ((y & 15) === 0) await U.next();
    }

    return { rArr, gArr, bArr, applied: true };
  };

  const applyTonePass = async (orig, rIn, gIn, bIn, w, h, cfg) => {
    const { sx, sy, sw, sh, em } = edgeBounds();
    const sxPlusSw = sx + sw;
    const syPlusSh = sy + sh;
    const outR = new Float32Array(rIn.length);
    const outG = new Float32Array(gIn.length);
    const outB = new Float32Array(bIn.length);
    const WT = cfg.WHITE_THRESHOLD;

    for (let y = 0, p = 0, idx = 0; y < h; y++) {
      const inY = y >= sy && y < syPlusSh;
      const yMinusSy = y - sy;
      const edgeY = inY && (yMinusSy < em || (syPlusSh - y) < em);

      for (let x = 0; x < w; x++, p++, idx += 4) {
        const oR = orig[idx], oG = orig[idx + 1], oB = orig[idx + 2];
        let r = rIn[p], g = gIn[p], b = bIn[p];

        const mxRG = oR > oG ? oR : oG;
        const mxClamped = mxRG > 1 ? mxRG : 1;
        const origBlue = oB - mxRG >= cfg.BLUE_MIN_DIFF &&
          oB >= cfg.BLUE_MIN_BLUE &&
          oB / mxClamped >= cfg.BLUE_RATIO;
        const origRed = oR > cfg.ORIGRED_MIN_RED &&
          oR > oG * cfg.ORIGRED_RED_TO_GREEN &&
          oR > oB * cfg.ORIGRED_RED_TO_BLUE;

        const strongGreen = oG > oR * 1.3 && oG > oB * 1.6;
        const greenProtect = oG > 80 && oG > oR * 1.15 && oG > oB * 1.25 &&
          (oG - oR) > 18 && (oG - oB) > 18;
        const blueMinBlue = Math.max(24, cfg.BLUE_MIN_BLUE - 10);
        const blueMinDiff = Math.max(4, cfg.BLUE_MIN_DIFF - 6);
        const blueRatio = Math.max(1.05, cfg.BLUE_RATIO - 0.12);
        const blueLike = !origRed && !strongGreen &&
          oB >= blueMinBlue &&
          (oB - mxRG) >= blueMinDiff &&
          oB / mxClamped >= blueRatio;
        const blueSoft = !origRed && !strongGreen &&
          oB >= 40 && (oB - oR) > 12 && (oB - oG) > 12;
        const origBlueish = origBlue || blueLike || blueSoft;
        const minRG = oR < oG ? oR : oG;
        const rgDiff = Math.abs(oR - oG);
        const rgClose = rgDiff < cfg.YELLOW_RG_DIFF_MAX;
        let isY = oR > cfg.YELLOW_MIN_RED &&
          oG > cfg.YELLOW_MIN_GREEN &&
          rgClose &&
          oG > oR * cfg.YELLOW_GREEN_TO_RED_MIN &&
          oB < minRG * cfg.YELLOW_BLUE_RATIO_MAX;
        if ((strongGreen || greenProtect) && isY) isY = false;

        const mx = oR > oG ? (oR > oB ? oR : oB) : (oG > oB ? oG : oB);
        const mn = oR < oG ? (oR < oB ? oR : oB) : (oG < oB ? oG : oB);
        const sat = mx ? (mx - mn) / mx : 0;
        const isYStrong = isY && sat > 0.3 && minRG > 120;
        const redEdge = origRed && !origBlue && !isYStrong &&
          r > 200 && r - g > 60 && r - b > 60;

        if (!origBlueish) {
          const minRGB = r < g ? (r < b ? r : b) : (g < b ? g : b);
          if (b > minRGB) b = minRGB;

          let maxRGB = r > g ? (r > b ? r : b) : (g > b ? g : b);

          if (maxRGB < cfg.DARK_T1) {
            const dk = 1 - maxRGB / cfg.DARK_T1;
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

          if (maxRGB < cfg.DARK_T2) {
            const n = r < g ? (r < b ? r : b) : (g < b ? g : b);
            const factor = 1 - (1 - maxRGB / cfg.DARK_T2) * 0.35;
            r = g = b = n * factor;
            maxRGB = r;
          }

          if (maxRGB < cfg.DARK_T3) {
            const n = r < g ? (r < b ? r : b) : (g < b ? g : b);
            const v = n * maxRGB / cfg.DARK_T3 * 0.6;
            r = g = b = v;
          }
        }

        r = U.clamp(r); g = U.clamp(g); b = U.clamp(b);

        let edge = false;
        if (inY && x >= sx && x < sxPlusSw) {
          const dl = x - sx;
          const dr = sxPlusSw - x;
          edge = edgeY || dl < em || dr < em;
        }

        if (!edge && !redEdge) {
          const mn2 = Math.min(r, g, b);
          const rng = Math.max(r, g, b) - mn2;
          let ws = 0;

          if (mn2 > WT.LEVEL_1.MIN && rng < WT.LEVEL_1.RANGE) {
            ws = (mn2 - WT.LEVEL_1.MIN) / 135 * (1 - rng / WT.LEVEL_1.RANGE) * WT.LEVEL_1.STRENGTH;
          }
          if (mn2 > WT.LEVEL_2.MIN && rng < WT.LEVEL_2.RANGE) ws = Math.max(ws, WT.LEVEL_2.STRENGTH);
          if (mn2 > WT.LEVEL_3.MIN && rng < WT.LEVEL_3.RANGE) ws = Math.max(ws, WT.LEVEL_3.STRENGTH);
          if (mn2 > WT.LEVEL_4.MIN && rng < WT.LEVEL_4.RANGE) ws = Math.max(ws, WT.LEVEL_4.STRENGTH);
          if (mn2 > WT.LEVEL_5.MIN && rng < WT.LEVEL_5.RANGE) ws = Math.max(ws, WT.LEVEL_5.STRENGTH);
          if (mn2 > WT.LEVEL_6.MIN && rng < WT.LEVEL_6.RANGE) ws = WT.LEVEL_6.STRENGTH;

          if (ws > 0) {
            const bl = ws * ws * (3 - 2 * ws);
            r += (255 - r) * bl;
            g += (255 - g) * bl;
            b += (255 - b) * bl;
          }
        }

        outR[p] = r;
        outG[p] = g;
        outB[p] = b;
      }

      if ((y & 15) === 0) await U.next();
    }

    return { rArr: outR, gArr: outG, bArr: outB };
  };

  const applyColorPass = async (orig, rIn, gIn, bIn, w, h, cfg) => {
    const { sx, sy, sw, sh, em } = edgeBounds();
    const { x1: crx, y1: cry, w: crw, h: crh } = colorRectBounds();
    const dotColors = getDotColors();
    const crx2 = crx + crw;
    const cry2 = cry + crh;
    const sxPlusSw = sx + sw;
    const syPlusSh = sy + sh;
    const outR = new Float32Array(rIn.length);
    const outG = new Float32Array(gIn.length);
    const outB = new Float32Array(bIn.length);
    const WT = cfg.WHITE_THRESHOLD;
    const DS = cfg.DESATURATION;
    const TY = cfg.TARGET_YELLOW;

    for (let y = 0, p = 0, idx = 0; y < h; y++) {
      const inY = y >= sy && y < syPlusSh;
      const yMinusSy = y - sy;
      const edgeY = inY && (yMinusSy < em || (syPlusSh - y) < em);
      const inColorRow = y >= cry && y < cry2;

      for (let x = 0; x < w; x++, p++, idx += 4) {
        const oR = orig[idx], oG = orig[idx + 1], oB = orig[idx + 2];
        let r = rIn[p], g = gIn[p], b = bIn[p];

        const mxRG = oR > oG ? oR : oG;
        const mxClamped = mxRG > 1 ? mxRG : 1;
        const origBlue = oB - mxRG >= cfg.BLUE_MIN_DIFF &&
          oB >= cfg.BLUE_MIN_BLUE &&
          oB / mxClamped >= cfg.BLUE_RATIO;

        const origRed = oR > cfg.ORIGRED_MIN_RED &&
          oR > oG * cfg.ORIGRED_RED_TO_GREEN &&
          oR > oB * cfg.ORIGRED_RED_TO_BLUE;

        const origYG = oG > ORIG_YG_GREEN_MIN && oG > oB * ORIG_YG_GREEN_BLUE_RATIO;
        const strongGreen = oG > oR * 1.3 && oG > oB * 1.6;
        const greenProtect = oG > 80 && oG > oR * 1.15 && oG > oB * 1.25 &&
          (oG - oR) > 18 && (oG - oB) > 18;
        const blueMinBlue = Math.max(24, cfg.BLUE_MIN_BLUE - 10);
        const blueMinDiff = Math.max(4, cfg.BLUE_MIN_DIFF - 6);
        const blueRatio = Math.max(1.05, cfg.BLUE_RATIO - 0.12);
        const blueLike = !origRed && !strongGreen &&
          oB >= blueMinBlue &&
          (oB - mxRG) >= blueMinDiff &&
          oB / mxClamped >= blueRatio;
        const blueSoft = !origRed && !strongGreen &&
          oB >= 40 && (oB - oR) > 12 && (oB - oG) > 12;
        const origBlueish = origBlue || blueLike || blueSoft;

        const minRG = oR < oG ? oR : oG;
        const rgDiff = Math.abs(oR - oG);
        const rgClose = rgDiff < cfg.YELLOW_RG_DIFF_MAX;
        let isY = oR > cfg.YELLOW_MIN_RED &&
          oG > cfg.YELLOW_MIN_GREEN &&
          rgClose &&
          oG > oR * cfg.YELLOW_GREEN_TO_RED_MIN &&
          oB < minRG * cfg.YELLOW_BLUE_RATIO_MAX;
        if ((strongGreen || greenProtect) && isY) isY = false;

        const mx = oR > oG ? (oR > oB ? oR : oB) : (oG > oB ? oG : oB);
        const mn = oR < oG ? (oR < oB ? oR : oB) : (oG < oB ? oG : oB);
        const sat = mx ? (mx - mn) / mx : 0;
        const isYStrong = isY && sat > 0.3 && minRG > 120;
        const yellowLike = !strongGreen && !greenProtect &&
          minRG > 110 &&
          rgDiff < Math.min(cfg.YELLOW_RG_DIFF_MAX + 6, 30) &&
          oR > (cfg.YELLOW_MIN_RED - 5) &&
          oG > (cfg.YELLOW_MIN_GREEN - 5) &&
          oB < minRG * (cfg.YELLOW_BLUE_RATIO_MAX + 0.08);
        const redEdge = origRed && !origBlue && !isYStrong &&
          r > 200 && r - g > 60 && r - b > 60;

        let edge = false;
        if (inY && x >= sx && x < sxPlusSw) {
          const dl = x - sx;
          const dr = sxPlusSw - x;
          edge = edgeY || dl < em || dr < em;
        }

        const inColorRect = inColorRow && x >= crx && x < crx2;
        const skipYellow = inColorRect && isDotColor(oR, oG, oB, dotColors);

        const origYellow = !skipYellow && edge && isYStrong;
        if (origYellow) {
          outR[p] = TY.R;
          outG[p] = TY.G;
          outB[p] = TY.B;
          continue;
        }

        r = U.clamp(r); g = U.clamp(g); b = U.clamp(b);

        const wasY = !skipYellow && !origRed && !origBlueish && !greenProtect &&
          (isYStrong || yellowLike);
        const origRedish = origRed || (oR > oG * 1.1 && oR > oB * 1.1);
        const isR = origRedish && r > 120 && r > g * 1.3 && r > b;
        const isRSoft = redEdge && r > g && r > b;
        if (wasY) {
          r = TY.R; g = TY.G; b = TY.B;
        }

        if (isR || origRed || isRSoft) {
          if (b > g * 0.7) b -= (b - g * 0.5) * 0.85;
          const gr = r * GRAY_R + g * GRAY_G + b * GRAY_B;
          const ds = DS.RED_STRENGTH;
          const grDiffR = (gr - r) * ds;
          const grDiffG = (gr - g) * ds;
          const grDiffB = (gr - b) * ds;
          r += grDiffR; g += grDiffG; b += grDiffB;
        }

        if (origBlueish) {
          const gr = r * GRAY_R + g * GRAY_G + b * GRAY_B;
          const ds = DS.BLUE_STRENGTH;
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

        if (!origBlueish && !origRed && !origYG && !wasY && !isR && !isRSoft) {
          const gr = r * GRAY_R + g * GRAY_G + b * GRAY_B;
          const ds = DS.NEUTRAL_STRENGTH;
          const grDiffR = (gr - r) * ds;
          const grDiffG = (gr - g) * ds;
          const grDiffB = (gr - b) * ds;
          r += grDiffR; g += grDiffG; b += grDiffB;
        }

        if (!origBlueish) {
          const fm = r > g ? (r > b ? r : b) : (g > b ? g : b);
          const mn2 = r < g ? (r < b ? r : b) : (g < b ? g : b);
          if (b > mn2) b = mn2;
          if (fm < 150) {
            const bl = 1 - fm / 150;
            const rDiff = (r - mn2) * bl;
            const gDiff = (g - mn2) * bl;
            const bDiff = (b - mn2) * bl;
            r -= rDiff;
            g -= gDiff;
            b -= bDiff;
          }
          if (fm < 90) {
            const minVal = (r < g ? (r < b ? r : b) : (g < b ? g : b)) * 0.8;
            r = g = b = minVal;
          }
        }

        if (!edge && !redEdge) {
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

        if (!edge && !redEdge && !origBlueish && !origRed && !origYG && !wasY && !isR && !isRSoft) {
          const maxNow = r > g ? (r > b ? r : b) : (g > b ? g : b);
          const minNow = r < g ? (r < b ? r : b) : (g < b ? g : b);
          const rangeNow = maxNow - minNow;
          const satNow = maxNow ? rangeNow / maxNow : 0;
          const lumaNow = r * GRAY_R + g * GRAY_G + b * GRAY_B;
          if (satNow < 0.14 && lumaNow > 135 && rangeNow < 38) {
            const t = Math.min(1, (lumaNow - 135) / 80);
            const s = Math.min(1, (0.14 - satNow) / 0.14);
            const w = t * s;
            const boost = 0.3 + 0.5 * w;
            r += (255 - r) * boost;
            g += (255 - g) * boost;
            b += (255 - b) * boost;
          }
        }

        if (wasY) {
          r = TY.R; g = TY.G; b = TY.B;
        }

        const yellowCleanup = !skipYellow && !origRed && !origBlueish && !strongGreen && !greenProtect &&
          r > 170 && g > 150 && Math.abs(r - g) < 50 &&
          b < Math.min(r, g) * 0.75 &&
          oB < minRG * (cfg.YELLOW_BLUE_RATIO_MAX + 0.12);
        if (yellowCleanup) {
          r = TY.R; g = TY.G; b = TY.B;
        }

        const oMax = oR > oG ? (oR > oB ? oR : oB) : (oG > oB ? oG : oB);
        const oMin = oR < oG ? (oR < oB ? oR : oB) : (oG < oB ? oG : oB);
        const satOrig = oMax ? (oMax - oMin) / oMax : 0;

        if (satOrig > PURIFY_SAT_MIN && oMax > PURIFY_LUMA_MIN) {
          if (isYStrong) {
            r = TY.R; g = TY.G; b = TY.B;
          } else {
            const redSnap = origRed && !isYStrong && !isY && !yellowLike &&
              (oR - oG) > PURIFY_RED_GAP && (oR - oB) > PURIFY_RED_GAP &&
              oR > oG * 1.6 && oR > oB * 1.35;
            const blueSnap = origBlueish &&
              (oB - oR) > PURIFY_BLUE_GAP && (oB - oG) > PURIFY_BLUE_GAP;
            if (redSnap) {
              r = cfg.TARGET_RED_R; g = cfg.TARGET_RED_G; b = cfg.TARGET_RED_B;
            } else if (blueSnap) {
              r = cfg.TARGET_BLUE_R; g = cfg.TARGET_BLUE_G; b = cfg.TARGET_BLUE_B;
            }
          }
        }

        outR[p] = r;
        outG[p] = g;
        outB[p] = b;
      }

      if ((y & 15) === 0) await U.next();
    }

    return { rArr: outR, gArr: outG, bArr: outB };
  };

  SP.applyColorStepsAsync = async function applyColorStepsAsync(src, T, onStep) {
    const cfg = buildFastConfig(SP.Config);
    const { rArr: r1, gArr: g1, bArr: b1, w, h, orig } = await applyMatrixPass(src, T);
    if (onStep) await onStep("Recoloring: Transform", floatsToCanvas(r1, g1, b1, w, h));

    const contrast = await applyContrastPass(r1, g1, b1, w, h, cfg);
    if (onStep) {
      await onStep("Recoloring: Contrast", floatsToCanvas(contrast.rArr, contrast.gArr, contrast.bArr, w, h));
    }

    const expo = await applyExposurePass(contrast.rArr, contrast.gArr, contrast.bArr, w, h, cfg);
    if (onStep) {
      await onStep("Recoloring: Exposure", floatsToCanvas(expo.rArr, expo.gArr, expo.bArr, w, h));
    }

    const tone = await applyTonePass(orig, expo.rArr, expo.gArr, expo.bArr, w, h, cfg);
    if (onStep) await onStep("Recoloring: Tone", floatsToCanvas(tone.rArr, tone.gArr, tone.bArr, w, h));

    const color = await applyColorPass(orig, tone.rArr, tone.gArr, tone.bArr, w, h, cfg);
    const finalCanvas = floatsToCanvas(color.rArr, color.gArr, color.bArr, w, h);
    if (onStep) await onStep("Recoloring: Color", finalCanvas);

    return finalCanvas;
  };

  SP.applyBalanceStepsAsync = async function applyBalanceStepsAsync(cvs, onStep) {
    const cfg = buildFastConfig(SP.Config);
    const c = cvs.getContext("2d", { willReadFrequently: true });
    const w = cvs.width;
    const h = cvs.height;
    const id = c.getImageData(0, 0, w, h);
    const d = id.data;

    const step = Math.max(1, ((d.length / 4 / 50000) | 0));
    const histR = new Uint32Array(256);
    const histG = new Uint32Array(256);
    const histB = new Uint32Array(256);
    let samples = 0;
    for (let i = 0; i < d.length; i += 4 * step) {
      histR[d[i]]++;
      histG[d[i + 1]]++;
      histB[d[i + 2]]++;
      samples++;
    }
    const total = samples || 1;
    const p98R = pctFromHist(histR, total, 0.98);
    const p98G = pctFromHist(histG, total, 0.98);
    const p98B = pctFromHist(histB, total, 0.98);
    const p02R = pctFromHist(histR, total, 0.02);
    const p02G = pctFromHist(histG, total, 0.02);
    const p02B = pctFromHist(histB, total, 0.02);

    const rnR = Math.max(1, p98R - p02R);
    const rnG = Math.max(1, p98G - p02G);
    const rnB = Math.max(1, p98B - p02B);

    const scaleR = 251 / rnR;
    const scaleG = 251 / rnG;
    const scaleB = 251 / rnB;

    const totalPx = w * h;
    const rArr = new Float32Array(totalPx);
    const gArr = new Float32Array(totalPx);
    const bArr = new Float32Array(totalPx);

    for (let y = 0, p = 0, idx = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p++, idx += 4) {
        const oR = d[idx], oG = d[idx + 1], oB = d[idx + 2];
        rArr[p] = (oR - p02R) * scaleR + 3;
        gArr[p] = (oG - p02G) * scaleG + 3;
        bArr[p] = (oB - p02B) * scaleB + 3;
      }
      if ((y & 15) === 0) await U.next();
    }

    if (onStep) await onStep("Recoloring: Balance", floatsToCanvas(rArr, gArr, bArr, w, h));

    const tone = await applyTonePass(d, rArr, gArr, bArr, w, h, cfg);
    if (onStep) await onStep("Recoloring: Tone", floatsToCanvas(tone.rArr, tone.gArr, tone.bArr, w, h));

    const color = await applyColorPass(d, tone.rArr, tone.gArr, tone.bArr, w, h, cfg);
    const finalCanvas = floatsToCanvas(color.rArr, color.gArr, color.bArr, w, h);
    if (onStep) await onStep("Recoloring: Color", finalCanvas);

    return finalCanvas;
  };

  SP.applyColorAsync = async function applyColorAsync(src, T, progress) {
    const cfg = buildFastConfig(SP.Config);
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
    const cfg = buildFastConfig(SP.Config);
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
    const histR = new Uint32Array(256);
    const histG = new Uint32Array(256);
    const histB = new Uint32Array(256);
    let samples = 0;
    for (let i = 0; i < d.length; i += 4 * step) {
      histR[d[i]]++;
      histG[d[i + 1]]++;
      histB[d[i + 2]]++;
      samples++;
    }
    const total = samples || 1;
    const p98R = pctFromHist(histR, total, 0.98);
    const p98G = pctFromHist(histG, total, 0.98);
    const p98B = pctFromHist(histB, total, 0.98);
    const p02R = pctFromHist(histR, total, 0.02);
    const p02G = pctFromHist(histG, total, 0.02);
    const p02B = pctFromHist(histB, total, 0.02);

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
      cv.addWeighted(s, 1.3, bl, -0.3, 0, sh2);

      return U.mat2C(sh2);
    } catch (e) {
      return out;
    } finally {
      m.d();
    }
  };
})();
