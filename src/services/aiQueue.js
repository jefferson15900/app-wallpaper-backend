const { getAITags } = require('./aiService');
const Wallpaper = require('../models/Wallpaper');
const TagMap = require('../models/TagMap');
const { cleanTags } = require('../config/tags');

class AIQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
    }

    addJob(job) {
        console.log(`📥 [COLA IA] Wallpaper ${job.wallpaperId} en espera. (Cola: ${this.queue.length + 1})`);
        this.queue.push(job);
        this.processNext();
    }

    async processNext() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        const { wallpaperId, imageUrl, baseTags } = this.queue.shift();

        try {
            console.log(`🤖 [COLA IA] Analizando: ${wallpaperId}...`);

            // aiTags = [{ en: "city", es: "ciudad" }, ...]
            const aiTags = await getAITags(imageUrl);

            if (!aiTags || aiTags.length === 0) {
                console.warn(`⚠️ [COLA IA] Sin etiquetas para ${wallpaperId}.`);
                return;
            }

            // ── Separar en inglés y español ──────────────────────────────
            const enTags = aiTags.map(t => t.en.toLowerCase().trim());
            const esTags = aiTags.map(t => t.es.toLowerCase().trim())
                .filter(es => !enTags.includes(es)); // evitar duplicar si son iguales (batman = batman)

            // ── Limpiar ambos conjuntos ──────────────────────────────────
            const cleanedEn = cleanTags([...baseTags, ...enTags]);
            const cleanedEs = cleanTags(esTags);
            const finalTags = [...new Set([...cleanedEn, ...cleanedEs])];

            // ── Alimentar TagMap automáticamente ─────────────────────────
            const tagMapOps = aiTags
                .filter(t => t.en !== t.es) // solo si son diferentes
                .map(({ en, es }) => ({
                    updateOne: {
                        filter: { original: es.toLowerCase().trim() },
                        update: { $set: { canonical: en.toLowerCase().trim(), language: 'es' } },
                        upsert: true
                    }
                }));

            if (tagMapOps.length > 0) {
                await TagMap.bulkWrite(tagMapOps, { ordered: false });
                console.log(`📚 [COLA IA] TagMap alimentado con ${tagMapOps.length} mapeos nuevos.`);
            }

            // ── Guardar en Wallpaper ──────────────────────────────────────
            await Wallpaper.findByIdAndUpdate(wallpaperId, {
                $set: {
                    tags: finalTags,
                    isAITagged: true
                }
            });

            console.log(`✅ [COLA IA] Wallpaper ${wallpaperId} listo. Tags: [${finalTags.join(', ')}]`);

        } catch (error) {
            console.error(`❌ [COLA IA] Error en ${wallpaperId}:`, error.message);
        } finally {
            setTimeout(() => {
                this.isProcessing = false;
                this.processNext();
            }, 3000);
        }
    }
}

module.exports = new AIQueue();