#!/usr/bin/env node
/**
 * Robot IA: crea (o corrige) la ENCUESTA/QUIZ de las storycards con 5 preguntas SOLO sobre su historia
 * (sin preguntas sobre la sala, la sinopsis, la frase de inspiración, etc.), en español e inglés.
 *
 * Qué toca:
 *  - Storycards del robot (data/storycards.json): si no tienen quiz, o lo tienen con las preguntas genéricas
 *    antiguas, reescribe `quiz` y `quizEn` de la pareja ES/EN.
 *  - Storycards manuales (páginas .html sin quiz propio en reproductor.html): crea quiz/<nombre>-quiz.json
 *    (mismo nombre que la storycard). El reproductor lo carga cuando la carta no tiene quiz.
 *
 * Uso:
 *   node scripts/generar_quiz.js "eldestino elavesinjaula.html"
 *   node scripts/generar_quiz.js todas          (todas las que no tienen quiz o lo tienen genérico)
 *   Opciones: --force (regenera aunque ya tenga un quiz válido)  --dry-run (solo muestra qué haría)
 * Variables: GEMINI_API_KEY (obligatoria), GEMINI_MODEL (opcional), PAUSA_MS.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Q = require('./quiz_historia.js');

const ENV = process.env;
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry-run');
const entrada = args.filter((a) => !a.startsWith('--')).join(' ').trim();
const IGNORAR_DIR = new Set(['.git', 'node_modules', '.github', 'secretos', 'quiz']);
const OMITIR = new Set(['reproductor.html', 'creador_cartas.html', 'index.html']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUTA_JSON = 'data/storycards.json';

/* ───────────── Leer storycards (.html) ───────────── */
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
const baseDe = (x) => path.basename(String(x)).replace(/\.html?$/i, '').replace(/-en$/i, '');

/* ───────────── Quizzes propios de reproductor.html (storycards manuales) ───────────── */
function literalJs(src, nombre) {
  const m = src.match(new RegExp('\\n\\s*(?:const|let|var)\\s+' + nombre + '\\s*=\\s*([\\[{])'));
  if (!m) return null;
  const i = m.index + m[0].length - 1, ab = src[i], ce = ab === '[' ? ']' : '}';
  let d = 0, instr = null, esc = false;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (instr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === instr) instr = null; continue; }
    if ('"\'`'.includes(c)) instr = c;
    else if (c === '/' && src[k + 1] === '/') k = src.indexOf('\n', k);
    else if (c === '/' && src[k + 1] === '*') k = src.indexOf('*/', k) + 1;
    else if (c === ab) d++;
    else if (c === ce && --d === 0) return src.slice(i, k + 1);
  }
  return null;
}
function quizzesManuales() {
  try {
    const src = fs.readFileSync('reproductor.html', 'utf8').replace(/\r\n/g, '\n');
    const songs = vm.runInNewContext('(' + literalJs(src, 'songs') + ')', {}, { timeout: 5000 });
    const mapa = new Map();
    const info = (s) => ({ valido: Q.quizValido(s.quiz), generico: Q.esQuizGenerico(s.quiz) });
    const slugTitulo = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    for (const s of songs) if (s && s.storyPage) mapa.set(baseDe(s.storyPage), info(s));
    // Cartas que aún no tienen storyPage: el reproductor usa el título sin acentos ni espacios como nombre de la storycard
    for (const s of songs) if (s && !s.storyPage && s.title && !mapa.has(slugTitulo(s.title))) mapa.set(slugTitulo(s.title), info(s));
    return mapa;                       // base -> { valido, generico } del quiz propio de reproductor.html
  } catch (e) { console.log(`  (no pude leer los quizzes de reproductor.html: ${e.message})`); return null; }
}

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
  } catch (e) { /* lista por defecto */ }
  return ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
}
async function pedirGemini(prompt) {
  const errores = [];
  for (const modelo of await listarModelos()) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ENV.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 16384, responseMimeType: 'application/json' } }),
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

