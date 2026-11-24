// ワンダフル・デイ: Mina, Haru, Grandpa Gen and Pochi the dog find out they are in a video.
import {
  defineMovie, text, seg, clamp, lerp, outBack, outCubic, inOutCubic, outElastic, rng,
} from 'vvv';

const INK = '#3a2420';
const SKIN = '#ffe0c8';
const BLUSH = 'rgba(255, 120, 130, 0.45)';

// ---------- drawing helpers ----------

function ell(g, x, y, rx, ry, fill, stroke = INK, lw = 5, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
}

function path(g, pts, fill, stroke = INK, lw = 5, close = true) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  if (close) g.closePath();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
}

/** Anime eye: big iris with two highlights, or a closed arc when blinking. */
function eye(g, x, y, s, iris, blink, look = 0) {
  if (blink) {
    g.beginPath();
    g.arc(x, y + 4 * s, 16 * s, Math.PI * 1.1, Math.PI * 1.9);
    g.lineWidth = 6 * s;
    g.strokeStyle = INK;
    g.stroke();
    return;
  }
  ell(g, x, y, 17 * s, 23 * s, '#fff', INK, 4 * s);
  ell(g, x + look * 4 * s, y + 3 * s, 13 * s, 18 * s, iris, null);
  ell(g, x + look * 4 * s, y + 6 * s, 7 * s, 10 * s, '#1b1020', null);
  ell(g, x + look * 4 * s - 5 * s, y - 5 * s, 5 * s, 6 * s, '#fff', null);
  ell(g, x + look * 4 * s + 5 * s, y + 10 * s, 2.5 * s, 2.5 * s, '#fff', null);
}

/** Mouth: a small smile when closed; open while talking. */
function mouth(g, x, y, s, open, wide = 1) {
  if (open > 0.05) {
    ell(g, x, y + 4 * s, 13 * s * wide, (5 + 12 * open) * s, '#8a2b35', INK, 3.5 * s);
    ell(g, x, y + (8 + 8 * open) * s, 7 * s * wide, 4 * s * open, '#ff8a96', null);
  } else {
    g.beginPath();
    g.arc(x, y - 4 * s, 11 * s * wide, Math.PI * 0.2, Math.PI * 0.8);
    g.lineWidth = 4 * s;
    g.strokeStyle = INK;
    g.stroke();
  }
}

/** How open a speaker's mouth is: flaps while the line plays. */
function flap(line, t) {
  if (!line || !line.active) return 0;
  return 0.35 + 0.65 * Math.abs(Math.sin((t - line.start) * 17));
}

/** Blink for a few frames now and then, at times set by a seed. */
function blinking(t, seed) {
  const period = 2.6 + (seed % 5) * 0.37;
  return (t + seed * 0.71) % period < 0.12;
}

// ---------- characters (origin: feet centre; s: scale) ----------

