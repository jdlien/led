/* app.js — UI wiring. */
(function () {
  'use strict';

  var G = window.LED.geometry;
  var F = window.LED.fonts;
  var D = window.LED.display;

  var STORE = 'segmentsim.v1';

  /* Emitter presets. Colour AND bloom, because the two aren't independent — a nixie
   * glows through neon gas and blooms far more than a GaP die does, and a VFD's
   * phosphor has a softer edge than either. Hexes are the conventional emulator
   * approximations, not colorimetric measurements. */
  var PRESETS = [
    { id: 'led-red',   name: 'LED \u00b7 GaAsP red',  color: '#ff2d17', bloom: 55, blowout: 42 },
    { id: 'led-amber', name: 'LED \u00b7 amber',      color: '#ff8c12', bloom: 48, blowout: 38 },
    { id: 'led-green', name: 'LED \u00b7 GaP green',  color: '#8dff3c', bloom: 48, blowout: 38 },
    { id: 'led-blue',  name: 'LED \u00b7 InGaN blue', color: '#3fb9ff', bloom: 54, blowout: 52 },
    { id: 'vfd',       name: 'VFD \u00b7 cyan',       color: '#6ff2ff', bloom: 66, blowout: 46 },
    { id: 'p3',        name: 'CRT \u00b7 P3 amber',   color: '#ffb000', bloom: 42, blowout: 22 },
    { id: 'p1',        name: 'CRT \u00b7 P1 green',   color: '#33ff5e', bloom: 42, blowout: 22 },
    /* Nixies are the case that proves the two controls are separate: huge orange
     * glow, and the tubes never go white. High bloom, low blowout. */
    { id: 'nixie',     name: 'Nixie \u00b7 neon',     color: '#ff8b3d', bloom: 80, blowout: 26 },
    { id: 'plasma',    name: 'Plasma \u00b7 orange',  color: '#ff6a17', bloom: 64, blowout: 34 }
  ];

  var H = window.LED.hdr;

  var state = {
    text: 'SEGMENT 16.',
    type: '16',
    style: 'classic',
    color: '#ff2d17',
    bloom: 55,
    blowout: 42,
    hdr: false,
    hdrBoost: 3,
    preset: 'led-red',
    rings: 1,
    slant: 0,
    size: 140,
    thick: 11,
    gap: 2.6,
    unlit: 45,
    labels: false,
    slashZero: false,
    lowercase: true,
    variants: {},
    overrides: {},
    selected: null,
    shot: false
  };

  var $ = function (s) { return document.querySelector(s); };
  var face = $('#face');
  var inspector = $('#inspector');
  var hint = $('#hint');

  /* ------------------------------------------------------------- helpers */

  function hexRGB(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgba(hex, a) {
    var c = hexRGB(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  /* Unlit segments are tinted plastic reflecting room light, not a dim version
   * of the emitter, so they read much greyer. Mixing toward the colour's own
   * luminance desaturates without changing how bright it looks. */
  function bodyTint(hex, amount) {
    var c = hexRGB(hex);
    var lum = Math.round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
    return c.map(function (v) { return Math.round(v + (lum - v) * amount); });
  }

  /* Split text into cells. A '.' folds onto the previous cell as its decimal
   * point, exactly like a real multiplexed module with a DP per digit. */
  function glyphList() {
    var out = [];
    var chars = Array.from(state.text);
    /* Only fold '.' onto the previous cell when the display actually HAS a decimal point.
     * A dot matrix doesn't — there the period is an ordinary glyph, and folding it made
     * it vanish entirely: the flag was set and nothing was listening. */
    var hasDP = F.ORDER[state.type].indexOf('DP') >= 0;
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (ch === '.' && hasDP) {
        if (out.length && !out[out.length - 1].dp) { out[out.length - 1].dp = true; continue; }
        out.push({ ch: ' ', dp: true });
        continue;
      }
      out.push({ ch: ch, dp: false });
    }
    if (!out.length) out = [{ ch: ' ', dp: false }, { ch: ' ', dp: false },
                            { ch: ' ', dp: false }, { ch: ' ', dp: false }];
    return out;
  }

  function fontInfo(g, index) {
    return F.lookup(state.type, g.ch, state.variants[index], state.style, state.lowercase);
  }

  function baseSet(g, index) {
    var look = fontInfo(g, index);
    var spec = look.spec;
    if (state.slashZero && g.ch === '0' && state.type !== '7') spec += ' K N';
    var set = F.specToSet(spec);
    if (g.dp) set.DP = true;
    return set;
  }

  function effectiveSet(g, index) {
    var ov = state.overrides[index];
    if (ov) {
      var copy = {};
      Object.keys(ov).forEach(function (k) { if (ov[k]) copy[k] = true; });
      return copy;
    }
    return baseSet(g, index);
  }

  /* ------------------------------------------------------------- rendering */

  function applyTheme() {
    var r = document.documentElement.style;
    r.setProperty('--led', state.color);
    var off = bodyTint(state.color, 0.7);
    r.setProperty('--led-off', 'rgba(' + off[0] + ',' + off[1] + ',' + off[2] + ',' +
                  ((state.unlit / 100) * 0.30).toFixed(3) + ')');
    r.setProperty('--led-glow', rgba(state.color, 0.55));
    r.setProperty('--glyph-h', state.size + 'px');
    document.body.classList.toggle('noghost', state.unlit <= 0);

    var defs = document.getElementById('bloomdefs');
    if (defs) defs.innerHTML = D.bloomFilter(state.bloom, state.blowout);
  }

  function render() {
    applyTheme();

    var geo = G.build({ thickness: state.thick, gap: state.gap, type: state.type, rings: state.rings });
    var list = glyphList();
    var html = '';

    for (var i = 0; i < list.length; i++) {
      html += D.glyph({
        index: i,
        geo: geo,
        type: state.type,
        set: effectiveSet(list[i], i),
        slant: state.slant,
        bloom: state.bloom || state.blowout,
        labels: state.labels,
        label: list[i].ch
      });
    }
    face.innerHTML = html;

    if (state.selected !== null && state.selected < list.length) {
      var el = face.querySelector('.glyph[data-index="' + state.selected + '"]');
      if (el) el.classList.add('sel');
    } else {
      state.selected = null;
    }

    var rf = document.getElementById('ringsField');
    if (rf) rf.hidden = (state.type !== '5x7');
    paintHDR();
    updateHint(list);
    renderInspector(list);
    save();
  }

  /* Two display FAMILIES now share one app, and that changes what "missing" means.
   * On a segment display a missing character is usually a STATEMENT ABOUT THE PART —
   * seven segments cannot draw '@' and no amount of font work will fix that. On the
   * dot matrix the same character is trivial. So the useful thing to report is not
   * "not in font" but WHICH TYPES CAN DRAW IT — a redirect instead of a dead end. */
  var ALL_TYPES = ['7', '14', '16', '21', '5x7'];
  var TYPE_LABEL = { '7': '7-seg', '14': '14-seg', '16': '16-seg',
                     '21': '21-seg', '5x7': '5\u00d77 matrix' };

  function typeHasAll(type, chars) {
    return chars.every(function (ch) {
      var r = F.lookup(type, ch, 0);
      return r && !r.missing && r.spec;
    });
  }

  function updateHint(list) {
    var missing = [];
    for (var i = 0; i < list.length; i++) {
      var f = fontInfo(list[i], i);
      if (f.missing && list[i].ch !== ' ') missing.push(list[i].ch);
    }
    var isMatrix = state.type === '5x7';
    var cells = F.ORDER[state.type].length;
    var parts = [list.length + ' cell' + (list.length === 1 ? '' : 's'),
                 isMatrix ? '5\u00d77 dot matrix' : state.type + '-segment',
                 cells + (isMatrix ? ' dots/cell' : ' bits/cell')];
    if (missing.length) {
      /* 21-seg is deliberately excluded from the suggestion: its geometry is parked
       * and unfinished, so pointing someone at it would be a false promise. */
      var alt = ALL_TYPES.filter(function (t) {
        return t !== state.type && t !== '21' && typeHasAll(t, missing);
      });
      parts.push('not on this display: ' + missing.join(' ') +
                 (alt.length ? '  \u2014  try ' + alt.map(function (t) { return TYPE_LABEL[t]; }).join(' / ')
                             : '  \u2014  no display type here can'));
    }
    hint.textContent = parts.join('  \u00b7  ');
  }

  /* ------------------------------------------------------------- inspector */

  function maskString(type, mask) {
    var bits = F.ORDER[type].length;
    var s = mask.toString(2);
    while (s.length < bits) s = '0' + s;
    /* Group from the RIGHT so bit 0 sits at the end of the last nibble. */
    return s.replace(/\B(?=(.{4})+$)/g, ' ');
  }
  function hexString(type, mask) {
    var digits = Math.ceil(F.ORDER[type].length / 4);
    var s = mask.toString(16).toUpperCase();
    while (s.length < digits) s = '0' + s;
    return '0x' + s;
  }

  function renderInspector(list) {
    if (state.selected === null || !list[state.selected]) {
      inspector.innerHTML =
        '<p class="empty"><b>Click a character</b> to select it, then click any segment to ' +
        'toggle it.<br><br>Found a glyph that looks wrong? Fix it here and hit ' +
        '<b>Copy font line</b> — that gives you a paste-ready entry for ' +
        '<code>js/fonts.js</code>, which beats describing the segment in words.</p>';
      return;
    }
    var i = state.selected;
    var g = list[i];
    var set = effectiveSet(g, i);
    var info = fontInfo(g, i);
    var order = F.ORDER[state.type];
    var mask = F.maskOf(state.type, set);
    var on = order.filter(function (n) { return set[n]; });
    var edited = !!state.overrides[i];

    var h = [];
    h.push('<h2>Cell ' + i + (edited ? ' <span class="edited">· edited</span>' : '') + '</h2>');
    h.push('<dl class="kv">');
    h.push('<dt>Char</dt><dd><span class="big">' +
           (g.ch === ' ' ? '␠' : escapeHTML(g.ch)) + '</span>' +
           (g.dp ? ' <span style="color:var(--ink-faint)">+DP</span>' : '') + '</dd>');
    h.push('<dt>Hex</dt><dd>' + hexString(state.type, mask) + '</dd>');
    h.push('<dt>Binary</dt><dd>' + maskString(state.type, mask) + '</dd>');
    h.push('<dt>On</dt><dd>' + (on.length ? on.join(' ') : '—') + '</dd>');
    h.push('</dl>');

    if (info.variants > 1) {
      h.push('<div class="vrow"><span>variant</span>');
      for (var v = 0; v < info.variants; v++) {
        h.push('<button type="button" class="vbtn' + (v === info.index && !edited ? ' on' : '') +
               '" data-variant="' + v + '">' + (v + 1) + '</button>');
      }
      h.push('</div>');
    }

    h.push('<div class="chips">');
    for (var k = 0; k < order.length; k++) {
      h.push('<button type="button" class="chip' + (set[order[k]] ? ' on' : '') +
             '" data-chip="' + order[k] + '">' + order[k] + '</button>');
    }
    h.push('</div>');

    h.push('<div class="actions" style="display:flex;gap:6px;flex-wrap:wrap">');
    h.push('<button type="button" data-act="all">All on</button>');
    h.push('<button type="button" data-act="none">All off</button>');
    h.push('<button type="button" data-act="revert">Revert</button>');
    h.push('<button type="button" data-act="copy">Copy hex</button>');
    h.push('<button type="button" data-act="spec">Copy spec</button>');
    h.push('<button type="button" data-act="line">Copy font line</button>');
    h.push('</div>');

    inspector.innerHTML = h.join('');
  }

  /* Lit segments in pin order — the spec string fonts.js uses. */
  function specOf(index) {
    var list = glyphList();
    var set = effectiveSet(list[index], index);
    return F.ORDER[state.type].filter(function (n) { return set[n]; }).join(' ');
  }

  function escapeHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------------------------------------------------------------- edits */

  function toggleSeg(index, seg) {
    var list = glyphList();
    if (!list[index]) return;
    var cur = effectiveSet(list[index], index);
    cur[seg] = !cur[seg];
    if (!cur[seg]) delete cur[seg];
    state.overrides[index] = cur;
    state.selected = index;
    render();
  }

  function setAll(index, on) {
    var set = {};
    if (on) F.ORDER[state.type].forEach(function (n) { set[n] = true; });
    state.overrides[index] = set;
    render();
  }

  /* --------------------------------------------------------------- events */

  face.addEventListener('click', function (e) {
    var svg = e.target.closest('.glyph');
    if (!svg) return;
    var index = parseInt(svg.dataset.index, 10);
    var segEl = e.target.closest('.seg');
    state.selected = index;
    if (segEl) toggleSeg(index, segEl.dataset.seg);
    else render();
  });

  inspector.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || state.selected === null) return;
    var i = state.selected;

    if (b.dataset.chip) { toggleSeg(i, b.dataset.chip); return; }
    if (b.dataset.variant !== undefined) {
      state.variants[i] = parseInt(b.dataset.variant, 10);
      delete state.overrides[i];
      render(); return;
    }
    switch (b.dataset.act) {
      case 'all':    setAll(i, true); break;
      case 'none':   setAll(i, false); break;
      case 'revert': delete state.overrides[i]; delete state.variants[i]; render(); break;
      case 'copy': {
        var list = glyphList();
        var mask = F.maskOf(state.type, effectiveSet(list[i], i));
        copy(hexString(state.type, mask), b);
        break;
      }
      /* The segment names, in pin order — exactly the format fonts.js stores. */
      case 'spec': {
        copy(specOf(i), b);
        break;
      }
      /* A paste-ready fonts.js entry, so a fix made by clicking can go straight
       * into the font without anyone having to describe a segment in prose. */
      case 'line': {
        var gl = glyphList()[i];
        copy(F.fontLine(state.type, gl.ch, fontInfo(gl, i).index, specOf(i)), b);
        break;
      }
    }
  });

  var syncers = [];
  function syncControls() { syncers.forEach(function (f) { f(); }); }

  function bindRange(id, key, fmt) {
    var el = $('#' + id), out = $('#' + id + 'Out');
    syncers.push(function () {
      el.value = state[key];
      if (out) out.textContent = fmt(state[key]);
    });
    el.addEventListener('input', function () {
      state[key] = parseFloat(el.value);
      if (out) out.textContent = fmt(state[key]);
      render();
    });
  }

  function bindCheck(id, key) {
    var el = $('#' + id);
    syncers.push(function () { el.checked = !!state[key]; });
    el.addEventListener('change', function () { state[key] = el.checked; render(); });
  }

  $('#text').addEventListener('input', function () {
    var prevLen = glyphList().length;
    state.text = this.value;
    var len = glyphList().length;
    if (len !== prevLen) { state.overrides = {}; state.variants = {}; state.selected = null; }
    render();
  });

  $('#type').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    [].forEach.call(this.children, function (c) { c.classList.toggle('on', c === b); });
    state.type = b.dataset.v;
    state.overrides = {};
    render();
  });

  $('#rings').addEventListener('change', function () {
    state.rings = parseInt(this.value, 10);
    render();
  });

  $('#style').addEventListener('change', function () {
    state.style = this.value;
    state.variants = {};
    render();
  });

  function buildSwatches() {
    var host = $('#swatches'), custom = $('#custom');
    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = p.id;
      b.title = p.name;
      b.style.setProperty('--s', p.color);
      host.insertBefore(b, custom);
    });
  }
  buildSwatches();

  function markPreset() {
    [].forEach.call($('#swatches').querySelectorAll('button'), function (c) {
      c.classList.toggle('on', c.dataset.id === state.preset);
    });
    var p = PRESETS.filter(function (x) { return x.id === state.preset; })[0];
    $('#presetName').textContent = p ? p.name : 'custom';
  }

  $('#swatches').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var p = PRESETS.filter(function (x) { return x.id === b.dataset.id; })[0];
    if (!p) return;
    state.preset = p.id;
    state.color = p.color;
    state.bloom = p.bloom;
    state.blowout = p.blowout;
    $('#custom').value = p.color;
    syncControls();
    markPreset();
    render();
  });
  $('#custom').addEventListener('input', function () {
    state.color = this.value;
    state.preset = null;
    markPreset();
    render();
  });

  bindRange('slant', 'slant', function (v) { return v + '°'; });
  bindRange('size',  'size',  function (v) { return v + 'px'; });
  bindRange('thick', 'thick', function (v) { return String(v); });
  bindRange('gap',   'gap',   function (v) { return String(v); });
  bindRange('bloom', 'bloom', function (v) { return String(v); });
  bindRange('blowout', 'blowout', function (v) { return String(v); });
  bindRange('hdrBoost', 'hdrBoost', function (v) {
    if (!state.hdr) return 'off';
    return '\u00d7' + v.toFixed(1) + ' \u00b7 ' + Math.round(v * H.SDR_WHITE_NITS) + ' nits';
  });

  bindCheck('hdrOn', 'hdr');
  bindRange('unlit', 'unlit', function (v) { return v ? String(v) : 'off'; });
  bindCheck('labels', 'labels');
  bindCheck('slashzero', 'slashZero');
  bindCheck('lowercase', 'lowercase');

  $('#testOn').addEventListener('click', function () {
    var list = glyphList();
    for (var i = 0; i < list.length; i++) setAllQuiet(i, true);
    render();
  });
  function setAllQuiet(index, on) {
    var set = {};
    if (on) F.ORDER[state.type].forEach(function (n) { set[n] = true; });
    state.overrides[index] = set;
  }

  $('#clearOv').addEventListener('click', function () {
    state.overrides = {}; state.variants = {}; render();
  });

  $('#italicPreset').addEventListener('click', function () {
    state.slant = state.slant ? 0 : 12;
    $('#slant').value = state.slant;
    $('#slantOut').textContent = state.slant + '°';
    render();
  });

  /* ------------------------------------------------------ screenshot mode */

  /* The face goes full-window with the rest of the page covered, so a screen
   * grab of any region around the text is just the display on black. Not
   * persisted: reopening the page into a field with no controls and no hint
   * would look broken. ?shot=1 still opens straight into it for a linked config. */
  function setShot(on) {
    state.shot = !!on;
    document.body.classList.toggle('shot', state.shot);
    var note = document.querySelector('.shotnote');
    if (note) note.remove();
    if (!state.shot) return;
    /* a focused text box would keep taking keystrokes it can no longer show */
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    note = document.createElement('p');
    note.className = 'shotnote';
    note.textContent = 'Esc to exit';
    note.addEventListener('animationend', function () { note.remove(); });
    document.body.appendChild(note);
  }

  $('#shotBtn').addEventListener('click', function () {
    setShot(true);
    paintHDR();   /* the canvas is sized from the face, which just became the window */
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !state.shot) return;
    e.preventDefault();
    setShot(false);
    paintHDR();
  });

  /* Same reason as above: the HDR canvas has to follow the face, and in
   * screenshot mode the face follows the window. */
  var resizeQueued = false;
  window.addEventListener('resize', function () {
    if (!state.hdr || resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(function () { resizeQueued = false; paintHDR(); });
  });

  $('#copyArr').addEventListener('click', function () {
    var list = glyphList();
    var order = F.ORDER[state.type];
    var bits = order.length;
    var ctype = bits <= 8 ? 'uint8_t' : (bits <= 16 ? 'uint16_t' : 'uint32_t');
    var lines = [];
    lines.push('/* ' + state.type + '-segment, bit order: ' + order.join(' ') + ' */');
    lines.push('const ' + ctype + ' glyphs[' + list.length + '] = {');
    for (var i = 0; i < list.length; i++) {
      var mask = F.maskOf(state.type, effectiveSet(list[i], i));
      var ch = list[i].ch === ' ' ? 'space' : list[i].ch;
      lines.push('    ' + hexString(state.type, mask) + ',' +
                 ' /* ' + ch + (list[i].dp ? ' .' : '') + ' */');
    }
    lines.push('};');
    copy(lines.join('\n'), this);
  });

  function copy(text, btn) {
    var done = function () {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = old; }, 1100);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
    } else { fallback(text); done(); }
  }
  function fallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing to do */ }
    document.body.removeChild(ta);
  }

  /* ------------------------------------------------------------ persistence */

  function save() {
    try {
      var keep = {};
      ['text', 'type', 'style', 'color', 'slant', 'size', 'thick', 'gap',
       'unlit', 'labels', 'slashZero', 'lowercase', 'bloom', 'blowout', 'preset', 'rings',
       'hdr', 'hdrBoost'].forEach(function (k) { keep[k] = state[k]; });
      /* Cell edits ride along with the text and type they were made against - see
       * pendingEdits. `shot` is deliberately absent: reopening the page into a black
       * field with no controls and no hint would read as a broken page. */
      keep.edits = { text: state.text, type: state.type, variants: state.variants,
                     overrides: state.overrides, selected: state.selected };
      localStorage.setItem(STORE, JSON.stringify(keep));
    } catch (e) { /* private window, don't care */ }
  }

  /* Cell edits are keyed by CELL INDEX and by display type, so they only mean anything
   * against the exact text and type they were made on - every path that changes either
   * one throws them away for that reason. A query string can still change both AFTER
   * load() runs, so they are held here and applied at boot only if both still match.
   * A stale edit landing on different text would look like the font is wrong, which is
   * the one thing a font auditing tool must never fake. */
  var pendingEdits = null;

  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved.edits) pendingEdits = saved.edits;
      /* `ghost` was a boolean and is now the `unlit` level. Migrate rather than
       * ignore: a stored ghost:false would otherwise be silently dropped and the
       * unlit dice would reappear for someone who had deliberately turned them
       * off - and worse, someone who had them off would have had no idea why
       * they were invisible, which is exactly how this session went. */
      if ('ghost' in saved && !('unlit' in saved)) {
        saved.unlit = saved.ghost ? state.unlit : 0;
      }
      Object.keys(saved).forEach(function (k) { if (k in state) state[k] = saved[k]; });
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ HDR */

  /* The emission layer is a different RENDERER, not a filter tweak, so it gets
   * an explicit switch rather than being folded into Bloom. It also depends on
   * hardware we cannot control: a WebGPU float canvas exists everywhere Chrome
   * does, but values above SDR white only MEAN anything on an HDR display.
   * Fail loudly in the note rather than silently looking identical. */
  /* The canvas is created once and re-attached after every render, because
   * render() replaces face.innerHTML wholesale and would otherwise destroy the
   * WebGPU surface on every keystroke. Absolutely positioned, so re-inserting
   * it into the flex row costs no layout. */
  var hdrCanvas = null;
  function hdrCanvasEl() {
    if (!hdrCanvas) {
      hdrCanvas = document.createElement('canvas');
      hdrCanvas.id = 'hdrcanvas';
      hdrCanvas.setAttribute('aria-hidden', 'true');
    }
    if (hdrCanvas.parentNode !== face) face.insertBefore(hdrCanvas, face.firstChild);
    return hdrCanvas;
  }

  function paintHDR() {
    var slider = $('#hdrBoost');
    if (slider) slider.disabled = !state.hdr;
    if (!H) return;
    face.classList.toggle('hdr', !!state.hdr);
    var cv = hdrCanvasEl();
    if (!state.hdr) return;
    H.update({
      face: face,
      canvas: cv,
      color: state.color,
      boost: state.hdrBoost,
      blowout: state.blowout,
      bloom: state.bloom,
      unlit: state.unlit
    }).then(function (ok) {
      if (!ok) { state.hdr = false; face.classList.remove('hdr'); syncControls(); }
      hdrNote();
    });
  }

  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function hdrNote() {
    var field = document.getElementById('hdrField');
    var note = document.getElementById('hdrNote');
    if (!field || !note || !H) return;
    var d = H.diagnose();
    field.hidden = !d['WebGPU present'];
    note.hidden = false;
    if (field.hidden) {
      note.innerHTML = 'HDR needs WebGPU \u2014 <b class="no">unavailable here</b>';
      return;
    }
    /* One line. Three facts, each with a tick, and a short verdict \u2014 this is a
     * status strip, not a report. */
    function mark(label, ok) {
      return label + ' <b class="' + (ok ? 'ok' : 'no') + '">' + (ok ? '\u2713' : '\u2717') + '</b>';
    }
    var hi = d['display dynamic-range: high'];
    /* ?debug=1 appends the live mask stats. An empty or single-channel mask is
     * the failure this whole layer is most prone to and is otherwise invisible. */
    var dbg = '';
    try {
      if (new URLSearchParams(location.search).get('debug') && d.mask) {
        dbg = ' \u00b7 mask ' + esc(JSON.stringify(d.mask));
      }
    } catch (e) {}
    note.innerHTML = mark('WebGPU', true) + ' \u00b7 ' +
                     mark('HDR display', hi) + ' \u00b7 ' +
                     mark('float canvas', d['float canvas + extended tone map']) +
                     (d.error ? ' \u00b7 ' + esc(d.error)
                              : hi ? '' : ' \u00b7 SDR display \u2014 boost will just clip to white') + dbg;
  }

  /* Query string wins over saved state, so a config can be linked to.
   * e.g. ?text=HELLO&type=14&slant=12&color=%2335ff72 */
  function readParams() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var num = { slant: 1, size: 1, thick: 1, gap: 1, bloom: 1, blowout: 1, rings: 1, hdrBoost: 1,
                unlit: 1 };
    var bool = { labels: 1, slashZero: 1, lowercase: 1, hdr: 1, shot: 1 };
    var alias = { slashzero: 'slashZero', colour: 'color' };
    q.forEach(function (val, key) {
      key = alias[key.toLowerCase()] || key;
      if (!(key in state)) return;
      if (num[key]) state[key] = parseFloat(val);
      else if (bool[key]) state[key] = !(val === '0' || val === 'false');
      else state[key] = val;
    });
  }

  /* ----------------------------------------------------------------- boot */

  load();
  readParams();
  if (pendingEdits && pendingEdits.text === state.text && pendingEdits.type === state.type) {
    state.variants = pendingEdits.variants || {};
    state.overrides = pendingEdits.overrides || {};
    state.selected = (pendingEdits.selected === undefined) ? null : pendingEdits.selected;
  }
  syncControls();
  $('#text').value = state.text;
  $('#style').value = state.style;
  $('#rings').value = String(state.rings);
  $('#custom').value = state.color;
  [].forEach.call($('#type').children, function (c) {
    c.classList.toggle('on', c.dataset.v === state.type);
  });
  markPreset();
  hdrNote();
  render();
  try {
    matchMedia('(dynamic-range: high)').addEventListener('change', function () {
      hdrNote(); render();
    });
  } catch (e) {}
  if (state.shot) { setShot(true); paintHDR(); }
  else $('#text').focus();
})();
