const nlp = require('compromise');

// Listado de etiquetas que la IA o los usuarios ponen pero no aportan valor real
const BLACKLIST_TAGS = new Set([
  // ── CALIDAD / TÉCNICA ─────────────────────────────────────
  'high quality', 'best quality', 'ultra quality', 'top quality', 'premium quality',
  'high resolution', 'ultra high resolution', 'ultra hd', 'uhd', 'fhd', 'full hd',
  '4k', '8k', '16k', 'hd', 'highres', 'hi res', 'hi-res',
  'masterpiece', 'best masterpiece', 'top masterpiece',
  'sharp', 'sharp focus', 'sharp image', 'in focus',
  'intricate', 'intricate details', 'intricate design',
  'highly detailed', 'detailed', 'very detailed', 'ultra detailed', 'super detailed',
  'extremely detailed', 'insanely detailed', 'richly detailed',
  'hyperrealistic', 'hyper-realistic', 'hyper realistic',
  'photorealistic', 'photo realistic', 'photo-realistic',
  'raw photo', 'raw image', 'dslr', 'dslr photo',
  'professional photo', 'professional photograph', 'professional photography',
  'perfect composition', 'perfect lighting', 'perfect details',
  'high detail', 'fine detail', 'fine details', 'maximum detail',
  'studio quality', 'film quality', 'movie quality', 'mecánica expuesta',

  // ── ILUMINACIÓN GENÉRICA ──────────────────────────────────
  'soft lighting', 'soft light', 'soft lights',
  'dramatic lighting', 'dramatic light',
  'cinematic lighting', 'cinematic light',
  'natural lighting', 'natural light',
  'studio lighting', 'studio light',
  'rim lighting', 'rim light',
  'ambient lighting', 'ambient light', 'ambient occlusion',
  'god rays', 'god ray', 'sun rays', 'sun ray', 'sunbeam', 'sunbeams',
  'backlight', 'backlighting', 'back light',
  'bloom', 'lens flare', 'light rays', 'volumetric lighting', 'volumetric light',
  'global illumination', 'ray tracing', 'ray-tracing', 'raytracing',
  'subsurface scattering', 'specular', 'specular highlight',
  'iluminación', 'iluminación dramática', 'iluminación cinematográfica',
  'iluminación suave', 'luz natural', 'luz de estudio',

  // ── CÁMARA / COMPOSICIÓN ──────────────────────────────────
  'depth of field', 'shallow depth of field', 'deep depth of field',
  'bokeh', 'bokeh background', 'bokeh effect',
  'centered', 'center composition', 'centered composition',
  'symmetrical', 'symmetry', 'perfect symmetry',
  'close up', 'closeup', 'close-up', 'extreme close up',
  'wide shot', 'wide angle', 'wide-angle',
  'full body', 'half body', 'upper body', 'from above', 'from below',
  'bird eye view', 'top view', 'top down', 'aerial view',
  'portrait', 'landscape format', 'panoramic',
  'rule of thirds', 'golden ratio',
  'tilt shift', 'fisheye', 'fisheye lens',
  'zoom', 'telephoto', 'macro', 'macro shot', 'macro photography',
  'long exposure', 'motion blur',

  // ── ESTILOS DEMASIADO AMPLIOS ─────────────────────────────
  'digital art', 'arte digital',
  'digital illustration', 'ilustración digital',
  'illustration', 'ilustración',
  'drawing', 'dibujo',
  'painting', 'pintura',
  'sketch', 'boceto',
  'concept art', 'concept design', 
  'fan art', 'fanart','anime',
  'anime style', 'estilo anime', 'anime art',
  'manga style', 'estilo manga', 'manga art',
  'cartoon style', 'cartoonish',
  'comic style', 'estilo cómic', 'comic book style', 'comic book',
  'realistic', 'realista',
  'cinematic', 'cinematográfico',
  'artistic', 'artístico',
  'abstract art', 'arte abstracto',
  'minimalist', 'minimalista', 'minimalistic',
  'surreal', 'surrealista', 'surrealism', 'surrealismo',
  'impressionist', 'impressionism',
  'watercolor', 'watercolour', 'acuarela',
  'oil painting', 'pintura al óleo',
  'pencil art', 'pencil drawing', 'charcoal', 'charcoal drawing',
  'vector', 'vector art', 'vector illustration',
  'flat design', 'flat art', 'flat style',
  '2d art', '3d art', '2.5d',
  'pixel art', 'pixelart', 'pixel',
  'low poly', 'low-poly', 'lowpoly',
  'isometric', 'isometric art',
  'chibi', 'chibi style',

  // ── RENDER / SOFTWARE / MOTORES ──────────────────────────
  'render', '3d render', 'rendered', '3d rendered',
  'cgi', 'vfx',
  'unreal engine', 'unreal engine 5', 'ue5', 'ue4',
  'vray', 'v-ray',
  'octane render', 'octane', 'corona render',
  'cycles render', 'eevee',
  'blender', 'blender 3d',
  'cinema 4d', 'c4d',
  'zbrush', 'maya', 'houdini', '3ds max',
  'keyshot', 'arnold render',
  'stable diffusion', 'sd', 'sdxl',
  'midjourney', 'mj',
  'dalle', 'dall-e', 'dall e',
  'comfyui', 'automatic1111', 'a1111',
  'novelai', 'novel ai',
  'leonardo ai', 'adobe firefly', 'firefly',
  'controlnet', 'lora', 'dreambooth',

  // ── PLATAFORMAS Y FORMATOS ────────────────────────────────
  'wallpaper', 'wallpapers',
  'background', 'backgrounds',
  'fondo', 'fondos', 'fondo de pantalla', 'fondos de pantalla',
  'pantalla', 'pantalla completa',
  'screensaver', 'screen',
  'artstation', 'deviantart', 'pixiv', 'behance', 'pinterest',
  'trending', 'trending on artstation', 'featured',
  'official art', 'key visual', 'cover art', 'book cover',
  'graphics', 'graphic design', 'diseño gráfico',
  'wallpaper hub', 'wallpaperhub', 'hub', 'otros', 'other','otro',

  // ── DESCRIPTORES VAGOS / RELLENO ─────────────────────────
  'beautiful', 'very beautiful', 'extremely beautiful',
  'amazing', 'amazing art', 'amazing artwork',
  'awesome', 'awesome art',
  'stunning', 'stunning art',
  'gorgeous', 'gorgeous art',
  'epic', 'epic art', 'epic scene',
  'cool', 'super cool',
  'perfect', 'flawless',
  'elegant', 'elegante',
  'unique', 'único', 'original',
  'incredible', 'increíble',
  'wonderful', 'maravilloso',
  'breathtaking', 'impresionante',
  'vivid', 'vibrant', 'colorful', 'colourful',
  'vivid colors', 'vibrant colors', 'rich colors',
  'colores vibrantes', 'colores vivos', 'colores ricos',
  'high contrast', 'alto contraste',
  'dark style', 'dark theme', 'dark background', 'dark bg',
  'black background', 'white background',
  'fondo oscuro', 'fondo negro', 'fondo blanco',

  // ── TOKENS DE PROMPT NEGATIVOS (se cuelan a veces) ───────
  'no watermark', 'without watermark', 'watermark free',
  'no text', 'without text', 'text free', 'no logo',
  'no blur', 'no noise', 'no grain',
  'nsfw', 'sfw', 'safe', 'safe for work',
  'censored', 'uncensored',

  // ── ACCIONES / POSES GENÉRICAS ────────────────────────────
  'standing', 'sitting', 'lying', 'lying down', 'walking', 'running',
  'looking at viewer', 'looking away', 'staring',
  'smiling', 'expressionless', 'serious',
  'arms crossed', 'hands on hips',

  // ── TÉRMINOS GENÉRICOS DE PERSONAJE ──────────────────────
  'character', 'character design', 'original character', 'oc',
  'humanoid', 'figure', 'silhouette',
  'male', 'female', 'boy', 'girl', 'man', 'woman',
  'hombre', 'mujer', 'chico', 'chica',
  'young', 'joven', 'adult', 'adulto',
  'cute', 'kawaii', 'lindo',
  'beautiful girl', 'beautiful woman', 'handsome',

  // ── AMBIENTE / ESCENARIO ULTRA GENÉRICO ──────────────────
  'scene', 'escena',
  'environment', 'entorno', 'ambiente',
  'landscape', 'paisaje',
  'background scene', 'escenario',
  'outdoor', 'indoor', 'exterior', 'interior',
  'day', 'night', 'día', 'noche',
  'sunrise', 'sunset', 'amanecer', 'atardecer',
  'sky', 'cielo', 'clouds', 'nubes',
  'nature', 'naturaleza',
  'dark', 'oscuro', 'bright', 'brillante',

  // ── PINTEREST / MOOD BOARDS ───────────────────────────────
'aesthetic', 'aesthetics', 'estética',
'vibes', 'vibe', 'mood', 'moody',
'inspo', 'inspiration', 'inspiración', 'inspired',
'goals', 'life goals', 'dream',
'vision board', 'moodboard', 'mood board',
'core', 'that girl', 'clean girl',
'cottagecore', 'darkacademia', 'dark academia',
'lightacademia', 'light academia',
'royalcore', 'angelcore', 'fairycore',
'goblincore', 'weirdcore', 'dreamcore',
'retrofuturism', 'y2k aesthetic',

// ── LIFESTYLE VACÍO ───────────────────────────────────────
'minimal', 'clean', 'simple', 'sencillo',
'soft', 'suave', 'cozy', 'acogedor',
'dreamy', 'ethereal', 'etéreo',
'magical', 'mágico', 'mystic', 'místico',
'romantic', 'romántico',
'mysterious', 'misterioso',
'vintage', 'retro', 'old school',
'modern', 'moderno', 'contemporary','semi-realistic anime',
'luxury', 'lujoso', 'premium',
'grunge', 'edgy',
'pastel', 'pastel colors', 'pastel aesthetic',
'neutral', 'neutral tones', 'neutral colors',
'earth tones', 'tonos tierra',
'monochrome', 'monocromático', 'black and white', 'blanco y negro',
'golden', 'dorado', 'gold aesthetic',

// ── FRASES DE CAPTION ────────────────────────────────────
'follow for more', 'like this', 'save this',
'pin it', 'repin', 'share',
'credit to owner', 'not mine', 'found on pinterest',
'source unknown', 'via pinterest',
'tap for more', 'swipe',
]);

