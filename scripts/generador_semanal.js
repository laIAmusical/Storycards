/**
 * Robot semanal de Storycards (GitHub Actions)
 * ------------------------------------------------------------------
 * Cada ejecución escribe 2 historias ÉPICAS originales con Gemini y las
 * convierte en storycards completas (Español e Inglés):
 *   - <slug>.html                    → libro interactivo ES
 *   - <slug>-en.html                 → libro interactivo EN
 *   - storycards/<slug>.jpg          → imagen de presentación panorámica 16:9
 *   - storycard/<slug>/portada.*     → portada cuadrada 1:1
 *   - storycard/<slug>/portadamovil.*→ portada vertical 9:16
 *   - storycard/<slug>/imagenN.*     → ilustración de cada capítulo
 *   y las registra en data/storycards.json para que reproductor.html las muestre.
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
const EDGE_VOICE_EN = process.env.EDGE_VOICE_EN || 'en-US-GuyNeural'; // Voz en inglés
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

// ───────────────────────── 3. GENERACIÓN DE IMÁGENES (16:9, 1:1, 9:16) - PRIORIDAD CLOUDFLARE ─────────────────────────
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

// ---- Escenas SVG animadas ----
const fx = n => Math.round(n * 10) / 10;

const ESCENAS = ['ciudad', 'mar', 'bosque', 'desierto', 'montana', 'espacio', 'escenario', 'castillo'];
const REGLAS_ESCENA = [
    ['ciudad', /city|street|rain|neon|metropol|urban|detective|skyscraper|ciudad|calle|lluvia|rascacielos/g],
    ['mar', /\bsea\b|ocean|ship|harbo|\bport\b|lighthouse|island|boat|wave|barco|faro|isla|oceano|puerto|nav[eio]|marin/g],
    ['bosque', /forest|woods|\btree|jungle|garden|bosque|selva|arbol|jardin|firefl/g],
    ['desierto', /desert|dune|sand|oasis|caravan|desierto|duna|arena|sahara/g],
    ['montana', /mountain|\bpeak|snow|\bice\b|glacier|cliff|aurora|montan|nieve|hielo|cumbre|polar|expedici/g],
    ['espacio', /space|planet|galax|cosmic|orbit|nebula|astronaut|espacio|planeta|galaxia|cosmos|nebulosa|estelar/g],
    ['escenario', /stage|theat|opera|concert|curtain|orchestra|spotlight|violin|piano|escenario|teatro|telon|orquesta|concierto|aria|musical/g],
    ['castillo', /castle|kingdom|throne|palace|crown|\bking|queen|knight|dragon|castillo|reino|trono|palacio|corona|\brey|reina|caballero|dinast/g]
];

function elegirEscena(tematica, pistas, semilla) {
    const t = (pistas || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let mejor = null, max = 0;
    REGLAS_ESCENA.forEach(([nombre, re]) => {
        const n = (t.match(re) || []).length;
        if (n > max) { max = n; mejor = nombre; }
    });
    if (mejor) return mejor;
    const tem = sinAcentos(tematica);
    if (/OPERA|TEATRO/.test(tem)) return 'escenario';
    if (/CINE/.test(tem)) return ['ciudad', 'mar', 'desierto', 'espacio'][semilla % 4];
    if (/LITERATURA/.test(tem)) return ['castillo', 'bosque', 'mar', 'montana'][semilla % 4];
    if (/DOCUMENTAL/.test(tem)) return ['montana', 'desierto', 'mar', 'bosque'][semilla % 4];
    return ESCENAS[semilla % ESCENAS.length];
}

function svgEstrellas(rnd, W, H, n, yMax) {
    let s = '';
    for (let i = 0; i < n; i++) {
        s += `<circle cx="${fx(rnd() * W)}" cy="${fx(rnd() * H * yMax)}" r="${fx(0.6 + rnd() * 1.7)}" fill="#fff"><animate attributeName="opacity" values="0.1;1;0.1" dur="${fx(2 + rnd() * 4)}s" begin="-${fx(rnd() * 5)}s" repeatCount="indefinite"/></circle>`;
    }
    return s;
}
/** Capa de relieve (picos o colinas suaves) que llega hasta el borde inferior. */
function svgCapa(rnd, W, H, yBase, amp, fill, pasos, picos) {
    const pts = [];
    for (let i = 0; i <= pasos; i++) pts.push([fx(i * W / pasos), fx(yBase - rnd() * amp)]);
    let d;
    if (picos) {
        d = `M0,${H} L${pts.map(p => p.join(',')).join(' L')} L${W},${H} Z`;
    } else {
        d = `M0,${H} L0,${pts[0][1]}`;
        for (let i = 1; i < pts.length; i++) {
            const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
            d += ` Q${fx((x0 + x1) / 2)},${fx(Math.min(y0, y1) - amp * 0.35)} ${x1},${y1}`;
        }
        d += ` L${W},${H} Z`;
    }
    return `<path d="${d}" fill="${fill}"/>`;
}
function svgNubes(rnd, W, H, n, color, yMax, opac) {
    let s = '';
    for (let i = 0; i < n; i++) {
        const cx = rnd() * W, cy = H * (0.05 + rnd() * yMax), rx = W * (0.1 + rnd() * 0.18), ry = rx * 0.28;
        const mov = fx(W * (0.05 + rnd() * 0.12));
        s += `<g opacity="${opac}"><ellipse cx="${fx(cx)}" cy="${fx(cy)}" rx="${fx(rx)}" ry="${fx(ry)}" fill="${color}"/><ellipse cx="${fx(cx + rx * 0.5)}" cy="${fx(cy - ry * 0.5)}" rx="${fx(rx * 0.6)}" ry="${fx(ry * 0.9)}" fill="${color}"/><animateTransform attributeName="transform" type="translate" values="-${mov} 0;${mov} 0;-${mov} 0" dur="${fx(25 + rnd() * 25)}s" repeatCount="indefinite"/></g>`;
    }
    return s;
}
function svgLuciernagas(rnd, W, H, n, color, yMin) {
    let s = '';
    for (let i = 0; i < n; i++) {
        const x = fx(rnd() * W), y = fx(H * (yMin + rnd() * (0.95 - yMin))), dx = fx((rnd() - 0.5) * 60), dy = fx((rnd() - 0.5) * 60);
        s += `<circle cx="${x}" cy="${y}" r="${fx(1.5 + rnd() * 2.5)}" fill="${color}"><animateTransform attributeName="transform" type="translate" values="0 0;${dx} ${dy};0 0" dur="${fx(5 + rnd() * 6)}s" begin="-${fx(rnd() * 6)}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="${fx(2 + rnd() * 3)}s" begin="-${fx(rnd() * 3)}s" repeatCount="indefinite"/></circle>`;
    }
    return s;
}

