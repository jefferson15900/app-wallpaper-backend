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