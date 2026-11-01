/**
 * Robot semanal de Storycards (GitHub Actions)
 * ------------------------------------------------------------------
 * Cada ejecución crea 2 storycards COMPLETAS y autónomas:
 *   - <slug>.html                      → libro interactivo (mismo diseño que el Creador de Cartas)
 *   - storycard/<slug>/portada.*       → portada (IA con Pollinations o ilustración SVG de respaldo)
 *   - storycard/<slug>/portadamovil.*  → portada vertical 9:16
 *   - storycard/<slug>/imagenN.*       → ilustración de cada capítulo
 *   - storycard/<slug>/vozN.mp3        → narración de cada capítulo (ElevenLabs)
 *   - storycard/<slug>/musica.wav      → música ambiental generada por el propio robot
 *   y las registra en data/storycards.json para que reproductor.html las muestre.
 *
 * Requisitos: Node 18+ (usa fetch nativo) y NINGUNA dependencia npm.
 * Secreto opcional: ELEVENLABS_API_KEY (GitHub → Settings → Secrets → Actions).
 */
const fs = require('fs');
const path = require('path');

// ───────────────────────── CONFIGURACIÓN ─────────────────────────
const RAIZ = path.join(__dirname, '..');
const NUM_CAPITULOS = parseInt(process.env.NUM_CAPITULOS || '3', 10);
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || 'aYbngTsp5kp0sibI3Z0T'; // voz masculina
const POLLINATIONS_KEY = process.env.POLLINATIONS_API_KEY || '';
const AUTOR = 'LaIAmusical';
const PLANTILLA = JSON.parse(fs.readFileSync(path.join(__dirname, 'plantilla_story.json'), 'utf8'));

