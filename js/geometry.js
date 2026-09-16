/* geometry.js — segment polygon construction for 7 / 14 / 16 segment displays.
 *
 * Everything is built in a fixed glyph space (FRAME.w x FRAME.h) and scaled by
 * the SVG viewBox. Three primitives cover every segment on every display type:
 *
 *   hbar  horizontal bar, 45-degree mitred ends  (A, A1, A2, D, D1, D2, G, G1, G2)
 *   vbar  vertical bar, 45-degree mitred ends    (B, C, E, F, J, M)
 *   diag  parallelogram with horizontal end-cuts (H, K, L, N)
 *
 * The four diagonals all radiate from the dead centre of the glyph to a corner.
 * That single fact is why 16-segment fonts render V, W, M and X the way they do:
 * there is no segment that runs from a mid-edge to the bottom centre.
 */
window.LED = window.LED || {};
(function (NS) {
  'use strict';

  /* dpGap  — from x1 (the right VERTICAL'S CENTRE LINE) to the DP centre.
   *
   *   ⚠️ x1 is a centre line, not an edge. The bar reaches x1 + hh, so clearance must be
   *   measured from THERE. Getting that wrong once put the dot 2.8 units inside the
   *   segment's own footprint — invisible only because the bar tapers to a point above
   *   the dot's row.
   *
   *   Calibrated against a real 3641BS1-1 module: across three digits the gap measured
   *   18-19 px against a ~74 px segment thickness, i.e. 0.25x thickness. dpGap is set so
   *   the dot clears x1 + hh by that same fraction.
   *
   * dpPad  — trailing margin AFTER the dot. Deliberately much smaller than `m`: the dot
   *   lives in the right margin rather than extending past a full one. With a full margin
   *   the body sat ~10 units left of its own cell centre. */
  var FRAME = { w: 100, h: 180, m: 9, dpClear: 0.26, dpPad: 2 };

  /* Horizontal bar: centre line (x1,y)->(x2,y), inset by g at each end. */
  function hbar(x1, x2, y, hh, g) {
    var a = x1 + g, b = x2 - g;
    return [[a + hh, y - hh], [b - hh, y - hh], [b, y],
            [b - hh, y + hh], [a + hh, y + hh], [a, y]];
  }

  /* Vertical bar: centre line (x,y1)->(x,y2), inset by g at each end. */
  function vbar(x, y1, y2, hh, g) {
    var a = y1 + g, b = y2 - g;
    return [[x - hh, a + hh], [x, a], [x + hh, a + hh],
            [x + hh, b - hh], [x, b], [x - hh, b - hh]];
  }

  /* Diagonal: parallelogram with horizontal top and bottom edges, like the real part. */
  function diag(x1, y1, x2, y2, dw) {
    return [[x1 - dw, y1], [x1 + dw, y1], [x2 + dw, y2], [x2 - dw, y2]];
  }

  /* Centre hub: the octagon that fills the hole where G1 G2 H J K L M N all converge.
   * A standard starburst leaves that junction open. */
  function hub(cx, cy, r) {
    var pts = [];
    for (var i = 0; i < 8; i++) {
      var a = (i + 0.5) * Math.PI / 4;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  /* Corner chamfer: the 45-degree bar that closes the notch where an outer horizontal
   * meets an outer vertical. (px,py) is the corner; (sx,sy) points into the glyph. */
  function corner(px, py, sx, sy, hh, g) {
    var reach = hh * 4.3;            /* how far along each edge it runs */
    var inner = hh * 1.50;           /* thickness, measured inward */
    return [
      [px + sx * g,                   py + sy * (g + reach)],
      [px + sx * (g + reach),         py + sy * g],
      [px + sx * (g + reach + inner), py + sy * (g + inner)],
      [px + sx * (g + inner),         py + sy * (g + reach + inner)]
    ];
  }

  function centroid(pts) {
    var sx = 0, sy = 0;
    for (var i = 0; i < pts.length; i++) { sx += pts[i][0]; sy += pts[i][1]; }
    return [sx / pts.length, sy / pts.length];
  }

  function pointsAttr(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      out.push(round(pts[i][0]) + ',' + round(pts[i][1]));
    }
    return out.join(' ');
  }

  function round(n) { return Math.round(n * 100) / 100; }

  function octagon(cx, cy, r) {
    var pts = [];
    for (var i = 0; i < 8; i++) {
      var a = (i + 0.5) * Math.PI / 4;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  /* Centred-hexagonal cluster: one LED in the middle, then rings of 6, 12, 18...
   *
   * This is a "flower", and the counts are not free — a COMPLETE flower only exists at
   * the centred hexagonal numbers, 1, 7, 19, 37, 61. Hex packing is the densest possible
   * arrangement of equal circles, so it is what you use to get the most dice into a round
   * pixel aperture. 7 is the first real one.
   *
   * Generated from axial hex coordinates, which produces exactly those counts for
   * rings = 0, 1, 2, 3 and cannot produce anything else — the shape enforces its own
   * legal sizes. */
  function hexCluster(cx, cy, rings, spacing, ledR) {
    var out = [], SQ3 = Math.sqrt(3);
    for (var q = -rings; q <= rings; q++) {
      var lo = Math.max(-rings, -q - rings), hi = Math.min(rings, -q + rings);
      for (var r = lo; r <= hi; r++) {
        out.push({ cx: round(cx + spacing * (q + r / 2)),
                   cy: round(cy + spacing * (r * SQ3 / 2)),
                   r:  round(ledR) });
      }
    }
    return out;
  }

  /* 5x7 dot matrix. Each "segment" here is a CLUSTER of sub-LEDs rather than one shape —
   * which is what an outdoor sign actually is. The cluster is why those signs are
   * readable in daylight: a single 5 mm die at 20 mA cannot be read in direct sun, and
   * seven per pixel multiplies the output without growing the pixel.
   * Sub-LEDs are CIRCLES, because a real die is a round epoxy lens. Round packing does
 * not tile, so the interstitial gaps between dice are physically there on the board —
 * an octagon faked a tiling the real part doesn't have either, and lost the roundness
 * on the way. Hexagons would nest, but nothing in the part is a hexagon. */
  function buildMatrix(opts) {
    var M = NS.matrix;
    var t = opts.thickness;
    var w = FRAME.w, h = FRAME.h, m = FRAME.m;
    var pitch = (h - 2 * m) / M.ROWS;
    var gw = M.COLS * pitch;
    /* One full dot pitch between characters — the standard for 5x7 sign matrices, and
     * the reason a 5-wide glyph occupies a 6-wide slot. Split it either side so the
     * glyph is centred in its own cell. */
    var gx = pitch / 2;
    /* rings 0/1/2 -> 1 / 7 / 19 dice per pixel. Anything else isn't a whole flower. */
    var rings = (opts.rings === undefined) ? 1 : Math.max(0, Math.min(2, opts.rings));
    /* Size the whole cluster to a fixed share of the pitch, whatever the ring count,
     * so switching 1 -> 7 -> 19 changes the GRAIN and not the pixel size. */
    var fill = 0.78;
    var span = (pitch * fill) / 2;              /* cluster radius */
    var ledR = span / (rings * 2 + 1) * (t / 11);
    var spacing = ledR * 2.05;

    var segs = {};
    for (var r = 0; r < M.ROWS; r++) {
      for (var c = 0; c < M.COLS; c++) {
        segs['d' + r + c] = hexCluster(gx + (c + 0.5) * pitch,
                                       m + (r + 0.5) * pitch,
                                       rings, spacing, ledR);
      }
    }
    return {
      segs: segs,
      dp: null,
      frame: FRAME,
      pitch: pitch,
      contentW: gw + pitch
    };
  }

  /* Build every segment polygon for the given thickness/gap. */
  function build(opts) {
    if (opts && opts.type === '5x7') return buildMatrix(opts);
    var t  = opts.thickness;
    var g  = opts.gap;
    var hh = t / 2;
    var dw = hh * (opts.diagWidth || 0.95);

    var w = FRAME.w, h = FRAME.h, m = FRAME.m;
    var x0 = m, x1 = w - m, y0 = m, y1 = h - m;
    var cx = w / 2, cy = h / 2;

    /* Inner bounds for the diagonals: clear of the bars that box them in. */
    var ix0 = x0 + hh + g, ix1 = cx - hh - g;
    var ix2 = cx + hh + g, ix3 = x1 - hh - g;
    var iy0 = y0 + hh + g, iy1 = cy - hh - g;
    var iy2 = cy + hh + g, iy3 = y1 - hh - g;

    var segs = {
      /* outer frame */
      A:  hbar(x0, x1, y0, hh, g),
      A1: hbar(x0, cx, y0, hh, g),
      A2: hbar(cx, x1, y0, hh, g),
      B:  vbar(x1, y0, cy, hh, g),
      C:  vbar(x1, cy, y1, hh, g),
      D:  hbar(x0, x1, y1, hh, g),
      D1: hbar(x0, cx, y1, hh, g),
      D2: hbar(cx, x1, y1, hh, g),
      E:  vbar(x0, cy, y1, hh, g),
      F:  vbar(x0, y0, cy, hh, g),
      /* middle bars */
      G:  hbar(x0, x1, cy, hh, g),
      G1: hbar(x0, cx, cy, hh, g),
      G2: hbar(cx, x1, cy, hh, g),
      /* starburst interior, clockwise from upper-left per the OPD-AS5010 sheet */
      H:  diag(ix0, iy0, ix1, iy1, dw),
      J:  vbar(cx, y0, cy, hh, g),
      K:  diag(ix3, iy0, ix2, iy1, dw),
      L:  diag(ix2, iy2, ix3, iy3, dw),
      M:  vbar(cx, cy, y1, hh, g),
      N:  diag(ix1, iy2, ix0, iy3, dw)
    };

    /* The five junction segments of a 21-segment display. Not new strokes — the places
     * a 16-segment leaves open.
     *
     * 🅿️ PARKED, and known to be unfinished (JD's call, 2026-09-15). These are OVERLAID
     * on unchanged 16-segment geometry, so they physically overlap the bars they are
     * meant to join. On the real part the outer bars are visibly SHORTER to make room
     * for the corner chamfers. Doing it properly means build() becoming type-aware and
     * emitting a second set of bar lengths for '21' — a whole parallel geometry to keep
     * in step forever, for a format nobody standardised. The letterforms need work too.
     * It renders and the derivation is sound; it is not finished. Don't mistake it for
     * finished, and don't sink time into it without deciding it's worth that cost. */
    segs.CT = hub(cx, cy, hh * 1.95);
    segs.TL = corner(x0, y0,  1,  1, hh, g);
    segs.TR = corner(x1, y0, -1,  1, hh, g);
    segs.BL = corner(x0, y1,  1, -1, hh, g);
    segs.BR = corner(x1, y1, -1, -1, hh, g);

    var dpR = hh * 1.15;
    /* clear the bar's real right edge (x1 + hh), not its centre line */
    var dp = { cx: x1 + hh + (t * FRAME.dpClear) + dpR, cy: y1, r: dpR };

    return {
      segs: segs,
      dp: dp,
      frame: FRAME,
      contentW: dp.cx + dpR + FRAME.dpPad
    };
  }

  NS.geometry = {
    FRAME: FRAME,
    build: build,
    octagon: octagon,
    centroid: centroid,
    pointsAttr: pointsAttr
  };
})(window.LED);
