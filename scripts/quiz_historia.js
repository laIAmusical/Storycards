/**
 * Quiz (encuesta) de 5 preguntas SOLO sobre la historia de una storycard.
 * Módulo común del robot semanal (generador_semanal.js), del robot de storycards de usuario
 * y del script generar_quiz.js.
 *
 * Reglas:
 *  - Cada pregunta trata de hechos, personajes, lugares, objetos, decisiones o desenlaces QUE APARECEN en el texto.
 *  - Nada superficial ni externo: nada sobre la sala, la sinopsis, la frase de inspiración, el título, el autor,
 *    "La IA Musical", etc., ni preguntas que se puedan responder sin haber leído la historia.
 *  - 4 opciones con una sola correcta; la posición de la correcta se baraja (misma posición en ES y EN).
 *  - Una segunda llamada a Gemini verifica que la respuesta correcta se apoya en el texto y que las otras son falsas.
 */

// Preguntas/opciones que NO deben aparecer (plantillas genéricas del robot antiguo y preguntas "externas")
const PATRON_GENERICO = new RegExp([
  'La IA Musical', 'LaIAmusical', 'frase de inspiraci', 'inspiration (?:line|phrase|quote)', 'sinopsis', 'synopsis',
  'storycard', 'en qu[eé] sala', 'which room', 'sala de', 'room of', 'comienza hablando', 'begins by talking about',
  'c[oó]mo termina la historia\\?', 'how does the story end\\?', 'qui[eé]n (?:escribi[oó]|es el autor)', 'who (?:wrote|is the author)',
  'ninguna de las anteriores', 'todas las anteriores', 'none of the above', 'all of the above',
].join('|'), 'i');

function esTextoGenerico(t) { return PATRON_GENERICO.test(String(t || '')); }

// true si alguna pregunta u opción es genérica/externa
function esQuizGenerico(quiz) {
  return Array.isArray(quiz) && quiz.some((p) => p && (esTextoGenerico(p.q) || (Array.isArray(p.a) && p.a.some(esTextoGenerico))));
}

// true si es un quiz completo y bien formado (5 preguntas, 4 opciones, "correct" válido)
function quizValido(quiz) {
  return Array.isArray(quiz) && quiz.length === 5 && quiz.every((p) =>
    p && typeof p.q === 'string' && p.q.trim() && Array.isArray(p.a) && p.a.length === 4 && p.a.every((x) => typeof x === 'string' && x.trim()) &&
    Number.isInteger(p.correct) && p.correct >= 0 && p.correct < 4);
}

/* ───────────── utilidades ───────────── */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

function parseJson(raw) {
  const t = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(t); } catch (e) { /* sigue */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* sigue */ } }
  return null;
}

function textoHistoria(capitulos, maxChars = 24000) {
  const total = capitulos.reduce((a, c) => a + String(c.texto || '').length, 0);
  const tope = Math.max(600, Math.floor(maxChars / Math.max(1, capitulos.length)));
  return capitulos.map((c, i) => `[Capítulo ${i + 1}${c.titulo ? ' · ' + c.titulo : ''}]\n${total > maxChars ? String(c.texto).slice(0, tope) : c.texto}`).join('\n\n');
}

function validarBruto(j) {
  if (!j || !Array.isArray(j.preguntas) || j.preguntas.length !== 5) return 'debe haber exactamente 5 preguntas';
  for (const [i, p] of j.preguntas.entries()) {
    for (const l of ['es', 'en']) {
      const x = p && p[l];
      const n = `pregunta ${i + 1} (${l})`;
      if (!x || !String(x.q || '').trim() || !String(x.correcta || '').trim()) return `${n}: faltan campos`;
      if (!Array.isArray(x.incorrectas) || x.incorrectas.length !== 3 || x.incorrectas.some((o) => !String(o || '').trim())) return `${n}: deben ser 3 incorrectas`;
      const todas = [x.correcta, ...x.incorrectas].map((o) => String(o).trim().toLowerCase());
      if (new Set(todas).size !== 4) return `${n}: opciones repetidas`;
      if (String(x.q).length > 220 || todas.some((o) => o.length > 160)) return `${n}: demasiado largo`;
      if (esTextoGenerico(x.q) || [x.correcta, ...x.incorrectas].some(esTextoGenerico)) return `${n}: pregunta u opción genérica/externa`;
    }
  }
  return null;
}

