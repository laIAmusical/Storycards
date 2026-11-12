#!/usr/bin/env node
/**
 * Robot de storycards de USUARIO (GitHub Actions)
 * ------------------------------------------------------------------
 * Procesa las cartas de historia que los usuarios crean en reproductor.html
 * con su texto (TXT/Word) y que quedan en Firestore con robotRequest.status = 'pending'.
 * Reutiliza las MISMAS funciones del robot semanal (generador_semanal.js):
 * imágenes con Cloudflare/Pollinations + recorte exacto con ffmpeg, voz Edge TTS
 * (respaldo Piper), plantilla de libro interactivo, secretos y quiz.
 * Imágenes: SOLO Cloudflare (se fuerza SOLO_CLOUDFLARE=1; no se usa Pollinations ni degradados).
 *
 * Carpetas de salida (por storycard, con el nombre que puso el usuario → slug):
 *   usuarios/español/<slug>/imagenportada.jpg  (16:9 · imagen de la tarjeta)
 *   usuarios/español/<slug>/portada.jpg        (1:1)
 *   usuarios/español/<slug>/portadamovil.jpg   (9:16)
 *   usuarios/español/<slug>/imagen1..N.jpg     (ilustración de cada capítulo)
 *   usuarios/español/<slug>/voz1..N.mp3        (voz en español)
 *   usuarios/ingles/<slug>/voz1..N.mp3         (voz en inglés; las imágenes NO se duplican)
 * Más: <slug>.html, <slug>-en.html, secretos/<slug>-secretos.html y las dos tarjetas
 * (ES + EN, id+10000) añadidas a data/storycards.json.
 *
 * Uso:
 *   node scripts/procesar_storycards_usuario.js --contar            (escribe pendientes=N en GITHUB_OUTPUT)
 *   node scripts/procesar_storycards_usuario.js                     (procesa las pendientes de Firestore)
 *   node scripts/procesar_storycards_usuario.js --marcar            (marca en Firestore el resultado)
 *   node scripts/procesar_storycards_usuario.js --local doc.json    (prueba sin Firestore)
 * Secret necesario para Firestore: FIREBASE_SERVICE_ACCOUNT (JSON de la cuenta de servicio).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
process.env.SOLO_CLOUDFLARE = '1'; // este robot solo usa Cloudflare para las imágenes
const R = require('./generador_semanal.js');
const QUIZ = require('./quiz_historia.js');   // quiz de 5 preguntas SOLO sobre la historia

const { RAIZ, slugify, safeJson, asegurarCarpeta, stripWrappingQuotes, limpiarTextoCapitulo,
    parseJsonSuelto, leerJson, dormir, hashTexto, fetchConTimeout } = R;

const DIR_ES = process.env.DIR_ES || 'español';
const DIR_EN = process.env.DIR_EN || 'ingles';
const MAX_HISTORIAS = Math.max(1, parseInt(process.env.MAX_HISTORIAS || '3', 10));
const MAX_CAPITULOS = 20;
const RESULTADOS = process.env.RESULTADOS_PATH || path.join(os.tmpdir(), 'usuarios_resultados.json');
const AUTOR_DEFECTO = 'LaIAmusical';

/* ───────────── Firestore ───────────── */
function abrirFirestore() {
    const admin = require('firebase-admin');
    const cred = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '');
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(cred) });
    return { db: admin.firestore(), admin };
}

