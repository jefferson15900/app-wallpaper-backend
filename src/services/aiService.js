const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);

const VALID_CATEGORIES = new Set([
    'Anime', 'Cyberpunk', 'Nature', 'Vehicles', 'Dark',
    'Space', 'Abstract', 'Gaming', 'Architecture', 'Animals',
    'Superheroes', 'Artistic'
]);

const prompt = `You are a tagging assistant for Vexel, a premium wallpaper app.
Analyze this image and return exactly 5 tags.

MASTER CATEGORIES:
[Anime, Cyberpunk, Nature, Vehicles, Dark, Space, Abstract, Gaming, Architecture, Animals, Superheroes, Artistic]

Rules:
- Exactly 5 tags
- Single words only, no phrases
- ONLY tags that someone would actually type in a search bar
- NEVER use: illustration, cinematic, dramatic, epic, mysterious, portrait, mask, hood, backdrop, atmospheric
- Assign one MASTER CATEGORY per tag (use the most fitting one)
- If a tag truly doesn't fit any category, use null

Prioritize in this order:
1. Character/franchise  → batman, spiderman, naruto, goku, ironman, joker, deadpool
2. Setting              → space, forest, city, ocean, desert, mountain
3. Dominant colors      → red, blue, neon, golden, purple, black, white
4. Key elements         → dragon, wolf, fire, flowers, robot, car, sword, cat
5. Mood (only if very obvious) → dark, cozy, romantic

Return ONLY a JSON array, no markdown, no explanations:
[
  { "en": "batman", "es": "batman", "category": "Superheroes" },
  { "en": "city",   "es": "ciudad", "category": "Architecture" },
  { "en": "rain",   "es": "lluvia", "category": "Nature" },
  { "en": "neon",   "es": "neon",   "category": "Cyberpunk" },
  { "en": "dark",   "es": "oscuro", "category": "Dark" }
]`;

const analyzeWithModel = async (modelName, base64Image) => {
    console.log(`📡 Solicitando análisis a la IA: ${modelName}...`);

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
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (!Array.isArray(parsed)) throw new Error('La IA no devolvió un array');

    const validated = parsed.filter(item =>
        item &&
        typeof item.en === 'string' && item.en.trim() &&
        typeof item.es === 'string' && item.es.trim()
    ).map(item => ({
        en: item.en.toLowerCase().trim(),
        es: item.es.toLowerCase().trim(),
        // Validar que la categoría sea una de las 12 válidas
        category: item.category && VALID_CATEGORIES.has(item.category) ? item.category : null
    })).slice(0, 5);

    if (validated.length < 5) {
        console.warn(`⚠️ [IA] Solo devolvió ${validated.length}/5 tags`);
    }

    console.log(`🏷️ Tags generados:`, validated.map(t => `${t.en} (${t.category ?? 'sin categoría'})`));

    return validated;
};

const getAITags = async (imageUrl) => {
    try {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error("Fallo al descargar imagen de Cloudinary");

        const buffer = await response.arrayBuffer();
        const base64Image = Buffer.from(buffer).toString("base64");

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

module.exports = { getAITags, VALID_CATEGORIES };