// Anàlisi, sanejament i generació de l'SVG adaptatiu. Treballa sempre sobre el DOM XML, mai amb regex globals sobre el document.
import { parseColor, toHex, alphaHex, suggest } from './colors.js';
export const SVG_NS = 'http://www.w3.org/2000/svg';
const COLOR_ATTRS = ['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'];
const isColorProp = p => COLOR_ATTRS.includes(p) || p.startsWith('--'); // --x: també (variables CSS que defineixen colors)

export function parseSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) { const l = err.textContent.trim().split('\n'); throw new Error('El document no és un XML/SVG vàlid: ' + (l.find(x => /line \d+/i.test(x)) || l[0])); }
  const r = doc.documentElement;
  if (r.localName !== 'svg' || r.namespaceURI !== SVG_NS) throw new Error("El document no és un SVG vàlid: l'arrel ha de ser <svg> amb xmlns=\"http://www.w3.org/2000/svg\".");
  return doc;
}

/** Elimina contingut actiu o amb xarxa (en la còpia analitzada, mai a l'editor). Retorna els avisos. */
export function sanitize(doc) {
  const w = []; let n = 0, ev = 0, ext = 0;
  const cleanCss = t => t.replace(/@import[^;]*;?/gi, () => (ext++, '')).replace(/url\(\s*(['"]?)(?!#|data:)[^)]*\)/gi, () => (ext++, 'none'));
  for (const s of [...doc.querySelectorAll('script')]) { s.remove(); n++; }
  for (const el of doc.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const nm = a.name.toLowerCase(), v = a.value.trim();
      if (nm.startsWith('on')) { el.removeAttributeNode(a); ev++; }
      else if ((/(^|:)href$/.test(nm) && !v.startsWith('#') && !/^data:image\//i.test(v)) || (nm !== 'style' && /url\(\s*['"]?(?!#|data:)/i.test(v))) { el.removeAttributeNode(a); ext++; }
      else if (nm === 'style') a.value = cleanCss(a.value);
    }
    if (el.localName === 'style') el.textContent = cleanCss(el.textContent);
  }
  if (n) w.push(`S'han eliminat ${n} element(s) <script>.`);
  if (ev) w.push(`S'han eliminat ${ev} atribut(s) d'esdeveniment (onload, onclick…).`);
  if (ext) w.push(`S'han eliminat ${ext} referència(s) externes (href, url(), @import) que podrien provocar peticions de xarxa.`);
  return w;
}

/** Classifica un valor CSS/atribut. Política: només es tracten com a editables els colors directes;
 *  currentColor té fila pròpia; var(), url(), none, transparent i la resta es preserven intactes. */
function classify(raw) {
  const m = raw.trim().match(/^([\s\S]*?)(\s*!important)?$/i), v = m[1].trim(), imp = m[2] || '';
  if (/^currentcolor$/i.test(v)) return { kind: 'current' };
  if (/^var\(/i.test(v)) return { kind: 'var' };
  const c = parseColor(v);
  return c ? { kind: 'color', c, imp, key: toHex(c) + alphaHex(c.a) } : { kind: 'other' };
}

// Declaracions "prop: valor" (style inline o fulla CSS). Els comentaris CSS no es toquen.
const mapCss = (css, fn) => css.split(/(\/\*[\s\S]*?\*\/)/).map((part, i) => i % 2 ? part
  : part.replace(/([\w-]+)(\s*:\s*)([^;{}]+)/g, (m, p, sep, val) => { if (!isColorProp(p)) return m; const o = fn(val); return o == null ? m : p + sep + o; })).join('');

/** Recorre atributs de presentació, style inline i <style>; fn(valor) retorna el substitut o null. */
function transform(doc, fn) {
  for (const el of doc.querySelectorAll('*')) {
    if (el.localName === 'style') { const t = mapCss(el.textContent, fn); if (t !== el.textContent) el.textContent = t; continue; }
    for (const a of COLOR_ATTRS) if (el.hasAttribute(a)) { const o = fn(el.getAttribute(a)); if (o != null) el.setAttribute(a, o); }
    if (el.hasAttribute('style')) { const s = el.getAttribute('style'), t = mapCss(s, fn); if (t !== s) el.setAttribute('style', t); }
  }
}

export function analyze(doc) {
  const found = new Map(); let cur = 0, vars = 0;
  transform(doc, raw => {
    const k = classify(raw);
    if (k.kind === 'color') {
      if (!found.has(k.key)) found.set(k.key, { key: k.key, rgb: k.c, hex: toHex(k.c), alpha: alphaHex(k.c.a), count: 0 });
      found.get(k.key).count++;
    } else if (k.kind === 'current') cur++; else if (k.kind === 'var') vars++;
    return null;
  });
  const colors = [...found.values()].map(({ rgb, ...c }) => { const sug = suggest(rgb); return { ...c, ...sug, sug, enabled: true }; });
  if (cur) { const sug = { light: '#000000', dark: '#e6e6e6' }; colors.push({ key: '__current', isCurrent: true, hex: '#000000', alpha: '', count: cur, ...sug, sug, enabled: true }); }
  return { colors, vars, nested: doc.documentElement.querySelectorAll('svg').length };
}

/** Genera l'SVG. theme=null -> versió final amb @media (prefers-color-scheme); 'light'|'dark' -> només per a la previsualització. */
export function generate(doc, colors, theme = null) {
  const clone = doc.cloneNode(true), root = clone.documentElement; // l'original no es modifica
  const prefix = new XMLSerializer().serializeToString(doc).includes('--svg-color-') ? '--theme-color-' : '--svg-color-';
  const names = new Map(), light = [], dark = []; let n = 0, curVar = null;
  for (const c of colors) {
    if (!c.enabled) continue;
    const name = prefix + (c.isCurrent ? 'current' : ++n);
    light.push(`${name}: ${c.light}${c.alpha}`); dark.push(`${name}: ${c.dark}${c.alpha}`);
    c.isCurrent ? (curVar = name) : names.set(c.key, name);
  }
  transform(clone, raw => { const k = classify(raw), nm = k.kind === 'color' && names.get(k.key); return nm ? `var(${nm})${k.imp}` : null; });
  if (curVar) { // currentColor no se substitueix: es defineix la propietat color de l'arrel, que els SVG niats hereten
    const st = root.getAttribute('style') || '';
    if (!root.hasAttribute('color') && !/(^|;)\s*color\s*:/.test(st)) root.setAttribute('style', (st ? st.replace(/;?\s*$/, ';') : '') + `color:var(${curVar})`);
  }
  if (light.length) {
    const d = a => a.map(x => `    ${x};`).join('\n');
    const css = theme ? `\n  :root {\n${d(theme === 'dark' ? dark : light)}\n  }\n`
      : `\n  :root {\n${d(light)}\n  }\n\n  @media (prefers-color-scheme: dark) {\n    :root {\n${d(dark).replace(/^/gm, '  ')}\n    }\n  }\n`;
    const style = clone.createElementNS(SVG_NS, 'style');
    let id = 'svg-theme-vars'; while (clone.querySelector(`[id="${id}"]`)) id += '-x';
    style.setAttribute('id', id); style.textContent = css;
    root.insertBefore(style, root.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}