function drawMina(g, x, y, s, o) {
  g.save();
  g.translate(x, y);
  g.rotate(o.fall ?? 0);
  g.translate(0, -(o.hop ?? 0));
  // Twin tails behind the head.
  for (const side of [-1, 1]) {
    const sway = Math.sin(o.t * 3 + side) * 6;
    path(g, [[side * 70 * s, -300 * s], [side * (150 + sway) * s, -230 * s], [side * (135 + sway) * s, -140 * s], [side * 95 * s, -190 * s]], '#e86f7f');
  }
  // Body: dress and legs.
  path(g, [[-18 * s, -20 * s], [-18 * s, 0], [-4 * s, 0], [-4 * s, -20 * s]], SKIN, INK, 4);
  path(g, [[4 * s, -20 * s], [4 * s, 0], [18 * s, 0], [18 * s, -20 * s]], SKIN, INK, 4);
  path(g, [[-62 * s, -20 * s], [-34 * s, -150 * s], [34 * s, -150 * s], [62 * s, -20 * s]], '#ff5f6d');
  path(g, [[-34 * s, -150 * s], [0, -120 * s], [34 * s, -150 * s]], '#fff', INK, 4, false);
  // Arms: wave while talking.
  const wave = o.talk ? Math.sin(o.t * 10) * 0.5 : 0;
  g.save(); g.translate(40 * s, -130 * s); g.rotate(-0.6 + (o.armUp ? -1.6 + wave : 0));
  ell(g, 0, 40 * s, 13 * s, 42 * s, SKIN); g.restore();
  g.save(); g.translate(-40 * s, -130 * s); g.rotate(0.5);
  ell(g, 0, 40 * s, 13 * s, 42 * s, SKIN); g.restore();
  // Head.
  ell(g, 0, -250 * s, 100 * s, 92 * s, SKIN);
  ell(g, -55 * s, -222 * s, 18 * s, 10 * s, BLUSH, null);
  ell(g, 55 * s, -222 * s, 18 * s, 10 * s, BLUSH, null);
  eye(g, -36 * s, -252 * s, s, '#2aa3a0', blinking(o.t, 3) && !o.shock, o.look);
  eye(g, 36 * s, -252 * s, s, '#2aa3a0', blinking(o.t, 3) && !o.shock, o.look);
  mouth(g, 0, -205 * s, s, o.mouth ?? 0, o.shock ? 1.4 : 1);
  // Fringe.
  path(g, [[-104 * s, -250 * s], [-90 * s, -330 * s], [0, -360 * s], [90 * s, -330 * s], [104 * s, -250 * s],
    [70 * s, -300 * s], [40 * s, -280 * s], [10 * s, -305 * s], [-25 * s, -282 * s], [-60 * s, -300 * s]], '#e86f7f');
  // Ribbon.
  path(g, [[50 * s, -340 * s], [95 * s, -365 * s], [95 * s, -315 * s]], '#ffd84d');
  path(g, [[50 * s, -340 * s], [15 * s, -370 * s], [20 * s, -320 * s]], '#ffd84d');
  g.restore();
}

function drawHaru(g, x, y, s, o) {
  g.save();
  g.translate(x, y);
  g.rotate(o.fall ?? 0);
  g.translate(0, -(o.hop ?? 0));
  // Legs and shorts.
  ell(g, -20 * s, -25 * s, 12 * s, 28 * s, SKIN, INK, 4);
  ell(g, 20 * s, -25 * s, 12 * s, 28 * s, SKIN, INK, 4);
  path(g, [[-45 * s, -45 * s], [-40 * s, -85 * s], [40 * s, -85 * s], [45 * s, -45 * s]], '#3d5a99');
  // Shirt.
  path(g, [[-50 * s, -80 * s], [-42 * s, -160 * s], [42 * s, -160 * s], [50 * s, -80 * s]], '#4fc08d');
  text(g, 'V', { x: 0, y: -120 * s, size: 38 * s, weight: 900, align: 'center', baseline: 'middle', color: '#fff' });
  // Arms: fists up when excited.
  for (const side of [-1, 1]) {
    g.save(); g.translate(side * 46 * s, -150 * s); g.rotate(side * (o.cheer ? 2.6 + Math.sin(o.t * 12) * 0.2 : 0.45));
    ell(g, 0, 36 * s, 12 * s, 38 * s, SKIN); ell(g, 0, 74 * s, 13 * s, 13 * s, SKIN); g.restore();
  }
  // Head.
  ell(g, 0, -255 * s, 96 * s, 90 * s, SKIN);
  ell(g, -52 * s, -226 * s, 15 * s, 8 * s, BLUSH, null);
  ell(g, 52 * s, -226 * s, 15 * s, 8 * s, BLUSH, null);
  eye(g, -34 * s, -255 * s, s * 0.92, '#8a5a2b', blinking(o.t, 1) && !o.shock, o.look);
  eye(g, 34 * s, -255 * s, s * 0.92, '#8a5a2b', blinking(o.t, 1) && !o.shock, o.look);
  mouth(g, 0, -210 * s, s, o.mouth ?? 0, o.shock ? 1.4 : 1.1);
  // Spiky hair.
  const spikes = [];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    const r = (i % 2 ? 112 : 92) * s;
    spikes.push([Math.cos(a) * r, -268 * s + Math.sin(a) * r * 0.95]);
  }
  path(g, [[-98 * s, -240 * s], ...spikes, [98 * s, -240 * s], [60 * s, -300 * s], [20 * s, -282 * s], [-15 * s, -305 * s], [-55 * s, -285 * s]], '#2f3f73');
  g.restore();
}

