// @ts-check
// Text layout on a 2D canvas, for Japanese and Latin text.
// Japanese breaks between any two characters except where kinsoku rules
// forbid it; Latin text breaks at spaces.

export const FONT_FAMILY = '"VVV Sans", "Noto Sans JP", "IPAGothic", sans-serif';

// Characters that must not start a line (closing brackets, small kana, punctuation).
const NO_START = new Set([...'、。，．,.!?！？)）]］}｝」』】〕〉》〙〗’”ー…‥ゃゅょっぁぃぅぇぉゎャュョッァィゥェォヮヵヶ々ゝゞヽヾ・：；:;']);
// Characters that must not end a line (opening brackets).
const NO_END = new Set([...'(（[［{｛「『【〔〈《〘〖‘“']);

const isWide = (ch) => /[　-鿿豈-﫿＀-￯]/.test(ch);

/** Split text into units that may not be broken internally: Latin words (with their trailing space) and single wide characters. */
function tokenize(text) {
  const tokens = [];
  let buf = '';
  for (const ch of text) {
    if (isWide(ch)) {
      if (buf) { tokens.push(buf); buf = ''; }
      tokens.push(ch);
    } else if (ch === ' ') {
      buf += ch;
      tokens.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf) tokens.push(buf);
  return tokens;
}

/**
 * Break text into lines that fit width.
 * @param {CanvasRenderingContext2D} g with its font already set
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
export function wrap(g, text, width) {
  const out = [];
  for (const para of text.split('\n')) {
    const tokens = tokenize(para);
    let line = '';
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const next = line + tok;
      if (line && g.measureText(next.trimEnd()).width > width) {
        // Kinsoku: carry a line-final opening bracket down, or pull a forbidden line-starter up.
        let carry = '';
        if (NO_START.has([...tok][0])) {
          // Hanging punctuation: keep it on this line even though it overflows slightly.
          line = next;
          continue;
        }
        const chars = [...line];
        while (chars.length > 1 && NO_END.has(chars[chars.length - 1])) carry = chars.pop() + carry;
        out.push(chars.join('').trimEnd());
        line = carry + tok.trimStart();
      } else {
        line = next;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * @typedef {{ x: number, y: number, width?: number, size?: number, weight?: number, color?: string,
 *   align?: CanvasTextAlign, lineHeight?: number, maxLines?: number, family?: string,
 *   baseline?: 'top' | 'middle' | 'bottom', letterSpacing?: number, shadow?: string, measureOnly?: boolean }} TextOptions
 * @typedef {{ lines: string[], width: number, height: number, overflow: boolean }} TextResult
 */

/** @type {string[]} */
export const textWarnings = [];

/**
 * Draw wrapped text. y is the top of the block unless baseline says otherwise.
 * @param {CanvasRenderingContext2D} g
 * @param {string} str
 * @param {TextOptions} o
 * @returns {TextResult}
 */
export function text(g, str, o) {
  const size = o.size ?? 48;
  const lh = (o.lineHeight ?? 1.4) * size;
  g.save();
  g.font = `${o.weight ?? 400} ${size}px ${o.family ?? FONT_FAMILY}`;
  if (o.letterSpacing) g.letterSpacing = `${o.letterSpacing}px`;
  g.textAlign = o.align ?? 'left';
  g.textBaseline = 'middle';
  let lines = o.width ? wrap(g, str, o.width) : str.split('\n');
  let overflow = false;
  if (o.maxLines && lines.length > o.maxLines) {
    overflow = true;
    lines = lines.slice(0, o.maxLines);
  }
  const widest = Math.max(0, ...lines.map((l) => g.measureText(l).width));
  if (o.width && widest > o.width * 1.04) overflow = true;
  if (overflow) {
    const msg = `text overflows its box (${o.width}px, ${o.maxLines ?? '∞'} lines): "${str.slice(0, 40)}"`;
    if (!textWarnings.includes(msg)) textWarnings.push(msg);
  }
  const height = lines.length * lh;
  let top = o.y;
  if (o.baseline === 'middle') top -= height / 2;
  else if (o.baseline === 'bottom') top -= height;
  if (!o.measureOnly) {
    g.fillStyle = o.color ?? '#fff';
    if (o.shadow) { g.shadowColor = o.shadow; g.shadowBlur = size * 0.4; }
    lines.forEach((l, i) => g.fillText(l, o.x, top + lh * (i + 0.5)));
  }
  g.restore();
  return { lines, width: widest, height, overflow };
}

/** Load the bundled font faces so the first frame never falls back to another font. */
export async function loadFonts(url) {
  const face = new FontFace('VVV Sans', `url(${url})`, { weight: '100 900' });
  await face.load();
  document.fonts.add(face);
  await document.fonts.ready;
}