/** Ilustración SVG animada de respaldo: 8 escenas, siempre funciona (sin red ni librerías). */
function crearSvg(tematica, semilla, ancho, alto, pistas = '') {
    const rnd = mulberry32(semilla);
    const W = ancho, H = alto;
    const base = matices(tematica);
    const hue = base[Math.floor(rnd() * 3)];
    const escena = elegirEscena(tematica, pistas, semilla);
    const hsl = (h, s, l) => `hsl(${Math.round(((h % 360) + 360) % 360)},${s}%,${l}%)`;
    const grad = (id, stops, vertical = true) => `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
    let defs = '', cuerpo = '';

    if (escena === 'espacio') {
        defs = grad('c', [[0, hsl(hue + 230, 70, 6)], [0.6, hsl(hue + 250, 60, 14)], [1, hsl(hue + 280, 55, 22)]]) +
            `<radialGradient id="p" cx="0.35" cy="0.35" r="0.8"><stop offset="0" stop-color="${hsl(hue + 20, 75, 70)}"/><stop offset="1" stop-color="${hsl(hue + 10, 70, 18)}"/></radialGradient><filter id="b"><feGaussianBlur stdDeviation="${fx(W * 0.05)}"/></filter>`;
        cuerpo = `<rect width="${W}" height="${H}" fill="url(#c)"/>`;
        for (let i = 0; i < 5; i++) cuerpo += `<circle cx="${fx(rnd() * W)}" cy="${fx(rnd() * H)}" r="${fx(W * (0.15 + rnd() * 0.2))}" fill="${hsl(hue + rnd() * 120, 80, 50)}" opacity="0.22" filter="url(#b)"><animate attributeName="opacity" values="0.12;0.3;0.12" dur="${fx(8 + rnd() * 6)}s" repeatCount="indefinite"/></circle>`;
        cuerpo += svgEstrellas(rnd, W, H, 90, 1);
        const px = fx(W * (0.3 + rnd() * 0.4)), py = fx(H * (0.35 + rnd() * 0.2)), pr = fx(Math.min(W, H) * 0.2);
        cuerpo += `<g><ellipse cx="${px}" cy="${py}" rx="${fx(pr * 1.8)}" ry="${fx(pr * 0.35)}" fill="none" stroke="${hsl(hue + 40, 70, 75)}" stroke-width="${fx(pr * 0.08)}" opacity="0.6" transform="rotate(-18 ${px} ${py})"/><circle cx="${px}" cy="${py}" r="${pr}" fill="url(#p)"/><animateTransform attributeName="transform" type="translate" values="0 0;0 ${fx(H * 0.02)};0 0" dur="9s" repeatCount="indefinite"/></g>`;
        cuerpo += `<line x1="0" y1="0" x2="${fx(W * 0.12)}" y2="${fx(H * 0.05)}" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0"><animateTransform attributeName="transform" type="translate" values="${fx(W * 0.9)} ${fx(H * 0.05)};${fx(W * 0.2)} ${fx(H * 0.4)}" dur="7s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.7;0.78;1" dur="7s" repeatCount="indefinite"/></line>`;
    } else if (escena === 'mar') {
        defs = grad('c', [[0, hsl(hue + 220, 55, 14)], [0.55, hsl(hue + 10, 80, 45)], [1, hsl(hue + 35, 90, 70)]]) + grad('m', [[0, hsl(hue + 20, 60, 30)], [1, hsl(hue + 230, 60, 8)]]) +
            `<radialGradient id="s" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6d8"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/></radialGradient>`;
        const hz = fx(H * 0.6);
        cuerpo = `<rect width="${W}" height="${H}" fill="url(#c)"/>` + svgEstrellas(rnd, W, H, 40, 0.3) + svgNubes(rnd, W, H, 4, hsl(hue + 20, 70, 80), 0.3, 0.35);
        const sx = fx(W * (0.3 + rnd() * 0.4));
        cuerpo += `<circle cx="${sx}" cy="${hz}" r="${fx(W * 0.28)}" fill="url(#s)"/><circle cx="${sx}" cy="${hz}" r="${fx(W * 0.07)}" fill="#fff3cf"/>`;
        cuerpo += `<rect y="${hz}" width="${W}" height="${fx(H - hz)}" fill="url(#m)"/>`;
        for (let i = 0; i < 8; i++) cuerpo += `<ellipse cx="${sx}" cy="${fx(hz + 8 + i * (H - hz) / 9)}" rx="${fx(W * (0.12 - i * 0.008))}" ry="2" fill="#fff0c0" opacity="0.5"><animate attributeName="rx" values="${fx(W * (0.12 - i * 0.008))};${fx(W * (0.06 - i * 0.004))};${fx(W * (0.12 - i * 0.008))}" dur="${fx(2 + rnd() * 2)}s" repeatCount="indefinite"/></ellipse>`;
        for (let i = 0; i < 7; i++) { const y = fx(hz + 14 + i * (H - hz) / 7.5), m = fx(12 + rnd() * 20); cuerpo += `<path d="M-60,${y} Q${fx(W * 0.1)},${y - 6} ${fx(W * 0.2)},${y} T${fx(W * 0.4)},${y} T${fx(W * 0.6)},${y} T${fx(W * 0.8)},${y} T${W + 60},${y}" fill="none" stroke="${hsl(hue + 30, 70, 75)}" stroke-width="1.5" opacity="0.35"><animateTransform attributeName="transform" type="translate" values="-${m} 0;${m} 0;-${m} 0" dur="${fx(4 + rnd() * 4)}s" repeatCount="indefinite"/></path>`; }
        const bx = fx(W * (0.58 + rnd() * 0.25)), by = fx(hz + (H - hz) * 0.18);
        cuerpo += `<g fill="#0a0a12"><path d="M${bx - 38},${by} L${bx + 38},${by} L${bx + 26},${by + 12} L${bx - 28},${by + 12} Z"/><rect x="${bx - 1}" y="${by - 52}" width="2.4" height="52"/><path d="M${bx + 3},${by - 50} L${bx + 32},${by - 8} L${bx + 3},${by - 8} Z"/><path d="M${bx - 3},${by - 40} L${bx - 24},${by - 8} L${bx - 3},${by - 8} Z"/><animateTransform attributeName="transform" type="translate" values="0 0;0 4;0 0" dur="5s" repeatCount="indefinite"/></g>`;
    } else if (escena === 'ciudad') {
        defs = grad('c', [[0, hsl(hue + 240, 60, 5)], [0.7, hsl(hue + 255, 55, 15)], [1, hsl(hue + 300, 60, 28)]]);
        cuerpo = `<rect width="${W}" height="${H}" fill="url(#c)"/>` + svgEstrellas(rnd, W, H, 25, 0.35) +
            `<circle cx="${fx(W * (0.2 + rnd() * 0.6))}" cy="${fx(H * 0.2)}" r="${fx(W * 0.07)}" fill="#e9ecff" opacity="0.85"/>` + svgNubes(rnd, W, H, 4, hsl(hue + 260, 40, 20), 0.35, 0.8);
        let x = 0;
        for (let capa = 0; capa < 2; capa++) {
            x = -10;
            const oscuro = capa === 0 ? hsl(hue + 250, 40, 9) : hsl(hue + 250, 35, 4);
            while (x < W) {
                const bw = fx(W * (0.05 + rnd() * 0.08)), bh = fx(H * (capa === 0 ? 0.25 + rnd() * 0.35 : 0.14 + rnd() * 0.22)), by = fx(H - bh);
                cuerpo += `<rect x="${fx(x)}" y="${by}" width="${bw}" height="${bh}" fill="${oscuro}"/>`;
                if (capa === 1) for (let k = 0; k < 14; k++) cuerpo += `<rect x="${fx(x + 4 + rnd() * (bw - 10))}" y="${fx(by + 6 + rnd() * (bh - 14))}" width="3.5" height="5" fill="${rnd() > 0.5 ? '#ffd98a' : '#8fe3ff'}" opacity="0.9">${rnd() > 0.7 ? `<animate attributeName="opacity" values="0.9;0.15;0.9" dur="${fx(1.5 + rnd() * 4)}s" repeatCount="indefinite"/>` : ''}</rect>`;
                x += bw + fx(rnd() * 6);
            }
        }
        cuerpo += `<rect x="${fx(W * 0.15)}" y="${fx(H * 0.62)}" width="${fx(W * 0.22)}" height="6" rx="3" fill="${hsl(hue, 100, 65)}" opacity="0.9"><animate attributeName="opacity" values="0.95;0.4;0.95;0.7;0.95" dur="3s" repeatCount="indefinite"/></rect>`;
        for (let i = 0; i < 60; i++) { const lx = fx(rnd() * W), ly = fx(rnd() * H * 0.9), d = fx(1 + rnd() * 1.2); cuerpo += `<line x1="${lx}" y1="${ly}" x2="${fx(lx - 6)}" y2="${fx(ly + 20)}" stroke="#bcd8ff" stroke-width="1" opacity="0.4"><animateTransform attributeName="transform" type="translate" values="0 -${fx(H * 0.1)};${fx(-W * 0.02)} ${fx(H * 0.12)}" dur="${d}s" begin="-${fx(rnd() * 2)}s" repeatCount="indefinite"/></line>`; }
    } else if (escena === 'bosque') {
        defs = grad('c', [[0, hsl(hue + 190, 60, 6)], [1, hsl(hue + 170, 50, 22)]]);
        cuerpo = `<rect width="${W}" height="${H}" fill="url(#c)"/>` + svgEstrellas(rnd, W, H, 40, 0.4) +
            `<circle cx="${fx(W * (0.25 + rnd() * 0.5))}" cy="${fx(H * 0.2)}" r="${fx(W * 0.09)}" fill="#f4f1d2"/>` + svgNubes(rnd, W, H, 3, hsl(hue + 180, 30, 25), 0.35, 0.6);
        for (let capa = 0; capa < 3; capa++) {
            const col = hsl(hue + 170, 45 - capa * 8, 14 - capa * 4), yb = H * (0.62 + capa * 0.12);
            cuerpo += svgCapa(rnd, W, H, fx(yb + H * 0.05), H * 0.03, col, 8, false);
            let x = -10;
            while (x < W + 10) {
                const th = fx(H * (0.14 + rnd() * 0.16 + (2 - capa) * 0.04)), tw = fx(th * 0.45);
                cuerpo += `<path d="M${fx(x)},${fx(yb + H * 0.06)} L${fx(x + tw / 2)},${fx(yb + H * 0.06 - th)} L${fx(x + tw)},${fx(yb + H * 0.06)} Z" fill="${col}"/>`;
                x += fx(tw * (0.55 + rnd() * 0.4));
            }
        }
        cuerpo += svgLuciernagas(rnd, W, H, 26, '#d8ff7a', 0.45);
    } else if (escena === 'desierto') {
        const hd = 18 + rnd() * 22; // el desierto siempre es cálido
        defs = grad('c', [[0, hsl(hd + 330, 70, 25)], [0.5, hsl(hd + 20, 85, 55)], [1, hsl(hd + 45, 90, 78)]]) + `<radialGradient id="s" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff2c4"/><stop offset="1" stop-color="#fff2c4" stop-opacity="0"/></radialGradient>`;
        const sx = fx(W * (0.3 + rnd() * 0.4)), sy = fx(H * 0.42);
        cuerpo = `<rect width="${W}" height="${H}" fill="url(#c)"/><circle cx="${sx}" cy="${sy}" r="${fx(W * 0.3)}" fill="url(#s)"/><circle cx="${sx}" cy="${sy}" r="${fx(W * 0.09)}" fill="#fff4cf"/>` + svgNubes(rnd, W, H, 4, hsl(hd + 30, 80, 85), 0.3, 0.4);
        for (let i = 0; i < 3; i++) cuerpo += svgCapa(rnd, W, H, fx(H * (0.55 + i * 0.14)), H * 0.12, hsl(hd - 2 - i * 5, 70 - i * 6, 38 - i * 10), 6, false);
        for (let i = 0; i < 5; i++) { const bx = fx(rnd() * W * 0.6), by = fx(H * (0.12 + rnd() * 0.2)); cuerpo += `<path d="M0,0 q4,-5 8,0 q4,-5 8,0" fill="none" stroke="#2a1a14" stroke-width="1.4" transform="translate(${bx} ${by})"><animateTransform attributeName="transform" type="translate" values="${bx} ${by};${fx(bx + W * 0.5)} ${fx(by - H * 0.05)}" dur="${fx(14 + rnd() * 10)}s" repeatCount="indefinite"/></path>`; }
    } else if (escena === 'montana') {
        defs = grad('c', [[0, hsl(hue + 230, 65, 5)], [1, hsl(hue + 215, 55, 20)]]) + `<filter id="b"><feGaussianBlur stdDeviation="${fx(W * 0.03)}"/></filter>`;
        cuerpo = `<rect width="${W}" height="${H}" fill="url(#c)"/>` + svgEstrellas(rnd, W, H, 80, 0.7);
        const cols = ['#3dffb0', '#7a6bff', '#38d9ff'];
        for (let i = 0; i < 3; i++) cuerpo += `<path d="M-20,${fx(H * (0.2 + i * 0.07))} C${fx(W * 0.25)},${fx(H * (0.05 + i * 0.07))} ${fx(W * 0.5)},${fx(H * (0.4 + i * 0.05))} ${fx(W * 0.75)},${fx(H * (0.15 + i * 0.06))} S${W + 20},${fx(H * 0.12)} ${W + 20},${fx(H * 0.2)} L${W + 20},${fx(H * 0.45)} L-20,${fx(H * 0.45)} Z" fill="${cols[i]}" opacity="0.28" filter="url(#b)"><animate attributeName="opacity" values="0.15;0.42;0.15" dur="${fx(6 + i * 2)}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="-${fx(W * 0.04)} 0;${fx(W * 0.04)} 0;-${fx(W * 0.04)} 0" dur="${fx(12 + i * 3)}s" repeatCount="indefinite"/></path>`;
        for (let i = 0; i < 3; i++) cuerpo += svgCapa(rnd, W, H, fx(H * (0.62 + i * 0.1)), H * 0.3 - i * H * 0.07, hsl(hue + 225, 35 - i * 6, 16 - i * 5), 7 + i, true);
    } else if (escena === 'escenario') {
        defs = grad('c', [[0, hsl(hue + 340, 60, 6)], [1, hsl(hue + 345, 50, 15)]]) + grad('k', [[0, hsl(hue + 350, 75, 24)], [1, hsl(hue + 350, 80, 10)]], false) +
            `<linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2c8" stop-opacity="0.75"/><stop offset="1" stop-color="#fff2c8" stop-opacity="0"/></linearGradient>`;
        cuerpo = `<rect width="${W}" height="${H}" fill="url(#c)"/>`;
        for (let i = 0; i < 2; i++) {
            const x = fx(W * (0.28 + i * 0.44)), sw = fx(rnd() * 4 + 4);
            cuerpo += `<g><polygon points="${x},0 ${fx(x - W * 0.2)},${fx(H * 0.78)} ${fx(x + W * 0.2)},${fx(H * 0.78)}" fill="url(#l)"/><animateTransform attributeName="transform" type="rotate" values="-${sw} ${x} 0;${sw} ${x} 0;-${sw} ${x} 0" dur="${fx(6 + i * 2)}s" repeatCount="indefinite"/></g>`;
        }
        cuerpo += `<rect y="${fx(H * 0.78)}" width="${W}" height="${fx(H * 0.22)}" fill="${hsl(hue + 20, 45, 14)}"/><ellipse cx="${fx(W / 2)}" cy="${fx(H * 0.8)}" rx="${fx(W * 0.28)}" ry="${fx(H * 0.03)}" fill="#fff2c8" opacity="0.35"/>`;
        for (const lado of [0, 1]) {
            const x0 = lado ? W : 0, dir = lado ? -1 : 1;
            let d = `M${x0},0`;
            for (let i = 0; i <= 8; i++) d += ` Q${fx(x0 + dir * (W * 0.16 + (i % 2 ? 14 : -4)))},${fx(H * (i + 0.5) / 8.5)} ${fx(x0 + dir * (W * 0.14 + (i % 2 ? 6 : 0)))},${fx(H * (i + 1) / 8.5)}`;
            cuerpo += `<path d="${d} L${x0},${H} Z" fill="url(#k)"><animateTransform attributeName="transform" type="translate" values="0 0;${dir * 5} 0;0 0" dur="6s" repeatCount="indefinite"/></path>`;
        }
        cuerpo += `<rect width="${W}" height="${fx(H * 0.07)}" fill="${hsl(hue + 350, 75, 12)}"/>`;
        for (let i = 0; i < 14; i++) { const cx = fx((i + 0.5) * W / 14 + (rnd() - 0.5) * 14), cy = fx(H * (0.93 + rnd() * 0.03)); cuerpo += `<circle cx="${cx}" cy="${cy}" r="${fx(W * 0.03)}" fill="#05030a"/><rect x="${fx(cx - W * 0.035)}" y="${fx(cy + W * 0.02)}" width="${fx(W * 0.07)}" height="${fx(H * 0.12)}" rx="8" fill="#05030a"/>`; }
        cuerpo += svgLuciernagas(rnd, W, H * 0.8, 24, '#ffe9b0', 0.05);
    } else { // castillo
        defs = grad('c', [[0, hsl(hue + 240, 60, 8)], [0.7, hsl(hue + 330, 65, 30)], [1, hsl(hue + 20, 80, 52)]]);
        const mx = fx(W * (0.65 + rnd() * 0.2));
        cuerpo = `<rect width="${W}" height="${H}" fill="url(#c)"/>` + svgEstrellas(rnd, W, H, 50, 0.45) + `<circle cx="${mx}" cy="${fx(H * 0.25)}" r="${fx(W * 0.12)}" fill="#fff6dd" opacity="0.92"/>` + svgNubes(rnd, W, H, 4, hsl(hue + 330, 40, 22), 0.4, 0.7);
        cuerpo += svgCapa(rnd, W, H, fx(H * 0.78), H * 0.08, hsl(hue + 250, 30, 7), 6, false);
        const cx = fx(W * (0.25 + rnd() * 0.25)), cb = fx(H * 0.78), cw = fx(W * 0.34);
        cuerpo += `<g fill="#06040c"><rect x="${cx}" y="${fx(cb - H * 0.16)}" width="${cw}" height="${fx(H * 0.2)}"/>`;
        [[0, 0.3], [cw * 0.38, 0.38], [cw - W * 0.07, 0.3]].forEach(([dx, th], i) => { const tw = fx(W * 0.07), tx = fx(cx + dx), ty = fx(cb - H * th); cuerpo += `<rect x="${tx}" y="${ty}" width="${tw}" height="${fx(cb - ty + H * 0.04)}"/><polygon points="${fx(tx - 6)},${ty} ${fx(tx + tw / 2)},${fx(ty - H * 0.09)} ${fx(tx + tw + 6)},${ty}"/>`; if (i !== 1) cuerpo += `<rect x="${fx(tx + tw / 2 - 1)}" y="${fx(ty - H * 0.16)}" width="2" height="${fx(H * 0.07)}"/>`; });
        cuerpo += `</g>`;
        for (let i = 0; i < 6; i++) cuerpo += `<rect x="${fx(cx + cw * (0.1 + rnd() * 0.8))}" y="${fx(cb - H * (0.04 + rnd() * 0.24))}" width="4" height="7" fill="#ffc861"><animate attributeName="opacity" values="1;0.35;1;0.7;1" dur="${fx(1.5 + rnd() * 2)}s" begin="-${fx(rnd() * 2)}s" repeatCount="indefinite"/></rect>`;
        for (let i = 0; i < 4; i++) { const by = fx(H * (0.15 + rnd() * 0.25)); cuerpo += `<path d="M0,0 q6,-6 12,0 q6,-6 12,0 q-6,3 -12,3 q-6,-3 -12,-3" fill="#05030a" transform="translate(0 ${by})"><animateTransform attributeName="transform" type="translate" values="-30 ${by};${W + 30} ${fx(by - H * 0.06)}" dur="${fx(12 + rnd() * 8)}s" begin="-${fx(rnd() * 10)}s" repeatCount="indefinite"/></path>`; }
        cuerpo += svgCapa(rnd, W, H, fx(H * 0.92), H * 0.05, '#030208', 5, false);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${cuerpo}</svg>`;
}

function detectarImagen(buf) {
    if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
    if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8) return 'jpg';
    if (buf.length > 12 && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
    return null;
}

let cloudflareAgotado = false;   // se activa al agotar la cuota diaria: no se insiste más en esta ejecución
let imagenesIA = 0, imagenesSVG = 0;

async function imagenCloudflare(prompt) {
    if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
        if (!imagenCloudflare.avisado) { console.log('  ⚠️ Cloudflare no configurado (faltan CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN).'); imagenCloudflare.avisado = true; }
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
                    body: JSON.stringify({ prompt: prompt.slice(0, 1900), steps: 4 })   // FLUX schnell está pensado para 4 pasos
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
                console.error('  ❌ CUOTA DIARIA GRATUITA DE CLOUDFLARE AGOTADA (10.000 neuronas/día, se renueva a las 00:00 UTC).');
                console.error('     El resto de imágenes de esta ejecución usará las ilustraciones animadas de respaldo.');
                return null;
            }
            if (/HTTP (401|403)/i.test(e.message)) {
                cloudflareAgotado = true;
                console.error('  ❌ Error de autenticación con Cloudflare: revisa que el Token tenga permiso "Workers AI" y que el Account ID sea correcto.');
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
        console.log('  🌸 Respaldando con Pollinations AI...');
        const url = 'https://gen.pollinations.ai/image/' + encodeURIComponent(prompt.slice(0, 1500)) +
            `?model=flux&width=${ancho}&height=${alto}&seed=${semilla}&nologo=true&key=${encodeURIComponent(POLLINATIONS_KEY)}`;
        const res = await fetchConTimeout(url, {}, 90000);
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

/** FLUX (Cloudflare) devuelve siempre 1024x1024: recorta al centro hasta la proporción pedida (16:9, 9:16, 3:2...) con ffmpeg. */
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
        console.warn(`  ⚠️ No pude recortar la imagen (ffmpeg ${r.status}); la dejo como llegó.`);
    } catch (e) {
        console.warn(`  ⚠️ No pude recortar la imagen: ${e.message}`);
    } finally {
        [entrada, salida].forEach(f => { try { fs.unlinkSync(f); } catch (e) { /* ya no existe */ } });
    }
    return { buf, ext };
}

/** Pide una imagen a la IA (Cloudflare → Pollinations). Devuelve {buf, ext} o null. */
async function obtenerImagenIA(prompt, ancho, alto, semilla) {
    return (await imagenCloudflare(prompt)) || (await imagenPollinations(prompt, ancho, alto, semilla));
}

/** Guarda una imagen en la ruta dada (con la proporción exacta), usando la IA o, si no, una ilustración SVG animada. */
function guardarImagen({ rutaRelativa, base, tematica, ancho, alto, semilla, pistas }) {
    const rutaAbsoluta = path.join(RAIZ, rutaRelativa);
    asegurarCarpeta(path.dirname(rutaAbsoluta));
    if (base) {
        const img = recortarAProporcion(base.buf, base.ext, ancho, alto);
        const rutaFinal = `${rutaRelativa}.${img.ext}`;
        fs.writeFileSync(path.join(RAIZ, rutaFinal), img.buf);
        return { ruta: rutaFinal, ia: true };
    }
    const rutaFinal = `${rutaRelativa}.svg`;
    fs.writeFileSync(path.join(RAIZ, rutaFinal), crearSvg(tematica, semilla, ancho, alto, pistas));
    return { ruta: rutaFinal, ia: false };
}

async function crearImagenEnRuta({ rutaRelativa, prompt, tematica, ancho, alto, semilla, pistas }) {
    const base = await obtenerImagenIA(prompt, ancho, alto, semilla);
    const r = guardarImagen({ rutaRelativa, base, tematica, ancho, alto, semilla, pistas });
    if (r.ia) imagenesIA++; else imagenesSVG++;
    return r;
}

// ───────────────────────── 4. VOZ DEL NARRADOR ─────────────────────────
// Principal: Microsoft Edge TTS (voces neuronales, gratis).  Respaldo: Piper (local), si Microsoft bloquea al runner.
// El narrador lee SOLO el texto del capítulo: no dice "Capítulo N" ni el título.
function textoParaNarrar(texto) {
    return (texto || '').replace(/\r/g, '').split(/\n+/).map(l => l.trim()).filter(Boolean).join('\n\n');
}

let edgeCaido = false;   // si Microsoft rechaza varias veces, no seguimos perdiendo tiempo en esta ejecución
let vocesEdge = 0, vocesPiper = 0;

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
            if (/No module named|ENOENT/i.test(motivo)) { sinModulo = true; break; }   // edge-tts no está instalado: reintentar no sirve
            if (intento < 3) await dormir(4000 * intento);
        }
        edgeCaido = true;
        console.error(sinModulo
            ? '  ❌ El paquete edge-tts no está instalado en este servidor (revisa el paso "Instalar Edge TTS" del workflow). Uso Piper como respaldo si está instalado.'
            : '  ❌ Edge TTS no responde desde este servidor (Microsoft lo bloquea a veces). Uso Piper como respaldo si está instalado.');
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

/** Devuelve 'edge', 'piper' o false. */
async function crearVoz(texto, rutaRel, voz, lang) {
    if (await crearVozEdge(texto, rutaRel, voz)) { vocesEdge++; return 'edge'; }
    if (lang === 'es' && crearVozPiper(texto, rutaRel)) { vocesPiper++; return 'piper'; }
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
    asegurarCarpeta(path.join(RAIZ, 'storycards')); // NUEVO: para las imágenes 16:9
    asegurarCarpeta(path.join(RAIZ, 'storycard', slug));
    asegurarCarpeta(path.join(RAIZ, 'storycard', slugEn));

    const semilla = hashTexto(slug);
    const estilo = `${tema.estilo}, highly detailed, dramatic composition, volumetric light, no text, no letters, no watermark`;
    const promptPortada = `${hist.portada_en || titulo}. ${estilo}`;
    const pistasPortada = `${hist.portada_en || ''} ${titulo} ${hist.es.sinopsis || ''}`;

    console.log('  🖼️  Creando la imagen de presentación (se recorta a 16:9, 1:1 y 9:16)...');
    const promptWide = `${promptPortada}. Wide cinematic composition, main subject centered`;
    const basePortada = await obtenerImagenIA(promptWide, 1280, 720, semilla);
    
    // 16:9 images: storycards/slug.jpg y storycards/slugEn.jpg
    const r169 = guardarImagen({ rutaRelativa: `storycards/${slug}`, base: basePortada, tematica: tema.nombre, ancho: 1280, alto: 720, semilla, pistas: pistasPortada });
    const r169En = guardarImagen({ rutaRelativa: `storycards/${slugEn}`, base: basePortada, tematica: tema.nombre, ancho: 1280, alto: 720, semilla, pistas: pistasPortada });
    
    // Covers para las cards (ES y EN pueden compartir la misma base de imagen)
    const rPortada = guardarImagen({ rutaRelativa: `storycard/${slug}/portada`, base: basePortada, tematica: tema.nombre, ancho: 768, alto: 768, semilla, pistas: pistasPortada });
    const rMovil = guardarImagen({ rutaRelativa: `storycard/${slug}/portadamovil`, base: basePortada, tematica: tema.nombre, ancho: 576, alto: 1024, semilla: semilla + 7, pistas: pistasPortada });
    
    const rPortadaEn = guardarImagen({ rutaRelativa: `storycard/${slugEn}/portada`, base: basePortada, tematica: tema.nombre, ancho: 768, alto: 768, semilla, pistas: pistasPortada });
    const rMovilEn = guardarImagen({ rutaRelativa: `storycard/${slugEn}/portadamovil`, base: basePortada, tematica: tema.nombre, ancho: 576, alto: 1024, semilla: semilla + 7, pistas: pistasPortada });
    
    if (basePortada) { imagenesIA += 7; } else { imagenesSVG += 7; }

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
            tematica: tema.nombre, ancho: 768, alto: 512, semilla: semilla + 100 + i,
            prompt: `${escenaPrompt}. ${estilo}`, pistas: `${escenaPrompt} ${cEs.titulo || ''} ${textoCapEs.slice(0, 300)}`
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

    const htmlEs = generarHtmlStory({
        titulo, fraseInspiracion, autor: AUTOR, coverImg: rPortada.ruta, coverMobileImg: rMovil.ruta, musica: musicaEs, capitulos: capitulosEs, lang: 'es'
    });
    fs.writeFileSync(path.join(RAIZ, `${slug}.html`), htmlEs);

    const htmlEn = generarHtmlStory({
        titulo: tituloEn, fraseInspiracion: fraseInspiracionEn, autor: AUTOR, coverImg: rPortadaEn.ruta, coverMobileImg: rMovilEn.ruta, musica: musicaEn, capitulos: capitulosEn, lang: 'en'
    });
    fs.writeFileSync(path.join(RAIZ, `${slugEn}.html`), htmlEn);

    console.log(`  ✅ Archivos creados: ${slug}.html y ${slugEn}.html`);

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
                audioVoz: capitulosEs[0].voz,
                musicaFondo: musicaEs,
                fechaCreacion: new Date().toISOString()
            },
            {
                id: idBase + indice + 10000, // offset para evitar colisiones
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
            nuevas.push(...r.tarjetas); // Añade ES y EN
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

    console.log('\n🎉 Pipeline completado con éxito.');
}

ejecutarPipelineInteligente().catch(e => { console.error('❌ Error inesperado:', e); process.exit(1); });