function drawGen(g, x, y, s, o) {
  g.save();
  g.translate(x, y);
  g.rotate(Math.sin(o.t * 6) * 0.03 * (o.walking ? 1 : 0));
  // Cane.
  g.lineWidth = 9 * s; g.strokeStyle = '#7a4b25'; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-95 * s, 0); g.lineTo(-80 * s, -150 * s); g.arc(-60 * s, -150 * s, 20 * s, Math.PI, 0); g.stroke();
  // Legs, body, vest.
  path(g, [[-36 * s, 0], [-30 * s, -90 * s], [30 * s, -90 * s], [36 * s, 0]], '#6b6f7a');
  path(g, [[-62 * s, -80 * s], [-55 * s, -190 * s], [55 * s, -190 * s], [62 * s, -80 * s]], '#f3ead8');
  path(g, [[-62 * s, -80 * s], [-55 * s, -190 * s], [-15 * s, -190 * s], [-20 * s, -80 * s]], '#9c6b3e');
  path(g, [[62 * s, -80 * s], [55 * s, -190 * s], [15 * s, -190 * s], [20 * s, -80 * s]], '#9c6b3e');
  ell(g, -70 * s, -140 * s, 14 * s, 45 * s, '#f3ead8', INK, 5, 0.3);
  // Head: bald with side hair.
  ell(g, 0, -275 * s, 88 * s, 84 * s, SKIN);
  ell(g, -82 * s, -280 * s, 22 * s, 30 * s, '#f4f4f4');
  ell(g, 82 * s, -280 * s, 22 * s, 30 * s, '#f4f4f4');
  ell(g, 25 * s, -335 * s, 20 * s, 8 * s, 'rgba(255,255,255,0.7)', null, 0, -0.4);
  // Bushy eyebrows and squinting eyes ("ho ho").
  for (const side of [-1, 1]) {
    ell(g, side * 34 * s, -300 * s, 26 * s, 11 * s, '#f4f4f4', INK, 4, side * -0.15);
    g.beginPath(); g.arc(side * 32 * s, -275 * s, 12 * s, Math.PI * 1.15, Math.PI * 1.85);
    g.lineWidth = 5 * s; g.strokeStyle = INK; g.stroke();
  }
  ell(g, 0, -250 * s, 15 * s, 13 * s, '#ffc4a8', INK, 4);
  // Beard: opens with the mouth.
  const open = o.mouth ?? 0;
  path(g, [[-70 * s, -240 * s], [-60 * s, -180 * s], [-30 * s, -140 * s], [0, (-128 + open * 8) * s], [30 * s, -140 * s], [60 * s, -180 * s], [70 * s, -240 * s], [0, -225 * s]], '#f4f4f4');
  if (open > 0.05) ell(g, 0, -210 * s, 14 * s, (4 + 9 * open) * s, '#8a2b35', INK, 3.5);
  // Mustache.
  ell(g, -24 * s, -230 * s, 30 * s, 12 * s, '#fff', INK, 4, 0.25);
  ell(g, 24 * s, -230 * s, 30 * s, 12 * s, '#fff', INK, 4, -0.25);
  g.restore();
}

