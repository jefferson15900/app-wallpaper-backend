const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);
const prompt = `You are a tagging assistant for a wallpaper app. Analyze the image and return EXACTLY 5 tags.

OUTPUT FORMAT:

Return ONLY a valid JSON array
No explanations, no markdown, no extra text
Each item must follow this structure:
{ "en": "<tag>", "es": "<tag_in_spanish>" }

GENERAL RULES:

Use SINGLE WORDS only (no phrases, no hyphens, no compound terms)
Use lowercase only
No duplicates
Tags must be common search keywords
Avoid vague or overly generic words unless clearly dominant in the image

FORBIDDEN WORDS:
illustration, cinematic, dramatic, epic, mysterious, portrait, mask, hood, backdrop, atmospheric

TAG PRIORITY (strict order):

Character or franchise (only if clearly recognizable)
Setting or environment
Dominant colors (only if visually prominent)
Key objects or elements
Mood (ONLY if strongly evident)

SELECTION LOGIC:

Always return exactly 5 tags
Follow priority order strictly
Skip any category that does not apply
Do NOT guess or infer unclear characters
Prefer specific terms over generic ones
Colors must occupy a significant portion of the image

LANGUAGE RULES:

Spanish must be natural and commonly used
Do NOT translate proper names (e.g., "batman" stays "batman")
 
OUTPUT EXAMPLE:
[
{ "en": "batman", "es": "batman" },
{ "en": "city", "es": "ciudad" },
{ "en": "rain", "es": "lluvia" },
{ "en": "red", "es": "rojo" },
{ "en": "dark", "es": "oscuro" }
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