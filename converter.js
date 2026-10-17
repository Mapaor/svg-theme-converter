// Anàlisi, sanejament i generació de l'SVG adaptatiu. Treballa sempre sobre el DOM XML, mai amb regex globals sobre el document.
import { parseColor, toHex, alphaHex, suggest } from './colors.js';
export const SVG_NS = 'http://www.w3.org/2000/svg';
const COLOR_ATTRS = ['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'];
const isColorProp = p => COLOR_ATTRS.includes(p) || p.startsWith('--'); // --x: també (variables CSS que defineixen colors)
const PREFIX = '--svg-color-';

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
  if (/^var\(/i.test(v)) { const n = /^var\(\s*(--[\w-]+)/.exec(v); return { kind: 'var', name: n ? n[1] : null, imp }; }
  const c = parseColor(v);
  return c ? { kind: 'color', c, imp, key: toHex(c) + alphaHex(c.a) } : { kind: 'other' };
}

// Declaracions "prop: valor" (style inline o fulla CSS). Els comentaris CSS no es toquen.
const mapCss = (css, fn) => css.split(/(\/\*[\s\S]*?\*\/)/).map((part, i) => i % 2 ? part
  : part.replace(/([\w-]+)(\s*:\s*)([^;{}]+)/g, (m, p, sep, val) => { if (!isColorProp(p)) return m; const o = fn(val, p); return o == null ? m : p + sep + o; })).join('');

/** Recorre atributs de presentació, style inline i <style>; fn(valor, prop) retorna el substitut o null.
 *  skip(el) exclou elements que es reescriuen a part (el bloc de tema). */
function transform(doc, fn, skip) {
  for (const el of doc.querySelectorAll('*')) {
    if (skip && skip(el)) continue;
    if (el.localName === 'style') { const t = mapCss(el.textContent, fn); if (t !== el.textContent) el.textContent = t; continue; }
    for (const a of COLOR_ATTRS) if (el.hasAttribute(a)) { const o = fn(el.getAttribute(a), a); if (o != null) el.setAttribute(a, o); }
    if (el.hasAttribute('style')) { const s = el.getAttribute('style'), t = mapCss(s, fn); if (t !== s) el.setAttribute('style', t); }
  }
}

/* --- Detecció de SVGs que ja tenen tema clar/fosc ----------------------------------------- */

const noComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '');

/** Escàner de blocs CSS (gestiona {} anidats i comentaris).
 *  Retorna [{ prelude, chain, start, end, content }] amb offsets absoluts respecte a `text`. */
function walkCss(text, chain = [], base = 0, out = []) {
  let seg = 0, i = 0;
  while (i < text.length) {
    if (text.startsWith('/*', i)) { const f = text.indexOf('*/', i + 2); if (f < 0) break; i = f + 2; continue; }
    if (text[i] !== '{') { i++; continue; }
    const prelude = text.slice(seg, i).trim();
    let d = 1, j = i + 1;
    while (j < text.length && d > 0) {
      if (text.startsWith('/*', j)) { const f = text.indexOf('*/', j + 2); if (f < 0) break; j = f + 2; continue; }
      if (text[j] === '{') d++; else if (text[j] === '}') d--;
      j++;
    }
    const s = i + 1, e = Math.max(s, j - 1);
    out.push({ prelude, chain, start: base + s, end: base + e, content: text.slice(s, e) });
    walkCss(text.slice(s, e), [...chain, prelude], base + s, out);
    seg = j; i = j;
  }
  return out;
}