function drawPochi(g, x, y, s, o) {
  g.save();
  g.translate(x, y - (o.hop ?? 0));
  const sq = o.squash ?? 1;
  g.scale(1 / sq, sq);
  const fur = '#e8a25a';
  // Curled tail, wagging.
  g.save(); g.translate(-75 * s, -95 * s); g.rotate(Math.sin(o.t * 16) * 0.35);
  ell(g, -10 * s, -25 * s, 26 * s, 26 * s, fur); ell(g, -10 * s, -25 * s, 11 * s, 11 * s, '#fff2df', INK, 4); g.restore();
  // Body and legs.
  ell(g, 0, -70 * s, 85 * s, 55 * s, fur);
  for (const lx of [-50, -20, 25, 55]) ell(g, lx * s, -20 * s, 13 * s, 24 * s, fur, INK, 4);
  ell(g, 25 * s, -70 * s, 40 * s, 32 * s, '#fff2df', null);
  // Head.
  const hx = 70 * s;
  const hy = -150 * s;
  path(g, [[hx - 55 * s, hy - 30 * s], [hx - 45 * s, hy - 95 * s], [hx - 10 * s, hy - 50 * s]], fur);
  path(g, [[hx + 55 * s, hy - 30 * s], [hx + 45 * s, hy - 95 * s], [hx + 10 * s, hy - 50 * s]], fur);
  ell(g, hx, hy, 70 * s, 60 * s, fur);
  ell(g, hx, hy + 25 * s, 42 * s, 30 * s, '#fff2df', null);
  ell(g, hx - 26 * s, hy - 12 * s, 9 * s, 12 * s, '#1b1020', null);
  ell(g, hx + 26 * s, hy - 12 * s, 9 * s, 12 * s, '#1b1020', null);
  ell(g, hx - 23 * s, hy - 16 * s, 3.5 * s, 4 * s, '#fff', null);
  ell(g, hx + 29 * s, hy - 16 * s, 3.5 * s, 4 * s, '#fff', null);
  ell(g, hx, hy + 10 * s, 11 * s, 8 * s, '#1b1020', null);
  const bark = o.bark ?? 0;
  if (bark > 0.05) {
    ell(g, hx, hy + 34 * s, 22 * s, 6 * s + 18 * s * bark, '#8a2b35', INK, 4);
    ell(g, hx, hy + 40 * s + 10 * s * bark, 12 * s, 6 * s * bark, '#ff8a96', null);
  } else {
    g.beginPath(); g.moveTo(hx - 16 * s, hy + 28 * s); g.quadraticCurveTo(hx - 8 * s, hy + 36 * s, hx, hy + 26 * s);
    g.quadraticCurveTo(hx + 8 * s, hy + 36 * s, hx + 16 * s, hy + 28 * s); g.lineWidth = 4 * s; g.strokeStyle = INK; g.stroke();
  }
  g.restore();
}

// ---------- scenery and effects ----------

const R = rng(42);
const CLOUDS = Array.from({ length: 5 }, () => ({ x: R() * 2200, y: 90 + R() * 240, s: 0.6 + R() * 0.7, v: 12 + R() * 18 }));
const FLOWERS = Array.from({ length: 40 }, () => ({ x: R() * 1920, y: 860 + R() * 200, c: ['#ff7aa2', '#ffd84d', '#ffffff', '#b98bff'][Math.floor(R() * 4)] }));

