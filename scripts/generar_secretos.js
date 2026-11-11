#!/usr/bin/env node
/**
 * Robot IA: crea la página de SECRETOS de una o varias storycards (ES + EN en el mismo archivo),
 * con el mismo diseño que secretos/eldestino-secretos.html.
 *
 * Para cada storycard <nombre>.html (y su pareja <nombre>-en.html si existe) lee la historia,
 * pide a Gemini 5 secretos basados en lo que ocurre en el texto (título, revelación "¿Sabías que…?",
 * sugerencia, sorpresa y crítica) en español e inglés, y escribe:
 *     secretos/<nombre>-secretos.html        (y secretos/<nombre>-en-secretos.html si hay versión -en)
 * El botón «Secretos» del reproductor enlaza a secretos/<nombre>-secretos.html.
 *
 * Uso:
 *   node scripts/generar_secretos.js "eldestino elavesinjaula.html"
 *   node scripts/generar_secretos.js todas            (todas las storycards del repo que aún no tienen secretos)
 *   Opciones: --force (regenera aunque ya exista)  --dry-run (no llama a Gemini ni escribe nada)
 * Variables: GEMINI_API_KEY (obligatoria), GEMINI_MODEL (opcional).
 */
const fs = require('fs');
const path = require('path');

const ENV = process.env;
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry-run');
const entrada = args.filter((a) => !a.startsWith('--')).join(' ').trim();
const IGNORAR_DIR = new Set(['.git', 'node_modules', '.github', 'secretos']);
const OMITIR = new Set(['reproductor.html', 'creador_cartas.html', 'index.html']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────── Colores e iconos (mismos que la página de ejemplo) ───────────── */
const COLORES = ['purple', 'pink', 'indigo', 'amber', 'emerald'];
const ICONOS = ['compass', 'city', 'wind', 'monument', 'leaf', 'key', 'eye', 'moon', 'star', 'skull', 'ghost', 'feather', 'book-open',
  'dove', 'fire', 'gem', 'mask', 'hourglass-half', 'bolt', 'music', 'anchor', 'rocket', 'dragon', 'crown', 'scroll', 'mountain',
  'water', 'sun', 'tree', 'heart', 'lightbulb', 'fingerprint', 'route'];
const ICONO_DEFECTO = ['compass', 'key', 'eye', 'star', 'leaf'];

/* ───────────── Leer la storycard ───────────── */
const MAPA_ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
function leerLiteral(s, i) {
  const q = s[i];
  let j = i + 1, out = '';
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') {
      const n = s[j + 1];
      if (n in MAPA_ESC) { out += MAPA_ESC[n]; j += 2; }
      else if (n === 'u') {
        if (s[j + 2] === '{') { const k = s.indexOf('}', j); out += String.fromCodePoint(parseInt(s.slice(j + 3, k), 16)); j = k + 1; }
        else { out += String.fromCharCode(parseInt(s.slice(j + 2, j + 6), 16)); j += 6; }
      } else if (n === 'x') { out += String.fromCharCode(parseInt(s.slice(j + 2, j + 4), 16)); j += 4; }
      else if (n === '\n') j += 2;
      else if (n === '\r') j += s[j + 2] === '\n' ? 3 : 2;
      else { out += n; j += 2; }
    } else if (c === q) return [out, j + 1];
    else { out += c; j++; }
  }
  throw new Error('literal sin cerrar');
}

function campo(bloque, clave) {
  const m = bloque.match(new RegExp('(?<![\\w.])[\'"]?' + clave + '[\'"]?\\s*:\\s*([\'"`])'));
  return m ? leerLiteral(bloque, m.index + m[0].length - 1)[0] : null;
}

