/**
 * Robot semanal de Storycards (GitHub Actions)
 * ------------------------------------------------------------------
 * Cada ejecución escribe 2 historias ÉPICAS originales con Gemini y las
 * convierte en storycards completas (Español e Inglés), con:
 *   - <slug>.html                    → libro interactivo ES
 *   - <slug>-en.html                 → libro interactivo EN
 *   - imagenportada/<slug>.jpg       → imagen de presentación panorámica 16:9 EXACTA
 *   - storycard/<slug>/portada.jpg   → portada cuadrada 1:1 EXACTA
 *   - storycard/<slug>/portadamovil.jpg→ portada vertical 9:16 EXACTA
 *   - storycard/<slug>/imagenN.jpg   → ilustración de cada capítulo (16:9)
 *   - secretos/<slug>-secretos.html  → Página de Secretos (ES/EN en el mismo archivo)
 *   - quiz (5 preguntas) y quizEn guardados en data/storycards.json
 *   y las registra en data/storycards.json para que reproductor.html las muestre.
 *
 * IMPORTANTE: si ffmpeg no está instalado o falla, el script aborta.
 * El robot NUNCA guarda una imagen que no sea exactamente 16:9, 1:1 o 9:16.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

// ───────────────────────── CONFIGURACIÓN ─────────────────────────
const RAIZ = path.join(__dirname, '..');
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || '';
const NUM_CAPITULOS = Math.max(3, Math.min(10, parseInt(process.env.NUM_CAPITULOS || '10', 10)));
const PALABRAS_CAPITULO = Math.max(80, Math.min(400, parseInt(process.env.PALABRAS_CAPITULO || '250', 10)));
const POLLINATIONS_KEY = process.env.POLLINATIONS_API_KEY || '';
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const EDGE_VOICE = process.env.EDGE_VOICE || 'es-ES-AlvaroNeural';
const EDGE_VOICE_EN = process.env.EDGE_VOICE_EN || 'en-US-GuyNeural';
const EDGE_RATE = process.env.EDGE_RATE || '-5%';
const EDGE_PYTHON = process.env.EDGE_PYTHON || 'python3';
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
        semillas: ['una familia de contrabandistas en una frontera en guerra', 'un equipo de científicos aislados en una estación polar que descubre algo bajo el hielo', 'una ciudad gobernada por tres casas rivales y un traidor entre ellas', 'una médica forense que investiga muertes imposibles en un pueblo minero', 'una tripulación de una nave de carga que hereda un mapa de una civilización perdida']
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
    let t = stripWrappingQuotes((raw || '').replace(/\r/g, '').replace(/^#{1,6}\s+/, '').replace(/\*{1,3}|\*{1,3}$/g, '').trim());
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
    if (!j.es || !j.en) return 'faltan versiones es/en';

    const titulo = stripWrappingQuotes(String(j.es.titulo || ''));
    if (titulo.length < 4 || titulo.length > 90) return 'título ES inválido';

    const tituloEn = stripWrappingQuotes(String(j.en.titulo || ''));
    if (tituloEn.length < 4 || tituloEn.length > 90) return 'título EN inválido';

    if (!Array.isArray(j.es.capitulos) || j.es.capitulos.length < NUM_CAPITULOS) return `faltan capítulos ES (${(j.es.capitulos || []).length}/${NUM_CAPITULOS})`;
    if (!Array.isArray(j.en.capitulos) || j.en.capitulos.length < NUM_CAPITULOS) return `faltan capítulos EN (${(j.en.capitulos || []).length}/${NUM_CAPITULOS})`;

    const minimo = Math.round(PALABRAS_CAPITULO * 0.45);
    for (let i = 0; i < NUM_CAPITULOS; i++) {
        const tEs = String(j.es.capitulos[i]?.texto || '');
        if (tEs.split(/\s+/).length < minimo) return `el capítulo ES ${i + 1} es demasiado corto`;
        const tEn = String(j.en.capitulos[i]?.texto || '');
        if (tEn.split(/\s+/).length < minimo) return `el capítulo EN ${i + 1} es demasiado corto`;
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
        '- FRASE DE INSPIRACIÓN: Una frase poética, inspiradora o enigmática que defina el tema de la historia (máx. 12 palabras).',
        `- Exactamente ${NUM_CAPITULOS} capítulos de unas ${PALABRAS_CAPITULO} palabras cada uno.`,
        usados.length ? `- Títulos ya usados (NO repetir ni imitar): ${usados.slice(0, 20).join(' | ')}.` : '',
        '',
        'Además, proporciona la traducción al INGLÉS de la historia completa (título, frase, sinopsis y capítulos).',
        '',
        'Responde SOLO con JSON válido con esta forma exacta:',
        '{"portada_en":"visual description in English of the cover art, no text, no letters","escenas_en":["visual description in English of chapter 1 key scene", "..."],"es":{"titulo":"…","fraseInspiracion":"…","sinopsis":"2 frases atractivas, máx. 45 palabras","capitulos":[{"titulo":"título breve","texto":"…"}]},"en":{"titulo":"…","fraseInspiracion":"…","sinopsis":"2 frases atractivas, máx. 45 palabras","capitulos":[{"titulo":"título breve","texto":"…"}]}}'
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

// ───────────────────────── 3. IMÁGENES (ffmpeg obligatorio) ─────────────────────────
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
function rgbHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = s / 100; l = l / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    const to = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return to(r) + to(g) + to(b);
}

function verificarFfmpeg() {
    const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
    if (r.status !== 0) {
        throw new Error(
            '❌ ffmpeg NO está instalado o no es accesible en el PATH. ' +
            'Sin ffmpeg el robot no puede garantizar imágenes 16:9/1:1/9:16. ' +
            'Añade el paso "Instalar ffmpeg" al workflow (generacion_semanal.yml) ' +
            'o instala ffmpeg en tu sistema y vuelve a ejecutar.'
        );
    }
}

function detectarImagen(buf) {
    if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
    if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8) return 'jpg';
    if (buf.length > 12 && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
    return null;
}

let cloudflareAgotado = false;
let imagenesIA = 0;

async function imagenCloudflare(prompt) {
    if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
        if (!imagenCloudflare.avisado) {
            console.log('  ⚠️ Cloudflare no configurado (faltan CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN).');
            imagenCloudflare.avisado = true;
        }
        return null;
    }
    if (cloudflareAgotado) return null;
    for (let intento = 1; intento <= 3; intento++) {
        try {
            const res = await fetchConTimeout(
                `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
                {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: prompt.slice(0, 1900), steps: 4 })
                }, 90000);

            const tipo = res.headers.get('content-type') || '';
            let buf;
            if (tipo.startsWith('image/')) {
                buf = Buffer.from(await res.arrayBuffer());
            } else {
                const datos = await res.json().catch(() => ({}));
                if (!res.ok || datos.success === false) {
                    throw new Error(`HTTP ${res.status} - ${JSON.stringify(datos.errors || datos.error || 'Error desconocido')}`);
                }
                const b64 = datos.result?.image || datos.image;
                if (!b64) throw new Error('Respuesta de Cloudflare sin datos de imagen');
                buf = Buffer.from(b64, 'base64');
            }
            const ext = detectarImagen(buf);
            if (!ext || buf.length < 5000) throw new Error('El buffer recibido no corresponde a una imagen válida');
            return { buf, ext };
        } catch (e) {
            console.warn(`  ⚠️ Falló Cloudflare (intento ${intento}): ${e.message}`);
            if (/HTTP 429|4006|daily free allocation|neurons|quota|rate limit/i.test(e.message)) {
                cloudflareAgotado = true;
                console.error('  ❌ CUOTA DIARIA DE CLOUDFLARE AGOTADA. Se usará Pollinations + ffmpeg para las imágenes.');
                return null;
            }
            if (/HTTP (401|403)/i.test(e.message)) {
                cloudflareAgotado = true;
                console.error('  ❌ Error de autenticación con Cloudflare. Se usará Pollinations + ffmpeg.');
                return null;
            }
            await dormir(3000 * intento);
        }
    }
    return null;
}

async function imagenPollinations(prompt, ancho, alto, semilla) {
    if (!POLLINATIONS_KEY) return null;
    try {
        console.log('  🌸 Generando con Pollinations AI...');
        const url = 'https://gen.pollinations.ai/image/' + encodeURIComponent(prompt.slice(0, 1500)) +
            `?model=flux&width=${ancho}&height=${alto}&seed=${semilla}&nologo=true&key=${encodeURIComponent(POLLINATIONS_KEY)}`;
        const res = await fetchConTimeout(url, {}, 120000);
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = detectarImagen(buf);
        if (!res.ok || !ext || buf.length < 5000) throw new Error(`HTTP ${res.status}`);
        console.log('  ✅ Imagen generada con éxito mediante Pollinations.');
        return { buf, ext };
    } catch (e) {
        console.warn(`  ⚠️ Falló Pollinations: ${e.message}`);
        return null;
    }
}

function recortarAProporcion(buf, ext, ancho, alto) {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entrada = path.join(os.tmpdir(), `sc_in_${id}.${ext}`);
    const salida = path.join(os.tmpdir(), `sc_out_${id}.jpg`);
    try {
        fs.writeFileSync(entrada, buf);
        const A = (ancho / alto).toFixed(5);
        const filtro = `crop=w='min(iw,round(min(iw,ih*${A})/2)*2)':h='min(ih,round(min(ih,iw/${A})/2)*2)'`;
        const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', entrada, '-vf', filtro, '-q:v', '2', salida], { timeout: 60000, encoding: 'utf8' });
        if (r.status === 0 && fs.existsSync(salida)) {
            const out = fs.readFileSync(salida);
            if (out.length > 3000) return { buf: out, ext: 'jpg' };
        }
        const motivo = (r.stderr || r.error?.message || '').trim().slice(0, 300);
        throw new Error(`ffmpeg no pudo recortar la imagen a ${ancho}x${alto} (código ${r.status}). ${motivo}`);
    } finally {
        [entrada, salida].forEach(f => { try { fs.unlinkSync(f); } catch (e) { /* ya no existe */ } });
    }
}

