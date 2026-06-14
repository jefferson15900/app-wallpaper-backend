require('dotenv').config();
const mongoose = require('mongoose');
const Wallpaper = require('./src/models/Wallpaper'); // Ajusta la ruta a tu modelo

const TAGS_TO_REMOVE = [
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
  'studio quality', 'film quality', 'movie quality',

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
  'fan art', 'fanart',
  'anime style', 'estilo anime', 'anime art',
  'manga style', 'estilo manga', 'manga art',
  'cartoon', 'cartoon style', 'cartoonish',
  'comic style', 'estilo cómic', 'comic book style', 'comic book',
  'realistic', 'realista',
  'cinematic', 'cinematográfico',
  'artistic', 'artístico',
  'abstract', 'abstracto', 'abstract art', 'arte abstracto',
  'minimalistic',
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
  'wallpaper hub', 'wallpaperhub', 'hub', 'otros', 'other',

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
  'hombre', 'mujer', 'chico', 'chica',
  'young', 'joven', 'adult', 'adulto',
  'cute', 'kawaii', 'lindo', 'semi-realistic anime',
  'beautiful girl', 'beautiful woman', 'handsome',

  // ── AMBIENTE / ESCENARIO ULTRA GENÉRICO ──────────────────
  'scene', 'escena',
  'environment', 'entorno', 'ambiente',
  'landscape', 'paisaje',
  'background scene', 'escenario',
  'outdoor', 'indoor', 'exterior', 'interior',
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
'cottagecore',
'lightacademia', 'light academia',
'royalcore', 'angelcore', 'fairycore',
'goblincore', 'weirdcore', 'dreamcore', 
'y2k aesthetic',

// ── LIFESTYLE VACÍO ───────────────────────────────────────
'minimal', 'clean', 'simple', 'sencillo',
'soft', 'suave', 'cozy', 'acogedor',
'dreamy', 'ethereal', 'etéreo',
'magical', 'mágico', 'mystic', 'místico',
'romantic', 'romántico',
'mysterious', 'misterioso',
'vintage', 'retro', 'old school',
'modern', 'moderno', 'contemporary',
'luxury', 'lujoso', 'premium',
'grunge', 'edgy',
'pastel colors', 'pastel aesthetic',
'neutral', 'neutral tones', 'neutral colors',
'earth tones', 'tonos tierra',
'monocromático', 'black and white', 'blanco y negro',
'golden', 'dorado', 'gold aesthetic',

// ── FRASES DE CAPTION ────────────────────────────────────
'follow for more', 'like this', 'save this',
'pin it', 'repin', 'share',
'credit to owner', 'not mine', 'found on pinterest',
'source unknown', 'via pinterest',
'tap for more', 'swipe',

'digital', // Puesto #5, no dice nada, todo es digital
  'personaje', // Puesto #29, muy genérico
  'rendering', 'renderizado', // Ruido técnico
  'tridimensional', // Ruido técnico
  'vibrante', 'colorido', // Adjetivos vagos
  'looking up', 'peeking', // Descripciones de pose muy raras
  'otro'
];

const cleanupTags = async () => {
    try {
        // 1. Conexión a la DB
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB para limpieza profunda...');

        // 2. Ejecutar la eliminación masiva
        // Buscamos cualquier wallpaper que tenga al menos una de estas etiquetas
        // y las extraemos del array 'tags'
        const result = await Wallpaper.updateMany(
            { tags: { $in: TAGS_TO_REMOVE } }, 
            { $pull: { tags: { $in: TAGS_TO_REMOVE } } }
        );

        console.log(`-----------------------------------------`);
        console.log(`📊 RESULTADO DE LA OPERACIÓN:`);
        console.log(`   - Obras que contenían estas etiquetas: ${result.matchedCount}`);
        console.log(`   - Obras limpiadas con éxito:           ${result.modifiedCount}`);
        console.log(`-----------------------------------------`);
        
        console.log('🧹 Etiquetas eliminadas:');
        TAGS_TO_REMOVE.forEach(tag => console.log(`   [-] ${tag}`));
        console.log(`\n✨ Tu base de datos ahora está más enfocada en contenido real.`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error durante la limpieza:', error);
        process.exit(1);
    }
};

cleanupTags();