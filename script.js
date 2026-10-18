// Interfície i estat. La lògica SVG és a converter.js i colors.js.
import { parseSvg, sanitize, analyze, generate, pinTheme } from './converter.js';
import { highlight } from './highlight.js';
const $ = s => document.querySelector(s), src = $('#src');
const st = { name: 'image.svg', doc: null, colors: [], notes: [], san: [], out: '', url: null, view: 'img', srcView: 'img', warnOpen: false, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' };

const ico = (d) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="i" aria-hidden="true">${d}</svg>`;
const I = {
  sun: ico('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
  moon: ico('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  moveR: ico('<path d="M18 8L22 12L18 16"/><path d="M2 12H22"/>'), // lucide move-right (entrada → sortida)
  chevR: ico('<path d="m9 18 6-6-6-6"/>'), // lucide chevron-right (plegat)
  chevD: ico('<path d="m6 9 6 6 6-6"/>'), // lucide chevron-down (desplegat)
};
const fill = (el, items) => { el.replaceChildren(...items.map(t => Object.assign(document.createElement('li'), { textContent: t }))); el.hidden = !items.length; };
const showErr = m => { $('#err').textContent = m || ''; $('#err').hidden = !m; };
const msg = t => { $('#msg').textContent = t; setTimeout(() => ($('#msg').textContent = ''), 2500); };
const gutter = () => { $('#gutter').textContent = Array.from({ length: src.value.split('\n').length }, (_, i) => i + 1).join('\n'); };

/* Codi acolorit: el textarea va a sobre amb el text transparent i la capa .hl del darrere pinta
   el codi. El desplaçament es fa amb un transform, així no depèn de l'alçada de scroll del textarea. */
const hlSrc = $('#hlSrc'), hlOut = $('#hlOut');
const syncScroll = (layer, ta) => { layer.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`; };
const paint = (layer, ta) => {
  try {
    const html = highlight(ta.value);
    if (layer.innerHTML !== html) layer.innerHTML = html;
  } catch { layer.textContent = ta.value; } // si el tokenitzador fallés, el codi es veu igualment (pla)
  syncScroll(layer, ta);
};

/** Càrrega d'un SVG nou: reinicia TOT l'estat dependent del document anterior. */
function load(text, name) {
  Object.assign(st, { name, doc: null, colors: [], notes: [], san: [], out: '' });
  src.value = text; gutter(); paint(hlSrc, src); $('#fileName').textContent = name + ' — clic o arrossega per substituir';
  $('#out').value = ''; paint(hlOut, $('#out')); setImg(null); previewSrc(null); renderColors(); renderWarns(); sync(); showErr(null);
  const samples = $('#samples');
  samples.value = [...samples.options].some(o => o.value === name) ? name : '';
  reparse(false);
}
/** Reanalitza el text de l'editor. Si és invàlid, es manté l'últim resultat vàlid. keep: conserva les eleccions de l'usuari per clau de color. */
function reparse(keep) {
  const prev = new Map(keep ? st.colors.map(c => [c.key, c]) : []);
  let doc;
  try { doc = parseSvg(src.value); } catch (e) { showErr(e.message + (st.doc ? " Es mostra l'últim resultat vàlid." : '')); return; }
  const a = analyze(doc);
  st.doc = doc; st.san = sanitize(doc); previewSrc(src.value); // un sol sanejament: una segona passada sobreescriuria st.san amb els avisos buits
  st.colors = a.colors.map(c => { const p = prev.get(c.key); return p ? { ...c, light: p.light, dark: p.dark, enabled: p.enabled } : c; });
  st.notes = [];
  if (a.theme) st.notes.push(`Aquest SVG ja té tema clar/fosc (${a.theme.count} variable(s): ${a.theme.names.slice(0, 3).join(', ')}${a.theme.count > 3 ? '…' : ''}). Cada fila mostra els dos valors del fitxer i es conserven en exportar.`);
  if (a.orphan) st.notes.push(`Hi ha ${a.orphan} referència(s) a variables de tema (--svg-color-…) sense bloc <style> que les declari; aquests colors no es podran aplicar.`);
  if (!a.colors.length) st.notes.push("No s'han detectat colors editables.");
  if (st.colors.some(c => c.isCurrent)) st.notes.push("currentColor es preserva (hereta la propietat color). La fila «currentColor» defineix el color base de l'SVG arrel" + (a.nested ? ", que hereten els SVG niats." : '.'));
  if (a.vars) st.notes.push(`${a.vars} referència(s) var() es preserven; només s'editen els colors definits directament (p. ex. --x: #fff).`);
  showErr(null); $('#dirty').hidden = true; renderColors(); update();
}