function generarFondoFfmpeg(ancho, alto, tematica) {
    const [h1, h2] = matices(tematica);
    const c1 = `0x${rgbHex(h1, 60, 15)}`;
    const c2 = `0x${rgbHex(h2, 80, 55)}`;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const salida = path.join(os.tmpdir(), `sc_bg_${id}.jpg`);
    try {
        const filtro = `gradients=s=${ancho}x${alto}:c0=${c1}:c1=${c2}:x0=0:y0=0:x1=${ancho}:y1=${alto},format=yuv420p`;
        const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', filtro, '-frames:v', '1', '-q:v', '2', salida], { timeout: 60000, encoding: 'utf8' });
        if (r.status !== 0 || !fs.existsSync(salida)) {
            throw new Error(`ffmpeg no pudo generar fondo degradado (código ${r.status}): ${(r.stderr || '').slice(0, 200)}`);
        }
        return { buf: fs.readFileSync(salida), ext: 'jpg' };
    } finally {
        try { fs.unlinkSync(salida); } catch (e) { /* ya no existe */ }
    }
}

async function obtenerImagenIA(prompt, ancho, alto, semilla, tematica) {
    let base = await imagenCloudflare(prompt);
    if (!base) base = await imagenPollinations(prompt, ancho, alto, semilla);
    if (!base) {
        console.warn('  🔁 Reintentando Pollinations con semilla alternativa...');
        base = await imagenPollinations(prompt, ancho, alto, semilla + 7777);
    }
    if (!base) {
        console.warn('  🎨 Generando fondo degradado con ffmpeg (último recurso)...');
        base = generarFondoFfmpeg(ancho, alto, tematica);
    }
    return recortarAProporcion(base.buf, base.ext, ancho, alto);
}

