/**
 * Robot semanal de Storycards (GitHub Actions)
 * ------------------------------------------------------------------
 * Cada ejecución escribe 2 historias ÉPICAS originales con Gemini y las
 * convierte en storycards completas:
 *   - <slug>.html                    → libro interactivo
 *   - imagenportada/<slug>_16_9.*    → imagen de presentación en formato 16:9
 *   - storycard/<slug>/portada.*     → portada cuadrada 1:1
 *   - storycard/<slug>/portadamovil.*→ portada vertical 9:16
 *   - storycard/<slug>/imagenN.*     → ilustración de cada capítulo
 *   y las registra en data/storycards.json para que reproductor.html las muestre.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ───────────────────────── CONFIGURACIÓN ─────────────────────────
const RAIZ = path.join(__dirname, '..');
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || '';
const NUM_CAPITULOS = Math.max(3, Math.min(10, parseInt(process.env.NUM_CAPITULOS || '10', 10)));
const PALABRAS_CAPITULO = Math.max(80, Math.min(400, parseInt(process.env.PALABRAS_CAPITULO || '250', 10)));
const POLLINATIONS_KEY = process.env.POLLINATIONS_API_KEY || '';
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const PIPER_BIN = process.env.PIPER_BIN || '';
const PIPER_MODEL = process.env.PIPER_MODEL || '';
const AUTOR = 'LaIAmusical';

const PLANTILLA = JSON.parse(fs.readFileSync(path.join(__dirname, 'plantilla_story.json'), 'utf8'));

const TEMAS = [
    {
        nombre: 'Literatura', alias: ['LITERATURA', 'LIBROS', 'LIBRO', 'NOVELA'],
        formato: 'una novela épica condensada, con prosa literaria cuidada, voz de narrador y personajes profundos',
        estilo: 'epic fantasy book illustration, oil painting, dramatic light',
        semillas: ['un viaje iniciático a través de un imperio en ruinas', 'una dinastía marcada por una profecía que todos malinterpretan', 'una bibliotecaria que descubre que un libro prohibido reescribe el destino', 'una guerra entre dos reinos que termina por un secreto de familia', 'un navegante que persigue una isla que solo aparece una noche cada siglo']
    },
    {
        nombre: 'Cine', alias: ['CINE', 'PELICULA', 'PELICULAS', 'FILM'],
        formato: 'el argumento de una superproducción cinematográfica narrado escena a escena, con ritmo de cine, imágenes potentes y un clímax espectacular',
        estilo: 'cinematic film still, epic widescreen, dramatic lighting, movie poster aesthetic',
        semillas: ['un atraco imposible durante la caída de un imperio', 'un piloto atrapado en una misión que cambia la historia de su país', 'una expedición a una ciudad sumergida que guarda un arma olvidada', 'un detective en una ciudad que se hunde bajo la lluvia eterna', 'una carrera a contrarreloj para salvar una ciudad de un colapso']
    },
    {
        nombre: 'Animación', alias: ['ANIMACION', 'ANIMACIÓN', 'ANIMADA', 'DIBUJOS'],
        formato: 'una película animada épica y emotiva para todos los públicos, con humor, ternura, criaturas fantásticas y un mensaje que conmueve',
        estilo: 'colorful animated feature film concept art, lush painterly, whimsical, warm light',
        semillas: ['un zorro mensajero que debe devolver la luz a un bosque dormido', 'una niña y un dragón de papel que cruzan el mar de las nubes', 'un robot jardinero que protege la última semilla de un mundo gris', 'una ciudad de juguetes que despierta cuando cae la noche', 'un pequeño faro vivo que guía a las ballenas a casa']
    },
    {
        nombre: 'Series', alias: ['SERIES', 'SERIE', 'TV'],
        formato: 'la temporada de una gran serie dramática: cada capítulo es un episodio con su propio gancho, giros, varios personajes con arcos propios y un cliffhanger final',
        estilo: 'prestige tv series key art, moody cinematic lighting, ensemble cast silhouette, dramatic',
        semillas: ['una familia de contrabandistas en una frontera en guerra', 'un equipo de científicos aislados en una estación polar que descubre algo bajo el hielo', 'una ciudad gobernada por tres casas rivales y un traidor entre ellas', 'una médica forense que investiga muertes impossibles en un pueblo minero', 'una tripulación de una nave de carga que hereda un mapa de una civilización perdida']
    },
    {
        nombre: 'Ópera y conciertos', alias: ['OPERA', 'ÓPERA', 'CONCIERTOS', 'CONCIERTO', 'OPERA Y CONCIERTOS', 'ÓPERA Y CONCIERTOS', 'MUSICA'],
        formato: 'una ópera o un gran concierto narrados como relato: estructura en actos, arias y coros descritos con emoción, orquesta, pasiones desbordadas y un final trágico o sublime',
        estilo: 'grand opera house, baroque dramatic painting, golden light, orchestra, chiaroscuro',
        semillas: ['una soprano condenada a cantar la última aria de un reino que se derrumba', 'un violinista que hace un pacto para tocar una sinfonía que nadie debe oír completa', 'un director de orquesta que descubre que su partitura predice una tragedia', 'dos casas rivales de ópera enfrentadas la noche del estreno de una obra maldita', 'un concierto en una catedral que se convierte en el último acto de un reino']
    },
    {
        nombre: 'Teatro y musicales', alias: ['TEATRO', 'MUSICALES', 'MUSICAL', 'TEATRO Y MUSICALES'],
        formato: 'una obra de teatro o un musical narrados en actos, con diálogos memorables, números musicales descritos con vida, escenografía y emoción de patio de butacas',
        estilo: 'theatre stage production, spotlight, red velvet curtains, dramatic stage design, painterly',
        semillas: ['una compañía ambulante que representa una obra que empieza a hacerse realidad', 'un teatro abandonado cuyos fantasmas piden un último estreno', 'un joven apuntador que descubre que el guion de la obra es una carta de amor del siglo pasado', 'un musical sobre una revolución que se canta desde un balcón', 'una actriz que debe elegir entre el papel de su vida y la verdad']
    },
    {
        nombre: 'Documentales y usuarios', alias: ['DOCUMENTALES', 'DOCUMENTAL', 'EXTRA Y DOCUMENTALES', 'DOCUMENTALES Y USUARIOS'],
        formato: 'un documental narrado de tono épico sobre un asunto FICTICIO (personajes, lugares y hechos inventados, sin relación con personas ni sucesos reales), con voz de narrador, entrevistas imaginadas y un descubrimiento final',
        estilo: 'epic nature and expedition documentary photography, dramatic landscape, golden hour, cinematic',
        semillas: ['la expedición imaginaria a una cordillera donde el eco responde con voces antiguas', 'el último guardián de un archivo submarino de mapas perdidos', 'la historia de un río ficticio que cambió de curso y con él, el destino de tres pueblos', 'una orquesta de ballenas y el científico que tardó veinte años en comprenderla', 'el inventor de una ciudad flotante que nunca llegó a verla terminada']
    }
];

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
    t = t.replace(/^["“„'‘’«»]+\s*/, '').replace(/\s*["“„'‘’«»]+$/, '');
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

const sinAcentos = t => (t || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

function temaPorNombre(texto) {
    const n = sinAcentos(texto);
    if (!n) return null;
    return TEMAS.find(t => sinAcentos(t.nombre) === n || t.alias.some(a => sinAcentos(a) === n)) || null;
}

function leerJson(ruta, defecto) {
    try { if (fs.existsSync(ruta)) return JSON.parse(fs.readFileSync(ruta, 'utf8')); }
    catch (e) { console.warn(`${path.basename(ruta)} ilegible:`, e.message); }
    return defecto;
}

function elegirTematicas(historial) {
    const ranking = leerJson(path.join(RAIZ, 'data/ranking_semanal.json'), []);
    const puntos = {};
    ranking.forEach(u => {
        const tema = temaPorNombre(u.tematicaFavorita);
        if (tema) puntos[tema.nombre] = (puntos[tema.nombre] || 0) + (u.puntuacion || 1);
    });
    const ganadora = Object.keys(puntos).sort((a, b) => puntos[b] - puntos[a])[0];

    const ultima = {};
    historial.forEach(c => {
        const t = temaPorNombre(c.tematica);
        const f = Date.parse(c.fechaCreacion || '') || Number(c.id) || 0;
        if (t) ultima[t.nombre] = Math.max(ultima[t.nombre] || 0, f);
    });
    const rotacion = [...TEMAS].sort((a, b) => ((ultima[a.nombre] || 0) - (ultima[b.nombre] || 0)) || (hashTexto(a.nombre + Date.now()) % 3) - 1);

    const primera = TEMAS.find(t => t.nombre === ganadora) || rotacion[0];
    const segunda = rotacion.find(t => t.nombre !== primera.nombre);
    console.log(`> Temática ganadora del ranking: ${ganadora || '(sin datos válidos)'}`);
    return [primera, segunda];
}

// ───────────────────────── 2. GEMINI PROMPT Y TEXTO ─────────────────────────
let modelosGemini = null;
const modelosFallidos = new Set();

function ordenarModelos(nombres) {
    const excluir = /(tts|embedding|image|live|audio|vision|robotics|computer|customtools|deep-research|gemma|nano|aqa)/;
    const puntuar = n => {
        if (/^gemini-flash-latest$/.test(n)) return 10000;
        const m = n.match(/^gemini-(\d+(?:\.\d+)?)-(flash|flash-lite|pro)(.*)$/);
        if (!m) return -1;
        let p = parseFloat(m[1]) * 100;
        if (m[2] === 'flash-lite') p -= 40;
        if (m[2] === 'pro') p -= 80;
        if (/preview|exp/.test(m[3])) p -= 5;
        return p;
    };
    return [...new Set(nombres)]
        .filter(n => n.startsWith('gemini') && !excluir.test(n) && puntuar(n) >= 0)
        .sort((a, b) => puntuar(b) - puntuar(a))
        .slice(0, 6);
}

async function listarModelosGemini() {
    if (GEMINI_MODEL) return [GEMINI_MODEL];
    if (modelosGemini) return modelosGemini;
    try {
        const res = await fetchConTimeout('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
            { headers: { 'x-goog-api-key': GEMINI_KEY } }, 30000);
        const datos = await res.json();
        if (!res.ok) throw new Error(datos.error?.message || `HTTP ${res.status}`);
        const disponibles = (datos.models || [])
            .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
            .map(m => String(m.name || '').replace(/^models\//, ''));
        modelosGemini = ordenarModelos(disponibles);
        if (!modelosGemini.length) throw new Error('la clave no ve ningún modelo Gemini de texto utilizable');
    } catch (e) {
        modelosGemini = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
    }
    return modelosGemini;
}

async function pedirGemini(prompt) {
    const modelos = await listarModelosGemini();
    const errores = [];
    const candidatos = modelos.filter(m => !modelosFallidos.has(m));
    for (const modelo of (candidatos.length ? candidatos : modelos)) {
        try {
            const res = await fetchConTimeout(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 1.0, maxOutputTokens: 16384, responseMimeType: 'application/json' }
                    })
                }, 240000);
            const datos = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(`HTTP ${res.status} ${datos.error?.status || ''} ${datos.error?.message || ''}`.trim());
            const texto = (datos.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
            if (!texto) throw new Error(`respuesta sin texto`);
            console.log(`  (modelo usado: ${modelo})`);
            return texto;
        } catch (e) {
            errores.push(`${modelo}: ${e.message}`);
            if (/HTTP (401|403|404)/.test(e.message)) modelosFallidos.add(modelo);
            if (/API_KEY_INVALID|API key not valid|API key expired/i.test(e.message)) break;
        }
    }
    const error = new Error('ningún modelo Gemini respondió. ' + errores.join(' || '));
    error.claveInvalida = /API_KEY_INVALID|API key not valid|API key expired/i.test(errores.join(' '));
    throw error;
}

function parseJsonSuelto(raw) {
    if (!raw) return null;
    const t = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try { return JSON.parse(t); } catch (e) { /* sigue */ }
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* sigue */ } }
    return null;
}

