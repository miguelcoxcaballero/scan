(() => {
  "use strict";
  const SP = (window.ScannerPro = window.ScannerPro || {});
  const U = SP.Util;

  // Weighted color distance (perceptual weights)
  const COLOR_WEIGHT_R = 0.3;
  const COLOR_WEIGHT_G = 0.59;
  const COLOR_WEIGHT_B = 0.11;

  const colorDist = (r1, g1, b1, r2, g2, b2) => {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt(dr * dr * COLOR_WEIGHT_R + dg * dg * COLOR_WEIGHT_G + db * db * COLOR_WEIGHT_B);
  };

  const getColorRect = () => {
    const D = SP.Dims;
    const oX1 = (1105 * D.SX + 0.5) | 0;
    const oY1 = (3200 * D.SY + 0.5) | 0;
    const oX2 = (1370 * D.SX + 0.5) | 0;
    const nW = ((oX2 - oX1) * 0.6 + 0.5) | 0;
    const nH = (170 * D.SY * 0.6 + 0.5) | 0;
    const centerX = (oX1 + oX2) * 0.5;
    return {
      x1: (centerX - nW * 0.5 + 0.5) | 0,
      y1: oY1,
      w: nW,
      h: nH
    };
  };

  // Cache constants
  const MM_TO_PX_RATIO = 210; // A4 width in mm
  const COLOR_SPACING_MM = 2.5;
  const WHITE_OFFSET_MM = 5;

  SP.scanColors = function scanColors(wc) {
    const ALG = SP.ALG;
    const wcCtx = wc.getContext("2d", { willReadFrequently: true });
    const MM2PX = ALG.CFG.A4[0] / MM_TO_PX_RATIO;
    const CSP = COLOR_SPACING_MM * MM2PX;
    const WO = (WHITE_OFFSET_MM * MM2PX + 0.5) | 0;

    const { x1, y1, w, h } = getColorRect();
    if (w <= 0 || h <= 0) return { found: false, blackPt: null, count: 0, viz: wc };

    const id = wcCtx.getImageData(x1, y1, w, h).data;

    const gA = (cx, cy, rad) => {
      let sr = 0, sg = 0, sb = 0, c = 0;
      const yMin = Math.max(0, cy - rad);
      const yMax = Math.min(h - 1, cy + rad);
      const xMin = Math.max(0, cx - rad);
      const xMax = Math.min(w - 1, cx + rad);

      for (let ly = yMin; ly <= yMax; ly++) {
        const rowIdx = ly * w;
        for (let lx = xMin; lx <= xMax; lx++) {
          const i = (rowIdx + lx) * 4;
          sr += id[i];
          sg += id[i + 1];
          sb += id[i + 2];
          c++;
        }
      }
      return c ? { r: (sr / c) | 0, g: (sg / c) | 0, b: (sb / c) | 0 } : null;
    };

    const order = ["red", "black", "blue", "green"];
    const orderLen = order.length;
    let brd = null;
    let brs = 0;

    // Cache stencil colors for faster access
    const stencilColors = [
      ALG.SC.red,
      ALG.SC.black,
      ALG.SC.blue,
      ALG.SC.green
    ];

    for (let row = 0; row < h; row++) {
      let runs = [];
      let cc = "unknown";
      let rs = 0;
      let rp = 0;
      const rowIdx = row * w;

      for (let col = 0; col <= w; col++) {
        let cl = "unknown";
        let px = null;

        if (col < w) {
          const i = (rowIdx + col) * 4;
          px = { r: id[i], g: id[i + 1], b: id[i + 2] };

          let bd = 50;
          for (let n = 0; n < orderLen; n++) {
            const t = stencilColors[n];
            const d = colorDist(px.r, px.g, px.b, t.r, t.g, t.b);
            if (d < bd) { bd = d; cl = order[n]; }
          }
        }

        if (cl !== cc || col === w) {
          if (cc !== "unknown" && rp >= 5) {
            runs.push({ color: cc, centerX: (rs + col - 1) * 0.5 });
          }
          cc = cl;
          rs = col;
          rp = px ? 1 : 0;
        } else if (px) rp++;
      }

      const cr = runs.filter(r => order.includes(r.color));
      const crLen = cr.length;
      let sc = 0;
      let fp = [];

      for (let i = 0; i < crLen - 1; i++) {
        const color1 = cr[i].color;
        const color2 = cr[i + 1].color;
        const i1 = order.indexOf(color1);
        const i2 = order.indexOf(color2);
        if (i2 === i1 + 1) {
          const sp = cr[i + 1].centerX - cr[i].centerX;
          const spacingDiff = Math.abs(sp - CSP) / CSP;
          if (spacingDiff < 0.5) {
            sc += 30;
            fp.push({ run1: cr[i], spacing: sp });
          }
        }
      }

      if (sc > brs) { brs = sc; brd = { row, fp }; }
    }

    // Helper to check if a color is yellow (for detecting circle boundaries)
    const targetYellow = SP.Config && SP.Config.TARGET_YELLOW
      ? { r: SP.Config.TARGET_YELLOW.R, g: SP.Config.TARGET_YELLOW.G, b: SP.Config.TARGET_YELLOW.B }
      : null;
    const isTargetYellow = (r, g, b) => {
      if (!targetYellow) return false;
      const dr = Math.abs(r - targetYellow.r);
      const dg = Math.abs(g - targetYellow.g);
      const db = Math.abs(b - targetYellow.b);
      return (dr + dg + db) <= 18;
    };
    const isYellow = (r, g, b) => {
      if (isTargetYellow(r, g, b)) return true;
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (mx === 0) return false;

      const delta = mx - mn;
      if (delta === 0) return false;

      let h;
      if (mx === r) {
        h = 60 * (((g - b) / delta) % 6);
      } else if (mx === g) {
        h = 60 * (((b - r) / delta) + 2);
      } else {
        h = 60 * (((r - g) / delta) + 4);
      }

      if (h < 0) h += 360;

      return h >= 38 && h <= 78 && b < mx * 0.78;
    };

    // Build yellow mask and connected components for robustness
    const buildYellowComponents = (useTargetOnly) => {
      const mask = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        const rowIdx = y * w;
        for (let x = 0; x < w; x++) {
          const i = (rowIdx + x) * 4;
          const isY = useTargetOnly
            ? isTargetYellow(id[i], id[i + 1], id[i + 2])
            : isYellow(id[i], id[i + 1], id[i + 2]);
          if (isY) mask[rowIdx + x] = 1;
        }
      }

      const labels = new Int32Array(w * h);
      const sizes = [0];
      let label = 0;
      const stack = [];
      for (let y = 0; y < h; y++) {
        const rowIdx = y * w;
        for (let x = 0; x < w; x++) {
          const idx = rowIdx + x;
          if (!mask[idx] || labels[idx]) continue;
          label++;
          let count = 0;
          labels[idx] = label;
          stack.push(idx);
          while (stack.length) {
            const cur = stack.pop();
            count++;
            const cy = (cur / w) | 0;
            const cx = cur - cy * w;
            for (let dy = -1; dy <= 1; dy++) {
              const ny = cy + dy;
              if (ny < 0 || ny >= h) continue;
              const nRow = ny * w;
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = cx + dx;
                if (nx < 0 || nx >= w) continue;
                const ni = nRow + nx;
                if (mask[ni] && !labels[ni]) {
                  labels[ni] = label;
                  stack.push(ni);
                }
              }
            }
          }
          sizes[label] = count;
        }
      }

      return { mask, labels, sizes };
    };

    const hasStrongYellow = sizes => {
      for (let i = 1; i < sizes.length; i++) {
        if (sizes[i] >= 20) return true;
      }
      return false;
    };

    let useTargetOnly = !!targetYellow;
    let { mask: yMask, labels: yLabels, sizes: ySizes } = buildYellowComponents(useTargetOnly);
    if (useTargetOnly && !hasStrongYellow(ySizes)) {
      ({ mask: yMask, labels: yLabels, sizes: ySizes } = buildYellowComponents(false));
      useTargetOnly = false;
    }

    const isStrongYellow = (x, y) => {
      const idx = y * w + x;
      if (!yMask[idx]) return false;
      const label = yLabels[idx];
      return label && ySizes[label] >= 20;
    };

    const findStrongYellowInColumnRange = (cx, y, radius = 10) => {
      const minX = Math.max(0, (cx - radius) | 0);
      const maxX = Math.min(w - 1, (cx + radius) | 0);
      for (let x = minX; x <= maxX; x++) {
        if (isStrongYellow(x, y)) return true;
      }
      return false;
    };

    // Sample color by detecting yellow boundary and averaging pixels inside
    const sampleInsideYellowCircle = (cx, cy) => {
      // Detect yellow boundary by searching outward in multiple directions
      const directions = 12;
      const maxSearchRadius = 35;
      let radiusSum = 0;
      let radiusCount = 0;
      let yellowDetected = false;

      for (let dir = 0; dir < directions; dir++) {
        const angle = (dir / directions) * Math.PI * 2;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);

        for (let r = 3; r < maxSearchRadius; r++) {
          const px = Math.round(cx + dx * r);
          const py = Math.round(cy + dy * r);

          if (px < 0 || px >= w || py < 0 || py >= h) break;

          const i = (py * w + px) * 4;
          const pr = id[i];
          const pg = id[i + 1];
          const pb = id[i + 2];

          if (isYellow(pr, pg, pb)) {
            radiusSum += r;
            radiusCount++;
            break;
          }
        }
      }

      // Calculate average radius, leave margin for yellow ring
      let sampleRadius, yellowRadius;
      if (radiusCount > directions * 0.5) {
        yellowRadius = radiusSum / radiusCount;
        sampleRadius = Math.max(3, yellowRadius - 3);
        yellowDetected = true;
      } else {
        // Fallback if yellow not detected well
        yellowRadius = null;
        sampleRadius = 6;
      }

      // Sample all pixels inside the circle
      let sr = 0, sg = 0, sb = 0, count = 0;
      const sampleRadiusSq = sampleRadius * sampleRadius;

      const minX = Math.max(0, Math.floor(cx - sampleRadius));
      const maxX = Math.min(w - 1, Math.ceil(cx + sampleRadius));
      const minY = Math.max(0, Math.floor(cy - sampleRadius));
      const maxY = Math.min(h - 1, Math.ceil(cy + sampleRadius));

      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const distSq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
          if (distSq <= sampleRadiusSq) {
            const i = (py * w + px) * 4;
            sr += id[i];
            sg += id[i + 1];
            sb += id[i + 2];
            count++;
          }
        }
      }

      if (count > 0) {
        return {
          r: (sr / count) | 0,
          g: (sg / count) | 0,
          b: (sb / count) | 0,
          yellowRadius: yellowRadius,
          sampleRadius: sampleRadius,
          yellowDetected: yellowDetected
        };
      }
      return null;
    };

    const dc = {};
    const yellowRadii = {};
    const sampleRadii = {};
    const circle = brd && brd.fp.length ? brd.fp[0] : null;
    let cp = null;
    let dW = null;

    if (circle) {
      const sp = circle.spacing;
      const colorIdx = order.indexOf(circle.run1.color);
      const rcx = circle.run1.centerX - colorIdx * sp;
      cp = {};
      for (let i = 0; i < orderLen; i++) {
        cp[order[i]] = { x: rcx + i * sp, y: brd.row };
      }

      // Sample colored dots by detecting yellow boundary
      for (let i = 0; i < orderLen; i++) {
        const n = order[i];
        const pos = cp[n];
        const result = sampleInsideYellowCircle(pos.x, pos.y);
        if (result) {
          dc[n] = [result.r, result.g, result.b];
          yellowRadii[n] = result.yellowRadius;
          sampleRadii[n] = result.sampleRadius;
        }
      }

      const wX = (cp.black.x + cp.blue.x) * 0.5;
      const wY = brd.row + WO;

      if (wY < h) {
        const wC = gA(wX, wY, 4);
        if (wC) dW = [wC.r, wC.g, wC.b];
      } else {
        const gX = x1 + wX;
        const gY = y1 + wY;
        if (gY < wc.height) {
          const sampX = (gX | 0) - 4;
          const sampY = (gY | 0) - 4;
          const wd = wcCtx.getImageData(sampX, sampY, 9, 9).data;
          let sr = 0, sg = 0, sb = 0;
          const wdLen = wd.length;
          for (let i = 0; i < wdLen; i += 4) {
            sr += wd[i];
            sg += wd[i + 1];
            sb += wd[i + 2];
          }
          const c = wdLen >> 2; // Divide by 4
          if (c) dW = [(sr / c) | 0, (sg / c) | 0, (sb / c) | 0];
        }
      }
    }

    let cnt = 0;
    ALG.cal.red.src = dc.red || null;
    ALG.cal.black.src = dc.black || null;
    ALG.cal.blue.src = dc.blue || null;
    ALG.cal.green.src = dc.green || null;
    ALG.cal.white.src = dW || null;

    if (ALG.cal.red.src) cnt++;
    if (ALG.cal.black.src) cnt++;
    if (ALG.cal.blue.src) cnt++;
    if (ALG.cal.green.src) cnt++;
    if (ALG.cal.white.src) cnt++;

    const vc = document.createElement("canvas");
    vc.width = wc.width;
    vc.height = wc.height;
    const vx = vc.getContext("2d", { willReadFrequently: true });
    vx.drawImage(wc, 0, 0);

    vx.strokeStyle = "#0f0";
    vx.lineWidth = 2;
    vx.strokeRect(x1, y1, w, h);

    if (cp && brd) {
      const ly = y1 + brd.row;
      const TWO_PI = Math.PI * 2;
      const circleRadius = 18;

      // Draw colored calibration dots (red, black, blue, green)
      for (let i = 0; i < orderLen; i++) {
        const n = order[i];
        const p = cp[n];
        const cx = x1 + p.x;
        const cy = ly;

        // Draw outer white ring for visibility
        vx.beginPath();
        vx.arc(cx, cy, circleRadius + 3, 0, TWO_PI);
        vx.fillStyle = "#fff";
        vx.fill();

        // Draw the actual detected color
        if (dc[n]) {
          vx.beginPath();
          vx.arc(cx, cy, circleRadius, 0, TWO_PI);
          vx.fillStyle = `rgb(${dc[n][0]}, ${dc[n][1]}, ${dc[n][2]})`;
          vx.fill();
        } else {
          // If color not detected, show gray
          vx.beginPath();
          vx.arc(cx, cy, circleRadius, 0, TWO_PI);
          vx.fillStyle = "#888";
          vx.fill();
        }

        // Add black outline for contrast
        vx.beginPath();
        vx.arc(cx, cy, circleRadius, 0, TWO_PI);
        vx.strokeStyle = "#000";
        vx.lineWidth = 2;
        vx.stroke();

        // Draw detected yellow boundary circle (fallback to a visible guide if missing)
        const ringRadius = yellowRadii[n] || (sampleRadii[n] ? sampleRadii[n] + 3 : circleRadius + 6);
        vx.save();
        vx.beginPath();
        vx.arc(cx, cy, ringRadius, 0, TWO_PI);
        vx.strokeStyle = "#FFD700";
        vx.lineWidth = 2;
        if (!yellowRadii[n]) vx.setLineDash([6, 4]);
        vx.stroke();
        vx.restore();
      }

      // Visualize white calibration point if detected
      if (dW) {
        const wX = (cp.black.x + cp.blue.x) * 0.5;
        const wY = brd.row + WO;
        const cx = x1 + wX;
        const cy = y1 + wY;

        // Draw outer ring for visibility
        vx.beginPath();
        vx.arc(cx, cy, circleRadius + 3, 0, TWO_PI);
        vx.fillStyle = "#888";
        vx.fill();

        // Draw the actual detected white color
        vx.beginPath();
        vx.arc(cx, cy, circleRadius, 0, TWO_PI);
        vx.fillStyle = `rgb(${dW[0]}, ${dW[1]}, ${dW[2]})`;
        vx.fill();

        // Add black outline for contrast
        vx.beginPath();
        vx.arc(cx, cy, circleRadius, 0, TWO_PI);
        vx.strokeStyle = "#000";
        vx.lineWidth = 2;
        vx.stroke();
      }
    }

    vx.fillStyle = "rgba(0,0,0,0.8)";
    vx.fillRect(x1, y1 - 50, 120, 45);
    vx.fillStyle = cnt >= 5 ? "#4ade80" : "#fbbf24";
    vx.font = "bold 12px sans-serif";
    vx.fillText(`Colors: ${cnt}/5`, x1 + 10, y1 - 25);

    let dotCenters = null;
    let dotLineY = null;
    let dotLineEdges = null;
    if (cp && brd) {
      const MAX_Y_SEARCH = Math.min(140, h);
      const X_WINDOW = 12;
      const MIN_BAND = 4;
      const findYellowEdgeY = (cx, cy, dir) => {
        for (let step = 1; step <= MAX_Y_SEARCH; step++) {
          const y = (cy + dir * step) | 0;
          if (y < 0 || y >= h) break;
          for (let dx = -X_WINDOW; dx <= X_WINDOW; dx++) {
            const x = (cx + dx) | 0;
            if (x < 0 || x >= w) continue;
            if (isStrongYellow(x, y)) return y;
          }
        }
        return null;
      };

      const baseY = brd.row;
      let lineY = baseY;
      let sumMid = 0;
      let cntMid = 0;
      let sumTop = 0;
      let sumBottom = 0;
      let cntTop = 0;
      let cntBottom = 0;

      let minX = w, maxX = 0;
      for (let i = 0; i < orderLen; i++) {
        const n = order[i];
        const pos = cp[n];
        if (!pos) continue;
        if (pos.x < minX) minX = pos.x;
        if (pos.x > maxX) maxX = pos.x;
      }
      minX = Math.max(0, (minX - X_WINDOW) | 0);
      maxX = Math.min(w - 1, (maxX + X_WINDOW) | 0);

      let globalTop = null;
      let globalBottom = null;
      for (let y = 0; y < h; y++) {
        let found = false;
        for (let x = minX; x <= maxX; x++) {
          if (isStrongYellow(x, y)) { found = true; break; }
        }
        if (found) {
          if (globalTop === null) globalTop = y;
          globalBottom = y;
        }
      }
      if (globalTop === null) {
        for (let y = 0; y < h; y++) {
          let found = false;
          for (let x = 0; x < w; x++) {
            if (isStrongYellow(x, y)) { found = true; break; }
          }
          if (found) {
            if (globalTop === null) globalTop = y;
            globalBottom = y;
          }
        }
      }

      const edgeByColor = {};
      for (let i = 0; i < orderLen; i++) {
        const n = order[i];
        const pos = cp[n];
        if (!pos) continue;
        let yTop = findYellowEdgeY(pos.x, baseY, -1);
        let yBottom = findYellowEdgeY(pos.x, baseY, 1);
        if (yTop === null && globalTop !== null) {
          for (let y = baseY - 1; y >= globalTop; y--) {
            if (findStrongYellowInColumnRange(pos.x, y, X_WINDOW)) { yTop = y; break; }
          }
        }
        if (yBottom === null && globalBottom !== null) {
          for (let y = baseY + 1; y <= globalBottom; y++) {
            if (findStrongYellowInColumnRange(pos.x, y, X_WINDOW)) { yBottom = y; break; }
          }
        }
        if (yTop === null && globalTop !== null) yTop = globalTop;
        if (yBottom === null && globalBottom !== null) yBottom = globalBottom;
        if (yTop !== null && yBottom !== null && (yBottom - yTop) < MIN_BAND) {
          yTop = null;
          yBottom = null;
        }
        edgeByColor[n] = { yTop, yBottom };
        if (yTop !== null) { sumTop += baseY - yTop; cntTop++; }
        if (yBottom !== null) { sumBottom += yBottom - baseY; cntBottom++; }
        if (yTop !== null && yBottom !== null && yBottom > yTop && yBottom - yTop > 4) {
          sumMid += (yTop + yBottom) * 0.5;
          cntMid++;
        }
      }

      const avgTop = cntTop ? sumTop / cntTop : null;
      const avgBottom = cntBottom ? sumBottom / cntBottom : null;
      if (cntMid) lineY = sumMid / cntMid;
      else if (avgTop !== null && avgBottom !== null) {
        lineY = baseY + (avgBottom - avgTop) * 0.5;
      }
      dotLineY = lineY;

      const edgeByDot = {};
      let sumCenter = 0;
      let cntCenter = 0;
      for (let i = 0; i < orderLen; i++) {
        const n = order[i];
        const pos = cp[n];
        if (!pos) continue;

        let yTop = findYellowEdgeY(pos.x, lineY, -1);
        let yBottom = findYellowEdgeY(pos.x, lineY, 1);
        if (yTop === null && globalTop !== null) {
          for (let y = lineY - 1; y >= globalTop; y--) {
            if (findStrongYellowInColumnRange(pos.x, y, X_WINDOW)) { yTop = y; break; }
          }
        }
        if (yBottom === null && globalBottom !== null) {
          for (let y = lineY + 1; y <= globalBottom; y++) {
            if (findStrongYellowInColumnRange(pos.x, y, X_WINDOW)) { yBottom = y; break; }
          }
        }
        if (yTop !== null && yBottom !== null && (yBottom - yTop) < MIN_BAND) {
          yTop = null;
          yBottom = null;
        }
        if (yTop === null && avgTop !== null) yTop = lineY - avgTop;
        if (yBottom === null && avgBottom !== null) yBottom = lineY + avgBottom;
        if (yTop === null && globalTop !== null) yTop = globalTop;
        if (yBottom === null && globalBottom !== null) yBottom = globalBottom;

        let centerY = null;
        if (yTop !== null && yBottom !== null) {
          centerY = (yTop + yBottom) * 0.5;
        } else if (yTop !== null && avgBottom !== null) {
          centerY = yTop + avgBottom;
        } else if (yBottom !== null && avgTop !== null) {
          centerY = yBottom - avgTop;
        }
        if (centerY === null) centerY = lineY;
        sumCenter += centerY;
        cntCenter++;

        edgeByDot[n] = { yTop, yBottom };
      }

      if (cntCenter) lineY = sumCenter / cntCenter;
      dotLineY = lineY;

      dotCenters = {};
      dotLineEdges = {};
      for (let i = 0; i < orderLen; i++) {
        const n = order[i];
        const pos = cp[n];
        if (!pos) continue;
        const xAbs = x1 + pos.x;
        const yAbs = y1 + lineY;
        dotCenters[n] = { x: xAbs, y: yAbs };

        const edge = edgeByDot[n] || {};
        const yTop = edge.yTop ?? null;
        const yBottom = edge.yBottom ?? null;

        dotLineEdges[n] = {
          x: xAbs,
          y: yAbs,
          topY: yTop !== null ? y1 + yTop : null,
          bottomY: yBottom !== null ? y1 + yBottom : null
        };
      }
    }

    if (dotLineEdges) {
      vx.strokeStyle = "#9ca3af";
      vx.lineWidth = 7;
      const keys = Object.keys(dotLineEdges);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const e = dotLineEdges[k];
        if (e.topY !== null) {
          vx.beginPath();
          vx.moveTo(e.x, e.y);
          vx.lineTo(e.x, e.topY);
          vx.stroke();
        }
        if (e.bottomY !== null) {
          vx.beginPath();
          vx.moveTo(e.x, e.y);
          vx.lineTo(e.x, e.bottomY);
          vx.stroke();
        }
      }
    }

    return {
      found: cnt >= 5,
      blackPt: dc.black && cp ? { x: x1 + cp.black.x, y: y1 + brd.row } : null,
      count: cnt,
      viz: vc,
      dotCenters,
      dotLineEdges
    };
  };

  SP.findBlackBlob = function findBlackBlob(cvs, seed) {
    const cvCtx = cvs.getContext("2d", { willReadFrequently: true });
    const { x1, y1, w, h } = getColorRect();
    const id = cvCtx.getImageData(x1, y1, w, h).data;

    const sx = (seed.x - x1) | 0;
    const sy = (seed.y - y1) | 0;
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) return seed;

    const stk = [[sx, sy]];
    const vis = new Uint8Array(w * h);
    const seedIdx = sy * w + sx;
    vis[seedIdx] = 1;

    let sX = 0, sY = 0, c = 0;
    const BLACK_THRESHOLD = 200;

    while (stk.length) {
      const [cx, cy] = stk.pop();
      sX += cx; sY += cy; c++;

      // Check 4-connected neighbors
      const neighbors = [
        [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]
      ];

      for (let i = 0; i < 4; i++) {
        const [nx, ny] = neighbors[i];
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const ni = ny * w + nx;
          if (!vis[ni]) {
            const j = ni << 2; // Multiply by 4
            const colorSum = id[j] + id[j + 1] + id[j + 2];
            if (colorSum < BLACK_THRESHOLD) {
              vis[ni] = 1;
              stk.push([nx, ny]);
            }
          }
        }
      }
    }

    return c ? { x: sX / c + x1, y: sY / c + y1 } : seed;
  };

  SP.alignMarker = function alignMarker(src, cur) {
    const ALG = SP.ALG;
    const out = document.createElement("canvas");
    out.width = ALG.CFG.A4[0];
    out.height = ALG.CFG.A4[1];
    const outCtx = out.getContext("2d", { willReadFrequently: true });
    outCtx.fillStyle = "#fff";
    outCtx.fillRect(0, 0, out.width, out.height);
    outCtx.drawImage(
      src,
      ALG.CFG.MARKER.x * ALG.CFG.PX_CM - cur.x,
      ALG.CFG.MARKER.y * ALG.CFG.PX_CM - cur.y
    );
    return out;
  };
})();
