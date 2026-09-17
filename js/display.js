/* display.js — turns a segment set into an <svg> glyph. */
window.LED = window.LED || {};
(function (NS) {
  'use strict';

  var G = NS.geometry;
  var ORDER = NS.fonts.ORDER;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Skew about the vertical centre so the glyph leans without drifting sideways. */
  function skewTransform(deg) {
    if (!deg) return '';
    var cy = G.FRAME.h / 2;
    return 'translate(0,' + cy + ') skewX(' + (-deg) + ') translate(0,' + (-cy) + ')';
  }

  function skewPoint(pt, deg) {
    if (!deg) return pt;
    var cy = G.FRAME.h / 2;
    var t = Math.tan(deg * Math.PI / 180);
    return [pt[0] - (pt[1] - cy) * t, pt[1]];
  }

  /* One character cell. `set` is a map of segment name -> truthy. */
  function glyph(opts) {
    var geo = opts.geo;
    var type = opts.type;
    var set = opts.set || {};
    var deg = opts.slant || 0;

    var names = ORDER[type].filter(function (n) { return n !== 'DP'; });
    var geoOpts = { thickness: opts.thickness, gap: opts.gap, type: type };
    var pad = Math.abs(Math.tan(deg * Math.PI / 180)) * (G.FRAME.h / 2) + 2;
    var vb = (-pad) + ' 0 ' + (geo.contentW + 2 * pad) + ' ' + G.FRAME.h;

    var out = [];
    out.push('<svg class="glyph" data-index="' + opts.index + '" viewBox="' + vb +
             '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' +
             esc(opts.label || '') + '">');

    /* Transparent hit area: clicking dead space selects the glyph without toggling. */
    out.push('<rect class="hit" x="' + (-pad) + '" y="0" width="' +
             (geo.contentW + 2 * pad) + '" height="' + G.FRAME.h + '"/>');

    /* Lit and unlit go in separate groups. The bloom filter is applied once per glyph
     * to the lit group only — filtering the dark unlit segments would haze them up,
     * and per-segment filters would be 17x the work for identical output. */
    var tf = skewTransform(deg);
    var gOpen = '<g' + (tf ? ' transform="' + tf + '"' : '');

    function shape(n, lit) {
      if (n === 'DP') {
        return '<circle class="seg' + (lit ? ' on' : '') + '" data-seg="DP" cx="' +
               geo.dp.cx + '" cy="' + geo.dp.cy + '" r="' + geo.dp.r + '"/>';
      }
      var sh = geo.segs[n];
      var cls = 'seg' + (lit ? ' on' : '');
      /* A segment is one of three things:
       *   list of CIRCLES   {cx,cy,r}  — a dot-matrix pixel: a cluster of round dice
       *   list of POLYGONS  [[x,y]...] — a clustered polygonal emitter
       *   single POLYGON    [x,y]...   — every bar and diagonal
       * Discriminate on the first element: an object with .r, a point, or a number. */
      if (sh[0] && typeof sh[0].r === 'number') {
        return '<g class="' + cls + '" data-seg="' + n + '">' +
               sh.map(function (d) {
                 return '<circle cx="' + d.cx + '" cy="' + d.cy + '" r="' + d.r + '"/>';
               }).join('') + '</g>';
      }
      if (Array.isArray(sh[0][0])) {
        return '<g class="' + cls + '" data-seg="' + n + '">' +
               sh.map(function (poly) {
                 return '<polygon points="' + G.pointsAttr(poly) + '"/>';
               }).join('') + '</g>';
      }
      return '<polygon class="' + cls + '" data-seg="' + n +
             '" points="' + G.pointsAttr(sh) + '"/>';
    }

    var all = names.slice();
    if (opts.showDP !== false && ORDER[type].indexOf('DP') >= 0) all.push('DP');
    var lit = all.filter(function (n) { return set[n]; });
    var dark = all.filter(function (n) { return !set[n]; });

    out.push(gOpen + ' class="off">');
    for (var i = 0; i < dark.length; i++) out.push(shape(dark[i], false));
    out.push('</g>');

    if (lit.length) {
      out.push(gOpen + ' class="lit"' +
               (opts.bloom ? ' filter="url(#bloom)"' : '') + '>');
      for (var j = 0; j < lit.length; j++) out.push(shape(lit[j], true));
      out.push('</g>');
    }

    if (opts.labels) {
      out.push('<g class="seglabels">');
      for (var j = 0; j < names.length; j++) {
        var nm = names[j];
        var sh = geo.segs[nm];
        var pts = (sh[0] && typeof sh[0].r === 'number')
                  ? sh.map(function (d) { return [d.cx, d.cy]; })
                  : Array.isArray(sh[0][0]) ? [].concat.apply([], sh) : sh;
        var c = skewPoint(G.centroid(pts), deg);
        out.push('<text x="' + c[0].toFixed(1) + '" y="' + c[1].toFixed(1) +
                 '" dy="0.32em">' + nm + '</text>');
      }
      out.push('</g>');
    }

    out.push('</svg>');
    return out.join('');
  }

  /* Photographic bloom, modelled on what a camera actually does to a lit LED:
   *   halo   a wide, low-alpha blur   — the wash that lights up the whole board
   *   glow   a tight blur             — the saturated colour fringe
   *   core   a blurred-then-thresholded inset, pushed toward warm white
   *          — the blown-out sensor highlight, which is why it reads white, not red
   * The threshold is what makes the core an *inset* shape with a soft edge, rather
   * than an erode, which goes chunky at small radii. */
  function bloomFilter(bloom, blowout) {
    var rawB = Math.max(0, Math.min(1, (bloom || 0) / 100));
    var rawE = Math.max(0, Math.min(1, (blowout === undefined ? bloom : blowout) / 100));
    if (rawB <= 0 && rawE <= 0) return '';

    /* Gamma both so the mid-range carries its weight; a linear ramp spends most of its
     * travel looking nearly flat, and every useful setting lives between 30 and 75. */
    var b = Math.pow(rawB, 0.72);   /* SPREAD  — optics: scatter and flare */
    var e = Math.pow(rawE, 0.85);   /* CLIPPING — exposure: how far past saturation */

    /* Spread. Independent of exposure: a long exposure of a dim emitter is all halo
     * and stays fully saturated, which is exactly what a photographed nixie looks like. */
    var wide  = 2.4 + 18.5 * b;
    var mid   = 0.8 +  4.2 * b;
    var aHalo = 1.02 * b;
    var aGlow = 0.95 * b;

    /* Clipping. This is the only thing that desaturates, so keeping it on its own
     * control is what lets a heavy glow stay red instead of washing to white. */
    var coreBlr = 1.2 + 2.8 * e;
    var coreCut = -(3.0 - 1.0 * e);   /* lower cut = bigger blown core */
    var k       = 1.15 * e;

    /* Less lift in blue than in green keeps the highlight warm, the way film and CMOS
     * both go. A neutral-white core reads as CGI. */
    function lift(a) {
      return [1, 0, 0, 0, a,
              0, 1, 0, 0, a * 1.00,
              0, 0, 1, 0, a * 0.74,
              0, 0, 0, 1, 0].map(function (n) { return (+n).toFixed(3); }).join(' ');
    }

    /* The region is in glyph units, NOT a percentage of the lit group's bounding box.
     * A percentage follows whatever happens to be lit, so a '-' or a '1' - one thin
     * bar - got a region barely wider than the bar, and the halo was cut off in a
     * hard-edged strip. Nothing outside the SVG can fix that; padding and overflow
     * never reach the filter. Instead: the whole cell, plus four sigma of the widest
     * blur on every side, past which the halo is below one 8-bit step. contentW tops
     * out just under 140 (5x7 at maximum thickness), so 160 covers every type. */
    var reach = Math.ceil(4 * wide);
    var out = '<filter id="bloom" filterUnits="userSpaceOnUse"' +
              ' x="' + (-reach) + '" y="' + (-reach) + '"' +
              ' width="' + (160 + 2 * reach) + '" height="' + (G.FRAME.h + 2 * reach) + '"' +
              ' color-interpolation-filters="sRGB">';
    var merge = [];

    if (aHalo > 0.001) {
      out += '<feGaussianBlur in="SourceGraphic" stdDeviation="' + wide.toFixed(2) + '" result="w"/>' +
             '<feComponentTransfer in="w" result="halo">' +
               '<feFuncA type="linear" slope="' + aHalo.toFixed(3) + '"/></feComponentTransfer>';
      merge.push('halo');

      out += '<feGaussianBlur in="SourceGraphic" stdDeviation="' + mid.toFixed(2) + '" result="m"/>' +
             '<feComponentTransfer in="m" result="mg">' +
               '<feFuncA type="linear" slope="' + aGlow.toFixed(3) + '"/></feComponentTransfer>';
      /* The fringe: the mid glow lifted only PARTIALLY toward white, sitting under the
       * segment so it shows only as an edge band. That band is the orange/yellow stage
       * between a blown core and the coloured halo — leave it out and the gradient jumps
       * white -> red and reads as a vector drawing of a glow rather than a photograph.
       * It scales with clipping, not spread, because partial clipping is what causes it. */
      if (k > 0.001) {
        out += '<feColorMatrix in="mg" type="matrix" result="glow" values="' + lift(k * 0.34) + '"/>';
        merge.push('glow');
      } else {
        merge.push('mg');
      }
    }

    merge.push('SourceGraphic');

    if (k > 0.001) {
      /* Blur, threshold to an inset, then lift hard toward warm white. Threshold rather
       * than feMorphology erode: erode goes chunky at these radii and a real blown
       * highlight has a soft edge. */
      out += '<feGaussianBlur in="SourceGraphic" stdDeviation="' + coreBlr.toFixed(2) + '" result="cb"/>' +
             '<feComponentTransfer in="cb" result="cm">' +
               '<feFuncA type="linear" slope="5" intercept="' + coreCut.toFixed(2) + '"/></feComponentTransfer>' +
             '<feColorMatrix in="cm" type="matrix" result="core" values="' + lift(k) + '"/>';
      merge.push('core');
    }

    out += '<feMerge>' + merge.map(function (n) {
      return '<feMergeNode in="' + n + '"/>';
    }).join('') + '</feMerge></filter>';
    return out;
  }

  NS.display = { glyph: glyph, skewPoint: skewPoint, bloomFilter: bloomFilter };
})(window.LED);
