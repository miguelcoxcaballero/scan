(() => {
  "use strict";
  const SP = (window.ScannerPro = window.ScannerPro || {});
  const U = SP.Util;

  // Cache constants
  const MIN_AREA_RATIO = 0.1;
  const APPROX_EPSILON = 0.02;
  const QUAD_CORNERS = 4;

  function findQuad(bin, sc, best, m, ea) {
    const cnts = m.t(new cv.MatVector());
    cv.findContours(bin, cnts, m.t(new cv.Mat()), cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const ia = bin.cols * bin.rows;
    const minArea = ia * MIN_AREA_RATIO;
    const cntsSize = cnts.size();
    const invSc = 1 / sc;

    for (let i = 0; i < cntsSize; i++) {
      const c = cnts.get(i);
      const a = cv.contourArea(c);
      if (a < minArea) continue;

      const peri = cv.arcLength(c, true);
      const ap = m.t(new cv.Mat());
      cv.approxPolyDP(c, ap, APPROX_EPSILON * peri, true);

      if (ap.rows === QUAD_CORNERS && cv.isContourConvex(ap)) {
        const r = cv.minAreaRect(c);
        const w = r.size.width < r.size.height ? r.size.width : r.size.height;
        const h = r.size.width > r.size.height ? r.size.width : r.size.height;
        const aspectDiff = Math.abs(h / w - ea);
        const sv = (a / ia) / (1 + aspectDiff);

        if (sv > best.s) {
          const pts = new Array(QUAD_CORNERS);
          for (let j = 0; j < QUAD_CORNERS; j++) {
            const ptr = ap.intPtr(j, 0);
            pts[j] = { x: ptr[0] * invSc, y: ptr[1] * invSc };
          }
          best.s = sv;
          best.q = U.orderQuad(pts);
        }
      }
    }
  }

  // Cache detection parameters
  const MAX_DIM = 1200;
  const GAUSS_KERNEL_SIZE = 5;
  const CANNY_LOW = 40;
  const CANNY_HIGH = 120;
  const DILATE_KERNEL_SIZE = 3;
  const BEST_SCORE_THRESHOLD = 0.3;
  const ADAPTIVE_BLOCK_SIZE = 11;
  const ADAPTIVE_CONSTANT = 2;

  SP.detectPageEdges = function detectPageEdges(cvs) {
    const m = new U.MM();
    try {
      const s = m.t(cv.imread(cvs));
      const maxDim = s.cols > s.rows ? s.cols : s.rows;
      const sc = maxDim > MAX_DIM ? MAX_DIM / maxDim : 1;
      const ds = m.t(new cv.Mat());
      cv.resize(s, ds, new cv.Size(), sc, sc);

      const gr = m.t(new cv.Mat());
      cv.cvtColor(ds, gr, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gr, gr, new cv.Size(GAUSS_KERNEL_SIZE, GAUSS_KERNEL_SIZE), 0);

      const best = { q: null, s: 0 };
      const ALG = SP.ALG;
      const ea = ALG.CFG.A4_CM[1] / ALG.CFG.A4_CM[0];

      const ed = m.t(new cv.Mat());
      cv.Canny(gr, ed, CANNY_LOW, CANNY_HIGH);
      cv.dilate(ed, ed, m.t(cv.Mat.ones(DILATE_KERNEL_SIZE, DILATE_KERNEL_SIZE, cv.CV_8U)));
      findQuad(ed, sc, best, m, ea);

      if (best.s < BEST_SCORE_THRESHOLD) {
        const th = m.t(new cv.Mat());
        cv.adaptiveThreshold(gr, th, 255,
          cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, ADAPTIVE_BLOCK_SIZE, ADAPTIVE_CONSTANT);
        findQuad(th, sc, best, m, ea);
      }

      const cvsW = cvs.width;
      const cvsH = cvs.height;
      return best.q || [
        { x: 0, y: 0 },
        { x: cvsW, y: 0 },
        { x: cvsW, y: cvsH },
        { x: 0, y: cvsH }
      ];
    } finally {
      m.d();
    }
  };
})();
