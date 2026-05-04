// src/config/scoring.js

const IGNORED_TAGS = [
  // --- IA / CALIDAD ---
  '4k', '8k', 'high quality', 'masterpiece', 'cinematic', 'detailed', 
  'highres', 'uhd', 'render', 'digital art', 'sharp', 'highly detailed',
  'photorealistic', 'raw photo', 'unreal engine', 'octane render',
  
  // --- CÁMARA / COMPOSICIÓN ---
  'depth of field', 'bokeh', 'centered', 'close up', 'wide shot', 
  'portrait', 'landscape', 'panoramic', 'macro',
  
  // --- PALABRAS VAGAS ---
  'art', 'style', 'image', 'photo', 'picture', 'color', 'light', 'dark',
  'background', 'wallpaper', 'arte', 'estilo', 'imagen', 'foto', 'fondo',
  'otros', 'otro', 'view', 'look', 'texture', 'pattern', 'design', 'neon',

    'high quality', 'best quality', 'ultra quality', 'top quality', 'premium quality',
  'high resolution', 'ultra high resolution', 'ultra hd', 'uhd', 'fhd', 'full hd',
  '4k', '8k', '16k', 'hd', 'highres', 'hi res', 'hi-res','curve','fire','fantasi','colorful',
  'masterpiece', 'best masterpiece', 'top masterpiece','whater',
  'sharp', 'sharp focus', 'sharp image', 'in focus','glass',
  'intricate', 'intricate details', 'intricate design', 'casinl','frient',
  'highly detailed', 'detailed', 'very detailed', 'ultra detailed', 'super detailed',
  'extremely detailed', 'insanely detailed', 'richly detailed', 'frient','casinl',
  'hyperrealistic', 'hyper-realistic', 'hyper realistic',
  'photorealistic', 'photo realistic', 'photo-realistic',
  'raw photo', 'raw image', 'dslr', 'dslr photo','forest','city','street','night','weather',
  'professional photo', 'professional photograph', 'professional photography',
  'perfect composition', 'perfect lighting', 'perfect details',
  'high detail', 'fine detail', 'fine details', 'maximum detail',
  'studio quality', 'film quality', 'movie quality', 'mecánica expuesta', 'otros','otro','anime',

  // ── ILUMINACIÓN GENÉRICA ──────────────────────────────────
  'soft lighting', 'soft light', 'soft lights',
  'dramatic lighting', 'dramatic light', 
  'cinematic lighting', 'cinematic light',
  'natural lighting', 'natural light','dark',
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

    // --- COLORES ---
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink',
  'black', 'white', 'gray', 'grey', 'brown', 'beige', 'cyan',
  'magenta', 'gold', 'silver', 'teal', 'navy', 'maroon', 'coral',
  'turquoise', 'violet', 'indigo', 'lime', 'olive', 'aqua',
  'dark', 'light', 'bright', 'neon', 'pastel', 'colorful',

  // --- EMOCIONES ---
  'happy', 'sad', 'angry', 'calm', 'excited', 'relaxing',
  'melancholic', 'energetic', 'peaceful', 'dramatic', 'mysterious',
  'romantic', 'nostalgic', 'dark mood', 'cozy', 'epic',

  // --- VALORACIONES SUBJETIVAS ---
  'beautiful', 'pretty', 'cute', 'stunning', 'gorgeous', 'lovely',
  'amazing', 'cool', 'aesthetic', 'nice', 'perfect', 'elegant', 

];

const SCORING_RULES = {
  decay: 0.97, // Factor de olvido por cada interacción
  points: {
    view: 1,
    deep_view: 4,
    like: 12,
    save: 18,
    see_more: 30,
    download: 40,
    see_less_cold: -15, // 👈 Nuevo
    see_less_warm: -40  // 👈 Nuevo
  }
};

module.exports = { IGNORED_TAGS, SCORING_RULES };