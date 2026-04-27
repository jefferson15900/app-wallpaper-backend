require('dotenv').config();
const mongoose = require('mongoose');
const TagMap = require('../src/models/TagMap');
const Wallpaper = require('../src/models/Wallpaper');

const TRANSLATIONS = {
"3d": "3d",
"animacion 3d": "3d animation",
"accion": "action",
"tierno": "adorable",
"aventura": "adventure",
"akatsuki": "akatsuki",
"enojado": "angry",
"animal": "animal",
"animacion": "animation",
"armadura": "armor",
"asfalto": "asphalt",
"astronauta": "astronaut",
"batman": "batman",
"playa": "beach",
"beige": "beige",
"ojos grandes": "big eye",
"pajaro": "bird",
"negro": "black",
"negro y dorado": "black and gold",
"negro y gris": "black and gray",
"negro y rojo": "black and red",
"sangre": "blood",
"azul": "blue",
"azul y naranja": "blue and orange",
"ojo azul": "blue eye",
"marron": "brown",
"burbuja": "bubble",
"borgoña": "burgundy",
"capa": "cape",
"carro": "car",
"coche": "car",
"dibujo animado": "cartoon",
"gato": "cat",
"cadena": "chain",
"infantil": "childlike",
"ciudad": "city",
"paisaje urbano": "cityscape",
"comic": "comic",
"contraste": "contrast",
"cosmico": "cosmic",
"carmesi": "crimson",
"cuervo": "crow",
"curioso": "curious",
"curva": "curve",
"lindo": "cute",
"cyberpunk": "cyberpunk",
"oscuro": "dark",
"estetica oscura": "dark aesthetic",
"azul oscuro": "dark blue",
"fantasia oscura": "dark fantasy",
"deadpool": "deadpool",
"demonio": "demon",
"demon slayer": "demon slayer",
"profundidad": "depth",
"desierto": "desert",
"arte digital": "digital art",
"perro": "dog",
"doraemon": "doraemon",
"dragon": "dragon",
"dramatico": "dramatic",
"dinamico": "dynamic",
"pose dinamica": "dynamic pose",
"azul electrico": "electric blue",
"elegancia": "elegance",
"relieve": "embossed",
"energia": "energy",
"expresivo": "expressive",
"ojo": "eye",
"cara": "face",
"fantasia": "fantasy",
"pluma": "feather",
"personaje femenino": "female character",
"pelicula": "film",
"fuego": "fire",
"flor": "flower",
"fluido": "flowing",
"suave": "fluffy",
"liquido": "fluid",
"bosque": "forest",
"zorro": "fox",
"luna llena": "full moon",
"pelaje": "fur",
"peludo": "furry",
"futurista": "futuristic",
"geometrico": "geometric",
"niña": "girl",
"cristal": "glass",
"gafas": "glasses",
"sombrio": "gloomy",
"brillante": "glossy",
"brillo": "glow",
"ojo brillante": "glowing eye",
"ojo rojo brillante": "glowing red eye",
"gafas protectoras": "goggle",
"goku": "goku",
"dorado": "gold",
"gotico": "gothic",
"degradado": "gradient",
"grafiti": "graffiti",
"grafico": "graphic",
"gris": "gray",
"verde": "green",
"ojo verde": "green eye",
"gruñon": "grumpy",
"feliz": "happy",
"faro": "headlight",
"corazon": "heart",
"capucha": "hood",
"sudadera": "hoodie",
"horizonte": "horizon",
"cuerno": "horn",
"terror": "horror",
"ichigo": "ichigo kurosaki",
"expresion intensa": "intense expression",
"mirada intensa": "intense gaze",
"itachi": "itachi uchiha",
"jin": "jin",
"joker": "joker",
"jujutsu kaisen": "jujutsu kaisen",
"kakashi": "kakashi hatake",
"katana": "katana",
"caballero": "knight",
"lava": "lava",
"letras": "lettering",
"iluminacion": "lighting",
"rayo": "lightning",
"liquido": "liquid",
"logo": "logo",
"pelo largo negro": "long black hair",
"luffy": "luffy",
"luminoso": "luminous",
"lujo": "luxury",
"madara": "madara uchiha",
"magenta": "magenta",
"personaje masculino": "male character",
"manga": "manga",
"manhwa": "manhwa",
"mario": "mario",
"mascara": "mask",
"metalico": "metallic",
"miles morales": "miles morales",
"minimalista": "minimalist",
"minion": "minion",
"monocromatico": "monochromatic",
"monstruo": "monster",
"luna": "moon",
"montaña": "mountain",
"bigote": "mustache",
"mistico": "mystical",
"naruto": "naruto uzumaki",
"neon": "neon",
"brillo neon": "neon glow",
"verde neon": "neon green",
"morado neon": "neon purple",
"ninja": "ninja",
"nintendo": "nintendo",
"oceano": "ocean",
"mar": "ocean",
"naranja": "orange",
"naranja y negro": "orange and black",
"naranja y azul": "orange and blue",
"organico": "organic",
"palmera": "palm tree",
"panda": "panda",
"particula": "particle",
"cacahuete": "peanut",
"rendimiento": "performance",
"rosa": "pink",
"pelo rosa": "pink hair",
"pirata": "pirate",
"planta": "plant",
"jugueton": "playful",
"peluche": "plush",
"pokemon": "pokemon",
"pop art": "pop art",
"porsche": "porsche",
"retrato": "portrait",
"perfil": "profile",
"psicodelico": "psychedelic",
"morado": "purple",
"fondo morado": "purple background",
"carreras": "racing",
"realismo": "realism",
"rojo": "red",
"rojo y negro": "red and black",
"rojo y azul": "red and blue",
"fondo rojo": "red background",
"ojo rojo": "red eye",
"pelo rojo": "red hair",
"luna roja": "red moon",
"reflejo": "reflection",
"robot": "robot",
"sukuna": "ryomen sukuna",
"samurai": "samurai",
"sasuke": "sasuke uchiha",
"gojo": "satoru gojo",
"sci-fi": "sci-fi",
"anime realista": "semi-realistic anime",
"serene": "serene",
"sombreado": "shading",
"sombra": "shadow",
"sharingan": "sharingan",
"diente afilado": "sharp tooth",
"silueta": "silhouette",
"plata": "silver",
"pelo plateado": "silver hair",
"esqueleto": "skeleton",
"calavera": "skull",
"rascacielos": "skyscraper",
"elegante": "sleek",
"sonrisa": "smile",
"sonriente": "smiling",
"suave": "smooth",
"zapatilla": "sneaker",
"snoopy": "snoopy",
"espacio": "space",
"velocidad": "speed",
"esfera": "sphere",
"spiderman": "spider-man",
"pelo puntiagudo": "spiky hair",
"salpicadura": "splash",
"mancha": "splatter",
"aleron": "spoiler",
"deporte": "sport",
"coche deportivo": "sports car",
"cielo estrellado": "starry sky",
"piedra": "stone",
"arte urbano": "street art",
"ropa urbana": "streetwear",
"estilizado": "stylized",
"verano": "summer",
"gafas de sol": "sunglasses",
"superdeportivo": "supercar",
"superheroe": "superhero",
"espiral": "swirl",
"espada": "sword",
"simbionte": "symbiote",
"synthwave": "synthwave",
"tanjiro": "tanjiro",
"tatuaje": "tattoo",
"cian": "teal",
"tecnologia": "technology",
"textura": "textured",
"tropical": "tropical",
"turquesa": "turquoise",
"tipografia": "typography",
"urbano": "urban",
"venom": "venom",
"videojuego": "video game",
"villano": "villain",
"violeta": "violet",
"colores calidos": "warm color",
"agua": "water",
"ola": "wave",
"ondulado": "wavy",
"fantasioso": "whimsical",
"bigote animal": "whisker",
"blanco": "white",
"pelo blanco": "white hair",
"madera": "wood",
"amarillo": "yellow",
"fondo amarillo": "yellow background"
};

