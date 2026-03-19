const { getAITags } = require('./aiService'); // Tu servicio de Gemini
const Wallpaper = require('../models/Wallpaper'); // Tu modelo de DB

class AIQueue {
    constructor() {
        this.queue = [];      // Lista de espera
        this.isProcessing = false; // Estado del trabajador
    }

    /**
     * Añade un nuevo wallpaper a la fila de procesamiento
     * @param {Object} job - { wallpaperId, imageUrl, baseTags }
     */
    addJob(job) {
        console.log(`📥 [COLA IA] Wallpaper ${job.wallpaperId} en espera. (Cola actual: ${this.queue.length + 1})`);
        this.queue.push(job);
        this.processNext(); // Intenta procesar
    }

    /**
     * Lógica de procesamiento secuencial (Uno por uno)
     */
    async processNext() {
        // 1. Si ya hay un proceso en marcha o no hay nada en la lista, nos detenemos
        if (this.isProcessing || this.queue.length === 0) return;

        // 2. Bloqueamos la cola para que nadie más entre hasta terminar este
        this.isProcessing = true;

        // 3. Obtenemos el primer trabajo de la lista
        const { wallpaperId, imageUrl, baseTags } = this.queue.shift();

        try {
            console.log(`🤖 [COLA IA] Analizando arte: ${wallpaperId}...`);
            
            // 4. Llamamos a Gemini (Tu función de triple fallback)
            const aiTags = await getAITags(imageUrl);

            if (aiTags && aiTags.length > 0) {
                // Mezclamos etiquetas del usuario + etiquetas de la IA
                const finalTags = [...new Set([...baseTags, ...aiTags])]
                    .map(tag => tag.toLowerCase().trim())
                    .filter(tag => tag !== "");

                // 5. Guardamos en la Base de Datos
                await Wallpaper.findByIdAndUpdate(wallpaperId, { 
                    $set: { 
                        tags: finalTags, 
                        isAITagged: true 
                    } 
                });

                console.log(`✅ [COLA IA] Wallpaper ${wallpaperId} enriquecido con éxito.`);
            } else {
                console.warn(`⚠️ [COLA IA] Gemini no devolvió etiquetas para ${wallpaperId}.`);
            }

        } catch (error) {
            console.error(`❌ [COLA IA] Error crítico procesando ${wallpaperId}:`, error.message);
        }

        // --- PAUSA DE SEGURIDAD (ANTISATURACIÓN) ---
        // Esperamos 3 segundos antes de procesar el siguiente wallpaper.
        // Esto garantiza que respetamos los límites de la API gratuita de Google.
        setTimeout(() => {
            this.isProcessing = false;
            this.processNext(); // Llamada recursiva para procesar el siguiente en la fila
        }, 3000); 
    }
}

// Exportamos una única instancia de la clase (Singleton) 
// para que todos los archivos compartan la misma fila de espera.
module.exports = new AIQueue();