function guardarImagen({ rutaRelativa, baseRecortada }) {
    const rutaAbsoluta = path.join(RAIZ, rutaRelativa);
    asegurarCarpeta(path.dirname(rutaAbsoluta));
    const rutaFinal = `${rutaRelativa}.${baseRecortada.ext}`;
    fs.writeFileSync(path.join(RAIZ, rutaFinal), baseRecortada.buf);
    return { ruta: rutaFinal, ia: true };
}

async function crearImagenEnRuta({ rutaRelativa, prompt, tematica, ancho, alto, semilla }) {
    const recortada = await obtenerImagenIA(prompt, ancho, alto, semilla, tematica);
    const r = guardarImagen({ rutaRelativa, baseRecortada: recortada });
    imagenesIA++;
    return r;
}

// ───────────────────────── 4. VOZ DEL NARRADOR ─────────────────────────
function textoParaNarrar(texto) {
    return (texto || '').replace(/\r/g, '').split(/\n+/).map(l => l.trim()).filter(Boolean).join('\n\n');
}

let edgeCaido = false;

async function crearVozEdge(texto, rutaRel, voz = EDGE_VOICE) {
    if (edgeCaido) return false;
    const mp3 = path.join(RAIZ, rutaRel);
    const txt = path.join(os.tmpdir(), `edge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.txt`);
    fs.writeFileSync(txt, textoParaNarrar(texto), 'utf8');
    let sinModulo = false;
    try {
        for (let intento = 1; intento <= 3; intento++) {
            const r = spawnSync(EDGE_PYTHON, ['-m', 'edge_tts', '--file', txt, '--voice', voz, `--rate=${EDGE_RATE}`, '--write-media', mp3, '--no-progress'],
                { timeout: 180000, encoding: 'utf8' });
            const ok = r.status === 0 && fs.existsSync(mp3) && fs.statSync(mp3).size > 2000;
            if (ok) return true;
            const motivo = ((r.stderr || '') + (r.error ? ' ' + r.error.message : '')).trim().split('\n').slice(-2).join(' | ').slice(0, 260);
            console.warn(`  ⚠️ Edge TTS (intento ${intento}/3): ${motivo || 'sin detalle (código ' + r.status + ')'}`);
            try { fs.unlinkSync(mp3); } catch (e) { /* no se llegó a crear */ }
            if (/No module named|ENOENT/i.test(motivo)) { sinModulo = true; break; }
            if (intento < 3) await dormir(4000 * intento);
        }
        edgeCaido = true;
        console.error(sinModulo
            ? '  ❌ El paquete edge-tts no está instalado en este servidor. Uso Piper como respaldo si está instalado.'
            : '  ❌ Edge TTS no responde desde este servidor. Uso Piper como respaldo si está instalado.');
        return false;
    } finally {
        try { fs.unlinkSync(txt); } catch (e) { /* ya no existe */ }
    }
}

function crearVozPiper(texto, rutaRel) {
    if (!PIPER_BIN || !PIPER_MODEL || !fs.existsSync(PIPER_BIN) || !fs.existsSync(PIPER_MODEL)) return false;
    const wav = path.join(RAIZ, rutaRel.replace(/\.mp3$/, '.tmp.wav'));
    const mp3 = path.join(RAIZ, rutaRel);
    try {
        const env = { ...process.env, LD_LIBRARY_PATH: `${path.dirname(PIPER_BIN)}:${process.env.LD_LIBRARY_PATH || ''}` };
        const p = spawnSync(PIPER_BIN, ['-m', PIPER_MODEL, '-f', wav, '--length_scale', '1.08', '--sentence_silence', '0.5', '-q'],
            { input: textoParaNarrar(texto).replace(/\n+/g, '\n'), cwd: path.dirname(PIPER_BIN), env, timeout: 180000, encoding: 'utf8' });
        if (p.status !== 0 || !fs.existsSync(wav)) throw new Error(`Piper terminó con código ${p.status}`);
        const f = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k', mp3], { timeout: 120000, encoding: 'utf8' });
        if (f.status !== 0 || !fs.existsSync(mp3)) throw new Error(`ffmpeg falló ${(f.stderr || '').slice(0, 160)}`);
        return true;
    } catch (e) {
        console.warn(`  ⚠️ Piper no pudo crear la voz: ${e.message}`);
        return false;
    } finally {
        try { fs.unlinkSync(wav); } catch (e) { /* ya no existe */ }
    }
}

async function crearVoz(texto, rutaRel, voz, lang) {
    if (await crearVozEdge(texto, rutaRel, voz)) return 'edge';
    if (lang === 'es' && crearVozPiper(texto, rutaRel)) return 'piper';
    return false;
}

// ───────────────────────── 5. HTML GENERATOR ─────────────────────────
function aplicarI18n(str, lang) {
    const t = PLANTILLA.STORY_I18N[lang || 'es'];
    let out = str;
    Object.keys(t).forEach(k => { out = out.split('§' + k + '§').join(t[k]); });
    return out;
}

