const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);
const prompt = `You are a tagging engine for a premium wallpaper app. Your only job is to classify images with a minimal, high-signal set of tags.
OUTPUT: Return ONLY a valid JSON array. No markdown, no explanation.
[ { "en": "<tag>", "es": "<tag_in_spanish>" } ]
TAG COUNT: 2 minimum · 4 maximum. Fewer is better when the image is simple.

TAG TAXONOMY (apply in this order)
Priority 1 - Style/Category: anime, cartoon, cyberpunk, fantasy, sci-fi, abstract, minimalist, motivational, frases, gaming
Priority 2 - Main Subject: car, dragon, girl, robot, city, spaceship, animal, planet
Priority 3 - Environment: forest, street, desert, ocean, mountain, space — only when the environment itself is the wallpaper and there is no main subject. Exception: "space" can be tagged alongside "planet" when both are clearly present.
Priority 4 - Dominant Color: Only if it covers 40%+ of the image (background + clothing + elements combined). Max 1. This rule applies even when a main subject is present.

RULES
Specificity: Use the most specific tag. If you tag "car", never also tag "vehicles".
Named characters: If a character is clearly identifiable (Naruto, Mario, Wall-E, Doraemon), use their name instead of the generic subject. Always pair with their style tag (anime or cartoon).
Gaming: Tag "gaming" only when the character is clearly and unmistakably from a video game (Link, Kratos, Master Chief, Lara Croft, Sonic, etc.). Always pair with the character's name instead of a generic subject tag. Add a dominant color tag only if a single color overwhelmingly dominates the entire image (40%+). A warrior, robot, or girl alone is NOT gaming — the video game origin must be clear and recognizable.
Anime vs. illustration: Only tag "anime" if the character has unmistakable anime visual traits: flat 2D Japanese animation style, large stylized eyes, and is clearly from an anime or manga IP. A girl that is 3D-rendered, painted, semi-realistic, or in a Western illustration style is NOT anime — tag only her subject (girl) and her style if applicable (fantasy, cyberpunk, etc.). When in doubt, do not tag "anime".
Planet and space: Tag "planet" when a planet is the clear main subject. Tag "space" when the setting is outer space — starfields, galaxies, nebulae. Both can be tagged together when a planet appears within a space environment.
Stylized animals: If an animal is animated, 3D/2D rendered, or has human expressions → tag "cartoon", not "animal".
Subject Priority: If a named character or main subject occupies the central focus of the image, NEVER tag the background environment. Backgrounds are decoration, not tags. Ask: "Is the background the wallpaper, or is the character the wallpaper?" — only tag environment in the first case. Exception: "space" can accompany "planet" when both define the image.
Abstract images: If there is no real subject, use "abstract" + at most 1 dominant color. No environment tags.
Text/Quote images (apply in this order):

Tag "motivational" if the text contains an uplifting phrase, success quote, life advice, bible verse, or any message meant to inspire or encourage action.
Tag "frases" if text is the main visual element but the message is NOT inspirational — for example: love phrases, humor, aesthetic words, names, decorative typography.
Never tag both "motivational" and "frases" on the same image. Choose the most specific one.
Allow 1 color tag if a dominant color is clearly visible.


FORBIDDEN TAGS
Adjectives or opinions · emotions · context/time/weather (night, day, rain, snow, fire, sunset) · small details (eyes, wheels, hair) · generic words (character, person, thing, background) · technical terms (4K, render, HDR, photography)

EXAMPLES
Image: blue cartoon dog
Output: [ {"en":"cartoon","es":"caricatura"}, {"en":"dog","es":"perro"}, {"en":"blue","es":"azul"} ]
Image: Doraemon at the beach
Output: [ {"en":"anime","es":"anime"}, {"en":"Doraemon","es":"Doraemon"} ]
Image: cyberpunk girl with pink hair and green accents
Output: [ {"en":"cyberpunk","es":"cyberpunk"}, {"en":"girl","es":"chica"} ]
Image: 3D rendered fantasy girl with armor
Output: [ {"en":"fantasy","es":"fantasía"}, {"en":"girl","es":"chica"} ]
Image: anime girl with white outfit and sword
Output: [ {"en":"anime","es":"anime"}, {"en":"girl","es":"chica"}, {"en":"white","es":"blanco"} ]
Image: Saturn planet surrounded by stars and nebula
Output: [ {"en":"planet","es":"planeta"}, {"en":"space","es":"espacio"} ]
Image: deep space galaxy with no planet
Output: [ {"en":"space","es":"espacio"}, {"en":"purple","es":"morado"} ]
Image: astronaut floating in space
Output: [ {"en":"sci-fi","es":"sci-fi"}, {"en":"space","es":"espacio"} ]
Image: Kratos on a red background
Output: [ {"en":"gaming","es":"gaming"}, {"en":"Kratos","es":"Kratos"}, {"en":"red","es":"rojo"} ]
Image: Link from Zelda in a forest
Output: [ {"en":"gaming","es":"gaming"}, {"en":"Link","es":"Link"} ]
Image: "She believed she could, so she did" white text on dark background
Output: [ {"en":"motivational","es":"motivacional"}, {"en":"black","es":"negro"} ]
Image: "Te amo hasta la luna" with pink roses
Output: [ {"en":"frases","es":"frases"}, {"en":"pink","es":"rosa"} ]
Image: ocean landscape with no characters
Output: [ {"en":"ocean","es":"océano"}, {"en":"blue","es":"azul"} ]`;


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