async function leerPendientes(db, limite) {
    const snap = await db.collection('storycards').where('robotRequest.status', '==', 'pending').limit(limite).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ───────────── Gemini (mismos modelos y reintentos que el robot) ───────────── */
async function pedirGeminiPartes(parts) {
    const modelos = await R.listarModelosGemini();
    const errores = [];
    for (const modelo of modelos) {
        try {
            const res = await fetchConTimeout(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': R.GEMINI_KEY },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts }],
                        generationConfig: { temperature: 0.7, maxOutputTokens: 16384, responseMimeType: 'application/json' }
                    })
                }, 240000);
            const datos = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(`HTTP ${res.status} ${datos.error?.message || ''}`.trim());
            const texto = (datos.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
            if (!texto) throw new Error('respuesta sin texto');
            return texto;
        } catch (e) {
            errores.push(`${modelo}: ${e.message}`);
            if (/API_KEY_INVALID|API key not valid|API key expired/i.test(e.message)) break;
        }
    }
    throw new Error('ningún modelo Gemini respondió. ' + errores.join(' || '));
}

async function jsonDeGemini(parts, validar, etiqueta) {
    let motivo = '';
    for (let intento = 1; intento <= 3; intento++) {
        try {
            const j = parseJsonSuelto(await pedirGeminiPartes(parts));
            motivo = validar(j);
            if (!motivo) return j;
        } catch (e) { motivo = e.message; }
        await dormir(3000 * intento);
    }
    throw new Error(`Gemini (${etiqueta}) no devolvió un resultado válido: ${motivo}`);
}

const NOMBRE_IDIOMA = { es: 'Spanish', en: 'English' };

/* Plan: título/frase/sinopsis en ES y EN + descripción visual para las imágenes */
async function planificar(doc, capitulos, portadaB64) {
    const n = capitulos.length;
    const resumen = capitulos.map((c, i) => `${i + 1}. [${c.title}] ${String(c.text).replace(/\s+/g, ' ').slice(0, 350)}`).join('\n');
    const prompt = [
        'PLAN. You are the art director and editor of a bilingual (Spanish/English) story library.',
        `A user wrote a story. Its text is in ${NOMBRE_IDIOMA[doc.chaptersLang] || 'its original language'}. The user's own fields may be in Spanish or English.`,
        `User title: "${doc.title}"`,
        `User subtitle / inspiration line: "${doc.originalTitle || ''}"`,
        `User synopsis: "${doc.synopsis}"`,
        `User category: "${doc.category}"`,
        `Chapters (N_CAPITULOS=${n}):`, resumen,
        portadaB64 ? 'The attached image is the cover chosen by the user: study its style, palette, lighting and recurring characters.' : '',
        '',
        'Return a JSON object with:',
        '- "es" and "en": each with "titulo", "fraseInspiracion", "sinopsis".',
        '  Keep the user\'s own wording in the language it is already written in; translate faithfully into the other language (keep proper names).',
        '  If the subtitle is empty, write a poetic, inspiring or enigmatic line (max 12 words) in both languages. Synopsis: max 45 words.',
        '- "portada_en": visual description in English of the cover art, no text, no letters.',
        '- "estilo_en": English description of the art style (medium, palette, lighting, mood) that matches the cover and the story genre, so every illustration looks consistent.',
        '- "personajes_en": fixed English visual description of the recurring characters.',
        `- "escenas_en": an array of exactly ${n} strings, one per chapter, each a visual description in English of that chapter's key scene (no text, no letters).`,
        'Respond ONLY with valid JSON.'
    ].filter(Boolean).join('\n');
    const parts = [];
    if (portadaB64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: portadaB64 } });
    parts.push({ text: prompt });
    const plan = await jsonDeGemini(parts, (j) => {
        if (!j || !j.es || !j.en) return 'faltan las versiones es/en';
        for (const l of ['es', 'en']) {
            if (!String(j[l].titulo || '').trim()) return `falta el título ${l}`;
            if (!String(j[l].sinopsis || '').trim()) return `falta la sinopsis ${l}`;
        }
        if (!Array.isArray(j.escenas_en)) return 'faltan las escenas';
        return null;
    }, 'plan');
    while (plan.escenas_en.length < n) plan.escenas_en.push(capitulos[plan.escenas_en.length].title);
    return plan;
}

