/**
 * Robot semanal de Storycards (GitHub Actions)
 * ------------------------------------------------------------------
 * Cada ejecución escribe 2 historias ÉPICAS originales con Gemini y las
 * convierte en storycards completas:
 *   - <slug>.html                    → libro interactivo (diseño del Creador de Cartas)
 *   - storycard/<slug>/portada.*     → portada (IA con Pollinations o SVG de respaldo)
 *   - storycard/<slug>/portadamovil.*→ portada vertical 9:16
 *   - storycard/<slug>/imagenN.*     → ilustración de cada capítulo
 *   y las registra en data/storycards.json para que reproductor.html las muestre.
 *
 * La VOZ y la MÚSICA ya NO las crea el robot: se suben a mano. El robot deja
 * la página preparada con las rutas exactas y las lista en data/audios_pendientes.md.
 *
 * Requisitos: Node 18+ (fetch nativo), sin dependencias npm.
 * Secreto obligatorio: GEMINI_API_KEY (GitHub → Settings → Secrets → Actions).
 */
const fs = require('fs');
const path = require('path');

// ───────────────────────── CONFIGURACIÓN ─────────────────────────
const RAIZ = path.join(__dirname, '..');
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || '';            // opcional: fuerza un modelo
const NUM_CAPITULOS = Math.max(3, Math.min(8, parseInt(process.env.NUM_CAPITULOS || '5', 10)));
const PALABRAS_CAPITULO = Math.max(80, Math.min(400, parseInt(process.env.PALABRAS_CAPITULO || '170', 10)));
const POLLINATIONS_KEY = process.env.POLLINATIONS_API_KEY || '';
const AUTOR = 'LaIAmusical';
// Rutas donde SUBES a mano la voz y la música:
const RUTA_VOZ = 'storycard/assets/audio/voz';        // <slug>-cap1.mp3, <slug>-cap2.mp3, ...
const RUTA_MUSICA = 'storycard/assets/audio/musica';  // <slug>.mp3
const PLANTILLA = JSON.parse(fs.readFileSync(path.join(__dirname, 'plantilla_story.json'), 'utf8'));

// Salas (temáticas) que el robot sabe escribir. "nombre" = nombre exacto de la sala en el reproductor.
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

// ───────────────────────── 1. ELEGIR TEMÁTICAS ─────────────────────────
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

/** Tarjeta 1 = temática ganadora del ranking (si el robot la domina); tarjeta 2 = la sala con la historia más antigua. */
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
    // la sala sin historias, o con la más antigua, va primero
    const rotacion = [...TEMAS].sort((a, b) => ((ultima[a.nombre] || 0) - (ultima[b.nombre] || 0)) || (hashTexto(a.nombre + Date.now()) % 3) - 1);

    const primera = TEMAS.find(t => t.nombre === ganadora) || rotacion[0];
    const segunda = rotacion.find(t => t.nombre !== primera.nombre);
    console.log(`> Temática ganadora del ranking: ${ganadora || '(sin datos válidos)'}`);
    return [primera, segunda];
}

// ───────────────────────── 2. HISTORIA ÉPICA CON GEMINI ─────────────────────────
const MODELOS_PREFERIDOS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-pro'];
let modelosGemini = null;

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
            .map(m => String(m.name || '').replace(/^models\//, ''))
            .filter(n => n.includes('gemini') && !/(tts|embedding|image|live|audio|vision|robotics|computer)/.test(n));
        modelosGemini = [
            ...MODELOS_PREFERIDOS.filter(m => disponibles.includes(m)),
            ...disponibles.filter(m => !MODELOS_PREFERIDOS.includes(m) && /flash/.test(m))
        ].slice(0, 5);
        if (!modelosGemini.length) throw new Error('la clave no ve ningún modelo Gemini compatible');
    } catch (e) {
        console.warn(`  No pude listar modelos (${e.message}); uso la lista por defecto.`);
        modelosGemini = MODELOS_PREFERIDOS.slice(0, 3);
    }
    return modelosGemini;
}

