const { getAITags } = require('./aiService');
const Wallpaper = require('../models/Wallpaper');
const TagMap = require('../models/TagMap');
const { cleanTags } = require('../config/tags');
class AIQueue {
constructor() {
this.queue = [];
this.isProcessing = false;
}
code
Code
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

        // ── Extraer strings de cada idioma ───────────────────────────
        const enTags = aiTags.map(t => t.en.toLowerCase().trim());
        const esTags = aiTags
            .map(t => t.es.toLowerCase().trim())
            .filter(es => !enTags.includes(es));

        // ── Limpiar y combinar ──────────────────────────────────────── 
          const cleanedEn = cleanTags([...baseTags, ...enTags]);
          const finalTags = [...new Set(cleanedEn)]; // ← solo EN

        // ── Alimentar TagMap ──────────────────────────────────────────
        const tagMapOps = aiTags
            .filter(t => t.en !== t.es)
            .map(({ en, es }) => ({
                updateOne: {
                    filter: { original: es.toLowerCase().trim() },
                    update: { $set: { canonical: en.toLowerCase().trim(), language: 'es' } },
                    upsert: true
                }
            }));

        if (tagMapOps.length > 0) {
            const result = await TagMap.bulkWrite(tagMapOps, { ordered: false });

            // 🔍 Verificación: confirmar que se guardó en DB
            const saved = await TagMap.find({
                original: { $in: aiTags.map(t => t.es) }
            }).lean();

            console.log(`📚 [TAGMAP] Insertados: ${result.upsertedCount} | Actualizados: ${result.modifiedCount}`);
            console.log(`📚 [TAGMAP] En DB:`, saved.map(m => `${m.original} → ${m.canonical}`));
        } else {
            console.log(`⚠️ [TAGMAP] Sin mapeos nuevos (todos iguales en ambos idiomas)`);
        }

        // ── Guardar en Wallpaper ──────────────────────────────────────
        await Wallpaper.findByIdAndUpdate(wallpaperId, {
            $set: { tags: finalTags, isAITagged: true }
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