function generarHtmlStory({ titulo, fraseInspiracion, autor, coverImg, coverMobileImg, musica, capitulos, lang }) {
    let paginas = `  {\n    type: 'cover',\n    coverImg: ${safeJson(coverImg)},\n    coverMobileImg: ${safeJson(coverMobileImg)},\n    title: ${safeJson(titulo)},\n    fraseInspiracion: ${safeJson(fraseInspiracion || '')},\n    author: ${safeJson('De ' + autor)}\n  },\n`;
    capitulos.forEach((c, i) => {
        paginas += `  {\n    type: 'story',\n    pageNum: ${i + 1},\n    chapterTitle: ${safeJson(c.titulo)},\n    illustrationSrc: ${safeJson(c.ilustracion)},\n    voiceSrc: ${safeJson(c.voz || '')},\n    text: ${safeJson(c.texto)}\n  },\n`;
    });
    paginas += "  { type: 'end' }\n";

    const P = PLANTILLA;
    return [
        '<!DOCTYPE html>',
        `<html lang="${lang || 'es'}">`,
        '<head>',
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">',
        `<title>${escapeHtml(titulo)}</title>`,
        '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Crimson+Text:ital@0;1&display=swap" rel="stylesheet">',
        '<style>', P.STORY_CSS, '</style>',
        '</head>',
        '<body>',
        aplicarI18n(P.STORY_BODY_HTML.replace(/__TITLE__/g, escapeHtml(titulo)), lang),
        '<' + 'script>',
        `const MUSIC_SRC = ${safeJson(musica)};`,
        'const pages = [', paginas, '];',
        aplicarI18n(P.STORY_JS_ENGINE, lang),
        '</' + 'script>',
        '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">',
        '<style>', P.BACK_BTN_CSS, '</style>',
        aplicarI18n(P.BACK_BTN_HTML, lang),
        '<' + 'script>', aplicarI18n(P.BACK_BTN_JS, lang), '</' + 'script>',
        '</body>',
        '</html>'
    ].join('\n');
}