function park(g, w, h, T) {
  const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
  sky.addColorStop(0, '#6ec3ff');
  sky.addColorStop(1, '#d4f0ff');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  // Sun with slowly turning rays.
  g.save(); g.translate(1650, 170); g.rotate(T * 0.15);
  for (let i = 0; i < 12; i++) { g.rotate(Math.PI / 6); path(g, [[0, -95], [12, -140], [-12, -140]], '#ffe27a', null); }
  g.restore();
  ell(g, 1650, 170, 80, 80, '#ffd84d', '#f5b82e', 6);
  for (const c of CLOUDS) {
    const x = ((c.x + T * c.v) % 2300) - 200;
    for (const [dx, dy, r] of [[0, 0, 60], [55, -25, 55], [110, 0, 60], [55, 15, 60]]) ell(g, x + dx * c.s, c.y + dy * c.s, r * c.s, r * c.s * 0.8, '#fff', null);
  }
  // Hills and grass.
  g.fillStyle = '#8fd46b';
  g.beginPath(); g.moveTo(0, 760); g.quadraticCurveTo(500, 600, 1000, 740); g.quadraticCurveTo(1500, 640, 1920, 720); g.lineTo(1920, h); g.lineTo(0, h); g.fill();
  g.fillStyle = '#6cc04a';
  g.fillRect(0, 820, w, h - 820);
  // Tree.
  g.fillStyle = '#8a5a35'; g.fillRect(170, 520, 50, 320);
  for (const [dx, dy, r] of [[0, 0, 120], [-90, 60, 90], [90, 60, 95], [0, 90, 100]]) ell(g, 195 + dx, 470 + dy, r, r * 0.9, '#4eaa3c', '#3b8a2d', 6);
  for (const f of FLOWERS) { ell(g, f.x, f.y, 7, 7, f.c, null); ell(g, f.x, f.y, 2.5, 2.5, '#ffb02e', null); }
}

/** Speech bubble pointing at (px, py). */
function bubble(g, str, cx, cy, px, py, alpha) {
  if (alpha <= 0) return;
  const size = 46;
  const m = text(g, str, { x: 0, y: 0, width: 640, size, weight: 700, measureOnly: true, lineHeight: 1.3 });
  const bw = m.width + 70;
  const bh = m.height + 46;
  g.save();
  g.globalAlpha = alpha;
  const k = 0.8 + 0.2 * outBack(clamp(alpha));
  g.translate(cx, cy); g.scale(k, k); g.translate(-cx, -cy);
  path(g, [[cx - 30, cy + bh / 2 - 6], [px, py], [cx + 30, cy + bh / 2 - 6]], '#fff', INK, 6);
  g.beginPath(); g.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, 40);
  g.fillStyle = '#fff'; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
  g.fillStyle = '#fff'; g.fillRect(cx - 27, cy + bh / 2 - 10, 54, 10);
  text(g, str, { x: cx, y: cy, width: 640, size, weight: 700, align: 'center', baseline: 'middle', color: INK, lineHeight: 1.3 });
  g.restore();
}

function lineAlpha(l, t) {
  if (!l) return 0;
  return Math.min(seg(t, l.start - 0.15, l.start + 0.1), 1 - seg(t, l.end + 0.35, l.end + 0.6));
}

/** Comic "ワン！" burst. */
function burst(g, x, y, t0, t) {
  const p = seg(t, t0, t0 + 0.5);
  if (p <= 0 || p >= 1) return;
  g.save();
  g.translate(x, y);
  g.rotate(-0.15);
  const k = outBack(seg(t, t0, t0 + 0.15)) * (1 - seg(t, t0 + 0.35, t0 + 0.5) * 0.3);
  g.scale(k, k);
  g.globalAlpha = 1 - seg(t, t0 + 0.35, t0 + 0.5);
  const pts = [];
  for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; const r = i % 2 ? 70 : 105; pts.push([Math.cos(a) * r * 1.4, Math.sin(a) * r]); }
  path(g, pts, '#fff35c', INK, 6);
  text(g, 'ワン！', { x: 0, y: 0, size: 64, weight: 900, align: 'center', baseline: 'middle', color: '#e2402f' });
  g.restore();
}

