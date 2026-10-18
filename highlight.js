// Acoloreix XML/SVG (i el CSS de dins dels <style>) per a la capa que es veu darrere el textarea del
// codi (el text del textarea és transparent i només se'n veu el cursor). Escàner d'una sola passada
// amb una propietat important: MAI no perd ni un caràcter, perquè el text pintat ha de coincidir
// exactament amb el textarea (si no, es desalineen les línies i el cursor). Els SVG no vàlids també
// s'han de poder mostrar (l'editor els deixa escriure), així que qualsevol cosa estranya es pinta com
// a text pla, però sencera. El CSS segueix la mateixa idea: si no s'entén, es pinta pla.
//
// Classes: pn puntuació, tn nom d'etiqueta, an nom d'atribut, av valor d'atribut, cm comentari,
// cd CDATA/DOCTYPE/PI; i per al CSS: ct selector, cp propietat, cv valor, ck @regla, cst cadena.

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls, s) => `<span class="${cls}">${esc(s)}</span>`;

/* ------------------------------------------------------------------------ CSS */

/** Pinta `s` amb la classe `base`, separant-ne els comentaris i les cadenes. */
const mixed = (base, s) => {
  let out = '', i = 0, plain = '';
  const flush = () => { if (plain) { out += base ? span(base, plain) : esc(plain); plain = ''; } };
  while (i < s.length) {
    if (s.startsWith('/*', i)) {
      const j = s.indexOf('*/', i + 2), stop = j < 0 ? s.length : j + 2;
      flush(); out += span('cm', s.slice(i, stop)); i = stop;
    } else if (s[i] === '"' || s[i] === "'") {
      const q = s[i], j = s.indexOf(q, i + 1), stop = j < 0 ? s.length : j + 1;
      flush(); out += span('cst', s.slice(i, stop)); i = stop;
    } else { plain += s[i]; i++; }
  }
  flush();
  return out;
};

/** Selector (`:root`, `svg[fill]`) o preludi d'una @regla (`@media (prefers-color-scheme: dark)`). */
const selector = s => {
  const m = /^(\s*)(@[-\w]+)/.exec(s);
  if (!m) return mixed('ct', s);
  let out = esc(m[1]) + span('ck', m[2]), rest = s.slice(m[0].length);
  while (rest) {
    const open = rest.indexOf('(');
    if (open < 0) { out += mixed('ct', rest); break; }
    out += mixed('ct', rest.slice(0, open));
    let d = 0, k = open;
    for (; k < rest.length; k++) { if (rest[k] === '(') d++; else if (rest[k] === ')' && --d === 0) { k++; break; } }
    out += span('cv', rest.slice(open, k)); // dins dels parèntesis hi ha "valors" (mitjans, suports…)
    rest = rest.slice(k);
  }
  return out;
};

/** Declaració: `--svg-color-1: #1e1e1e` → propietat, ':' i valor. */
const declaration = s => {
  let k = 0, d = 0;
  for (; k < s.length; k++) { // primer ':' que no sigui dins de parèntesis, cadenes ni comentaris
    const c = s[k];
    if (c === '(') d++;
    else if (c === ')') d = Math.max(0, d - 1);
    else if (c === '/' && s[k + 1] === '*') { const j = s.indexOf('*/', k + 2); k = j < 0 ? s.length : j + 1; }
    else if ((c === '"' || c === "'") && (k = s.indexOf(c, k + 1)) < 0) k = s.length;
    else if (c === ':' && !d) break;
  }
  if (k >= s.length) return mixed(null, s); // sense ':' no és cap declaració: es pinta pla
  return mixed('cp', s.slice(0, k)) + span('pn', ':') + mixed('cv', s.slice(k + 1));
};

/** Contingut d'un <style>. Dins d'un bloc, el que hi ha abans de '{' és un selector i la resta
 *  declaracions; el que acaba en ';' o '}' és sempre una declaració. */
