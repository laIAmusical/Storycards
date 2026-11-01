const fs = require('fs');
const path = require('path');

async function generarAudioConTTS(textoNarracion, rutaSalidaMp3) {
    // API Key integrada directamente
    const apiKey = "sk_cd82d854f208de7b27fbbd583806c3907ada9c564688233b";
    
    // Voice ID de la voz masculina seleccionada
    const voiceId = "aYbngTsp5kp0sibI3Z0T"; 
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const payload = {
        text: textoNarracion,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
        }
    };

    try {
        console.log("🎙️ Solicitando audio con voz masculina a la API de ElevenLabs...");
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': apiKey
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Error en la API de voz: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(rutaSalidaMp3, buffer);
        console.log(`✅ Audio con voz masculina guardado exitosamente en: ${rutaSalidaMp3}`);

    } catch (error) {
        console.error("❌ Error al generar el TTS:", error);
        fs.writeFileSync(rutaSalidaMp3, "Error de generación de audio");
    }
}

async function ejecutarPipelineInteligente() {
    console.log("1. Analizando estadísticas y ranking semanal...");
    
    const rutaRanking = path.join(__dirname, '../data/ranking_semanal.json');
    let datosRanking = [];
    if (fs.existsSync(rutaRanking)) {
        datosRanking = JSON.parse(fs.readFileSync(rutaRanking, 'utf8'));
    }

    let categoriasExitosas = {};
    datosRanking.forEach(user => {
        let cat = user.tematicaFavorita || "CINE";
        categoriasExitosas[cat] = (categoriasExitosas[cat] || 0) + (user.puntuacion || 1);
    });

    let mejorTematica = Object.keys(categoriasExitosas).reduce((a, b) => 
        categoriasExitosas[a] > categoriasExitosas[b] ? a : b, "CINE"
    );

    const carpetaVoz = path.join(__dirname, '../storycard/assets/audio/voz');
    const carpetaMusica = path.join(__dirname, '../storycard/assets/audio/musica');
    [carpetaVoz, carpetaMusica].forEach(carpeta => {
        if (!fs.existsSync(carpeta)) {
            fs.mkdirSync(carpeta, { recursive: true });
        }
    });

    const idUnico = Date.now();
    const nombreVoz = `story_${idUnico}_voz.mp3`;
    const nombreMusica = `${mejorTematica.toLowerCase()}_ambient_${idUnico}.mp3`;

    const rutaRelativaVoz = `storycard/assets/audio/voz/${nombreVoz}`;
    const rutaRelativaMusica = `storycard/assets/audio/musica/${nombreMusica}`;

    const guionNarracion = `Bienvenidos al especial semanal de ${mejorTematica}. Descubre los nuevos misterios y desafíos narrados con esta voz exclusiva para ti.`;

    // Generar la voz masculina real con la API
    await generarAudioConTTS(guionNarracion, path.join(carpetaVoz, nombreVoz));

    // Música ambiental
    const pistaMusicaDefault = path.join(carpetaMusica, nombreMusica);
    fs.writeFileSync(pistaMusicaDefault, "Simulación de pista musical ambiental adaptada");

    const nuevasCards = [
        {
            id: idUnico + 1,
            titulo: `Especial Semanal: Los Secretos de ${mejorTematica}`,
            tematica: mejorTematica,
            tipo: "automatica-ia",
            descripcion: "Generado con narración de voz masculina automatizada.",
            imagen: "storycard/assets/images/default_cover.jpg",
            audioVoz: rutaRelativaVoz,
            musicaFondo: rutaRelativaMusica
        },
        {
            id: idUnico + 2,
            titulo: `Desafío Sonoro de ${mejorTematica}`,
            tematica: mejorTematica,
            tipo: "automatica-ia",
            descripcion: "Experiencia interactiva con audio neuronal y música ambiental.",
            imagen: "storycard/assets/images/default_cover.jpg",
            audioVoz: rutaRelativaVoz,
            musicaFondo: rutaRelativaMusica
        }
    ];

    const rutaJson = path.join(__dirname, '../data/storycards.json');
    let listaActual = [];
    if (fs.existsSync(rutaJson)) {
        listaActual = JSON.parse(fs.readFileSync(rutaJson, 'utf8'));
    }

    const listaActualizada = [...nuevasCards, ...listaActual];
    fs.writeFileSync(rutaJson, JSON.stringify(listaActualizada, null, 2));
    
    console.log("¡Pipeline multimedia con voz masculina completado con éxito!");
}

ejecutarPipelineInteligente();