async function pedirGemini(prompt) {
    const modelos = await listarModelosGemini();
    let ultimoError = null;
    for (const modelo of modelos) {
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
                }, 180000);
            const datos = await res.json();
            if (!res.ok) throw new Error(datos.error?.message || `HTTP ${res.status}`);
            const texto = (datos.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
            if (!texto) throw new Error(`respuesta sin texto (${datos.candidates?.[0]?.finishReason || 'sin motivo'})`);
            console.log(`  (modelo usado: ${modelo})`);
            return texto;
        } catch (e) {
            ultimoError = e;
            console.warn(`  Gemini ${modelo} falló: ${e.message}`);
            if (/API key|PERMISSION_DENIED|UNAUTHENTICATED|403|401/i.test(e.message)) break; // clave mala: no insistir
        }
    }
    throw ultimoError || new Error('Gemini no respondió');
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
        '- TÍTULO: un título propio y memorable, con un NOMBRE PROPIO inventado (de personaje, lugar, reino, nave, obra…) ligado a la trama, p. ej. «La Corona de Elara Voss» o «El Último Faro de Calderón». Máximo 8 palabras. Prohibidos títulos genéricos («Historia épica», «Especial semanal», «Aventura de…») y títulos de obras existentes.',
        '- Todo es 100 % original: sin personajes, marcas, mundos ni obras protegidas, y sin personas reales ni sucesos reales.',
        `- Exactamente ${NUM_CAPITULOS} capítulos de unas ${PALABRAS_CAPITULO} palabras cada uno (3 o 4 párrafos separados por una línea en blanco).`,
        '- Estructura épica: presentación del mundo y la herida del protagonista, escalada de conflicto, un giro central que cambia las reglas, un sacrificio o decisión difícil y un final con eco emocional.',
        '- Escribe con imágenes sensoriales, diálogo puntual y estilo propio; evita clichés y frases de relleno.',
        '- Nada de violencia gráfica ni contenido sexual: apto para todos los públicos.',
        usados.length ? `- Títulos ya usados (NO repetir ni imitar): ${usados.slice(0, 20).join(' | ')}.` : '',
        '',
        'Responde SOLO con JSON válido, sin markdown, con esta forma exacta:',
        '{"titulo":"…","sinopsis":"2 frases atractivas, máx. 45 palabras, sin destripar el final","portada_en":"visual description in English of the cover art, no text, no letters","capitulos":[{"titulo":"título breve del capítulo","texto":"…","escena_en":"visual description in English of this chapter\'s key scene, no text, no letters"}]}'
    ].filter(Boolean).join('\n');

    let motivo = '';
    for (let intento = 1; intento <= 3; intento++) {
        try {
            const raw = await pedirGemini(prompt);
            const json = parseJsonSuelto(raw);
            motivo = validarHistoria(json);
            if (!motivo) return json;
            console.warn(`  Intento ${intento}: respuesta descartada (${motivo}).`);
        } catch (e) {
            motivo = e.message;
            if (/API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(e.message)) throw e;
        }
        await dormir(3000 * intento);
    }
    throw new Error(`Gemini no devolvió una historia válida (${motivo})`);
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
    asegurarCarpeta(path.join(RAIZ, 'storycard', slug));
    asegurarCarpeta(path.join(RAIZ, RUTA_VOZ));
    asegurarCarpeta(path.join(RAIZ, RUTA_MUSICA));

    const semilla = hashTexto(slug);
    const estilo = `${tema.estilo}, no text, no letters, no watermark`;

    console.log('  🖼️  Creando portadas...');
    const promptPortada = `${hist.portada_en || titulo}. ${estilo}`;
    const portada = await crearImagen({ carpeta: slug, nombre: 'portada', prompt: promptPortada, tematica: tema.nombre, ancho: 768, alto: 768, semilla, usarIA: true });
    const portadaMovil = await crearImagen({ carpeta: slug, nombre: 'portadamovil', prompt: `Vertical poster. ${promptPortada}`, tematica: tema.nombre, ancho: 576, alto: 1024, semilla: semilla + 7, usarIA: true });

    const capitulos = [];
    const audiosPendientes = [];
    for (let i = 0; i < NUM_CAPITULOS; i++) {
        const c = hist.capitulos[i];
        console.log(`  📑 Capítulo ${i + 1}: ilustración...`);
        const ilustracion = await crearImagen({
            carpeta: slug, nombre: `imagen${i + 1}`, tematica: tema.nombre, ancho: 768, alto: 512, semilla: semilla + 100 + i,
            prompt: `${c.escena_en || c.titulo}. ${estilo}`, usarIA: true
        });
        const voz = `${RUTA_VOZ}/${slug}-cap${i + 1}.mp3`;   // lo subes tú; la página ya apunta aquí
        audiosPendientes.push(voz);
        capitulos.push({ titulo: tituloCorto(c.titulo, i), texto: limpiarTextoCapitulo(c.texto), ilustracion, voz });
    }
    const musica = `${RUTA_MUSICA}/${slug}.mp3`;               // lo subes tú
    audiosPendientes.push(musica);

    const html = generarHtmlStory({ titulo, autor: AUTOR, coverImg: portada, coverMobileImg: portadaMovil, musica, capitulos });
    fs.writeFileSync(path.join(RAIZ, `${slug}.html`), html);
    console.log(`  ✅ Archivo creado: ${slug}.html`);

    return {
        tarjeta: {
            id: idBase + indice,
            titulo,
            tematica: tema.nombre,
            tipo: 'automatica-ia',
            descripcion: String(hist.sinopsis || '').trim(),
            imagen: portada,
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
        console.error('❌ Falta el secreto GEMINI_API_KEY. Créalo en GitHub: Settings → Secrets and variables → Actions → New repository secret.');
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
            if (/API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(e.message)) break;
        }
    }
    if (!nuevas.length) { console.error('No se pudo crear ninguna storycard.'); process.exit(1); }

    fs.writeFileSync(rutaJson, JSON.stringify([...nuevas, ...actual], null, 2));

    // Lista de audios que debes subir a mano
    const rutaPend = path.join(RAIZ, 'data/audios_pendientes.md');
    const previo = fs.existsSync(rutaPend) ? fs.readFileSync(rutaPend, 'utf8') : '# Audios pendientes de subir\n\nSube cada archivo a su ruta exacta (voz y música). La storycard funciona sin ellos, pero sin sonido.\n';
    const fecha = new Date().toISOString().slice(0, 10);
    const bloque = pendientes.map(p => `\n## ${p.titulo} (${fecha})\n${p.archivos.map(a => `- [ ] \`${a}\``).join('\n')}\n`).join('');
    fs.writeFileSync(rutaPend, previo + bloque);

    console.log('\n🎉 Pipeline completado. Estas son las storycards nuevas y los audios que debes subir:');
    pendientes.forEach(p => { console.log(`\n  «${p.titulo}»`); p.archivos.forEach(a => console.log(`    - ${a}`)); });
}

ejecutarPipelineInteligente().catch(e => { console.error('❌ Error inesperado:', e); process.exit(1); });
