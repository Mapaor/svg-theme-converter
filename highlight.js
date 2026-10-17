// Acoloreix XML/SVG per a la capa que es veu darrere el textarea del codi (el text del textarea
// és transparent i només se'n veu el cursor). Escàner d'una sola passada amb una propietat
// important: MAI no perd ni un caràcter, perquè el text pintat ha de coincidir exactament amb el
// textarea (si no, es desalineen línies i cursor). Els SVG no vàlids també s'han de poder mostrar
// (l'editor els deixa escriure), així que qualsevol cosa estranya es pinta com a text pla.

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls, s) => `<span class="${cls}">${esc(s)}</span>`;

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

/** Retorna el codi com a HTML amb <span class="pn|tn|an|av|cm|cd">. */
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
    out += span('pn', m[0].slice(0, m[0].length - m[1].length)); // '<' o '</'
    out += span('tn', m[1]);
    i += m[0].length;
    for (let closed = false; i < text.length && !closed;) {
      const rest = text.slice(i), ws = WS.exec(rest), end = END.exec(rest), a = ATTR.exec(rest);
      if (ws) { out += esc(ws[0]); i += ws[0].length; }
      else if (end) { out += span('pn', end[0]); i += end[0].length; closed = true; }
      else if (a) {
        out += span('an', a[1]);
        if (a[2]) { out += esc(a[2]); if (a[3] != null) out += span('av', a[3]); } // '=' + valor
        i += a[0].length;
      } else { out += esc(text[i]); i++; } // dins d'una etiqueta trencada: text pla
    }
  }
  return out;
}
