# SegmentSim

A 7-, 14- and 16-segment LED display simulator. Vanilla HTML, SVG and JS — no build
step, no dependencies. Open `index.html` in a browser and type.

- **`index.html`** — the simulator. Type text, pick a display type, click any segment to toggle it.

  **If a glyph looks wrong, don't describe it — fix it and copy it.** Click the character
  to select it, click the offending segment, then hit **Copy font line**. You get a
  paste-ready entry like `'s': ['D1 D2 G2 L'],` for `js/fonts.js`. **Copy spec** gives
  just the segment names and **Copy hex** the bitmask. Every font correction in this
  project was originally relayed in prose — "the middle-left cross bar", "the bottom-right
  angle" — which works, but takes about ten times as long and is how `M` got mistaken for
  `L` five separate times.
- **`alphabet.html`** — the whole font laid out as a sheet, each glyph with its bitmask.
  Tick *Show all variants* to see every alternate rendering.

## 5×7 dot matrix

A fifth type, and a different animal — no fixed strokes, just a grid. This is the thing
segment displays were always losing to.

It's modelled on an outdoor monochrome message sign, where **each pixel is a cluster of
discrete through-hole LEDs** rather than one. That's not decoration: a single 5 mm LED at
20 mA cannot be read in direct sunlight, and a cluster multiplies the output without
growing the pixel. It's how outdoor signs were built until high-brightness SMD parts made
single-LED pixels viable. `display.js` allows a "segment" to be a *list* of shapes for
exactly this reason.

### The cluster is a flower, and its size isn't free

One LED in the middle, then rings of 6, 12, 18 — **centred hexagonal packing**, the
densest possible arrangement of equal circles, which is what you use to get the most dice
into a round aperture. A *complete* flower therefore only exists at the **centred
hexagonal numbers: 1, 7, 19, 37, 61**. There is no such thing as a five-LED flower.

`hexCluster` generates them from axial hex coordinates, so `rings = 0/1/2` produces
exactly 1/7/19 and **cannot** produce anything else — the shape enforces its own legal
sizes rather than trusting a constant. The **LEDs per dot** control (visible only in 5×7
mode) switches between them; the cluster keeps the same overall diameter, so what changes
is the *grain*, not the pixel size. 7 is what the reference sign uses.

A 5-wide glyph occupies a **6-wide slot** — one full dot pitch between characters, which
is the standard.

### The font is ASCII art on purpose

`matrix.js` stores each glyph as seven five-character rows:

```js
'R': ['#### ','#   #','#   #','#### ','# #  ','#  # ','#   #'],
```

Five hex bytes per glyph is the compact firmware format and it is **unreviewable** — you
cannot see a mistake in `0x7E 0x11 0x11`. Here you can read the letter in the source,
which is how errors actually get caught. It's converted to dot names at load, and the
loader throws if any glyph isn't exactly 7×5.

Lowercase is authored too. A true 5×7 has **no room below the baseline**, so there is no
descender zone — `g j p q y` fit their tails inside the last row, which is why they sit a
row higher than their neighbours. x-height occupies rows 2–6; ascenders (`b d f h k l t`)
reach row 0. It's the same squeeze the 22-segment display solved by buying an extra
segment; here it's solved by compromise.

## Segment naming

Names follow the **OPD-AS5010** pinout (see `docs/`), clockwise from the top-left:

```
   A1  A2
 F  H J K  B          16-seg: A1 A2 B C D1 D2 E F G1 G2 H J K L M N  (+ DP)
 G1       G2          14-seg: A  B  C  D  E  F  G1 G2 H J K L M N    (+ DP)
 E  N M L  C           7-seg: A  B  C  D  E  F  G                    (+ DP)
   D1  D2
```

**21-segment** goes the other way: the same 16 strokes, plus the five **junctions** a
starburst leaves open — `CT`, the hub at the dead centre where `G1 G2 H J K L M N` all
converge, and `TL TR BL BR`, the 45-degree chamfers that close the outer corners.