const runMegaPurification = async () => {
    try {
        console.log('📡 Conectando a MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conexión exitosa. Iniciando proceso masivo...\n');

        const entries = Object.entries(TRANSLATIONS);
        let tagsUpdatedInDB = 0;

        // ── PASO 1: Actualizar diccionario en BULK ──────────────────────────
        const tagMapOps = entries.map(([original, canonical]) => ({
            updateOne: {
                filter: { original },
                update: { 
                    $set: { 
                        canonical, 
                        language: /[áéíóúñ]/i.test(original) ? 'es' : 'en' 
                    }
                },
                upsert: true
            }
        }));

        await TagMap.bulkWrite(tagMapOps, { ordered: false });
        console.log(`📚 Diccionario actualizado: ${tagMapOps.length} entradas\n`);

        // ── PASO 2: Actualizar wallpapers solo donde el tag cambia ──────────
        const changedEntries = entries.filter(([original, canonical]) => original !== canonical);

        // Procesamos en lotes para no saturar la DB
        const BATCH_SIZE = 50;
        for (let i = 0; i < changedEntries.length; i += BATCH_SIZE) {
            const batch = changedEntries.slice(i, i + BATCH_SIZE);

            await Promise.all(batch.map(async ([original, canonical]) => {
                // PASO A: Añadir canónico
                await Wallpaper.updateMany(
                    { tags: original },
                    { $addToSet: { tags: canonical } }
                );

                // PASO B: Quitar original
                const res = await Wallpaper.updateMany(
                    { tags: original },
                    { $pull: { tags: original } }
                );

                if (res.modifiedCount > 0) {
                    console.log(`✨ [${original}] -> [${canonical}] | ${res.modifiedCount} obras`);
                    tagsUpdatedInDB += res.modifiedCount;
                }
            }));

            console.log(`⏳ Lote ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(changedEntries.length / BATCH_SIZE)} completado`);
        }

        console.log(`\n=========================================`);
        console.log(`✅ PROCESO COMPLETADO EXITOSAMENTE`);
        console.log(`=========================================`);
        console.log(`📚 Tags en Diccionario:   ${tagMapOps.length}`);
        console.log(`🔧 Wallpapers corregidos: ${tagsUpdatedInDB}`);
        console.log(`🎯 Base de datos sincronizada.`);
        console.log(`=========================================`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error crítico:', error);
        process.exit(1);
    }
};

runMegaPurification();