/* hdr.js — real HDR emission for the lit segments.
 *
 * SVG cannot do this. Neither can CSS: as of 2026 no browser renders
 * color(rec2100-pq ...), and every sRGB/P3 colour tops out at SDR white by
 * definition. A WebGPU canvas configured `rgba16float` + toneMapping
 * `extended` is the only path that puts a value above 1.0 on the glass, and
 * on an XDR that value is genuinely brighter than white.
 *
 * Architecture, and the reason it is a post-process rather than a rewrite:
 * the SVG stays the source of truth for SHAPE. This module rasterizes the LIT
 * segments to a white-on-nothing mask, blurs it in linear light, and paints
 * emitter colour x brightness into a float canvas sitting UNDER the glyphs.
 * The SVG's own lit group is hidden by CSS; its unlit dice stay visible and
 * mostly transparent, so the halo washes over them the way it should.
 *
 * That split mirrors the physics: the SVG is the die layout, the canvas is
 * the photon transport.
 *
 * Writing convention: the canvas colour space is sRGB, so values must be
 * sRGB-ENCODED with the curve extended past 1.0 — not linear. Getting this
 * backwards is exactly the bug class that makes an image look washed out.
 */
window.LED = window.LED || {};
(function (NS) {
  'use strict';

  var SDR_WHITE_NITS = 203;     /* reference white, same convention as CSS/HDR specs */

  var state = {
    ready: false,               /* WebGPU device up and pipelines built */
    initPromise: null,
    device: null,
    ctx: null,
    canvas: null,
    sampler: null,
    pipeDown: null,
    pipeUp: null,
    pipeOut: null,
    mips: [], near: null,
    maskW: 0, maskH: 0,
    uboOut: null,
    pending: 0,
    error: null,           /* why the path failed, verbatim, for the status line */
    maskStat: null
  };

  /* ---------------------------------------------------------------- shaders */

  var VS = [
    'struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };',
    '@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {',
    '  var p = array<vec2f,3>(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0));',
    '  var o: VSOut;',
    '  o.pos = vec4f(p[i], 0.0, 1.0);',
    '  o.uv  = vec2f((p[i].x + 1.0) * 0.5, 1.0 - (p[i].y + 1.0) * 0.5);',
    '  return o;',
    '}'
  ].join('\n');

  /* DOWNSAMPLE — the 13-tap filter from Jimenez's "Next Generation Post
   * Processing" (SIGGRAPH 2014). A naive 2x box sampled down an octave chain
   * produces exactly the crawling blocky artefacts a big-sigma single-pass
   * Gaussian does; the 13-tap partial-overlap kernel is the standard fix. */
  var DOWN = VS + [
    '',
    'struct P { texel: vec2f, pad: vec2f };',
    '@group(0) @binding(0) var samp: sampler;',
    '@group(0) @binding(1) var src: texture_2d<f32>;',
    '@group(0) @binding(2) var<uniform> p: P;',
    '',
    '@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {',
    '  let t = p.texel;',
    '  let a = textureSample(src, samp, uv + vec2f(-2.0,-2.0) * t);',
    '  let b = textureSample(src, samp, uv + vec2f( 0.0,-2.0) * t);',
    '  let c = textureSample(src, samp, uv + vec2f( 2.0,-2.0) * t);',
    '  let d = textureSample(src, samp, uv + vec2f(-2.0, 0.0) * t);',
    '  let e = textureSample(src, samp, uv);',
    '  let f = textureSample(src, samp, uv + vec2f( 2.0, 0.0) * t);',
    '  let g = textureSample(src, samp, uv + vec2f(-2.0, 2.0) * t);',
    '  let h = textureSample(src, samp, uv + vec2f( 0.0, 2.0) * t);',
    '  let i = textureSample(src, samp, uv + vec2f( 2.0, 2.0) * t);',
    '  let j = textureSample(src, samp, uv + vec2f(-1.0,-1.0) * t);',
    '  let k = textureSample(src, samp, uv + vec2f( 1.0,-1.0) * t);',
    '  let l = textureSample(src, samp, uv + vec2f(-1.0, 1.0) * t);',
    '  let m = textureSample(src, samp, uv + vec2f( 1.0, 1.0) * t);',
    '  var o = e * 0.125;',
    '  o = o + (a + c + g + i) * 0.03125;',
    '  o = o + (b + d + f + h) * 0.0625;',
    '  o = o + (j + k + l + m) * 0.125;',
    '  return o;',
    '}'
  ].join('\n');

  /* UPSAMPLE — 3x3 tent, blended ADDITIVELY back up the chain. Summing
   * octave-spaced blurs is what produces a heavy-tailed point spread: measured
   * on a real PQ photo of neon (docs/WideGamut-Neon-DisplayP3-HDR.avif) the
   * glow has a broad shoulder out to ~32px and then a roughly r^-2.5 tail. A
   * single Gaussian cannot be both tight in the core and that wide in the
   * skirt; a mip pyramid is the cheap standard approximation. */
  var UP = VS + [
    '',
    'struct P { texel: vec2f, radius: f32, weight: f32 };',
    '@group(0) @binding(0) var samp: sampler;',
    '@group(0) @binding(1) var src: texture_2d<f32>;',
    '@group(0) @binding(2) var<uniform> p: P;',
    '',
    '@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {',
    '  let t = p.texel * p.radius;',
    '  var o = textureSample(src, samp, uv) * 4.0;',
    '  o = o + (textureSample(src, samp, uv + vec2f(-1.0, 0.0) * t)',
    '        +  textureSample(src, samp, uv + vec2f( 1.0, 0.0) * t)',
    '        +  textureSample(src, samp, uv + vec2f( 0.0,-1.0) * t)',
    '        +  textureSample(src, samp, uv + vec2f( 0.0, 1.0) * t)) * 2.0;',
    '  o = o + (textureSample(src, samp, uv + vec2f(-1.0,-1.0) * t)',
    '        +  textureSample(src, samp, uv + vec2f( 1.0,-1.0) * t)',
    '        +  textureSample(src, samp, uv + vec2f(-1.0, 1.0) * t)',
    '        +  textureSample(src, samp, uv + vec2f( 1.0, 1.0) * t));',
    '  return o * (1.0 / 16.0) * p.weight;',
    '}'
  ].join('\n');

  /* COMPOSITE - where the photography happens.
   *
   * Three physical things, three controls:
   *   BLOOM    spatial spread of the glare            (optics)
   *   BLOWOUT  exposure: how far the radiance is      (sensor)
   *            driven over the camera knee
   *   HDR      peak display brightness, x SDR white   (display)
   *
   * Two corrections over the first attempt, both of which were making the dice
   * render as flat slabs:
   *
   * 1. A HARD min() against the ceiling is the wrong shape. The neon reference
   *    has 1504 nits at the tube centre and 1062 four pixels out; a hard clip
   *    would give the same number at both. A per-channel soft shoulder keeps
   *    that difference. Per-CHANNEL is the part that matters: it is what makes
   *    a red emitter go red -> orange -> white as it saturates, which is the
   *    photographic signature. A chromaticity-preserving tone map would erase it.
   *
   * 2. There is no broadband "glare pedestal" any more. Adding a constant to
   *    every channel desaturated the skirt - precisely where the reference is
   *    MOST saturated (0.968) - and still could not reach the measured core
   *    (0.80). Correct overdrive plus per-channel compression produces the
   *    desaturation on its own, in the right place.
   *
   * The knee sits at 1.0 and the result is scaled to `boost` afterwards, so the
   * look is decided by the camera model and not by wherever the OS happens to
   * clamp the display's EDR headroom. */
  var OUT = VS + [
    '',
    'struct OP { colour: vec4f, exposure: f32, haloGain: f32, nearGain: f32, boost: f32,',
    '             ambient: f32, bodyDesat: f32, pad1: f32, pad2: f32 };',
    '@group(0) @binding(0) var samp: sampler;',
    '@group(0) @binding(1) var texMask: texture_2d<f32>;',
    '@group(0) @binding(2) var texHalo: texture_2d<f32>;',
    '@group(0) @binding(3) var texNear: texture_2d<f32>;',
    '@group(0) @binding(4) var<uniform> op: OP;',
    '',
    'fn encExt(v: f32) -> f32 {',
    '  let a = abs(v);',
    '  var e = 1.055 * pow(a, 1.0 / 2.4) - 0.055;',
    '  if (a <= 0.0031308) { e = a * 12.92; }',
    '  if (v < 0.0) { return -e; }',
    '  return e;',
    '}',
    '',
    '@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {',
    '  let cover = textureSample(texMask, samp, uv).r;',   /* carries the dome */
    '  let halo  = textureSample(texHalo, samp, uv).r;',
    /* Near-field scatter through the shared epoxy/diffuser. Without it each die
       is an island and a 7-die cluster reads as seven separate discs; with it
       the dice bleed together and the middle of a cluster accumulates light
       from all six neighbours instead of just its own. */
    '  let near  = textureSample(texNear, samp, uv).r;',
    '  let body  = textureSample(texMask, samp, uv).g;',
    '  let rad   = (cover + near * op.nearGain + halo * op.haloGain) * op.exposure;',
    /* The unlit body reflects, it does not emit - so it is added AFTER the
       glare terms and never enters the pyramid. */
    '  let emis  = op.colour.rgb * rad;',
    '  let tone  = emis / (1.0 + emis);',                  /* per channel, knee at 1 */
    /* The body is added after the TONE CURVE but inside the BOOST, and the
       distinction matters. The tone curve is the camera: an unlit die must not
       be pushed through a shoulder built for emission. The boost is DISPLAY
       GAIN over the whole scene - brighten a photograph and its dark parts
       brighten with it. Leaving the body outside the boost was wrong and it is
       why these vanished on an actual HDR panel: lit dice at ~1150 nits against
       unlit at ~11 was a 100:1 ratio that reads as pure black, even though an
       SDR readback of the same frame showed a perfectly reasonable 4:1. */
    /* An unlit die is a red-tinted epoxy dome reflecting room light, not a red
       LIGHT. Diffuse plastic is a poor colour filter and the dome adds a broad
       specular, so the off state reads much greyer than the on state. Mixing
       toward the colour's own LUMINANCE desaturates without changing perceived
       brightness, which keeps the two knobs independent. */
    '  let lum   = dot(op.colour.rgb, vec3f(0.2126, 0.7152, 0.0722));',
    '  let tint  = mix(op.colour.rgb, vec3f(lum), op.bodyDesat);',
    '  let disp  = tone * op.boost + tint * (body * op.ambient);',
    /* opaque canvas: rgb > alpha is undefined for a premultiplied surface, and
       the halo was exactly where that bit. The panel is black, so black is the
       correct background and we simply draw it. */
    '  return vec4f(encExt(disp.r), encExt(disp.g), encExt(disp.b), 1.0);',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------ capability */

  function displayIsHDR() {
    try { return !!(window.matchMedia && matchMedia('(dynamic-range: high)').matches); }
    catch (e) { return false; }
  }

  function diagnose() {
    return {
      'WebGPU present': !!navigator.gpu,
      'display dynamic-range: high': displayIsHDR(),
      'float canvas + extended tone map': state.ready,
      error: state.error,
      mask: state.maskStat || null
    };
  }

  /* One-time device + pipeline setup. Resolves true if the whole path works. */
  function init(canvas) {
    /* Memoize the PROMISE, not a boolean. Setting a `tried` flag up front and
     * returning Promise.resolve(state.ready) means any call arriving while the
     * first is still in flight gets `false` - and since a failed update turns
     * HDR back off, enabling it and then typing immediately would silently
     * switch it off again. render() calls this on every keystroke. */
    if (state.initPromise) return state.initPromise;
    if (!navigator.gpu || !canvas) return Promise.resolve(false);

    state.initPromise = navigator.gpu.requestAdapter().then(function (adapter) {
      return adapter && adapter.requestDevice();
    }).then(function (device) {
      if (!device) return false;
      var ctx = canvas.getContext('webgpu');
      if (!ctx) return false;

      ctx.configure({
        device: device,
        format: 'rgba16float',                 /* float target: holds values > 1.0 */
        toneMapping: { mode: 'extended' },     /* ... and shows them as brighter than white */
        alphaMode: 'opaque'
      });

      function pipe(code, blend) {
        var mod = device.createShaderModule({ code: code });
        return device.createRenderPipeline({
          layout: 'auto',
          vertex: { module: mod, entryPoint: 'vs' },
          fragment: {
            module: mod, entryPoint: 'fs',
            targets: [{ format: 'rgba16float', blend: blend || undefined }]
          },
          primitive: { topology: 'triangle-list' }
        });
      }
      var ADD = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };

      /* Shader and pipeline problems surface as a validation error on the
       * device, not as a thrown exception, so a plain try/catch loses them
       * completely and the UI can only say "it didn't work". Scope them. */
      device.pushErrorScope('validation');
      state.pipeDown = pipe(DOWN);
      state.pipeUp = pipe(UP, ADD);
      state.pipeOut = pipe(OUT);
      state.sampler = device.createSampler({
        magFilter: 'linear', minFilter: 'linear',
        addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge'
      });
      state.uboOut = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

      state.device = device; state.ctx = ctx; state.canvas = canvas;

      return device.popErrorScope().then(function (err) {
        if (err) { state.error = err.message; state.ready = false; return false; }
        state.ready = true;
        return true;
      });
    }).catch(function (e) {
      state.error = String((e && e.message) || e);
      return false;
    });
    return state.initPromise;
  }

  /* -------------------------------------------------------------- the mask */

  /* Rasterize the LIT segments of every glyph in `face` into one white-on-clear
   * bitmap the size of the face. Layout comes from the browser - we read each
   * glyph's measured rect rather than re-deriving flex positions, because the
   * browser's answer is the one that's actually on screen. */
  function buildMask(face, dpr, canvas) {
    var glyphs = face.querySelectorAll('svg.glyph');
    /* The canvas lives inside the face, so its size from the LAST frame counts
     * toward scrollWidth: the mask could grow with the window but never shrink
     * back. Every measurement below is taken without it, and it comes back
     * before this function yields, so nothing paints in between. */
    if (canvas) canvas.style.display = 'none';
    var fr = face.getBoundingClientRect();
    var w = Math.max(1, Math.round(face.scrollWidth * dpr));
    var scrollLeft = face.scrollLeft;
    var h = Math.max(1, Math.round(fr.height * dpr));

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var g2 = cv.getContext('2d');

    /* Page CSS does not reach a serialized standalone SVG, so the emission
     * rules travel with it. `.off` is dropped entirely and the bloom filter
     * reference is stripped - the pyramid below replaces it, in linear light. */
    /* THE PROFILE LIVES HERE. A binary mask makes every pixel of a die identical,
     * so the tone curve treats them identically and the whole die renders as one
     * flat slab - which is exactly what it was doing. A real diffused die is a
     * dome: bright at the centre, roughly 4x down at the rim. Baking that into
     * the mask as a radial gradient gives the compressor something to bite on,
     * so the centre rolls over the knee and desaturates while the rim stays
     * under it and stays saturated. That difference IS the photograph.
     *
     * The INTERNAL RANGE has to be large - about 40:1 here, not the 4:1 a naive
     * dome gives. For a deep red emitter the core must sit roughly 30x over the
     * knee before it reads white, while the rim sits near 1x and stays red. A
     * gentle dome simply never spans that, and every part of the die ends up on
     * the same bit of the tone curve. Physically it is the right shape too: the
     * emitting chip is tiny compared with the package, so a tight bright core on
     * a broad dim body is what the part actually looks like.
     *
     *   0.025 + 0.22*(1-t^2)^1.5 + 0.755*exp(-(t/0.28)^2)
     *
     * Stops are that coefficient written as 8-bit greys, because the mask is
     * sampled rgba8unorm and never decoded - the value IS the multiplier, not
     * an sRGB colour. */
    /* Two gradients into two CHANNELS of one mask.
     *
     *   R = lit emission, the steep 40:1 chip-on-a-body profile
     *   G = unlit die BODY - dark plastic catching room light
     *
     * Separating them matters because only R feeds the glare pyramid: an unlit
     * die is not a light source and must not bloom. But it is still an object,
     * clearly visible on a real part, and drawing it here rather than leaving it
     * to a CSS tint means it gets the same dome shading as its lit neighbours
     * and sits at a level chosen against them rather than against the page. */
    var defs = '<defs>' +
      '<radialGradient id="die" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0"    stop-color="#ff0000"/>' +
      '<stop offset="0.10" stop-color="#e70000"/>' +
      '<stop offset="0.20" stop-color="#af0000"/>' +
      '<stop offset="0.30" stop-color="#740000"/>' +
      '<stop offset="0.40" stop-color="#4a0000"/>' +
      '<stop offset="0.55" stop-color="#2b0000"/>' +
      '<stop offset="0.70" stop-color="#1b0000"/>' +
      '<stop offset="0.85" stop-color="#0f0000"/>' +
      '<stop offset="1"    stop-color="#060000"/>' +
      '</radialGradient>' +
      /* the unlit body is a diffuse dome, not an emitter: far gentler */
      '<radialGradient id="dieoff" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0"    stop-color="#00ff00"/>' +
      '<stop offset="0.5"  stop-color="#00d900"/>' +
      '<stop offset="0.8"  stop-color="#00a600"/>' +
      '<stop offset="1"    stop-color="#007300"/>' +
      '</radialGradient></defs>';
    var style = defs + '<style>' +
      '.seg{fill:none;stroke:none}' +
      '.lit .seg{fill:url(#die)}' +
      '.off .seg{fill:url(#dieoff)}' +
      '.hit{fill:none}.seglabels{display:none}' +
      '</style>';

    var jobs = [];
    for (var i = 0; i < glyphs.length; i++) {
      (function (el) {
        var r = el.getBoundingClientRect();
        var cw = Math.max(1, Math.round(r.width * dpr));
        var ch = Math.max(1, Math.round(r.height * dpr));
        var clone = el.cloneNode(true);
        var litG = clone.querySelector('g.lit');
        if (litG) litG.removeAttribute('filter');
        clone.setAttribute('width', cw);
        clone.setAttribute('height', ch);
        /* Injected into the SERIALIZED string, not through insertAdjacentHTML:
         * that parses as HTML, which lowercases tag names, and `radialGradient`
         * would arrive as an invalid `radialgradient`. Text substitution has no
         * opinion about namespaces. */
        var markup = new XMLSerializer().serializeToString(clone)
                       .replace(/(<svg[^>]*>)/, '$1' + style);
        var src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
        jobs.push(new Promise(function (res) {
          var img = new Image();
          img.onload = function () {
            g2.drawImage(img, Math.round((r.left - fr.left + scrollLeft) * dpr),
                              Math.round((r.top - fr.top) * dpr), cw, ch);
            res();
          };
          img.onerror = function () { res(); };
          img.src = src;
        }));
      })(glyphs[i]);
    }
    if (canvas) canvas.style.display = '';
    return Promise.all(jobs).then(function () {
      /* Cheap liveness stat. An empty mask renders a perfectly black panel and
       * looks exactly like "HDR is broken", so measure it rather than guess. */
      try {
        var sub = g2.getImageData(0, 0, w, h).data;
        var lit = 0, lo = 255, hi = 0, sum = 0, body = 0, bhi = 0;
        for (var k = 0; k < sub.length; k += 4 * 13) {
          if (sub[k + 3] > 8) {
            var v = sub[k], vg = sub[k + 1];
            lit++; sum += v;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
            if (vg > 8) { body++; if (vg > bhi) bhi = vg; }
          }
        }
        /* lo === hi would mean the die profile did not take and every lit pixel
         * is identical - the exact condition that made this render flat slabs. */
        state.maskStat = { w: w, h: h, glyphs: glyphs.length, litSamples: lit,
                           emit: lit ? (lo + '..' + hi + ' mean ' + Math.round(sum / lit)) : 'none',
                           body: body + ' px, peak ' + bhi };
      } catch (e) { state.maskStat = { w: w, h: h, glyphs: glyphs.length, litSamples: -1 }; }
      return cv;
    });
  }

  /* ------------------------------------------------------- the mip pyramid */

  var LEVELS = 6;   /* six octaves ~= a 64px skirt at the base resolution */

  function destroyChain() {
    (state.mips || []).forEach(function (m) { if (m.tex) m.tex.destroy(); });
    state.mips = [];
    if (state.near) { state.near.destroy(); state.near = null; }
  }

  function ensureTextures(w, h) {
    var d = state.device;
    if (state.maskW === w && state.maskH === h && state.mips && state.mips.length) return;
    destroyChain();

    var RT = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
    var mips = [];
    /* level 0 is the mask itself, written from the 2D canvas */
    mips.push({
      tex: d.createTexture({ size: [w, h], format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | RT }),
      w: w, h: h,
      ubo: d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      uboUp: d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    });
    var lw = w, lh = h;
    for (var i = 1; i <= LEVELS; i++) {
      lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
      mips.push({
        tex: d.createTexture({ size: [lw, lh], format: 'rgba16float',
          usage: RT | GPUTextureUsage.COPY_SRC }),
        w: lw, h: lh,
        ubo: d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        uboUp: d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      });
      if (lw === 1 && lh === 1) break;
    }
    /* A snapshot of level 1 taken BEFORE the up-chain runs. Level 1 itself
     * becomes the accumulated wide glare, so the short-range bleed has to be
     * captured first or it would be the same texture twice. */
    state.near = d.createTexture({
      size: [mips[1].w, mips[1].h], format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    state.mips = mips;
    state.maskW = w; state.maskH = h;
  }

  function pass(enc, pipe, view, entries, load) {
    var p = enc.beginRenderPass({
      colorAttachments: [{
        view: view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: load ? 'load' : 'clear',
        storeOp: 'store'
      }]
    });
    p.setPipeline(pipe);
    p.setBindGroup(0, state.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0), entries: entries
    }));
    p.draw(3);
    p.end();
  }

  /* ---------------------------------------------------------------- public */

  function hexToLinear(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    var n = m ? parseInt(m[1], 16) : 0xff2d17;
    function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
  }

  /* opts: { face, canvas, color, boost, blowout, bloom } */
  function update(opts) {
    var face = opts.face, canvas = opts.canvas;
    if (!canvas) return Promise.resolve(false);
    return init(canvas).then(function (ok) {
      if (!ok) return false;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var token = ++state.pending;
      return buildMask(face, dpr, canvas).then(function (maskCanvas) {
        if (token !== state.pending) return true;   /* a newer render superseded us */
        var d = state.device;
        var w = maskCanvas.width, h = maskCanvas.height;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        canvas.style.width = (w / dpr) + 'px';
        canvas.style.height = (h / dpr) + 'px';

        ensureTextures(w, h);
        var mips = state.mips;
        d.queue.copyExternalImageToTexture({ source: maskCanvas }, { texture: mips[0].tex }, [w, h]);

        var enc = d.createCommandEncoder();

        /* --- down the pyramid: each level is a 13-tap reduction of the one above */
        for (var i = 1; i < mips.length; i++) {
          d.queue.writeBuffer(mips[i].ubo, 0, new Float32Array([1 / mips[i - 1].w, 1 / mips[i - 1].h, 0, 0]));
          pass(enc, state.pipeDown, mips[i].tex.createView(), [
            { binding: 0, resource: state.sampler },
            { binding: 1, resource: mips[i - 1].tex.createView() },
            { binding: 2, resource: { buffer: mips[i].ubo } }
          ]);
        }

        /* --- snapshot the fine level for the near-field bleed, before the
         *     up-chain turns it into the accumulated glare */
        enc.copyTextureToTexture({ texture: mips[1].tex }, { texture: state.near },
                                 [mips[1].w, mips[1].h]);

        /* --- back up, adding each level into the one below.
         *
         * The weight per step is the whole ball game. Adding every octave at
         * full strength puts EQUAL ENERGY PER OCTAVE into the result, and equal
         * energy per octave is a FLAT log-log profile - measured at slope -0.1
         * to -0.4, i.e. a shapeless wash with no core. Real glare is not flat.
         *
         * Because the steps cascade, a step weight of w applied going from level
         * j into j-1 means level n reaches level 1 multiplied by the product of
         * the weights below it. Letting that step weight ITSELF decay makes the
         * profile steepen with distance, which is what the neon reference does:
         * a shallow shoulder out to ~32px, then a steep tail.
         *
         *   step 2<-3  0.72   ->  slope log2(0.72) = -0.47   (the shoulder)
         *   step 3<-4  0.45   ->  -1.16
         *   step 4<-5  0.28   ->  -1.85
         *   step 5<-6  0.17   ->  -2.54                      (the tail)
         *
         * against measured neon: -0.3 shoulder, -2.5 to -3.5 tail.
         *
         * BLOOM now moves the decay, not the tap radius. That matters: a 3x3
         * tent sampled at radius 3.5 undersamples badly and produces exactly the
         * blocky, crawling glow it was meant to avoid. The radius stays near 1
         * where the kernel is honest, and width comes from how much energy the
         * coarse levels are allowed to keep. */
        var radius = 1.0 + (opts.bloom / 100) * 0.35;
        var base = 0.70;
        /* Verified by simulating this exact cascade in linear light: sweeping
         * decay 0.35 -> 0.85 moves the measured log-log slope from -4.9 to -2.7
         * while near-field brightness changes only 19%. So Bloom is SPREAD, and
         * the wide end lands on the neon reference's measured tail of -2.5/-3.5.
         * Holding `base` fixed is what keeps brightness out of it. */
        var decay = 0.35 + (opts.bloom / 100) * 0.50;
        for (var j = mips.length - 1; j >= 2; j--) {
          var weight = base * Math.pow(decay, j - 2);
          d.queue.writeBuffer(mips[j].uboUp, 0,
            new Float32Array([1 / mips[j - 1].w, 1 / mips[j - 1].h, radius, weight]));
          pass(enc, state.pipeUp, mips[j - 1].tex.createView(), [
            { binding: 0, resource: state.sampler },
            { binding: 1, resource: mips[j].tex.createView() },
            { binding: 2, resource: { buffer: mips[j].uboUp } }
          ], true);
        }

        /* --- composite. Bloom is spread (baked into the pyramid above),
         * Blowout is exposure, HDR is peak display brightness. Nothing shares
         * a knob any more.
         *
         * The exposure range is chosen from a linear-light sweep: below ~1x the
         * dice read as deep saturated red with obvious doming, and by ~13x the
         * core has rolled over and gone pale. Both ends are real photographic
         * states, so the slider spans them rather than living at one end. */
        var col = hexToLinear(opts.color);
        /* Exposure is geometric with an extra kick at the very top.
         *
         * A deep red emitter desaturates slowly, because its B channel starts at
         * 0.0086 of R and has to climb all the way to the knee before the core
         * reads white. Measured for #ff2d17: 48x the knee only reaches sat 0.70
         * (still obviously red), 150x reaches 0.43, and ~576x reaches 0.167.
         * So the top of the slider needs to be far hotter than a plain geometric
         * ramp would make it.
         *
         * The `b^4` term does that without disturbing the rest: below 50 it is
         * within 15% of the plain ramp, so settings that already look right stay
         * where they were, and it only runs away in the last third.
         *
         *   blowout    exposure   core sat   rim sat
         *       50         5.1      0.950     0.990
         *       75        31.8      0.779     0.985
         *      100       576.0      0.167     0.883
         *
         * Note the rim: still 0.883 at full blowout. The core goes white while
         * the edge of the same die stays red, which is the whole effect. */
        var b = opts.blowout / 100;
        var exposure = 0.4 * Math.pow(120, b) * Math.pow(12, b * b * b * b);
        var haloGain = 0.16 + (opts.bloom / 100) * 0.10;
        var nearGain = 0.55;
        /* Brightness of an unlit die body.
         *
         * Coupling this to `boost` LINEARLY was wrong in the other direction:
         * the boost slider is the peak brightness of the LIT segments, and
         * turning the LEDs up does not make the room brighter. But leaving it
         * fixed made them vanish once the lit dice reached four figures of nits.
         * A gentle power keeps them legible across the range without competing:
         * at the default level that is 0.05 at x1, 0.087 at x4, 0.115 at x8. Not
         * coupled to EXPOSURE at all - that slider spans 1400:1 and would blow
         * them out at the top. The Unlit slider scales the whole thing. */
        var ambient = (opts.unlit / 100) * 0.11 * Math.pow(opts.boost, 0.4);
        var bodyDesat = 0.7;
        d.queue.writeBuffer(state.uboOut, 0, new Float32Array([
          col[0], col[1], col[2], 1,
          exposure, haloGain, nearGain, opts.boost,
          ambient, bodyDesat, 0, 0
        ]));

        pass(enc, state.pipeOut, state.ctx.getCurrentTexture().createView(), [
          { binding: 0, resource: state.sampler },
          { binding: 1, resource: mips[0].tex.createView() },
          { binding: 2, resource: mips[1].tex.createView() },
          { binding: 3, resource: state.near.createView() },
          { binding: 4, resource: { buffer: state.uboOut } }
        ]);

        d.queue.submit([enc.finish()]);
        return true;
      });
    }).catch(function () { return false; });
  }

  NS.hdr = {
    /* exported so a headless harness can compile them and surface WGSL errors,
     * which init() would otherwise swallow in its catch */
    __shaders: { DOWN: DOWN, UP: UP, OUT: OUT },
    update: update,
    init: init,
    diagnose: diagnose,
    displayIsHDR: displayIsHDR,
    isReady: function () { return state.ready; },
    SDR_WHITE_NITS: SDR_WHITE_NITS
  };
})(window.LED);
