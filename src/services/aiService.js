const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);

const analyzeWithModel = async (modelName, base64Image) => {
    console.log(`📡 Solicitando análisis a la IA: ${modelName}...`);
    
    const model = genAI.getGenerativeModel({ model: modelName });
    
    // ✅ FIX: 20 tags separados, 10 en español + 10 en inglés, SIN slashes
    const prompt = `Analiza esta imagen y devuelve exactamente 20 etiquetas (tags) descriptivas separadas por comas.
- Las primeras 10 en ESPAÑOL
- Las siguientes 10 en INGLÉS
- Incluye: estilo artístico, colores dominantes y elementos clave
- Cada etiqueta debe ser una sola palabra o concepto corto
- SIN slashes, SIN explicaciones, SOLO las etiquetas separadas por comas`;

    const result = await model.generateContent([
        prompt,
        {
            inlineData: {
                data: base64Image,
                mimeType: "image/jpeg",
            },
        },
    ]);

    const response = await result.response;
    const text = response.text();
    
    // ✅ FIX: filtramos cualquier slash que se cuele y deduplicamos
    return text.split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag !== "" && tag.length > 1)
        .filter(tag => !tag.includes('/'))           // descarta "español / english"
        .filter((tag, i, self) => self.indexOf(tag) === i) // deduplica
        .slice(0, 20);
};

/**
 * Función Principal: TRIPLE FALLBACK (v3 -> v2 -> v1.5)
 */
const getAITags = async (imageUrl) => {
    let base64Image = "";

    try {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error("Fallo al descargar imagen de Cloudinary");
        
        const buffer = await response.arrayBuffer();
        base64Image = Buffer.from(buffer).toString("base64");

        try {
            return await analyzeWithModel("gemini-3-flash-preview", base64Image);
        } catch (err3) {
            console.warn("⚠️ Gemini 3 (v3) agotado o con error. Saltando a Gemini 2.5 Flash...");
            
            try {
                return await analyzeWithModel("gemini-2.5-flash", base64Image);
            } catch (err2) {
                console.warn("⚠️ Gemini 2.5 falló. Saltando al respaldo final Gemini 2.5 Pro...");
                
                try {
                    const finalTags = await analyzeWithModel("gemini-2.5-pro", base64Image);
                    console.log("✅ Análisis completado con éxito mediante Gemini 2.5 Pro.");
                    return finalTags;
                } catch (err1) {
                    console.error("❌ ERROR CRÍTICO: Todos los modelos de Google fallaron simultáneamente.");
                    console.error("Detalle del error final:", err1.message);
                    return [];
                }
            }
        }

    } catch (error) {
        console.error("❌ Error en el proceso de descarga de imagen para IA:", error.message);
        return []; 
    }
};

module.exports = { getAITags };