const declsOf = content => [...noComments(content).matchAll(/([-\w]+)\s*:\s*([^;{}]+)/g)].map(m => [m[1], m[2].trim()]);
const isRootPrelude = p => /(^|[,\s])\s*(:root|svg|html)(?=[,\s]|$)/i.test(noComments(p));
const varNameOf = v => { const m = /^\s*var\(\s*(--[\w-]+)/.exec(v || ''); return m ? m[1] : null; };

/** Detecta un SVG ja tematitzat: variables CSS declarades TANT a :root (clar) COM dins
 *  @media (prefers-color-scheme: dark) :root (fosc), ambdos valors sent colors. Té en compte qualsevol
 *  nom (--bg o --svg-color-1, sigui del format que sigui), no només el prefix que genera aquesta eina.
 *  Retorna { el, light, dark, lightBlocks, darkBlocks, declNames, vars } o null si no n'hi ha. */
export function detectTheme(doc) {
  for (const el of doc.querySelectorAll('style')) {
    const text = el.textContent || '';
    const light = new Map(), dark = new Map(), declNames = new Set();
    const lightBlocks = [], darkBlocks = [];
    for (const b of walkCss(text)) {
      for (const [k] of declsOf(b.content)) declNames.add(k);
      if (!isRootPrelude(b.prelude)) continue;
      const chain = b.chain.map(noComments);
      const inDark = chain.some(c => /@media[^{]*prefers-color-scheme\s*:\s*dark/i.test(c));
      if (chain.some(c => /^@media/i.test(c)) && !inDark) continue; // @media de pantalla concreta, print…: no és tema
      (inDark ? darkBlocks : lightBlocks).push(b);
      const target = inDark ? dark : light;
      for (const [k, v] of declsOf(b.content)) target.set(k, v); // l'última declaració guanya
    }
    const vars = new Map();
    for (const [name, lv] of light) {
      const dv = dark.get(name);
      if (dv != null && parseColor(lv) && parseColor(dv)) vars.set(name, { light: lv, dark: dv });
    }
    if (vars.size) return { el, light, dark, lightBlocks, darkBlocks, declNames, vars };
  }
  return null;
}

/** Si l'arrel defineix `color: var(--x)` amb --x sent variable de tema, aquesta és la variable que reben els currentColor. */
function rootColorVar(root, det) {
  const st = root.getAttribute('style') || '';
  const m = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(st);
  for (const v of [root.getAttribute('color'), m && m[1], det.light.get('color')]) {
    const n = varNameOf(v);
    if (n && det.vars.has(n)) return n;
  }
  return null;
}

export function analyze(doc) {
  const found = new Map(); let cur = 0, vars = 0, orphan = 0;
  const det = detectTheme(doc);
  const refs = new Map(); // variable de tema -> referències var(--x)
  transform(doc, (raw, prop) => {
    if (det && det.vars.has(prop)) return null; // la parella clar/fosc la gestiona detectTheme: no és un color solt
    const k = classify(raw);
    if (k.kind === 'color') {
      if (!found.has(k.key)) found.set(k.key, { key: k.key, rgb: k.c, hex: toHex(k.c), alpha: alphaHex(k.c.a), count: 0 });
      found.get(k.key).count++;
    } else if (k.kind === 'current') cur++;
    else if (k.kind === 'var') {
      if (k.name && det && det.vars.has(k.name)) refs.set(k.name, (refs.get(k.name) || 0) + 1);
      else if (k.name && /^--(?:svg|theme)-color-/.test(k.name)) orphan++; // referència a un tema que ja no existeix
      else vars++;
    }
    return null;
  });

  const curVar = det ? rootColorVar(doc.documentElement, det) : null;
  const colors = [];
  // 1) Variables de tema: una fila per variable amb els dos valors que ja té el fitxer (l'ordre és el del bloc clar).
  if (det) for (const [name, v] of det.vars) {
    const L = parseColor(v.light), D = parseColor(v.dark);
    if (!L || !D) continue;
    const light = toHex(L), dark = toHex(D), isCurrent = name === curVar;
    colors.push({
      key: 'v:' + name, varName: name, hex: light, alpha: alphaHex(L.a), alphaD: alphaHex(D.a), light, dark,
      count: Math.max(1, (refs.get(name) || 0) + (isCurrent ? cur : 0)), sug: { light, dark }, enabled: true, isCurrent,
    });
  }
  // 2) Colors directes (literal a atribut, style o declaració de fulla CSS).
  for (const { rgb, ...c } of found.values()) { const sug = suggest(rgb); colors.push({ ...c, ...sug, sug, enabled: true }); }
  // 3) currentColor, només si l'arrel no ve lligada a cap variable de tema.
  if (cur && !curVar) { const sug = { light: '#000000', dark: '#e6e6e6' }; colors.push({ key: '__current', isCurrent: true, hex: '#000000', alpha: '', count: cur, ...sug, sug, enabled: true }); }
  return {
    colors, vars, nested: doc.documentElement.querySelectorAll('svg').length,
    orphan, theme: det ? { count: det.vars.size, names: [...det.vars.keys()] } : null,
  };
}

/** Reescriu el bloc de tema existent al lloc: actualitza les variables gestionades i afegeix les noves,
 *  sense tocar la resta del text (comentaris, altres declaracions) perquè el resultat sigui estable. */
function rewriteThemeStyle(det, { managed, light, dark, val, subst }) {
  const el = det.el, text = el.textContent, edits = [];
  for (const [blocks, side] of [[det.lightBlocks, 'light'], [det.darkBlocks, 'dark']]) {
    blocks.forEach((b, bi) => {
      const content = text.slice(b.start, b.end), comments = [];
      for (let i = content.indexOf('/*'); i >= 0; i = content.indexOf('/*', i + 2)) {
        const f = content.indexOf('*/', i + 2); comments.push([i, f < 0 ? content.length : f + 2]); if (f < 0) break;
      }
      for (const m of content.matchAll(/([-\w]+)(\s*:\s*)([^;{}]+)/g)) {
        if (comments.some(([s, e]) => m.index >= s && m.index < e)) continue;
        const prop = m[1], raw = m[3], trail = /\s*$/.exec(raw)[0], core = raw.slice(0, raw.length - trail.length);
        const vStart = b.start + m.index + m[0].length - raw.length;
        const c = managed.get(prop);
        const rep = c ? val(c, side) + classify(core).imp : subst(core); // variable de tema vs. color directe/variable desactivada
        if (rep != null && rep !== core) edits.push({ s: vStart, e: vStart + core.length, t: rep + trail });
      }
      if (bi === 0) { // les declaracions noves només s'afegeixen al primer bloc de cada costat
        const add = (side === 'light' ? light : dark).filter(d => !det.declNames.has(d.slice(0, d.indexOf(':'))));
        if (add.length) edits.push({ s: b.end, e: b.end, t: add.map(d => `\n    ${d};`).join('') });
      }
    });
  }
  if (!edits.length) return;
  edits.sort((a, b) => b.s - a.s); // de dreta a esquerra perquè els offsets es mantinguin
  let out = text;
  for (const e of edits) out = out.slice(0, e.s) + e.t + out.slice(e.e);
  el.textContent = out;
}

/** Genera l'SVG. theme=null -> versió final amb @media (prefers-color-scheme); 'light'|'dark' -> només per a la previsualització. */
export function generate(doc, colors, theme = null) {
  const clone = doc.cloneNode(true), root = clone.documentElement; // l'original no es modifica
  const det = detectTheme(clone); // si el document ja és tematitzat, s'actualitza el seu bloc; sinó, se'n crea un de nou
  const enabled = colors.filter(c => c.enabled);
  const managed = new Map(); // nom de variable -> fila de tema activa
  for (const c of enabled) if (c.varName && det && det.vars.has(c.varName)) managed.set(c.varName, c);
  const direct = enabled.filter(c => !c.varName); // colors solts (inclou la fila currentColor sense tema)
  // val(c, costat): en previsualització (theme) es força el tema triat als dos costats, perquè el @media no s'imbromilli.
  const val = (c, side) => { const s = theme || side; return c[s] + (s === 'dark' ? (c.alphaD ?? c.alpha) : c.alpha); };

  const used = new Set(new XMLSerializer().serializeToString(clone).match(/--[A-Za-z0-9_-]+/g) || []);
  let n = 0;
  const nextVar = () => { let x; do { x = PREFIX + (++n); } while (used.has(x)); used.add(x); return x; };
  const currentVar = () => { let x = PREFIX + 'current', i = 1; while (used.has(x)) x = PREFIX + 'current' + (++i); used.add(x); return x; };
  const names = new Map(), light = [], dark = [];
  let curVar = null;
  for (const c of direct) {
    const name = c.isCurrent ? currentVar() : nextVar();
    light.push(`${name}: ${val(c, 'light')}`);
    dark.push(`${name}: ${val(c, 'dark')}`);
    c.isCurrent ? (curVar = name) : names.set(c.key, name);
  }
  for (const c of managed.values()) if (c.isCurrent) curVar = c.varName;

  // Un color desactivat no s'aplica: les referències var(--x) es resolen al literal original del fitxer.
  const subst = raw => {
    const k = classify(raw);
    if (k.kind === 'color') { const nm = names.get(k.key); return nm ? `var(${nm})${k.imp}` : null; }
    if (k.kind === 'var' && k.name && det && det.vars.has(k.name) && !managed.has(k.name)) return det.vars.get(k.name).light + k.imp;
    return null;
  };
  const disabledTheme = colors.some(c => c.varName && !managed.has(c.varName));
  if (det && (managed.size || light.length || disabledTheme)) rewriteThemeStyle(det, { managed, light, dark, val, subst });
  transform(clone, subst, el => !!det && el === det.el);

  if (curVar) { // currentColor no se substitueix: es defineix la propietat color de l'arrel, que els SVG niats hereten
    const st = root.getAttribute('style') || '';
    if (!root.hasAttribute('color') && !/(^|;)\s*color\s*:/.test(st)) root.setAttribute('style', (st ? st.replace(/;?\s*$/, ';') : '') + `color:var(${curVar})`);
  }
  if (!det && light.length) { // document sense tema: bloc nou (és el format que genera aquesta eina)
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

/** Previsualització de l'original: un <img> avalua el prefers-color-scheme del navegador, no el de la
 *  pàgina, així que per poder comparar clar/fosc es fixa el tema triat als dos blocs del document.
 *  Només canvia la previsualització: no afegeix variables ni toca res més (el costat guanyador es
 *  repeteix als dos blocs). Retorna el text, o null si el document no té tema (es veu igual en els dos modes). */
export function pinTheme(doc, theme) {
  const clone = doc.cloneNode(true);
  const det = detectTheme(clone);
  if (!det || !theme) return null;
  const managed = new Map([...det.vars].map(([name, v]) => [name, { light: v.light, dark: v.dark }]));
  rewriteThemeStyle(det, { managed, light: [], dark: [], val: c => c[theme], subst: () => null });
  return new XMLSerializer().serializeToString(clone);
}
