# Reference material

The sources behind this project's fonts and its glare model live here locally, but
are **deliberately not committed**. They are other people's images — vendor scans, a
product photo, and HDR sample files — and a public repo is not the place to
redistribute them. The `.gitignore` excludes them by extension.

What the rest of the repo refers to:

| Referenced as | What it is | Where to get it |
|---|---|---|
| Opto Plus 16-segment **capital** variation chart | The manufacturer sheet showing two and three competing renderings for A, B, E, F, J, K, M, Q, R, S, V, W, X, Y, Z | Opto Plus LED / distributor datasheets |
| Opto Plus 16-segment **lower-case** sheet | The separate lower-case chart; note how much of it lives entirely in the lower half of the glyph | same |
| **OPD-AS5010** product photo | Pin ordering, and the physical proportions of a real part | Vendor listing for the part |
| **Wide-gamut neon, Display P3** (SDR and ST-2084 PQ) | The photograph the glare model is measured against — a PQ HDR frame of magenta neon | See below |

## What was measured, so the numbers survive without the files

From the PQ frame, radially through a tube (absolute nits):

```
 distance   luminance    saturation   G/R
    0 px      1504         0.802      0.198
   +4 px      1062         0.924      0.076
   +6 px       316         0.968      0.032
```

The core is measurably **less saturated** than the rim even in HDR — which is why
`hdr.js` clips per channel rather than preserving chromaticity.

Glare falloff, log-log slope: roughly **−0.3** out to ~32 px, then **−2.5 to −3.5**.
Not Gaussian. That is why the bloom is an octave pyramid with a decaying per-step
weight rather than a single blur.

These two tables are the load-bearing content. The images were how they were obtained.
