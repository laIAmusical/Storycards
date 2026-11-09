#!/usr/bin/env node
/**
 * Quita la sombra/marco que tapaba los bordes de las imágenes de los capítulos
 * en las páginas de storycard ya creadas (<nombre>.html y <nombre>-en.html).
 * Elimina las reglas  .page-illustration::before  (marco con box-shadow)  y
 * .page-illustration::after (degradado inferior). Es idempotente: se puede repetir.
 *
 * Uso:
 *   node scripts/corregir_sombra_imagenes.js            (revisa y corrige todas las .html del repo)
 *   node scripts/corregir_sombra_imagenes.js --dry-run  (solo muestra cuáles cambiaría)
 *   node scripts/corregir_sombra_imagenes.js a.html b.html
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const explicitas = args.filter((a) => !a.startsWith('--'));
const OMITIR = new Set(['reproductor.html', 'creador_cartas.html']);

function listarHtml(dir, prof = 0) {
  let r = [];
  if (prof > 3) return r;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.github'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) r = r.concat(listarHtml(full, prof + 1));
    else if (/\.html?$/i.test(e.name) && !OMITIR.has(e.name)) r.push(full);
  }
  return r;
}

const RE_MARCO = /\/\*\s*Marco perimetral\s*\*\/\s*\.page-illustration::before\s*\{[^}]*\}\s*\.page-illustration::after\s*\{[^}]*\}[ \t]*\r?\n?/g;
const RE_BEFORE = /[ \t]*\.page-illustration::before\s*\{[^}]*\}[ \t]*\r?\n?/g;
const RE_AFTER = /[ \t]*\.page-illustration::after\s*\{[^}]*\}[ \t]*\r?\n?/g;

function corregir(texto) {
  return texto.replace(RE_MARCO, '').replace(RE_BEFORE, '').replace(RE_AFTER, '');
}

const archivos = explicitas.length ? explicitas : listarHtml('.');
let cambiadas = 0, yaOk = 0, sinPlantilla = 0;
for (const f of archivos) {
  if (!fs.existsSync(f)) { console.log(`  no existe: ${f}`); continue; }
  const original = fs.readFileSync(f, 'utf8');
  if (!original.includes('page-illustration')) { sinPlantilla++; continue; }   // no es una página de storycard
  const nuevo = corregir(original);
  if (nuevo === original) { yaOk++; continue; }
  cambiadas++;
  console.log(`  ${dry ? 'cambiaría' : 'corregida'}: ${f}`);
  if (!dry) fs.writeFileSync(f, nuevo);
}
console.log(`\nStorycards ${dry ? 'por corregir' : 'corregidas'}: ${cambiadas} · ya estaban bien: ${yaOk} · otras páginas sin tocar: ${sinPlantilla}`);