/* Traducción fiel de los capítulos (por lotes para no pasar el límite de salida) */
async function traducirCapitulos(caps, de, a) {
    const salida = [];
    for (let i = 0; i < caps.length; i += 3) {
        const lote = caps.slice(i, i + 3);
        const prompt = [
            `TRADUCE. Translate these story chapters from ${NOMBRE_IDIOMA[de]} to ${NOMBRE_IDIOMA[a]}.`,
            'Be faithful: keep every event, name, paragraph break and the literary tone; do not summarize, shorten or add anything.',
            `N_CAPITULOS=${lote.length}`,
            'Respond ONLY with JSON: {"capitulos":[{"titulo":"…","texto":"…"}]} with exactly that many items, in the same order.',
            '', JSON.stringify(lote.map(c => ({ titulo: c.title, texto: c.text })))
        ].join('\n');
        const j = await jsonDeGemini([{ text: prompt }], (r) => {
            if (!r || !Array.isArray(r.capitulos) || r.capitulos.length !== lote.length) return 'número de capítulos incorrecto';
            if (r.capitulos.some(c => !String(c.texto || '').trim())) return 'capítulo vacío';
            return null;
        }, `traducción ${i + 1}-${i + lote.length}`);
        salida.push(...j.capitulos.map(c => ({ title: String(c.titulo || ''), text: String(c.texto) })));
    }
    return salida;
}

async function traducirQuiz(quiz, de, a) {
    const prompt = [
        `TRADUCE. Translate this multiple-choice quiz from ${NOMBRE_IDIOMA[de]} to ${NOMBRE_IDIOMA[a]}, keeping the order of the options.`,
        'Respond ONLY with JSON: {"quiz":[{"q":"…","a":["…","…","…","…"],"correct":0}]} with the same number of questions and the same "correct" values.',
        '', JSON.stringify(quiz)
    ].join('\n');
    const j = await jsonDeGemini([{ text: prompt }], (r) =>
        (!r || !Array.isArray(r.quiz) || r.quiz.length !== quiz.length) ? 'quiz incorrecto' : null, 'quiz');
    return j.quiz;
}

