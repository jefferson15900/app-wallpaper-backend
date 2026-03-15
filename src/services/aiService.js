const { GoogleGenerativeAI } = require("@google/generative-ai");

// Inicializamos Gemini con tu llave
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

/**
 * Función para analizar una imagen y obtener etiquetas descriptivas
 * @param {string} imageUrl - URL de la imagen en Cloudinary
 * @returns {Promise<string[]>} - Array de etiquetas encontradas
 */
const getAITags = async (imageUrl) => {
    try {
        console.log("🤖 IA analizando imagen...");

        // 1. Descargar la imagen y convertirla a Base64 para enviarla a Google
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const base64Image = Buffer.from(buffer).toString("base64");

        // 2. Definir el prompt (instrucciones) para la IA
        const prompt = "Analiza esta imagen y devuelve exactamente 10 etiquetas (tags) descriptivas en español e inglés separadas por comas. Incluye estilo artístico (anime, realista, 3d, etc), colores y elementos clave. Solo devuelve las etiquetas separadas por comas.";

        // 3. Llamar a la IA
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Image,
                    mimeType: "image/jpeg",
                },
            },
        ]);

        // 4. Limpiar la respuesta y convertirla en un Array
        const aiTextResponse = result.response.text();
        const tagsArray = aiTextResponse
            .split(',')
            .map(tag => tag.trim().toLowerCase())
            .filter(tag => tag !== ""); // Eliminar etiquetas vacías

        console.log("✅ IA generó etiquetas:", tagsArray);
        return tagsArray;

    } catch (error) {
        console.error("❌ Error en aiService:", error.message);
        return []; // Retornamos vacío para que la app no se detenga si la IA falla
    }
};

module.exports = { getAITags };