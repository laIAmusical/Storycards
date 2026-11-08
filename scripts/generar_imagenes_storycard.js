#!/usr/bin/env node
/**
 * Genera las imágenes de los capítulos de una storycard (1 por capítulo).
 *
 *  - Lee <storycard>.html y saca capítulos, textos y la RUTA EXACTA de cada
 *    imagen (illustrationSrc), p. ej. storycard/eldestino/imagen1.png
 *  - Busca la portada ya subida en imagenportada/ (o storycard/<slug>/portada.*)
 *    y la usa como referencia: Gemini (visión) describe su estilo y sus
 *    personajes, y esa "biblia de estilo" se aplica a todos los capítulos.
 *  - Las imágenes salen con la resolución de la portada (mín. 1024 px de ancho)
 *    en 16:9, recortadas con ffmpeg.
 *
 * Uso:
 *   node scripts/generar_imagenes_storycard.js eldestino.html
 *   node scripts/generar_imagenes_storycard.js "eldestino.html elavesinjaula.html"   (varias a la vez)
 *   node scripts/generar_imagenes_storycard.js eldestino            (también vale el slug)
 *   Opciones: --force (regenera aunque existan)  --dry-run (no llama a ninguna API)
 *             --portada ruta/a/portada.png  --solo 3,4 (solo esos capítulos)
 *
 * Variables de entorno:
 *   GEMINI_API_KEY, GEMINI_MODEL (def. gemini-2.5-flash)
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (obligatorias: único generador de imágenes)
 *   CLOUDFLARE_MODEL (def. @cf/black-forest-labs/flux-1-schnell)
 *   IMG_ASPECT (def. 16:9)  IMG_WIDTH (fuerza el ancho)  PAUSA_MS (def. 4000)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ENV = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

/* ---------- 1. Leer la página ---------- */
const MAPA_ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

// Lee un literal de cadena JS ('...', "..." o `...`) que empieza en s[i]. Devuelve [texto, posiciónFinal].
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
  throw new Error('literal de texto sin cerrar');
}