function cssHighlight(css) {
  // Un <style> pot portar el CSS embolcallat en CDATA.
  const cd = /^(\s*)(<!\[CDATA\[)([\s\S]*?)(\]\]>)(\s*)$/.exec(css);
  if (cd) return esc(cd[1]) + span('cd', cd[2]) + cssHighlight(cd[3]) + span('cd', cd[4]) + esc(cd[5]);
  let i = 0, out = '', depth = 0;
  while (i < css.length) {
    const start = i;
    while (i < css.length) { // fins al proper delimitador estructural (a fora de cadenes i comentaris)
      const c = css[i];
      if (c === '{' || c === '}' || c === ';') break;
      if (c === '/' && css[i + 1] === '*') { const j = css.indexOf('*/', i + 2); i = j < 0 ? css.length : j + 2; }
      else if (c === '"' || c === "'") { const j = css.indexOf(c, i + 1); i = j < 0 ? css.length : j + 1; }
      else i++;
    }
    const head = css.slice(start, i), c = css[i];
    if (!head.trim()) out += esc(head); // només espais
    else if (c === '{' || depth === 0) out += selector(head); // selector o @regla de dalt de tot
    else out += declaration(head); // declaració
    if (c == null) break;
    out += span('pn', c);
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    i++;
  }
  return out;
}

/* -------------------------------------------------------------------- XML/SVG */

// Blocs que s'empassen tot el contingut fins al tancament (o fins al final si no es tanca).
const BLOCKS = [
  ['<!--', '-->', 'cm'], // comentari
  ['<![CDATA[', ']]>', 'cd'], // secció CDATA
  ['<!', '>', 'cd'], // DOCTYPE i similars
  ['<?', '?>', 'cd'], // instrucció de processament (<?xml …?>)
];
const OPEN = /^<\/?([A-Za-z_:][\w.:-]*)/; // '<' o '</' + nom
const ATTR = /^([^\s=/>]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]*)?/; // nom [= valor]
const WS = /^\s+/;
const END = /^\/?>/;

/** Retorna el codi com a HTML amb els <span> de color. */
export function highlight(text) {
  let out = '', i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { out += esc(text.slice(i)); break; } // text final sense cap etiqueta
    if (lt > i) out += esc(text.slice(i, lt)); // text entre etiquetes
    i = lt;
    const block = BLOCKS.find(b => text.startsWith(b[0], i));
    if (block) {
      const [open, close, cls] = block, j = text.indexOf(close, i + open.length);
      const stop = j < 0 ? text.length : j + close.length;
      out += span(cls, text.slice(i, stop));
      i = stop;
      continue;
    }
    const m = OPEN.exec(text.slice(i));
    if (!m) { out += esc('<'); i++; continue; } // un '<' solt (XML trencat) és text
    const closing = m[0][1] === '/';
    out += span('pn', m[0].slice(0, m[0].length - m[1].length)); // '<' o '</'
    out += span('tn', m[1]);
    i += m[0].length;
    let selfClose = false;
    for (let closed = false; i < text.length && !closed;) {
      const rest = text.slice(i), ws = WS.exec(rest), end = END.exec(rest), a = ATTR.exec(rest);
      if (ws) { out += esc(ws[0]); i += ws[0].length; }
      else if (end) { out += span('pn', end[0]); selfClose = end[0] === '/>'; i += end[0].length; closed = true; }
      else if (a) {
        out += span('an', a[1]);
        if (a[2]) { out += esc(a[2]); if (a[3] != null) out += span('av', a[3]); } // '=' + valor
        i += a[0].length;
      } else { out += esc(text[i]); i++; } // dins d'una etiqueta trencada: text pla
    }
    // El contingut d'un <style> és CSS, no text pla.
    if (!closing && !selfClose && m[1].toLowerCase() === 'style') {
      const re = /<\/style[\s>]/gi, from = i;
      re.lastIndex = from;
      const mm = re.exec(text), stop = mm ? mm.index : text.length;
      out += cssHighlight(text.slice(from, stop));
      i = stop;
    }
  }
  return out;
}
