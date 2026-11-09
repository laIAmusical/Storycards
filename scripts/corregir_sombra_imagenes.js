#!/usr/bin/env node
/**
 * Robot: quita la sombra/marco que tapa los bordes de las imágenes de los capítulos
 * en storycards ya subidas al repositorio (<nombre>.html y <nombre>-en.html).
 * Elimina las reglas  .page-illustration::before  (marco con box-shadow)  y
 * .page-illustration::after (degradado inferior). Es idempotente: se puede repetir.
 *
 * Uso:
 *   node scripts/corregir_sombra_imagenes.js "elavesinjaula elbrillodelpecado.html"
 *   node scripts/corregir_sombra_imagenes.js todas          (todas las storycards del repo)
 *   Opciones: --dry-run (solo muestra qué cambiaría)   --sin-en (no incluir la versión -en)
 * Los nombres pueden ir con o sin .html, separados por espacios, comas o saltos de línea.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const incluirEn = !args.includes('--sin-en');
const entrada = args.filter((a) => !a.startsWith('--')).join(' ').trim();
const OMITIR = new Set(['reproductor.html', 'creador_cartas.html', 'index.html']);
const IGNORAR_DIR = new Set(['.git', 'node_modules', '.github']);

/* ---------- localizar archivos ---------- */
function listarHtml(dir = '.', prof = 0) {
  let r = [];
  if (prof > 4) return r;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR_DIR.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) r = r.concat(listarHtml(full, prof + 1));
    else if (/\.html?$/i.test(e.name) && !OMITIR.has(e.name.toLowerCase())) r.push(full.replace(/^\.\//, ''));
  }
  return r;
}

// Divide el texto en palabras (espacios, comas, saltos de línea). Tolera nombres con o sin .html mezclados.
function separarNombres(texto) {
  return String(texto || '').trim().split(/[\s,;]+/).filter(Boolean);
}

// Busca "nombre" tal cual, con .html, sin espacios ("el avesinjaula" -> elavesinjaula.html) o en subcarpetas.
function resolver(nombre, todos) {
  const limpio = nombre.replace(/^\.?\//, '');
  const conExt = /\.html?$/i.test(limpio) ? limpio : limpio + '.html';
  const variantes = [...new Set([conExt, conExt.replace(/\s+/g, '')])];
  for (const v of variantes) if (fs.existsSync(v) && fs.statSync(v).isFile()) return { ruta: v, aviso: v !== conExt ? `nombre corregido «${nombre}» → ${v}` : '' };
  const buscados = new Set(variantes.map((v) => path.basename(v).toLowerCase()));
  const hallados = todos.filter((f) => buscados.has(path.basename(f).toLowerCase()));
  if (hallados.length === 1) return { ruta: hallados[0], aviso: `encontrada en ${hallados[0]}` };
  return { ruta: null, aviso: hallados.length > 1 ? `está en varias carpetas: ${hallados.join(', ')}` : '' };
}

/* ---------- corrección ---------- */
const RE_MARCO = /\/\*\s*Marco perimetral\s*\*\/\s*\.page-illustration::before\s*\{[^}]*\}\s*\.page-illustration::after\s*\{[^}]*\}[ \t]*\r?\n?/g;
const RE_BEFORE = /[ \t]*\.page-illustration::before\s*\{[^}]*\}[ \t]*\r?\n?/g;
const RE_AFTER = /[ \t]*\.page-illustration::after\s*\{[^}]*\}[ \t]*\r?\n?/g;
const corregir = (t) => t.replace(RE_MARCO, '').replace(RE_BEFORE, '').replace(RE_AFTER, '');

function procesar(ruta, r) {
  const original = fs.readFileSync(ruta, 'utf8');
  if (!original.includes('page-illustration')) { console.log(`  ⚪ ${ruta}: no es una página de storycard (no se toca)`); r.noStory++; return; }
  const nuevo = corregir(original);
  if (nuevo === original) { console.log(`  ✅ ${ruta}: ya estaba sin sombra`); r.yaOk++; return; }
  if (!dry) fs.writeFileSync(ruta, nuevo);
  console.log(`  🛠️  ${ruta}: ${dry ? 'se corregiría' : 'corregida'} (sombra de los bordes eliminada)`);
  r.corregidas++;
}

/* ---------- main ---------- */
const todos = listarHtml();
const quieroTodas = !entrada || /^(todas|todos|all|\*)$/i.test(entrada);
let objetivos = [];
const problemas = [];

if (quieroTodas) {
  objetivos = todos;
  console.log(`Modo «todas»: ${objetivos.length} páginas HTML en el repositorio.`);
} else {
  const palabras = separarNombres(entrada);
  // Une palabras sueltas cuando el nombre se escribió con un espacio de más ("el avesinjaula.html" -> elavesinjaula.html)
  const nombres = [];
  for (let i = 0; i < palabras.length; i++) {
    const w = palabras[i];
    if (resolver(w, todos).ruta) { nombres.push(w); continue; }
    if (i + 1 < palabras.length && resolver(w + palabras[i + 1], todos).ruta) { nombres.push(w + palabras[i + 1]); i++; continue; }
    nombres.push(w);
  }
  console.log(`Storycards pedidas (${nombres.length}): ${nombres.join(' | ')}\n`);
  for (const n of nombres) {
    const { ruta, aviso } = resolver(n, todos);
    if (!ruta) {
      const m = `«${n}»: no existe en el repositorio${aviso ? ' (' + aviso + ')' : ''}. Comprueba el nombre exacto.`;
      console.log(`  ❌ ${m}`); problemas.push(m); continue;
    }
    if (aviso) console.log(`  ℹ️  ${aviso}`);
    objetivos.push(ruta);
    if (incluirEn) {                       // también su pareja español/inglés si existe
      const dir = path.dirname(ruta), base = path.basename(ruta, path.extname(ruta));
      const pareja = path.join(dir, base.endsWith('-en') ? base.slice(0, -3) + '.html' : base + '-en.html');
      if (fs.existsSync(pareja)) { objetivos.push(pareja.replace(/^\.\//, '')); }
    }
  }
}

const r = { corregidas: 0, yaOk: 0, noStory: 0 };
for (const f of [...new Set(objetivos)]) procesar(f, r);

console.log(`\nResumen: ${r.corregidas} ${dry ? 'por corregir' : 'corregidas'} · ${r.yaOk} ya estaban bien · ${r.noStory} no eran storycards` + (problemas.length ? ` · ${problemas.length} no encontradas` : ''));
if (problemas.length) { console.error('\nNo encontradas:\n  - ' + problemas.join('\n  - ')); process.exitCode = 1; }