function renderColors() {
  $('#list').replaceChildren(...st.colors.map((c, i) => {
    const li = document.createElement('li'); li.dataset.i = i;
    const nm = c.isCurrent ? 'currentColor' : c.hex + (c.alpha ? ` (${Math.round(parseInt(c.alpha, 16) / 2.55)}%)` : '');
    const pk = t => { const cl = t === 'light' ? 'clar' : 'fosc'; return `<span class="pk" title="Mode ${cl}">${t === 'light' ? I.sun : I.moon}<input type="color" data-f="${t}" value="${c[t]}" aria-label="Color mode ${cl} per a ${nm}"></span>`; };
    // Fila de tema: ja ve amb els dos valors del fitxer, així que la mostra es divideix en dues meitats (clar/fosc).
    const aD = c.alphaD ?? c.alpha;
    const sw = c.varName
      ? { style: `background:linear-gradient(135deg,${c.light}${c.alpha} 50%,${c.dark}${aD} 50%)`, title: `${c.varName} · clar ${c.light}${c.alpha} · fosc ${c.dark}${aD} · ${c.count} ús` }
      : { style: `background:${c.hex}${c.alpha}`, title: `${nm}: ${c.count} ús` };
    li.innerHTML = `<input type="checkbox" data-f="enabled" ${c.enabled ? 'checked' : ''} aria-label="Aplica el tema a ${nm}"><span class="sw ${c.isCurrent ? 'cur' : ''}" style="${sw.style}" title="${sw.title}"></span><span class="to" aria-hidden="true">${I.moveR}</span>${pk('light')}${pk('dark')}`;
    return li;
  }));
}
$('#list').addEventListener('input', e => {
  const t = e.target, f = t.dataset.f; if (!f) return;
  const li = t.closest('li'), c = st.colors[li.dataset.i];
  if (f === 'enabled') c.enabled = t.checked;
  else c[f] = t.value;
  update();
});
$('#invert').onclick = () => {
  st.colors.forEach(c => {
    const t = c.light; c.light = c.dark; c.dark = t;
    if ('alphaD' in c) { const a = c.alpha; c.alpha = c.alphaD; c.alphaD = a; } // l'alfa va amb el seu costat
  });
  renderColors(); update();
};
$('#reset').onclick = () => { st.colors.forEach(c => Object.assign(c, c.sug, { enabled: true })); renderColors(); update(); };

const warnItems = () => [...st.san, ...st.notes];
/** L'avisos són un desplegable plegat per defecte; l'estat es conserva entre fitxers i edicions. */
const syncWarnTgl = () => {
  $('#warnTgl').setAttribute('aria-expanded', String(st.warnOpen));
  $('#warnIco').innerHTML = st.warnOpen ? I.chevD : I.chevR;
};
const renderWarns = () => {
  const items = warnItems();
  fill($('#warns'), items);
  $('#warnWrap').hidden = !items.length; // sense avisos, tot el bloc desapareix
  $('#warns').hidden = !items.length || !st.warnOpen;
  syncWarnTgl();
};
$('#warnTgl').onclick = () => { st.warnOpen = !st.warnOpen; renderWarns(); };
const sync = () => { $('#copy').disabled = $('#dl').disabled = !st.out; };
function update() {
  if (!st.doc) return;
  try { st.out = generate(st.doc, st.colors); } catch (e) { showErr('Error en generar el SVG: ' + e.message); return; }
  $('#out').value = st.out; paint(hlOut, $('#out')); renderWarns(); sync(); if (st.view === 'img') preview();
}
function setImg(url) { const old = st.url; st.url = url; url ? ($('#img').src = url) : $('#img').removeAttribute('src'); if (old) URL.revokeObjectURL(old); }
function preview() {
  if (!st.doc) return setImg(null);
  $('#prev').dataset.theme = st.theme; // simula el tema només dins de la previsualització: l'<img> no veu prefers-color-scheme de la pàgina
  setImg(URL.createObjectURL(new Blob([generate(st.doc, st.colors, st.theme)], { type: 'image/svg+xml' })));
}
$('#img').onerror = () => showErr("El navegador no ha pogut renderitzar l'SVG generat.");
function setView(v) {
  st.view = v; $('#vCode').setAttribute('aria-pressed', v === 'code'); $('#vImg').setAttribute('aria-pressed', v === 'img');
  $('#outCode').hidden = v !== 'code'; $('#prev').hidden = v !== 'img'; if (v === 'img') preview();
}
// Vista de l'original (columna esquerra)
let srcUrl = null, srcText = null;
/** Un <img> no veu el prefers-color-scheme de la pàgina: per poder comparar clar/fosc es fixa el tema
 *  triat als dos blocs del document original (només a la previsualització; l'editor no es toca). */