/* ───────────── main ───────────── */
async function main() {
  const paginas = listarStorycards();
  const cartas = fs.existsSync(RUTA_JSON) ? JSON.parse(fs.readFileSync(RUTA_JSON, 'utf8')) : [];
  const manuales = quizzesManuales();
  const objetivos = new Map();       // base -> { tipo, es, en, cartas:[...] }
  const problemas = [];

  // Storycards del robot (pareja ES + EN por id±10000). El EN puede tener otro slug (título en inglés).
  const paginasRobot = new Set();
  const alias = new Map();            // base alternativa (la del slug EN) -> clave del objetivo
  for (const c of cartas) {
    if (!c || !c.slug || /-en$/i.test(c.slug)) continue;
    const base = baseDe(c.slug);
    const en = cartas.find((x) => x && x.id === c.id + 10000) || cartas.find((x) => x && x.slug === c.slug + '-en');
    objetivos.set(base, { tipo: 'robot', pagina: c.storyPage, paginaEn: en && en.storyPage, cartas: [c, en].filter(Boolean) });
    [c, en].forEach((x) => { if (x && x.storyPage) paginasRobot.add(x.storyPage.replace(/^\.\//, '')); });
    if (en && en.slug) alias.set(baseDe(en.slug), base);
  }
  // Storycards manuales: páginas que no son del robot
  for (const p of paginas) {
    if (paginasRobot.has(p)) continue;
    const base = baseDe(p);
    if (objetivos.has(base)) continue;
    const o = objetivos.get('m:' + base) || { tipo: 'manual', base, pagina: null, paginaEn: null };
    if (/-en\.html?$/i.test(p)) o.paginaEn = p; else o.pagina = p;
    objetivos.set('m:' + base, o);
  }

  // ¿Qué storycards hay que procesar?
  const necesita = (o, base, explicito = false) => {
    if (o.tipo === 'robot') {
      const c = o.cartas[0];
      if (!Q.quizValido(c.quiz) || !Q.quizValido(c.quizEn)) return 'sin quiz completo';
      if (Q.esQuizGenerico(c.quiz) || Q.esQuizGenerico(c.quizEn)) return 'con preguntas genéricas';
      return FORCE ? 'regenerar' : null;
    }
    const propio = manuales && manuales.get(base);                                 // quiz propio en reproductor.html
    if (propio && propio.valido) {
      if (propio.generico) return 'quiz de reproductor.html con preguntas genéricas';
      // Se respeta, salvo que lo pidas por su nombre con «Regenerar»: el quiz nuevo (creado desde el texto de la storycard) tendrá prioridad en el reproductor
      return explicito && FORCE ? 'regenerar desde el texto (sustituirá al quiz de reproductor.html)' : null;
    }
    const f = path.join('quiz', `${base}-quiz.json`);
    if (fs.existsSync(f)) {
      try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (Q.quizValido(j.es) && Q.quizValido(j.en) && !Q.esQuizGenerico(j.es) && !Q.esQuizGenerico(j.en)) return FORCE ? 'regenerar' : null; }
      catch (e) { /* archivo dañado: se rehace */ }
      return 'archivo de quiz inválido';
    }
    return 'sin quiz';
  };

  const lista = [];
  if (!entrada || /^(todas|todos|all|\*)$/i.test(entrada)) {
    console.log('Modo «todas»: se revisan todas las storycards.');
    for (const [k, o] of objetivos) {
      const base = o.tipo === 'robot' ? k : o.base;
      if (o.tipo === 'manual' && manuales === null) continue;           // sin poder leer reproductor.html no se tocan las manuales
      const motivo = necesita(o, base);
      if (motivo) lista.push({ base, o, motivo });
    }
  } else {
    const palabras = entrada.split(/[\s,;]+/).filter(Boolean);
    const nombres = [];
    const existe = (n) => { const b = baseDe(n); return objetivos.has(b) || objetivos.has('m:' + b) || alias.has(b); };
    for (let i = 0; i < palabras.length; i++) {
      if (existe(palabras[i])) { nombres.push(palabras[i]); continue; }
      if (i + 1 < palabras.length && existe(palabras[i] + palabras[i + 1])) { nombres.push(palabras[i] + palabras[i + 1]); i++; continue; }
      nombres.push(palabras[i]);
    }
    console.log(`Storycards pedidas (${nombres.length}): ${nombres.join(' | ')}`);
    for (const n of nombres) {
      const base = baseDe(n);
      const clave = alias.has(base) ? alias.get(base) : base;
      const o = objetivos.get(clave) || objetivos.get('m:' + base);
      if (!o) { problemas.push(`«${n}»: no existe como storycard en el repositorio`); console.log(`  ❌ ${problemas[problemas.length - 1]}`); continue; }
      if (lista.some((x) => x.o === o)) continue;
      const motivo = necesita(o, o.tipo === 'robot' ? clave : base, true);
      if (!motivo) {
        console.log(o.tipo === 'manual' && manuales && manuales.get(base) && manuales.get(base).valido ? `  ⏭️  ${base}: ya tiene su quiz propio en reproductor.html (se respeta). Marca «Regenerar» para crear uno nuevo desde el texto de la storycard; tendrá prioridad sobre el de reproductor.html.` : `  ⏭️  ${base}: ya tiene un quiz válido solo de la historia (marca «Regenerar» para rehacerlo)`);
        continue;
      }
      lista.push({ base: o.tipo === 'robot' ? clave : base, o, motivo });
    }
  }

  console.log(`\nStorycards a procesar: ${lista.length}`);
  lista.forEach((x) => console.log(`  - ${x.base} (${x.o.tipo}): ${x.motivo}`));
  if (DRY || !lista.length) { if (problemas.length) process.exitCode = 1; return; }
  if (!ENV.GEMINI_API_KEY) { console.error('❌ Falta el secreto GEMINI_API_KEY.'); process.exit(1); }

  let hechas = 0;
  for (const { base, o } of lista) {
    console.log(`\n== ${base}`);
    try {
      const fuente = o.pagina && fs.existsSync(o.pagina) ? o.pagina : (o.paginaEn && fs.existsSync(o.paginaEn) ? o.paginaEn : null);
      if (!fuente) throw new Error(`no encuentro la página de la storycard (${o.pagina || base + '.html'})`);
      const hist = leerHistoria(fuente);
      if (!hist.capitulos.length) throw new Error(`no encontré capítulos en ${fuente}`);
      console.log(`  📖 ${fuente} · ${hist.capitulos.length} capítulos`);
      const { quizEs, quizEn } = await Q.generarQuizDeHistoria({ titulo: hist.titulo, capitulos: hist.capitulos, idioma: hist.lang, llamarGemini: pedirGemini, semilla: base });
      if (o.tipo === 'robot') {
        for (const c of o.cartas) { c.quiz = quizEs; c.quizEn = quizEn; }
        fs.writeFileSync(RUTA_JSON, JSON.stringify(cartas, null, 2));
        console.log(`  ✅ quiz actualizado en ${RUTA_JSON} (ES y EN)`);
      } else {
        fs.mkdirSync('quiz', { recursive: true });
        const f = path.join('quiz', `${base}-quiz.json`);
        fs.writeFileSync(f, JSON.stringify({ titulo: hist.titulo, generado: new Date().toISOString(), es: quizEs, en: quizEn }, null, 2));
        console.log(`  ✅ ${f}`);
      }
      hechas++;
    } catch (e) { problemas.push(`${base}: ${e.message}`); console.log(`  ❌ ${e.message}`); }
    await sleep(+ENV.PAUSA_MS || 2000);
  }
  console.log(`\nResumen: ${hechas} creadas/corregidas` + (problemas.length ? ` · ${problemas.length} con problemas` : ''));
  if (problemas.length) { console.error('\nProblemas:\n  - ' + problemas.join('\n  - ')); process.exitCode = 1; }
}

module.exports = { main, leerHistoria };
if (require.main === module) main().catch((e) => { console.error('❌ Error inesperado:', e); process.exit(1); });
