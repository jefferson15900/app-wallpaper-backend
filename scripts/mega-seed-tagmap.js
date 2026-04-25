require('dotenv').config();
const mongoose = require('mongoose');
const TagMap = require('../src/models/TagMap');
const Wallpaper = require('../src/models/Wallpaper');

const TRANSLATIONS = {
// ══════════════════════════════════════════════
// 🚗 VEHÍCULOS
// ══════════════════════════════════════════════
"carros": "car", "autos": "car", "auto": "car",
"automovil": "car", "automoviles": "car",
"vehiculo": "car", "vehiculos": "car", "coches": "car",
"coche deportivo": "sports car", "superdeportivo": "supercar",
"motocicleta": "motorcycle", "moto": "motorcycle", "motos": "motorcycle",
"camion": "truck", "camiones": "truck",
"bicicleta": "bicycle", "bici": "bicycle",
"helicoptero": "helicopter", "avion": "airplane", "nave": "spaceship",
"nave espacial": "spaceship", "cohete": "rocket",

// ══════════════════════════════════════════════
// 🐾 ANIMALES
// ══════════════════════════════════════════════
"animales": "animal", "animals": "animal",
"gatos": "cat", "cats": "cat", "gatito": "cat", "gatitos": "cat", "felino": "cat",
"perros": "dog", "dogs": "dog", "perrito": "dog", "perritos": "dog", "cachorro": "dog",
"lobo": "wolf", "lobos": "wolf", "wolves": "wolf",
"leon": "lion", "leones": "lion", "lions": "lion",
"tigre": "tiger", "tigres": "tiger", "tigers": "tiger",
"oso": "bear", "osos": "bear", "bears": "bear",
"zorro": "fox", "zorros": "fox", "foxes": "fox",
"aguila": "eagle", "aguilas": "eagle",
"serpiente": "snake", "serpientes": "snake", "vibora": "snake",
"conejo": "rabbit", "conejos": "rabbit", "conejito": "rabbit",
"caballo": "horse", "caballos": "horse", "horses": "horse",
"delfin": "dolphin", "delfines": "dolphin",
"tiburon": "shark", "tiburones": "shark",
"pajaro": "bird", "pajaros": "bird", "birds": "bird",
"mariposa": "butterfly", "mariposas": "butterfly",
"dragones": "dragon", "dragons": "dragon",

// ══════════════════════════════════════════════
// 🌿 NATURALEZA
// ══════════════════════════════════════════════
"flores": "flower", "flowers": "flower", "floral": "flower",
"bosques": "forest", "forests": "forest",
"montañas": "mountain", "mountains": "mountain",
"oceanos": "ocean", "oceans": "ocean", "mares": "ocean",
"rios": "river", "rio": "river", "rivers": "river",
"cascada": "waterfall", "cascadas": "waterfall",
"lago": "lake", "lagos": "lake", "lakes": "lake",
"desiertos": "desert", "deserts": "desert",
"selva": "jungle", "jungla": "jungle",
"isla": "island", "islas": "island",
"volcán": "volcano", "volcan": "volcano", "volcanes": "volcano",
"aurora": "aurora", "aurora boreal": "aurora",
"galaxia": "galaxy", "galaxias": "galaxy",
"nebulosa": "nebula", "nebulosas": "nebula",
"planeta": "planet", "planetas": "planet", "planets": "planet",
"estrella": "star", "estrellas": "star", "stars": "star",
"cielo": "sky", "skies": "sky",
"nube": "cloud", "nubes": "cloud", "clouds": "cloud",
"lluvia": "rain", "lluvioso": "rain", "rains": "rain",
"nieve": "snow", "nevado": "snow", "snowy": "snow",
"tormenta": "storm", "tormentas": "storm", "storms": "storm",
"rayos": "lightning", "lightnings": "lightning",
"amanecer": "sunrise", "atardecer": "sunset",
"sol": "sun", "sunny": "sun", "soleado": "sun",
"arbol": "tree", "arboles": "tree", "trees": "tree",
"hoja": "leaf", "hojas": "leaf", "leaves": "leaf",
"hierba": "grass", "pasto": "grass",

// ══════════════════════════════════════════════
// 🏙️ LUGARES
// ══════════════════════════════════════════════
"ciudades": "city", "cities": "city",
"pueblo": "town", "pueblos": "town",
"edificio": "building", "edificios": "building", "buildings": "building",
"rascacielos": "skyscraper", "skyscrapers": "skyscraper",
"calle": "street", "calles": "street", "streets": "street",
"puente": "bridge", "puentes": "bridge", "bridges": "bridge",
"castillo": "castle", "castillos": "castle", "castles": "castle",
"templo": "temple", "templos": "temple", "temples": "temple",
"ruinas": "ruins", "ruin": "ruins",
"japon": "japan", "japones": "japan", "japonesa": "japan",
"tokio": "tokyo",
"paris": "paris",
"new york": "new york", "nueva york": "new york",

// ══════════════════════════════════════════════
// 🎨 ESTILOS / ARTE
// ══════════════════════════════════════════════
"animes": "anime", "animé": "anime",
"mangas": "manga",
"ilustracion": "illustration", "ilustraciones": "illustration",
"acuarela": "watercolor", "acuarelas": "watercolor",
"oleo": "oil painting", "pintura al oleo": "oil painting",
"boceto": "sketch", "bocetos": "sketch", "sketches": "sketch",
"pixel art": "pixel art", "pixelado": "pixel art",
"minimalismo": "minimalist", "minimalista": "minimalist",
"abstracto": "abstract", "abstraccion": "abstract",
"surrealista": "surreal", "surrealismo": "surreal",
"realista": "realistic", "realismo": "realism",
"retro": "retro", "vintage": "retro",
"steampunk": "steampunk",
"synthwave": "synthwave", "retrowave": "synthwave",
"vaporwave": "vaporwave",
"lofi": "lofi", "lo-fi": "lofi",

// ══════════════════════════════════════════════
// 🎮 VIDEOJUEGOS / ANIME POPULARES
// ══════════════════════════════════════════════
"one piece": "one piece",
"dragon ball": "dragon ball", "dragon ball z": "dragon ball",
"bleach": "bleach",
"attack on titan": "attack on titan", "shingeki": "attack on titan",
"my hero academia": "my hero academia", "boku no hero": "my hero academia",
"demon slayer": "demon slayer", "kimetsu": "demon slayer",
"jujutsu kaisen": "jujutsu kaisen",
"solo leveling": "solo leveling",
"chainsaw man": "chainsaw man",
"zelda": "zelda", "link": "zelda",
"minecraft": "minecraft",
"fortnite": "fortnite",
"league of legends": "league of legends", "lol": "league of legends",
"valorant": "valorant",
"genshin": "genshin impact", "genshin impact": "genshin impact",
"cyberpunk 2077": "cyberpunk",

// ══════════════════════════════════════════════
// 🦸 SUPERHÉROES / PERSONAJES
// ══════════════════════════════════════════════
"spider man": "spider-man", "spiderman": "spider-man",
"iron man": "ironman", "hombre de hierro": "ironman",
"capitan america": "captain america", "captain america": "captain america",
"thor": "thor",
"hulk": "hulk",
"black panther": "black panther", "pantera negra": "black panther",
"wonder woman": "wonder woman", "mujer maravilla": "wonder woman",
"superman": "superman", "hombre de acero": "superman",
"flash": "flash",
"aquaman": "aquaman",
"wolverine": "wolverine", "lobezno": "wolverine",
"magneto": "magneto",
"doctor strange": "doctor strange",
"wanda": "wanda", "scarlet witch": "wanda",
"groot": "groot",
"rocket": "rocket raccoon",

// ══════════════════════════════════════════════
// 🎨 COLORES
// ══════════════════════════════════════════════
"rojos": "red", "reds": "red",
"azules": "blue", "blues": "blue",
"verdes": "green", "greens": "green",
"amarillos": "yellow", "yellows": "yellow",
"naranjas": "orange",
"morados": "purple", "purples": "purple",
"rosados": "pink", "pinks": "pink",
"blancos": "white",
"negros": "black",
"grises": "gray", "gris": "gray",
"dorados": "gold", "golds": "gold",
"plateados": "silver",
"turquesa": "turquoise",
"cian": "cyan",
"coral": "coral",
"lavanda": "lavender",
"indigo": "indigo",
"escarlata": "scarlet",
"carmesi": "crimson",

// ══════════════════════════════════════════════
// 😊 EMOCIONES / MOOD
// ══════════════════════════════════════════════
"felicidad": "happy", "alegre": "happy", "alegria": "happy",
"tristeza": "sad", "triste": "sad",
"enojo": "angry", "ira": "angry", "furia": "angry",
"miedo": "scary", "aterrador": "scary", "espantoso": "scary",
"tranquilo": "peaceful", "paz": "peaceful", "calma": "peaceful",
"misterioso": "mysterious", "misterio": "mysterious",
"romantico": "romantic", "romance": "romantic",
"melancolico": "melancholic", "nostalgia": "melancholic",
"epico": "epic", "epica": "epic",
"poderoso": "powerful", "poder": "powerful",
"magico": "magical", "magia": "magical",

// ══════════════════════════════════════════════
// ⚔️ ELEMENTOS DE ACCIÓN / FANTASÍA
// ══════════════════════════════════════════════
"espadas": "sword", "swords": "sword",
"katanas": "katana", "katanas": "katana",
"arco": "bow", "flecha": "arrow", "flechas": "arrow",
"escudo": "shield", "escudos": "shield",
"magia": "magic", "hechizo": "magic", "hechizos": "magic",
"explosion": "explosion", "explosiones": "explosion",
"batalla": "battle", "batallas": "battle", "guerra": "war",
"guerrero": "warrior", "guerreros": "warrior", "warriors": "warrior",
"caballeros": "knight", "knights": "knight",
"samurais": "samurai",
"ninjas": "ninja",
"vampiro": "vampire", "vampiros": "vampire",
"zombi": "zombie", "zombie": "zombie", "zombies": "zombie",
"bruja": "witch", "brujas": "witch", "brujo": "witch",
"angel": "angel", "angeles": "angel", "angels": "angel",
"demonio": "demon", "demonios": "demon", "demons": "demon",
"hada": "fairy", "hadas": "fairy", "fairies": "fairy",
"elfo": "elf", "elfos": "elf", "elves": "elf",
"enano": "dwarf", "enanos": "dwarf",

// ══════════════════════════════════════════════
// 🌙 ESPACIO / CIENCIA FICCIÓN
// ══════════════════════════════════════════════
"espacial": "space", "spaces": "space", "cosmos": "space",
"universo": "universe", "universos": "universe",
"galaxias": "galaxy", "galactic": "galaxy",
"alien": "alien", "alienigena": "alien", "extraterrestre": "alien",
"robot": "robot", "robots": "robot", "androide": "robot",
"cyborg": "cyborg",
"nave espacial": "spaceship", "naves": "spaceship",
"astronautas": "astronaut", "astronauts": "astronaut",
"luna llena": "full moon", "lunas": "moon", "moons": "moon",
"eclipse": "eclipse",
"cometa": "comet", "cometas": "comet",
"meteoro": "meteor", "meteorito": "meteor",
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