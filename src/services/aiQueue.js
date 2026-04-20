const { getAITags } = require('./aiService');
const Wallpaper = require('../models/Wallpaper');
const { cleanTags } = require('../config/tags'); // 🚀 IMPORTANTE: Importar tu nuevo archivo

class AIQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
    }

    addJob(job) {
        console.log(`📥 [COLA IA] Wallpaper ${job.wallpaperId} en espera. (Cola actual: ${this.queue.length + 1})`);
        this.queue.push(job);
        this.processNext();
    }

    async processNext() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        const { wallpaperId, imageUrl, baseTags } = this.queue.shift();

        try {
            console.log(`🤖 [COLA IA] Analizando arte: ${wallpaperId}...`);

            const aiTags = await getAITags(imageUrl);

            if (aiTags && aiTags.length > 0) {
                // ⚡ AQUÍ ESTÁ EL CAMBIO MAESTRO:
                // Unimos las etiquetas y se las pasamos a tu función profesional de limpieza
                const finalTags = cleanTags([...baseTags, ...aiTags]);

                await Wallpaper.findByIdAndUpdate(wallpaperId, {
                    $set: {
                        tags: finalTags,
                        isAITagged: true
                    }
                });

                console.log(`✅ [COLA IA] Wallpaper enriquecido y filtrado. Etiquetas finales: ${finalTags.length}`);
            } else {
                console.warn(`⚠️ [COLA IA] Gemini no devolvió etiquetas para ${wallpaperId}.`);
            }

        } catch (error) {
            console.error(`❌ [COLA IA] Error crítico procesando ${wallpaperId}:`, error.message);
        } finally {
            setTimeout(() => {
                this.isProcessing = false;
                this.processNext();
            }, 3000);
        }
    }
}

module.exports = new AIQueue();