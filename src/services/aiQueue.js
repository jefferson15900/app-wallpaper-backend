const { getAITags } = require('./aiService');
const Wallpaper = require('../models/Wallpaper');
const TagMap = require('../models/TagMap');
const { cleanTags } = require('../config/tags');

const QUEUE_DELAY_MS = 3000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 5000;

class AIQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.stats = { processed: 0, failed: 0, skipped: 0 };
    }

    addJob(job) {
        if (!job?.wallpaperId || !job?.imageUrl) {
            console.warn('⚠️ [COLA IA] Job inválido ignorado:', job);
            return;
        }

        const isDuplicate = this.queue.some(j => j.wallpaperId === job.wallpaperId);
        if (isDuplicate) {
            console.log(`⏭️ [COLA IA] ${job.wallpaperId} ya está en cola, ignorado.`);
            return;
        }

        const enrichedJob = { ...job, retries: 0, addedAt: Date.now() };
        this.queue.push(enrichedJob);
        console.log(`📥 [COLA IA] Wallpaper ${job.wallpaperId} en espera. (Cola: ${this.queue.length})`);
        this.processNext();
    }

    async processNext() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        const job = this.queue.shift();

        try {
            await this._processJob(job);
            this.stats.processed++;
        } catch (error) {
            await this._handleJobError(job, error);
        } finally {
            setTimeout(() => {
                this.isProcessing = false;
                this.processNext();
            }, QUEUE_DELAY_MS);
        }
    }

    async _processJob({ wallpaperId, imageUrl, baseTags = [] }) {
        console.log(`🤖 [COLA IA] Analizando: ${wallpaperId}...`);

        const aiTags = await getAITags(imageUrl);

        if (!aiTags?.length) {
            this.stats.skipped++;
            console.warn(`⚠️ [COLA IA] Sin etiquetas para ${wallpaperId}. Omitido.`);
            return;
        }

        // ── 1. LIMPIEZA DE ENTRADA ───────────────────────────────────
        const cleanAiTags = aiTags.map(({ en, es, category }) => ({
            en: en.toLowerCase().trim(),
            es: es.toLowerCase().trim(),
            category,
        }));

        // ── 2. ETIQUETAS PARA EL WALLPAPER (SOLO INGLÉS) ─────────────
        const finalTags = cleanTags([...baseTags, ...cleanAiTags.map(t => t.en)]);

        // ── 3. DETECTAR CATEGORÍA DOMINANTE ──────────────────────────
        const dominantCategory = this._getDominantCategory(cleanAiTags);

        // ── 4. ALIMENTAR TAGMAP (DICCIONARIO ES -> EN) ────────────────
        await this._upsertTagMap(cleanAiTags);

        // ── 5. GUARDAR EN BASE DE DATOS ───────────────────────────────
        const updateData = { tags: finalTags, isAITagged: true };

        if (dominantCategory) {
            const wallpaper = await Wallpaper.findById(wallpaperId).select('category').lean();
            const shouldUpdateCategory = !wallpaper?.category || wallpaper.category === 'Otros';
            if (shouldUpdateCategory) updateData.category = dominantCategory;
        }

        await Wallpaper.findByIdAndUpdate(wallpaperId, { $set: updateData });

        console.log(`✅ [COLA IA] ${wallpaperId} listo. Cat: ${updateData.category ?? 'sin cambio'} | Tags: ${finalTags.length}`);
    }

    _getDominantCategory(cleanAiTags) {
        const counts = cleanAiTags.reduce((acc, { category }) => {
            if (category) acc[category] = (acc[category] ?? 0) + 1;
            return acc;
        }, {});

        if (!Object.keys(counts).length) return null;
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }

    async _upsertTagMap(cleanAiTags) {
        const ops = cleanAiTags.map(({ en, es, category }) => ({
            updateOne: {
                filter: { original: es },
                update: { $set: { canonical: en, category, language: 'es' } },
                upsert: true,
            },
        }));

        if (ops.length) {
            await TagMap.bulkWrite(ops, { ordered: false });
        }
    }

    async _handleJobError(job, error) {
        this.stats.failed++;
        console.error(`❌ [COLA IA] Error en ${job.wallpaperId} (intento ${job.retries + 1}):`, error.message);

        if (job.retries < MAX_RETRIES) {
            job.retries++;
            const delay = RETRY_BACKOFF_MS * job.retries;
            console.log(`🔁 [COLA IA] Reintentando ${job.wallpaperId} en ${delay / 1000}s...`);
            setTimeout(() => {
                this.queue.unshift(job); // Reinsertar al frente
                if (!this.isProcessing) this.processNext();
            }, delay);
        } else {
            console.error(`🚫 [COLA IA] ${job.wallpaperId} descartado tras ${MAX_RETRIES} intentos.`);
        }
    }

    getStats() {
        return {
            ...this.stats,
            queued: this.queue.length,
            isProcessing: this.isProcessing,
        };
    }
}

module.exports = new AIQueue();