const themedSrc = () => {
  if (srcText == null) return null;
  try { return pinTheme(parseSvg(srcText), st.theme) ?? srcText; } catch { return srcText; } // text invàlid: es mostra tal qual
};
function previewSrc(text) {
  srcText = text;
  const old = srcUrl, body = themedSrc();
  srcUrl = body == null ? null : URL.createObjectURL(new Blob([body], { type: 'image/svg+xml' }));
  srcUrl ? ($('#imgSrc').src = srcUrl) : $('#imgSrc').removeAttribute('src');
  if (old) URL.revokeObjectURL(old);
}
function setSrcView(v) {
  st.srcView = v; $('#sCode').setAttribute('aria-pressed', v === 'code'); $('#sImg').setAttribute('aria-pressed', v === 'img');
  $('.ed').hidden = v !== 'code'; $('#prevSrc').hidden = v !== 'img';
  if (v === 'img') previewSrc(srcText); // el tema pot haver canviat mentre es veia el codi
}
$('#sCode').onclick = () => setSrcView('code'); $('#sImg').onclick = () => setSrcView('img');
$('#imgSrc').onerror = () => showErr("El navegador no ha pogut renderitzar l'SVG original.");
const themeSegs = () => document.querySelectorAll('.themeSeg'); // sempre visibles (també en mode codi)
const applyTheme = () => { $('#prev').dataset.theme = $('#prevSrc').dataset.theme = st.theme; };
const syncTheme = () => themeSegs().forEach(el => el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === st.theme)));
const setTheme = t => { st.theme = t; syncTheme(); applyTheme(); if (st.view === 'img') preview(); if (st.srcView === 'img') previewSrc(srcText); };
themeSegs().forEach(el => { el.onclick = e => { if (e.target.dataset.t) setTheme(e.target.dataset.t); }; });
$('#vCode').onclick = () => setView('code'); $('#vImg').onclick = () => setView('img');

$('#copy').onclick = async () => { try { await navigator.clipboard.writeText(st.out); msg('Copiat'); } catch { showErr("No s'ha pogut accedir al porta-retalls. Selecciona el codi i copia'l manualment."); $('#out').select(); } };
$('#dl').onclick = () => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([st.out], { type: 'image/svg+xml;charset=utf-8' })), download: st.name.replace(/\.svg$/i, '') + '-themed.svg' });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// Editor
src.addEventListener('input', () => { gutter(); paint(hlSrc, src); $('#dirty').hidden = false; });
src.addEventListener('scroll', () => { $('#gutter').scrollTop = src.scrollTop; syncScroll(hlSrc, src); });
$('#out').addEventListener('scroll', () => syncScroll(hlOut, $('#out')));
src.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') reparse(true); });
$('#reparse').onclick = () => reparse(true);

// Importació: fitxer, drag & drop, porta-retalls i exemples
const readFile = async f => { try { load(await f.text(), f.name); } catch { showErr("No s'ha pogut llegir el fitxer."); } };
const drop = $('#drop'), picker = $('#file');
drop.onclick = () => picker.click();
drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } };
picker.onchange = () => { if (picker.files[0]) readFile(picker.files[0]); picker.value = ''; };
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => {
  e.preventDefault(); drop.classList.remove('over');
  const f = e.dataTransfer.files[0], t = e.dataTransfer.getData('text/plain');
  if (f) readFile(f); else if (t.trim()) load(t, 'enganxat.svg');
});
['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => e.preventDefault())); // el navegador no obre el fitxer
document.addEventListener('paste', e => {
  if (/^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return; // dins l'editor, el paste és edició normal
  const f = e.clipboardData.files[0], t = e.clipboardData.getData('text/plain');
  if (f) readFile(f); else if (t.trim()) load(t, 'enganxat.svg'); else return;
  e.preventDefault();
});
$('#samples').onchange = async e => {
  const n = e.target.value; if (!n) return;
  try { const r = await fetch('samples/' + n); if (!r.ok) throw 0; load(await r.text(), n); } catch { e.target.value = ''; showErr("No s'ha pogut carregar l'exemple (cal servir els fitxers amb un servidor HTTP)."); }
};

// Pestanyes (pantalles estretes)
$('#tabs').onclick = e => { const t = e.target.dataset.tab; if (!t) return; $('main').dataset.tab = t; $('#tabs').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === t)); };
gutter(); syncTheme(); applyTheme(); setView('img'); setSrcView('img'); syncWarnTgl();
