const { GoogleGenerativeAI } = require("@google/generative-ai");
const Wallpaper = require("../models/Wallpaper");

// Inicializamos el SDK con los modelos de nueva generación
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);

// --- CONFIGURACIÓN DE LA COLA (QUEUE) ---
const aiQueue = [];
let isProcessing = false;

/**
 * Función interna para llamar a los motores Gemini 2.0
 */
const analyzeWithModel = async (modelName, base64Image) => {
    console.log(`📡 Consultando motor: ${modelName}...`);
    const model = genAI.getGenerativeModel({ model: modelName });
    
    const prompt = "Analiza esta imagen y devuelve exactamente 10 etiquetas (tags) descriptivas en español e inglés separadas por comas. Incluye el estilo artístico (ej: anime, realista, 3d, cyberpunk), los colores dominantes y los elementos clave del arte. Solo devuelve las etiquetas separadas por comas, sin explicaciones adicionales.";
    const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64Image, mimeType: "image/jpeg" } },
    ]);

    const response = await result.response;
    return response.text().split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 1);
};

/**
 * TRIPLE FALLBACK: Solo usando la familia Gemini 2.0 (Activos 2025)
 */
const getTagsFromAI = async (imageUrl) => {
    try {
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const base64Image = Buffer.from(buffer).toString("base64");

        // --- INTENTO 1: GEMINI 2.0 FLASH (El estándar de alta velocidad) ---
        try {
            return await analyzeWithModel("gemini-2.0-flash", base64Image);
        } catch (e1) {
            console.warn("⚠️ 2.0 Flash saturado. Intentando con 2.0 Flash-Lite (Más capacidad)...");
            
            // --- INTENTO 2: GEMINI 2.0 FLASH-LITE (Diseñado para mayor volumen de peticiones) ---
            try {
                // Este modelo es el que Google recomienda para evitar el error 429
                return await analyzeWithModel("gemini-2.0-flash-lite-preview-02-05", base64Image);
            } catch (e2) {
                console.warn("⚠️ Lite saturado. Usando Gemini 2.0 Pro como último recurso...");
                
                // --- INTENTO 3: GEMINI 2.0 PRO (El más inteligente por si todo falla) ---
                try {
                    return await analyzeWithModel("gemini-2.0-pro-experimental-02-05", base64Image);
                } catch (e3) {
                    console.error("❌ Todos los modelos 2.0 fallaron. Google saturado.");
                    return [];
                }
            }
        }
    } catch (error) {
        console.error("❌ Error de descarga para IA:", error.message);
        return [];
    }
};

/**
 * PROCESADOR DE LA COLA (Ejecuta el análisis de IA uno por uno)
 * Esta función asegura que no se sature la RAM de Render ni la cuota de Google.
 */
const processQueue = async () => {
    if (isProcessing || aiQueue.length === 0) return;

    isProcessing = true;

    const { imageUrl, wallpaperId } = aiQueue.shift();

    try {
        console.log(`📦 [COLA IA] Iniciando: ${wallpaperId}. Pendientes en lista: ${aiQueue.length}`);
        const aiTags = await getTagsFromAI(imageUrl);

        if (aiTags && aiTags.length > 0) {
            await Wallpaper.findByIdAndUpdate(wallpaperId, { 
                $addToSet: { tags: { $each: aiTags } }, 
                $set: { isAITagged: true } 
            });
            
            console.log(`✅ [COLA IA] Enriquecido con éxito: ${wallpaperId}`);
        } else {

            await Wallpaper.findByIdAndUpdate(wallpaperId, { $set: { isAITagged: false } });
            console.log(`⚠️ [COLA IA] No se generaron etiquetas nuevas para: ${wallpaperId}`);
        }

    } catch (err) {
        console.error(`❌ [COLA IA] Error crítico procesando ${wallpaperId}:`, err.message);
    } finally {
        isProcessing = false;
        setTimeout(processQueue, 3000); 
    }
};

/**
 * FUNCIÓN PÚBLICA: Añade a la cola
 */
const addToAIQueue = (imageUrl, wallpaperId) => {
    aiQueue.push({ imageUrl, wallpaperId });
    processQueue();
};

module.exports = { addToAIQueue };