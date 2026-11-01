const fs = require('fs');
const path = require('path');

async function ejecutarPipelineMultimedia() {
    console.log("1. Analizando estadísticas y ranking semanal...");
    
    const rutaRanking = path.join(__dirname, '../data/ranking_semanal.json');
    let datosRanking = [];
    if (fs.existsSync(rutaRanking)) {
        datosRanking = JSON.parse(fs.readFileSync(rutaRanking, 'utf8'));
    }

    // 2. Algoritmo de Predicción: Encontrar la sala/temática más exitosa
    let categoriasExitosas = {};
    datosRanking.forEach(user => {
        let cat = user.tematicaFavorita || "LITERATURA";
        categoriasExitosas[cat] = (categoriasExitosas[cat] || 0) + (user.puntuacion || 1);
    });

    let mejorTematica = Object.keys(categoriasExitosas).reduce((a, b) => 
        categoriasExitosas[a] > categoriasExitosas[b] ? a : b, "LITERATURA"
    );

    console.log(`> Predicción de IA: La temática ganadora es '${mejorTematica}'.`);

    // 3. Definir y asegurar las carpetas físicas de destino para voz y música
    const carpetaVoz = path.join(__dirname, '../storycard/assets/audio/voz');
    const carpetaMusica = path.join(__dirname, '../storycard/assets/audio/musica');

    [carpetaVoz, carpetaMusica].forEach(carpeta => {
        if (!fs.existsSync(carpeta)) {
            fs.mkdirSync(carpeta, { recursive: true });
        }
    });

    // 4. Generar nombres y rutas únicas para los archivos de esta semana
    const idUnico = Date.now();
    const nombreVoz = `story_${idUnico}_voz.mp3`;
    const nombreMusica = `${mejorTematica.toLowerCase()}_ambient_${idUnico}.mp3`;

    const rutaRelativaVoz = `storycard/assets/audio/voz/${nombreVoz}`;
    const rutaRelativaMusica = `storycard/assets/audio/musica/${nombreMusica}`;

    // Simulación de la creación física de los archivos de audio en sus carpetas
    fs.writeFileSync(path.join(carpetaVoz, nombreVoz), "Simulación de audio de voz generado por IA");
    fs.writeFileSync(path.join(carpetaMusica, nombreMusica), "Simulación de música ambiental generada por IA");

    console.log(`> Audio de voz colocado en: ${rutaRelativaVoz}`);
    console.log(`> Música ambiental colocada en: ${rutaRelativaMusica}`);

    // 5. Crear las 2 nuevas Storycards con sus respectivos audios y temáticas
    const nuevasCards = [
        {
            id: idUnico + 1,
            titulo: `Especial Semanal: Los Misterios de ${mejorTematica}`,
            tematica: mejorTematica, // Ubica la tarjeta en su sala temática correspondiente
            tipo: "automatica-ia",
            descripcion: "Generado automáticamente según el top de participación semanal.",
            imagen: "storycard/assets/images/default_cover.jpg",
            audioVoz: rutaRelativaVoz,
            musicaFondo: rutaRelativaMusica
        },
        {
            id: idUnico + 2,
            titulo: `Desafío Interactivo de ${mejorTematica}`,
            tematica: mejorTematica,
            tipo: "automatica-ia",
            descripcion: "Diseñado para cubrir las áreas de mejora detectadas en las estadísticas.",
            imagen: "storycard/assets/images/default_cover.jpg",
            audioVoz: rutaRelativaVoz,
            musicaFondo: rutaRelativaMusica
        }
    ];

    // 6. Actualizar el archivo de base de datos JSON de la web
    const rutaJson = path.join(__dirname, '../data/storycards.json');
    let listaActual = [];
    if (fs.existsSync(rutaJson)) {
        listaActual = JSON.parse(fs.readFileSync(rutaJson, 'utf8'));
    }

    const listaActualizada = [...nuevasCards, ...listaActual];
    fs.writeFileSync(rutaJson, JSON.stringify(listaActualizada, null, 2));
    
    console.log("¡2 nuevas Storycards con sus audios y música integradas con éxito!");
}

ejecutarPipelineMultimedia();