// ───────────────────────── UTILIDADES ─────────────────────────
const dormir = ms => new Promise(r => setTimeout(r, ms));
const slugify = t => (t || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
const escapeHtml = s => (s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const safeJson = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const asegurarCarpeta = c => fs.mkdirSync(c, { recursive: true });

function hashTexto(t) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function stripWrappingQuotes(str) {
    let t = (str || '').trim();
    t = t.replace(/^["“”'‘’«»]+\s*/, '').replace(/\s*["“”'‘’«»]+$/, '');
    return t.trim();
}
function limpiarTextoCapitulo(text) {
    let t = (text || '').replace(/\r/g, '').trim();
    t = stripWrappingQuotes(t);
    t = t.replace(/^#{1,6}\s+.+\n+/m, '');
    t = t.replace(/^\s*Cap[íi]tulo\s+\d+\s*[:.\-–—]*\s*/i, '');
    t = t.replace(/^[*_#>`]+\s*/, '');
    t = stripWrappingQuotes(t).trimStart();
    if (t.length && /[a-záéíóúñü]/i.test(t.charAt(0))) t = t.charAt(0).toUpperCase() + t.slice(1);
    return t.trim();
}
function tituloCorto(raw, i) {
    const fallback = 'Capítulo ' + (i + 1);
    let t = stripWrappingQuotes((raw || '').replace(/\r/g, '').replace(/^#{1,6}\s+/, '').replace(/^\*{1,3}|\*{1,3}$/g, '').trim());
    if (!t || t.length > 90) return fallback;
    if (!/^Cap[íi]tulo\s+\d+/i.test(t)) t = fallback + ' — ' + t;
    return t;
}

async function fetchConTimeout(url, opciones = {}, ms = 60000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...opciones, signal: ctl.signal }); }
    finally { clearTimeout(timer); }
}

// ───────────────────────── 1. ESTADÍSTICAS → TEMÁTICA ─────────────────────────
function elegirTematicaGanadora() {
    const rutaRanking = path.join(RAIZ, 'data/ranking_semanal.json');
    let datos = [];
    try { if (fs.existsSync(rutaRanking)) datos = JSON.parse(fs.readFileSync(rutaRanking, 'utf8')); }
    catch (e) { console.warn('ranking_semanal.json ilegible, uso CINE:', e.message); }
    const puntos = {};
    datos.forEach(u => {
        const cat = (u.tematicaFavorita || 'CINE').toString().toUpperCase();
        puntos[cat] = (puntos[cat] || 0) + (u.puntuacion || 1);
    });
    return Object.keys(puntos).reduce((a, b) => (puntos[a] > puntos[b] ? a : b), 'CINE');
}

// ───────────────────────── 2. HISTORIA (texto) ─────────────────────────
async function pedirTextoIA(prompt) {
    for (let intento = 1; intento <= 3; intento++) {
        try {
            let url = 'https://text.pollinations.ai/' + encodeURIComponent(prompt.slice(0, 1800)) +
                '?model=openai&seed=' + Math.floor(Math.random() * 999999);
            if (POLLINATIONS_KEY) url += '&key=' + encodeURIComponent(POLLINATIONS_KEY);
            const res = await fetchConTimeout(url, {}, 90000);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const txt = (await res.text()).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
            if (txt.length > 50) return txt;
        } catch (e) { console.warn(`  Texto IA, intento ${intento} falló: ${e.message}`); }
        await dormir(2500 * intento);
    }
    return null;
}
function parseJsonSuelto(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { /* sigue */ }
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(raw.slice(a, b + 1)); } catch (e) { /* sigue */ } }
    return null;
}

function historiaRespaldo(tematica, titulo, n) {
    const t = tematica.toLowerCase();
    const aperturas = [
        `Todo empezó una noche cualquiera, cuando el mundo de ${t} dejó de ser solo una afición y se convirtió en un enigma.`,
        `Nadie esperaba que la semana trajera un misterio nuevo al universo de ${t}, pero allí estaba, esperando a quien se atreviera a buscarlo.`
    ];
    return {
        sinopsis: `Una aventura breve en el universo de ${t}: ${titulo}. Pistas, giros y una decisión que lo cambia todo.`,
        capitulos: [
            { titulo: 'El comienzo', texto: `${aperturas[n % 2]} Una pista diminuta, casi invisible, apuntaba hacia un lugar que nadie había mirado con atención.\n\nSiguiendo ese rastro, la protagonista entendió que cada detalle importaba y que la historia apenas estaba despertando.` },
            { titulo: 'La pista oculta', texto: `Entre luces, sombras y voces lejanas, apareció la primera respuesta, aunque trajo consigo dos preguntas más.\n\nNada era lo que parecía, y cada paso exigía confiar en la intuición más que en las pruebas.` },
            { titulo: 'La decisión', texto: `Al final solo quedaba una elección: seguir adelante o volver a la calma de siempre.\n\nElla sonrió, respiró hondo y avanzó. Algunas historias solo se entienden cuando se tiene el valor de terminarlas.` },
            { titulo: 'El eco', texto: `Mucho tiempo después, el eco de aquella aventura seguía resonando en el universo de ${t}, invitando a otros a escribir la siguiente página.` }
        ]
    };
}

async function generarHistoria(tematica, titulo, enfoque, n) {
    console.log(`  ✍️  Escribiendo la historia "${titulo}"...`);
    const prompt = `Escribe una historia corta original en español sobre ${tematica} con el título "${titulo}" (${enfoque}). ` +
        `Responde SOLO con JSON válido, sin markdown, con esta forma exacta: ` +
        `{"sinopsis":"una frase de 25 palabras","capitulos":[{"titulo":"título breve","texto":"2 párrafos de unas 60 palabras en total"}]} ` +
        `con exactamente ${NUM_CAPITULOS} capítulos. Sin escribir el título dentro del texto.`;
    const raw = await pedirTextoIA(prompt);
    const json = parseJsonSuelto(raw);
    const respaldo = historiaRespaldo(tematica, titulo, n);
    let caps = [];
    if (json && Array.isArray(json.capitulos)) {
        caps = json.capitulos
            .filter(c => c && typeof c.texto === 'string' && c.texto.trim().length > 60)
            .map(c => ({ titulo: String(c.titulo || ''), texto: c.texto }));
    }
    if (caps.length < NUM_CAPITULOS) {
        console.log(`  ⚠️  La IA de texto no respondió bien (${caps.length}/${NUM_CAPITULOS}); completo con texto de respaldo.`);
        for (let i = caps.length; i < NUM_CAPITULOS; i++) caps.push(respaldo.capitulos[i % respaldo.capitulos.length]);
    }
    return {
        sinopsis: (json && typeof json.sinopsis === 'string' && json.sinopsis.length > 20) ? json.sinopsis.trim() : respaldo.sinopsis,
        capitulos: caps.slice(0, NUM_CAPITULOS).map((c, i) => ({
            titulo: tituloCorto(c.titulo, i),
            texto: limpiarTextoCapitulo(c.texto)
        }))
    };
}

// ───────────────────────── 3. IMÁGENES ─────────────────────────
const PALETAS = {
    CINE: [350, 20, 270], SERIES: [200, 280, 320], ANIME: [320, 190, 50], ANIMACION: [45, 170, 300],
    LITERATURA: [30, 20, 200], VIDEOJUEGOS: [150, 260, 330], RELIGION: [45, 30, 210]
};
function matices(tematica) {
    const clave = tematica.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const base = PALETAS[clave];
    if (base) return base;
    const h = hashTexto(clave) % 360;
    return [h, (h + 60) % 360, (h + 200) % 360];
}

/** Ilustración SVG de respaldo: siempre funciona, sin red ni librerías. */
function crearSvg(tematica, semilla, ancho, alto) {
    const rnd = mulberry32(semilla);
    const [h1, h2, h3] = matices(tematica);
    let formas = '';
    for (let i = 0; i < 9; i++) {
        const cx = Math.round(rnd() * ancho), cy = Math.round(rnd() * alto * 0.75);
        const r = Math.round(ancho * (0.08 + rnd() * 0.22));
        const h = [h1, h2, h3][i % 3];
        formas += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${h},80%,${55 + Math.round(rnd() * 15)}%)" opacity="${(0.12 + rnd() * 0.2).toFixed(2)}"/>`;
    }
    let estrellas = '';
    for (let i = 0; i < 60; i++) {
        estrellas += `<circle cx="${Math.round(rnd() * ancho)}" cy="${Math.round(rnd() * alto * 0.7)}" r="${(0.8 + rnd() * 2.2).toFixed(1)}" fill="#fff" opacity="${(0.3 + rnd() * 0.7).toFixed(2)}"/>`;
    }
    const m1 = [], m2 = [];
    for (let i = 0; i <= 6; i++) {
        m1.push(`${Math.round(i * ancho / 6)},${Math.round(alto * (0.72 + rnd() * 0.12))}`);
        m2.push(`${Math.round(i * ancho / 6)},${Math.round(alto * (0.84 + rnd() * 0.08))}`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}">
<defs>
<linearGradient id="cielo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h1},70%,12%)"/><stop offset="0.6" stop-color="hsl(${h2},65%,24%)"/><stop offset="1" stop-color="hsl(${h3},60%,34%)"/></linearGradient>
<radialGradient id="luna" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff7d6"/><stop offset="1" stop-color="#fff7d6" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${ancho}" height="${alto}" fill="url(#cielo)"/>
${formas}${estrellas}
<circle cx="${Math.round(ancho * (0.25 + rnd() * 0.5))}" cy="${Math.round(alto * 0.28)}" r="${Math.round(ancho * 0.16)}" fill="url(#luna)"/>
<polygon points="0,${alto} ${m1.join(' ')} ${ancho},${alto}" fill="hsl(${h1},45%,10%)" opacity="0.85"/>
<polygon points="0,${alto} ${m2.join(' ')} ${ancho},${alto}" fill="hsl(${h2},40%,6%)"/>
</svg>`;
}

async function pedirImagenIA(prompt, ancho, alto, semilla) {
    for (let intento = 1; intento <= 2; intento++) {
        try {
            let url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) +
                `?width=${ancho}&height=${alto}&seed=${semilla + intento}&nologo=true&model=flux`;
            if (POLLINATIONS_KEY) url += '&key=' + encodeURIComponent(POLLINATIONS_KEY);
            const res = await fetchConTimeout(url, {}, 70000);
            const tipo = res.headers.get('content-type') || '';
            if (!res.ok || !tipo.startsWith('image/')) throw new Error(`HTTP ${res.status} (${tipo})`);
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 5000) throw new Error('imagen demasiado pequeña');
            return { buf, ext: tipo.includes('png') ? 'png' : 'jpg' };
        } catch (e) { console.warn(`  Imagen IA, intento ${intento} falló: ${e.message}`); await dormir(2000); }
    }
    return null;
}

/** Guarda la imagen y devuelve la ruta relativa a la raíz del repositorio. */
async function crearImagen({ carpeta, nombre, prompt, tematica, ancho, alto, semilla, usarIA }) {
    const rel = `storycard/${carpeta}/${nombre}`;
    asegurarCarpeta(path.join(RAIZ, 'storycard', carpeta));
    if (usarIA) {
        const ia = await pedirImagenIA(prompt, ancho, alto, semilla);
        if (ia) { fs.writeFileSync(path.join(RAIZ, `${rel}.${ia.ext}`), ia.buf); return `${rel}.${ia.ext}`; }
    }
    fs.writeFileSync(path.join(RAIZ, `${rel}.svg`), crearSvg(tematica, semilla, ancho, alto));
    return `${rel}.svg`;
}

// ───────────────────────── 4. VOZ (ElevenLabs) ─────────────────────────
async function crearVoz(texto, rutaRel) {
    if (!ELEVEN_KEY) return false;
    try {
        const res = await fetchConTimeout(
            `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_128`,
            {
                method: 'POST',
                headers: { Accept: 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': ELEVEN_KEY },
                body: JSON.stringify({ text: texto, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
            }, 90000);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 2000) throw new Error('audio vacío');
        fs.writeFileSync(path.join(RAIZ, rutaRel), buf);
        return true;
    } catch (e) {
        console.warn(`  ⚠️ Voz no generada (${e.message}). La página funcionará sin narración en ese capítulo.`);
        return false;
    }
}

// ───────────────────────── 5. MÚSICA AMBIENTAL (WAV generado) ─────────────────────────
function crearMusicaWav(rutaRel, tematica) {
    const sr = 22050, seg = 28, n = sr * seg;
    const h = hashTexto(tematica);
    const raices = [110.0, 123.47, 130.81, 146.83, 98.0, 116.54];
    const raiz = raices[h % raices.length];
    const menor = [1, 6 / 5, 3 / 2, 2, 12 / 5];
    const mayor = [1, 5 / 4, 3 / 2, 2, 5 / 2];
    const acorde = (h >> 3) % 2 ? menor : mayor;
    const datos = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
        const t = i / sr;
        let v = 0;
        acorde.forEach((r, k) => {
            const f = raiz * r;
            const lento = 0.55 + 0.45 * Math.sin(2 * Math.PI * (0.05 + k * 0.013) * t + k);
            v += Math.sin(2 * Math.PI * f * t) * lento * (0.9 / (k + 1));
            v += Math.sin(2 * Math.PI * f * 2.003 * t) * lento * 0.12;
        });
        const entrada = Math.min(1, t / 3), salida = Math.min(1, (seg - t) / 3);
        v *= 0.16 * Math.min(entrada, salida);
        datos.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), i * 2);
    }
    const cab = Buffer.alloc(44);
    cab.write('RIFF', 0); cab.writeUInt32LE(36 + datos.length, 4); cab.write('WAVE', 8);
    cab.write('fmt ', 12); cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22);
    cab.writeUInt32LE(sr, 24); cab.writeUInt32LE(sr * 2, 28); cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34);
    cab.write('data', 36); cab.writeUInt32LE(datos.length, 40);
    fs.writeFileSync(path.join(RAIZ, rutaRel), Buffer.concat([cab, datos]));
}

// ───────────────────────── 6. HTML DE LA STORYCARD ─────────────────────────
function aplicarI18n(str) {
    const t = PLANTILLA.STORY_I18N.es;
    let out = str;
    Object.keys(t).forEach(k => { out = out.split('§' + k + '§').join(t[k]); });
    return out;
}

function generarHtmlStory({ titulo, autor, coverImg, coverMobileImg, musica, capitulos }) {
    let paginas = `  {\n    type: 'cover',\n    coverImg: ${safeJson(coverImg)},\n    coverMobileImg: ${safeJson(coverMobileImg)},\n    title: ${safeJson(titulo)},\n    author: ${safeJson('De ' + autor)}\n  },\n`;
    capitulos.forEach((c, i) => {
        paginas += `  {\n    type: 'story',\n    pageNum: ${i + 1},\n    chapterTitle: ${safeJson(c.titulo)},\n    illustrationSrc: ${safeJson(c.ilustracion)},\n    voiceSrc: ${safeJson(c.voz || '')},\n    text: ${safeJson(c.texto)}\n  },\n`;
    });
    paginas += "  { type: 'end' }\n";

    const P = PLANTILLA;
    return [
        '<!DOCTYPE html>',
        '<html lang="es">',
        '<head>',
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">',
        `<title>${escapeHtml(titulo)}</title>`,
        '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Crimson+Text:ital@0;1&display=swap" rel="stylesheet">',
        '<style>', P.STORY_CSS, '</style>',
        '</head>',
        '<body>',
        aplicarI18n(P.STORY_BODY_HTML.replace(/__TITLE__/g, escapeHtml(titulo))),
        '<' + 'script>',
        `const MUSIC_SRC = ${safeJson(musica)};`,
        'const pages = [', paginas, '];',
        aplicarI18n(P.STORY_JS_ENGINE),
        '</' + 'script>',
        '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">',
        '<style>', P.BACK_BTN_CSS, '</style>',
        aplicarI18n(P.BACK_BTN_HTML),
        '<' + 'script>', aplicarI18n(P.BACK_BTN_JS), '</' + 'script>',
        '</body>',
        '</html>'
    ].join('\n');
}

// ───────────────────────── 7. PIPELINE POR TARJETA ─────────────────────────
async function crearStorycardCompleta({ tematica, titulo, enfoque, indice, idBase, marcaFecha }) {
    const slug = `ia${slugify(tematica)}${marcaFecha}${indice}`;
    console.log(`\n📖 Storycard ${indice}: "${titulo}"  (slug: ${slug})`);
    asegurarCarpeta(path.join(RAIZ, 'storycard', slug));

    const historia = await generarHistoria(tematica, titulo, enfoque, indice);
    const semilla = hashTexto(slug);
    const estilo = `storybook illustration, ${tematica.toLowerCase()} theme, soft cinematic lighting, harmonious palette, no text`;

    console.log('  🖼️  Creando portadas...');
    const portada = await crearImagen({ carpeta: slug, nombre: 'portada', prompt: `Book cover, ${titulo}, ${estilo}`, tematica, ancho: 768, alto: 768, semilla, usarIA: true });
    const portadaMovil = await crearImagen({ carpeta: slug, nombre: 'portadamovil', prompt: `Vertical book cover, ${titulo}, ${estilo}`, tematica, ancho: 576, alto: 1024, semilla: semilla + 7, usarIA: true });

    const capitulos = [];
    for (let i = 0; i < historia.capitulos.length; i++) {
        const c = historia.capitulos[i];
        console.log(`  📑 Capítulo ${i + 1}: ilustración y voz...`);
        const ilustracion = await crearImagen({
            carpeta: slug, nombre: `imagen${i + 1}`, tematica, ancho: 768, alto: 512, semilla: semilla + 100 + i,
            prompt: `${c.titulo}. ${c.texto.slice(0, 160)}. ${estilo}`, usarIA: true
        });
        const vozRel = `storycard/${slug}/voz${i + 1}.mp3`;
        const hayVoz = await crearVoz(c.texto, vozRel);
        capitulos.push({ ...c, ilustracion, voz: hayVoz ? vozRel : '' });
    }

    const musicaRel = `storycard/${slug}/musica.wav`;
    crearMusicaWav(musicaRel, tematica);

    const html = generarHtmlStory({ titulo, autor: AUTOR, coverImg: portada, coverMobileImg: portadaMovil, musica: musicaRel, capitulos });
    fs.writeFileSync(path.join(RAIZ, `${slug}.html`), html);
    console.log(`  ✅ Archivo creado: ${slug}.html`);

    return {
        id: idBase + indice,
        titulo,
        tematica,
        tipo: 'automatica-ia',
        descripcion: historia.sinopsis,
        imagen: portada,
        slug,
        storyPage: `${slug}.html`,
        audioVoz: capitulos.find(c => c.voz) ? capitulos.find(c => c.voz).voz : '',
        musicaFondo: musicaRel,
        fechaCreacion: new Date().toISOString()
    };
}

async function ejecutarPipelineInteligente() {
    console.log('1. Analizando estadísticas y ranking semanal...');
    const tematica = elegirTematicaGanadora();
    console.log(`> Predicción de IA: la temática ganadora es '${tematica}'.`);
    if (!ELEVEN_KEY) console.warn('⚠️  Falta el secreto ELEVENLABS_API_KEY: las storycards se crearán SIN narración de voz.');

    const ahora = new Date();
    const marcaFecha = ahora.toISOString().slice(0, 16).replace(/[-:T]/g, ''); // aaaammddhhmm
    const idBase = Date.now();

    const plan = [
        { titulo: `Especial Semanal: Los Secretos de ${tematica}`, enfoque: 'un misterio con pistas y un giro final' },
        { titulo: `Desafío Sonoro de ${tematica}`, enfoque: 'una aventura de ritmo rápido donde el sonido y la música guían al protagonista' }
    ];

    const nuevas = [];
    for (let i = 0; i < plan.length; i++) {
        try {
            nuevas.push(await crearStorycardCompleta({ tematica, ...plan[i], indice: i + 1, idBase, marcaFecha }));
        } catch (e) {
            console.error(`❌ Falló la storycard ${i + 1}:`, e);
        }
    }
    if (!nuevas.length) { console.error('No se pudo crear ninguna storycard.'); process.exit(1); }

    const rutaJson = path.join(RAIZ, 'data/storycards.json');
    asegurarCarpeta(path.dirname(rutaJson));
    let actual = [];
    try { if (fs.existsSync(rutaJson)) actual = JSON.parse(fs.readFileSync(rutaJson, 'utf8')); }
    catch (e) { console.warn('storycards.json ilegible, lo reinicio:', e.message); }
    fs.writeFileSync(rutaJson, JSON.stringify([...nuevas, ...actual], null, 2));
    console.log(`\n🎉 Pipeline completado: ${nuevas.length} storycard(s) nuevas.`);
}

ejecutarPipelineInteligente();