function validarHistoria(j) {
    if (!j || typeof j !== 'object') return 'no es un JSON';
    const titulo = stripWrappingQuotes(String(j.titulo || ''));
    if (titulo.length < 4 || titulo.length > 90) return 'título inválido';
    if (!Array.isArray(j.capitulos) || j.capitulos.length < NUM_CAPITULOS) return `faltan capítulos (${(j.capitulos || []).length}/${NUM_CAPITULOS})`;
    const minimo = Math.round(PALABRAS_CAPITULO * 0.45);
    for (let i = 0; i < NUM_CAPITULOS; i++) {
        const t = String(j.capitulos[i]?.texto || '');
        if (t.split(/\s+/).length < minimo) return `el capítulo ${i + 1} es demasiado corto`;
    }
    return null;
}

async function escribirHistoria(tema, usados) {
    const semilla = tema.semillas[Math.floor(Math.random() * tema.semillas.length)];
    const prompt = [
        `Eres un autor galardonado de historias épicas. Escribe en ESPAÑOL una historia ORIGINAL para la sala «${tema.nombre}» de una biblioteca de storycards.`,
        `Formato: ${tema.formato}.`,
        `Punto de partida (puedes reinventarlo): ${semilla}.`,
        '',
        'REGLAS:',
        '- TÍTULO: un título propio y memorable, con un NOMBRE PROPIO inventado (de personaje, lugar, reino, nave, obra…) ligado a la trama. Máximo 8 palabras.',
        `- Exactamente ${NUM_CAPITULOS} capítulos de unas ${PALABRAS_CAPITULO} palabras cada uno.`,
        usados.length ? `- Títulos ya usados (NO repetir ni imitar): ${usados.slice(0, 20).join(' | ')}.` : '',
        '',
        'Responde SOLO con JSON válido con esta forma exacta:',
        '{"titulo":"…","sinopsis":"2 frases atractivas, máx. 45 palabras","portada_en":"visual description in English of the cover art, no text, no letters","capitulos":[{"titulo":"título breve","texto":"…","escena_en":"visual description in English of this chapter\'s key scene"}]}'
    ].filter(Boolean).join('\n');

    let motivo = '';
    for (let intento = 1; intento <= 3; intento++) {
        try {
            const raw = await pedirGemini(prompt);
            const json = parseJsonSuelto(raw);
            motivo = validarHistoria(json);
            if (!motivo) return json;
        } catch (e) {
            motivo = e.message;
            if (e.claveInvalida) throw e;
        }
        await dormir(3000 * intento);
    }
    throw new Error(`Gemini no devolvió una historia válida (${motivo})`);
}