They are not new strokes, so the font needs no new entries. It **derives** from the
16-segment table by two rules (`fonts.js` → `to21`):

- **`CT` lights when two or more strokes actually meet at the centre.** A lone diagonal has
  no junction to close, so a `,` stays a comma instead of growing a blob.
- **A corner lights when both bars forming it are lit** — which is what turns a square `O`
  into a proper octagonal ring.

Everything downstream (variants, masks, lookups, the block character) comes along for
free. 21 segments + DP is 22 bits, so **Copy C array** emits `uint32_t`.

🅿️ **21-segment is PARKED and unfinished.** The junctions are overlaid on unchanged
16-segment geometry, so they overlap the bars they are meant to join — on the real part
the outer bars are shorter to make room. Fixing it means `build()` becoming type-aware
with a second set of bar lengths to maintain, and the letterforms need work besides. The
derivation is sound and it renders; it is not done. Deliberate, not forgotten.

14-segment is just 16-segment with the split outer bars merged: `A1|A2 → A`,
`D1|D2 → D`. That merge is the entire difference, and it is done in code
(`fonts.js` → `to14`), so there is one font table to maintain, not two.

**The merge has one trap, and it bites.** Any glyph using a *half* bar as a **serif**
gets that serif promoted to a full bar. Lowercase `l` is `A1 D2 J M` on 16-seg — a
top-left tick and a bottom-right foot — and merging it produces `A D J M`, which is
byte-identical to `I` (`0x1209`, both of them). A serif is the one feature you cannot
scale up. Such glyphs are listed in `F14_OVERRIDE` and drop the serif instead.

Two different repairs, depending on what the half-bar was doing:

- **Decorative** — a serif or a foot — **drop it.** `l` loses both its top tick *and* its
  bottom-right foot: merged, the tick becomes the top bar of an `I` and the foot becomes
  the base of an upside-down `T`. `i` and `t` lose one each.
- **Structural** — **fall back to uppercase**, because trimming produces a different
  letter. `f` is the case: its `A2` is the hook, and on 14-seg the top bar always spans
  the *full* width, so the hook necessarily extends left of the stem, which is the one
  thing an `f` never does. Every trimmed variant reads as a `T` with a tick.

A lone half-bar at the **bottom** is not automatically safe — it depends whether it was
carrying a foot (`l`, `t`) or just closing a shape (`j`, `z`, where a fuller bottom bar
is harmless).

### Auditing the font

Any time you edit `fonts.js`, check that you haven't made two characters identical:

```js
// node -e "$(cat this)"  — from the project root
global.window = {}; require('./js/fonts.js');
const F = window.LED.fonts;
['7', '14', '16'].forEach(t => {
  const seen = {};
  Object.keys(F.TABLES[t]).forEach(ch => {
    // EVERY variant, not just variant 0 — a duplicate hiding in a variant slot
    // is invisible otherwise, which is how R v2 sat identical to A v1 unnoticed.
    F.TABLES[t][ch].forEach((spec, i) => {
      const m = F.maskOf(t, F.specToSet(spec));
      const tag = (ch === ' ' ? 'SP' : ch) + (F.TABLES[t][ch].length > 1 ? 'v' + (i + 1) : '');
      (seen[m] = seen[m] || []).push(tag);
    });
  });
  console.log(t + '-seg:', Object.keys(seen)
    .filter(m => seen[m].length > 1).map(m => seen[m].join('=')).join('  '));
});
```

Some collisions are canonical and should stay: `0=O` (that's what the slashed-zero
toggle is for), `5=S`, `9=g`, `:=|` (a real colon wants two dots and there is no segment
for them), `(=[`, and on 7-segment the whole familiar crowd — `U=V`, `2=Z`, `H=X`,
`I=l=|`.

`*=★` is a deliberate alias — the asterisk glyph *is* the star.