// Construye el quiz final barajando las opciones (misma posición de la correcta en ES y EN)
function construirDesdeBruto(j, semilla) {
  const rnd = mulberry32(hash(semilla));
  const quizEs = [], quizEn = [];
  for (const p of j.preguntas) {
    const orden = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [orden[i], orden[k]] = [orden[k], orden[i]]; }
    const arma = (x) => {
      const opciones = [String(x.correcta).trim(), ...x.incorrectas.map((o) => String(o).trim())];
      return { q: String(x.q).trim(), a: orden.map((o) => opciones[o]), correct: orden.indexOf(0) };
    };
    quizEs.push(arma(p.es)); quizEn.push(arma(p.en));
  }
  return { quizEs, quizEn };
}

/* ───────────── generación ───────────── */
async function generarQuizDeHistoria({ titulo, capitulos, idioma = 'es', llamarGemini, semilla = titulo, verificar = true, log = console.log }) {
  if (typeof llamarGemini !== 'function') throw new Error('falta llamarGemini');
  if (!capitulos || !capitulos.length) throw new Error('la historia no tiene capítulos');
  const historia = textoHistoria(capitulos);
  const idiomaTxt = idioma === 'en' ? 'English' : 'Spanish';

  const prompt = [
    `You write comprehension quizzes for an interactive story library. The story "${titulo}" is written in ${idiomaTxt}.`,
    '', 'STORY:', historia, '',
    'Write EXACTLY 5 multiple-choice questions that can ONLY be answered by someone who has read this story.',
    'STRICT RULES:',
    '- Every question is about concrete content of the story: events, characters, motives, decisions, places, objects, twists, consequences or the ending. Use real names from the text.',
    '- NOTHING superficial or external: never ask about the title, author, genre, category, room, synopsis, inspirational phrase, the platform or the app, and never ask something answerable without reading the story.',
    '- Cover the whole story in order: 1 question from the beginning, 2 from the middle, 1 about a turning point or a character\'s decision, 1 about the ending or its consequences.',
    '- The correct answer must be explicitly supported by the text. The 3 wrong answers must be clearly false according to the text but plausible inside the story world (use other characters, places, objects or actions from the story). They must not be absurd.',
    '- Options must have similar length and style. Never use "all of the above", "none of the above" or similar.',
    '- Each question is a single clear sentence ending with "?".',
    '- Provide BOTH languages for every field: "es" (Spanish) and "en" (English). The English version must be a faithful translation of the Spanish one (same question, same options).',
    'Respond ONLY with JSON: {"preguntas":[{"es":{"q":"","correcta":"","incorrectas":["","",""]},"en":{"q":"","correcta":"","incorrectas":["","",""]}}]}',
  ].join('\n');

  let motivo = '';
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const j = parseJson(await llamarGemini(prompt));
      motivo = validarBruto(j) || '';
      if (!motivo) {
        if (verificar) {
          const fallos = await verificarConHistoria(j, historia, llamarGemini);
          if (fallos.length) { motivo = `la verificación rechazó las preguntas ${fallos.map((n) => n + 1).join(', ')}`; }
        }
        if (!motivo) return construirDesdeBruto(j, semilla);
      }
    } catch (e) { motivo = e.message; }
    log(`    quiz: intento ${intento}/3 sin resultado válido (${motivo})`);
    await new Promise((r) => setTimeout(r, 3000 * intento));
  }
  throw new Error('no se pudo crear un quiz válido con preguntas de la historia: ' + motivo);
}

// Segunda lectura: ¿la respuesta correcta se apoya en el texto y las otras son falsas? Devuelve los índices rechazados.
async function verificarConHistoria(j, historia, llamarGemini) {
  const lista = j.preguntas.map((p, i) => ({ n: i + 1, q: p.es.q, correcta: p.es.correcta, incorrectas: p.es.incorrectas }));
  const prompt = [
    'You are a strict fact-checker. Check each quiz question ONLY against the story text below.',
    '', 'STORY:', historia, '', 'QUIZ:', JSON.stringify(lista), '',
    'For each question decide: (a) the "correcta" answer is clearly supported by the story, (b) each of the 3 "incorrectas" is false or unsupported by the story, (c) the question cannot be answered without reading the story.',
    'Respond ONLY with JSON: {"resultados":[{"n":1,"ok":true,"motivo":""}]} with one item per question.',
  ].join('\n');
  try {
    const r = parseJson(await llamarGemini(prompt));
    if (!r || !Array.isArray(r.resultados)) return [];
    return r.resultados.filter((x) => x && x.ok === false).map((x) => (Number(x.n) || 1) - 1).filter((i) => i >= 0 && i < 5);
  } catch (e) { return []; }   // si la verificación falla no bloquea la creación
}

module.exports = { PATRON_GENERICO, esTextoGenerico, esQuizGenerico, quizValido, generarQuizDeHistoria, textoHistoria };