// ───────────────────────── 3. GENERACIÓN DE IMÁGENES (16:9, 1:1, 9:16) ─────────────────────────
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

function crearSvg(tematica, semilla, ancho, alto, pistas = '') {
    const rnd = mulberry32(semilla);
    const W = ancho, H = alto;
    const base = matices(tematica);
    const hue = base[Math.floor(rnd() * 3)];
    const hsl = (h, s, l) => `hsl(${Math.round(((h % 360) + 360) % 360)},${s}%,${l}%)`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${hsl(hue, 50, 15)}"/><circle cx="${W/2}" cy="${H/2}" r="${Math.min(W,H)*0.3}" fill="${hsl(hue+40, 70, 50)}" opacity="0.5"/></svg>`;
}

function detectarImagen(buf) {
    if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
    if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8) return 'jpg';
    if (buf.length > 12 && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
    return null;
}

async function imagenCloudflare(prompt) {
    if (!CF_ACCOUNT_ID || !CF_API_TOKEN) return null;
    for (let intento = 1; intento <= 3; intento++) {
        try {
            const res = await fetchConTimeout(
                `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
                { method: 'POST', headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: prompt.slice(0, 1900), steps: 6 }) }, 90000);
            const tipo = res.headers.get('content-type') || '';
            let buf;
            if (tipo.startsWith('image/')) buf = Buffer.from(await res.arrayBuffer());
            else {
                const datos = await res.json().catch(() => ({}));
                if (!res.ok || datos.success === false) throw new Error(`HTTP ${res.status}`);
                const b64 = datos.result?.image || datos.image;
                if (!b64) throw new Error('respuesta sin imagen');
                buf = Buffer.from(b64, 'base64');
            }
            const ext = detectarImagen(buf);
            if (!ext || buf.length < 5000) throw new Error('imagen no válida');
            return { buf, ext };
        } catch (e) {
            if (/401|403/i.test(e.message)) return null;
            await dormir(2500 * intento);
        }
    }
    return null;
}

async function imagenPollinations(prompt, ancho, alto, semilla) {
    if (!POLLINATIONS_KEY) return null;
    try {
        const url = 'https://gen.pollinations.ai/image/' + encodeURIComponent(prompt.slice(0, 1500)) +
            `?model=flux&width=${ancho}&height=${alto}&seed=${semilla}&nologo=true&key=${encodeURIComponent(POLLINATIONS_KEY)}`;
        const res = await fetchConTimeout(url, {}, 90000);
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = detectarImagen(buf);
        if (!res.ok || !ext || buf.length < 5000) throw new Error(`HTTP ${res.status}`);
        return { buf, ext };
    } catch (e) { return null; }
}

async function crearImagenEnRuta({ rutaRelativa, prompt, tematica, ancho, alto, semilla, pistas }) {
    const rutaAbsoluta = path.join(RAIZ, rutaRelativa);
    asegurarCarpeta(path.dirname(rutaAbsoluta));
    const ia = (await imagenCloudflare(prompt)) || (await imagenPollinations(prompt, ancho, alto, semilla));
    if (ia) {
        const rutaFinal = `${rutaRelativa}.${ia.ext}`;
        fs.writeFileSync(path.join(RAIZ, rutaFinal), ia.buf);
        return { ruta: rutaFinal, ia: true };
    }
    const rutaFinal = `${rutaRelativa}.svg`;
    fs.writeFileSync(path.join(RAIZ, rutaFinal), crearSvg(tematica, semilla, ancho, alto, pistas));
    return { ruta: rutaFinal, ia: false };
}

// ───────────────────────── 4. VOZ (PIPER) ─────────────────────────
function textoParaNarrar(titulo, texto) {
    const t = (titulo || '').replace(/\s*[—–-]\s*/g, '. ').replace(/\.+\s*$/, '.');
    const cuerpo = texto.replace(/\r/g, '').split(/\n+/).map(l => l.trim()).filter(Boolean).join('\n');
    return `${t}\n${cuerpo}\n`;
}

function crearVoz(titulo, texto, rutaRel) {
    if (!PIPER_BIN || !PIPER_MODEL || !fs.existsSync(PIPER_BIN) || !fs.existsSync(PIPER_MODEL)) return false;
    const wav = path.join(RAIZ, rutaRel.replace(/\.wav$/, '.tmp.wav'));
    const finalWav = path.join(RAIZ, rutaRel);
    try {
        const env = { ...process.env, LD_LIBRARY_PATH: `${path.dirname(PIPER_BIN)}:${process.env.LD_LIBRARY_PATH || ''}` };
        const p = spawnSync(PIPER_BIN, ['-m', PIPER_MODEL, '-f', wav, '--length_scale', '1.08', '--sentence_silence', '0.5', '-q'],
            { input: textoParaNarrar(titulo, texto), cwd: path.dirname(PIPER_BIN), env, timeout: 180000, encoding: 'utf8' });
        if (p.status !== 0 || !fs.existsSync(wav)) throw new Error(`Piper error`);
        fs.renameSync(wav, finalWav);
        return true;
    } catch (e) {
        return false;
    } finally {
        try { if (fs.existsSync(wav)) fs.unlinkSync(wav); } catch (e) {}
    }
}

// ───────────────────────── 5. HTML GENERATOR ─────────────────────────
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

// ───────────────────────── 6. PIPELINE ─────────────────────────
function slugUnico(titulo) {
    const base = slugify(titulo) || 'historia';
    let slug = base, n = 1;
    while (fs.existsSync(path.join(RAIZ, `${slug}.html`)) || fs.existsSync(path.join(RAIZ, 'storycard', slug))) {
        n++; slug = `${base}ia${n}`;
    }
    return slug;
}

async function crearStorycardCompleta({ tema, usados, idBase, indice }) {
    console.log(`\n📖 Storycard ${indice} · sala «${tema.nombre}»`);
    console.log('  ✍️  Gemini está escribiendo la historia épica...');
    const hist = await escribirHistoria(tema, usados);
    const titulo = stripWrappingQuotes(String(hist.titulo)).replace(/\s+/g, ' ');
    const slug = slugUnico(titulo);
    console.log(`  🏷️  Título: "${titulo}"  (slug: ${slug})`);

    // Aseguramos la carpeta de destino para la presentación 16:9 -> imagenportada/
    asegurarCarpeta(path.join(RAIZ, 'imagenportada'));
    asegurarCarpeta(path.join(RAIZ, 'storycard', slug));

    const semilla = hashTexto(slug);
    const estilo = `${tema.estilo}, highly detailed, dramatic composition, volumetric light, no text, no letters, no watermark`;
    const promptPortada = `${hist.portada_en || titulo}. ${estilo}`;
    const pistasPortada = `${hist.portada_en || ''} ${titulo} ${hist.sinopsis || ''}`;

    console.log('  🖼️  Creando las 3 imágenes de presentación (16:9 en imagenportada, 1:1, 9:16)...');
    
    // 1. Imagen 16:9 -> alojada en imagenportada/
    const r169 = await crearImagenEnRuta({
        rutaRelativa: `imagenportada/${slug}_16_9`,
        prompt: promptPortada, tematica: tema.nombre, ancho: 1280, alto: 720, semilla, pistas: pistasPortada
    });

    // 2. Imagen 1:1 (portada) -> alojada en storycard/<slug>/portada
    const rPortada = await crearImagenEnRuta({
        rutaRelativa: `storycard/${slug}/portada`,
        prompt: promptPortada, tematica: tema.nombre, ancho: 768, alto: 768, semilla, pistas: pistasPortada
    });

    // 3. Imagen 9:16 (portadamovil) -> alojada en storycard/<slug>/portadamovil
    const rMovil = await crearImagenEnRuta({
        rutaRelativa: `storycard/${slug}/portadamovil`,
        prompt: promptPortada, tematica: tema.nombre, ancho: 576, alto: 1024, semilla: semilla + 7, pistas: pistasPortada
    });

    const capitulos = [];
    const audiosPendientes = [];
    let vocesOk = 0;

    for (let i = 0; i < NUM_CAPITULOS; i++) {
        const c = hist.capitulos[i];
        const tituloCap = tituloCorto(c.titulo, i), textoCap = limpiarTextoCapitulo(c.texto);
        console.log(`  📑 Capítulo ${i + 1}: ilustración y voz...`);
        
        const rIlu = await crearImagenEnRuta({
            rutaRelativa: `storycard/${slug}/imagen${i + 1}`,
            tematica: tema.nombre, ancho: 768, alto: 512, semilla: semilla + 100 + i,
            prompt: `${c.escena_en || c.titulo}. ${estilo}`, pistas: `${c.escena_en || ''} ${c.titulo || ''} ${textoCap.slice(0, 300)}`
        });
        
        // Asignación explícita del formato .wav para la voz
        const voz = `storycard/${slug}/voz${i + 1}.wav`;
        if (crearVoz(tituloCap, textoCap, voz)) vocesOk++; else audiosPendientes.push(voz);
        capitulos.push({ titulo: tituloCap, texto: textoCap, ilustracion: rIlu.ruta, voz });
    }

    const musica = `${slug}.mp3`;
    audiosPendientes.push(musica);

    const html = generarHtmlStory({
        titulo, autor: AUTOR, coverImg: rPortada.ruta, coverMobileImg: rMovil.ruta, musica, capitulos
    });
    fs.writeFileSync(path.join(RAIZ, `${slug}.html`), html);
    console.log(`  ✅ Archivo creado: ${slug}.html`);

    return {
        tarjeta: {
            id: idBase + indice,
            titulo,
            tematica: tema.nombre,
            tipo: 'automatica-ia',
            descripcion: String(hist.sinopsis || '').trim(),
            imagen: r169.ruta,               // Presentación 16:9 apuntando a imagenportada/
            portada: rPortada.ruta,          // Portada 1:1
            portadaMovil: rMovil.ruta,       // Portada 9:16
            slug,
            storyPage: `${slug}.html`,
            audioVoz: capitulos[0].voz,
            musicaFondo: musica,
            fechaCreacion: new Date().toISOString()
        },
        audiosPendientes
    };
}

async function ejecutarPipelineInteligente() {
    if (!GEMINI_KEY) {
        console.error('❌ Falta el secreto GEMINI_API_KEY en GitHub Secrets.');
        process.exit(1);
    }
    const rutaJson = path.join(RAIZ, 'data/storycards.json');
    asegurarCarpeta(path.dirname(rutaJson));
    const actual = leerJson(rutaJson, []);
    const usados = actual.map(c => c.titulo).filter(Boolean);

    console.log('1. Eligiendo temáticas...');
    const temas = elegirTematicas(actual);
    console.log(`> Salas de esta semana: ${temas.map(t => t.nombre).join(' + ')}`);

    const idBase = Date.now();
    const nuevas = [], pendientes = [];
    for (let i = 0; i < temas.length; i++) {
        try {
            const r = await crearStorycardCompleta({ tema: temas[i], usados: [...usados, ...nuevas.map(n => n.titulo)], idBase, indice: i + 1 });
            nuevas.push(r.tarjeta);
            pendientes.push({ titulo: r.tarjeta.titulo, archivos: r.audiosPendientes });
        } catch (e) {
            console.error(`❌ Falló la storycard ${i + 1}: ${e.message}`);
            if (e.claveInvalida) break;
        }
    }
    if (!nuevas.length) { console.error('No se pudo crear ninguna storycard.'); process.exit(1); }

    fs.writeFileSync(rutaJson, JSON.stringify([...nuevas, ...actual], null, 2));

    const rutaPend = path.join(RAIZ, 'data/audios_pendientes.md');
    const previo = fs.existsSync(rutaPend) ? fs.readFileSync(rutaPend, 'utf8') : '# Audios pendientes de subir\n\n';
    const fecha = new Date().toISOString().slice(0, 10);
    const bloque = pendientes.map(p => `\n## ${p.titulo} (${fecha})\n${p.archivos.map(a => `- [ ] \`${a}\``).join('\n')}\n`).join('');
    fs.writeFileSync(rutaPend, previo + bloque);

    console.log('\n🎉 Pipeline completado con éxito.');
}

ejecutarPipelineInteligente().catch(e => { console.error('❌ Error inesperado:', e); process.exit(1); });