14-segment adds three of its own, all of them deliberate consequences of the override
table above: `F=f`, `+=t` (a footless `t` *is* a cross) and `:=l=|` (a lowercase `l`
*is* a vertical stroke — it collides in most sans-serif typefaces too). Each is the
better trade: the alternative in every case was a glyph that read as a different letter.
Anything else is a bug.

### Bit order

Bit 0 is the first name in the list above; `DP` is the high bit. This matches the
conventional 7-segment tables — `'0'` comes out as **`0x3F`**, which is the value in
every datasheet and lookup table you will find. 7-seg fits `uint8_t`, 14-seg
`uint16_t`, 16-seg needs 17 bits so **Copy C array** emits `uint32_t`.

## Why the letters look like that

The single fact that explains most of the 16-segment alphabet: **the four diagonals
(`H K L N`) all radiate from the exact centre of the glyph to a corner.** Nothing runs
from a mid-edge to the bottom centre. So:

- **V** cannot be two arms converging at the bottom. It is `E F K N` — the left rail
  plus the `/` slash. (Opto Plus's own chart agrees; this is not a shortcut.)
- **W** is `B C E F L N` — both full verticals plus the two lower diagonals meeting at
  the centre, which genuinely traces a W.
- **M** is the same trick upside down: `B C E F H K`.
- **X** is all four diagonals; **Y** is the two upper ones plus the lower stem.
- **B** and **D** use `J M` (the centre verticals) for the straight backs of their
  bowls, which is why they don't collide with `8` and `0`.

## Fonts and variants

There is no canonical 16-segment alphabet. Manufacturers publish *variation* charts —
the one in `docs/` shows two and three competing renderings for A, B, E, F, J, K, M, Q,
S, V, W, Y and Z. So every entry in `fonts.js` is an **array of variants**:

```js
'Y': ['H K M', 'B F G1 G2 M', 'B F G1 G2 M D1 D2'],
```

Variant 0 is the most legible / most widely used form. The **Font** dropdown picks
between *Classic* (always variant 0) and *Opto Plus chart* (the primary row of the
reference sheet, which differs on J, M, W and Y). Select a cell in the simulator to
cycle its variant individually, or click segments to build something that isn't in the
font at all.

**Lowercase:** all three types have real lowercase. The 16-segment set is read off
Opto Plus's separate lower-case sheet (`docs/`), and the striking thing about it is how
many letters live entirely *below the middle bar* — `c m n o r s u v w x z` are all
sub-x-height, which is precisely what makes mixed case legible on a starburst instead
of looking like shouting. Turn **Lowercase glyphs** off to fold everything to uppercase,
which is what most real firmware does.

7-segment needs its lowercase for a different reason: uppercase `B` and `D` are
*impossible* on seven segments — they'd render as `8` and `0` — so the lowercase forms
are the only way to spell those letters at all.

One 16-segment lowercase entry (`w`) is my best reading of a small italic chart rather
than a confident transcription. It's marked in `fonts.js`. If you disagree, click the
segments and the inspector will give you the corrected mask.

### Two deliberate deviations from the chart

Kept as variant 2, so nothing is lost:

- **`n`** — Opto draw it full-height. Nothing collides with a half-height `n` (`C E G1 G2`);
  I checked the whole table. And full-height `n` is exactly why *television* renders as
  *teleVisioN*. Going x-height takes the lowercase x-height count from 9/26 to 11/26, and
  among the ten commonest letters in English from two (`o r`) to four (`o n s r`).
- **`j`** — Opto's `A1 A2 C D1 D2` leaves the top bar floating clear of the stem, which
  reads as mangled. `A2 C D2` puts the break where it belongs: `A2` reads as the **dot**,
  the gap where `B` would be separates it from the stem, and `D2` is the hook. 14-segment
  has no half bars — merging would put the top bar back across the full width — so it
  gets its own `B C D` in `F14_OVERRIDE`: full right stroke, hook left, no dot.

### No heart, and why

`<3` does not work and cannot be made to. A heart is two lobes over a **downward point**,
and the point needs two strokes converging at the bottom centre — but every diagonal here
runs centre-to-corner, so you can draw the splay (`N L`, apex up) and never the point.
It is the same missing primitive that makes the letter `V` awkward. Seven candidates were
tried; the least bad shares four segments with `M` and duly reads as an M with a tail, so
none is shipped. **A wrong glyph mid-word is worse than a blank.**

Arrows *do* work — `→ ← ↑ ↓ ★` are in the font — because an arrowhead is a pair of
diagonals radiating from the centre, which is the thing this geometry is actually good at.

Emoji render blank and are listed in the hint line under the display. That is not a
limitation to route around: the font is a 17-bit lookup table per character, so there is
no emoji to be had at any effort. A real module does the same thing — unmapped code, no
light.

**The transcription trap, and it caught five glyphs before it was named:** the chart is
set in italic, so every vertical bar already leans — which makes a genuine diagonal read
as just another leaning bar. `p` and `q` close their bowls with `K`, not `B`. `s`, `w`
and `k` all use `L`, not `M` — `w` is `C E L N`, two v's sharing the centre apex.

If you go back to the chart, measure rather than squint. The reliable test is to compare
a stroke's lean against a segment you are *sure* is vertical in the same row: under this
chart's italic a true vertical leans about −6 px over the lower half, so a stroke
measuring near zero is a down-right diagonal, and one near −11 is a down-left one.

Lowercase `s` is worth reading as a cautionary tale. I first transcribed it as
`D1 D2 G2 M`, concluded from that reading that a sub-x-height `s` is *geometrically
impossible* — the lower half has a top bar and a bottom bar and nothing between them,
and an `s` needs three horizontals — and defaulted to the uppercase form on that basis.

All of which was downstream of one misread segment. The chart uses **`L`, the lower-right
diagonal**, not `M`, the centre vertical. The diagonal bridges the gap that the missing
middle horizontal leaves, so the letter is perfectly possible and Opto Plus solved it
neatly. The uppercase form is now variant 2.

Note what went wrong there: a bad transcription didn't just produce a bad glyph, it
produced a confident *architectural* conclusion ("impossible") that justified a different
design decision entirely. Check the pixels before you theorise about the geometry.

## URL parameters

Any control can be set in the query string, so a configuration is linkable:

```
index.html?text=HELLO&type=14&slant=12&color=%2335ff72&size=170&labels=1
```

Recognised: `text` `type` `style` `color` `preset` `bloom` `slant` `size` `thick` `gap`
`ghost` `labels` `slashzero` `lowercase`. Otherwise settings persist in `localStorage`.

## Other things worth knowing

- A `.` in the text folds onto the **previous** cell as its decimal point, the way a
  real multiplexed module works. `88.8.8.` is four cells, not six.
- **Slant** skews about the vertical centre, so the glyph leans without drifting
  sideways. The viewBox widens to match, so nothing clips.
- **Thickness** and **Gap** drive the geometry directly — every segment is generated
  from three primitives in `geometry.js` (mitred horizontal bar, mitred vertical bar,
  parallelogram diagonal), so the whole font rescales coherently.
- **Lamp test** lights everything, which is what a real module does at power-on.

## Bloom and Blowout — two sliders, because they are two phenomena

It is tempting to drive all of this from one "glow" control. Don't: photographing a lit
display involves two *independent* effects, and welding them together means a heavy glow
always washes out to white, so a red display stops looking red.

| control | what it is physically | what it changes |
|---|---|---|
| **Bloom** | optics — scatter in the diffuser, flare in the lens | how far the light spreads |
| **Blowout** | exposure — how far past the sensor's clipping point | how hard the core goes white |

Either can exist without the other. A long exposure of a dim emitter is *all* halo and
stays fully saturated. A bright emitter at low exposure is tight and saturated with no
spread at all. **Nixie tubes are the case that proves it**: photographs of them have an
enormous orange glow and the tubes never go white — high bloom, low blowout. That preset
is set that way deliberately, and it is the quickest way to feel the difference between
the two sliders.

Only Blowout desaturates. If a colour is washing out and you want the glow anyway, that
is the slider to pull down.

## How the bloom is built

Photograph a lit LED and it does not simply get brighter — the sensor saturates. The
core blows past white, the pixels just outside it clip in two channels but not the
third, and further out you finally see the true hue. So a photographed red LED reads
**warm white → yellow → orange → red → dark**, and a single blurred drop-shadow gets
none of that; it just makes a red smudge.

`display.js` → `bloomFilter(bloom, blowout)` builds an SVG filter with up to three
layers, applied once per glyph to the lit segments only. Layers whose contribution would
be zero are not emitted at all, so `blowout: 0` genuinely has no core primitives rather
than running them as a no-op:

| layer | what it is | what it looks like |
|---|---|---|
| `halo` | wide blur, low alpha | the wash that lights up the surrounding board |
| `glow` | tight blur, *partially* lifted toward white | the orange/yellow transition band |
| `core` | blur → alpha threshold → hard lift toward warm white | the blown-out highlight |

`halo` and `glow` are sized by **Bloom**. The lift on `glow` and everything about `core`
are driven by **Blowout** — partial clipping is what *causes* the orange band, so the
fringe belongs on the exposure axis, not the optical one.

The middle layer is the one that matters and the one that is easy to leave out. It sits
*underneath* the segment, so it only shows as a fringe around the edge — and that fringe
is the entire difference between "photo of a real display" and "vector drawing of a
glow." The core is a blur-then-threshold rather than an `feMorphology` erode, because
erode goes chunky at the small radii this needs and a real highlight has a soft edge.
The white is deliberately *warm* (less lift in blue than in green); a neutral-white core
reads as CGI.

One filter is defined once in the document and referenced by every glyph via
`url(#bloom)`, so a 76-character string is 76 filter *references*, not 76 filter
definitions. It is still real GPU work — three Gaussian blurs over a filter region 3.6×
the glyph in each dimension — and I have not benchmarked it honestly (headless Chrome
freezes `performance.now()` under virtual time, so the obvious measurement lies). If a
long string ever feels sticky, the bloom slider is the knob; at `0` the filter is not
applied at all rather than being applied as a no-op.

⚠️ **Do not fake ambient spill with an inset `box-shadow` on the module face.** It glows
inward from the bezel, uniformly, whether or not anything near that edge is lit — so the
frame lights up instead of the emitters, including across a completely dark half of the
display. The halo layer already spills onto the face, and it spills from where the light
actually is.

## Emitter presets

The swatches are display *technologies*, not just colours, because colour and bloom
aren't independent — neon glows through a gas and blooms far more than a GaP die does,
and a VFD's phosphor has a softer edge than either. Picking one sets both.

`LED · GaAsP red` · `LED · amber` · `LED · GaP green` · `LED · InGaN blue` ·
`VFD · cyan` · `CRT · P3 amber` · `CRT · P1 green` · `Nixie · neon` · `Plasma · orange`

The hex values are the conventional emulator approximations for these technologies, not
colorimetric measurements. The colour picker at the end of the row sets colour alone and
leaves bloom where it is.

## Files

```
index.html       simulator
alphabet.html    font sheet
css/style.css
js/geometry.js   segment polygon construction
js/fonts.js      character maps (variants) + bit order
js/display.js    set of segments -> <svg>
js/app.js        UI wiring
docs/            Opto Plus 16-segment variation chart
```

## Credit

The alphabet charts in `docs/` — both the capital variation sheet and the lower-case
sheet — are Opto Plus LED Corp.'s, and the segment naming follows their OPD-AS5010
datasheet.
