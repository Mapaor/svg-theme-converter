// Parsing de colors, conversió OKLCH i suggeriment de variants clar/fosc.
const ctx = document.createElement('canvas').getContext('2d');
const h2 = n => Math.round(n).toString(16).padStart(2, '0');
export const toHex = ({ r, g, b }) => '#' + [r, g, b].map(h2).join('');
export const alphaHex = a => (a >= 1 ? '' : h2(a * 255));

/** Retorna {r,g,b,a} o null si no és un color directe i fiable (none, url(), var(), currentColor, transparent...).
 *  La sintaxi (hex 3/4/6/8, rgb, hsl, noms) la resol el parser CSS del navegador via canvas; assignar dues
 *  sentinelles diferents detecta els valors invàlids (que deixarien l'últim valor vàlid). */
export function parseColor(str) {
  const s = str.trim().toLowerCase();
  if (!s || /^(none|inherit|initial|unset|revert|transparent|currentcolor|context-fill|context-stroke)$/.test(s) || /^(url|var)\(/.test(s)) return null;
  ctx.fillStyle = '#010203'; ctx.fillStyle = s; const a = ctx.fillStyle;
  ctx.fillStyle = '#040506'; ctx.fillStyle = s; if (a !== ctx.fillStyle) return null;
  let m = a.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
  if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: 1 };
  m = a.match(/^rgba\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\)$/);
  return m && +m[4] > 0 ? { r: +m[1], g: +m[2], b: +m[3], a: +m[4] } : null;
}

// OKLab/OKLCH (Björn Ottosson). Implementat a mà: no depèn del suport natiu d'oklch() del navegador.
const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
export function toOklch({ r, g, b }) {
  const [R, G, B] = [r, g, b].map(v => lin(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, C: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}
function fromOklch(L, C, h) {
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
/** Converteix a RGB reduint la croma fins que entri a la gamma sRGB (conserva to i lluminositat). */
function toRgb(L, C, h) {
  let v;
  for (let i = 0; i < 30; i++, C *= 0.9) { v = fromOklch(L, C, h); if (v.every(x => x >= -0.0005 && x <= 1.0005)) break; }
  const [r, g, b] = v.map(x => Math.round(gam(Math.min(1, Math.max(0, x))) * 255));
  return { r, g, b };
}

/** Determinista. El mode clar conserva l'original; el fosc se'n deriva en OKLCH:
 *  colors foscos -> més clars; colors clars -> més foscos i una mica menys saturats. Grisos/negre/blanc inclosos (C≈0). */
export function suggest(rgb) {
  const { L, C, h } = toOklch(rgb);
  const dark = L < 0.6 ? toRgb(0.95 - L * 0.45, C, h) : toRgb(0.3 + (1 - L) * 0.5, C * 0.75, h);
  return { light: toHex(rgb), dark: toHex(dark) };
}
