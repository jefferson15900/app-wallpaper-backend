const { GoogleGenerativeAI } = require("@google/generative-ai");

// Inicializamos el SDK con la llave guardada en Render
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);

/**
 * Función interna de apoyo para ejecutar el análisis con un modelo específico
 * @param {string} modelName - Nombre técnico del modelo de Google
 * @param {string} base64Image - Imagen convertida para la IA
 * @returns {Promise<string[]>} - Lista de etiquetas procesadas
 */
const analyzeWithModel = async (modelName, base64Image) => {
    console.log(`📡 Solicitando análisis a la IA: ${modelName}...`);
    
    const model = genAI.getGenerativeModel({ model: modelName });
    
    const prompt = "Analiza esta imagen y devuelve exactamente 10 etiquetas (tags) descriptivas en español e inglés separadas por comas. Incluye el estilo artístico (ej: anime, realista, 3d, cyberpunk), los colores dominantes y los elementos clave del arte. Solo devuelve las etiquetas separadas por comas, sin explicaciones adicionales.";

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
    
    // Limpiamos la respuesta: convertimos a minúsculas, quitamos espacios y filtramos vacíos
    return text.split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag !== "" && tag.length > 1);
};

/**
 * Función Principal: TRIPLE FALLBACK (v3 -> v2 -> v1.5)
 * @param {string} imageUrl - URL de Cloudinary para analizar
 * @returns {Promise<string[]>} - Etiquetas finales
 */
const getAITags = async (imageUrl) => {
    let base64Image = "";

    try {
        // 1. Descargamos la imagen una sola vez para ahorrar ancho de banda
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error("Fallo al descargar imagen de Cloudinary");
        
        const buffer = await response.arrayBuffer();
        base64Image = Buffer.from(buffer).toString("base64");

        // --- INTENTO 1: GEMINI 3 (Máxima vanguardia, cuota limitada) ---
        try {
            return await analyzeWithModel("gemini-3-flash-preview", base64Image);
        } catch (err3) {
            console.warn("⚠️ Gemini 3 (v3) agotado o con error. Saltando a Gemini 2.0...");
            
            // --- INTENTO 2: GEMINI 2.0 (Equilibrio entre velocidad y cuota) ---
            try {
                return await analyzeWithModel("gemini-2.5-flash", base64Image);
            } catch (err2) {
                console.warn("⚠️ Gemini 2.0 falló. Saltando al respaldo final Gemini 1.5...");
                
                // --- INTENTO 3: GEMINI 1.5 (El modelo tanque, cuota masiva y estable) ---
                try {
                    const finalTags = await analyzeWithModel("gemini-2.5-pro", base64Image);
                    console.log("✅ Análisis completado con éxito mediante GeminiGemini 2.0 Pro.");
                    return finalTags;
                } catch (err1) {
                    console.error("❌ ERROR CRÍTICO: Todos los modelos de Google fallaron simultáneamente.");
                    console.error("Detalle del error final:", err1.message);
                    return []; // Devolvemos vacío para que la app no se cuelgue
                }
            }
        }

    } catch (error) {
        console.error("❌ Error en el proceso de descarga de imagen para IA:", error.message);
        return []; 
    }
};

module.exports = { getAITags };