const VAGUE_SINGLES = new Set([
  // ── INGLÉS ────────────────────────────────────
  // Medios / formato
  'art', 'image', 'photo', 'picture', 'photography',
  'style', 'design', 'render', 'content', 'media',
  'file', 'asset', 'work', 'piece', 'output',

  // Descripción vacía
  'look', 'feel', 'vibe', 'mood', 'tone',
  'thing', 'stuff', 'item', 'object', 'element',
  'type', 'kind', 'form', 'shape', 'figure',
  'color', 'colour', 'texture', 'pattern', 'detail',
  'effect', 'filter', 'layer', 'blend', 'mix',

  // Calificadores sin contexto
  'new', 'old', 'big', 'small', 'long', 'short',
  'top', 'best', 'good', 'bad', 'nice', 'cool',
  'real', 'true', 'fake', 'pure', 'raw', 'more',

  // ── ESPAÑOL ───────────────────────────────────
  // Medios / formato
  'arte', 'imagen', 'foto', 'estilo', 'diseño',
  'render', 'contenido', 'archivo', 'trabajo', 'pieza',

  // Descripción vacía
  'cosa', 'algo', 'objeto', 'elemento', 'tipo',
  'forma', 'figura', 'color', 'textura', 'patrón',
  'efecto', 'filtro', 'tono', 'mezcla',

  // Calificadores sin contexto
  'nuevo', 'viejo', 'grande', 'pequeño', 'largo', 'corto',
  'mejor', 'bueno', 'malo', 'bonito', 'real', 'puro',
]);
// ============================================================
// SINÓNIMOS: Colapsa términos equivalentes en uno solo
// Evita que "mar", "ocean" y "océano" sean 3 tags distintas
// ============================================================
const SYNONYMS = {

  // ══════════════════════════════════════════════
  // 🌊 AGUA / OCÉANO
  // ══════════════════════════════════════════════
  'océano': 'ocean', 'mar': 'ocean', 'sea': 'ocean',
  'ocean waves': 'ocean', 'waves': 'ocean',
  'olas': 'ocean', 'marea': 'ocean',

  // ══════════════════════════════════════════════
  // 🏖️ PLAYA
  // ══════════════════════════════════════════════
  'playa': 'beach', 'shore': 'beach', 'coast': 'beach',
  'costa': 'beach', 'seaside': 'beach', 'orilla': 'beach',
  'shoreline': 'beach', 'coastal': 'beach',

  // ══════════════════════════════════════════════
  // 🌲 BOSQUE
  // ══════════════════════════════════════════════
  'bosque': 'forest', 'selva': 'forest', 'woods': 'forest',
  'woodland': 'forest', 'jungle': 'forest', 'jungla': 'forest',
  'rainforest': 'forest', 'selva tropical': 'forest',
  'arboles': 'forest', 'árboles': 'forest', 'trees': 'forest',

  // ══════════════════════════════════════════════
  // 🏔️ MONTAÑA
  // ══════════════════════════════════════════════
  'montaña': 'mountain', 'mountains': 'mountain',
  'montañas': 'mountain', 'sierra': 'mountain',
  'peak': 'mountain', 'pico': 'mountain', 'cumbre': 'mountain',
  'summit': 'mountain', 'highland': 'mountain', 'cliff': 'mountain',
  'acantilado': 'mountain', 'cordillera': 'mountain',

  // ══════════════════════════════════════════════
  // 🏙️ CIUDAD
  // ══════════════════════════════════════════════
  'ciudad': 'city', 'cities': 'city', 'urban': 'city',
  'cityscape': 'city', 'skyline': 'city', 'metropolis': 'city',
  'downtown': 'city', 'town': 'city', 'pueblo': 'city',
  'street': 'city', 'calle': 'city', 'buildings': 'city',
  'edificios': 'city',

  // ══════════════════════════════════════════════
  // 🌌 ESPACIO
  // ══════════════════════════════════════════════
  'espacio': 'space', 'cosmos': 'space', 'universo': 'space',
  'universe': 'space', 'galaxy': 'space', 'galaxia': 'space',
  'nebula': 'space', 'nebulosa': 'space', 'stars': 'space',
  'estrellas': 'space', 'milky way': 'space', 'via láctea': 'space',
  'outer space': 'space', 'starfield': 'space', 'cosmos art': 'space',
  'planetary': 'space', 'planeta': 'space', 'planet': 'space',

  // ══════════════════════════════════════════════
  // 🔥 FUEGO
  // ══════════════════════════════════════════════
  'fuego': 'fire', 'flames': 'fire', 'llamas': 'fire',
  'flame': 'fire', 'burning': 'fire', 'ardiente': 'fire',
  'inferno': 'fire', 'blaze': 'fire', 'ember': 'fire',
  'brasas': 'fire', 'smoke': 'fire', 'humo': 'fire',

  // ══════════════════════════════════════════════
  // 💧 AGUA (general)
  // ══════════════════════════════════════════════
  'agua': 'water', 'lluvia': 'water', 'rain': 'water',
  'waterfall': 'water', 'cascada': 'water', 'river': 'water',
  'río': 'water', 'rio': 'water', 'lake': 'water', 'lago': 'water',
  'pond': 'water', 'estanque': 'water', 'stream': 'water',
  'arroyo': 'water', 'drop': 'water', 'gota': 'water',
  'splash': 'water', 'wet': 'water', 'húmedo': 'water',

  // ══════════════════════════════════════════════
  // ❄️ HIELO / NIEVE
  // ══════════════════════════════════════════════
  'hielo': 'ice', 'nieve': 'ice', 'snow': 'ice',
  'frozen': 'ice', 'congelado': 'ice', 'frost': 'ice',
  'escarcha': 'ice', 'glaciar': 'ice', 'glacier': 'ice',
  'arctic': 'ice', 'ártico': 'ice', 'winter': 'ice', 'invierno': 'ice',
  'snowflake': 'ice', 'copo de nieve': 'ice',

  // ══════════════════════════════════════════════
  // 🏜️ DESIERTO
  // ══════════════════════════════════════════════
  'desierto': 'desert', 'sand': 'desert', 'arena': 'desert',
  'dunes': 'desert', 'dunas': 'desert', 'arid': 'desert',
  'árido': 'desert', 'sahara': 'desert', 'dry land': 'desert',

  // ══════════════════════════════════════════════
  // 🌸 FLORES / PLANTAS
  // ══════════════════════════════════════════════
  'flores': 'flowers', 'flower': 'flowers', 'floral': 'flowers',
  'blossom': 'flowers', 'bloom': 'flowers', 'petal': 'flowers',
  'pétalos': 'flowers', 'rosa': 'flowers',   // ⚠️ puede colisionar con color rosa
  'rose': 'flowers', 'cherry blossom': 'flowers', 'sakura': 'flowers',
  'lavender': 'flowers', 'lavanda': 'flowers',
  'plantas': 'plants', 'plant': 'plants', 'vegetation': 'plants',
  'vegetación': 'plants', 'leaves': 'plants', 'hojas': 'plants',
  'leaf': 'plants', 'hoja': 'plants', 'moss': 'plants', 'musgo': 'plants',
  'grass': 'plants', 'césped': 'plants', 'hierba': 'plants',

  // ══════════════════════════════════════════════
  // 🐉 DRAGÓN
  // ══════════════════════════════════════════════
  'dragón': 'dragon', 'dragons': 'dragon', 'dragones': 'dragon',
  'drake': 'dragon', 'wyvern': 'dragon',

  // ══════════════════════════════════════════════
  // 🐺 ANIMALES / FAUNA
  // ══════════════════════════════════════════════
  'lobo': 'wolf', 'wolves': 'wolf', 'lobos': 'wolf',
  'leon': 'lion', 'león': 'lion', 'lions': 'lion',
  'tigre': 'tiger', 'tigers': 'tiger',
  'oso': 'bear', 'bears': 'bear',
  'aguila': 'eagle', 'águila': 'eagle', 'eagles': 'eagle',
  'cuervo': 'crow', 'raven': 'crow', 'ravens': 'crow',
  'serpiente': 'snake', 'serpent': 'snake', 'snakes': 'snake',
  'zorro': 'fox', 'foxes': 'fox',
  'gato': 'cat', 'cats': 'cat', 'kitten': 'cat', 'feline': 'cat',
  'perro': 'dog', 'dogs': 'dog', 'puppy': 'dog', 'canine': 'dog',
  'caballo': 'horse', 'horses': 'horse', 'stallion': 'horse',
  'mariposa': 'butterfly', 'butterflies': 'butterfly',
  'deer': 'deer', 'ciervo': 'deer', 'stag': 'deer', 'venado': 'deer',

  // ══════════════════════════════════════════════
  // ⚔️ FANTASÍA / MEDIEVAL
  // ══════════════════════════════════════════════
  'espada': 'sword', 'swords': 'sword', 'blade': 'sword',
  'knight': 'knight', 'caballero': 'knight', 'warrior': 'knight',
  'guerrero': 'warrior',
  'castle': 'castle', 'castillo': 'castle', 'fortress': 'castle',
  'fortaleza': 'castle',
  'magic': 'magic', 'magia': 'magic', 'magical': 'magic',
  'wizard': 'wizard', 'mago': 'wizard', 'mage': 'wizard', 'bruja': 'wizard',
  'witch': 'witch',
  'elf': 'elf', 'elfo': 'elf', 'elves': 'elf',
  'demon': 'demon', 'demonio': 'demon', 'demons': 'demon',
  'angel': 'angel', 'ángel': 'angel', 'angels': 'angel',

  // ══════════════════════════════════════════════
  // 🤖 CYBERPUNK / SCI-FI
  // ══════════════════════════════════════════════
  'robot': 'robot', 'robots': 'robot', 'mech': 'robot', 'mecha': 'robot',
  'cyborg': 'cyborg', 'android': 'cyborg',
  'futurista': 'futuristic', 'futuristic': 'futuristic', 'futuro': 'futuristic',
  'neon': 'neon', 'neón': 'neon', 'neon lights': 'neon',
  'cyberpunk city': 'cyberpunk',
  'sci fi': 'scifi', 'science fiction': 'scifi', 'ciencia ficción': 'scifi',
  'spaceship': 'spaceship', 'nave espacial': 'spaceship', 'spacecraft': 'spaceship',

  // ══════════════════════════════════════════════
  // 🎌 JAPÓN / ASIA
  // ══════════════════════════════════════════════
  'japón': 'japan', 'japanese': 'japan', 'japonés': 'japan',
  'tokyo': 'japan', 'tokio': 'japan',
  'animé': 'anime', 'animated': 'anime',
  'samurai': 'samurai', 'ninja': 'ninja',
  'torii': 'japan', 'pagoda': 'japan', 'templo': 'temple', 'temple': 'temple',

  // ══════════════════════════════════════════════
  // 🎨 ESTILOS ESPECÍFICOS (los que sí aportan)
  // ══════════════════════════════════════════════
  'minimalismo': 'minimalism',
  'surrealismo': 'surrealism',
  'impresionismo': 'impressionism',
  'retrofuturismo': 'retrofuturism', 'retro futurism': 'retrofuturism',
  'vaporwave': 'vaporwave', 'vapor wave': 'vaporwave',
  'lofi': 'lofi', 'lo fi': 'lofi', 'lo-fi': 'lofi',

  // ══════════════════════════════════════════════
  // 🌈 COLORES
  // ══════════════════════════════════════════════
  'rojo': 'red', 'azul': 'blue', 'verde': 'green',
  'negro': 'black', 'blanco': 'white', 'amarillo': 'yellow',
  'morado': 'purple', 'púrpura': 'purple', 'violeta': 'purple',
  'naranja': 'orange', 'rosa': 'pink', // ⚠️ ver nota flores arriba
  'gris': 'gray', 'grey': 'gray',
  'turquesa': 'turquoise', 'cyan': 'turquoise', 'cian': 'turquoise',
  'dorado': 'gold', 'golden': 'gold', 'oro': 'gold',
  'plateado': 'silver', 'silver': 'silver', 'plata': 'silver',
  'bronce': 'bronze',
  'beige': 'beige', 'crema': 'beige', 'cream': 'beige',
  'marrón': 'brown', 'marron': 'brown', 'brown': 'brown', 'café': 'brown',

  // ══════════════════════════════════════════════
  // 🌙 NOCHE / LUNA
  // ══════════════════════════════════════════════
  'luna': 'moon', 'moons': 'moon', 'moonlight': 'moon',
  'luz de luna': 'moon', 'crescent': 'moon', 'creciente': 'moon',
  'noche': 'night', 'nocturno': 'night', 'nocturnal': 'night', 'nighttime': 'night',
  'midnight': 'night', 'medianoche': 'night',

  // ══════════════════════════════════════════════
  // ☀️ SOL / DÍA
  // ══════════════════════════════════════════════
  'sol': 'sun', 'sunshine': 'sun', 'solar': 'sun', 'sunlight': 'sun',
  'luz solar': 'sun', 'sunny': 'sun',
  'amanecer': 'sunrise', 'dawn': 'sunrise', 'aurora': 'sunrise',
  'atardecer': 'sunset', 'dusk': 'sunset', 'twilight': 'sunset',
  'crepúsculo': 'sunset',

  // ══════════════════════════════════════════════
  // ⛩️ ARQUITECTURA
  // ══════════════════════════════════════════════
  'arquitectura': 'architecture', 'edificio': 'architecture',
  'building': 'architecture', 'ruins': 'ruins', 'ruinas': 'ruins',
  'abandoned': 'ruins', 'abandonado': 'ruins',
  'bridge': 'bridge', 'puente': 'bridge',
  'tower': 'tower', 'torre': 'tower',
  'lighthouse': 'lighthouse', 'faro': 'lighthouse',

  'rojo y negro': 'red and black', 'negro y rojo': 'red and black',
  'ojos brillante': 'glowing eyes', 'ojos rojos brillante': 'glowing eyes',
  'deportivo': 'sports car', 'coche deportivo': 'sports car',
  'auto': 'car', 'coche': 'car', 'automotive': 'car',
  'urbano': 'urban', 'estilo urbano': 'urban', 'urban style': 'urban',
  'fluido': 'fluid', 'fluidez': 'fluid',
  'reflejo': 'reflection',
  'ojo': 'eye', 'ojos': 'eye', 'eyes': 'eye',
  'sombra': 'shadow',
  'contraste': 'contrast', 'contraste alto': 'contrast',
  'velocidad': 'speed',
  'lujo': 'luxury',
  'gafa': 'glasses', 'gafa sol': 'glasses', 'sunglass': 'glasses',
  'brillo': 'glow', 'resplandor': 'glow', 'luminous': 'glow', 'luminoso': 'glow',
  'sonrisa': 'smile', 'sonriente': 'smile',
  'tatuaje': 'tattoo',
  'calavera': 'skull', 'calabera': 'skull',
  'luna llena': 'full moon',
  'paisaje urbano': 'city', 'rascacielo': 'city', 'skyscraper': 'city',
  'armadura': 'armor',
  'espacio': 'space', 'cosmico': 'cosmic',
  'tierno': 'adorable', 'playful': 'adorable',
  
  // --- Personajes (Unificación de nombres) ---
  'itachi uchiha': 'itachi',
  'gojo satoru': 'gojo', 'satoru gojo': 'gojo',
  'madara uchiha': 'madara',
  'naruto uzumaki': 'naruto',
  'sasuke uchiha': 'sasuke',
  'ryomen sukuna': 'sukuna',
  'kakashi hatake': 'kakashi',
  'miles morale': 'spiderman', 'hombre araña': 'spiderman',

};

