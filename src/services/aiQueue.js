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

            // aiTags = [{ en, es, category }, ...]
            const aiTags = await getAITags(imageUrl);

            if (!aiTags || aiTags.length === 0) {
                console.warn(`⚠️ [COLA IA] Sin etiquetas para ${wallpaperId}.`);
                return;
            }

            // ── Extraer tags por idioma ───────────────────────────────────
            const enTags = aiTags.map(t => t.en);
            const esTags = aiTags
                .map(t => t.es)
                .filter(es => !enTags.includes(es));

            // ── Limpiar y combinar ────────────────────────────────────────
            const cleanedEn = cleanTags([...baseTags, ...enTags]);
            const cleanedEs = cleanTags(esTags);
            const finalTags = [...new Set([...cleanedEn, ...cleanedEs])];

            // ── Detectar categoría dominante ──────────────────────────────
            // Contamos qué categoría aparece más entre los 5 tags
            const categoryCounts = {};
            aiTags.forEach(t => {
                if (t.category) {
                    categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
                }
            });

            const dominantCategory = Object.keys(categoryCounts).length > 0
                ? Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0][0]
                : null;

            console.log(`🗂️ Categoría dominante: ${dominantCategory ?? 'ninguna'}`);

            // ── Alimentar TagMap ──────────────────────────────────────────
const tagMapOps = aiTags.map(({ en, es, category }) => ({
    updateOne: {
        // Buscamos siempre por el término en español (original)
        filter: { original: es.toLowerCase().trim() }, 
        update: { 
            $set: { 
                canonical: en.toLowerCase().trim(), // Palabra maestra en inglés
                category: category,                 // 🚀 LA CATEGORÍA AHORA SE GUARDA
                language: 'es' 
            } 
        },
        upsert: true 
    }
}));

if (tagMapOps.length > 0) {
    const result = await TagMap.bulkWrite(tagMapOps, { ordered: false });
    console.log(`📚 [TAGMAP] Sincronizados: ${result.upsertedCount + result.modifiedCount} mapeos.`);
}else {
                console.log(`⚠️ [TAGMAP] Sin mapeos nuevos`);
            }

            // ── Guardar en Wallpaper ──────────────────────────────────────
            const updateData = {
                tags: finalTags,
                isAITagged: true,
                // Solo actualizar categoría si la tiene "Otros" o vacía
                // para no sobreescribir una categoría que el artista puso manualmente
            };

            const wallpaper = await Wallpaper.findById(wallpaperId);
            if (wallpaper && (!wallpaper.category || wallpaper.category === 'Otros') && dominantCategory) {
                updateData.category = dominantCategory;
                console.log(`🗂️ Categoría asignada: ${dominantCategory}`);
            }

            await Wallpaper.findByIdAndUpdate(wallpaperId, { $set: updateData });

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