/* ───────────── Utilidades de la storycard ───────────── */
const NUM = '(?:\\d+|[ivxlcdm]{1,6}(?![a-z])|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six|seven|eight|nine|ten)';
function tituloCap(raw, i, lang) {
    const base = lang === 'en' ? 'Chapter ' : 'Capítulo ';
    let t = stripWrappingQuotes(String(raw || '').replace(/\r/g, '').replace(/^#{1,6}\s+/, '').replace(/\*{1,3}/g, '').trim());
    t = t.replace(new RegExp('^(?:cap[ií]tulo|chapter|cap\\.|ch\\.)\\s*' + NUM + '?\\s*[:.\\-–—]*\\s*', 'i'), '').trim();
    if (!t || t.length > 90) return base + (i + 1);
    return `${base}${i + 1} — ${t}`;
}

function existe(rel) { return fs.existsSync(path.join(RAIZ, rel)); }

function slugParaDoc(titulo, docId) {
    const base = slugify(titulo) || 'historia';
    for (let n = 1; n < 500; n++) {
        const slug = n === 1 ? base : `${base}u${n}`;
        const marcador = path.join(RAIZ, 'usuarios', DIR_ES, slug, 'origen.txt');
        if (fs.existsSync(marcador)) {
            if (fs.readFileSync(marcador, 'utf8').trim() === docId) return slug; // reintento del mismo documento
            continue;
        }
        if (existe(`${slug}.html`) || existe(`${slug}-en.html`) || existe(path.join('storycard', slug)) ||
            existe(path.join('usuarios', DIR_ES, slug)) || existe(path.join('usuarios', DIR_EN, slug))) continue;
        return slug;
    }
    throw new Error('no se encontró un nombre de carpeta libre');
}

async function descargarPortada(url) {
    if (!/^https?:\/\//i.test(url || '')) return null;
    try {
        const res = await fetchConTimeout(url, {}, 60000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = R.detectarImagen(buf);
        if (!ext || buf.length < 2000) throw new Error('no es una imagen válida');
        return { buf, ext };
    } catch (e) {
        console.warn(`  ⚠️ No pude descargar la portada del usuario (${e.message}); la crearé con IA.`);
        return null;
    }
}

function guardarRecorte(portada, rutaRel, ancho, alto) {
    const r = R.recortarAProporcion(portada.buf, portada.ext, ancho, alto);
    asegurarCarpeta(path.dirname(path.join(RAIZ, rutaRel)));
    fs.writeFileSync(path.join(RAIZ, rutaRel), r.buf);
    return rutaRel;
}

function portadaBase64(portada) {
    // Reduce la portada para enviarla a Gemini
    const { spawnSync } = require('child_process');
    const ent = path.join(os.tmpdir(), `up_in_${Date.now()}.${portada.ext}`), sal = path.join(os.tmpdir(), `up_out_${Date.now()}.jpg`);
    try {
        fs.writeFileSync(ent, portada.buf);
        const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', ent, '-vf', 'scale=1024:-2:force_original_aspect_ratio=decrease', '-frames:v', '1', '-q:v', '3', sal], { timeout: 60000 });
        return r.status === 0 ? fs.readFileSync(sal).toString('base64') : null;
    } finally { [ent, sal].forEach(f => { try { fs.unlinkSync(f); } catch (e) { /* ya no existe */ } }); }
}

/* ───────────── Pipeline de una storycard de usuario ───────────── */
async function procesarDocumento(doc, idCarta) {
    const caps0 = (doc.chapters || []).filter(c => c && String(c.text || '').trim()).slice(0, MAX_CAPITULOS);
    if (!caps0.length) throw new Error('el documento no tiene capítulos');
    const lang = doc.chaptersLang === 'en' ? 'en' : 'es';
    const otro = lang === 'es' ? 'en' : 'es';
    const N = caps0.length;
    console.log(`\n📖 «${doc.title}» (${doc.id}) · ${N} capítulos · texto en ${lang.toUpperCase()}`);

    const slug = slugParaDoc(doc.title, doc.id);
    const slugEn = `${slug}-en`;
    const dirEs = `usuarios/${DIR_ES}/${slug}`;
    const dirEn = `usuarios/${DIR_EN}/${slug}`;
    asegurarCarpeta(path.join(RAIZ, dirEs));
    asegurarCarpeta(path.join(RAIZ, dirEn));
    asegurarCarpeta(path.join(RAIZ, 'secretos'));
    fs.writeFileSync(path.join(RAIZ, dirEs, 'origen.txt'), doc.id + '\n');
    console.log(`  🏷️  Carpeta: ${dirEs} · ${dirEn}`);

    // Portada del usuario (si la subió)
    const portadaUsuario = await descargarPortada(doc.cover);
    const plan = await planificar(doc, caps0, portadaUsuario ? portadaBase64(portadaUsuario) : null);

    // Textos en ambos idiomas
    console.log(`  🌐 Traduciendo capítulos ${lang.toUpperCase()} → ${otro.toUpperCase()}...`);
    const traducidos = await traducirCapitulos(caps0, lang, otro);
    const capsPor = { [lang]: caps0, [otro]: traducidos };
    const hist = {
        es: { titulo: stripWrappingQuotes(String(plan.es.titulo)).replace(/\s+/g, ' '), fraseInspiracion: stripWrappingQuotes(String(plan.es.fraseInspiracion || '')), sinopsis: String(plan.es.sinopsis).trim(),
            capitulos: capsPor.es.map(c => ({ titulo: c.title, texto: limpiarTextoCapitulo(c.text) })) },
        en: { titulo: stripWrappingQuotes(String(plan.en.titulo)).replace(/\s+/g, ' '), fraseInspiracion: stripWrappingQuotes(String(plan.en.fraseInspiracion || '')), sinopsis: String(plan.en.sinopsis).trim(),
            capitulos: capsPor.en.map(c => ({ titulo: c.title, texto: limpiarTextoCapitulo(c.text) })) }
    };

    const sala = String(doc.topic || 'Usuarios');
    const estilo = `${plan.estilo_en || 'cinematic illustration, dramatic light'}, ${plan.personajes_en || ''}, highly detailed, dramatic composition, no text, no letters, no watermark`;
    const tema = { nombre: sala, estilo: plan.estilo_en || '' };
    const semilla = hashTexto(slug);

    // ── Portadas 16:9 · 1:1 · 9:16 EXACTAS ──
    console.log('  🖼️  Portadas (16:9, 1:1, 9:16 exactas)...');
    const rImg = `${dirEs}/imagenportada.jpg`, rPor = `${dirEs}/portada.jpg`, rMov = `${dirEs}/portadamovil.jpg`;
    if (portadaUsuario) {
        guardarRecorte(portadaUsuario, rImg, 1280, 720);
        guardarRecorte(portadaUsuario, rPor, 768, 768);
        guardarRecorte(portadaUsuario, rMov, 576, 1024);
    } else {
        const promptPortada = `${plan.portada_en || hist.en.titulo}. ${estilo}`;
        const crear = async (rel, sufijo, w, h, off) => {
            if (!existe(rel)) await R.crearImagenEnRuta({ rutaRelativa: rel.replace(/\.jpg$/, ''), prompt: `${promptPortada}. ${sufijo}`, tematica: sala, ancho: w, alto: h, semilla: semilla + off });
        };
        await crear(rImg, 'Wide cinematic composition, main subject centered', 1280, 720, 0);
        await crear(rPor, 'Square composition, centered subject, portrait of the scene', 768, 768, 2);
        await crear(rMov, 'Vertical portrait composition, tall framing, centered subject', 576, 1024, 7);
    }

    // ── Capítulos: ilustración (una sola, compartida) + voz ES + voz EN ──
    const capsEs = [], capsEn = [];
    let vocesEs = 0, vocesEn = 0;
    for (let i = 0; i < N; i++) {
        console.log(`  📑 Capítulo ${i + 1}/${N}: ilustración y voces...`);
        const relIlu = `${dirEs}/imagen${i + 1}.jpg`;
        if (!existe(relIlu)) {
            await R.crearImagenEnRuta({ rutaRelativa: relIlu.replace(/\.jpg$/, ''), prompt: `${plan.escenas_en[i]}. ${estilo}`, tematica: sala, ancho: 768, alto: 512, semilla: semilla + 100 + i });
        }
        const vozEs = `${dirEs}/voz${i + 1}.mp3`, vozEn = `${dirEn}/voz${i + 1}.mp3`;
        const okEs = existe(vozEs) || await R.crearVoz(hist.es.capitulos[i].texto, vozEs, R.EDGE_VOICE, 'es');
        const okEn = existe(vozEn) || await R.crearVoz(hist.en.capitulos[i].texto, vozEn, R.EDGE_VOICE_EN, 'en');
        if (okEs) vocesEs++; if (okEn) vocesEn++;
        capsEs.push({ titulo: tituloCap(hist.es.capitulos[i].titulo, i, 'es'), texto: hist.es.capitulos[i].texto, ilustracion: relIlu, voz: okEs ? vozEs : '' });
        capsEn.push({ titulo: tituloCap(hist.en.capitulos[i].titulo, i, 'en'), texto: hist.en.capitulos[i].texto, ilustracion: relIlu, voz: okEn ? vozEn : '' });
    }
    console.log(`  📊 Voces ES: ${vocesEs}/${N} · Voces EN: ${vocesEn}/${N}`);

    // ── Quiz: el del usuario (traducido) o el del robot ──
    console.log('  ❓ Quiz...');
    let quizEs, quizEn;
    const quizUsuario = Array.isArray(doc.quiz) && doc.quiz.length === 5 && !doc.quizAuto ? doc.quiz : null;
    if (quizUsuario) {
        const trad = await traducirQuiz(quizUsuario, lang, otro);
        quizEs = lang === 'es' ? quizUsuario : trad; quizEn = lang === 'en' ? quizUsuario : trad;
    } else {
        try {
            ({ quizEs, quizEn } = await QUIZ.generarQuizDeHistoria({
                titulo: hist.es.titulo,
                capitulos: hist.es.capitulos,
                idioma: 'es',
                llamarGemini: (p) => pedirGeminiPartes([{ text: p }]),
                semilla: slug
            }));
        } catch (e) {
            // Nunca se publica un quiz genérico: sin quiz hasta que se complete con el workflow «Crear quiz de storycards»
            console.warn(`  ⚠️ No se pudo crear el quiz de la historia (${e.message}). Se publica sin quiz.`);
            quizEs = []; quizEn = [];
        }
    }

    // ── Secretos ──
    console.log('  🗝️  Secretos...');
    const { secretosEs, secretosEn } = R.construirSecretos(hist, tema, hist.es.titulo);
    const secretosHtml = R.generarSecretosHtml({
        titulo: hist.es.titulo, tituloEn: hist.en.titulo,
        fraseInspiracion: hist.es.fraseInspiracion, fraseInspiracionEn: hist.en.fraseInspiracion,
        sinopsis: hist.es.sinopsis, sinopsisEn: hist.en.sinopsis, secretosEs, secretosEn, portadaImg: rImg
    });
    fs.writeFileSync(path.join(RAIZ, 'secretos', `${slug}-secretos.html`), secretosHtml);
    fs.writeFileSync(path.join(RAIZ, 'secretos', `${slugEn}-secretos.html`), secretosHtml);

    // ── Libros interactivos ES / EN (las imágenes del EN son las del ES) ──
    const autor = String(doc.createdBy || AUTOR_DEFECTO).trim() || AUTOR_DEFECTO;
    fs.writeFileSync(path.join(RAIZ, `${slug}.html`), R.generarHtmlStory({
        titulo: hist.es.titulo, fraseInspiracion: hist.es.fraseInspiracion, autor, coverImg: rPor, coverMobileImg: rMov, musica: '', capitulos: capsEs, lang: 'es' }));
    fs.writeFileSync(path.join(RAIZ, `${slugEn}.html`), R.generarHtmlStory({
        titulo: hist.en.titulo, fraseInspiracion: hist.en.fraseInspiracion, autor, coverImg: rPor, coverMobileImg: rMov, musica: '', capitulos: capsEn, lang: 'en' }));

    // ── Tarjetas ES + EN en data/storycards.json ──
    const fecha = new Date().toISOString();
    const comun = { tematica: sala, tipo: 'usuario-ia', imagen: rImg, portada: rPor, portadaMovil: rMov, esIA: true,
        esUsuario: true, autor, categoria: String(doc.category || ''), uid: doc.createdByUid || '', firestoreId: doc.id,
        quiz: quizEs, quizEn, musicaFondo: '', fechaCreacion: fecha };
    const tarjetas = [
        { id: idCarta, titulo: hist.es.titulo, fraseInspiracion: hist.es.fraseInspiracion, ...comun, descripcion: hist.es.sinopsis,
          slug, storyPage: `${slug}.html`, secretosPage: `secretos/${slug}-secretos.html`, audioVoz: capsEs[0].voz },
        { id: idCarta + 10000, titulo: hist.en.titulo, fraseInspiracion: hist.en.fraseInspiracion, ...comun, descripcion: hist.en.sinopsis,
          slug: slugEn, storyPage: `${slugEn}.html`, secretosPage: `secretos/${slugEn}-secretos.html`, audioVoz: capsEn[0].voz }
    ];
    const rutaJson = path.join(RAIZ, 'data/storycards.json');
    asegurarCarpeta(path.dirname(rutaJson));
    const actual = leerJson(rutaJson, []).filter(c => c.firestoreId !== doc.id); // evita duplicados si se reintenta
    fs.writeFileSync(rutaJson, JSON.stringify([...tarjetas, ...actual], null, 2));
    console.log(`  ✅ Publicada: ${slug}.html / ${slugEn}.html`);
    return { slug, slugEn, storyPage: `${slug}.html`, storyPageEn: `${slugEn}.html`, secretosPage: `secretos/${slug}-secretos.html` };
}

/* ───────────── Modos ───────────── */
function salidaGithub(clave, valor) {
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${clave}=${valor}\n`);
    console.log(`${clave}=${valor}`);
}

async function main(argv = process.argv.slice(2)) {
    const modo = argv[0] || '';
    if (modo === '--contar') {
        if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.log('Falta el secret FIREBASE_SERVICE_ACCOUNT.'); return salidaGithub('pendientes', 0); }
        const { db } = abrirFirestore();
        return salidaGithub('pendientes', (await leerPendientes(db, 50)).length);
    }

    if (modo === '--marcar') {
        const { db, admin } = abrirFirestore();
        const resultados = leerJson(RESULTADOS, []);
        for (const r of resultados) {
            const ref = db.collection('storycards').doc(r.docId);
            const snap = await ref.get();
            const previos = (snap.data()?.robotRequest?.attempts) || 0;
            // Un fallo de Cloudflare (p. ej. cuota diaria) no gasta intentos: se reintenta en la próxima ejecución
            const intentos = (!r.ok && r.reintentar) ? previos : previos + 1;
            const estado = r.ok ? 'done' : ((r.reintentar || intentos < 2) ? 'pending' : 'error');
            const datos = { 'robotRequest.status': estado, 'robotRequest.attempts': intentos, 'robotRequest.finishedAt': admin.firestore.FieldValue.serverTimestamp(), 'robotRequest.error': r.ok ? '' : String(r.error || '').slice(0, 500) };
            if (r.ok) Object.assign(datos, { 'robotRequest.slug': r.slug, 'robotRequest.slugEn': r.slugEn, 'robotRequest.storyPage': r.storyPage });
            await ref.update(datos);
            console.log(`  ${r.ok ? '✅' : '⚠️'} ${r.docId} → ${estado}`);
        }
        return;
    }

    if (!R.GEMINI_KEY) { console.error('❌ Falta el secreto GEMINI_API_KEY.'); process.exit(1); }
    R.verificarFfmpeg();

    let docs;
    if (modo === '--local') docs = [{ id: 'local', ...JSON.parse(fs.readFileSync(argv[1], 'utf8')) }];
    else docs = await leerPendientes(abrirFirestore().db, MAX_HISTORIAS);
    if (!docs.length) { console.log('No hay storycards de usuario pendientes.'); fs.writeFileSync(RESULTADOS, '[]'); return; }

    const resultados = [];
    const idBase = Date.now();
    for (let i = 0; i < docs.length; i++) {
        try {
            const r = await procesarDocumento(docs[i], idBase + i * 20000);
            resultados.push({ docId: docs[i].id, ok: true, ...r });
        } catch (e) {
            console.error(`❌ Falló «${docs[i].title}»: ${e.message}`);
            resultados.push({ docId: docs[i].id, ok: false, error: e.message, reintentar: /Cloudflare/i.test(e.message) });
        }
    }
    fs.writeFileSync(RESULTADOS, JSON.stringify(resultados, null, 2));
    console.log(`\n🎉 Procesadas: ${resultados.filter(r => r.ok).length}/${resultados.length} · Imágenes IA: ${R.imagenesIA}`);
    if (!resultados.some(r => r.ok) && modo === '--local') process.exit(1);
}

module.exports = { main, tituloCap, slugParaDoc };
if (require.main === module) main().catch(e => { console.error('❌ Error inesperado:', e); process.exit(1); });