function leerHistoria(ruta) {
  const h = fs.readFileSync(ruta, 'utf8');
  const lang = ((h.match(/<html[^>]*\blang\s*=\s*["']?(\w+)/i) || [])[1] || 'es').toLowerCase();
  const tipos = [...h.matchAll(/type\s*:\s*['"`](\w+)['"`]/g)];
  let titulo = '';
  const capitulos = [];
  tipos.forEach((t, k) => {
    const bloque = h.slice(t.index, k + 1 < tipos.length ? tipos[k + 1].index : h.length);
    if (t[1] === 'cover' && !titulo) titulo = (campo(bloque, 'title') || '').trim();
    if (t[1] === 'story') {
      const texto = campo(bloque, 'text');
      if (texto && texto.trim()) capitulos.push({ titulo: (campo(bloque, 'chapterTitle') || '').trim(), texto: texto.trim() });
    }
  });
  if (!titulo) titulo = ((h.match(/<title>([^<]*)<\/title>/i) || [])[1] || path.basename(ruta, '.html')).trim();
  return { lang, titulo, capitulos };
}

/* ───────────── Localizar storycards ───────────── */
function listarStorycards(dir = '.', prof = 0) {
  let r = [];
  if (prof > 3) return r;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR_DIR.has(e.name)) continue;
    const full = path.join(dir, e.name).replace(/^\.\//, '');
    if (e.isDirectory()) r = r.concat(listarStorycards(full, prof + 1));
    else if (/\.html?$/i.test(e.name) && !OMITIR.has(e.name.toLowerCase())) {
      try { if (/type\s*:\s*['"`]story['"`]/.test(fs.readFileSync(full, 'utf8'))) r.push(full); } catch (err) { /* no legible */ }
    }
  }
  return r;
}

function resolver(nombre, todas) {
  const limpio = nombre.replace(/^\.?\//, '');
  const conExt = /\.html?$/i.test(limpio) ? limpio : limpio + '.html';
  const variantes = [...new Set([conExt, conExt.replace(/\s+/g, '')])];
  for (const v of variantes) if (fs.existsSync(v) && fs.statSync(v).isFile()) return v;
  const buscados = new Set(variantes.map((v) => path.basename(v).toLowerCase()));
  const hallados = todas.filter((f) => buscados.has(path.basename(f).toLowerCase()));
  return hallados.length === 1 ? hallados[0] : null;
}

const baseDe = (ruta) => path.basename(ruta).replace(/\.html?$/i, '').replace(/-en$/i, '');

/* ───────────── Gemini ───────────── */
async function listarModelos() {
  if (ENV.GEMINI_MODEL) return [ENV.GEMINI_MODEL];
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': ENV.GEMINI_API_KEY } });
    const j = await r.json();
    const lista = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, '')).filter((n) => /^gemini-[\d.]+-(flash|pro)(-lite)?$/.test(n));
    const orden = (n) => (/flash(?!-lite)/.test(n) ? 0 : /flash-lite/.test(n) ? 1 : 2) * 1000 - parseFloat((n.match(/gemini-([\d.]+)/) || [0, 0])[1]) * 10;
    if (lista.length) return lista.sort((a, b) => orden(a) - orden(b));
  } catch (e) { /* uso la lista por defecto */ }
  return ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
}

async function pedirGemini(prompt) {
  const errores = [];
  for (const modelo of await listarModelos()) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ENV.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 16384, responseMimeType: 'application/json' } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`HTTP ${r.status} ${j.error?.message || ''}`.trim());
      const t = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (!t) throw new Error('respuesta vacía');
      return t;
    } catch (e) {
      errores.push(`${modelo}: ${e.message}`);
      if (/API_KEY_INVALID|API key not valid|API key expired/i.test(e.message)) break;
    }
  }
  throw new Error('Gemini no respondió. ' + errores.join(' || '));
}

function parseJson(t) {
  const limpio = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(limpio); } catch (e) { const a = limpio.indexOf('{'), b = limpio.lastIndexOf('}'); return JSON.parse(limpio.slice(a, b + 1)); }
}

const CAMPOS = ['title', 'text', 'sugerencia', 'sorpresa', 'critica'];
function validar(j) {
  if (!j || !Array.isArray(j.secretos) || j.secretos.length !== 5) return 'debe haber exactamente 5 secretos';
  for (const [i, s] of j.secretos.entries()) for (const l of ['es', 'en']) for (const c of CAMPOS) {
    if (!s[l] || !String(s[l][c] || '').trim()) return `falta ${l}.${c} en el secreto ${i + 1}`;
  }
  return null;
}

async function pedirSecretos(h, tituloEs, tituloEn) {
  // Hasta ~24.000 caracteres de historia (reparte el recorte entre capítulos para no perder el final)
  const total = h.capitulos.reduce((a, c) => a + c.texto.length, 0);
  const tope = Math.max(600, Math.floor(24000 / h.capitulos.length));
  const historia = h.capitulos.map((c, i) => `[${i + 1}] ${c.titulo}\n${total > 24000 ? c.texto.slice(0, tope) : c.texto}`).join('\n\n');
  const idioma = h.lang === 'en' ? 'English' : 'Spanish';
  const prompt = [
    `You are the lore editor of an interactive story library. The story below is written in ${idioma}. Story title: "${tituloEs || tituloEn}".`,
    '', 'STORY:', historia, '',
    'Write EXACTLY 5 hidden "secrets" for this story: deeper background, hidden connections or readings that reward the reader after finishing it.',
    'Rules:',
    '- Every secret must be grounded in the story: use its real characters, places, objects and events, and never contradict the text. Do not invent characters that do not appear.',
    '- Each secret must be different (a character, a place/object, a symbol, a turning point, a theme...).',
    '- "title": max 8 words. "text": a revelation that starts like "¿Sabías que…?" in Spanish / "Did you know that…" in English, 35-65 words.',
    '- "sugerencia": one sentence suggesting what to look at when re-reading. "sorpresa": one surprising detail. "critica": one honest, constructive critical remark about that narrative element.',
    `- "icono": one Font Awesome free-solid icon name chosen ONLY from: ${ICONOS.join(', ')}.`,
    '- Provide BOTH languages for every field: "es" (Spanish) and "en" (English). The English version must be a faithful translation of the Spanish one (same secret, same order).',
    tituloEs && tituloEn ? '' : `- Also return "titulo_es" and "titulo_en" (the story title in Spanish and English; keep "${tituloEs || tituloEn}" in its own language).`,
    'Respond ONLY with JSON: {"titulo_es":"","titulo_en":"","secretos":[{"icono":"","es":{"title":"","text":"","sugerencia":"","sorpresa":"","critica":""},"en":{"title":"","text":"","sugerencia":"","sorpresa":"","critica":""}}]}',
  ].filter((x) => x !== '').join('\n');
  let motivo = '';
  for (let i = 1; i <= 3; i++) {
    try { const j = parseJson(await pedirGemini(prompt)); motivo = validar(j); if (!motivo) return j; }
    catch (e) { motivo = e.message; }
    console.log(`    intento ${i}/3 sin resultado válido: ${motivo}`);
    await sleep(4000 * i);
  }
  throw new Error('Gemini no devolvió 5 secretos válidos: ' + motivo);
}

/* ───────────── HTML (mismo diseño que eldestino-secretos.html) ───────────── */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function renderHtml(tituloEs, tituloEn, secretos) {
  const col = (i) => COLORES[i % COLORES.length];
  const arma = (l) => Object.fromEntries(secretos.map((s, i) => [i + 1, {
    title: s[l].title.trim(), text: s[l].text.trim(), sugerencia: s[l].sugerencia.trim(), sorpresa: s[l].sorpresa.trim(), critica: s[l].critica.trim(),
    icon: 'fa-' + s.icono, colorClass: `bg-${col(i)}-600/30 text-${col(i)}-400`,
  }]));
  const translations = {
    es: { pageBadge: 'LaIAmusical - Secretos', pageTitle: tituloEs, pageSubtitle: 'Descubre los misterios ocultos y las revelaciones de esta historia. Haz clic en cualquier secreto para desvelar su trasfondo.', backButton: 'Volver al Reproductor', modalClose: 'Entendido', reveal: 'Revelar secreto', secrets: arma('es') },
    en: { pageBadge: 'The Musical AI - Secrets', pageTitle: tituloEn, pageSubtitle: 'Discover the hidden mysteries and revelations of this story. Click any secret to reveal its background.', backButton: 'Back to the Player', modalClose: 'Got it', reveal: 'Reveal secret', secrets: arma('en') },
  };
  const tarjetas = secretos.map((s, i) => {
    const c = col(i), n = i + 1;
    return `<div onclick="openSecretModal(${n})" class="secret-card p-5 rounded-2xl cursor-pointer flex flex-col justify-between group"><div><div class="w-10 h-10 rounded-xl bg-${c}-600/30 text-${c}-400 flex items-center justify-center mb-4 group-hover:text-white transition-colors"><i class="fas fa-${esc(s.icono)} text-lg"></i></div><h3 id="secretTitle${n}" class="font-bold text-lg text-${c}-200 mb-2 group-hover:text-white transition-colors">${esc(s.es.title.trim())}</h3><p id="secretDesc${n}" class="text-sm text-gray-300/80 line-clamp-3">${esc(s.es.text.trim())}</p></div><div class="mt-4 text-xs font-semibold text-${c}-400 flex items-center gap-1 group-hover:translate-x-1 transition-transform"><span id="secretReveal${n}">Revelar secreto</span> <i class="fas fa-arrow-right text-[10px]"></i></div></div>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Secretos: ${esc(tituloEs)}</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
<style>
body { background-image: url('../images/fondostorycards.png'); background-size: cover; background-position: center; background-repeat: no-repeat; background-attachment: fixed; color: white; min-height: 100vh; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
.glass-panel { background: rgba(15, 12, 30, 0.75); backdrop-filter: blur(12px); border: 1px solid rgba(139, 92, 246, 0.3); }
.secret-card { background: rgba(30, 27, 75, 0.5); border: 1px solid rgba(139, 92, 246, 0.2); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
.secret-card:hover { transform: translateY(-4px); border-color: rgba(167, 139, 250, 0.6); box-shadow: 0 10px 25px -5px rgba(139, 92, 246, 0.3); }
.modal-section { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 0.75rem; padding: 1rem; margin-top: 0.75rem; }
</style>
</head>
<body class="p-4 md:p-8 flex flex-col items-center justify-center">
<div class="w-full max-w-4xl mx-auto flex flex-col min-h-[85vh] justify-between">
<header class="text-center my-6">
<div class="inline-flex items-center gap-3 bg-purple-900/40 px-4 py-2 rounded-full border border-purple-500/30 mb-4">
<i class="fas fa-user-astronaut text-purple-400 animate-pulse"></i>
<span id="pageBadge" class="text-xs uppercase tracking-widest font-semibold text-purple-200">LaIAmusical - Secretos</span>
</div>
<h1 id="pageTitle" class="text-3xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-purple-300 via-pink-200 to-indigo-200 drop-shadow-sm">${esc(tituloEs)}</h1>
<p id="pageSubtitle" class="text-purple-200/70 mt-2 text-sm md:text-base max-w-xl mx-auto">${esc(translations.es.pageSubtitle)}</p>
</header>
<main class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 my-6">
${tarjetas}
</main>
<footer class="text-center mt-auto py-6">
<a id="backButton" href="../reproductor.html" class="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all border border-white/10"><i class="fas fa-arrow-left"></i> Volver al Reproductor</a>
</footer>
</div>
<div id="secretModal" class="fixed inset-0 bg-black/80 backdrop-blur-md hidden items-center justify-center z-50 p-4 transition-all duration-300 opacity-0 overflow-y-auto">
<div class="glass-panel w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl transform scale-95 transition-all duration-300 p-6 md:p-8 relative my-8">
<button onclick="closeSecretModal()" class="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-gray-300 hover:text-white transition-colors"><i class="fas fa-times"></i></button>
<div id="modalIconContainer" class="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 text-2xl"><i id="modalIcon" class="fas fa-star"></i></div>
<h2 id="modalTitle" class="text-2xl md:text-3xl font-extrabold mb-3 text-white tracking-tight">Título del Secreto</h2>
<div class="h-[1px] w-full bg-gradient-to-r from-purple-500/50 to-transparent mb-6"></div>
<div class="text-gray-200 text-sm md:text-base leading-relaxed" id="modalBody"></div>
<div class="mt-8 pt-4 border-t border-white/5 flex justify-end">
<button id="modalCloseBtn" onclick="closeSecretModal()" class="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-purple-900/40">Entendido</button>
</div></div></div>

<script>
const translations = ${safeJson(translations)};
function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function getCurrentLanguage(){ return localStorage.getItem('selectedLanguage') || 'es'; }
function applyTranslations(){
  const lang = getCurrentLanguage();
  const content = translations[lang] || translations.es;
  document.documentElement.lang = translations[lang] ? lang : 'es';
  document.title = (lang === 'en' ? 'Secrets: ' : 'Secretos: ') + content.pageTitle;
  document.getElementById('pageBadge').textContent = content.pageBadge;
  document.getElementById('pageTitle').textContent = content.pageTitle;
  document.getElementById('pageSubtitle').textContent = content.pageSubtitle;
  document.getElementById('backButton').innerHTML = '<i class="fas fa-arrow-left"></i> ' + esc(content.backButton);
  document.getElementById('modalCloseBtn').textContent = content.modalClose;
  for (let i = 1; i <= 5; i++) {
    const secret = content.secrets[i];
    if (!secret) continue;
    document.getElementById('secretTitle' + i).textContent = secret.title;
    document.getElementById('secretDesc' + i).textContent = secret.text;
    document.getElementById('secretReveal' + i).textContent = content.reveal;
  }
}
function openSecretModal(id){
  const lang = getCurrentLanguage();
  const data = (translations[lang] || translations.es).secrets[id] || translations.es.secrets[id];
  if (!data) return;
  const modal = document.getElementById('secretModal');
  const modalContent = modal.querySelector('.glass-panel');
  document.getElementById('modalTitle').textContent = data.title;
  let bodyHtml = '<p class="mb-4">' + esc(data.text) + '</p>';
  bodyHtml += '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">';
  if (data.sugerencia) bodyHtml += '<div class="modal-section md:col-span-2"><h4 class="font-bold text-purple-300 mb-1 flex items-center gap-2"><i class="fas fa-lightbulb"></i> ' + (lang === 'en' ? 'Suggestion' : 'Sugerencia') + '</h4><p class="text-sm text-gray-300">' + esc(data.sugerencia) + '</p></div>';
  if (data.sorpresa) bodyHtml += '<div class="modal-section"><h4 class="font-bold text-pink-300 mb-1 flex items-center gap-2"><i class="fas fa-gift"></i> ' + (lang === 'en' ? 'Surprise' : 'Sorpresa') + '</h4><p class="text-sm text-gray-300">' + esc(data.sorpresa) + '</p></div>';
  if (data.critica) bodyHtml += '<div class="modal-section"><h4 class="font-bold text-red-300 mb-1 flex items-center gap-2"><i class="fas fa-comment-dots"></i> ' + (lang === 'en' ? 'Critique' : 'Crítica') + '</h4><p class="text-sm text-gray-300">' + esc(data.critica) + '</p></div>';
  bodyHtml += '</div>';
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalIconContainer').className = 'w-14 h-14 rounded-2xl flex items-center justify-center mb-5 text-2xl ' + data.colorClass;
  document.getElementById('modalIcon').className = 'fas ' + data.icon;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(function(){ modal.classList.remove('opacity-0'); modalContent.classList.remove('scale-95'); modalContent.classList.add('scale-100'); }, 10);
}
function closeSecretModal(){
  const modal = document.getElementById('secretModal');
  const modalContent = modal.querySelector('.glass-panel');
  modal.classList.add('opacity-0');
  modalContent.classList.remove('scale-100');
  modalContent.classList.add('scale-95');
  setTimeout(function(){ modal.classList.add('hidden'); modal.classList.remove('flex'); }, 300);
}
document.addEventListener('DOMContentLoaded', applyTranslations);
window.addEventListener('storage', function(e){ if (e.key === 'selectedLanguage') applyTranslations(); });
document.getElementById('secretModal').addEventListener('click', function(e){ if (e.target === this) closeSecretModal(); });
</script>
</body></html>
`;
}

/* ───────────── main ───────────── */
async function main() {
  const todas = listarStorycards();
  const grupos = new Map();                         // base -> { es, en }
  const agrupar = (ruta) => {
    const b = baseDe(ruta);
    const g = grupos.get(b) || {};
    if (/-en\.html?$/i.test(ruta)) g.en = ruta; else g.es = ruta;
    grupos.set(b, g);
  };
  const problemas = [];

  if (!entrada || /^(todas|todos|all|\*)$/i.test(entrada)) {
    todas.forEach(agrupar);
    console.log(`Modo «todas»: ${todas.length} páginas de storycard (${grupos.size} historias).`);
  } else {
    const palabras = entrada.split(/[\s,;]+/).filter(Boolean);
    const nombres = [];
    for (let i = 0; i < palabras.length; i++) {          // une "el avesinjaula" -> elavesinjaula si hace falta
      if (resolver(palabras[i], todas)) { nombres.push(palabras[i]); continue; }
      if (i + 1 < palabras.length && resolver(palabras[i] + palabras[i + 1], todas)) { nombres.push(palabras[i] + palabras[i + 1]); i++; continue; }
      nombres.push(palabras[i]);
    }
    console.log(`Storycards pedidas (${nombres.length}): ${nombres.join(' | ')}`);
    for (const n of nombres) {
      const ruta = resolver(n, todas);
      if (!ruta) { problemas.push(`«${n}»: no existe como storycard en el repositorio`); console.log(`  ❌ ${problemas[problemas.length - 1]}`); continue; }
      agrupar(ruta);
      const base = baseDe(ruta);
      const dir = path.dirname(ruta);                  // incluye la pareja es/en si existe
      for (const p of [path.join(dir, base + '.html'), path.join(dir, base + '-en.html')]) {
        const q = p.replace(/^\.\//, '');
        if (fs.existsSync(q) && todas.includes(q)) agrupar(q);
      }
    }
  }

  if (!ENV.GEMINI_API_KEY && !DRY) { console.error('❌ Falta el secreto GEMINI_API_KEY.'); process.exit(1); }
  fs.mkdirSync('secretos', { recursive: true });
  let creados = 0, saltados = 0;

  for (const [base, g] of grupos) {
    const destino = path.join('secretos', `${base}-secretos.html`);
    console.log(`\n== ${base}`);
    if (fs.existsSync(destino) && !FORCE) { console.log(`  ⏭️  ${destino} ya existe (usa «Regenerar» para sobrescribirlo)`); saltados++; continue; }
    const fuente = g.es || g.en;
    const hist = leerHistoria(fuente);
    if (!hist.capitulos.length) { problemas.push(`${base}: no encontré capítulos en ${fuente}`); console.log(`  ❌ ${problemas[problemas.length - 1]}`); continue; }
    const hEs = g.es ? hist : null, hEn = g.en ? (g.es ? leerHistoria(g.en) : hist) : null;
    const tituloEs = hEs ? hEs.titulo : '', tituloEn = hEn ? hEn.titulo : '';
    console.log(`  📖 ${fuente} · ${hist.capitulos.length} capítulos · idioma ${hist.lang}`);
    if (DRY) { console.log(`  (dry-run) crearía ${destino}`); continue; }
    try {
      const j = await pedirSecretos(hist, tituloEs, tituloEn);
      const secretos = j.secretos.map((s, i) => ({ ...s, icono: ICONOS.includes(String(s.icono || '').replace(/^fa-/, '')) ? String(s.icono).replace(/^fa-/, '') : ICONO_DEFECTO[i] }));
      const html = renderHtml(tituloEs || String(j.titulo_es || tituloEn).trim(), tituloEn || String(j.titulo_en || tituloEs).trim(), secretos);
      fs.writeFileSync(destino, html);
      console.log(`  ✅ ${destino}`);
      if (g.en) { const d2 = path.join('secretos', `${base}-en-secretos.html`); fs.writeFileSync(d2, html); console.log(`  ✅ ${d2}`); }
      creados++;
    } catch (e) { problemas.push(`${base}: ${e.message}`); console.log(`  ❌ ${e.message}`); }
    await sleep(+ENV.PAUSA_MS || 2000);
  }

  console.log(`\nResumen: ${creados} creadas · ${saltados} ya existían` + (problemas.length ? ` · ${problemas.length} con problemas` : ''));
  if (problemas.length) { console.error('\nProblemas:\n  - ' + problemas.join('\n  - ')); process.exitCode = 1; }
}

module.exports = { leerHistoria, renderHtml, resolver, baseDe, main };
if (require.main === module) main().catch((e) => { console.error('❌ Error inesperado:', e); process.exit(1); });
