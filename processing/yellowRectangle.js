(() => {
  "use strict";
  const SP = (window.ScannerPro = window.ScannerPro || {});
  const U = SP.Util;

  SP.extrapolatePage = function extrapolatePage(yq) {
    const ALG = SP.ALG;
    const d2 = U.d2;

    const yw = d2(yq[0], yq[1]);
    const yh = d2(yq[1], yq[2]);
    const pxX = yw / ALG.CFG.STENCIL.w;
    const pxY = yh / ALG.CFG.STENCIL.h;

    const yq0 = yq[0], yq1 = yq[1], yq2 = yq[2], yq3 = yq[3];
    const d1x = yq1.x - yq0.x;
    const d1y = yq1.y - yq0.y;
    const d2x = yq3.x - yq0.x;
    const d2y = yq3.y - yq0.y;

    const l1 = Math.sqrt(d1x * d1x + d1y * d1y);
    const l2 = Math.sqrt(d2x * d2x + d2y * d2y);
    const l1Safe = l1 > 0 ? l1 : 1;
    const l2Safe = l2 > 0 ? l2 : 1;

    const tDx = d1x / l1Safe;
    const tDy = d1y / l1Safe;
    const lDx = d2x / l2Safe;
    const lDy = d2y / l2Safe;

    const CFG = ALG.CFG;
    const mL = CFG.STENCIL.x * pxX;
    const mT = CFG.STENCIL.y * pxY;
    const mR = (CFG.A4_CM[0] - CFG.STENCIL.x - CFG.STENCIL.w) * pxX;
    const mB = (CFG.A4_CM[1] - CFG.STENCIL.y - CFG.STENCIL.h) * pxY;

    return [
      { x: yq0.x - tDx * mL - lDx * mT, y: yq0.y - tDy * mL - lDy * mT },
      { x: yq1.x + tDx * mR - lDx * mT, y: yq1.y + tDy * mR - lDy * mT },
      { x: yq2.x + tDx * mR + lDx * mB, y: yq2.y + tDy * mR + lDy * mB },
      { x: yq3.x - tDx * mL + lDx * mB, y: yq3.y - tDy * mL + lDy * mB }
    ];
  };
})();
