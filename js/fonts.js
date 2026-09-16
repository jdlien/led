/* fonts.js — character maps.
 *
 * A 16-segment display has no single "correct" alphabet. Manufacturers publish
 * VARIATION charts: Opto Plus's own sheet (docs/) shows two and three competing
 * renderings for A, B, E, F, J, K, M, Q, S, V, W, Y and Z. So every entry here is
 * an ARRAY of variants. Variant 0 is the most legible / most widely used form;
 * the rest are alternates you can cycle through per glyph.
 *
 * Segment names follow the OPD-AS5010 pinout, clockwise:
 *   A1 A2 B C D1 D2 E F G1 G2 H J K L M N  (+ DP)
 *
 * Geometric fact worth remembering when a letter looks wrong: the four diagonals
 * (H K L N) all radiate from the exact centre to a corner. Nothing runs from a
 * mid-edge to the bottom centre, which is why V is a left rail plus a slash
 * rather than two converging arms.
 */
window.LED = window.LED || {};
(function (NS) {
  'use strict';

  /* Bit order = pin order on the datasheet. Bit 0 is the first name. */
  var ORDER = {
    '7':  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'],
    '14': ['A', 'B', 'C', 'D', 'E', 'F', 'G1', 'G2', 'H', 'J', 'K', 'L', 'M', 'N', 'DP'],
    '16': ['A1', 'A2', 'B', 'C', 'D1', 'D2', 'E', 'F', 'G1', 'G2',
           'H', 'J', 'K', 'L', 'M', 'N', 'DP'],
    /* 21-segment: the 16, plus the five JUNCTIONS a starburst leaves open —
     * CT the centre hub, and TL/TR/BL/BR the outer corner chamfers. */
    '21': ['A1', 'A2', 'B', 'C', 'D1', 'D2', 'E', 'F', 'G1', 'G2',
           'H', 'J', 'K', 'L', 'M', 'N', 'CT', 'TL', 'TR', 'BL', 'BR', 'DP'],
    /* 5x7 dot matrix — filled in from matrix.js, which owns that font. No DP: on a
     * matrix the period is a glyph like any other, not a separate lamp. */
    '5x7': (window.LED.matrix ? window.LED.matrix.ORDER : [])
  };

  /* ---------------------------------------------------------------- 16-seg */
  var F16 = {
    ' ': [''],
    '!': ['B C DP'],   /* the DP *is* the dot; without it '!' is just '1' */
    '"': ['F J'],
    '#': ['B C G1 G2 J M'],
    '$': ['A1 A2 F G1 G2 C D1 D2 J M'],
    '%': ['A1 F K N D2 C'],
    '&': ['A1 H J G1 E D1 D2 L'],
    "'": ['J'],
    '(': ['A1 F E D1', 'K L'],
    ')': ['A2 B C D2', 'H N'],
    '*': ['G1 G2 H J K L M N'],
    '+': ['G1 G2 J M'],
    ',': ['N'],
    '-': ['G1 G2'],
    '/': ['K N'],
    '0': ['A1 A2 B C D1 D2 E F'],
    '1': ['B C', 'J M', 'K B C'],
    '2': ['A1 A2 B G1 G2 E D1 D2'],
    '3': ['A1 A2 B C D1 D2 G1 G2', 'A1 A2 B C D1 D2 G2'],
    '4': ['F G1 G2 B C'],
    '5': ['A1 A2 F G1 G2 C D1 D2'],
    '6': ['A1 A2 F E D1 D2 C G1 G2'],
    '7': ['A1 A2 B C', 'A1 A2 K N'],
    '8': ['A1 A2 B C D1 D2 E F G1 G2'],
    '9': ['A1 A2 B C D1 D2 F G1 G2'],
    ':': ['J M'],
    ';': ['J N'],
    '<': ['K L'],
    '=': ['G1 G2 D1 D2'],
    '>': ['H N'],
    '?': ['A1 A2 B G2 M'],
    '@': ['A1 A2 B C D1 D2 E F G2 J'],

    'A': ['A1 A2 B C E F G1 G2', 'B C G2 K N', 'B C G1 G2 K N'],
    'B': ['A1 A2 B C D1 D2 G2 J M', 'A1 A2 B C D1 D2 G1 G2 J M'],
    'C': ['A1 A2 F E D1 D2'],
    'D': ['A1 A2 B C D1 D2 J M'],
    'E': ['A1 A2 F E D1 D2 G1 G2', 'A1 A2 F E D1 D2 G1'],
    'F': ['A1 A2 F E G1 G2', 'A1 A2 F E G1'],
    'G': ['A1 A2 F E D1 D2 C G2'],
    'H': ['B C E F G1 G2'],
    'I': ['A1 A2 D1 D2 J M', 'B C'],
    'J': ['B C D1 D2 E', 'A1 A2 J M E D1', 'A2 B C D1 D2 E'],
    'K': ['E F G1 K L'],
    'L': ['E F D1 D2'],
    'M': ['B C E F H K', 'B C E F H K M', 'A1 A2 B C E F J M'],
    'N': ['B C E F H L'],
    'O': ['A1 A2 B C D1 D2 E F'],
    'P': ['A1 A2 B E F G1 G2'],
    'Q': ['A1 A2 B C D1 D2 E F L'],
    'R': ['A1 A2 B E F G1 G2 L'],
    'S': ['A1 A2 C D1 D2 F G1 G2', 'A1 A2 C D1 D2 G2 H', 'A1 A2 D1 D2 F G1 L'],
    'T': ['A1 A2 J M'],
    'U': ['B C D1 D2 E F'],
    'V': ['E F K N'],
    'W': ['B C E F L N', 'B C E F J L N', 'B C E F M D1 D2'],
    'X': ['H K L N'],
    'Y': ['H K M', 'B F G1 G2 M'],
    'Z': ['A1 A2 K N D1 D2', 'A1 A2 G1 G2 K N D1 D2'],

    /* Lowercase, read off Opto Plus's "16-segment Display Lower-case English
     * Alphabet" sheet (docs/). Note how many of these live entirely in the lower
     * half of the cell — c, m, o, r, u, v, x, z are all sub-x-height, which is what
     * makes mixed case legible on a starburst at all.
     * Beware the italic: every vertical already leans, so a real diagonal reads as just
     * another leaning bar. p and q close their bowls with K (not B); s, w and k use L
     * (not M). All four were transcribed wrong before anyone measured them.
     *
     * Two entries deliberately DEVIATE from the chart, with Opto's own form kept as
     * variant 2 so nothing is lost:
     *   n  Opto draw it full-height. Nothing collides with a half-height 'n' — checked —
     *      and full-height is exactly why 'television' renders as 'teleVisioN'. Only 9 of
     *      26 lowercase letters sit below the middle bar as it is; this makes it 10, and
     *      'n' is the 6th most common letter in English.
     *   j  Opto's A1 A2 C D1 D2 leaves the top bar floating clear of the stem. B C D1 —
     *      full right stroke, hook left at the bottom — actually reads as a j, and merges
     *      to 'B C D' on 14-seg, which is the same shape. */
    'a': ['A1 A2 B C D1 D2 E G1 G2'],
    'b': ['C D1 D2 E F G1 G2'],
    'c': ['D1 D2 E G1 G2'],
    'd': ['B C D1 D2 E G1 G2'],
    'e': ['A1 A2 B D1 D2 E F G1 G2'],
    'f': ['A2 G1 G2 J M'],
    'g': ['A1 A2 B C D1 D2 F G1 G2'],
    'h': ['C E F G1 G2'],
    'i': ['A1 D1 D2 G1 M'],
    'j': ['A2 C D2'],
    'k': ['E F G1 G2 L'],   /* the leg is the L DIAGONAL, not the M vertical */
    'l': ['A1 D2 J M'],
    'm': ['C E G1 G2 M'],
    'n': ['C E G1 G2', 'A1 A2 B C E F'],
    'o': ['C D1 D2 E G1 G2'],
    'p': ['A1 A2 E F G1 K'],
    'q': ['A1 A2 B C F G1 K'],
    'r': ['E G1 G2'],
    /* The lower half has only a top bar and a bottom bar — no middle — so an 's'
     * cannot be built from horizontals alone. Opto Plus bridge it with the L diagonal,
     * which is the whole trick. Variant 2 is the uppercase form, for anyone who wants
     * the same-shape-both-cases convention (c o s v w x z). */
    's': ['D1 D2 G2 L', 'A1 A2 C D1 D2 F G1 G2'],
    't': ['D2 G1 G2 J M', 'G1 G2 J M'],
    'u': ['C D1 D2 E'],
    'v': ['E N'],
    'w': ['C E L N'],
    'x': ['G1 G2 L N'],
    'y': ['B C D2 G2 J', 'B C D1 D2 G2 J'],
    'z': ['D1 G1 N'],

    '[': ['A1 F E D1'],
    '\\': ['H L'],
    ']': ['A2 B C D2'],
    '^': ['L N'],
    '_': ['D1 D2'],
    '`': ['H'],
    '{': ['A2 G1 J M D2'],
    '|': ['J M'],
    '}': ['A1 G2 J M D1'],
    '~': ['G1 G2'],
    '°': ['A1 A2 F B G1 G2'],

    /* Arrows work because an arrowhead is a pair of diagonals radiating from the centre.
     * ⚠️ The TIP IS ALWAYS AT THE CENTRE and the arms radiate AWAY from the direction of
     * travel — so a RIGHT arrow uses the LEFT diagonals (H N) with G1 as its shaft, not
     * the right ones. All four were mirrored here until someone actually looked.
     *
     * A HEART does not work, and it fails for exactly the reason the letter V does: it
     * needs two strokes converging at the BOTTOM CENTRE, and every diagonal here runs
     * centre-to-corner. You can draw the splay (N+L, apex up) but never the point.
     * Seven candidates were tried; the least bad shares four segments with 'M' and
     * duly reads as an M with a tail. Don't add a bad one — a wrong glyph mid-word is
     * worse than a blank. */
    '→': ['G1 H N'],
    '←': ['G2 K L'],
    '↑': ['L M N'],
    '↓': ['H J K'],
    '★': ['G1 G2 H J K L M N']
  };

  /* Where the Opto Plus chart's primary row differs from the classic mapping. */
  var OPTOPLUS_PICK = { J: 1, M: 1, V: 0, W: 1, Y: 1, S: 0 };

  /* ----------------------------------------------------------------- 7-seg */
  var F7 = {
    ' ': [''],
    '!': ['B'],
    '"': ['B F'],
    "'": ['F'],
    '(': ['A D E F'],
    ')': ['A B C D'],
    '*': ['A F B G'],
    '+': ['G'],
    ',': ['C'],
    '-': ['G'],
    '/': ['B E G'],
    '0': ['A B C D E F'],
    '1': ['B C', 'E F'],
    '2': ['A B G E D'],
    '3': ['A B G C D'],
    '4': ['F G B C'],
    '5': ['A F G C D'],
    '6': ['A F G E C D', 'F G E C D'],
    '7': ['A B C', 'A F B C'],
    '8': ['A B C D E F G'],
    '9': ['A B C D F G', 'A B C F G'],
    '<': ['D E G'],
    '=': ['D G'],
    '>': ['C D G'],
    '?': ['A B E G'],
    '[': ['A D E F'],
    '\\': ['C F G'],
    ']': ['A B C D'],
    '^': ['A B F'],
    '_': ['D'],
    '`': ['F'],
    '|': ['E F'],
    '°': ['A B F G'],

    /* Uppercase. B, D, K, M, V, W, X are the ones 7 segments simply cannot do;
     * the conventional dodge is a lowercase form or a collision with another letter. */
    'A': ['A B C E F G'],
    'B': ['C D E F G'],
    'C': ['A D E F', 'D E G'],
    'D': ['B C D E G'],
    'E': ['A D E F G'],
    'F': ['A E F G'],
    'G': ['A C D E F', 'A B C D F G'],
    'H': ['B C E F G'],
    'I': ['E F', 'B C'],
    'J': ['B C D E'],
    'K': ['A C E F G', 'B C E F G'],
    'L': ['D E F'],
    'M': ['A C E', 'A B C E F'],
    'N': ['C E G', 'A B C E F'],
    'O': ['A B C D E F', 'C D E G'],
    'P': ['A B E F G'],
    'Q': ['A B C F G'],
    'R': ['E G', 'A E F G'],
    'S': ['A C D F G'],
    'T': ['D E F G'],
    'U': ['B C D E F', 'C D E'],
    'V': ['B C D E F', 'C D E'],
    'W': ['B D F', 'C D E G'],
    'X': ['B C E F G'],
    'Y': ['B C D F G'],
    'Z': ['A B D E G'],

    /* Lowercase forms that are genuinely distinct on 7 segments. */
    'a': ['A B C D E G'],
    'c': ['D E G'],
    'e': ['A B D E F G'],
    'g': ['A B C D F G'],
    'h': ['C E F G'],
    'i': ['C'],
    'j': ['B C D'],
    'l': ['E F'],
    'n': ['C E G'],
    'o': ['C D E G'],
    'q': ['A B C F G'],
    'r': ['E G'],
    't': ['D E F G'],
    'u': ['C D E'],
    'y': ['B C D F G']
  };

  /* Merge the split outer bars: A1|A2 -> A, D1|D2 -> D. That is all 14-seg is. */
  function to14(spec) {
    var seen = {}, out = [];
    spec.split(/\s+/).forEach(function (s) {
      if (!s) return;
      if (s === 'A1' || s === 'A2') s = 'A';
      if (s === 'D1' || s === 'D2') s = 'D';
      if (!seen[s]) { seen[s] = 1; out.push(s); }
    });
    return out.join(' ');
  }

  /* The A/D merge is mechanically right and semantically wrong wherever a 16-seg glyph
   * uses a HALF bar as a serif: the serif grows into a full bar and takes the letter
   * with it. Lowercase 'l' is the clear case — A1 is a top-left tick, and merged it
   * becomes the full top bar of an 'I' (both land on 0x01209, byte-identical).
   * A serif is the one feature you cannot scale up, so it gets dropped instead.
   *
   * Two different repairs, depending on what the half-bar was doing:
   *   DECORATIVE (a serif or a foot) -> drop it. 'l' loses both its top tick and its
   *     bottom-right foot: merged, the tick becomes the top bar of an 'I' and the foot
   *     becomes the base of an upside-down T. 'i' and 't' lose one each.
   *   STRUCTURAL           -> fall back to uppercase, because trimming it produces a
   *                          different letter. 'f' is the case: its A2 is the hook, and
   *                          on 14-seg the top bar always spans the FULL width, so the
   *                          hook necessarily extends left of the stem — which is the one
   *                          thing an f never does. Every trimmed variant reads as a T
   *                          with a tick. Same reasoning as lowercase 's': when the
   *                          lowercase form is geometrically unavailable, use the capital.
   * A lone half-bar at the BOTTOM is fine everywhere — it just reads as a fuller foot. */
  /* U+2588 FULL BLOCK lights every segment including the DP — a lamp-test character you
   * can type, put in a string, or run through Copy C array, as opposed to the UI button.
   * GENERATED from ORDER rather than typed, so it cannot go stale if a segment is ever
   * added or renamed. */
  F16['\u2588'] = [ORDER['16'].join(' ')];
  F7['\u2588']  = [ORDER['7'].join(' ')];

  /* Normalise every spec to pin order once, at load. Hand-edited tables drift out of
   * order, which makes two identical glyphs look different in a diff and hides
   * duplicates from the eye. Masks are unaffected — this is purely how it reads. */
  (function normalise() {
    [['7', F7], ['16', F16]].forEach(function (pair) {
      var order = ORDER[pair[0]], table = pair[1];
      Object.keys(table).forEach(function (ch) {
        table[ch] = table[ch].map(function (spec) {
          var set = {};
          spec.split(/\s+/).forEach(function (n) { if (n) set[n] = true; });
          return order.filter(function (n) { return set[n]; }).join(' ');
        });
      });
    });
  })();

  var F14_OVERRIDE = {
    'l': ['J M'],          /* A -> 'I'; D -> an upside-down T. Both bars go. */
    'i': ['D G1 M'],       /* was A D G1 M -> full top bar on a lowercase i */
    'f': ['A E F G1 G2'],  /* uppercase F; see below */
    't': ['G1 G2 J M'],    /* was D G1 G2 J M — D2 is a foot, and a full bar isn't one */
    'j': ['B C D']         /* 16-seg j is A2 C D2; BOTH are lone half-bars, so the
                            * merge gives 'A C D' — a top bar floating clear of the
                            * stem, which is the mangled shape this replaced. */
  };

  var F14 = (function () {
    var t = {};
    Object.keys(F16).forEach(function (ch) {
      t[ch] = F16[ch].map(to14);
      /* dedupe variants that collapse to the same thing once A/D merge */
      t[ch] = t[ch].filter(function (v, i, a) { return a.indexOf(v) === i; });
    });
    Object.keys(F14_OVERRIDE).forEach(function (ch) { t[ch] = F14_OVERRIDE[ch]; });
    return t;
  })();

  /* 21-segment derives from 16 by closing joints, not by drawing anything new:
   *   CT  lights when two or more strokes actually MEET at the centre. A lone diagonal
   *       has no junction to close, so a ',' stays a comma rather than growing a blob.
   *   TL/TR/BL/BR light when BOTH bars forming that corner are lit — which is what
   *       turns a square 'O' into a proper octagonal ring.
   * Everything downstream (fonts, variants, masks) therefore comes along for free. */
  var CENTRE_MEET = ['G1', 'G2', 'H', 'J', 'K', 'L', 'M', 'N'];

  function to21(spec) {
    var set = {};
    spec.split(/\s+/).forEach(function (n) { if (n) set[n] = true; });
    var meeting = 0;
    CENTRE_MEET.forEach(function (n) { if (set[n]) meeting++; });
    if (meeting >= 2) set.CT = true;
    if (set.A1 && set.F) set.TL = true;
    if (set.A2 && set.B) set.TR = true;
    if (set.D1 && set.E) set.BL = true;
    if (set.D2 && set.C) set.BR = true;
    return ORDER['21'].filter(function (n) { return set[n]; }).join(' ');
  }

  var F21 = (function () {
    var t = {};
    Object.keys(F16).forEach(function (ch) {
      t[ch] = F16[ch].map(to21).filter(function (v, i, a) { return a.indexOf(v) === i; });
    });
    t['\u2588'] = [ORDER['21'].join(' ')];   /* lamp test stays complete */
    return t;
  })();

  var TABLES = { '7': F7, '14': F14, '16': F16, '21': F21,
                 '5x7': (window.LED.matrix ? window.LED.matrix.FONT : {}) };

  /* Look up a character. Falls back: exact -> uppercase -> space. */
  function lookup(type, ch, variantIndex, style, lowercase) {
    var table = TABLES[type];
    var key = (lowercase === false) ? ch.toUpperCase() : ch;
    var entry = table[key];
    if (!entry) entry = table[key.toUpperCase()];
    if (!entry) entry = table[key.toLowerCase()];
    if (!entry) return { spec: '', variants: 1, index: 0, missing: true };

    var idx = variantIndex;
    if (idx === null || idx === undefined) {
      /* Case-sensitive on purpose: lowercase 's' and uppercase 'S' want different picks. */
      idx = (style === 'optoplus' && OPTOPLUS_PICK[key] !== undefined)
        ? OPTOPLUS_PICK[key] : 0;
    }
    if (idx >= entry.length) idx = 0;
    return { spec: entry[idx], variants: entry.length, index: idx, missing: false };
  }

  function specToSet(spec) {
    var set = {};
    spec.split(/\s+/).forEach(function (s) { if (s) set[s] = true; });
    return set;
  }

  function maskOf(type, set) {
    var order = ORDER[type], mask = 0;
    for (var i = 0; i < order.length; i++) if (set[order[i]]) mask |= (1 << i);
    return mask;
  }

  /* A paste-ready fonts.js entry for an edited glyph.
   *
   * Emits the WHOLE variant array with the edited slot substituted — not just the one
   * variant — because a bare "'A': ['B C G1 G2 K N']," looks identical whether it came
   * from variant 1 or variant 5, and pasting it would silently delete every other
   * variant. The line has to carry its own position.
   *
   * 14-segment edits emit an F14_OVERRIDE entry instead, since that table is DERIVED
   * from the 16-segment one — editing it any other way would be overwritten on rebuild. */
  function fontLine(type, ch, variantIndex, spec) {
    var q = (ch === "'") ? '"\'"' : "'" + ch + "'";
    if (type === '14') {
      return q + ": ['" + spec + "'],   /* -> F14_OVERRIDE */";
    }
    var table = (type === '7') ? F7 : F16;
    var entry = table[ch] || table[ch.toUpperCase()] || table[ch.toLowerCase()];
    var arr = entry ? entry.slice() : [];
    var idx = variantIndex || 0;
    if (idx >= arr.length) arr.push(spec); else arr[idx] = spec;
    var note = arr.length > 1 ? '   /* v' + (idx + 1) + ' of ' + arr.length + ' */' : '';
    return q + ': [' + arr.map(function (v) { return "'" + v + "'"; }).join(', ') + '],' + note;
  }

  NS.fonts = {
    fontLine: fontLine,
    to21: to21,
    ORDER: ORDER,
    TABLES: TABLES,
    lookup: lookup,
    specToSet: specToSet,
    maskOf: maskOf,
    to14: to14
  };
})(window.LED);
