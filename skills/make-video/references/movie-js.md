# `movie.js`: drawing the frames

`movie.js` is an ES module that default-exports `defineMovie({...})`.
It imports VVV's helpers from `'vvv'`, and three.js from `'three'` when a scene needs it.
The examples `examples/wonderful-day/movie.js` (a cartoon) and the scenes below show the patterns in use.

```js
import { defineMovie, text, seg, outCubic, tween } from 'vvv';

export default defineMovie({
  background: '#ffffff',
  captionStyle: { size: 40 },
  scenes: {
    intro: {
      draw(g, s) {
        g.fillStyle = '#f4f2ff';
        g.fillRect(0, 0, s.w, s.h);
        const a = outCubic(seg(s.t, 0.2, 0.8));
        g.globalAlpha = a;
        text(g, 'Meet Orito', { x: s.w / 2, y: 400 + (1 - a) * 20, size: 96, weight: 700, align: 'center', color: '#191919' });
        g.globalAlpha = 1;
      },
    },
  },
  music: (timeline) => ({ bpm: 100, tracks: [] }),
});
```

## The movie

| Field | Meaning |
|---|---|
| `scenes` | One entry per scene id in `script.json`: `{ setup?, draw }`. A scene without an entry shows a placeholder and a warning. |
| `background` | Colour behind every scene. |
| `captionStyle` | Subtitle style: `size` (44), `weight` (500), `color`, `box` (background colour), `bottom` (72 px margin), `width` (0.78 of the frame), `maxLines` (2). |
| `music(timeline)` | Returns the score. See [music.md](music.md). |

## A scene

`setup(s)` runs once before any frame and may be `async`.
Load images and build 3D scenes there, and return whatever `draw` needs.
`s` has `scene`, `timeline`, `w`, `h`, `image(path)` (resolves relative to the movie directory) and `three(options)`.

`draw(g, s)` draws one frame onto `g`, a `CanvasRenderingContext2D` of the full frame size.
It must depend only on `s`:

| `s.` | Meaning |
|---|---|
| `t` | Seconds since the scene started. Animate with this. |
| `d`, `p` | The scene's duration, and `t / d` clamped to 0..1. |
| `T` | Seconds since the movie started, for motion that continues across scenes. |
| `w`, `h` | Frame size. |
| `state` | What `setup` returned. |
| `line(id)` | One of the scene's lines, by its id or by its index from 0. It has `start`, `end` (scene-local seconds), `active`, `p` (progress), `text`, `who`. |
| `lines` | All of the scene's lines. |
| `timeline` | The whole timeline: `scenes`, `lines`, `duration`, `credits`. |

Tie motion to the narration with `s.line(...)`: for example, show a card when its line starts, or move a character's mouth while `line.active`.
This keeps the picture in step even after the voice changes length.

A scene draws the whole frame, background included, because transitions crossfade two scenes drawn separately.

A scene with the id `credits` replaces the automatic credits card; draw `s.timeline.credits` in it.

## Helpers from `'vvv'`

**Text.** `text(g, str, o)` draws wrapped text and returns `{ lines, width, height, overflow }`.
Options: `x`, `y`, `width` (wrap width), `size`, `weight`, `color`, `align`, `baseline` (`'top'` by default, or `'middle'` or `'bottom'` of the block), `lineHeight` (1.4), `maxLines`, `letterSpacing`, `family`, `shadow` (a glow colour), and `measureOnly` to measure without drawing.
Text that does not fit `width` and `maxLines` becomes a warning in `vvv check`.
The default font is Noto Sans JP, which covers Japanese and Latin.

**Timing and easing.** `seg(t, a, b)` is the progress of `t` through `[a, b]`, clamped to 0..1.
Pass it through an easing curve: `outCubic`, `inOutCubic`, `outQuart`, `outExpo`, `inOutExpo` and `sine` move smoothly; `outBack`, `outElastic` and `spring(t)` overshoot and bounce, which suits playful videos only.
`tween(t, t0, t1, a, b, curve)` and `fadeInOut(t, t0, t1)` combine the two, and `lerp` and `clamp` do the arithmetic.

**Randomness.** `rng(seed)` returns a function that gives the same sequence of numbers in 0..1 for the same seed.
Create it at module level for fixed layouts, or with a seed derived from time for per-frame noise.

## Images and SVG

```js
async setup(s) { return { logo: await s.image('assets/logo.svg') }; },
draw(g, s) { g.drawImage(s.state.logo, 660, 400, 600, 167); },
```

Chrome draws SVG sharply at any size.
Keep the image's aspect ratio when you choose the width and height.

## three.js

```js
async setup(s) {
  const L = await s.three({ fov: 40 });
  const { THREE } = L;
  const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0x4619b9 }));
  L.scene.add(cube, new THREE.AmbientLight(0xffffff, 1));
  return { L, cube };
},
draw(g, s) {
  const { L, cube } = s.state;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, s.w, s.h);
  cube.rotation.y = s.t * 0.8;
  L.render(g);
  const p = L.toScreen(cube);
  text(g, 'Cube', { x: p.x, y: p.y + 160, size: 32, align: 'center' });
},
```

`L.render(g)` draws the 3D scene onto the canvas wherever the call sits in the drawing order, so 2D backgrounds go before it and labels after.
`L.toScreen(object or Vector3)` gives the canvas position of a 3D point, for crisp 2D labels.
WebGL draws lines 1 px wide whatever `linewidth` says; use thin `TubeGeometry` for visible links.
Headless Chrome renders WebGL in software, so 3D scenes render several times slower than 2D ones.