/** Speed lines behind a shocked moment. */
function speedLines(g, w, h, alpha, T) {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha * 0.55;
  const r = rng(Math.floor(T * 20));
  g.strokeStyle = '#fff';
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const r0 = 380 + r() * 200;
    g.lineWidth = 2 + r() * 8;
    g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0); g.lineTo(w / 2 + Math.cos(a) * 1400, h / 2 + Math.sin(a) * 1400); g.stroke();
  }
  g.restore();
}

// ---------- the movie ----------

export default defineMovie({
  background: '#6ec3ff',

  scenes: {
    hello: {
      draw(g, s) {
        const { t, w, h } = s;
        park(g, w, h, s.T);
        const mina = s.line('mina-1');
        const haru = s.line('haru-1');
        const enter = outBack(seg(t, 0, 0.6));
        drawPochi(g, 960, 940, 1.3, { t, hop: Math.abs(Math.sin(t * 5)) * 10 });
        drawMina(g, lerp(-250, 560, enter), 960, 1.4, {
          t, mouth: flap(mina, t), talk: mina.active, armUp: mina.active, hop: mina.active ? Math.abs(Math.sin(t * 9)) * 14 : 0, look: 1,
        });
        const cheer = t > haru.start;
        drawHaru(g, lerp(2200, 1360, enter), 960, 1.4, {
          t, mouth: flap(haru, t), cheer, hop: cheer ? Math.abs(Math.sin(t * 11)) * 26 : 0, look: -1,
        });
        bubble(g, mina.text, 620, 190, 580, 420, lineAlpha(mina, t));
        bubble(g, haru.text, 1340, 190, 1360, 400, lineAlpha(haru, t));
      },
    },

    bark: {
      draw(g, s) {
        const { t, w, h } = s;
        const gen = s.line('gen-1');
        const kids = s.line('kids-1');
        // Zoom in a little on the shock.
        const shock = seg(t, kids.start - 0.05, kids.start + 0.1);
        const zoom = 1 + 0.06 * outElastic(shock);
        g.save();
        g.translate(w / 2, h / 2); g.scale(zoom, zoom); g.translate(-w / 2, -h / 2);
        park(g, w, h, s.T);
        speedLines(g, w, h, shock * (1 - seg(t, kids.end, kids.end + 0.4)), s.T);
        // Pochi barks and jumps on each bark that music.json plays.
        const barks = s.notes('barks').map((n) => n.start);
        let hop = 0;
        let bark = 0;
        let squash = 1;
        for (const b of barks) {
          const p = seg(t, b, b + 0.32);
          if (p > 0 && p < 1) { hop = Math.sin(p * Math.PI) * 90; bark = Math.sin(p * Math.PI); squash = 1 + 0.12 * Math.sin(p * Math.PI); }
        }
        drawPochi(g, 1090, 950, 1.5, { t, hop, bark, squash });
        barks.forEach((b, i) => burst(g, 1240 + i * 90, 520 - i * 80, b, t));
        // Grandpa walks in from the right.
        const walk = seg(t, 0.2, 1.6);
        drawGen(g, lerp(2200, 1600, inOutCubic(walk)), 970, 1.4, { t, walking: walk > 0 && walk < 1, mouth: flap(gen, t) });
        // The kids fall over ("zukko!") when they hear it.
        const fall = outCubic(seg(t, kids.start + 0.15, kids.start + 0.55));
        drawMina(g, 500, 970, 1.25, { t, mouth: Math.max(flap(kids, t), shock > 0 ? 0.9 : 0), shock: shock > 0, fall: -1.35 * fall, look: 1 });
        drawHaru(g, 790, 970, 1.25, { t, mouth: shock > 0 ? 0.9 : 0, shock: shock > 0, fall: -1.45 * outCubic(seg(t, kids.start + 0.22, kids.start + 0.62)), look: 1 });
        bubble(g, gen.text, 1560, 200, 1600, 450, lineAlpha(gen, t));
        bubble(g, kids.text, 640, 260, 620, 440, lineAlpha(kids, t));
        g.restore();
      },
    },
  },
});