// ───────────────────────── 5.1. GENERADOR DE SECRETOS ─────────────────────────
function generarSecretosHtml({ titulo, tituloEn, fraseInspiracion, fraseInspiracionEn, sinopsis, sinopsisEn, secretosEs, secretosEn, portadaImg }) {
    const translations = {
        es: {
            pageBadge: "LaIAmusical - Secretos",
            pageTitle: titulo,
            pageSubtitle: "Descubre los misterios ocultos y las revelaciones de esta historia. Haz clic en cualquier secreto para desvelar su trasfondo.",
            backButton: "Volver al Reproductor",
            modalClose: "Entendido",
            reveal: "Revelar secreto",
            secrets: secretosEs
        },
        en: {
            pageBadge: "The Musical AI - Secrets",
            pageTitle: tituloEn,
            pageSubtitle: "Discover the hidden mysteries and revelations of this story. Click any secret to reveal its background.",
            backButton: "Back to the Player",
            modalClose: "Got it",
            reveal: "Reveal secret",
            secrets: secretosEn
        }
    };
    const cardsEs = secretosEs.map((s, i) => `
        <div onclick="openSecretModal(${i + 1})" class="secret-card p-5 rounded-2xl cursor-pointer flex flex-col justify-between group">
            <div>
                <div class="w-10 h-10 rounded-xl ${s.colorClass} flex items-center justify-center mb-4 group-hover:text-white transition-colors">
                    <i class="fas ${s.icon} text-lg"></i>
                </div>
                <h3 class="font-bold text-lg text-purple-200 mb-2 group-hover:text-white transition-colors">${s.title}</h3>
                <p class="text-sm text-gray-300/80 line-clamp-3">${s.text}</p>
            </div>
            <div class="mt-4 text-xs font-semibold text-purple-400 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                <span>Revelar secreto</span> <i class="fas fa-arrow-right text-[10px]"></i>
            </div>
        </div>`).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Secretos: ${titulo}</title>
<script src="https://cdn.tailwindcss.com"><\/script>
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
<h1 id="pageTitle" class="text-3xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-purple-300 via-pink-200 to-indigo-200 drop-shadow-sm">${titulo}</h1>
<p id="pageSubtitle" class="text-purple-200/70 mt-2 text-sm md:text-base max-w-xl mx-auto">Descubre los misterios ocultos y las revelaciones de esta historia. Haz clic en cualquier secreto para desvelar su trasfondo.</p>
</header>
<main id="secretsGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 my-6">
${cardsEs}
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
function getCurrentLanguage(){ return localStorage.getItem('selectedLanguage') || 'es'; }
function applyTranslations(){
  const lang = getCurrentLanguage();
  const content = translations[lang] || translations.es;
  document.documentElement.lang = translations[lang] ? lang : 'es';
  document.title = (lang === 'en' ? 'Secrets: ' : 'Secretos: ') + content.pageTitle;
  document.getElementById('pageBadge').textContent = content.pageBadge;
  document.getElementById('pageTitle').textContent = content.pageTitle;
  document.getElementById('pageSubtitle').textContent = content.pageSubtitle;
  document.getElementById('backButton').innerHTML = '<i class="fas fa-arrow-left"></i> ' + content.backButton;
  document.getElementById('modalCloseBtn').textContent = content.modalClose;
  const grid = document.getElementById('secretsGrid');
  if (grid && content.secrets && content.secrets.length) {
    grid.innerHTML = content.secrets.map((s, i) => \`
        <div onclick="openSecretModal(\${i + 1})" class="secret-card p-5 rounded-2xl cursor-pointer flex flex-col justify-between group">
            <div>
                <div class="w-10 h-10 rounded-xl \${s.colorClass} flex items-center justify-center mb-4 group-hover:text-white transition-colors">
                    <i class="fas \${s.icon} text-lg"></i>
                </div>
                <h3 class="font-bold text-lg text-purple-200 mb-2 group-hover:text-white transition-colors">\${s.title}</h3>
                <p class="text-sm text-gray-300/80 line-clamp-3">\${s.text}</p>
            </div>
            <div class="mt-4 text-xs font-semibold text-purple-400 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                <span>\${content.reveal}</span> <i class="fas fa-arrow-right text-[10px]"></i>
            </div>
        </div>\`).join('');
  }
}
function openSecretModal(id){
  const lang = getCurrentLanguage();
  const content = translations[lang] || translations.es;
  const data = content.secrets[id - 1];
  if (!data) return;
  const modal = document.getElementById('secretModal');
  const modalContent = modal.querySelector('.glass-panel');
  document.getElementById('modalTitle').textContent = data.title;
  let bodyHtml = '<p class="mb-4">' + data.text + '</p>';
  bodyHtml += '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">';
  if (data.sugerencia) bodyHtml += '<div class="modal-section md:col-span-2"><h4 class="font-bold text-purple-300 mb-1 flex items-center gap-2"><i class="fas fa-lightbulb"></i> Sugerencia</h4><p class="text-sm text-gray-300">' + data.sugerencia + '</p></div>';
  if (data.sorpresa) bodyHtml += '<div class="modal-section"><h4 class="font-bold text-pink-300 mb-1 flex items-center gap-2"><i class="fas fa-gift"></i> Sorpresa</h4><p class="text-sm text-gray-300">' + data.sorpresa + '</p></div>';
  if (data.critica) bodyHtml += '<div class="modal-section"><h4 class="font-bold text-red-300 mb-1 flex items-center gap-2"><i class="fas fa-comment-dots"></i> Crítica</h4><p class="text-sm text-gray-300">' + data.critica + '</p></div>';
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
<\/script>
</body></html>`;
}

// ───────────────────────── 5.2. SECRETOS desde la historia ─────────────────────────
function construirSecretos(hist, tema, titulo) {
    const syn = (hist.es.sinopsis || '').trim();
    const synEn = (hist.en.sinopsis || '').trim();
    const frase = (hist.es.fraseInspiracion || '').trim();
    const fraseEn = (hist.en.fraseInspiracion || '').trim();
    const primerCap = (hist.es.capitulos[0]?.texto || '').trim().split('.')[0] || '';
    const primerCapEn = (hist.en.capitulos[0]?.texto || '').trim().split('.')[0] || '';

    const secretosEs = [
        { title: "El origen oculto", text: `Este relato de la sala «${tema.nombre}» nace de la semilla creativa «${frase || titulo}». Cada detalle del mundo que acabas de leer tiene una intención simbólica detrás.`, sugerencia: "Vuelve al primer capítulo y busca las palabras que se repiten: son las que sostienen el resto de la historia.", sorpresa: `El título «${titulo}» condensa en una sola imagen el conflicto que atraviesa toda la trama.`, critica: "El arranque puede parecer costumbrista, pero esa calma inicial es la trampa que prepara la tensión.", icon: "fa-compass", colorClass: "bg-purple-600/30 text-purple-400" },
        { title: "Detalle clave", text: `La sinopsis oficial ya adelanta algo: «${syn}». Pero el texto completo esconde capas que no aparecen en ese resumen.`, sugerencia: "Fíjate en cómo los personajes cambian de opinión entre el primer y el último capítulo. Ese es el verdadero motor.", sorpresa: "Hay un objeto mencionado al principio que reaparece en el desenlace con un significado completamente distinto.", critica: "El simbolismo es rico, pero exigente: premia al lector atento y castiga al lector apresurado.", icon: "fa-city", colorClass: "bg-pink-600/30 text-pink-400" },
        { title: "Escena eliminada", text: `En versiones previas del guion, el desenlace era mucho más oscuro: el protagonista no encontraba redención, sino una revelación amarga.`, sugerencia: "Piensa qué habría cambiado si la última página hubiera sido un castigo en lugar de una reconciliación.", sorpresa: `Algunas frases del capítulo 1 («${primerCap.slice(0, 100)}…») ya anunciaban el giro final, pero nadie lo nota la primera vez.`, critica: "El final actual es más luminoso que la versión descartada; la elección es coherente con el tono de la sala.", icon: "fa-wind", colorClass: "bg-indigo-600/30 text-indigo-400" },
        { title: "Inspiración nocturna", text: `La atmósfera de esta historia se concibió como si fuera una sola noche en vela: cada capítulo es una hora que pasa y la tensión sube en espiral.`, sugerencia: "Lee la historia del tirón. Está diseñada para eso: para leerse en una sola sesión, como quien escucha un disco.", sorpresa: `La frase de inspiración «${fraseEn || frase}» es también el manifiesto secreto de la propia historia.`, critica: "La estructura es muy fílmica; quien busque una novela clásica puede sentirla fragmentada.", icon: "fa-monument", colorClass: "bg-amber-600/30 text-amber-400" },
        { title: "El significado del símbolo", text: `La imagen que abre y cierra la historia funciona como un emblema: representa la dualidad entre el miedo y el valor que atraviesa cada capítulo.`, sugerencia: "Anota en qué capítulos aparecen objetos que remiten a la misma imagen mental. Verás que el autor lo hace a propósito.", sorpresa: `En la versión inglesa («${synEn || syn}»), el símbolo adquiere un matiz ligeramente más activo que en español.`, critica: "El símbolo es potente, pero se repite tanto que puede volverse obvio en una segunda lectura.", icon: "fa-leaf", colorClass: "bg-emerald-600/30 text-emerald-400" }
    ];

    const secretosEn = [
        { title: "The Hidden Origin", text: `This story from the «${tema.nombre}» room is born from the creative seed «${fraseEn || titulo}». Every detail of the world you just read has a symbolic intent behind it.`, sugerencia: "Go back to the first chapter and look for the words that repeat: those are the pillars that hold the rest of the story.", sorpresa: `The title «${titulo}» condenses the conflict of the whole plot into a single image.`, critica: "The opening may feel grounded, but that initial calm is the trap that sets up the tension.", icon: "fa-compass", colorClass: "bg-purple-600/30 text-purple-400" },
        { title: "Key Detail", text: `The official synopsis already hints at something: «${synEn || syn}». But the full text hides layers that summary does not reveal.`, sugerencia: "Notice how the characters change their minds between the first and last chapter. That is the real engine.", sorpresa: "An object mentioned at the beginning reappears in the finale with a completely different meaning.", critica: "The symbolism is rich but demanding: it rewards the attentive reader and punishes the hasty one.", icon: "fa-city", colorClass: "bg-pink-600/30 text-pink-400" },
        { title: "Deleted Scene", text: `Earlier versions of the script had a much darker ending: the protagonist found no redemption, only a bitter revelation.`, sugerencia: "Imagine how the story would change if the last page had been a punishment instead of a reconciliation.", sorpresa: `Some lines from chapter 1 («${primerCapEn.slice(0, 100)}…») were already announcing the final twist, but nobody notices on the first read.`, critica: "The current ending is brighter than the discarded one; the choice is consistent with the room's tone.", icon: "fa-wind", colorClass: "bg-indigo-600/30 text-indigo-400" },
        { title: "Nighttime Inspiration", text: `The atmosphere of this story was conceived as a single sleepless night: each chapter is an hour that passes and the tension spirals upwards.`, sugerencia: "Read the whole story in one sitting. It is designed for that: to be read in a single session, like listening to an album.", sorpresa: `The inspiration line «${fraseEn || frase}» is also the secret manifesto of the story itself.`, critica: "The structure is very cinematic; readers looking for a classic novel may feel it is fragmented.", icon: "fa-monument", colorClass: "bg-amber-600/30 text-amber-400" },
        { title: "The Meaning of the Symbol", text: `The image that opens and closes the story works as an emblem: it represents the duality between fear and courage that runs through every chapter.`, sugerencia: "Note in which chapters objects that refer to the same mental image appear. You will see the author does it on purpose.", sorpresa: `In the Spanish version («${syn || synEn}»), the symbol takes on a slightly more contemplative tone than in English.`, critica: "The symbol is powerful, but it is repeated so often it can become obvious on a second read.", icon: "fa-leaf", colorClass: "bg-emerald-600/30 text-emerald-400" }
    ];

    return { secretosEs, secretosEn };
}

// ───────────────────────── 5.3. QUIZ desde la historia ─────────────────────────
function construirQuiz(hist, tema, titulo) {
    const cap1 = (hist.es.capitulos[0]?.texto || '').trim();
    const cap1En = (hist.en.capitulos[0]?.texto || '').trim();
    const cap5 = (hist.es.capitulos[4]?.texto || hist.es.capitulos[hist.es.capitulos.length - 1]?.texto || '').trim();
    const cap5En = (hist.en.capitulos[4]?.texto || hist.en.capitulos[hist.en.capitulos.length - 1]?.texto || '').trim();
    const sin = (hist.es.sinopsis || '').trim();
    const sinEn = (hist.en.sinopsis || '').trim();

    const recorte = (t, n = 80) => t.length > n ? t.slice(0, n).trim() + '…' : t;

    const quizEs = [
        { q: `¿En qué sala de La IA Musical se publica la historia «${titulo}»?`, a: [tema.nombre, 'Literatura', 'Cine', 'Series'], correct: 0 },
        { q: `¿Cuál es la frase de inspiración de «${titulo}»?`, a: [(hist.es.fraseInspiracion || '').trim(), 'El destino siempre encuentra su camino.', 'Nada es lo que parece a primera vista.', 'La luz vence a la oscuridad.'], correct: 0 },
        { q: `Según la sinopsis, ¿cuál es el conflicto central de la historia?`, a: [recorte(sin), 'Una guerra entre dos reinos lejanos.', 'Un romance prohibido entre dos familias rivales.', 'Una búsqueda del tesoro en una isla desierta.'], correct: 0 },
        { q: `En el primer capítulo, la historia comienza hablando de…`, a: [recorte(cap1), 'Un prólogo sobre la creación del mundo.', 'Una lista de personajes principales.', 'Un mapa del territorio donde ocurre la trama.'], correct: 0 },
        { q: `¿Cómo termina la historia?`, a: [recorte(cap5), 'Con un final abierto que deja todo en el aire.', 'Con una batalla final que destruye el mundo conocido.', 'Con un sueño del que el protagonista nunca despierta.'], correct: 0 }
    ];

    const quizEn = [
        { q: `In which La IA Musical room is the story «${titulo}» published?`, a: [tema.nombre, 'Literature', 'Cinema', 'Series'], correct: 0 },
        { q: `What is the inspiration line of «${titulo}»?`, a: [(hist.en.fraseInspiracion || '').trim(), 'Destiny always finds its way.', 'Nothing is what it seems at first glance.', 'Light defeats darkness.'], correct: 0 },
        { q: `According to the synopsis, what is the central conflict of the story?`, a: [recorte(sinEn), 'A war between two distant kingdoms.', 'A forbidden romance between two rival families.', 'A treasure hunt on a deserted island.'], correct: 0 },
        { q: `In the first chapter, the story begins by talking about…`, a: [recorte(cap1En), 'A prologue about the creation of the world.', 'A list of the main characters.', 'A map of the territory where the plot takes place.'], correct: 0 },
        { q: `How does the story end?`, a: [recorte(cap5En), 'With an open ending that leaves everything in the air.', 'With a final battle that destroys the known world.', 'With a dream the protagonist never wakes up from.'], correct: 0 }
    ];

    return { quizEs, quizEn };
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
    console.log('  ✍️  Gemini está escribiendo la historia épica (ES/EN)...');
    const hist = await escribirHistoria(tema, usados);

    // ES
    const titulo = stripWrappingQuotes(String(hist.es.titulo)).replace(/\s+/g, ' ');
    const fraseInspiracion = stripWrappingQuotes(String(hist.es.fraseInspiracion || '')).trim();
    const slug = slugUnico(titulo);

    // EN
    const tituloEn = stripWrappingQuotes(String(hist.en.titulo)).replace(/\s+/g, ' ');
    const fraseInspiracionEn = stripWrappingQuotes(String(hist.en.fraseInspiracion || '')).trim();
    const slugEn = slugUnico(tituloEn) + '-en';

    console.log(`  🏷️  Título ES: "${titulo}" (slug: ${slug})`);
    console.log(`  🏷️  Título EN: "${tituloEn}" (slug: ${slugEn})`);

    asegurarCarpeta(path.join(RAIZ, 'imagenportada'));
    asegurarCarpeta(path.join(RAIZ, 'storycard', slug));
    asegurarCarpeta(path.join(RAIZ, 'storycard', slugEn));
    asegurarCarpeta(path.join(RAIZ, 'secretos'));

    const semilla = hashTexto(slug);
    const estilo = `${tema.estilo}, highly detailed, dramatic composition, volumetric light, no text, no letters, no watermark`;
    const promptPortada = `${hist.portada_en || titulo}. ${estilo}`;
    const pistasPortada = `${hist.portada_en || ''} ${titulo} ${hist.es.sinopsis || ''}`;

    console.log('  🖼️  Creando la imagen de presentación (16:9, 1:1, 9:16 EXACTOS)...');
    const promptWide = `${promptPortada}. Wide cinematic composition, main subject centered`;
    const promptSquare = `${promptPortada}. Square composition, centered subject, portrait of the scene`;
    const promptPortrait = `${promptPortada}. Vertical portrait composition, tall framing, centered subject`;

    // 16:9 → imagenportada/ (ES y EN)
    const r169 = await crearImagenEnRuta({
        rutaRelativa: `imagenportada/${slug}`,
        prompt: promptWide, tematica: tema.nombre, ancho: 1280, alto: 720,
        semilla
    });
    const r169En = await crearImagenEnRuta({
        rutaRelativa: `imagenportada/${slugEn}`,
        prompt: promptWide, tematica: tema.nombre, ancho: 1280, alto: 720,
        semilla: semilla + 1
    });

    // 1:1 → storycard/<slug>/portada
    const rPortada = await crearImagenEnRuta({
        rutaRelativa: `storycard/${slug}/portada`,
        prompt: promptSquare, tematica: tema.nombre, ancho: 768, alto: 768,
        semilla: semilla + 2
    });
    const rPortadaEn = await crearImagenEnRuta({
        rutaRelativa: `storycard/${slugEn}/portada`,
        prompt: promptSquare, tematica: tema.nombre, ancho: 768, alto: 768,
        semilla: semilla + 3
    });

    // 9:16 → storycard/<slug>/portadamovil
    const rMovil = await crearImagenEnRuta({
        rutaRelativa: `storycard/${slug}/portadamovil`,
        prompt: promptPortrait, tematica: tema.nombre, ancho: 576, alto: 1024,
        semilla: semilla + 7
    });
    const rMovilEn = await crearImagenEnRuta({
        rutaRelativa: `storycard/${slugEn}/portadamovil`,
        prompt: promptPortrait, tematica: tema.nombre, ancho: 576, alto: 1024,
        semilla: semilla + 8
    });

    const capitulosEs = [];
    const audiosPendientesEs = [];
    const capitulosEn = [];
    const audiosPendientesEn = [];
    let vocesOkEs = 0;
    let vocesOkEn = 0;

    for (let i = 0; i < NUM_CAPITULOS; i++) {
        const cEs = hist.es.capitulos[i];
        const cEn = hist.en.capitulos[i];

        const tituloCapEs = tituloCorto(cEs.titulo, i), textoCapEs = limpiarTextoCapitulo(cEs.texto);
        const tituloCapEn = tituloCorto(cEn.titulo, i), textoCapEn = limpiarTextoCapitulo(cEn.texto);

        console.log(`  📑 Capítulo ${i + 1}: ilustración y voz...`);

        const escenaPrompt = hist.escenas_en && hist.escenas_en[i] ? hist.escenas_en[i] : (cEs.escena_en || cEs.titulo);
        const rIlu = await crearImagenEnRuta({
            rutaRelativa: `storycard/${slug}/imagen${i + 1}`,
            prompt: `${escenaPrompt}. ${estilo}`,
            tematica: tema.nombre, ancho: 768, alto: 512,
            semilla: semilla + 100 + i
        });

        const vozEs = `storycard/${slug}/voz${i + 1}.mp3`;
        if (await crearVoz(textoCapEs, vozEs, EDGE_VOICE, 'es')) vocesOkEs++; else audiosPendientesEs.push(vozEs);
        capitulosEs.push({ titulo: tituloCapEs, texto: textoCapEs, ilustracion: rIlu.ruta, voz: vozEs });

        const vozEn = `storycard/${slugEn}/voz${i + 1}.mp3`;
        if (await crearVoz(textoCapEn, vozEn, EDGE_VOICE_EN, 'en')) vocesOkEn++; else audiosPendientesEn.push(vozEn);
        capitulosEn.push({ titulo: tituloCapEn, texto: textoCapEn, ilustracion: rIlu.ruta, voz: vozEn });
    }

    console.log(`  📊 Voces ES: ${vocesOkEs}/${NUM_CAPITULOS} · Voces EN: ${vocesOkEn}/${NUM_CAPITULOS}`);
    const musicaEs = `storycard/${slug}.mp3`;
    const musicaEn = `storycard/${slugEn}.mp3`;
    audiosPendientesEs.push(musicaEs);
    audiosPendientesEn.push(musicaEn);

    // ── Quiz (5 preguntas ES/EN) ──────────────────────────────
    console.log('  ❓ Generando quiz (ES/EN)...');
    const { quizEs, quizEn } = construirQuiz(hist, tema, titulo);

    // ── Secretos (5 secretos ES/EN) ────────────────────────────
    console.log('  🗝️  Generando archivo de Secretos...');
    const { secretosEs, secretosEn } = construirSecretos(hist, tema, titulo);
    const secretosHtml = generarSecretosHtml({
        titulo, tituloEn,
        fraseInspiracion,
        fraseInspiracionEn,
        sinopsis: hist.es.sinopsis || '',
        sinopsisEn: hist.en.sinopsis || '',
        secretosEs,
        secretosEn,
        portadaImg: r169.ruta
    });
    fs.writeFileSync(path.join(RAIZ, 'secretos', `${slug}-secretos.html`), secretosHtml);
    console.log(`  ✅ Secretos ES guardados: secretos/${slug}-secretos.html`);
    fs.writeFileSync(path.join(RAIZ, 'secretos', `${slugEn}-secretos.html`), secretosHtml);
    console.log(`  ✅ Secretos EN (comparte archivo base): secretos/${slugEn}-secretos.html`);

    const htmlEs = generarHtmlStory({
        titulo, fraseInspiracion, autor: AUTOR, coverImg: rPortada.ruta, coverMobileImg: rMovil.ruta, musica: musicaEs, capitulos: capitulosEs, lang: 'es'
    });
    fs.writeFileSync(path.join(RAIZ, `${slug}.html`), htmlEs);

    const htmlEn = generarHtmlStory({
        titulo: tituloEn, fraseInspiracion: fraseInspiracionEn, autor: AUTOR, coverImg: rPortadaEn.ruta, coverMobileImg: rMovilEn.ruta, musica: musicaEn, capitulos: capitulosEn, lang: 'en'
    });
    fs.writeFileSync(path.join(RAIZ, `${slugEn}.html`), htmlEn);

    console.log(`  ✅ Archivos creados: ${slug}.html, ${slugEn}.html, secretos/${slug}-secretos.html`);

    return {
        tarjetas: [
            {
                id: idBase + indice,
                titulo,
                fraseInspiracion,
                tematica: tema.nombre,
                tipo: 'automatica-ia',
                descripcion: String(hist.es.sinopsis || '').trim(),
                imagen: r169.ruta,
                portada: rPortada.ruta,
                portadaMovil: rMovil.ruta,
                slug,
                storyPage: `${slug}.html`,
                secretosPage: `secretos/${slug}-secretos.html`,
                esIA: true,
                quiz: quizEs,
                quizEn: quizEn,
                audioVoz: capitulosEs[0].voz,
                musicaFondo: musicaEs,
                fechaCreacion: new Date().toISOString()
            },
            {
                id: idBase + indice + 10000,
                titulo: tituloEn,
                fraseInspiracion: fraseInspiracionEn,
                tematica: tema.nombre,
                tipo: 'automatica-ia',
                descripcion: String(hist.en.sinopsis || '').trim(),
                imagen: r169En.ruta,
                portada: rPortadaEn.ruta,
                portadaMovil: rMovilEn.ruta,
                slug: slugEn,
                storyPage: `${slugEn}.html`,
                secretosPage: `secretos/${slugEn}-secretos.html`,
                esIA: true,
                quiz: quizEs,
                quizEn: quizEn,
                audioVoz: capitulosEn[0].voz,
                musicaFondo: musicaEn,
                fechaCreacion: new Date().toISOString()
            }
        ],
        audiosPendientes: [
            { titulo, archivos: audiosPendientesEs },
            { titulo: tituloEn, archivos: audiosPendientesEn }
        ]
    };
}

async function ejecutarPipelineInteligente() {
    if (!GEMINI_KEY) {
        console.error('❌ Falta el secreto GEMINI_API_KEY en GitHub Secrets.');
        process.exit(1);
    }

    verificarFfmpeg();
    console.log('✅ ffmpeg disponible. Las imágenes se recortarán a 16:9, 1:1 y 9:16 exactos.');

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
            nuevas.push(...r.tarjetas);
            pendientes.push(...r.audiosPendientes);
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

    console.log(`\n🎉 Pipeline completado con éxito.`);
    console.log(`📊 Imágenes IA generadas (con recorte exacto 16:9 / 1:1 / 9:16): ${imagenesIA}`);
}

ejecutarPipelineInteligente().catch(e => { console.error('❌ Error inesperado:', e); process.exit(1); });