// Entiende las páginas del robot (comillas dobles) y las manuales (comillas simples o `backticks`),
// con las claves en cualquier orden.
function leerPagina(htmlPath) {
  const h = fs.readFileSync(htmlPath, 'utf8');
  const tipos = [...h.matchAll(/type\s*:\s*['"`](\w+)['"`]/g)];
  const cap = [];
  tipos.forEach((t, k) => {
    if (t[1] !== 'story') return;
    const bloque = h.slice(t.index, k + 1 < tipos.length ? tipos[k + 1].index : h.length);
    const campo = (clave) => {
      const m = bloque.match(new RegExp('(?<![\\w.])[\'"]?' + clave + '[\'"]?\\s*:\\s*([\'"`])'));
      return m ? leerLiteral(bloque, m.index + m[0].length - 1)[0] : null;
    };
    const texto = campo('text');
    if (texto && texto.trim()) {
      cap.push({ titulo: (campo('chapterTitle') || '').trim(), ruta: (campo('illustrationSrc') || '').trim(), texto: texto.trim() });
    }
  });
  const m = h.match(/(?<![\w.])['"]?title['"]?\s*:\s*(['"`])/);
  const titulo = m ? leerLiteral(h, m.index + m[0].length - 1)[0] : path.basename(htmlPath, '.html');
  return { capitulos: cap, titulo };
}

/* ---------- 2. Portada de referencia ---------- */
function buscarPortada(slug, forzada) {
  if (forzada) return fs.existsSync(forzada) ? forzada : null;
  const exts = /\.(png|jpe?g|webp)$/i;
  const dir = 'imagenportada';
  const s = norm(slug.replace(/-en$/, ''));
  if (fs.existsSync(dir)) {
    const lista = fs.readdirSync(dir).filter((f) => exts.test(f));
    const base = (f) => norm(f.replace(exts, ''));
    const hit = lista.find((f) => base(f) === s) ||
                lista.find((f) => base(f).includes(s)) ||
                lista.find((f) => s.includes(base(f)) && base(f).length > 5);
    if (hit) return path.join(dir, hit);
  }
  for (const e of ['png', 'jpg', 'jpeg', 'webp']) {
    const p = path.join('storycard', slug, 'portada.' + e);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function dimensiones(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',');
  return { w: +out[0], h: +out[1] };
}

function tamanoObjetivo(portada) {
  const [a, b] = (ENV.IMG_ASPECT || '16:9').split(':').map(Number);
  let ancho = +ENV.IMG_WIDTH || 0;
  if (!ancho) {
    ancho = 1024;
    if (portada) { const d = dimensiones(portada); ancho = Math.min(Math.max(Math.max(d.w, d.h), 1024), 2048); }
  }
  ancho -= ancho % 2;
  let alto = Math.round((ancho * b) / a); alto -= alto % 2;
  return { w: ancho, h: alto };
}

/* ---------- 3. Gemini: biblia de estilo + prompts ---------- */
async function gemini(parts, json = true) {
  if (!ENV.GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY');
  const modelo = ENV.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ENV.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: json ? { responseMimeType: 'application/json', temperature: 0.7 } : { temperature: 0.7 },
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

function portadaBase64(portada) {
  const tmp = path.join(require('os').tmpdir(), 'portada_ref.jpg');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', portada, '-vf', 'scale=1024:-2:force_original_aspect_ratio=decrease',
    '-frames:v', '1', '-q:v', '3', tmp]);
  return fs.readFileSync(tmp).toString('base64');
}

async function bibliaDeEstilo(portada, titulo, capitulos) {
  const resumen = capitulos.map((c, i) => `${i + 1}. ${c.texto}`).join('\n').slice(0, 6000);
  const instr = `You are an art director. Story title: "${titulo}". Story summary by chapters:\n${resumen}\n\n` +
    (portada ? 'Study the attached cover image. ' : '') +
    'Return JSON with two string fields, both in English: ' +
    '"style" (medium, rendering technique, color palette, lighting, mood, level of detail - precise enough that new images match the cover exactly) and ' +
    '"characters" (a fixed visual description of each recurring character and key object: age, hair, clothing, distinctive items, so they look identical in every image).';
  const parts = [];
  if (portada) parts.push({ inline_data: { mime_type: 'image/jpeg', data: portadaBase64(portada) } });
  parts.push({ text: instr });
  const j = JSON.parse(await gemini(parts));
  return { style: String(j.style || ''), characters: String(j.characters || '') };
}

async function promptsCapitulos(biblia, capitulos) {
  const lista = capitulos.map((c, i) => `${i + 1}. [${c.titulo}] ${c.texto}`).join('\n');
  const instr = `Write one image-generation prompt per chapter, in English, for an illustrated story.\n` +
    `Global style (must be respected in every prompt): ${biblia.style}\nRecurring characters (repeat their key visual traits whenever they appear): ${biblia.characters}\n\n` +
    `Chapters:\n${lista}\n\n` +
    `Rules: each prompt describes ONE key visual moment of its chapter (subjects, action, setting, camera angle, lighting), 60-90 words, wide cinematic 16:9 composition, ` +
    `no text, no letters, no logos, no watermark. Return JSON: {"prompts": ["...", ...]} with exactly ${capitulos.length} items in chapter order.`;
  const j = JSON.parse(await gemini([{ text: instr }]));
  if (!Array.isArray(j.prompts) || j.prompts.length !== capitulos.length) throw new Error('Gemini no devolvió un prompt por capítulo');
  return j.prompts.map((p) => `${p} Style: ${biblia.style}`.slice(0, 1800));
}

function promptRespaldo(c, biblia) {
  const t = c.texto.replace(/\s+/g, ' ').slice(0, 350);
  return `Cinematic wide illustration of this scene: ${t} ${biblia.style || 'detailed digital painting, dramatic lighting'} ${biblia.characters || ''} No text, no letters, no watermark.`.slice(0, 1800);
}

/* ---------- 4. Proveedores de imagen ---------- */
async function cloudflare(prompt, w, h) {
  const modelo = ENV.CLOUDFLARE_MODEL || '@cf/black-forest-labs/flux-1-schnell';
  const url = `https://api.cloudflare.com/client/v4/accounts/${ENV.CLOUDFLARE_ACCOUNT_ID}/ai/run/${modelo}`;
  const body = { prompt: prompt.slice(0, 2000) };
  if (/flux/.test(modelo)) body.steps = 8;               // flux-1-schnell: máx. 8 pasos
  else if (/stable-diffusion/.test(modelo)) { body.width = w; body.height = h; } // SDXL admite tamaño
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ENV.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Cloudflare ${r.status}: ${(await r.text()).slice(0, 200)}`);
  if ((r.headers.get('content-type') || '').startsWith('image/')) return Buffer.from(await r.arrayBuffer()); // modelos que devuelven la imagen directa
  const j = await r.json();
  if (!j.result?.image) throw new Error('Cloudflare no devolvió imagen');
  return Buffer.from(j.result.image, 'base64');
}

async function generarImagen(prompt, w, h) {
  let ultimo;
  for (let i = 1; i <= 4; i++) {
    try { return await cloudflare(prompt, w, h); }
    catch (e) { ultimo = e; console.log(`    Cloudflare intento ${i}/4 falló: ${e.message}`); await sleep(3000 * i); }
  }
  throw ultimo;
}

/* ---------- 5. Recorte exacto con ffmpeg ---------- */
function guardarExacto(buffer, destino, w, h) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = destino + '.tmp';
  fs.writeFileSync(tmp, buffer);
  const esJpg = /\.jpe?g$/i.test(destino);
  const out = esJpg ? ['-q:v', '2'] : [];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-vf',
    `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`, '-frames:v', '1', ...out, destino]);
  fs.unlinkSync(tmp);
}

/* ---------- main ---------- */
/* ---------- Varias páginas y nombres "aproximados" ---------- */
// "elavesinjaula.html sinfonia.html" -> ['elavesinjaula.html', 'sinfonia.html']
// También tolera comas, saltos de línea y nombres sin .html.
function separarPaginas(texto) {
  const t = String(texto || '').trim();
  if (!t) return [];
  if (/\.html?\b/i.test(t)) return (t.match(/[^,;\n]*?\.html?(?=[\s,;]|$)/gi) || []).map((x) => x.trim()).filter(Boolean);
  return t.split(/[\s,;]+/).filter(Boolean);
}

// Busca la página: tal cual, con .html, sin espacios (p. ej. "el avesinjaula.html"), o en subcarpetas.
function resolverPagina(entrada) {
  const nombre = entrada.replace(/^\.?\//, '');
  const conExt = /\.html?$/i.test(nombre) ? nombre : nombre + '.html';
  const candidatos = [conExt, conExt.replace(/\s+/g, '')];
  for (const c of candidatos) if (fs.existsSync(c) && fs.statSync(c).isFile()) return { ruta: c, aviso: c !== conExt ? `Nombre corregido: «${entrada}» → ${c}` : '' };
  const buscados = new Set(candidatos.map((c) => path.basename(c).toLowerCase()));
  const hallados = [];
  const recorrer = (dir, prof) => {
    if (prof > 4) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(full, prof + 1);
      else if (buscados.has(e.name.toLowerCase())) hallados.push(full);
    }
  };
  recorrer('.', 0);
  if (hallados.length === 1) return { ruta: hallados[0], aviso: `No estaba en la raíz; usé ${hallados[0]}` };
  return { ruta: null, aviso: hallados.length > 1 ? `«${entrada}» está en varias carpetas: ${hallados.join(', ')}` : '' };
}

/* ---------- Una storycard ---------- */
async function procesarPagina(htmlPath, op) {
  const slug = path.basename(htmlPath, '.html');
  const { capitulos, titulo } = leerPagina(htmlPath);
  if (!capitulos.length) throw new Error('No encontré capítulos (type: \'story\' con text) en la página.');

  // Carpeta de la storycard: storycard/<nombre de la página>/ (se crea si no existe).
  // Si la página ya indica la ruta de cada imagen se respeta; si no la indica, se usa esta carpeta.
  const carpetaBase = path.join('storycard', slug.replace(/-en$/, ''));
  const extDefecto = (capitulos.find((c) => c.ruta) || { ruta: '' }).ruta.match(/\.(png|jpe?g)$/i)?.[0] || '.png';
  capitulos.forEach((c, i) => { if (!c.ruta) c.ruta = `${carpetaBase}/imagen${i + 1}${extDefecto}`; });

  const portada = buscarPortada(slug, op.portada);
  const { w, h } = tamanoObjetivo(portada);
  console.log(`Storycard: ${titulo} (${slug}) · ${capitulos.length} capítulos`);
  console.log(`Portada de referencia: ${portada || 'NO ENCONTRADA (se usará solo el texto)'}`);
  console.log(`Tamaño de salida: ${w}x${h}`);

  const pendientes = capitulos.map((c, i) => ({ ...c, n: i + 1 }))
    .filter((c) => (!op.solo || op.solo.includes(c.n)) && (op.force || !fs.existsSync(c.ruta)));
  capitulos.forEach((c, i) => console.log(`  ${i + 1}. ${c.ruta} ${fs.existsSync(c.ruta) ? '(ya existe)' : ''}`));
  const carpetas = [...new Set(capitulos.map((c) => path.dirname(c.ruta)))];
  carpetas.forEach((d) => console.log(`Carpeta de imágenes: ${d}/ ${fs.existsSync(d) ? '(ya existe)' : (op.dry ? '(se creará)' : '(creada)')}`));
  if (op.dry) { console.log(`Dry-run: se generarían ${pendientes.length} imágenes.`); return; }
  carpetas.forEach((d) => fs.mkdirSync(d, { recursive: true }));
  if (!pendientes.length) { console.log('Nada que generar (usa --force para regenerar).'); return; }

  let biblia = { style: '', characters: '' };
  let prompts = null;
  try {
    biblia = await bibliaDeEstilo(portada, titulo, capitulos);
    console.log('Estilo de la portada:', biblia.style.slice(0, 160) + '…');
    prompts = await promptsCapitulos(biblia, capitulos);
  } catch (e) { console.log(`Gemini no disponible (${e.message}); uso prompts de respaldo.`); }

  const fallos = [];
  for (const c of pendientes) {
    console.log(`Capítulo ${c.n}: ${c.titulo}`);
    const prompt = prompts ? prompts[c.n - 1] : promptRespaldo(c, biblia);
    try {
      const buf = await generarImagen(prompt, w, h);
      guardarExacto(buf, c.ruta, w, h);
      console.log(`  OK ${c.ruta}`);
    } catch (e) { console.log(`  ERROR capítulo ${c.n}: ${e.message}`); fallos.push(c.n); }
    await sleep(+ENV.PAUSA_MS || 4000);
  }
  if (fallos.length) throw new Error(`Fallaron los capítulos ${fallos.join(', ')}. Relanza el workflow: solo repetirá esos.`);
  console.log('Listo.');
}

async function main(argv = process.argv.slice(2)) {
  const flag = (n) => argv.includes(n);
  const valor = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !['--portada', '--solo'].includes(argv[i - 1]));
  const entradas = separarPaginas(pos.join(' '));
  if (!entradas.length) { console.log('Uso: node scripts/generar_imagenes_storycard.js "pagina1.html pagina2.html" [--force] [--dry-run]'); process.exit(1); }
  const op = { force: flag('--force'), dry: flag('--dry-run'), portada: valor('--portada'), solo: valor('--solo') ? valor('--solo').split(',').map(Number) : null };

  if (!op.dry && (!ENV.CLOUDFLARE_ACCOUNT_ID || !ENV.CLOUDFLARE_API_TOKEN)) {
    console.error('Faltan CLOUDFLARE_ACCOUNT_ID y/o CLOUDFLARE_API_TOKEN (secrets del repositorio).'); process.exit(1);
  }

  console.log(`Páginas a procesar (${entradas.length}): ${entradas.join(' | ')}`);
  const problemas = [];
  for (const entrada of entradas) {
    console.log(`\n==== ${entrada}`);
    const { ruta, aviso } = resolverPagina(entrada);
    if (aviso) console.log(aviso);
    if (!ruta) { const m = `${entrada}: no existe en el repositorio (comprueba el nombre exacto y que esté subida).`; console.error('ERROR ' + m); problemas.push(m); continue; }
    try { await procesarPagina(ruta, op); }
    catch (e) { console.error(`ERROR ${entrada}: ${e.message}`); problemas.push(`${entrada}: ${e.message}`); }
  }
  console.log('');
  if (problemas.length) {
    console.error(`Terminado con ${problemas.length} problema(s):`);
    problemas.forEach((p) => console.error('  - ' + p));
    process.exitCode = 1;
  } else console.log('Terminado sin errores.');
}

module.exports = { separarPaginas, resolverPagina, leerLiteral, leerPagina, buscarPortada, tamanoObjetivo, guardarExacto, main };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
