const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);
const prompt = `You are a tagging assistant for a wallpaper app. Analyze this image and return exactly 5 tags.
Rules:
Single words only, no phrases
ONLY tags that someone would actually type in a search bar
NEVER use: illustration, cinematic, dramatic, epic, mysterious, portrait, mask, hood, backdrop, atmospheric
Prioritize in this order:
Character/franchise  → batman, spiderman, naruto, goku, ironman, joker, deadpool
Setting              → space, forest, city, ocean, desert, mountain
Dominant colors      → red, blue, neon, golden, purple, black, white
Key elements         → dragon, wolf, fire, flowers, robot, car, sword, cat
Mood (only if very obvious) → dark, cozy, romantic
Return ONLY a JSON array, no explanations, no markdown:
[
{ "en": "batman", "es": "batman" },
{ "en": "city",   "es": "ciudad" },
{ "en": "rain",   "es": "lluvia" },
{ "en": "red",    "es": "rojo"   },
{ "en": "dark",   "es": "oscuro" }
]`; 
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