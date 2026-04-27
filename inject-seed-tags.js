const mongoose = require('mongoose');
const TagMap = require('./src/models/TagMap'); // Ajusta la ruta a tu modelo
require('dotenv').config();

// 🚀 PEGA AQUÍ EL JSON QUE TE ENTREGUE LA IA
const SEED_TAGS = [

  { "original": "naruto", "canonical": "naruto", "category": "Anime" },
  { "original": "goku", "canonical": "goku", "category": "Anime" },
  { "original": "tanjiro", "canonical": "tanjiro", "category": "Anime" },
  { "original": "luffy", "canonical": "luffy", "category": "Anime" },
  { "original": "ichigo", "canonical": "ichigo", "category": "Anime" },
  { "original": "saitama", "canonical": "saitama", "category": "Anime" },
  { "original": "levi", "canonical": "levi", "category": "Anime" },
  { "original": "mikasa", "canonical": "mikasa", "category": "Anime" },
  { "original": "sasuke", "canonical": "sasuke", "category": "Anime" },
  { "original": "nezuko", "canonical": "nezuko", "category": "Anime" },

  { "original": "neón", "canonical": "neon", "category": "Cyberpunk" },
  { "original": "ciudad futura", "canonical": "future city", "category": "Cyberpunk" },
  { "original": "hacker", "canonical": "hacker", "category": "Cyberpunk" },
  { "original": "androide", "canonical": "android", "category": "Cyberpunk" },
  { "original": "ciborg", "canonical": "cyborg", "category": "Cyberpunk" },
  { "original": "lluvia urbana", "canonical": "urban rain", "category": "Cyberpunk" },
  { "original": "calle neón", "canonical": "neon street", "category": "Cyberpunk" },
  { "original": "pantalla holográfica", "canonical": "hologram screen", "category": "Cyberpunk" },

  { "original": "bosque", "canonical": "forest", "category": "Nature" },
  { "original": "montaña", "canonical": "mountain", "category": "Nature" },
  { "original": "océano", "canonical": "ocean", "category": "Nature" },
  { "original": "cascada", "canonical": "waterfall", "category": "Nature" },
  { "original": "atardecer", "canonical": "sunset", "category": "Nature" },
  { "original": "lago", "canonical": "lake", "category": "Nature" },
  { "original": "selva", "canonical": "jungle", "category": "Nature" },
  { "original": "desierto", "canonical": "desert", "category": "Nature" },

  { "original": "coche", "canonical": "car", "category": "Vehicles" },
  { "original": "moto", "canonical": "motorcycle", "category": "Vehicles" },
  { "original": "avión", "canonical": "airplane", "category": "Vehicles" },
  { "original": "barco", "canonical": "boat", "category": "Vehicles" },
  { "original": "camión", "canonical": "truck", "category": "Vehicles" },
  { "original": "ferrari", "canonical": "ferrari", "category": "Vehicles" },
  { "original": "lamborghini", "canonical": "lamborghini", "category": "Vehicles" },
  { "original": "helicóptero", "canonical": "helicopter", "category": "Vehicles" },

  { "original": "calavera", "canonical": "skull", "category": "Dark" },
  { "original": "sombra", "canonical": "shadow", "category": "Dark" },
  { "original": "fantasma", "canonical": "ghost", "category": "Dark" },
  { "original": "cementerio", "canonical": "cemetery", "category": "Dark" },
  { "original": "noche", "canonical": "night", "category": "Dark" },
  { "original": "luna llena", "canonical": "full moon", "category": "Dark" },
  { "original": "cuervo", "canonical": "raven", "category": "Dark" },
  { "original": "niebla", "canonical": "fog", "category": "Dark" },

  { "original": "galaxia", "canonical": "galaxy", "category": "Space" },
  { "original": "estrella", "canonical": "star", "category": "Space" },
  { "original": "planeta", "canonical": "planet", "category": "Space" },
  { "original": "astronauta", "canonical": "astronaut", "category": "Space" },
  { "original": "cohete", "canonical": "rocket", "category": "Space" },
  { "original": "vía láctea", "canonical": "milky way", "category": "Space" },
  { "original": "nebulosa", "canonical": "nebula", "category": "Space" },
  { "original": "agujero negro", "canonical": "black hole", "category": "Space" },

  { "original": "geometría", "canonical": "geometry", "category": "Abstract" },
  { "original": "patrón", "canonical": "pattern", "category": "Abstract" },
  { "original": "línea", "canonical": "line", "category": "Abstract" },
  { "original": "forma", "canonical": "shape", "category": "Abstract" },
  { "original": "color", "canonical": "color", "category": "Abstract" },
  { "original": "gradiente", "canonical": "gradient", "category": "Abstract" },
  { "original": "fractal", "canonical": "fractal", "category": "Abstract" },
  { "original": "onda", "canonical": "wave", "category": "Abstract" },

  { "original": "minecraft", "canonical": "minecraft", "category": "Gaming" },
  { "original": "fortnite", "canonical": "fortnite", "category": "Gaming" },
  { "original": "halo", "canonical": "halo", "category": "Gaming" },
  { "original": "zelda", "canonical": "zelda", "category": "Gaming" },
  { "original": "mario", "canonical": "mario", "category": "Gaming" },
  { "original": "pixel", "canonical": "pixel", "category": "Gaming" },
  { "original": "control", "canonical": "controller", "category": "Gaming" },
  { "original": "consola", "canonical": "console", "category": "Gaming" },

  { "original": "ciudad", "canonical": "city", "category": "Architecture" },
  { "original": "rascacielo", "canonical": "skyscraper", "category": "Architecture" },
  { "original": "puente", "canonical": "bridge", "category": "Architecture" },
  { "original": "castillo", "canonical": "castle", "category": "Architecture" },
  { "original": "templo", "canonical": "temple", "category": "Architecture" },
  { "original": "catedral", "canonical": "cathedral", "category": "Architecture" },
  { "original": "edificio", "canonical": "building", "category": "Architecture" },
  { "original": "torre", "canonical": "tower", "category": "Architecture" },

  { "original": "león", "canonical": "lion", "category": "Animals" },
  { "original": "tigre", "canonical": "tiger", "category": "Animals" },
  { "original": "lobo", "canonical": "wolf", "category": "Animals" },
  { "original": "águila", "canonical": "eagle", "category": "Animals" },
  { "original": "perro", "canonical": "dog", "category": "Animals" },
  { "original": "gato", "canonical": "cat", "category": "Animals" },
  { "original": "caballo", "canonical": "horse", "category": "Animals" },
  { "original": "delfín", "canonical": "dolphin", "category": "Animals" },

  { "original": "batman", "canonical": "batman", "category": "Superheroes" },
  { "original": "spiderman", "canonical": "spiderman", "category": "Superheroes" },
  { "original": "superman", "canonical": "superman", "category": "Superheroes" },
  { "original": "ironman", "canonical": "ironman", "category": "Superheroes" },
  { "original": "hulk", "canonical": "hulk", "category": "Superheroes" },
  { "original": "thor", "canonical": "thor", "category": "Superheroes" },
  { "original": "flash", "canonical": "flash", "category": "Superheroes" },
  { "original": "wonder woman", "canonical": "wonder woman", "category": "Superheroes" },

  { "original": "acuarela", "canonical": "watercolor", "category": "Artistic" },
  { "original": "óleo", "canonical": "oil painting", "category": "Artistic" },
  { "original": "dibujo", "canonical": "drawing", "category": "Artistic" },
  { "original": "ilustración", "canonical": "illustration", "category": "Artistic" },
  { "original": "minimalismo", "canonical": "minimalism", "category": "Artistic" },
  { "original": "collage", "canonical": "collage", "category": "Artistic" },
  { "original": "boceto", "canonical": "sketch", "category": "Artistic" },
  { "original": "arte digital", "canonical": "digital art", "category": "Artistic" },

  { "original": "aurora", "canonical": "aurora", "category": "Nature" },
  { "original": "volcán", "canonical": "volcano", "category": "Nature" },
  { "original": "submarino", "canonical": "submarine", "category": "Vehicles" },
  { "original": "robot", "canonical": "robot", "category": "Cyberpunk" }
];

