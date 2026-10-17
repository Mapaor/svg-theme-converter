// Interfície i estat. La lògica SVG és a converter.js i colors.js.
import { parseSvg, sanitize, analyze, generate } from './converter.js';
const $ = s => document.querySelector(s), src = $('#src');
const st = { name: 'image.svg', doc: null, colors: [], notes: [], san: [], out: '', url: null, view: 'img', srcView: 'img', theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' };

const fill = (el, items) => { el.replaceChildren(...items.map(t => Object.assign(document.createElement('li'), { textContent: t }))); el.hidden = !items.length; };
const showErr = m => { $('#err').textContent = m || ''; $('#err').hidden = !m; };
const msg = t => { $('#msg').textContent = t; setTimeout(() => ($('#msg').textContent = ''), 2500); };
const gutter = () => { $('#gutter').textContent = Array.from({ length: src.value.split('\n').length }, (_, i) => i + 1).join('\n'); };

/** Càrrega d'un SVG nou: reinicia TOT l'estat dependent del document anterior. */
function load(text, name) {
  Object.assign(st, { name, doc: null, colors: [], notes: [], san: [], out: '' });
  src.value = text; gutter(); $('#fileName').textContent = name + ' — clic o arrossega per substituir';
  $('#out').value = ''; setImg(null); previewSrc(null); renderColors(); renderWarns(); sync(); showErr(null);
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
  st.doc = doc; st.san = sanitize(doc);
  st.doc = doc; st.san = sanitize(doc); previewSrc(src.value);
  st.colors = a.colors.map(c => { const p = prev.get(c.key); return p ? { ...c, light: p.light, dark: p.dark, enabled: p.enabled } : c; });
  st.notes = [];
  if (!a.colors.length) st.notes.push("No s'han detectat colors editables.");
  if (st.colors.some(c => c.isCurrent)) st.notes.push("currentColor es preserva (hereta la propietat color). La fila «currentColor» defineix el color base de l'SVG arrel" + (a.nested ? ", que hereten els SVG niats." : '.'));
  if (a.vars) st.notes.push(`${a.vars} referència(s) var() es preserven; només s'editen els colors definits directament (p. ex. --x: #fff).`);
  showErr(null); $('#dirty').hidden = true; renderColors(); update();
}

function renderColors() {
  $('#list').replaceChildren(...st.colors.map((c, i) => {
    const li = document.createElement('li'); li.dataset.i = i;
    const nm = c.isCurrent ? 'currentColor' : c.hex + (c.alpha ? ` (${Math.round(parseInt(c.alpha, 16) / 2.55)}%)` : '');
    const pk = t => { const cl = t === 'light' ? 'clar' : 'fosc'; return `<span class="pk"><span aria-hidden="true" title="Mode ${cl}">${t === 'light' ? '☀' : '☾'}</span><input type="color" data-f="${t}" value="${c[t]}" aria-label="Color mode ${cl} per a ${nm}"><input type="text" data-f="${t}" value="${c[t]}" maxlength="7" spellcheck="false" aria-label="Hex mode ${cl} per a ${nm}"></span>`; };
    li.innerHTML = `<input type="checkbox" data-f="enabled" ${c.enabled ? 'checked' : ''} aria-label="Aplica el tema a ${nm}"><span class="sw ${c.isCurrent ? 'cur' : ''}" style="background:${c.hex}${c.alpha}" title="${nm}: ${c.count} ús"></span><span class="hx">${nm}</span><span aria-hidden="true">→</span>${pk('light')}${pk('dark')}`;
    return li;
  }));
}
$('#list').addEventListener('input', e => {
  const t = e.target, f = t.dataset.f; if (!f) return;
  const li = t.closest('li'), c = st.colors[li.dataset.i];
  if (f === 'enabled') c.enabled = t.checked;
  else {
    let v = t.value.trim().toLowerCase();
    if (t.type === 'text') {
      if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + [...v.slice(1)].map(x => x + x).join('');
      const ok = /^#[0-9a-f]{6}$/.test(v); t.classList.toggle('bad', !ok); t.setAttribute('aria-invalid', String(!ok)); if (!ok) return;
    }
    c[f] = v; li.querySelectorAll(`[data-f="${f}"]`).forEach(x => { if (x !== t) x.value = v; });
  }
  update();
});
$('#reset').onclick = () => { st.colors.forEach(c => Object.assign(c, c.sug, { enabled: true })); renderColors(); update(); };

const renderWarns = () => fill($('#warns'), [...st.san, ...st.notes]);
const sync = () => { $('#copy').disabled = $('#dl').disabled = !st.out; };
function update() {
  if (!st.doc) return;
  try { st.out = generate(st.doc, st.colors); } catch (e) { showErr('Error en generar el SVG: ' + e.message); return; }
  $('#out').value = st.out; renderWarns(); sync(); if (st.view === 'img') preview();
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
  $('#out').hidden = v !== 'code'; $('#prev').hidden = v !== 'img'; showThemeSegs(); if (v === 'img') preview();
}
// Vista de l'original (columna esquerra)
let srcUrl = null;
function previewSrc(text) {
  const old = srcUrl;
  srcUrl = text == null ? null : URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  srcUrl ? ($('#imgSrc').src = srcUrl) : $('#imgSrc').removeAttribute('src');
  if (old) URL.revokeObjectURL(old);
}
function setSrcView(v) {
  st.srcView = v; $('#sCode').setAttribute('aria-pressed', v === 'code'); $('#sImg').setAttribute('aria-pressed', v === 'img');
  $('.ed').hidden = v !== 'code'; $('#prevSrc').hidden = v !== 'img'; showThemeSegs();
}
$('#sCode').onclick = () => setSrcView('code'); $('#sImg').onclick = () => setSrcView('img');
$('#imgSrc').onerror = () => showErr("El navegador no ha pogut renderitzar l'SVG original.");
const themeSegs = () => document.querySelectorAll('.themeSeg');
const showThemeSegs = () => themeSegs().forEach(el => { el.hidden = el.closest('#p-out') ? st.view !== 'img' : st.srcView !== 'img'; });
const applyTheme = () => { $('#prev').dataset.theme = $('#prevSrc').dataset.theme = st.theme; };
const syncTheme = () => themeSegs().forEach(el => el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === st.theme)));
const setTheme = t => { st.theme = t; syncTheme(); applyTheme(); if (st.view === 'img') preview(); };
themeSegs().forEach(el => { el.onclick = e => { if (e.target.dataset.t) setTheme(e.target.dataset.t); }; });
$('#vCode').onclick = () => setView('code'); $('#vImg').onclick = () => setView('img');

$('#copy').onclick = async () => { try { await navigator.clipboard.writeText(st.out); msg('Copiat'); } catch { showErr("No s'ha pogut accedir al porta-retalls. Selecciona el codi i copia'l manualment."); $('#out').select(); } };
$('#dl').onclick = () => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([st.out], { type: 'image/svg+xml;charset=utf-8' })), download: st.name.replace(/\.svg$/i, '') + '-themed.svg' });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// Editor
src.addEventListener('input', () => { gutter(); $('#dirty').hidden = false; });
src.addEventListener('scroll', () => { $('#gutter').scrollTop = src.scrollTop; });
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
gutter(); syncTheme(); applyTheme(); setView('img'); setSrcView('img');