/**
 * Limpia, normaliza y unifica etiquetas usando NLP (Compromise).
 * @param {unknown[]} tagsArray
 * @param {{ maxTags?: number, minLength?: number, maxLength?: number }} options
 * @returns {string[]}
 */
const cleanTags = (tagsArray, { maxTags = 20, minLength = 3, maxLength = 40 } = {}) => {
  if (!Array.isArray(tagsArray) || tagsArray.length === 0) return [];

  const seen = new Set();

  return tagsArray
    // 1. Filtro de tipo temprano (evita procesar basura)
    .filter(t => t != null && typeof t === 'string')

    // 2. Normalización básica
    .map(t =>
      t.toLowerCase()
       .trim() 
       .replace(/[^a-z0-9áéíóúüñ \-]/gi, '')
       .replace(/\s+/g, ' ')
       .trim()
    )
    .filter(Boolean)

    // 3. Normalización NLP: singular (con protección contra resultados vacíos/distorsionados)
    .map(t => {
      const singular = nlp(t).nouns().toSingular().text().trim();
      // Solo aceptar el resultado NLP si tiene sentido (no vacío y longitud similar)
      return singular && Math.abs(singular.length - t.length) < 10 ? singular : t;
    })

    // 4. Resolución de sinónimos ANTES de filtrar
    //    (un alias puede mapear a un tag válido que sí pasa la blacklist)
    .map(t => SYNONYMS[t] ?? t)

    // 5. Filtros combinados en una sola pasada
    .filter(t =>
      t.length >= minLength &&
      t.length <= maxLength &&
      !/^\d+$/.test(t) &&
      !BLACKLIST_TAGS.has(t) &&
      !VAGUE_SINGLES.has(t)
    )

    // 6. Deduplicación
    .filter(t => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    })

    // 7. Límite máximo
    .slice(0, maxTags);
};

module.exports = { cleanTags, SYNONYMS };