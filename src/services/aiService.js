const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);
const prompt = `You are a tagging engine for a premium wallpaper app. Your only job is to classify images with a minimal, high-signal set of tags.

OUTPUT: Return ONLY a valid JSON array. No markdown, no explanation.
[ { "en": "<tag>", "es": "<tag_in_spanish>" } ]

TAG COUNT: 2 minimum · 4 maximum. Fewer is better when the image is simple.

---

TAG TAXONOMY (apply in this order)

Priority 1 - Style/Category: anime, cartoon, cyberpunk, fantasy, sci-fi, abstract, neon
Priority 2 - Main Subject: car, dragon, robot, city, spaceship, animal
Priority 3 - Environment: forest, street, desert, ocean, space, mountain
Priority 4 - Context: night, rain, snow, fire, underwater
Priority 5 - Dominant Color: Only if it covers 40%+ of the image. Max 1 color tag.

---
    
RULES

Specificity: Use the most specific tag. If you tag "car", never also tag "vehicles".

Named characters: If a character is clearly identifiable (Naruto, Mario, Wall-E), use their name instead of the generic subject. Always pair with their style tag (anime or cartoon).

Stylized animals: If an animal is animated, 3D/2D rendered, or has human expressions → tag "cartoon", not "nature".

Abstract images: If there is no real subject, use "abstract" + at most 1 dominant color. No environment or context tags.

Color: Only tag a color when it visually dominates the scene (~40%+). Never tag more than one.

---

FORBIDDEN TAGS
Adjectives or opinions · emotions · small details (eyes, wheels, hair) · generic words (character, person, thing) · technical terms (4K, render, HDR, photography)

---

EXAMPLE
Image: a blue cartoon dog
Output: [ {"en":"cartoon","es":"caricatura"}, {"en":"dog","es":"perro"}, {"en":"blue","es":"azul"} ]`;


const analyzeWithModel = async (modelName, base64Image) => {

const model = genAI.getGenerativeModel({ model: modelName });

const result = await model.generateContent([
    prompt,
    {
        inlineData: {
            data: base64Image,  
            mimeType: "image/jpeg",
        },
    },
]);

const text = result.response.text().trim();

// Limpiar posibles markdown fences que Gemini a veces añade
const clean = text.replace(/```json|```/g, '').trim();

const parsed = JSON.parse(clean);

// Validar que sea un array con la forma correcta
if (!Array.isArray(parsed)) throw new Error('La IA no devolvió un array');

return parsed.filter(item =>
    item &&
    typeof item.en === 'string' && item.en.trim() &&
    typeof item.es === 'string' && item.es.trim()
).slice(0, 5);

};

const getAITags = async (imageUrl) => {
let base64Image = "";


try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Fallo al descargar imagen de Cloudinary");

    const buffer = await response.arrayBuffer();
    base64Image = Buffer.from(buffer).toString("base64");

    const models = [
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        
    ];

    for (const modelName of models) {
        try {
            return await analyzeWithModel(modelName, base64Image);
        } catch (err) {
            console.warn(`⚠️ ${modelName} falló: ${err.message}. Probando siguiente...`);
        }
    }

    console.error("❌ ERROR CRÍTICO: Todos los modelos fallaron.");
    return [];

} catch (error) {
    console.error("❌ Error descargando imagen:", error.message);
    return [];
}

};
module.exports = { getAITags };