const injectTags = async () => {
    try {
        console.log('📡 Conectando a MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conexión exitosa.\n');

        if (!SEED_TAGS || SEED_TAGS.length === 0) {
            console.error("❌ No hay datos en SEED_TAGS para inyectar.");
            process.exit(1);
        }

        console.log(`⏳ Procesando ${SEED_TAGS.length} etiquetas...`);

        // Convertimos los datos en operaciones de MongoDB
        const operations = SEED_TAGS.map(item => {
            const cleanOriginal = item.original.toLowerCase().trim();
            const cleanCanonical = item.canonical.toLowerCase().trim();

            return {
                updateOne: {
                    // Criterio: Si el "original" ya existe, lo actualizamos
                    filter: { original: cleanOriginal },
                    update: { 
                        $set: { 
                            canonical: cleanCanonical,
                            category: item.category,
                            // Detectamos idioma automáticamente por seguridad
                            language: /[áéíóúñ]/i.test(cleanOriginal) ? 'es' : 'en' 
                        } 
                    },
                    upsert: true // 👈 Si no existe, lo crea. Si existe, lo ignora/actualiza.
                }
            };
        });

        // Ejecutamos todo de un solo golpe
        const result = await TagMap.bulkWrite(operations);

        console.log('\n=========================================');
        console.log('   ✨ INYECCIÓN DE SEMILLA COMPLETADA ✨');
        console.log('=========================================');
        console.log(` - Etiquetas procesadas:  ${SEED_TAGS.length}`);
        console.log(` - Nuevas creadas:        ${result.upsertedCount}`);
        console.log(` - Etiquetas actualizadas: ${result.modifiedCount}`);
        console.log('=========================================\n');

        console.log('🎯 Tu diccionario maestro está listo.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error crítico durante la inyección:', error);
        process.exit(1);
    }
};

injectTags();