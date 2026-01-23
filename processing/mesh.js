(() => {
  "use strict";
  const SP = (window.ScannerPro = window.ScannerPro || {});
  const U = SP.Util;

  SP.optimizeGrid = function optimizeGrid(edges, R, C) {
    const g = [];
    for (let r = 0; r < R; r++) {
      const row = new Array(C);
      g.push(row);
    }

    const tp = SP.smoothResample(edges.top, C);
    const rp = SP.smoothResample(edges.right, R);
    const bp = SP.smoothResample(edges.bottom, C).reverse();
    const lp = SP.smoothResample(edges.left, R).reverse();

    const RMinus1 = R - 1;
    const CMinus1 = C - 1;
    const invRMinus1 = 1 / RMinus1;
    const invCMinus1 = 1 / CMinus1;

    for (let c = 0; c < C; c++) {
      g[0][c] = tp[c];
      g[RMinus1][c] = bp[c];
    }
    for (let r = 0; r < R; r++) {
      g[r][0] = lp[r];
      g[r][CMinus1] = rp[r];
    }

    const P00 = g[0][0];
    const P01 = g[0][CMinus1];
    const P10 = g[RMinus1][0];
    const P11 = g[RMinus1][CMinus1];

    for (let r = 1; r < RMinus1; r++) {
      const v = r * invRMinus1;
      const oneMinusV = 1 - v;
      const gRow = g[r];
      const gRowLeft = gRow[0];
      const gRowRight = gRow[CMinus1];

      for (let c = 1; c < CMinus1; c++) {
        const u = c * invCMinus1;
        const oneMinusU = 1 - u;

        const Lx = oneMinusU * gRowLeft.x + u * gRowRight.x;
        const Ly = oneMinusU * gRowLeft.y + u * gRowRight.y;

        const g0c = g[0][c];
        const gRMinus1c = g[RMinus1][c];
        const Mx = oneMinusV * g0c.x + v * gRMinus1c.x;
        const My = oneMinusV * g0c.y + v * gRMinus1c.y;

        const Bx = oneMinusU * (oneMinusV * P00.x + v * P10.x) +
                   u * (oneMinusV * P01.x + v * P11.x);
        const By = oneMinusU * (oneMinusV * P00.y + v * P10.y) +
                   u * (oneMinusV * P01.y + v * P11.y);

        gRow[c] = { x: Lx + Mx - Bx, y: Ly + My - By };
      }
    }

    // Double buffering for smoothing
    const ng = [];
    for (let r = 0; r < R; r++) {
      const row = new Array(C);
      ng.push(row);
    }

    for (let it = 0; it < 8; it++) {
      // Copy to new grid
      for (let r = 1; r < RMinus1; r++) {
        const gRow = g[r];
        const gRowMinus = g[r - 1];
        const gRowPlus = g[r + 1];
        const ngRow = ng[r];

        for (let c = 1; c < CMinus1; c++) {
          const currPt = gRow[c];
          const ax = (gRowMinus[c].x + gRowPlus[c].x + gRow[c - 1].x + gRow[c + 1].x) * 0.25;
          const ay = (gRowMinus[c].y + gRowPlus[c].y + gRow[c - 1].y + gRow[c + 1].y) * 0.25;
          ngRow[c] = {
            x: currPt.x * 0.6 + ax * 0.4,
            y: currPt.y * 0.6 + ay * 0.4
          };
        }
      }
      // Copy back
      for (let r = 1; r < RMinus1; r++) {
        for (let c = 1; c < CMinus1; c++) {
          g[r][c] = ng[r][c];
        }
      }
    }

    return g;
  };

  SP.meshViz = function meshViz(src, g, corners, edges) {
    const R = g.length;
    const C = g[0].length;
    const vc = document.createElement("canvas");
    const srcW = src.width;
    const srcH = src.height;
    vc.width = srcW;
    vc.height = srcH;

    const vctx = vc.getContext("2d", { willReadFrequently: true });
    vctx.drawImage(src, 0, 0);
    vctx.fillStyle = "rgba(0,0,0,0.4)";
    vctx.fillRect(0, 0, srcW, srcH);

    const lw = Math.max(1, srcW / 600);

    if (edges) {
      vctx.strokeStyle = "rgba(255,255,0,0.8)";
      vctx.lineWidth = lw * 3;
      vctx.beginPath();
      const ap = [...edges.top, ...edges.right, ...edges.bottom, ...edges.left];
      const apLen = ap.length;
      if (apLen) {
        const firstPt = ap[0];
        vctx.moveTo(firstPt.x, firstPt.y);
        for (let i = 1; i < apLen; i++) {
          const pt = ap[i];
          vctx.lineTo(pt.x, pt.y);
        }
      }
      vctx.closePath();
      vctx.stroke();
    }

    vctx.lineWidth = lw;

    vctx.strokeStyle = "rgba(0,255,255,0.8)";
    for (let r = 0; r < R; r++) {
      const gRow = g[r];
      vctx.beginPath();
      const firstPt = gRow[0];
      vctx.moveTo(firstPt.x, firstPt.y);
      for (let c = 1; c < C; c++) {
        const pt = gRow[c];
        vctx.lineTo(pt.x, pt.y);
      }
      vctx.stroke();
    }

    vctx.strokeStyle = "rgba(255,0,255,0.8)";
    for (let c = 0; c < C; c++) {
      vctx.beginPath();
      const firstPt = g[0][c];
      vctx.moveTo(firstPt.x, firstPt.y);
      for (let r = 1; r < R; r++) {
        const pt = g[r][c];
        vctx.lineTo(pt.x, pt.y);
      }
      vctx.stroke();
    }

    if (corners) {
      const cc = ["#f00", "#0f0", "#00f", "#f0f"];
      const TWO_PI = Math.PI * 2;
      const cornersLen = corners.length;
      for (let i = 0; i < cornersLen; i++) {
        const c = corners[i];
        vctx.beginPath();
        vctx.arc(c.x, c.y, 12, 0, TWO_PI);
        vctx.fillStyle = cc[i];
        vctx.fill();
        vctx.strokeStyle = "#fff";
        vctx.lineWidth = 2;
        vctx.stroke();
      }
    }

    return vc;
  };

  SP.warpGrid = function warpGrid(src, g) {
    const ALG = SP.ALG;
    const m = new U.MM();
    try {
      const s = m.t(cv.imread(src));
      const R = g.length;
      const C = g[0].length;

      const PX_CM = ALG.CFG.PX_CM;
      const sx = ALG.CFG.STENCIL.x * PX_CM;
      const sy = ALG.CFG.STENCIL.y * PX_CM;
      const stW = (ALG.CFG.STENCIL.w * PX_CM + 0.5) | 0;
      const stH = (ALG.CFG.STENCIL.h * PX_CM + 0.5) | 0;

      const mapX = new Float32Array(stW * stH);
      const mapY = new Float32Array(stW * stH);

      const stWMinus1 = stW - 1;
      const stHMinus1 = stH - 1;
      const RMinus1 = R - 1;
      const CMinus1 = C - 1;
      const RMinus2 = R - 2;
      const CMinus2 = C - 2;

      for (let dy = 0; dy < stH; dy++) {
        const v = dy / stHMinus1;
        const grf = v * RMinus1;
        const gr = grf < RMinus2 ? (grf | 0) : RMinus2;
        const rf = grf - gr;
        const oneMinusRf = 1 - rf;

        const gRowGr = g[gr];
        const gRowGrPlus = g[gr + 1];
        const idxRowBase = dy * stW;

        for (let dx = 0; dx < stW; dx++) {
          const u = dx / stWMinus1;
          const gcf = u * CMinus1;
          const gc = gcf < CMinus2 ? (gcf | 0) : CMinus2;
          const cf = gcf - gc;
          const oneMinusCf = 1 - cf;

          const p00 = gRowGr[gc];
          const p10 = gRowGr[gc + 1];
          const p01 = gRowGrPlus[gc];
          const p11 = gRowGrPlus[gc + 1];

          const idx = idxRowBase + dx;
          const w00 = oneMinusCf * oneMinusRf;
          const w10 = cf * oneMinusRf;
          const w01 = oneMinusCf * rf;
          const w11 = cf * rf;

          mapX[idx] = w00 * p00.x + w10 * p10.x + w01 * p01.x + w11 * p11.x;
          mapY[idx] = w00 * p00.y + w10 * p10.y + w01 * p01.y + w11 * p11.y;
        }
      }

      const mX = m.t(cv.matFromArray(stH, stW, cv.CV_32FC1, mapX));
      const mY = m.t(cv.matFromArray(stH, stW, cv.CV_32FC1, mapY));

      const stD = m.t(new cv.Mat());
      const whiteScalar = new cv.Scalar(255, 255, 255, 255);
      cv.remap(s, stD, mX, mY, cv.INTER_LINEAR, cv.BORDER_CONSTANT, whiteScalar);

      const dst = m.t(new cv.Mat(ALG.CFG.A4[1], ALG.CFG.A4[0], cv.CV_8UC4, whiteScalar));
      const sxFloor = sx | 0;
      const syFloor = sy | 0;
      const roi = dst.roi(new cv.Rect(sxFloor, syFloor, stW, stH));
      stD.copyTo(roi);
      roi.delete();

      return U.mat2C(dst);
    } finally {
      m.d();
    }
  };

  SP.warpSimple = function warpSimple(cvs, pq) {
    const ALG = SP.ALG;
    if (!pq || pq.length !== 4) {
      pq = [
        { x: 0, y: 0 },
        { x: cvs.width, y: 0 },
        { x: cvs.width, y: cvs.height },
        { x: 0, y: cvs.height }
      ];
    }

    const m = new U.MM();
    try {
      const s = m.t(cv.imread(cvs));

      const sc = pq.flatMap(p => [p.x, p.y]);
      const dc = [0, 0, ALG.CFG.A4[0], 0, ALG.CFG.A4[0], ALG.CFG.A4[1], 0, ALG.CFG.A4[1]];

      const sM = m.t(cv.matFromArray(4, 1, cv.CV_32FC2, sc));
      const dM = m.t(cv.matFromArray(4, 1, cv.CV_32FC2, dc));

      const M = m.t(cv.getPerspectiveTransform(sM, dM));
      const dst = m.t(new cv.Mat());

      cv.warpPerspective(s, dst, M, new cv.Size(ALG.CFG.A4[0], ALG.CFG.A4[1]),
        cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));

      return U.mat2C(dst);
    } finally {
      m.d();
    }
  };
})();
